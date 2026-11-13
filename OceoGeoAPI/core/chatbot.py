import json
import logging

from agno.agent import Agent
from agno.models.base import Model
from agno.models.openai import OpenAIChat, OpenAIResponses
from agno.models.openrouter import OpenRouter

from config import (
    LLM_MODEL,
    LLM_PROVIDER,
    LLM_SQL_REASONING_EFFORT,
    OPENCODE_API_KEY,
    OPENCODE_BASE_URL,
    OPENROUTER_API_KEY,
)
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

# Reasoning models (e.g. openai/gpt-oss-*) spend completion tokens thinking
# before emitting content; undersized budgets truncate mid-reasoning and yield
# empty content. Every agent therefore gets generous headroom.
_INTENT_MAX_TOKENS = 800
_SQL_AGENT_MAX_TOKENS = 4000
_SUMMARY_MAX_TOKENS = 1500

# Reasoning effort per step, for providers/models that support it (OpenAI
# Responses API models such as muse-spark on OpenCode). Classification and
# summaries need little thought; SQL writing benefits from more. Lower effort
# is markedly faster. Override the SQL step with LLM_SQL_REASONING_EFFORT.
_INTENT_REASONING = "minimal"
_SQL_REASONING = LLM_SQL_REASONING_EFFORT
_SUMMARY_REASONING = "minimal"

# Self-correction: the agent may retry failed queries inside one run (bounded
# by tool_call_limit), and we re-prompt it with the error up to this many
# extra times if its run still ends on a failed query.
_SQL_CORRECTION_ATTEMPTS = 2
_SQL_TOOL_CALL_LIMIT = 6


class SQLAgentNoQueryError(RuntimeError):
    """Raised when the SQL agent does not produce an executable query."""


def _infer_chart_spec(message: str, result_id: str | None, columns: list[dict]) -> dict | None:
    """Best-effort chart spec fallback when the model ran SQL but skipped viz."""
    if not result_id:
        return None

    column_ids = [col.get("id") for col in columns if isinstance(col.get("id"), str)]
    column_set = set(column_ids)
    msg = message.lower()

    def first_available(candidates: tuple[str, ...]) -> str | None:
        for candidate in candidates:
            if candidate in column_set:
                return candidate
        return None

    if "histogram" in msg or "distribution" in msg:
        x = first_available(("salinity", "temperature", "pressure")) or (column_ids[0] if column_ids else None)
        if x:
            return {
                "result_id": result_id,
                "chart_type": "histogram",
                "title": f"Distribution of {x.replace('_', ' ').title()}",
                "encoding": {"x": x},
            }

    if "scatter" in msg or " vs " in msg:
        if {"temperature", "salinity"}.issubset(column_set):
            return {
                "result_id": result_id,
                "chart_type": "scatter",
                "title": "Salinity vs Temperature",
                "encoding": {"x": "temperature", "y": "salinity"},
                "labels": {"x": "Temperature (°C)", "y": "Salinity (PSU)"},
            }

    if "line" in msg or "separate line" in msg:
        x = first_available(("pressure", "observed_at", "observation_date"))
        y = first_available(("temperature", "avg_temperature", "salinity", "avg_salinity"))
        series = first_available(("profile_id", "cycle_number", "data_mode"))
        if x and y:
            spec = {
                "result_id": result_id,
                "chart_type": "line",
                "title": f"{y.replace('_', ' ').title()} vs {x.replace('_', ' ').title()}",
                "encoding": {"x": x, "y": y},
            }
            if series:
                spec["encoding"]["series"] = series
                spec["options"] = {"show_legend": True}
            if x == "pressure":
                spec["options"] = {**spec.get("options", {}), "invert_y": False}
            return spec

    if "bar" in msg:
        x = first_available(("data_mode", "file_type", "cycle_number")) or (column_ids[0] if column_ids else None)
        y = first_available(("profile_count", "measurement_count", "count")) or (column_ids[1] if len(column_ids) > 1 else None)
        if x and y:
            return {
                "result_id": result_id,
                "chart_type": "bar",
                "title": f"{y.replace('_', ' ').title()} by {x.replace('_', ' ').title()}",
                "encoding": {"x": x, "y": y},
            }

    if "pie" in msg:
        color = first_available(("data_mode", "file_type", "cycle_number")) or (column_ids[0] if column_ids else None)
        y = first_available(("profile_count", "measurement_count", "count")) or (column_ids[1] if len(column_ids) > 1 else None)
        if color and y:
            return {
                "result_id": result_id,
                "chart_type": "pie",
                "title": f"{y.replace('_', ' ').title()} by {color.replace('_', ' ').title()}",
                "encoding": {"color": color, "y": y},
            }

    if "area" in msg:
        x = first_available(("observed_at", "observation_date", "pressure")) or (column_ids[0] if column_ids else None)
        y = first_available(("avg_salinity", "salinity", "avg_temperature", "temperature")) or (column_ids[1] if len(column_ids) > 1 else None)
        if x and y:
            return {
                "result_id": result_id,
                "chart_type": "area",
                "title": f"{y.replace('_', ' ').title()} by {x.replace('_', ' ').title()}",
                "encoding": {"x": x, "y": y},
            }

    return None


