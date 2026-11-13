"""Project-scoped query layer for agent-generated SQL.

The SQL agent never queries the raw tables directly. Every query it writes is
wrapped like this before execution:

    WITH
      projects           AS (... only this project ...),
      files              AS (... only this project's files ...),
      profiles           AS (...),
      measurements       AS (...),
      project_parameters AS (...),
      users / conversations / messages AS (... empty ...),
      obs                AS (... flattened, adjusted-with-fallback view ...),
      profile_summary    AS (... one row per profile ...)
    SELECT * FROM ( <agent query> ) AS _agent_query
    LIMIT <QUERY_LIMIT>

Because CTE names shadow table names for unqualified references, the agent's
query can only ever see the current project's rows — even if it forgets a
project filter or names a raw table. Schema-qualified references
(``public.measurements``) and catalog access are rejected by
``validate_agent_sql`` so the shadowing cannot be bypassed.

All CTEs are ``NOT MATERIALIZED`` so Postgres inlines them and pushes the
agent's filters down; CTEs the agent does not reference cost nothing.

The convenience views (``obs``, ``profile_summary``) absorb the joins and
``COALESCE(x_adjusted, x)`` boilerplate, so the model can spend its effort on
the actual analysis instead of the plumbing.
"""

from __future__ import annotations

import re

PROJECT_PARAM = "pid"

# Placeholder accepted (but no longer required) in agent queries.
PROJECT_PLACEHOLDER = "{project_id}"

SCOPED_CTES = f"""WITH
projects AS NOT MATERIALIZED (
    SELECT * FROM public.projects WHERE project_id = %({PROJECT_PARAM})s
),
files AS NOT MATERIALIZED (
    SELECT * FROM public.files WHERE project_id = %({PROJECT_PARAM})s
),
profiles AS NOT MATERIALIZED (
    SELECT p.* FROM public.profiles p
    WHERE p.file_id IN (SELECT file_id FROM files)
),
measurements AS NOT MATERIALIZED (
    SELECT m.* FROM public.measurements m
    WHERE m.profile_id IN (SELECT profile_id FROM profiles)
),
project_parameters AS NOT MATERIALIZED (
    SELECT * FROM public.project_parameters WHERE project_id = %({PROJECT_PARAM})s
),
users AS NOT MATERIALIZED (SELECT * FROM public.users WHERE false),
conversations AS NOT MATERIALIZED (SELECT * FROM public.conversations WHERE false),
messages AS NOT MATERIALIZED (SELECT * FROM public.messages WHERE false),
obs AS NOT MATERIALIZED (
    SELECT
        m.measurement_id,
        m.profile_id,
        pr.file_id,
        f.platform_number,
        pr.cycle_number,
        pr.direction,
        pr.data_mode,
        pr.observed_at,
        pr.latitude,
        pr.longitude,
        m.depth_level,
        COALESCE(m.pressure_adjusted, m.pressure)       AS pressure,
        COALESCE(m.temperature_adjusted, m.temperature) AS temperature,
        COALESCE(m.salinity_adjusted, m.salinity)       AS salinity,
        CASE WHEN m.pressure_adjusted IS NOT NULL
             THEN m.pressure_adjusted_qc ELSE m.pressure_qc END       AS pressure_qc,
        CASE WHEN m.temperature_adjusted IS NOT NULL
             THEN m.temperature_adjusted_qc ELSE m.temperature_qc END AS temperature_qc,
        CASE WHEN m.salinity_adjusted IS NOT NULL
             THEN m.salinity_adjusted_qc ELSE m.salinity_qc END       AS salinity_qc,
        m.extras
    FROM measurements m
    JOIN profiles pr ON pr.profile_id = m.profile_id
    JOIN files f     ON f.file_id = pr.file_id
),
profile_summary AS NOT MATERIALIZED (
    SELECT
        pr.profile_id,
        pr.file_id,
        f.platform_number,
        pr.cycle_number,
        pr.direction,
        pr.data_mode,
        pr.observed_at,
        pr.latitude,
        pr.longitude,
        agg.n_levels,
        agg.min_pressure,
        agg.max_pressure,
        surf.temperature AS surface_temperature,
        surf.salinity    AS surface_salinity,
        surf.pressure    AS surface_pressure
    FROM profiles pr
    JOIN files f ON f.file_id = pr.file_id
    LEFT JOIN LATERAL (
        SELECT COUNT(*)        AS n_levels,
               MIN(o.pressure) AS min_pressure,
               MAX(o.pressure) AS max_pressure
        FROM obs o WHERE o.profile_id = pr.profile_id
    ) agg ON true
    LEFT JOIN LATERAL (
        SELECT o.pressure, o.temperature, o.salinity
        FROM obs o
        WHERE o.profile_id = pr.profile_id
          AND o.pressure IS NOT NULL
          AND o.temperature IS NOT NULL
        ORDER BY o.pressure
        LIMIT 1
    ) surf ON true
)
"""

