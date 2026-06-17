import json
import re

from agno.agent import Agent
from agno.models.ollama import Ollama

from config import MODEL
from core.tools import create_sql_tool
from services.NeondbService import NeonDBService
from core.glossary import GLOSSARY
import re

from agno.agent import Agent
from agno.models.ollama import Ollama

from config import MODEL
from core.tools import create_sql_tool
from services.NeondbService import NeonDBService


def classify_intent(message: str, system_message: str) -> str:
    """Use a lightweight agent to classify the user message as SQL, DOMAIN, or OFF_TOPIC."""
    agent = Agent(
        model=Ollama(id=MODEL),
        system_message=system_message,
        markdown=False,
    )
    response = agent.run(message)
    raw = (response.content or "").strip().upper()

    # The model might wrap the label in extra text/thinking — extract the label
    for label in ("SQL", "CONTEXT", "DOMAIN", "OFF_TOPIC"):
        if label in raw:
            return label
    return "OFF_TOPIC"


def run_sql_agent(
    message: str,
    user_id: str,
    project_id: int,
    system_message: str,
    db: NeonDBService,
) -> dict:
    """
    Generate a SQL query via the agent, execute it through the SQL tool,
    and return {"query": ..., "data": ..., "summary": ...}.
    """
    sql_tool = create_sql_tool(project_id, user_id, db)

    agent = Agent(
        model=Ollama(id=MODEL),
        # model=Ollama('qwen2.5-coder:7b'),
        system_message=system_message,
        tools=[sql_tool],
        markdown=False
    )

    response = agent.run(message)
    content = (response.content or "").strip()

    # Try to extract structured data from tool call results
    query = ""
    data = []

    # Check if any tool calls were made and extract results
    if response.tools and len(response.tools) > 0:
        for tool_use in response.tools:
            if hasattr(tool_use, "result") and tool_use.result:
                try:
                    parsed = json.loads(tool_use.result)
                    if isinstance(parsed, list):
                        data = parsed
                    elif isinstance(parsed, dict) and "error" in parsed:
                        return {
                            "query": query,
                            "data": [],
                            "summary": f"Error: {parsed['error']}",
                        }
                except (json.JSONDecodeError, TypeError):
                    pass
            # Extract the query from tool call arguments
            if hasattr(tool_use, "tool_args") and tool_use.tool_args:
                args = tool_use.tool_args
                if isinstance(args, dict):
                    query = args.get("query", query)
                elif isinstance(args, str):
                    try:
                        args_parsed = json.loads(args)
                        query = args_parsed.get("query", query)
                    except (json.JSONDecodeError, TypeError):
                        pass

    # If no tool call happened, the agent may have returned raw SQL as text
    if not query and not data:
        # Try treating the content as a SQL query and running it manually
        sql_tool_fn = sql_tool.entrypoint if hasattr(sql_tool, "entrypoint") else None
        if sql_tool_fn and content:
            query = content
            result = sql_tool_fn(query=content)
            try:
                parsed = json.loads(result)
                if isinstance(parsed, list):
                    data = parsed
                elif isinstance(parsed, dict) and "error" in parsed:
                    return {
                        "query": query,
                        "data": [],
                        "summary": f"Error: {parsed['error']}",
                    }
            except (json.JSONDecodeError, TypeError):
                pass

    # Generate a natural-language summary of the results
    summary = content
    if data:
        summary_agent = Agent(
            model=Ollama(id=MODEL),
            system_message=(
                "You are a helpful oceanographic data analyst. "
                "Summarize the following SQL query results in clear, concise natural language. "
                "Use proper units where applicable (°C for temperature, PSU for salinity, dbar for pressure). "
                "Do not output SQL or JSON — only a human-readable summary."
            ),
            markdown=True,
        )
        summary_response = summary_agent.run(
            f"User question: {message}\n\nQuery results (JSON):\n{json.dumps(data[:50], default=str)}"
        )
        summary = (summary_response.content or content).strip()

    return {
        "query": query,
        "data": data,
        "summary": summary,
    }


def run_domain_agent(message: str, system_message: str) -> str:
    """Answer a general oceanographic / geospatial question."""
    agent = Agent(
        model=Ollama(id=MODEL),
        system_message=system_message,
        markdown=True,
    )
    response = agent.run(message)
    return (response.content or "").strip()


def run_context_agent(message: str, context: dict | None, system_message: str) -> str:
    """Answer a question about a specific variable or chart pattern using the Ground Truth glossary."""
    
    # 1. Prepare the glossary string
    glossary_str = "GLOSSARY GROUND TRUTH:\n"
    for var, details in GLOSSARY.items():
        glossary_str += f"- {var.upper()} ({details['unit']}): {details['physical_meaning']}\n"
        glossary_str += f"  Typical ranges: {details.get('typical_surface_range', '')} / {details.get('typical_deep_range', '')} / {details.get('typical_open_ocean_range', '')} / {details.get('typical_argo_range', '')}\n"
        glossary_str += f"  Anomalies: {details.get('anomaly_note', '')}\n"

    # 2. Prepare the user view state string
    view_state_str = "\nCURRENT VIEW STATE:\n"
    if context:
        view_state_str += json.dumps(context, indent=2)
    else:
        view_state_str += "None provided."

    # 3. Add both to the system prompt
    full_system_prompt = system_message + "\n\n" + glossary_str + view_state_str

    agent = Agent(
        model=Ollama(id=MODEL),
        system_message=full_system_prompt,
        markdown=True,
    )
    
    response = agent.run(message)
    return (response.content or "").strip()