def _extract_sql_outcome(response, store: ResultStore, sql_tool) -> dict:
    """Pull the SQL tool result, raw-SQL fallback, and query text out of a
    single agent response.

    Returns a dict with keys: query, data, result_id, columns, row_count,
    sql_error, sql_result, content.
    """
    content = (response.content or "").strip()

    # The agent may call run_sql_query several times in one run while it
    # self-corrects; the final call is the one that counts.
    sql_result = extract_tool_result(response, "run_sql_query", last=True)

    query = ""
    data: list[dict] = []
    result_id = None
    columns: list[dict] = []
    row_count = 0
    sql_error = None
    retryable = True

    if sql_result:
        if "error" in sql_result:
            sql_error = sql_result["error"]
            retryable = sql_result.get("retryable", True)
        else:
            result_id = sql_result.get("result_id")
            columns = sql_result.get("columns", [])
            row_count = sql_result.get("row_count", 0)
            if result_id:
                stored = store.get(result_id)
                if stored:
                    data = stored["rows"][:_MESSAGE_PREVIEW_LIMIT]

    # No tool call happened — the agent may have returned raw SQL as text.
    if sql_result is None:
        if content and not content.startswith("{") and not content.startswith("```"):
            first_word = (
                content.lstrip("( \t\n").split()[0].upper()
                if content.strip() else ""
            )
            if first_word in ("SELECT", "WITH"):
                logger.warning(
                    "SQL agent returned raw SQL without a tool call; "
                    "executing fallback path"
                )
                tool_result_str = (
                    sql_tool.entrypoint(query=content)
                    if hasattr(sql_tool, "entrypoint") else None
                )
                if tool_result_str:
                    try:
                        sql_result = json.loads(tool_result_str)
                    except (json.JSONDecodeError, TypeError):
                        sql_result = None
                    if sql_result and "error" in sql_result:
                        sql_error = sql_result["error"]
                        retryable = sql_result.get("retryable", True)
                    elif sql_result:
                        result_id = sql_result.get("result_id")
                        columns = sql_result.get("columns", [])
                        row_count = sql_result.get("row_count", 0)
                        if result_id:
                            stored = store.get(result_id)
                            if stored:
                                data = stored["rows"][:_MESSAGE_PREVIEW_LIMIT]
                query = content

    # Recover query text from tool_args if we still don't have it.
    if not query:
        args = extract_tool_args(response, "run_sql_query", last=True)
        if args and isinstance(args.get("query"), str):
            query = args["query"]

    return {
        "query": query,
        "data": data,
        "result_id": result_id,
        "columns": columns,
        "row_count": row_count,
        "sql_error": sql_error,
        "sql_retryable": retryable,
        "sql_result": sql_result,
        "content": content,
    }


def _correction_message(question: str, failed_query: str, error: str) -> str:
    """Build the follow-up prompt that asks the agent to fix a failed query.

    The agent has no memory between runs, so the original question, the
    failed SQL and the database error are all restated.
    """
    return (
        f"{question}\n\n"
        "Your previous attempt to answer this failed.\n"
        f"Query:\n{failed_query or '(no query captured)'}\n\n"
        f"Error:\n{error}\n\n"
        "Fix the query (check column names against the obs / profile_summary "
        "views, aliases, GROUP BY, and casts) and call run_sql_query again."
    )