# ── Validation ──────────────────────────────────────────────────────────────

_FORBIDDEN_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|"
    r"EXECUTE|COPY|VACUUM|ANALYZE|LOCK|SET|RESET|CALL|DO|LISTEN|NOTIFY)\b",
    re.IGNORECASE,
)

# Anything that could escape the CTE shadowing or touch server internals.
_SCHEMA_QUALIFIED_RE = re.compile(
    r"\b(public|pg_catalog|information_schema|pg_temp\w*)\s*\.", re.IGNORECASE
)
_CATALOG_RE = re.compile(
    r"\b(pg_\w+|information_schema|dblink\w*|lo_\w+|current_setting|set_config)\b",
    re.IGNORECASE,
)


def strip_sql_comments_and_strings(sql: str) -> str:
    """Remove string literals and comments so keyword checks don't
    false-positive on e.g. WHERE note = 'do not update'."""
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    sql = re.sub(r"'(?:''|[^'])*'", "''", sql)
    return sql


def validate_agent_sql(sql: str) -> str | None:
    """Return an error message if the agent query is not allowed, else None.

    `sql` must already be cleaned (fences/semicolons stripped).
    """
    if not sql.strip():
        return "Empty query."

    bare = strip_sql_comments_and_strings(sql)

    first_word = bare.lstrip("( \t\n").split()[0].upper() if bare.strip() else ""
    if first_word not in ("SELECT", "WITH"):
        return "Only SELECT queries are allowed."

    if ";" in bare:
        return "Only a single SELECT statement is allowed."

    if _FORBIDDEN_KEYWORDS.search(bare):
        return "Only SELECT queries are allowed."

    if _SCHEMA_QUALIFIED_RE.search(bare):
        return (
            "Schema-qualified names (public., pg_catalog., information_schema.) "
            "are not allowed. Query obs, profile_summary, files, profiles, "
            "measurements or project_parameters directly by name."
        )

    if _CATALOG_RE.search(bare):
        return "System catalog / server functions are not allowed."

    return None


def build_scoped_query(agent_sql: str, query_limit: int) -> str:
    """Wrap a validated agent query in the project-scoped CTE layer.

    The returned SQL uses the named psycopg2 parameter ``%(pid)s``; execute it
    with ``{"pid": project_id}``. Literal ``%`` in the agent query (modulo,
    LIKE patterns) is escaped so psycopg2 does not treat it as a placeholder.
    The row limit is applied to the outermost query so LIMITs inside the
    agent's own CTEs/subqueries cannot bypass it.
    """
    body = agent_sql.replace("%", "%%")
    body = body.replace(PROJECT_PLACEHOLDER, f"%({PROJECT_PARAM})s")
    return (
        f"{SCOPED_CTES}"
        f"SELECT * FROM (\n{body}\n) AS _agent_query\n"
        f"LIMIT {int(query_limit)}"
    )
