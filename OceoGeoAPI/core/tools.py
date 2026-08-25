import json
import logging
import re

import psycopg2.extras
from agno.tools import tool

from core.chart_payload import (
    GLOBAL_RESULT_STORE,
    ResultStore,
    build_columns,
)
from services.NeondbService import NeonDBService

logger = logging.getLogger(__name__)

# Statements that must never appear in a query from the agent
_FORBIDDEN_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE)\b",
    re.IGNORECASE,
)

# Matches a bare language tag on its own line, e.g. "sql" or "SQL" at the start
_LANG_TAG_RE = re.compile(r"^[ \t]*(sql|SQL)\s*\n")

# ── Row / display limits (see implementation_plan.md §3.3) ──────────────────
# Values chosen at the conservative end of the suggested ranges. Tunable.
QUERY_LIMIT = 5000          # hard cap on rows fetched from Postgres
MODEL_SAMPLE_LIMIT = 20     # rows shown to the model in the tool result
DISPLAY_LIMIT = 500         # rows sent to the frontend / chart payload
MESSAGE_PREVIEW_LIMIT = 100  # rows persisted to messages.sql_data for history

# ── JSONB validation ────────────────────────────────────────────────────────
# Matches extras->>'KEY' (or extras->'KEY') and captures KEY.
_JSONB_ACCESS_RE = re.compile(r"extras\s*->>?\s*'([A-Za-z0-9_]+)'")

# Suffixes that may follow a base parameter name in extras JSONB keys.
# Order matters: longest first, so e.g. "DOXY_ADJUSTED_QC" matches
# "_ADJUSTED_QC" rather than "_QC" and reduces to "DOXY".
_PARAM_SUFFIXES = (
    "_ADJUSTED_ERROR",
    "_ADJUSTED_QC",
    "_ADJUSTED",
    "_QC",
)

# Core typed columns — must be queried as columns, never via extras->>'...'.
# Stored UPPERCASE to compare against UPPERCASE JSONB keys the agent might emit.
_CORE_PARAM_BASES = {"PRES", "TEMP", "PSAL"}

# Casts that satisfy the "always cast JSONB text" rule.
_VALID_CASTS = ("::float", "::int", "::integer", "::numeric", "::bigint",
                "::smallint", "::real", "::double precision", "::decimal")


def _clean_sql_query(query: str) -> str:
    """
    Sanitise a raw SQL string produced by an LLM before execution.

    Handles the following common formatting artefacts:
    - Literal ``\\n`` escape sequences  (e.g. ``sql\\nSELECT ...\\n``)
    - Markdown code fences: ```sql ... ``` or ``` ... ```
    - Bare language tags:  a line containing only "sql" before the query
    - Leading / trailing whitespace and stray semicolons
    - Collapsed whitespace inside the query (tabs → spaces, multi-space → single)

    Returns a clean, single-statement SQL string ready for parameterisation.
    """
    cleaned = query.strip()

    # ── 1. Unescape literal \n / \t sequences the LLM may have emitted ───────
    if r"\n" in cleaned:
        cleaned = cleaned.replace(r"\n", "\n").replace(r"\t", "\t")

    # ── 2. Strip markdown code fences  (```sql … ```  or  ``` … ```) ─────────
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        lines = [ln for ln in lines if not ln.strip().startswith("```")]
        cleaned = "\n".join(lines).strip()

    # ── 3. Strip a bare language label on the very first line  ───────────────
    cleaned = _LANG_TAG_RE.sub("", cleaned).strip()

    # ── 4. Collapse internal whitespace (keep newlines for readability) ───────
    cleaned = cleaned.replace("\t", " ")
    cleaned = re.sub(r"[ ]{2,}", " ", cleaned)

    # ── 5. Strip a trailing semicolon – psycopg2 does not need it ────────────
    cleaned = cleaned.rstrip("; \t\n")

    return cleaned


def _strip_param_suffix(key: str) -> str:
    """Return the base parameter name for a JSONB key.

    'DOXY' -> 'DOXY'
    'DOXY_QC' -> 'DOXY'
    'DOXY_ADJUSTED' -> 'DOXY'
    'DOXY_ADJUSTED_QC' -> 'DOXY'
    'DOXY_ADJUSTED_ERROR' -> 'DOXY'
    """
    for suffix in _PARAM_SUFFIXES:
        if key.endswith(suffix):
            return key[: -len(suffix)]
    return key


