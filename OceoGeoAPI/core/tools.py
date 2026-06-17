import json
import re
import logging

from agno.tools import tool

from services.NeondbService import NeonDBService

logger = logging.getLogger(__name__)

# Statements that must never appear in a query from the agent
_FORBIDDEN_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE)\b",
    re.IGNORECASE,
)

# Matches a bare language tag on its own line, e.g. "sql" or "SQL" at the start
_LANG_TAG_RE = re.compile(r"^[ \t]*(sql|SQL)\s*\n")


def _clean_sql_query(query: str) -> str:
    """
    Sanitise a raw SQL string produced by an LLM before execution.

    Handles the following common formatting artefacts:
    - Literal ``\\n`` escape sequences  (e.g. ``sql\\nSELECT ...\\n``)
    - Markdown code fences: ```sql ... ``` or ``` ... ```
    - Bare language tags:  a line containing only "sql" before the query
    - Leading / trailing whitespace and stray semicolons
    - Collapsed whitespace inside the query (tabs → spaces, multi-space → single space)

    Returns a clean, single-statement SQL string ready for parameterisation.
    """
    cleaned = query.strip()

    # ── 1. Unescape literal \n / \t sequences the LLM may have emitted ───────
    #       e.g.  "sql\nSELECT *\nFROM t\n"  →  "sql\nSELECT *\nFROM t\n"
    if r"\n" in cleaned:
        cleaned = cleaned.replace(r"\n", "\n").replace(r"\t", "\t")

    # ── 2. Strip markdown code fences  (```sql … ```  or  ``` … ```) ─────────
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        # Drop the opening fence line (```sql or ```) and the closing ``` line
        lines = [ln for ln in lines if not ln.strip().startswith("```")]
        cleaned = "\n".join(lines).strip()

    # ── 3. Strip a bare language label on the very first line  ───────────────
    #       e.g.  "sql\nSELECT …"  →  "SELECT …"
    cleaned = _LANG_TAG_RE.sub("", cleaned).strip()

    # ── 4. Collapse internal whitespace (keep newlines for readability) ───────
    #       Replace tab characters with a single space
    cleaned = cleaned.replace("\t", " ")
    #       Collapse runs of spaces (but not newlines) to a single space
    cleaned = re.sub(r"[ ]{2,}", " ", cleaned)

    # ── 5. Strip a trailing semicolon – psycopg2 does not need it ────────────
    cleaned = cleaned.rstrip("; \t\n")

    return cleaned


def create_sql_tool(project_id: int, user_id: str, db: NeonDBService):
    """
    Factory that returns an Agno @tool function bound to a specific
    project_id / user_id.  The tool validates, scopes, and executes
    SELECT queries against NeonDB.
    """

    @tool(
        name="run_sql_query",
        description=(
            "Execute a read-only SQL SELECT query against the project's "
            "oceanographic database and return the result rows as JSON."
        ),
    )
    def run_sql_query(query: str) -> str:
        """Run a SELECT query and return JSON rows.

        Args:
            query: A valid PostgreSQL SELECT statement. Use {project_id}
                   as a placeholder for the current project.
        """
        # ── 1. Clean / normalise the raw LLM output ──────────────────
        cleaned = _clean_sql_query(query)
        logger.debug("Cleaned SQL: %s", cleaned)

        # ── 2. Block anything that is not a SELECT ───────────────────
        if _FORBIDDEN_KEYWORDS.search(cleaned):
            return json.dumps({"error": "Only SELECT queries are allowed."})

        # Rough check: first meaningful keyword must be SELECT / WITH
        first_word = cleaned.lstrip("( \t\n").split()[0].upper() if cleaned.strip() else ""
        if first_word not in ("SELECT", "WITH"):
            return json.dumps({"error": "Only SELECT queries are allowed."})

        # Block multiple statements (semicolon followed by another statement)
        statements = [s.strip() for s in cleaned.split(";") if s.strip()]
        if len(statements) > 1:
            return json.dumps({"error": "Only a single SELECT statement is allowed."})

        # ── 3. Substitute {project_id} safely via psycopg2 params ────
        # Replace the placeholder with a psycopg2 parameter marker
        parameterized = cleaned.replace("{project_id}", "%s")
        params = []
        # Count how many %s we introduced (one per {project_id} occurrence)
        count = cleaned.count("{project_id}")
        params = tuple([project_id] * count) if count else ()

        # ── 4. Add a default LIMIT if none present ───────────────────
        if not re.search(r"\bLIMIT\b", parameterized, re.IGNORECASE):
            parameterized = parameterized.rstrip("; \t\n") + " LIMIT 100"

        # ── 5. Verify ownership, then execute ────────────────────────
        try:
            with db.get_connection() as conn:
                cursor = conn.cursor()
                db.verify_project_ownership(cursor, project_id, user_id)

            rows = db.execute_select(parameterized, params)
            return json.dumps(rows, default=str)
        except LookupError as exc:
            return json.dumps({"error": str(exc)})
        except PermissionError as exc:
            return json.dumps({"error": str(exc)})
        except Exception as exc:
            logger.exception("SQL tool error")
            return json.dumps({"error": "Failed to execute query. Please try rephrasing your question."})

    return run_sql_query


