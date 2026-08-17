import json
import logging

from agno.agent import Agent
from agno.models.openrouter import OpenRouter

from config import OPENROUTER_API_KEY, OPENROUTER_MODEL
from core.chart_payload import (
    GLOBAL_RESULT_STORE,
    ChartPayloadService,
    ChartSpecError,
    ResultStore,
)
from core.glossary import GLOSSARY
from core.tools import (
    create_sql_tool,
    create_visualization_spec_tool,
    extract_tool_args,
    extract_tool_result,
)
from services.NeondbService import NeonDBService

logger = logging.getLogger(__name__)

# Display limit for the rows we pass through to the frontend / persist as
# messages.sql_data preview. ChartPayloadService applies its own display_limit
# when composing the chart payload; this is the cap for the raw `data` field
# in the chat response.
_MESSAGE_PREVIEW_LIMIT = 100


def make_openrouter_model(max_tokens: int) -> OpenRouter:
    return OpenRouter(
        api_key=OPENROUTER_API_KEY,
        id=OPENROUTER_MODEL,
        max_tokens=max_tokens,
        timeout=30.0,
        retries=2,
        delay_between_retries=1,
        exponential_backoff=True,
    )


def classify_intent(message: str, system_message: str) -> str:
    """Use a lightweight agent to classify the user message as
    SQL, DOMAIN, CONTEXT, or OFF_TOPIC."""
    agent = Agent(
        model=make_openrouter_model(10),
        system_message=system_message,
        markdown=False,
    )
    response = agent.run(message)
    raw = (response.content or "").strip().upper()

    for label in ("SQL", "CONTEXT", "DOMAIN", "OFF_TOPIC"):
        if label in raw:
            return label
    return "OFF_TOPIC"


def _format_available_params(params: list[str]) -> str:
    """Render the {available_params} placeholder value for sql_prompt.md."""
    if not params:
        return (
            "none (this project has no BGC / extras parameters; "
            "do not use extras->>'...' accessors)"
        )
    return ", ".join(params)


def _inject_available_params(system_message: str, params: list[str]) -> str:
    """Replace the {available_params} placeholder in the SQL prompt with the
    project's current extras parameter list."""
    return system_message.replace(
        "{available_params}", _format_available_params(params)
    )


