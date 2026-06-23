import os
import logging

from services.NeondbService import NeonDBService
from core.chatbot import classify_intent, run_sql_agent, run_domain_agent, run_context_agent

from agno.exceptions import ModelProviderError

logger = logging.getLogger(__name__)

_PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "..", "core", "prompts")


def _load_prompt(filename: str) -> str:
    path = os.path.join(_PROMPTS_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


class ChatService:
    """Orchestrates multi-agent chat: intent classification → SQL / Domain / Off-topic."""

    def __init__(self):
        self.db = NeonDBService()
        self.intent_prompt = _load_prompt("intent_prompt.md")
        self.sql_prompt = _load_prompt("sql_prompt.md")
        self.domain_prompt = _load_prompt("domain_prompt.md")
        self.context_prompt = _load_prompt("context_prompt.md")

    def process_message(self, message: str, user_id: str, project_id: int, context: dict | None = None) -> dict:
        """
        Classify the message intent and route to the appropriate agent.

        Returns a dict with at least {"intent": str, ...} plus intent-specific keys.
        """
        # Build an enriched classification prompt if context is supplied.
        # This helps the classifier understand the user is viewing a specific chart.
        if context:
            chart_label = context.get("chartLabel", "")
            variables = context.get("variables", [])
            context_hint = (
                f"\n\n[CURRENT USER VIEW: The user is looking at a '{chart_label}' chart "
                f"showing {', '.join(variables) if variables else 'oceanographic data'}. "
                f"Questions about what these values mean or expected trends are CONTEXT or DOMAIN, not SQL.]"
            )
            intent_prompt_with_hint = self.intent_prompt + context_hint
        else:
            intent_prompt_with_hint = self.intent_prompt

        try:
            intent = classify_intent(message, intent_prompt_with_hint)
        except Exception:
            logger.exception("Intent classification failed")
            intent = "OFF_TOPIC"

        if intent == "SQL":
            try:
                result = run_sql_agent(
                    message=message,
                    user_id=user_id,
                    project_id=project_id,
                    system_message=self.sql_prompt,
                    db=self.db,
                )
                return {"intent": "SQL", **result}
            except Exception as exc:
                logger.exception("SQL agent failed")
                return self._ai_error_response(exc)

        if intent == "DOMAIN":
            try:
                response = run_domain_agent(message, self.domain_prompt)
                return {"intent": "DOMAIN", "response": response}
            except Exception as exc:
                logger.exception("Domain agent failed")
                return self._ai_error_response(exc)

        if intent == "CONTEXT":
            try:
                response = run_context_agent(message, context, self.context_prompt)
                return {"intent": "CONTEXT", "response": response}
            except Exception as exc:
                logger.exception("Context agent failed")
                return self._ai_error_response(exc)

        # OFF_TOPIC
        return {
            "intent": "OFF_TOPIC",
            "response": (
                "I'm specialized in oceanographic and geospatial topics. "
                "I can't help with that, but feel free to ask me anything "
                "about ocean science or your Argo float data!"
            ),
        }
    
    def _ai_error_response(self, exc: Exception) -> dict:
        """Handle OpenRouter errors and return a friendly error message."""
        if isinstance(exc, ModelProviderError):
            msg = str(exc).lower()

            if exc.status_code in (500, 502, 503, 504) or "timeout" in msg or "timed out" in msg:
                return {
                    "intent": "ERROR",
                    "response": "The AI service is taking too long. Please try again.",
                }
            if exc.status_code == 429:
                return {
                    "intent": "ERROR",
                    "response": "The AI service is currently rate limited. Please try again later.",
                }
        return {
            "intent": "ERROR",
            "response": "Sorry, I encountered an error. Please try again.",
        }