def _validate_jsonb_access(cleaned: str, available_params: set[str] | None) -> list[str]:
    """Run JSONB validation rules from implementation_plan.md §3.4.

    Returns a list of human-readable error strings (empty = valid).
    `available_params` is the set of base parameter names registered in
    project_parameters for the current project.
    """
    errors: list[str] = []

    # Find every extras->>'KEY' / extras->'KEY' occurrence with its position,
    # so we can check the surrounding text for a cast.
    for match in re.finditer(r"extras\s*(->>|->)\s*'([A-Za-z0-9_]+)'", cleaned):
        operator = match.group(1)
        key = match.group(2)
        end = match.end()

        # Rule 1: uppercase keys
        if key != key.upper():
            errors.append(
                f"JSONB key {key!r} must be UPPERCASE (use {key.upper()!r})."
            )

        # Rule 2: no core params via JSONB
        base = _strip_param_suffix(key)
        if base in _CORE_PARAM_BASES:
            errors.append(
                f"Core parameter {key!r} must be queried via its typed column, "
                f"not via extras JSONB."
            )
            continue  # skip further checks for this token

        # Rule 3: no hallucinated keys.
        # available_params is None  → fetch failed; skip this check.
        # available_params is empty → project has no BGC params; reject any key.
        # available_params is non-empty → reject keys not in the set.
        if available_params is not None and base not in available_params:
            errors.append(
                f"JSONB key {key!r} is not a known extras parameter for this "
                f"project. Available: {sorted(available_params)}."
            )

        # Rule 4: always cast (only enforce for ->>, the scalar text accessor)
        if operator == "->>":
            tail = cleaned[end:end + 40]
            if not any(cast in tail for cast in _VALID_CASTS):
                errors.append(
                    f"JSONB accessor extras->>'{key}' must be followed by a cast "
                    f"(e.g. ::float or ::int)."
                )

    return errors


def _cap_user_limit(cleaned: str) -> str:
    """If the query has a LIMIT N where N > QUERY_LIMIT, cap it. If it has no
    LIMIT, add one. Operates on the cleaned query string.
    """
    match = re.search(r"\bLIMIT\s+(\d+)\b", cleaned, re.IGNORECASE)
    if match:
        n = int(match.group(1))
        if n > QUERY_LIMIT:
            cleaned = (
                cleaned[: match.start()]
                + f"LIMIT {QUERY_LIMIT}"
                + cleaned[match.end():]
            )
        return cleaned

    # No LIMIT present — append one.
    return cleaned.rstrip("; \t\n") + f" LIMIT {QUERY_LIMIT}"


def create_sql_tool(
    project_id: int,
    user_id: str,
    db: NeonDBService,
    *,
    available_params: list[str] | None = None,
    result_store: ResultStore | None = None,
):
    """Factory that returns an Agno @tool function bound to a specific
    project_id / user_id.

    Args:
        project_id: scoped project for the query (FK-filtered).
        user_id: Clerk user id; used for ownership verification.
        db: NeonDBService instance.
        available_params: base parameter names from project_parameters
            for this project. Used to validate extras->>'...' keys and
            reject hallucinated parameters.
        result_store: where to store the display-limited rows under a
            runtime result_id. Defaults to the module-level singleton.
    """

    store = result_store if result_store is not None else GLOBAL_RESULT_STORE
    # None = parameter fetch failed → skip JSONB key validation to avoid
    # false-rejecting legitimate queries. Empty set = project has no BGC
    # parameters → reject any extras->>'...' accessor (hallucinated keys).
    params_set: set[str] | None = (
        None if available_params is None
        else {p.upper() for p in available_params}
    )

    @tool(
        name="run_sql_query",
        description=(
            "Execute a read-only SQL SELECT query against the project's "
            "oceanographic database. Returns a JSON object with: "
            "result_id (a handle to reference this result in create_visualization_spec), "
            "row_count (total rows returned by SQL), "
            "columns (list of {id, type}), and "
            "sample_rows (a small preview, do not rely on it for full data). "
            "Use {project_id} as a placeholder for the current project; it is "
            "substituted safely."
        ),
    )
    def run_sql_query(query: str) -> str:
        """Run a scoped SELECT query and return a result handle + metadata.

        Args:
            query: A valid PostgreSQL SELECT statement. Use {project_id} as a
                   placeholder for the current project.
        """
        cleaned = _clean_sql_query(query)
        logger.debug("Cleaned SQL: %s", cleaned)

        # ── 1. Block anything that is not a SELECT/WITH ─────────────────────
        if _FORBIDDEN_KEYWORDS.search(cleaned):
            return json.dumps({"error": "Only SELECT queries are allowed."})

        first_word = (
            cleaned.lstrip("( \t\n").split()[0].upper()
            if cleaned.strip() else ""
        )
        if first_word not in ("SELECT", "WITH"):
            return json.dumps({"error": "Only SELECT queries are allowed."})

        statements = [s.strip() for s in cleaned.split(";") if s.strip()]
        if len(statements) > 1:
            return json.dumps(
                {"error": "Only a single SELECT statement is allowed."}
            )

        # ── 2. JSONB validation (§3.4) ──────────────────────────────────────
        jsonb_errors = _validate_jsonb_access(cleaned, params_set)
        if jsonb_errors:
            return json.dumps(
                {"error": "JSONB validation failed: " + " ".join(jsonb_errors)}
            )

        # ── 3. Substitute {project_id} safely via psycopg2 params ───────────
        parameterized = cleaned.replace("{project_id}", "%s")
        count = cleaned.count("{project_id}")
        params = tuple([project_id] * count) if count else ()

        # ── 4. Enforce row limit (cap or add) ───────────────────────────────
        parameterized = _cap_user_limit(parameterized)

        # ── 5. Verify ownership, then execute ───────────────────────────────
        try:
            with db.get_connection() as conn:
                # Ownership check on a throwaway cursor.
                with conn.cursor() as verify_cur:
                    db.verify_project_ownership(verify_cur, project_id, user_id)

                with conn.cursor(
                    cursor_factory=psycopg2.extras.RealDictCursor
                ) as cur:
                    cur.execute(parameterized, params)
                    rows = [dict(r) for r in cur.fetchall()]
                    columns = build_columns(cur.description)

            # ── 6. Store display-limited rows under a result_id ──────────────
            result_id = store.put(
                rows=rows,
                columns=columns,
                row_count=len(rows),
                sql_query=cleaned,
            )

            # ── 7. Return metadata + small sample to the model ───────────────
            return json.dumps(
                {
                    "result_id": result_id,
                    "row_count": len(rows),
                    "columns": columns,
                    "sample_rows": rows[:MODEL_SAMPLE_LIMIT],
                },
                default=str,
            )
        except LookupError as exc:
            return json.dumps({"error": str(exc)})
        except PermissionError as exc:
            return json.dumps({"error": str(exc)})
        except psycopg2.Error as exc:
            logger.exception("SQL database error")
            detail = (getattr(exc, "pgerror", None) or str(exc)).strip()
            error_type = exc.__class__.__name__
            if detail:
                return json.dumps({"error": f"{error_type}: {detail}"})
            return json.dumps({"error": f"{error_type}: Failed to execute query."})
        except Exception:
            logger.exception("SQL tool error")
            return json.dumps(
                {"error": "Failed to execute query. Please try rephrasing your question."}
            )

    return run_sql_query


