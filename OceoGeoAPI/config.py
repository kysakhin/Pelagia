import dotenv
import os

dotenv.load_dotenv()

# ── LLM provider selection ──────────────────────────────────────────────────
# LLM_PROVIDER: "openrouter" (default) or "opencode" (OpenCode Zen gateway).
# LLM_MODEL:    model id for that provider. Falls back to OPENROUTER_MODEL so
#               existing .env files keep working.
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openrouter").strip().lower()

OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

OPENCODE_API_KEY = os.getenv("OPENCODE_API_KEY")
OPENCODE_BASE_URL = os.getenv("OPENCODE_BASE_URL", "https://opencode.ai/inference/openai/v1")

LLM_MODEL = os.getenv("LLM_MODEL") or OPENROUTER_MODEL

# Reasoning effort for the SQL-writing step on models that support it
# ("minimal" | "low" | "medium" | "high"). Higher = better SQL, slower.
LLM_SQL_REASONING_EFFORT = os.getenv("LLM_SQL_REASONING_EFFORT", "low")
