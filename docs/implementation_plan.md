# OceoGeoApp v2 — Implementation Plan

> Full architectural overhaul: dynamic JSONB schema, BGC-Argo support, AI-driven charts, OpenRouter, ChatGPT-style UI, Drizzle ORM.

---

## Table of Contents

1. [Database Schema Overhaul](#1-database-schema-overhaul)
2. [NetCDF Processor Rewrite](#2-netcdf-processor-rewrite)
3. [AI Layer Refactoring](#3-ai-layer-refactoring)
4. [Frontend Chart System](#4-frontend-chart-system)
5. [UI Reimagining](#5-ui-reimagining)
6. [Drizzle ORM Integration](#6-drizzle-orm-integration)
7. [Error Handling Architecture](#7-error-handling-architecture)
8. [Execution Order & Dependencies](#8-execution-order--dependencies)

---

## 1. Database Schema Overhaul

### 1.1 Current Schema

There is **no migration file or schema file** in the codebase. The schema is defined implicitly through:
- Raw SQL in `OceoGeoAPI/core/prompts/sql_prompt.md` (lines 7–69) — the AI's reference copy
- Insert statements in `OceoGeoAPI/services/NeondbService.py` (lines 55–152)
- Select queries in `oceo-geo-web/components/BasicStatistics.tsx`, `BasicCharts.tsx`, and `app/projects/[id]/page.tsx`

Current schema (as documented in `sql_prompt.md`):

```sql
CREATE TABLE users (
    user_id    TEXT PRIMARY KEY,          -- Clerk ID
    email      TEXT NOT NULL UNIQUE,
    full_name  TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE projects (
    project_id   SERIAL PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    project_name TEXT NOT NULL,
    description  TEXT,
    pi_name      TEXT,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, project_name)
);

CREATE TABLE files (
    file_id         SERIAL PRIMARY KEY,
    project_id      INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    platform_number TEXT,
    data_centre     TEXT,
    file_size_bytes BIGINT,
    upload_date     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE profiles (
    profile_id  SERIAL PRIMARY KEY,
    file_id     INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    cycle_number INTEGER,
    direction   TEXT,
    latitude    REAL,
    longitude   REAL,
    position_qc INTEGER,
    observed_at TIMESTAMP
);

-- ⚠️ PROBLEM: Fixed columns — only supports PRES, TEMP, PSAL
CREATE TABLE measurements (
    measurement_id          BIGSERIAL PRIMARY KEY,
    profile_id              INTEGER NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    depth_level             INTEGER,
    pressure                REAL,
    pressure_qc             INTEGER,
    pressure_adjusted       REAL,
    pressure_adjusted_qc    INTEGER,
    temperature             REAL,
    temperature_qc          INTEGER,
    temperature_adjusted    REAL,
    temperature_adjusted_qc INTEGER,
    salinity                REAL,
    salinity_qc             INTEGER,
    salinity_adjusted       REAL,
    salinity_adjusted_qc    INTEGER
);
```

### 1.2 New Schema

#### `measurements` — Keep Existing Columns + Add `extras` JSONB

> **Design rationale:** The existing typed columns for pressure, temperature, and salinity are the most queried parameters in oceanographic data. Keeping them as-is preserves all existing query performance, avoids any data migration risk, and means every existing query in the codebase continues to work unchanged. BGC-Argo parameters (DOXY, CHLA, NITRATE, etc.) go into a new `extras JSONB` column — these are the parameters that vary across float types and justify schema flexibility.

The existing `measurements` table stays **exactly as it is**. One column is added:

```sql
ALTER TABLE measurements ADD COLUMN extras JSONB;
```

Resulting table:

```sql
CREATE TABLE measurements (
    measurement_id          BIGSERIAL PRIMARY KEY,
    profile_id              INTEGER NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    depth_level             INTEGER,

    -- Core Argo parameters (typed columns — UNCHANGED)
    pressure                REAL,
    pressure_qc             INTEGER,
    pressure_adjusted       REAL,
    pressure_adjusted_qc    INTEGER,
    temperature             REAL,
    temperature_qc          INTEGER,
    temperature_adjusted    REAL,
    temperature_adjusted_qc INTEGER,
    salinity                REAL,
    salinity_qc             INTEGER,
    salinity_adjusted       REAL,
    salinity_adjusted_qc    INTEGER,

    -- BGC parameters (NEW — flexible JSONB for everything beyond core)
    extras                  JSONB
);
```

No new indexes needed for the typed columns (they already exist or can be added as standard B-tree). No indexes on `extras` — BGC queries are lower-frequency and the JSONB column only contains the non-core parameters, keeping it small. If query patterns later justify it, add a GIN index.

**Example `extras` value for a BGC-Argo measurement:**
```json
{
  "DOXY": 245.1,
  "DOXY_QC": 1,
  "DOXY_ADJUSTED": 244.8,
  "DOXY_ADJUSTED_QC": 1,
  "CHLA": 0.32,
  "CHLA_QC": 1,
  "NITRATE": 5.2,
  "NITRATE_QC": 2,
  "NITRATE_ADJUSTED": 5.1,
  "NITRATE_ADJUSTED_QC": 1,
  "NITRATE_ADJUSTED_ERROR": 0.3
}
```

**For a Core Argo file:** `extras` is `NULL` (no BGC parameters present).

**JSONB structure — flat keys:** Keys use the **original NetCDF variable name convention in UPPERCASE** — the base parameter name plus standard Argo suffixes (`_QC`, `_ADJUSTED`, `_ADJUSTED_QC`, `_ADJUSTED_ERROR`). This is a flat structure (no nesting) which is simpler for the LLM to reason about — the accessor pattern is a single `(extras->>'DOXY')::float` instead of nested `(extras->'DOXY'->>'value')::float`.

> **Key benefit:** Core Argo queries (temperature, salinity, pressure) use **exactly the same SQL as before** — no JSONB accessors, no casts, no COALESCE wrappers. Only BGC/extras queries touch the `extras` column. The flat JSONB structure keeps LLM-generated SQL simple and mirrors the NetCDF naming convention.

#### `profiles` — add `data_mode`

```sql
ALTER TABLE profiles ADD COLUMN data_mode TEXT;
-- Values: 'R' (Real-Time), 'A' (Adjusted), 'D' (Delayed-Mode)
```

#### `files` — add `file_type`

```sql
ALTER TABLE files ADD COLUMN file_type TEXT DEFAULT 'CORE';
-- Values: 'CORE', 'BGC', 'SPROF'
```

File type is determined by which parameters the user selects during the two-pass upload (see §2.3). If any non-core parameter is selected → BGC.

#### New: `conversations` table

```sql
CREATE TABLE conversations (
    conversation_id SERIAL PRIMARY KEY,
    project_id      INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title           TEXT,                                    -- Auto-generated from first message
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conversations_project ON conversations(project_id);
CREATE INDEX idx_conversations_user ON conversations(user_id);
```

> **Auth note:** `user_id` is on the conversations table directly. Every server action that fetches conversations must filter by `user_id` — never trust a bare `conversation_id` lookup without verifying ownership. This prevents cross-user data access even if someone guesses a conversation ID.

#### New: `messages` table

```sql
CREATE TABLE messages (
    message_id      BIGSERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT,                                   -- The text content
    intent          TEXT,                                   -- SQL, DOMAIN, CONTEXT, OFF_TOPIC
    sql_query       TEXT,                                   -- If intent=SQL, the generated query
    sql_data        JSONB,                                  -- Truncated preview (max 50 rows)
    chart_spec      JSONB,                                  -- If AI produced a chart, the spec
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
```

> **Storage note:** `sql_data` stores a **truncated preview** (max 50 rows). The full result set is NOT persisted. When a user revisits a conversation, they see the chart/table from the preview. If they want the full dataset, they re-run the query (the SQL is stored in `sql_query`). This prevents multi-megabyte JSON blobs per message row.

#### New: `project_parameters` table (Parameter Catalog)

```sql
CREATE TABLE project_parameters (
    project_id      INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    parameter_name  TEXT NOT NULL,
    measurement_count BIGINT DEFAULT 0,

    PRIMARY KEY (project_id, parameter_name)
);
```

> **Purpose:** The LLM cannot know what parameters exist in the `extras` column without querying the data. This catalog table is populated during file ingestion and provides an instant lookup of available parameters per project. The SQL prompt can dynamically include the parameter list for the current project, so the LLM knows exactly which `extras` keys are valid.
>
> **Populated during ingestion:** After processing a file, upsert into `project_parameters` for each extras parameter found, incrementing `measurement_count`.
>
> **Graceful handling:** Not every measurement row in a project will have every parameter listed in the catalog. When the LLM queries a parameter, `extras->>'DOXY'` returns `NULL` for rows where DOXY wasn't measured. The LLM prompt should be instructed to: (1) always use `WHERE extras ? 'PARAM'` to filter to rows that have the parameter, and (2) if a query returns all NULLs, explain to the user that this parameter was not recorded for the queried measurements.
>
> **Used by the AI layer:** Before each SQL agent call, query `project_parameters WHERE project_id = ?` and inject the available parameter names into the system prompt. This gives the LLM perfect knowledge of what's queryable.

### 1.3 Querying the New Schema

Common query patterns for the AI's SQL prompt:

```sql
-- Core query: temperature vs depth (UNCHANGED from current — no JSONB involved)
SELECT
    COALESCE(m.temperature_adjusted, m.temperature) AS temperature,
    COALESCE(m.pressure_adjusted, m.pressure) AS pressure
FROM measurements m
JOIN profiles pr ON m.profile_id = pr.profile_id
JOIN files f ON pr.file_id = f.file_id
WHERE f.project_id = {project_id}
  AND COALESCE(m.pressure_adjusted, m.pressure) > 500;

-- Core query: T-S diagram (UNCHANGED)
SELECT
    COALESCE(m.temperature_adjusted, m.temperature) AS temperature,
    COALESCE(m.salinity_adjusted, m.salinity) AS salinity,
    COALESCE(m.pressure_adjusted, m.pressure) AS pressure
FROM measurements m
JOIN profiles pr ON m.profile_id = pr.profile_id
JOIN files f ON pr.file_id = f.file_id
WHERE f.project_id = {project_id};

-- BGC query: dissolved oxygen vs depth (flat JSONB accessor)
SELECT
    COALESCE(m.pressure_adjusted, m.pressure) AS pressure,
    COALESCE(
        (m.extras->>'DOXY_ADJUSTED')::float,
        (m.extras->>'DOXY')::float
    ) AS dissolved_oxygen
FROM measurements m
JOIN profiles pr ON m.profile_id = pr.profile_id
JOIN files f ON pr.file_id = f.file_id
WHERE f.project_id = {project_id}
  AND m.extras ? 'DOXY';

-- BGC query: chlorophyll profile (flat JSONB accessor)
SELECT
    COALESCE(m.pressure_adjusted, m.pressure) AS pressure,
    (m.extras->>'CHLA')::float AS chlorophyll
FROM measurements m
JOIN profiles pr ON m.profile_id = pr.profile_id
JOIN files f ON pr.file_id = f.file_id
WHERE f.project_id = {project_id}
  AND m.extras ? 'CHLA';

-- Discover which BGC parameters are available in a project (fast — uses catalog)
SELECT parameter_name, measurement_count
FROM project_parameters
WHERE project_id = {project_id}
ORDER BY parameter_name;
```

### 1.4 Schema Source-of-Truth Strategy

There are three places the schema is represented:

| Location | What It Does | Update Strategy |
|----------|-------------|-----------------|
| `oceo-geo-web/lib/db/schema.ts` (Drizzle) | Frontend ORM type safety, migration generation | **Primary source** — edit this first |
| `OceoGeoAPI/core/prompts/sql_prompt.md` | LLM's reference for SQL generation | Must match Drizzle schema. Update manually after schema changes. |
| `OceoGeoAPI/services/NeondbService.py` | Python INSERT/SELECT statements | Must match Drizzle schema. Update manually after schema changes. |

**Validation:** After any schema change, run `drizzle-kit push --dry-run` to verify the Drizzle schema matches the database. For the Python side, run a smoke test that exercises every INSERT/SELECT path. There is no automated cross-language schema sync — this is a manual discipline until the system is mature enough to justify generating the SQL prompt from the Drizzle schema.

---

## 2. NetCDF Processor Rewrite

### 2.1 Current State

`OceoGeoAPI/core/processor.py` has `extract_measurements()` (lines 76–98) which hardcodes extraction of only `pres`, `temp`, `psal` and their QC/adjusted variants.

### 2.2 What Needs to Change

#### `core/processor.py`

Update `extract_measurements()` to:

1. Keep extracting pressure, temperature, salinity into the existing typed fields (no change for core params)
2. **NEW:** Extract user-selected extra parameters into a flat `extras` dict
3. Set file type based on whether any non-core parameters were selected

**Known parameter sets for reference:**

```
# These go into typed columns (existing behavior — no change)
CORE_PARAMS = {"PRES", "TEMP", "PSAL"}

# Argo suffix convention (applies to both core and extras)
PARAM_SUFFIXES = ("", "_QC", "_ADJUSTED", "_ADJUSTED_QC", "_ADJUSTED_ERROR")
```

Note: There is **no hardcoded `BGC_PARAMS` set**. The system discovers available parameters from the NetCDF file during the scan pass (see §2.3) and the user selects which ones to store. Any parameter beyond the core set (PRES, TEMP, PSAL) goes into `extras`.

The function should:
- Keep the existing extraction logic for pressure, temperature, salinity into typed columns (no changes)
- Accept a `selected_params: list[str]` argument — the list of extra parameter base names the user chose during upload
- For each selected parameter, extract all available suffixes (`DOXY`, `DOXY_QC`, `DOXY_ADJUSTED`, etc.) into flat JSONB keys
- Build a flat `extras` dict: `{"DOXY": 245.1, "DOXY_QC": 1, "DOXY_ADJUSTED": 244.8, ...}`
- Set `extras = None` if `selected_params` is empty (Core Argo file)
- **NaN/Inf sanitization:** Before adding to the extras dict, replace `NaN` and `Inf` values with `None`. These are not valid JSON and will cause `json.dumps()` to fail. Use `math.isfinite()` to check.

```python
# NaN sanitization helper
import math

def sanitize_for_json(value: float | None) -> float | None:
    """Reject NaN/Inf which are not valid JSON."""
    if value is None:
        return None
    if not math.isfinite(value):
        return None
    return value
```

#### `extract_profile_header()`

Add `data_mode` extraction from the row (the `data_mode` column exists in Argo NetCDF files).

### 2.3 Two-Pass Upload Flow

The upload process is split into two passes to let the user select which parameters to store:

#### Pass 1 — Scan (fast, no DB writes)

```
POST /files/scan
Body: multipart form with file(s)
Response: {
  "filename": "R5906438_001.nc",
  "core_params": ["PRES", "TEMP", "PSAL"],
  "available_extras": ["BBP700", "CHLA", "DOXY", "NITRATE", "PH_IN_SITU_TOTAL"],
  "profile_count": 12,
  "platform_number": "5906438"
}
```

This endpoint:
- Opens the NetCDF with `xarray.open_dataset()` (lazy loading — only reads metadata/headers, no data arrays loaded)
- Reads `ds.data_vars` to get all variable names
- Filters out core params (PRES, TEMP, PSAL) and dimension variables
- Strips suffixes (`_QC`, `_ADJUSTED`, etc.) to get base parameter names
- Returns available extras in **alphabetical order**
- Does NOT write anything to the database
- Should be fast (<1 second for any file size)

#### Frontend: Parameter Selection UI

After the scan response, the upload UI shows:
- The filename and basic metadata (platform, profile count)
- Core params listed as always-included (non-selectable)
- Available extras as checkboxes (all selected by default, user can deselect)
- A "Process" button to trigger Pass 2

#### Pass 2 — Process (existing pipeline + selected params)

```
POST /files/process
Body: multipart form with:
  - file
  - user_id
  - project_id
  - selected_params: ["DOXY", "CHLA"]  ← user's selection from Pass 1
Response: { file_id, profiles_inserted, measurements_inserted }
```

This endpoint:
- Runs the existing data pipeline (extract profiles, extract measurements)
- Passes `selected_params` to `extract_measurements()` so it knows which extras to build
- Wraps the entire pipeline in a **database transaction** (see §2.4)
- After successful ingestion, upserts into `project_parameters` for each selected extras param

#### Updating `project_parameters`

After processing a file, for each extra parameter found:

```sql
INSERT INTO project_parameters (project_id, parameter_name, measurement_count)
VALUES ({project_id}, 'DOXY', {count})
ON CONFLICT (project_id, parameter_name)
DO UPDATE SET measurement_count = project_parameters.measurement_count + EXCLUDED.measurement_count;
```

### 2.4 Transaction Wrapping for File Upload Pipeline

The entire file processing pipeline must be wrapped in a single database transaction. If any step fails, everything rolls back — no orphaned records.

```
BEGIN TRANSACTION
  1. INSERT INTO files → get file_id
  2. For each profile:
     a. INSERT INTO profiles → get profile_id
     b. Batch INSERT INTO measurements (with extras)
  3. UPSERT INTO project_parameters (for each extras param)
COMMIT

— If ANY step fails → ROLLBACK (file, profiles, measurements, project_parameters all reverted)
```

In `services/ProcessService.py`, this means getting a connection, calling `conn.autocommit = False`, running the full pipeline, then `conn.commit()` at the end. Wrap in try/except with `conn.rollback()` on failure.

Currently `NeondbService` creates connections per-operation. For transaction support, the `process_netcdf()` method should create a **single connection** and pass the cursor through all insert methods.

#### `services/NeondbService.py`

- `insert_measurements_batch()` — add `extras` column to the INSERT. Pass `json.dumps(extras)` if extras is not None, else `None`. The existing columns (pressure, temperature, salinity + QC/adjusted variants) stay exactly the same.
- `insert_profile_record()` — add `data_mode` to the INSERT.
- `insert_file_record()` — add `file_type` to the INSERT.
- `upsert_project_parameters()` — **NEW.** Accepts list of `(project_id, param_name, count)` and runs the upsert.
- All insert methods should accept a `cursor` parameter instead of creating their own connections.

#### `services/ProcessService.py`

- Get a single connection from NeondbService
- Set `autocommit = False`
- Run the full pipeline passing the cursor through
- `commit()` at the end, `rollback()` on exception
- Determine file type from `selected_params` (any non-core → BGC)

#### Frontend: `app/api/files/upload/route.ts`

- Update to send `selected_params` in the form data to the backend
- Add a new `/api/files/scan` route that proxies to `POST /files/scan`

---

## 3. AI Layer Refactoring

### 3.1 Ollama → OpenRouter via Agno

Currently `config.py` sets `MODEL="qwen2.5-coder:7b"` and `chatbot.py` uses `agno.models.ollama.Ollama`.

Agno has built-in OpenRouter support:
- Docs: https://docs.agno.com/models/providers/gateways/openrouter/overview#openrouter

Replace all `Ollama` usage with `OpenRouter`:

```python
from agno.models.openrouter import OpenRouter
# model=OpenRouter(id="gpt-oss-120b")
```

**Config changes:**
- `config.py` → read model name from env var
- `.env` → add `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`

**Also fix:** `chatbot.py` has duplicate imports at the top (lines 1–18). Clean those up during the refactor.

**OpenRouter operational guardrails:**
- **Timeout:** Set a 30-second timeout on all OpenRouter calls. If the model doesn't respond, return a graceful error.
- **Token limits:** Set `max_tokens` on every agent call. Intent classification: 10 tokens. SQL generation: 500 tokens. Domain/Context responses: 1000 tokens. Summary generation: 500 tokens.
- **Retry logic:** Retry on 429 (rate limit) and 5xx errors, up to 2 retries with exponential backoff (1s, 3s).
- **Cost tracking (Phase 5):** Log token usage per request. Add an env var `OPENROUTER_MONTHLY_BUDGET` and stop serving AI requests (return a "budget exhausted" message) if the estimated spend exceeds it.

### 3.2 Updated System Prompts

#### `core/prompts/sql_prompt.md` — Full Rewrite

Must document:
- The **unchanged core columns**: `pressure`, `temperature`, `salinity` (and their QC/adjusted variants) are normal typed columns — query them directly as before
- The **new `extras` JSONB column**: flat keys using NetCDF naming convention (DOXY, DOXY_QC, DOXY_ADJUSTED, etc.)
- JSONB access pattern for extras: `(m.extras->>'DOXY')::float`
- COALESCE pattern for extras: `COALESCE((m.extras->>'DOXY_ADJUSTED')::float, (m.extras->>'DOXY')::float)`
- Key existence check: `m.extras ? 'DOXY'`
- COALESCE for core params is unchanged: `COALESCE(m.temperature_adjusted, m.temperature)`
- The **`project_parameters` table**: query this first to know what extras params are available in a project
- New columns: `profiles.data_mode`, `files.file_type`
- New tables: `conversations`, `messages` (mention they exist but are not for data queries)
- **At least 8–10 example queries** covering all common patterns, including:
  - Core temperature/salinity/pressure queries (typed columns — unchanged)
  - BGC parameter query with flat JSONB accessor and key existence check
  - Mixed query: core + BGC params in the same SELECT
  - Aggregation on extras JSONB values
  - Available parameters lookup via `project_parameters`
  - Join through the FK chain with project scoping

**Dynamic parameter injection:** Before each SQL agent call, query `project_parameters WHERE project_id = ?` and inject the parameter list into the system prompt. For example:
```
Available extras parameters for this project: DOXY, CHLA, NITRATE
Use (m.extras->>'PARAM_NAME')::float to access these.
```

**Graceful NULL handling (add to prompt):**
- Not every measurement row has every extras parameter. When querying extras, always use `WHERE m.extras ? 'PARAM'` to filter to rows that actually have that parameter.
- If a query returns no data or all NULLs for a parameter, explain to the user that this parameter was not recorded for the queried measurements.

**SQL validation rules (add to prompt):**
- Core params (temperature, salinity, pressure): use directly as column names — **no JSONB accessors**
- Extras params: use flat accessor: `(m.extras->>'DOXY')::float`, `(m.extras->>'DOXY_ADJUSTED')::float`
- Always cast JSONB text values: `(extras->>'DOXY')::float`, never use `extras->'DOXY'` for scalar comparisons
- Always use UPPERCASE keys: `extras->>'DOXY'`, not `extras->>'doxy'`
- Suffix convention: `PARAM`, `PARAM_QC`, `PARAM_ADJUSTED`, `PARAM_ADJUSTED_QC`, `PARAM_ADJUSTED_ERROR`

#### `core/prompts/intent_prompt.md` — Minor Update

Keep intent merged with SQL (no separate CHART intent). The SQL agent decides whether to produce a chart spec based on the user's phrasing. This avoids a fragile two-step classification.

#### `core/prompts/domain_prompt.md` — Minor Update

Mention BGC-Argo in the scope section (dissolved oxygen, chlorophyll, nitrate, pH, etc.).

#### `core/glossary.py`

Add entries for BGC parameters (DOXY, CHLA, NITRATE, PH, etc.) with their units, typical ranges, and anomaly notes.

### 3.3 Chart Spec Generation — Via Agno Tool Calling

> **Design decision:** Use Agno's tool/function calling mechanism instead of regex-parsed inline tags. This is the same pattern as the existing `run_sql_query` tool. OpenRouter models support function calling, and Agno handles the protocol. This is far more reliable than parsing `[CHART]...[/CHART]` from free-form LLM text.

#### Chart Spec Schema

```
{
  "chart_type": "scatter" | "line" | "bar" | "histogram" | "heatmap" | "pie" | "area" | "boxplot",
  "title": "Temperature vs Depth",
  "x": {
    "field": "<column alias from SQL result>",
    "label": "Display Label (Unit)",
    "type": "value" | "category" | "time",   // optional, default "value"
    "inverted": true | false                  // optional, for depth axes
  },
  "y": {
    "field": "...",
    "label": "...",
    "type": "...",
    "inverted": true | false
  },
  "color_by": "<optional field to color-encode>",
  "series_group": "<optional field to split into multiple series>",
  "z": {                         // for heatmap only
    "field": "...",
    "label": "..."
  },
  "options": {
    "show_legend": true | false,
    "show_regression": true | false,
    "bin_count": 20              // for histogram
  }
}
```

#### Implementation Approach

Create a `render_chart` Agno tool alongside the existing `run_sql_query` tool:

```python
@tool(
    name="render_chart",
    description="Produce a chart specification for the frontend to render. You MUST call run_sql_query FIRST to obtain data before calling this tool. The chart spec's field names must match the column aliases in your SQL query. Never call render_chart without first obtaining data from run_sql_query."
)
def render_chart(chart_spec: str) -> str:
    """Accept a chart spec JSON and return it for frontend rendering.

    Args:
        chart_spec: A JSON string matching the ChartSpec schema.
    """
    try:
        parsed = json.loads(chart_spec)
        # Validate required fields
        required = {"chart_type", "title", "x", "y"}
        if not required.issubset(parsed.keys()):
            return json.dumps({"error": "Missing required fields in chart spec"})
        return json.dumps({"status": "ok", "chart_spec": parsed})
    except json.JSONDecodeError:
        return json.dumps({"error": "Invalid JSON in chart spec"})
```

The SQL agent gets both tools: `[run_sql_query, render_chart]`. When the user asks to "plot" or "visualize," the agent calls `run_sql_query` first, then `render_chart` with the spec.

**Tool ordering enforcement (prompt-level):** Add the following to the SQL agent's system prompt:

```
## Tool Calling Rules
1. ALWAYS call run_sql_query FIRST to fetch data.
2. ONLY THEN call render_chart if the user asked for a visualization.
3. NEVER call render_chart without calling run_sql_query first.
4. The field names in your chart spec (x.field, y.field, color_by, etc.) MUST exactly
   match the column aliases you used in your SQL query.
```

This is sufficient because the chosen model (gpt-oss-120b/Claude) reliably follows explicit tool-ordering instructions.

**In `chatbot.py`:** After the agent run, check tool call results for both tools. Extract `chart_spec` from the `render_chart` result if present.

**Fallback:** If the `render_chart` tool call fails (malformed JSON, missing fields), log the error and return the response without a chart. The user still gets the data table and summary text.

#### Chart type selection guidelines (for the AI prompt):

| Scenario | Chart Type |
|----------|-----------|
| Parameter vs depth/pressure | scatter or line, with Y axis inverted |
| Time series | line with time on X |
| Distribution of a single variable | histogram |
| Two variables relationship | scatter |
| Categorical breakdown | bar or pie |
| Spatial data (lat/lon + value) | heatmap |

### 3.4 SQL Validation Layer

Before executing any AI-generated SQL, apply these additional checks beyond the existing forbidden-keyword filter:

1. **JSONB key check:** Verify that every `extras->>'...'` accessor uses a key matching a known parameter in `project_parameters` for the current project. Reject queries with unknown parameter names (prevents hallucinated parameters). Validate against the flat key convention: base name (DOXY), or base name + suffix (DOXY_QC, DOXY_ADJUSTED, etc.).
2. **Column vs JSONB check:** If the AI tries to use JSONB accessors on core parameters (e.g., `extras->>'TEMP'`), reject and suggest using the typed column instead. Core params are: `temperature`, `salinity`, `pressure` (and their QC/adjusted variants).
3. **Cast check:** Verify that every `extras->>'...'` extraction is followed by `::float` or `::int`. Reject uncast JSONB access in WHERE/ORDER BY clauses.
4. **Result size limit:** Always enforce `LIMIT 200` if not already present. The existing tool already does `LIMIT 100` — keep or increase to 200.

These checks live in `core/tools.py` → `_clean_sql_query()` and the `run_sql_query` function.

### 3.5 Text Streaming (Phase 5)

For DOMAIN and CONTEXT responses (text-only), implement SSE streaming from the backend. This is a Phase 5 enhancement — start with synchronous request/response for everything.

---

## 4. Frontend Chart System

### 4.1 ChartRenderer Component

Create a single, generic `ChartRenderer` component that accepts a chart spec + data array and renders the appropriate ECharts visualization.

**Input:** `{ spec: ChartSpec, data: Record<string, unknown>[] }`
**Output:** Rendered ECharts chart

The component should have a `switch` on `spec.chart_type` that delegates to builder functions:
- `buildScatter(spec, data)` → ECharts scatter config
- `buildLine(spec, data)` → ECharts line config
- `buildBar(spec, data)` → ECharts bar config
- `buildHistogram(spec, data)` → ECharts bar config with binning logic
- `buildHeatmap(spec, data)` → ECharts heatmap config
- `buildPie(spec, data)` → ECharts pie config
- etc.

Each builder reads `spec.x.field`, `spec.y.field` from the data array to construct the series data. This keeps the AI decoupled from ECharts internals — it only needs to know the chart vocabulary.

**Error boundary:** Wrap `ChartRenderer` in a React error boundary. If the spec is malformed or the data doesn't contain the referenced fields, render a graceful "Could not render chart" message with the raw spec displayed for debugging — don't crash the chat UI.

### 4.2 Integration into Chat

In the assistant message rendering component, check if `message.chart_spec` exists and `message.data` has rows. If so, render `<ChartRenderer spec={message.chart_spec} data={message.data} />` inline in the chat bubble.

### 4.3 Supported Chart Types (Phased)

**Initial set (Phase 3):** scatter, line, bar, histogram
**Later (Phase 5):** heatmap, pie, area, boxplot

Adding a new chart type is just one new builder function — the architecture is extensible.

---

## 5. UI Reimagining

### 5.1 New User Flow

```
Landing Page (signed out) → Sign In
                              ↓
                     Project Picker Screen
                    ┌─────────────────────┐
                    │  Select or Create   │
                    │     a Project       │
                    │                     │
                    │  [Project A]        │
                    │  [Project B]        │
                    │  [+ New Project]    │
                    └─────────────────────┘
                              ↓
                     Chat Interface (per project)
    ┌──────────┬──────────────────────────────────┐
    │ Sidebar  │         Chat Area                │
    │          │                                  │
    │ [+ New]  │   Project: Arctic Float 2024     │
    │          │                                  │
    │ Conv 1   │   ┌──────────────────────┐       │
    │ Conv 2   │   │ User: show me temp   │       │
    │ Conv 3   │   │       vs depth       │       │
    │          │   └──────────────────────┘       │
    │          │   ┌──────────────────────┐       │
    │ ──────── │   │ Assistant:           │       │
    │ Upload   │   │ [chart rendered]     │       │
    │ files    │   │ [summary text]       │       │
    │          │   │ [SQL disclosure]     │       │
    │          │   └──────────────────────┘       │
    │          │                                  │
    │          │   ┌──────────────────────────┐   │
    │          │   │ [input box]         [Send]│   │
    │          │   └──────────────────────────┘   │
    └──────────┴──────────────────────────────────┘
```

### 5.2 Route Structure — Incremental Delivery Strategy

> **Design decision:** Build the new UI under `/p/` routes while keeping old `/projects/` routes functional. This allows incremental delivery — the app is never "broken" during development. A feature flag or simple redirect activates the new UI when ready.

| Route | Purpose | Status |
|-------|---------|--------|
| `/` | Landing page (signed out) / Project picker (signed in) | MODIFY |
| `/projects` | Old project list — **keep working** throughout development | NO CHANGE until Phase 4 complete |
| `/projects/[id]` | Old project dashboard — **keep working** | NO CHANGE until Phase 4 complete |
| `/p/[projectId]` | New chat UI for a project | NEW |
| `/p/[projectId]/c/[conversationId]` | Specific conversation within a project | NEW |
| `/upload` | Kept, also accessible from sidebar | NO CHANGE |

Once Phase 4 is complete and tested end-to-end:
- Update `/` signed-in view to show ProjectPicker → link to `/p/[id]` instead of `/projects/[id]`
- Add redirect from `/projects/[id]` → `/p/[id]` (optional, can keep both)

### 5.3 Key Frontend Components

| Component | Status | Purpose |
|-----------|--------|---------|
| `ChatLayout.tsx` | **NEW** | Two-column layout: sidebar + chat area |
| `ConversationSidebar.tsx` | **NEW** | Lists conversations, new chat button, upload button |
| `ChatView.tsx` | **NEW** | Central chat area with inline chart support |
| `ChartRenderer.tsx` | **NEW** | Generic chart renderer (see §4) |
| `ProjectPicker.tsx` | **NEW** | Project selection/creation on homepage |
| `ChatInterface.tsx` | **DEPRECATED** | Keep in codebase, no longer routed to |
| `ProjectTabs.tsx` | **DEPRECATED** | Keep in codebase, no longer routed to |
| `BasicCharts.tsx` | **DEPRECATED** | Keep in codebase, no longer routed to |
| `BasicStatistics.tsx` | **DEPRECATED** | Keep in codebase, no longer routed to |
| `ClientBasicCharts.tsx` | **DEPRECATED** | Keep in codebase, no longer routed to |
| `analytics/*` | **DEPRECATED** | Keep in codebase, no longer routed to |

### 5.4 Conversation Sidebar

- Calls a server action: `getConversations(projectId)` → Drizzle SELECT from conversations table **filtered by user_id**
- Renders list of conversation titles with timestamps
- "New Chat" button → creates a conversation via `createConversation(projectId)`
- "Upload" button → opens file upload modal/panel

### 5.5 Message Persistence

1. User sends message → immediately save to `messages` table with `role='user'`
2. Call backend AI → get response
3. Save assistant response to `messages` with `role='assistant'`, `intent`, `sql_query`, `sql_data` (truncated to 50 rows max), `chart_spec`
4. On page load / conversation switch → load messages with **pagination** (latest 50 messages, load more on scroll-up)
5. Conversation title → auto-generated from the first user message (truncated to ~50 chars)

**Re-run capability:** When a user views a historical conversation with a chart, the chart renders from the stored `sql_data` preview. A "Re-run query" button can re-execute the stored `sql_query` to get fresh/full data.

---

## 6. Drizzle ORM Integration

### 6.1 Setup

```bash
cd oceo-geo-web
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit
```

Drizzle is **Next.js side only**. The Python backend stays on `psycopg2`.

If staying on NeonDB, use `@neondatabase/serverless` as the Drizzle driver (supported natively via `drizzle-orm/neon-serverless`). If moving to plain Postgres later, swap to `postgres` driver — one-line change.

### 6.2 Files to Create

#### `lib/db/schema.ts`

Define all tables using Drizzle's `pgTable`:
- `users`, `projects`, `files`, `profiles`, `measurements` (existing columns + `extras: jsonb`)
- `project_parameters` (new — composite PK)
- `conversations` (with `user_id`), `messages` (new)

This file becomes the **primary source of truth** for the schema on the frontend.

#### `lib/db/index.ts`

Create the Drizzle client using the Neon serverless driver. Replace the old `lib/db.ts`.

#### `drizzle.config.ts` (project root)

Drizzle Kit config pointing to the schema file and database URL.

### 6.3 Server Actions to Migrate

| File | What Changes |
|------|-------------|
| `lib/actions/projects.ts` | Raw `sql` tagged templates → Drizzle `db.select().from(projects)...` |
| `lib/actions/user.ts` | Raw `sql` tagged templates → Drizzle upsert |
| `lib/actions/chat.ts` | Add chart_spec to types, add message persistence calls |
| `lib/actions/conversations.ts` | **NEW** — CRUD for conversations and messages |

**Auth enforcement in every server action:**
```typescript
// PATTERN: Every conversations/messages action must verify ownership
export async function getConversations(projectId: number) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // Always filter by userId — never trust projectId alone
  return db.select()
    .from(conversations)
    .where(and(
      eq(conversations.projectId, projectId),
      eq(conversations.userId, userId)
    ))
    .orderBy(desc(conversations.updatedAt));
}
```

### 6.4 Drizzle Migrations

```bash
# Generate migration from schema diff
pnpm drizzle-kit generate

# Push directly to database (dev)
pnpm drizzle-kit push

# Or apply migration files
pnpm drizzle-kit migrate
```

For the initial v2 deployment, use the raw SQL migration (see Appendix A) to migrate existing data (especially the measurements column conversion). After that, use `drizzle-kit push` for schema syncing going forward.

### 6.5 Delete old `lib/db.ts`

The old file creates a raw `neon()` query function. Replace entirely with the Drizzle client in `lib/db/index.ts`.

---

## 7. Error Handling Architecture

### 7.1 NetCDF Processing Errors

| Error | Handling |
|-------|---------|
| File has no `N_PROF` dimension | Return 422 with clear error message (existing behavior, keep it) |
| Unexpected/corrupt structure | Wrap `xr.open_dataset()` in try/except. Return 422: "Could not parse NetCDF file: {details}" |
| NaN/Inf values in measurements | Sanitize to `None` before JSON serialization (see §2.2). Log a warning count. |
| Empty file (no profiles/measurements) | Return success with `profiles_inserted: 0, measurements_inserted: 0` — not an error |

### 7.2 AI / OpenRouter Errors

| Error | Handling |
|-------|---------|
| OpenRouter timeout (>30s) | Return `{"intent": "ERROR", "response": "The AI service is taking too long. Please try again."}` |
| OpenRouter 429 (rate limited) | Retry up to 2x with exponential backoff. If still failing, return error message. |
| OpenRouter 5xx | Same as timeout: retry then error message. |
| Intent classification fails | Default to "OFF_TOPIC" (existing behavior, keep it) |
| SQL agent generates invalid SQL | The SQL tool already catches exceptions and returns `{"error": "..."}`. Add more specific error messages for common JSONB syntax errors. |
| SQL agent generates valid SQL with wrong results | Not detectable at runtime. Mitigate through extensive few-shot examples in the prompt. |
| Chart spec tool call produces invalid JSON | Log error, return response without chart. User still gets data table + summary. |
| Chart spec references fields not in SQL result | Frontend ChartRenderer catches this and shows "Could not render chart" — not a backend concern. |

### 7.3 Database Errors

| Error | Handling |
|-------|---------|
| Connection failure | `NeondbService.get_connection()` already wraps in context manager. Add retry logic (1 retry after 1s). |
| File upload pipeline failure | Entire pipeline is wrapped in a transaction (see §2.4). Any failure triggers `ROLLBACK` — no orphaned records. Return the error to the user with the specific step that failed. |
| JSONB insert failure (extras) | Caught by the transaction — entire file upload rolls back. Log the specific row that failed for debugging. |
| Message persistence failure | Don't block the chat response. Save message async if possible, or catch and log. The user should still see their response even if persistence fails. |

### 7.4 Frontend Error States

Every async operation in the chat UI should have three states: **idle**, **loading**, **error**. Error states should show:
- A clear error message (not a stack trace)
- A "Retry" button where applicable
- The ability to continue chatting (one error shouldn't freeze the whole UI)

Wrap `ChartRenderer` in a React error boundary to prevent chart rendering errors from crashing the conversation view.

---

## 8. Execution Order & Dependencies

### Phase 1 — Foundation (database + processor, no frontend changes)

```
1.1  Run migration (see Appendix A) — adds extras column, project_parameters table,
     data_mode, file_type, conversations + messages tables. Non-destructive.
1.2  Run verification queries to confirm extras column exists and existing data intact
1.3  Create /files/scan endpoint — NetCDF header scan, returns available parameters
1.4  Update processor.py — add extras extraction with user-selected params
1.5  Update NeondbService.py — add extras column to INSERT, add upsert_project_parameters,
     refactor all inserts to accept cursor for transaction support
1.6  Update ProcessService.py — wrap pipeline in transaction, accept selected_params
1.7  Update frontend upload route — two-pass flow (scan → select → process)
1.8  Test: upload a Core Argo .nc file → verify core columns unchanged, extras = NULL,
     no entries in project_parameters
1.9  Test: upload a BGC-Argo .nc file → select DOXY + CHLA → verify extras populated,
     project_parameters updated with counts
1.10 Test: upload a second BGC file to same project → verify project_parameters
     counts accumulate correctly
1.11 Test: simulate failure mid-pipeline → verify transaction rollback
     (no orphaned file/profile/measurement records)
```

### Phase 2 — AI Layer

```
2.1  Switch config.py + chatbot.py to OpenRouter (with timeout + retry)
2.2  Rewrite sql_prompt.md — add flat extras JSONB docs, project_parameters catalog,
     dynamic param injection, keep existing core query docs
2.3  Add render_chart tool to tools.py (with ordering instructions in description)
2.4  Update chatbot.py — extract chart_spec from tool results, inject available
     params from project_parameters into system prompt
2.5  TEST SUITE (at least 10 queries):
     - "what is the average temperature" → uses typed column directly (no JSONB)
     - "show me temperature vs depth" → scatter chart_spec
     - "how many profiles are in my project" → count query
     - "what parameters are available" → queries project_parameters table
     - "plot dissolved oxygen vs depth" → extras JSONB query + chart_spec
     - "show me salinity at 500m" → pressure range filter (typed column)
     - "what files have been uploaded" → files table query
     - "compare temperature and salinity" → T-S scatter chart (typed columns)
     - "distribution of temperature" → histogram chart_spec
     - Edge case: ask about a parameter that doesn't exist → graceful message
```

### Phase 3 — Frontend Plumbing

```
3.1  Install drizzle-orm, create schema.ts, drizzle.config.ts
3.2  Run drizzle-kit push to verify schema matches
3.3  Create lib/db/index.ts with Drizzle client
3.4  Migrate server actions to Drizzle (projects.ts, user.ts)
3.5  Create conversations.ts server actions (with auth enforcement)
3.6  Build ChartRenderer.tsx with error boundary
3.7  Test ChartRenderer with mock specs for each supported chart type
```

### Phase 4 — UI Overhaul (incremental, old UI stays functional)

```
4.1  Build ChatLayout component (sidebar + chat area shell)
4.2  Build ConversationSidebar (conversation list + new chat button)
4.3  Build ChatView (chat interface with ChartRenderer integration)
4.4  Create /p/[projectId] route → renders ChatLayout
4.5  Create /p/[projectId]/c/[convId] route → loads specific conversation
4.6  Wire up message persistence (save + load + pagination)
4.7  Add file upload access from sidebar
4.8  Build ProjectPicker component
4.9  Update homepage (/) to show ProjectPicker for signed-in users,
     linking to /p/[projectId] routes
4.10 End-to-end test: project selection → new conversation → ask question
     → see chart → switch conversations → see history
4.11 ONLY AFTER 4.10 PASSES: redirect /projects/[id] → /p/[id] (optional)
```

### Phase 5 — Polish

```
5.1  Streaming text responses (SSE) for DOMAIN/CONTEXT intents
5.2  Auto-generate conversation titles from first message
5.3  Add more chart types (heatmap, boxplot, area)
5.4  Update glossary.py with BGC parameters
5.5  Clean up deprecated components (mark with comments, don't delete)
5.6  Cost tracking: log OpenRouter token usage, add budget cap
5.7  Performance monitoring: add query timing logs for JSONB queries
```

---

## Appendix A: Migration SQL

> **This migration is entirely non-destructive.** No existing columns are modified or dropped. It only ADDs new columns and tables. Rollback is trivial.

```sql
-- ============================================================
-- MIGRATION: OceoGeoApp v1 → v2
-- Non-destructive: only adds columns and tables
-- ============================================================

BEGIN;

-- 1. Add extras JSONB to measurements (BGC parameters)
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS extras JSONB;

-- 2. Add new columns to existing tables
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS data_mode TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT 'CORE';

-- 3. Create project_parameters catalog
CREATE TABLE IF NOT EXISTS project_parameters (
    project_id      INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    parameter_name  TEXT NOT NULL,
    measurement_count BIGINT DEFAULT 0,
    PRIMARY KEY (project_id, parameter_name)
);

-- 4. Create conversations table
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id SERIAL PRIMARY KEY,
    project_id      INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title           TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Create messages table
CREATE TABLE IF NOT EXISTS messages (
    message_id      BIGSERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT,
    intent          TEXT,
    sql_query       TEXT,
    sql_data        JSONB,
    chart_spec      JSONB,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Add indexes
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

COMMIT;
```

### Verification

```sql
-- Confirm extras column exists and is nullable
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'measurements' AND column_name = 'extras';
-- Expected: extras | jsonb | YES

-- Confirm existing data is untouched
SELECT COUNT(*) AS total_rows,
       COUNT(temperature) AS rows_with_temp,
       COUNT(extras) AS rows_with_extras
FROM measurements;
-- Expected: rows_with_extras = 0 (no BGC data ingested yet)
```

### Rollback (if needed)

```sql
BEGIN;

ALTER TABLE measurements DROP COLUMN IF EXISTS extras;
ALTER TABLE profiles DROP COLUMN IF EXISTS data_mode;
ALTER TABLE files DROP COLUMN IF EXISTS file_type;

DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS project_parameters;

COMMIT;
```

> **Note:** Since no existing columns are touched, rollback is clean and lossless. All original data remains intact at every step.

---

## Appendix B: Files Changed Summary

### Backend (`OceoGeoAPI/`)

| File | Action | What Changes |
|------|--------|-------------|
| `config.py` | MODIFY | Remove hardcoded model, read from env |
| `.env` | MODIFY | Add OPENROUTER_API_KEY, OPENROUTER_MODEL |
| `core/processor.py` | MODIFY | Add extras extraction with user-selected params, NaN sanitization |
| `core/chatbot.py` | MODIFY | Ollama → OpenRouter, chart_spec from tool calls, inject project params, fix imports, add timeouts |
| `core/glossary.py` | MODIFY | Add BGC parameter entries |
| `core/tools.py` | MODIFY | Add `render_chart` tool (with ordering instructions), extras JSONB SQL validation |
| `core/prompts/sql_prompt.md` | REWRITE | Flat extras JSONB docs, project_parameters catalog, dynamic param injection, 8–10 examples |
| `core/prompts/intent_prompt.md` | MODIFY | Add chart guidance within SQL intent |
| `core/prompts/domain_prompt.md` | MODIFY | Mention BGC-Argo in scope |
| `core/prompts/context_prompt.md` | NO CHANGE | |
| `services/NeondbService.py` | MODIFY | Add extras to INSERT, data_mode, file_type, upsert_project_parameters, cursor-based methods for txn |
| `services/ProcessService.py` | MODIFY | Wrap pipeline in transaction, accept selected_params, detect file type |
| `services/StatsService.py` | DEPRECATED | Keep code, no longer called |
| `services/ChatServiceOllama.py` | MODIFY | Pass chart_spec through, query project_parameters for prompt injection, add timeout |
| `api/chat.py` | MODIFY | Include chart_spec in response |
| `api/files.py` | NEW | `/files/scan` endpoint for parameter discovery |
| `api/stats.py` | DEPRECATED | Keep code, no longer routed |

### Frontend (`oceo-geo-web/`)

| File | Action | What Changes |
|------|--------|-------------|
| `lib/db/schema.ts` | NEW | Drizzle schema definition (existing columns + extras JSONB) |
| `lib/db/index.ts` | NEW | Drizzle client (replaces lib/db.ts) |
| `lib/db.ts` | DELETE | Replaced by lib/db/index.ts |
| `lib/actions/projects.ts` | MODIFY | Drizzle queries |
| `lib/actions/user.ts` | MODIFY | Drizzle queries |
| `lib/actions/chat.ts` | MODIFY | Add chart_spec to types, message persistence |
| `lib/actions/conversations.ts` | NEW | Conversation CRUD with auth enforcement |
| `app/api/files/scan/route.ts` | NEW | Proxy to backend `/files/scan` for parameter discovery |
| `app/api/files/upload/route.ts` | MODIFY | Add selected_params to form data sent to backend |
| `components/ChartRenderer.tsx` | NEW | Generic chart renderer with error boundary |
| `components/ChatView.tsx` | NEW | New chat interface |
| `components/ChatLayout.tsx` | NEW | Sidebar + chat layout |
| `components/ConversationSidebar.tsx` | NEW | Conversation list |
| `components/ProjectPicker.tsx` | NEW | Project selection screen |
| `app/page.tsx` | MODIFY | Signed-in → ProjectPicker (Phase 4.9) |
| `app/p/[projectId]/page.tsx` | NEW | Chat UI entry point |
| `app/p/[projectId]/c/[convId]/page.tsx` | NEW | Specific conversation |
| `drizzle.config.ts` | NEW | Drizzle Kit config |
| `package.json` | MODIFY | Add drizzle-orm, drizzle-kit |
| Old components | KEEP | Mark deprecated, don't delete |
| Old routes (`/projects`, `/projects/[id]`) | KEEP | Functional throughout development, redirect after Phase 4 |