def create_visualization_spec_tool():
    """Factory that returns the `create_visualization_spec` Agno @tool.

    This tool ONLY captures the model's chart decision — it does not receive
    data and does not render anything. Validation and data merging happen in
    backend application code (ChartPayloadService), outside the agent frame.

    The tool returns the parsed spec back to the agent as JSON so the agent's
    downstream summary step can reference it. The chatbot layer extracts the
    spec from the tool-call result and passes it to ChartPayloadService.
    """

    @tool(
        name="create_visualization_spec",
        description=(
            "Declare how an existing SQL result should be visualized. "
            "Only call this when the user asked for a plot/chart/visualization "
            "or the question implies one (e.g. 'show me X vs Y', 'distribution "
            "of X'). Do NOT call it for pure numeric answers like averages or "
            "counts. The spec.encoding field values MUST exactly match column "
            "ids returned in the run_sql_query result metadata."
        ),
    )
    def create_visualization_spec(spec: str) -> str:
        """Declare a chart specification referencing an existing SQL result.

        Args:
            spec: JSON string matching the ChartSpec schema. Must include a
                  result_id that was returned by run_sql_query.
        """
        try:
            parsed = json.loads(spec)
        except json.JSONDecodeError as exc:
            return json.dumps(
                {"status": "error", "error": f"Invalid JSON spec: {exc}"}
            )

        if not isinstance(parsed, dict):
            return json.dumps(
                {"status": "error", "error": "Chart spec must be a JSON object."}
            )

        # Light structural validation here; full column-reference validation
        # happens in ChartPayloadService.build() once we look up the result.
        required = {"result_id", "chart_type", "title"}
        missing = required - set(parsed.keys())
        if missing:
            return json.dumps(
                {"status": "error", "error": f"Missing fields: {sorted(missing)}"}
            )

        return json.dumps({"status": "ok", "chart_spec": parsed})

    return create_visualization_spec


# ── Helper for tests / chatbot to extract a tool result by name ──────────────

def extract_tool_result(response, tool_name: str) -> dict | None:
    """Walk an Agno `response.tools` list and return the parsed JSON result
    for the first tool call named `tool_name`. Returns None if not found.

    Agno tool-use objects expose `.tool_name` (or `.tool`), `.result` (str),
    and `.tool_args` (dict|str). We are lenient about attribute names so this
    works across Agno versions.
    """
    tools = getattr(response, "tools", None) or []
    for tu in tools:
        name = (
            getattr(tu, "tool_name", None)
            or getattr(tu, "tool", None)
            or getattr(tu, "name", None)
        )
        if name != tool_name:
            continue
        result = getattr(tu, "result", None)
        if not result:
            continue
        try:
            parsed = json.loads(result)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def extract_tool_args(response, tool_name: str) -> dict | None:
    """Return the tool_args dict for the first tool call named `tool_name`."""
    tools = getattr(response, "tools", None) or []
    for tu in tools:
        name = (
            getattr(tu, "tool_name", None)
            or getattr(tu, "tool", None)
            or getattr(tu, "name", None)
        )
        if name != tool_name:
            continue
        args = getattr(tu, "tool_args", None)
        if isinstance(args, dict):
            return args
        if isinstance(args, str):
            try:
                parsed = json.loads(args)
                if isinstance(parsed, dict):
                    return parsed
            except (json.JSONDecodeError, TypeError):
                pass
    return None