# OpenCode Zen serves these model families only on the OpenAI Responses API;
# everything else it serves on chat/completions.
_OPENCODE_RESPONSES_PREFIXES = ("gpt-", "grok-", "muse-")

_RETRY_KWARGS = dict(retries=2, delay_between_retries=1, exponential_backoff=True)
_LLM_TIMEOUT_S = 30.0


def make_model(max_tokens: int, reasoning_effort: str | None = None) -> Model:
    """Build the configured LLM (see LLM_PROVIDER / LLM_MODEL in config.py).

    `reasoning_effort` ("minimal" | "low" | "medium" | "high") is applied
    where the API supports it (OpenCode Responses models); ignored elsewhere.
    """
    if LLM_PROVIDER == "opencode":
        if not OPENCODE_API_KEY:
            raise RuntimeError("LLM_PROVIDER=opencode but OPENCODE_API_KEY is not set")
        if LLM_MODEL.startswith(_OPENCODE_RESPONSES_PREFIXES):
            return OpenAIResponses(
                id=LLM_MODEL,
                api_key=OPENCODE_API_KEY,
                base_url=OPENCODE_BASE_URL,
                max_output_tokens=max_tokens,
                reasoning_effort=reasoning_effort,
                timeout=_LLM_TIMEOUT_S,
                **_RETRY_KWARGS,
            )
        return OpenAIChat(
            id=LLM_MODEL,
            api_key=OPENCODE_API_KEY,
            base_url=OPENCODE_BASE_URL,
            max_tokens=max_tokens,
            timeout=_LLM_TIMEOUT_S,
            **_RETRY_KWARGS,
        )

    if LLM_PROVIDER != "openrouter":
        raise RuntimeError(f"Unknown LLM_PROVIDER {LLM_PROVIDER!r}")
    return OpenRouter(
        api_key=OPENROUTER_API_KEY,
        id=LLM_MODEL,
        max_tokens=max_tokens,
        timeout=_LLM_TIMEOUT_S,
        **_RETRY_KWARGS,
    )


def classify_intent(message: str, system_message: str) -> str:
    """Use a lightweight agent to classify the user message as
    SQL, DOMAIN, CONTEXT, or OFF_TOPIC."""
    agent = Agent(
        model=make_model(_INTENT_MAX_TOKENS, reasoning_effort=_INTENT_REASONING),
        system_message=system_message,
        markdown=False,
    )
    response = agent.run(message)
    raw = (response.content or "").strip().upper()
    raw = raw.replace("-", "_").replace(" ", "_")

    for label in ("SQL", "CONTEXT", "DOMAIN", "OFF_TOPIC"):
        if label in raw:
            return label
    raise ValueError(f"Intent classifier returned unparseable output: {raw!r}")


def _format_available_params(params: list[str] | None) -> str:
    """Render the {available_params} placeholder value for sql_prompt.md."""
    if params is None:
        # Fetch failed — tell the model we couldn't determine the list.
        return (
            "unknown (could not load project parameters; "
            "avoid extras->>'...' accessors unless the user explicitly named a BGC parameter)"
        )
    if not params:
        return (
            "none (this project has no BGC / extras parameters; "
            "do not use extras->>'...' accessors)"
        )
    return ", ".join(params)