def run_sql_agent(
    message: str,
    user_id: str,
    project_id: int,
    system_message: str,
    db: NeonDBService,
    *,
    result_store: ResultStore | None = None,
    chart_payload_service: ChartPayloadService | None = None,
) -> dict:
    """Generate a SQL query via the agent, execute it through the SQL tool,
    optionally produce a chart_spec, and compose a chart_payload outside the
    agent frame.

    Returns a dict with keys:
        query: str           — the SQL that was executed
        data: list[dict]     — display/message-preview-limited rows
        summary: str         — natural-language summary of the results
        result_id: str|None  — runtime handle for the SQL result
        columns: list[dict]  — column metadata [{"id","type"}]
        row_count: int       — total rows returned by SQL
        chart_spec: dict|None — raw spec from create_visualization_spec
        chart_payload: dict|None — validated {spec, data, meta} or None
    """
    store = result_store if result_store is not None else GLOBAL_RESULT_STORE
    chart_service = chart_payload_service or ChartPayloadService(store)

    # ── 1. Inject available extras parameters into the system prompt ────────
    try:
        available_params = db.get_project_parameters(project_id)
    except Exception:
        logger.exception("Failed to fetch project_parameters; assuming none")
        available_params = []
    system_message_injected = _inject_available_params(
        system_message, available_params
    )

    # ── 2. Build tools bound to this project / result store ─────────────────
    sql_tool = create_sql_tool(
        project_id, user_id, db,
        available_params=available_params,
        result_store=store,
    )
    viz_tool = create_visualization_spec_tool()

    agent = Agent(
        model=make_openrouter_model(500),
        system_message=system_message_injected,
        tools=[sql_tool, viz_tool],
        markdown=False,
    )

    response = agent.run(message)
    content = (response.content or "").strip()

    # ── 3. Extract the SQL tool result (result_id + columns + sample) ───────
    sql_result = extract_tool_result(response, "run_sql_query")

    query = ""
    data: list[dict] = []
    result_id = None
    columns: list[dict] = []
    row_count = 0
    sql_error = None

    if sql_result:
        if "error" in sql_result:
            sql_error = sql_result["error"]
            # The query may still be retrievable from tool_args; try below.
        else:
            result_id = sql_result.get("result_id")
            columns = sql_result.get("columns", [])
            row_count = sql_result.get("row_count", 0)
            # Pull display-limited rows from the store (not the sample).
            if result_id:
                stored = store.get(result_id)
                if stored:
                    data = stored["rows"][:_MESSAGE_PREVIEW_LIMIT]

    # Try to recover the query text from tool_args even on error.
    if sql_result is None:
        # No tool call happened — the agent may have returned raw SQL as text.
        # Treat the content as a SQL query and run it manually via the tool fn.
        if content and not content.startswith("{") and not content.startswith("```"):
            # Heuristic: looks like SQL if it starts with SELECT/WITH.
            first_word = content.lstrip("( \t\n").split()[0].upper() \
                if content.strip() else ""
            if first_word in ("SELECT", "WITH"):
                tool_result_str = sql_tool.entrypoint(query=content) \
                    if hasattr(sql_tool, "entrypoint") else None
                if tool_result_str:
                    try:
                        sql_result = json.loads(tool_result_str)
                    except (json.JSONDecodeError, TypeError):
                        sql_result = None
                    if sql_result and "error" in sql_result:
                        sql_error = sql_result["error"]
                    elif sql_result:
                        result_id = sql_result.get("result_id")
                        columns = sql_result.get("columns", [])
                        row_count = sql_result.get("row_count", 0)
                        if result_id:
                            stored = store.get(result_id)
                            if stored:
                                data = stored["rows"][:_MESSAGE_PREVIEW_LIMIT]
                query = content

    # Recover query from tool_args if we still don't have it.
    if not query:
        args = extract_tool_args(response, "run_sql_query")
        if args and isinstance(args.get("query"), str):
            query = args["query"]

    # ── 4. Surface SQL errors immediately ───────────────────────────────────
    if sql_error:
        return {
            "query": query,
            "data": [],
            "summary": f"Error: {sql_error}",
            "result_id": result_id,
            "columns": columns,
            "row_count": row_count,
            "chart_spec": None,
            "chart_payload": None,
        }

    # ── 5. Extract chart_spec from create_visualization_spec tool ───────────
    chart_spec = None
    viz_result = extract_tool_result(response, "create_visualization_spec")
    if viz_result and viz_result.get("status") == "ok":
        chart_spec = viz_result.get("chart_spec")
    elif viz_result and viz_result.get("status") == "error":
        logger.warning("create_visualization_spec rejected: %s",
                       viz_result.get("error"))

    # ── 6. Compose chart_payload outside the agent frame ────────────────────
    chart_payload = None
    if chart_spec:
        try:
            chart_payload = chart_service.build(chart_spec)
        except ChartSpecError as exc:
            logger.warning("Chart spec rejected by ChartPayloadService: %s", exc)
            chart_payload = None
            # Keep chart_spec in the response for debugging, but no payload.

    # ── 7. Generate a natural-language summary of the results ───────────────
    summary = content
    if data:
        summary_agent = Agent(
            model=make_openrouter_model(500),
            system_message=(
                "You are a helpful oceanographic data analyst. "
                "Summarize the following SQL query results in clear, concise "
                "natural language. Use proper units where applicable "
                "(°C for temperature, PSU for salinity, dbar for pressure). "
                "Do not output SQL or JSON — only a human-readable summary. "
                "If the data is for a chart, briefly mention what the chart "
                "shows but do not list every value."
            ),
            markdown=True,
        )
        summary_response = summary_agent.run(
            f"User question: {message}\n\n"
            f"Query results (JSON, first {_MESSAGE_PREVIEW_LIMIT} rows):\n"
            f"{json.dumps(data, default=str)}"
        )
        summary = (summary_response.content or content).strip()

    return {
        "query": query,
        "data": data,
        "summary": summary,
        "result_id": result_id,
        "columns": columns,
        "row_count": row_count,
        "chart_spec": chart_spec,
        "chart_payload": chart_payload,
    }


def run_domain_agent(message: str, system_message: str) -> str:
    """Answer a general oceanographic / geospatial question."""
    agent = Agent(
        model=make_openrouter_model(1000),
        system_message=system_message,
        markdown=True,
    )
    response = agent.run(message)
    return (response.content or "").strip()


def run_context_agent(message: str, context: dict | None, system_message: str) -> str:
    """Answer a question about a specific variable or chart pattern using the
    Ground Truth glossary."""

    glossary_str = "GLOSSARY GROUND TRUTH:\n"
    for var, details in GLOSSARY.items():
        glossary_str += (
            f"- {var.upper()} ({details['unit']}): "
            f"{details['physical_meaning']}\n"
        )
        glossary_str += (
            f"  Typical ranges: "
            f"{details.get('typical_surface_range', '')} / "
            f"{details.get('typical_deep_range', '')} / "
            f"{details.get('typical_open_ocean_range', '')} / "
            f"{details.get('typical_argo_range', '')}\n"
        )
        glossary_str += f"  Anomalies: {details.get('anomaly_note', '')}\n"

    view_state_str = "\nCURRENT VIEW STATE:\n"
    if context:
        view_state_str += json.dumps(context, indent=2)
    else:
        view_state_str += "None provided."

    full_system_prompt = system_message + "\n\n" + glossary_str + view_state_str

    agent = Agent(
        model=make_openrouter_model(1000),
        system_message=full_system_prompt,
        markdown=True,
    )

    response = agent.run(message)
    return (response.content or "").strip()