# ── Sample Tools for Multi-Tool Demo ────────────────────────────────────────

def create_initialize_context_tool(project_id: int, user_id: str):
    """
    MANDATORY FIRST TOOL: Initializes the analysis context.
    Must be called before any other tool in this agent.
    Returns a context token that subsequent tools require.
    """

    @tool(
        name="initialize_context",
        description=(
            "MANDATORY FIRST STEP: Initialize the analysis context for this project. "
            "Call this BEFORE any other tool. Returns a context_token required by subsequent tools. "
            "Use this to set up project-specific parameters, validate access, and establish the analysis scope."
        ),
    )
    def initialize_context(analysis_type: str) -> str:
        """Initialize analysis context.

        Args:
            analysis_type: Type of analysis to perform (e.g., "temperature_profile", "salinity_trend", "mixed_layer")
        """
        logger.info(f"[initialize_context] Called with analysis_type={analysis_type}, project_id={project_id}")
        
        context_token = f"ctx_{project_id}_{analysis_type}_{user_id[:8]}"
        
        return json.dumps({
            "context_token": context_token,
            "project_id": project_id,
            "analysis_type": analysis_type,
            "status": "initialized",
            "message": f"Context initialized for {analysis_type}. Use this context_token in subsequent tool calls."
        })

    return initialize_context


def create_process_data_tool(project_id: int, user_id: str):
    """
    SECOND TOOL: Processes data using the context token from initialize_context.
    Requires the context_token from the first tool call.
    """

    @tool(
        name="process_data",
        description=(
            "Process oceanographic data using the initialized context. "
            "REQUIRES context_token from initialize_context tool. "
            "Returns processed results based on the analysis type."
        ),
    )
    def process_data(context_token: str, parameters: str = "{}") -> str:
        """Process data with initialized context.

        Args:
            context_token: The context_token returned by initialize_context (REQUIRED)
            parameters: JSON string with analysis parameters (optional)
        """
        logger.info(f"[process_data] Called with context_token={context_token}, parameters={parameters}")
        
        try:
            params = json.loads(parameters) if parameters else {}
        except json.JSONDecodeError:
            params = {}
        
        if not context_token or not context_token.startswith("ctx_"):
            return json.dumps({"error": "Invalid or missing context_token. Call initialize_context first."})
        
        try:
            _, ctx_project_id, analysis_type, _ = context_token.split("_", 3)
            ctx_project_id = int(ctx_project_id)
        except (ValueError, IndexError):
            return json.dumps({"error": "Invalid context_token format."})
        
        if ctx_project_id != project_id:
            return json.dumps({"error": "Context token project mismatch."})
        
        mock_results = {
            "temperature_profile": {
                "depth_levels": [0, 50, 100, 200, 500, 1000, 2000],
                "temperatures": [24.5, 22.1, 18.3, 12.7, 6.2, 3.8, 2.1],
                "unit": "°C",
                "summary": "Typical thermocline structure with surface warming"
            },
            "salinity_trend": {
                "depth_levels": [0, 50, 100, 200, 500, 1000],
                "salinities": [35.2, 35.5, 35.8, 36.1, 34.9, 34.7],
                "unit": "PSU",
                "summary": "Subsurface salinity maximum at 200m"
            },
            "mixed_layer": {
                "mixed_layer_depth": 45,
                "temperature_at_mld": 21.8,
                "unit": "meters",
                "summary": "Shallow mixed layer indicating strong stratification"
            }
        }
        
        # Extract analysis_type from context_token
        try:
            _, _, analysis_type, _ = context_token.split("_", 3)
        except (ValueError, IndexError):
            analysis_type = "temperature_profile"
        
        result = mock_results.get(analysis_type, mock_results["temperature_profile"])
        result["context_token"] = context_token
        result["parameters_used"] = params
        
        return json.dumps(result)

    return process_data