def _inject_available_params(system_message: str, params: list[str] | None) -> str:
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
    available_params: list[str] | None
    try:
        available_params = db.get_project_parameters(project_id)
    except Exception:
        logger.exception(
            "Failed to fetch project_parameters for project %s; "
            "JSONB key validation will be skipped for this request",
            project_id,
        )
        available_params = None  # None = unknown; skip validation rather than false-reject
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
        model=make_model(_SQL_AGENT_MAX_TOKENS, reasoning_effort=_SQL_REASONING),
        system_message=system_message_injected,
        tools=[sql_tool, viz_tool],
        tool_call_limit=_SQL_TOOL_CALL_LIMIT,
        markdown=False,
    )

    last_response = agent.run(message)
    outcome = _extract_sql_outcome(last_response, store, sql_tool)

    # The model sometimes emits a malformed viz tool call (e.g.
    # "create_visualization_spec<|channel|>commentary") and never runs SQL.
    # Give it one structured retry before surfacing an error.
    if outcome["sql_result"] is None and not outcome["query"]:
        logger.warning(
            "SQL agent produced no query on first attempt; retrying once with emphasis"
        )
        last_response = agent.run(
            message
            + "\n\nIMPORTANT: First call the run_sql_query tool with a single "
            "SELECT query. Do NOT return SQL as plain text and do NOT call "
            "create_visualization_spec before running the query."
        )
        outcome = _extract_sql_outcome(last_response, store, sql_tool)

    # ── 3. Self-correction: feed SQL errors back to the agent ───────────────
    for attempt in range(1, _SQL_CORRECTION_ATTEMPTS + 1):
        if not outcome["sql_error"] or not outcome["sql_retryable"]:
            break
        logger.info(
            "SQL attempt failed (%s); asking agent to correct (attempt %d/%d)",
            outcome["sql_error"], attempt, _SQL_CORRECTION_ATTEMPTS,
        )
        last_response = agent.run(
            _correction_message(message, outcome["query"], outcome["sql_error"])
        )
        corrected = _extract_sql_outcome(last_response, store, sql_tool)
        if corrected["sql_result"] is None and not corrected["query"]:
            # The agent produced nothing usable this round; keep the last
            # real error rather than replacing it with an empty outcome.
            continue
        outcome = corrected

    query = outcome["query"]
    data = outcome["data"]
    result_id = outcome["result_id"]
    columns = outcome["columns"]
    row_count = outcome["row_count"]
    sql_error = outcome["sql_error"]
    content = outcome["content"]

    if outcome["sql_result"] is None and not query:
        logger.error(
            "SQL agent produced no run_sql_query tool result and no raw SQL "
            "after retry. content=%r",
            content[:500],
        )
        raise SQLAgentNoQueryError(
            "The SQL agent did not produce an executable query. Please try again."
        )

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
    viz_result = extract_tool_result(last_response, "create_visualization_spec", last=True)
    if viz_result and viz_result.get("status") == "ok":
        chart_spec = viz_result.get("chart_spec")
    elif viz_result and viz_result.get("status") == "error":
        logger.warning("create_visualization_spec rejected: %s",
                       viz_result.get("error"))

    # ── 5b. Inference fallback: the model described a chart in prose but never
    # called create_visualization_spec. Derive a conservative spec from the
    # query wording + result columns so the user still gets their chart.
    if chart_spec is None and data:
        inferred = _infer_chart_spec(message, result_id, columns)
        if inferred:
            logger.info("Inferred chart_spec from message: %s", inferred)
            chart_spec = inferred

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
    first_word = content.lstrip("( \t\n").split()[0].upper() if content.strip() else ""
    content_is_sql = first_word in ("SELECT", "WITH")

    if data:
        summary_agent = Agent(
            model=make_model(_SUMMARY_MAX_TOKENS, reasoning_effort=_SUMMARY_REASONING),
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
        try:
            summary_response = summary_agent.run(
                f"User question: {message}\n\n"
                f"Query results (JSON, first {_MESSAGE_PREVIEW_LIMIT} rows):\n"
                f"{json.dumps(data, default=str)}"
            )
            summary = (summary_response.content or "").strip() or content
        except Exception:
            logger.exception(
                "Summary agent failed (timeout or model error); "
                "falling back to row-count summary"
            )
            summary = (
                f"The query returned {row_count} row(s). "
                "A detailed summary could not be generated — see the table below."
            )
    elif not content_is_sql and content.strip():
        summary = content
    else:
        summary = "The query ran successfully but returned no matching rows."

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
        model=make_model(1000, reasoning_effort=_SUMMARY_REASONING),
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
        model=make_model(1000, reasoning_effort=_SUMMARY_REASONING),
        system_message=full_system_prompt,
        markdown=True,
    )

    response = agent.run(message)
    return (response.content or "").strip()
