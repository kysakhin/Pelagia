"""Runtime SQL result store and chart payload composer.

This module sits OUTSIDE the agent frame. The agent emits a small `chart_spec`
that references a `result_id` returned by `run_sql_query`; the
`ChartPayloadService` validates that spec against the stored result's columns
and composes a frontend-ready `{ spec, data, meta }` payload.

Design rationale (see implementation_plan.md §3.3):
  - The agent must not generate or re-output chart data. The SQL tool is the
    source of truth for rows.
  - `result_id` is a runtime handle. It is NOT guaranteed to survive process
    restarts. Persist `messages.sql_data` as a display-limited preview so
    historical charts still render without re-querying the DB.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from typing import Any

logger = logging.getLogger(__name__)


# PostgreSQL type names we may see from psycopg2 cursor.description -> type_code,
# mapped to a coarse frontend type. Fall back to "string" for anything unknown.
# We use the cursor.description.type_code == psycopg2 string oid (25) etc., but
# we don't import psycopg2 here to keep this module dependency-free for tests.
_STRING_OIDS = {25, 1043, 1042}      # text, varchar, bpchar
_INT_OIDS = {20, 21, 23, 26, 705}    # int8, int2, int4, oid, oid8
_FLOAT_OIDS = {700, 701, 1700}       # float4, float8, numeric
_BOOL_OIDS = {16}                    # bool
_TIMESTAMP_OIDS = {1114, 1184}       # timestamp, timestamptz
_DATE_OIDS = {1082, 1083}            # date, time
_JSON_OIDS = {114, 3802}             # json, jsonb


def _infer_column_type(oid: int | None) -> str:
    if oid is None:
        return "string"
    if oid in _INT_OIDS:
        return "integer"
    if oid in _FLOAT_OIDS:
        return "number"
    if oid in _BOOL_OIDS:
        return "boolean"
    if oid in _TIMESTAMP_OIDS or oid in _DATE_OIDS:
        return "datetime"
    if oid in _JSON_OIDS:
        return "object"
    return "string"


def build_columns(cursor_description) -> list[dict]:
    """Convert a psycopg2 cursor.description into the column metadata shape
    that the agent and frontend expect:
        [{"id": "temperature", "type": "number"}, ...]

    `cursor_description` is a sequence of psycopg2 Column objects (or 7-tuples).
    """
    columns: list[dict] = []
    for col in cursor_description or []:
        # psycopg2 Column supports attribute access; tuples support indexing.
        name = getattr(col, "name", None) or col[0]
        type_code = getattr(col, "type_code", None)
        if type_code is None and isinstance(col, tuple) and len(col) >= 1:
            # 7-tuple form: (name, type_code, display_size, internal_size,
            #                 precision, scale, null_ok)
            type_code = col[1] if len(col) > 1 else None
        columns.append({"id": name, "type": _infer_column_type(type_code)})
    return columns


class ResultStore:
    """In-memory, thread-safe store of runtime SQL results, keyed by result_id.

    Each entry holds the display-limited rows and the column metadata returned
    by `run_sql_query`. Entries expire after `ttl_seconds` to bound memory use.

    This is intentionally per-process. For multi-worker deployments, replace
    with Redis or equivalent — the agent contract (result_id) stays the same.
    """

    def __init__(self, ttl_seconds: int = 1800, max_entries: int = 256):
        self._ttl = ttl_seconds
        self._max = max_entries
        self._store: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def put(
        self,
        rows: list[dict],
        columns: list[dict],
        row_count: int | None = None,
        sql_query: str | None = None,
    ) -> str:
        """Store a result and return a fresh result_id."""
        result_id = f"res_{uuid.uuid4().hex[:24]}"
        total = row_count if row_count is not None else len(rows)
        entry = {
            "rows": rows,
            "columns": columns,
            "row_count": total,
            "sql_query": sql_query,
            "expires_at": time.time() + self._ttl,
        }
        with self._lock:
            self._evict_expired_locked()
            # If we're at capacity, drop the oldest non-expired entry.
            if len(self._store) >= self._max:
                oldest_id = min(
                    self._store.keys(),
                    key=lambda k: self._store[k]["expires_at"],
                )
                del self._store[oldest_id]
            self._store[result_id] = entry
        return result_id

    def get(self, result_id: str) -> dict[str, Any] | None:
        with self._lock:
            entry = self._store.get(result_id)
            if entry is None:
                return None
            if entry["expires_at"] < time.time():
                del self._store[result_id]
                return None
            # Return a shallow copy so callers can't mutate the stored entry.
            return {
                "rows": list(entry["rows"]),
                "columns": list(entry["columns"]),
                "row_count": entry["row_count"],
                "sql_query": entry.get("sql_query"),
            }

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def _evict_expired_locked(self) -> None:
        now = time.time()
        expired = [k for k, v in self._store.items() if v["expires_at"] < now]
        for k in expired:
            del self._store[k]

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)


# Module-level singleton — shared by all chat requests in this process.
# Tests can construct their own ResultStore instance to avoid cross-test state.
GLOBAL_RESULT_STORE = ResultStore()


# ---------------------------------------------------------------------------
# Chart spec validation + payload composition
# ---------------------------------------------------------------------------

_ALLOWED_CHART_TYPES = {
    "scatter", "line", "bar", "histogram", "pie", "area",
}
# "heatmap" and "boxplot" are Phase 5 stubs — excluded here so the agent can
# never emit them and trigger an error boundary on the frontend.

# Encoding fields that must reference real column ids from the result.
_ENCODING_FIELDS = ("x", "y", "z", "color", "series")


class ChartSpecError(ValueError):
    """Raised when a chart_spec fails validation."""


class ChartPayloadService:
    """Validate a chart_spec against a stored SQL result and compose
    `{ spec, data, meta }` for the frontend.

    Validation rules:
      1. `result_id` must reference a result currently in the store.
      2. `chart_type` must be one of the allowed types.
      3. `title` must be a non-empty string.
      4. Every value in `encoding` (x, y, z, color, series) that is set must
         match a column id from the result metadata.
      5. Scatter / line / bar / histogram / area require `encoding.x`
         and `encoding.y` (histogram may use only `x`).
      6. Pie requires `encoding.color` (category) and `encoding.y` (value).

    Note: heatmap and boxplot are Phase 5 stubs; they are not in
    _ALLOWED_CHART_TYPES and will raise ChartSpecError if requested.

    If validation fails, `build` raises `ChartSpecError`. Callers should catch
    it and degrade gracefully (return the table + summary without a chart).
    """

    def __init__(self, result_store: ResultStore, display_limit: int = 500):
        self.result_store = result_store
        self.display_limit = display_limit

    def build(self, chart_spec: dict | None) -> dict | None:
        """Validate `chart_spec` and return `{ spec, data, meta }`.

        Returns None if `chart_spec` is None or empty (no chart requested).
        Raises ChartSpecError if the spec is malformed or references unknown
        columns.
        """
        if not chart_spec:
            return None

        if not isinstance(chart_spec, dict):
            raise ChartSpecError("chart_spec must be a JSON object")

        result_id = chart_spec.get("result_id")
        if not result_id or not isinstance(result_id, str):
            raise ChartSpecError("chart_spec.result_id is required")

        result = self.result_store.get(result_id)
        if result is None:
            raise ChartSpecError(
                f"result_id {result_id!r} not found or expired. Re-run the query."
            )

        chart_type = chart_spec.get("chart_type")
        if chart_type not in _ALLOWED_CHART_TYPES:
            raise ChartSpecError(
                f"unknown chart_type {chart_type!r}; "
                f"expected one of {sorted(_ALLOWED_CHART_TYPES)}"
            )

        title = chart_spec.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ChartSpecError("chart_spec.title must be a non-empty string")

        encoding = chart_spec.get("encoding") or {}
        if not isinstance(encoding, dict):
            raise ChartSpecError("chart_spec.encoding must be a JSON object")

        if chart_type == "histogram" and encoding.get("y"):
            # Models often set y="count" for histograms, but count is derived
            # by the frontend binning step, not a SQL result column.
            chart_spec = {**chart_spec, "encoding": {**encoding, "y": None}}
            encoding = chart_spec["encoding"]

        column_ids = {col["id"] for col in result["columns"]}
        for field_name in _ENCODING_FIELDS:
            value = encoding.get(field_name)
            if value is None or value == "":
                continue
            if not isinstance(value, str):
                raise ChartSpecError(
                    f"encoding.{field_name} must be a string column id"
                )
            if value not in column_ids:
                raise ChartSpecError(
                    f"encoding.{field_name}={value!r} is not in the SQL result "
                    f"columns {sorted(column_ids)}"
                )

        # Per-chart-type required encodings
        self._check_required_encodings(chart_type, encoding)

        rows = result["rows"]
        displayed = rows[: self.display_limit]
        return {
            "spec": chart_spec,
            "data": displayed,
            "meta": {
                "row_count": result["row_count"],
                "displayed_row_count": len(displayed),
                "truncated": result["row_count"] > len(displayed),
            },
        }

    @staticmethod
    def _check_required_encodings(chart_type: str, encoding: dict) -> None:
        x = encoding.get("x")
        y = encoding.get("y")
        z = encoding.get("z")
        color = encoding.get("color")

        if chart_type == "histogram":
            if not x:
                raise ChartSpecError("histogram requires encoding.x")
        elif chart_type == "pie":
            if not (color and y):
                raise ChartSpecError(
                    "pie requires encoding.color (category) and encoding.y (value)"
                )
        else:
            # scatter, line, bar, area, boxplot
            if not (x and y):
                raise ChartSpecError(
                    f"{chart_type} requires encoding.x and encoding.y"
                )
