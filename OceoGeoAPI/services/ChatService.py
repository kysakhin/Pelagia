import os
import logging
import threading
import time

from services.NeondbService import NeonDBService
from core.chatbot import (
    SQLAgentNoQueryError,
    classify_intent,
    fetch_available_params,
    format_history,
    run_sql_agent,
    run_domain_agent,
    run_context_agent,
)
from core.concept_linker import link_concepts, ontology_context_for, unavailable_answer
from core.ontology import Concept, get_ontology

from agno.exceptions import ModelProviderError

logger = logging.getLogger(__name__)

_PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "..", "core", "prompts")


def _load_prompt(filename: str) -> str:
    path = os.path.join(_PROMPTS_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _concept_ref(c: Concept) -> dict:
    """Compact concept description for the API response / UI chips."""
    return {"id": c.id, "label": c.label, "kind": c.kind}


class ChatService:
    """Orchestrates multi-agent chat: intent classification → SQL / Domain / Off-topic."""

    def __init__(self):
        self.db = NeonDBService()
        self.intent_prompt = _load_prompt("intent_prompt.md")
        self.sql_prompt = _load_prompt("sql_prompt.md")
        self.domain_prompt = _load_prompt("domain_prompt.md")
        self.context_prompt = _load_prompt("context_prompt.md")
        self._region_cache: dict[int, tuple[float, list[Concept]]] = {}
        self._region_lock = threading.Lock()

    def process_message(
        self,
        message: str,
        user_id: str,
        project_id: int,
        context: dict | None = None,
        history: list[dict] | None = None,
    ) -> dict:
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

        # Recent turns let every agent resolve follow-ups ("now for salinity").
        history_text = format_history(history)

        try:
            intent = classify_intent(message, intent_prompt_with_hint, history_text)
        except Exception as exc:
            logger.exception("Intent classification failed")
            return self._ai_error_response(exc)

        if intent == "SQL":
            return self._answer_data_question(message, user_id, project_id, history, history_text)

        if intent == "DOMAIN":
            try:
                response = run_domain_agent(message, self.domain_prompt, history_text)
                return {"intent": "DOMAIN", "response": response}
            except Exception as exc:
                logger.exception("Domain agent failed")
                return self._ai_error_response(exc)

        if intent == "CONTEXT":
            try:
                concept_ids = self._context_concepts(message, context)
                response = run_context_agent(
                    message, context, self.context_prompt, history_text, concept_ids
                )
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
    
    # ── Data questions (SQL agent + ontology) ───────────────────────────────

    def _answer_data_question(
        self,
        message: str,
        user_id: str,
        project_id: int,
        history: list[dict] | None,
        history_text: str,
    ) -> dict:
        available_params = fetch_available_params(self.db, project_id)

        # Ontology: link concepts, check availability, build prompt cards.
        # Any failure here degrades to "no ontology context", never an error.
        ctx = None
        try:
            onto = get_ontology()
            previous_user = next(
                (t.get("content") for t in reversed(history or []) if t.get("role") == "user"),
                None,
            )
            ctx, availability, direct = ontology_context_for(
                message,
                onto,
                available_params=available_params,
                previous_user_message=previous_user,
                project_regions=self._project_regions(project_id, onto),
            )
            if availability.blocking:
                # Nothing the user asked for exists in this project — answer
                # immediately instead of spending model calls on empty queries.
                return {
                    "intent": "SQL",
                    "query": "",
                    "data": [],
                    "summary": unavailable_answer(availability, available_params, onto),
                    "result_id": None,
                    "columns": [],
                    "row_count": 0,
                    "chart_spec": None,
                    "chart_payload": None,
                    "concepts": [_concept_ref(m.concept) for m in direct],
                    "methods": [],
                }
        except Exception:
            logger.exception("Ontology context failed; continuing without it")
            ctx = None

        try:
            result = run_sql_agent(
                message=message,
                user_id=user_id,
                project_id=project_id,
                system_message=self.sql_prompt,
                db=self.db,
                history_text=history_text,
                available_params=available_params,
                ontology_context=ctx.prompt if ctx else "",
                method_notes=ctx.method_notes if ctx else None,
            )
        except Exception as exc:
            logger.exception("SQL agent failed")
            return self._ai_error_response(exc)
        return {
            "intent": "SQL",
            **result,
            "concepts": [_concept_ref(get_ontology()[c]) for c in ctx.concept_ids] if ctx else [],
            "methods": ctx.method_notes if ctx else [],
        }

    @staticmethod
    def _context_concepts(message: str, context: dict | None) -> list[str] | None:
        """Concepts for the context agent's glossary: those in the question
        plus the variables of the chart being viewed. None = all variables."""
        try:
            onto = get_ontology()
            text = message
            if context:
                text += " " + " ".join(str(v) for v in context.get("variables", []) or [])
                text += " " + str(context.get("chartLabel", ""))
            ids = [m.concept.id for m in link_concepts(text, onto)]
            return ids or None
        except Exception:
            logger.exception("Could not link concepts for context agent")
            return None

    _REGION_CACHE_TTL_S = 600
    _REGION_MAX_SPAN_DEG = 25

    def _project_regions(self, project_id: int, onto) -> list[Concept]:
        """Named regions containing the project's mean profile position
        (cached briefly; positions only change when files are uploaded)."""
        now = time.time()
        with self._region_lock:
            hit = self._region_cache.get(project_id)
            if hit and now - hit[0] < self._REGION_CACHE_TTL_S:
                return hit[1]
        regions: list[Concept] = []
        try:
            with self.db.get_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT AVG(p.latitude), AVG(p.longitude),
                           MAX(p.latitude) - MIN(p.latitude), MAX(p.longitude) - MIN(p.longitude)
                    FROM profiles p JOIN files f ON f.file_id = p.file_id
                    WHERE f.project_id = %s
                      AND p.latitude BETWEEN -90 AND 90 AND p.longitude BETWEEN -180 AND 180
                    """,
                    (project_id,),
                )
                lat, lon, lat_span, lon_span = cur.fetchone()
            # Only meaningful for a clustered project; the mean of floats
            # spread across oceans would land somewhere arbitrary.
            if lat is not None and lat_span <= self._REGION_MAX_SPAN_DEG and lon_span <= self._REGION_MAX_SPAN_DEG:
                regions = onto.regions_containing(float(lat), float(lon))[:2]
        except Exception:
            logger.exception("Could not determine project regions")
        with self._region_lock:
            self._region_cache[project_id] = (now, regions)
        return regions

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
        if isinstance(exc, SQLAgentNoQueryError):
            return {
                "intent": "ERROR",
                "response": str(exc),
            }
        return {
            "intent": "ERROR",
            "response": "Sorry, I encountered an error. Please try again.",
        }
