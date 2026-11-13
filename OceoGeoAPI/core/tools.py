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
from core.scoped_sql import PROJECT_PARAM, build_scoped_query, validate_agent_sql
from services.NeondbService import NeonDBService

logger = logging.getLogger(__name__)

# Per-query server-side timeout for agent SQL.
STATEMENT_TIMEOUT_MS = 15000

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
            "Execute a read-only SQL SELECT query against the current project's "
            "oceanographic data. All tables (obs, profile_summary, files, "
            "profiles, measurements, project_parameters) are already scoped to "
            "the current project — no project filter is needed. Returns JSON with: "
            "result_id (a handle to reference this result in create_visualization_spec), "
            "row_count, columns (list of {id, type}), and sample_rows (a small "
            "preview). On failure returns {error}; read it, fix the query, and "
            "call this tool again."
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

        # ── 1. Statement-level validation (SELECT only, no scope escapes) ───
        validation_error = validate_agent_sql(cleaned)
        if validation_error:
            # Write/DDL attempts are not worth a retry; scope escapes are
            # (the model can rewrite against the scoped tables).
            retryable = validation_error != "Only SELECT queries are allowed."
            return json.dumps({"error": validation_error, "retryable": retryable})

        # ── 2. JSONB validation (§3.4) ──────────────────────────────────────
        jsonb_errors = _validate_jsonb_access(cleaned, params_set)
        if jsonb_errors:
            return json.dumps(
                {"error": "JSONB validation failed: " + " ".join(jsonb_errors),
                 "retryable": True}
            )

        # ── 3. Wrap in the project-scoped CTE layer + outer row limit ───────
        scoped_query = build_scoped_query(cleaned, QUERY_LIMIT)
        params = {PROJECT_PARAM: project_id}

        # ── 4. Verify ownership, then execute read-only with a timeout ──────
        try:
            with db.get_connection() as conn:
                # Session guards + ownership check on a throwaway cursor.
                # SET TRANSACTION must run before any other statement.
                with conn.cursor() as verify_cur:
                    verify_cur.execute("SET TRANSACTION READ ONLY", ())
                    verify_cur.execute(
                        f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}", ()
                    )
                    db.verify_project_ownership(verify_cur, project_id, user_id)

                with conn.cursor(
                    cursor_factory=psycopg2.extras.RealDictCursor
                ) as cur:
                    cur.execute(scoped_query, params)
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
            return json.dumps({"error": str(exc), "retryable": False})
        except PermissionError as exc:
            return json.dumps({"error": str(exc), "retryable": False})
        except psycopg2.errors.QueryCanceled:
            logger.warning("SQL statement timed out")
            return json.dumps({
                "error": (
                    f"Query exceeded the {STATEMENT_TIMEOUT_MS // 1000}s time limit. "
                    "Aggregate or filter more (e.g. GROUP BY bins, fewer cycles)."
                ),
                "retryable": True,
            })
        except psycopg2.Error as exc:
            logger.warning("SQL database error: %s", exc)
            detail = (getattr(exc, "pgerror", None) or str(exc)).strip()
            error_type = exc.__class__.__name__
            if detail:
                return json.dumps({"error": f"{error_type}: {detail}", "retryable": True})
            return json.dumps({
                "error": f"{error_type}: Failed to execute query.",
                "retryable": True,
            })
        except Exception:
            logger.exception("SQL tool error")
            return json.dumps({
                "error": "Failed to execute query. Please try rephrasing your question.",
                "retryable": False,
            })

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

def tool_calls(response, tool_name: str) -> list[tuple[dict | None, dict | None]]:
    """All calls to `tool_name` in order, as (args, parsed_result) pairs.
    Unparseable args/results come back as None."""
    out: list[tuple[dict | None, dict | None]] = []
    for tu in getattr(response, "tools", None) or []:
        name = getattr(tu, "tool_name", None) or getattr(tu, "tool", None) or getattr(tu, "name", None)
        if name != tool_name:
            continue
        args = getattr(tu, "tool_args", None)
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except (json.JSONDecodeError, TypeError):
                args = None
        result = getattr(tu, "result", None)
        try:
            parsed = json.loads(result) if result else None
        except (json.JSONDecodeError, TypeError):
            parsed = None
        out.append((args if isinstance(args, dict) else None,
                    parsed if isinstance(parsed, dict) else None))
    return out


def extract_tool_result(response, tool_name: str, *, last: bool = False) -> dict | None:
    """Walk an Agno `response.tools` list and return the parsed JSON result
    for the first (or, with ``last=True``, the final) tool call named
    `tool_name`. Returns None if not found.

    ``last=True`` matters when the agent self-corrects within one run: the
    first run_sql_query call may have errored and a later one succeeded.

    Agno tool-use objects expose `.tool_name` (or `.tool`), `.result` (str),
    and `.tool_args` (dict|str). We are lenient about attribute names so this
    works across Agno versions.
    """
    tools = list(getattr(response, "tools", None) or [])
    if last:
        tools.reverse()
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


def extract_tool_args(response, tool_name: str, *, last: bool = False) -> dict | None:
    """Return the tool_args dict for the first (or final, with ``last=True``)
    tool call named `tool_name`."""
    tools = list(getattr(response, "tools", None) or [])
    if last:
        tools.reverse()
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
