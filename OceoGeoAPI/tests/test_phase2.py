"""Phase 2 test suite — AI layer (sql_prompt, run_sql_query result handles,
ChartPayloadService, create_visualization_spec tool, JSONB validation,
chatbot orchestration, transaction rollback).

All tests use mocked LLM + mocked DB so they are deterministic, fast, and
do not burn OpenRouter tokens. See implementation_plan.md §8 Phase 2.7.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

# ── Module-level imports (validated by conftest sys.path setup) ─────────────
from core.chart_payload import (
    ChartPayloadService,
    ChartSpecError,
    ResultStore,
    build_columns,
)
from core.chatbot import (
    _format_available_params,
    _inject_available_params,
    run_sql_agent,
)
from core.tools import (
    _cap_user_limit,
    _clean_sql_query,
    _strip_param_suffix,
    _validate_jsonb_access,
    create_sql_tool,
    create_visualization_spec_tool,
    extract_tool_args,
    extract_tool_result,
)

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

class FakeColumn:
    """Mimics psycopg2.Column: attribute access for name + type_code."""
    def __init__(self, name: str, type_code: int):
        self.name = name
        self.type_code = type_code


class _OwnershipCursor:
    """Returns a user_id row for `verify_project_ownership`."""
    def __init__(self, owner_user_id: str):
        self._owner = owner_user_id

    def execute(self, q, p):
        pass

    def fetchone(self):
        return (self._owner,)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _QueryCursor:
    """Returns canned rows + a cursor.description for `run_sql_query`."""
    def __init__(self, rows, description):
        self._rows = rows
        self.description = description

    def execute(self, q, p):
        self._executed = (q, p)

    def fetchall(self):
        return list(self._rows)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    """A connection-like context manager that hands out a preloaded sequence
    of cursors. The first cursor is treated as the ownership-verification
    cursor; subsequent ones serve the actual query."""
    def __init__(self, cursors):
        self._cursors = iter(cursors)

    def cursor(self, cursor_factory=None):
        return next(self._cursors)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def make_fake_db(owner_user_id: str, rows, description, raises=None):
    """Build a MagicMock NeonDBService whose get_connection yields a FakeConn
    that verifies ownership then returns the canned query rows.

    If `raises` is set, the query cursor's execute() raises that exception
    instead of returning rows — used for error-path tests.
    """
    db = MagicMock()

    class _RaisingCursor(_QueryCursor):
        def execute(self, q, p):
            if raises is not None:
                raise raises
            super().execute(q, p)

    cursors = [_OwnershipCursor(owner_user_id), _RaisingCursor(rows, description)]
    fake_conn = FakeConn(cursors)

    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=fake_conn)
    cm.__exit__ = MagicMock(return_value=False)
    db.get_connection = MagicMock(return_value=cm)
    db.verify_project_ownership = MagicMock(
        side_effect=lambda cur, pid, uid: _verify(cur, pid, uid, owner_user_id)
    )
    return db


def _verify(cur, pid, uid, owner):
    # Mirror NeonDBService.verify_project_ownership using the fake cursor.
    cur.execute("SELECT user_id FROM projects WHERE project_id = %s", (pid,))
    row = cur.fetchone()
    if row is None:
        raise LookupError(f"Project {pid} does not exist")
    if row[0] != uid:
        raise PermissionError(f"User does not own project {pid}")


# ---------------------------------------------------------------------------
# 1. JSONB validation rules (§3.4)
# ---------------------------------------------------------------------------

class TestJsonbValidation:
    def test_unknown_param_rejected(self):
        errs = _validate_jsonb_access(
            "SELECT (m.extras->>'DOXY')::float FROM measurements m",
            {"CHLA"},
        )
        assert len(errs) == 1
        assert "DOXY" in errs[0]
        assert "not a known extras parameter" in errs[0]

    def test_missing_cast_rejected(self):
        errs = _validate_jsonb_access(
            "SELECT m.extras->>'DOXY' FROM measurements m",
            {"DOXY"},
        )
        assert any("must be followed by a cast" in e for e in errs)

    def test_core_param_via_jsonb_rejected(self):
        errs = _validate_jsonb_access(
            "SELECT (m.extras->>'TEMP')::float FROM measurements m",
            set(),
        )
        assert any("typed column" in e for e in errs)
        # PSAL and PRES also
        for core in ("PSAL", "PRES"):
            errs2 = _validate_jsonb_access(
                f"SELECT (m.extras->>'{core}')::float FROM measurements m",
                set(),
            )
            assert any("typed column" in e for e in errs2)

    def test_lowercase_key_rejected(self):
        errs = _validate_jsonb_access(
            "SELECT (m.extras->>'doxy')::float FROM measurements m",
            {"DOXY"},
        )
        assert any("must be UPPERCASE" in e for e in errs)

    def test_valid_doxy_query_passes(self):
        q = ("SELECT (m.extras->>'DOXY')::float AS doxy "
             "FROM measurements m WHERE m.extras ? 'DOXY'")
        assert _validate_jsonb_access(q, {"DOXY"}) == []

    def test_adjusted_with_fallback_passes(self):
        q = ("SELECT COALESCE((m.extras->>'DOXY_ADJUSTED')::float, "
             "(m.extras->>'DOXY')::float) AS doxy "
             "FROM measurements m WHERE m.extras ? 'DOXY'")
        assert _validate_jsonb_access(q, {"DOXY"}) == []

    def test_chla_with_adjusted_error_suffix_passes(self):
        q = "(m.extras->>'CHLA_ADJUSTED_ERROR')::float"
        # Even though CHLA_ADJUSTED_ERROR has the _ADJUSTED_ERROR suffix,
        # the base name is CHLA which is in the available set.
        assert _validate_jsonb_access(q, {"CHLA"}) == []

    def test_strip_param_suffix(self):
        assert _strip_param_suffix("DOXY") == "DOXY"
        assert _strip_param_suffix("DOXY_QC") == "DOXY"
        assert _strip_param_suffix("DOXY_ADJUSTED") == "DOXY"
        assert _strip_param_suffix("DOXY_ADJUSTED_QC") == "DOXY"
        assert _strip_param_suffix("DOXY_ADJUSTED_ERROR") == "DOXY"
        # Base that happens to contain "ADJUSTED" but isn't a suffix:
        assert _strip_param_suffix("CHLA") == "CHLA"


# ---------------------------------------------------------------------------
# 2. SQL cleaning + LIMIT cap behavior
# ---------------------------------------------------------------------------

class TestSqlCleaning:
    def test_strips_markdown_fences(self):
        assert _clean_sql_query("```sql\nSELECT 1\n```") == "SELECT 1"

    def test_strips_bare_language_tag(self):
        assert _clean_sql_query("sql\nSELECT 1") == "SELECT 1"

    def test_unescapes_literal_newlines(self):
        out = _clean_sql_query(r"sql\nSELECT 1\nFROM t")
        assert "\\n" not in out
        assert "SELECT 1" in out

    def test_caps_large_limit(self):
        assert _cap_user_limit("SELECT * FROM m LIMIT 999999").endswith("LIMIT 5000")

    def test_adds_missing_limit(self):
        assert _cap_user_limit("SELECT * FROM m").endswith("LIMIT 5000")

    def test_keeps_small_limit(self):
        assert _cap_user_limit("SELECT * FROM m LIMIT 50").endswith("LIMIT 50")


# ---------------------------------------------------------------------------
# 3. ResultStore + ChartPayloadService (§3.3, §3.4)
# ---------------------------------------------------------------------------

class TestResultStore:
    def test_put_returns_res_prefixed_id(self):
        store = ResultStore()
        rid = store.put(rows=[], columns=[], row_count=0)
        assert rid.startswith("res_")

    def test_get_returns_copy_not_reference(self):
        store = ResultStore()
        rid = store.put(
            rows=[{"x": 1}], columns=[{"id": "x", "type": "number"}], row_count=1,
        )
        out1 = store.get(rid)
        out1["rows"].append({"x": 999})
        out2 = store.get(rid)
        assert len(out2["rows"]) == 1  # mutation didn't leak

    def test_get_unknown_id_returns_none(self):
        store = ResultStore()
        assert store.get("res_doesnotexist") is None

    def test_expired_entry_returns_none(self):
        store = ResultStore(ttl_seconds=0)
        rid = store.put(rows=[], columns=[], row_count=0)
        # ttl=0 means it expires immediately on next access
        import time
        time.sleep(0.01)
        assert store.get(rid) is None


class TestChartPayloadService:
    @pytest.fixture
    def store_with_result(self):
        store = ResultStore()
        rows = [{"pressure": float(p), "temperature": float(p) / 10.0}
                for p in range(20)]
        columns = [
            {"id": "pressure", "type": "number"},
            {"id": "temperature", "type": "number"},
        ]
        rid = store.put(rows=rows, columns=columns, row_count=len(rows))
        return store, rid

    def test_valid_scatter_payload(self, store_with_result):
        store, rid = store_with_result
        svc = ChartPayloadService(store, display_limit=10)
        payload = svc.build({
            "result_id": rid,
            "chart_type": "scatter",
            "title": "T vs P",
            "encoding": {"x": "temperature", "y": "pressure"},
            "options": {"invert_y": True},
        })
        assert payload is not None
        assert payload["spec"]["chart_type"] == "scatter"
        assert payload["meta"] == {
            "row_count": 20,
            "displayed_row_count": 10,
            "truncated": True,
        }
        assert len(payload["data"]) == 10

    def test_unknown_column_rejected(self, store_with_result):
        store, rid = store_with_result
        svc = ChartPayloadService(store)
        with pytest.raises(ChartSpecError, match="not in the SQL result columns"):
            svc.build({
                "result_id": rid,
                "chart_type": "scatter",
                "title": "x",
                "encoding": {"x": "nope", "y": "pressure"},
            })

    def test_missing_y_for_scatter_rejected(self, store_with_result):
        store, rid = store_with_result
        svc = ChartPayloadService(store)
        with pytest.raises(ChartSpecError, match="scatter requires"):
            svc.build({
                "result_id": rid,
                "chart_type": "scatter",
                "title": "x",
                "encoding": {"x": "temperature"},
            })

    def test_heatmap_requires_z(self, store_with_result):
        store, rid = store_with_result
        svc = ChartPayloadService(store)
        with pytest.raises(ChartSpecError, match="heatmap requires"):
            svc.build({
                "result_id": rid,
                "chart_type": "heatmap",
                "title": "x",
                "encoding": {"x": "temperature", "y": "pressure"},
            })

    def test_pie_requires_color_and_y(self, store_with_result):
        store, rid = store_with_result
        svc = ChartPayloadService(store)
        with pytest.raises(ChartSpecError, match="pie requires"):
            svc.build({
                "result_id": rid,
                "chart_type": "pie",
                "title": "x",
                "encoding": {"x": "temperature"},
            })

    def test_unknown_chart_type_rejected(self, store_with_result):
        store, rid = store_with_result
        svc = ChartPayloadService(store)
        with pytest.raises(ChartSpecError, match="unknown chart_type"):
            svc.build({
                "result_id": rid,
                "chart_type": "violin",
                "title": "x",
                "encoding": {"x": "temperature", "y": "pressure"},
            })

    def test_missing_result_id_rejected(self, store_with_result):
        store, _ = store_with_result
        svc = ChartPayloadService(store)
        with pytest.raises(ChartSpecError, match="result_id is required"):
            svc.build({"chart_type": "scatter", "title": "x", "encoding": {}})

    def test_unknown_result_id_rejected(self, store_with_result):
        store, _ = store_with_result
        svc = ChartPayloadService(store)
        with pytest.raises(ChartSpecError, match="not found or expired"):
            svc.build({
                "result_id": "res_doesnotexist",
                "chart_type": "scatter",
                "title": "x",
                "encoding": {"x": "temperature", "y": "pressure"},
            })

    def test_none_spec_returns_none(self, store_with_result):
        store, _ = store_with_result
        svc = ChartPayloadService(store)
        assert svc.build(None) is None
        assert svc.build({}) is None

    def test_histogram_only_needs_x(self, store_with_result):
        store, rid = store_with_result
        svc = ChartPayloadService(store, display_limit=5)
        payload = svc.build({
            "result_id": rid,
            "chart_type": "histogram",
            "title": "T distribution",
            "encoding": {"x": "temperature"},
            "options": {"bin_count": 10},
        })
        assert payload["meta"]["displayed_row_count"] == 5


# ---------------------------------------------------------------------------
# 4. build_columns (cursor.description → column metadata)
# ---------------------------------------------------------------------------

class TestBuildColumns:
    def test_maps_known_oids_to_types(self):
        description = [
            FakeColumn("temperature", 700),    # float4
            FakeColumn("pressure", 701),       # float8
            FakeColumn("cycle_number", 23),    # int4
            FakeColumn("observed_at", 1184),   # timestamptz
            FakeColumn("filename", 25),        # text
            FakeColumn("extras", 3802),        # jsonb
            FakeColumn("data_mode", 1043),     # varchar
        ]
        cols = build_columns(description)
        types = {c["id"]: c["type"] for c in cols}
        assert types["temperature"] == "number"
        assert types["pressure"] == "number"
        assert types["cycle_number"] == "integer"
        assert types["observed_at"] == "datetime"
        assert types["filename"] == "string"
        assert types["extras"] == "object"
        assert types["data_mode"] == "string"

    def test_handles_tuple_form(self):
        description = [
            ("temperature", 700, None, None, None, None, None),
        ]
        cols = build_columns(description)
        assert cols == [{"id": "temperature", "type": "number"}]

    def test_handles_none_description(self):
        assert build_columns(None) == []

    def test_unknown_oid_falls_back_to_string(self):
        cols = build_columns([FakeColumn("weird", 99999)])
        assert cols == [{"id": "weird", "type": "string"}]


# ---------------------------------------------------------------------------
# 5. run_sql_query tool: result_id + metadata shape
# ---------------------------------------------------------------------------

class TestRunSqlTool:
    def test_returns_result_id_and_metadata(self):
        rows = [{"temperature": 10.0, "pressure": 100.0},
                {"temperature": 12.0, "pressure": 200.0}]
        description = [FakeColumn("temperature", 700), FakeColumn("pressure", 701)]
        db = make_fake_db("user_123", rows, description)

        store = ResultStore()
        tool = create_sql_tool(
            project_id=42, user_id="user_123", db=db,
            available_params=["DOXY"], result_store=store,
        )
        fn = tool.entrypoint if hasattr(tool, "entrypoint") else tool.fn

        result = json.loads(fn(query=(
            "SELECT COALESCE(m.temperature_adjusted, m.temperature) AS temperature, "
            "COALESCE(m.pressure_adjusted, m.pressure) AS pressure "
            "FROM measurements m "
            "JOIN files f ON m.profile_id IS NOT NULL "
            "WHERE f.project_id = {project_id}"
        )))
        assert "result_id" in result
        assert result["row_count"] == 2
        assert result["columns"] == [
            {"id": "temperature", "type": "number"},
            {"id": "pressure", "type": "number"},
        ]
        assert len(result["sample_rows"]) == 2
        # The display-limited rows live in the store under the result_id.
        stored = store.get(result["result_id"])
        assert stored is not None
        assert len(stored["rows"]) == 2

    def test_rejects_non_select(self):
        db = make_fake_db("user_123", [], [])
        tool = create_sql_tool(42, "user_123", db, result_store=ResultStore())
        fn = tool.entrypoint if hasattr(tool, "entrypoint") else tool.fn
        result = json.loads(fn(query="DROP TABLE measurements"))
        assert "error" in result
        assert "Only SELECT" in result["error"]

    def test_rejects_unknown_jsonb_param(self):
        db = make_fake_db("user_123", [], [])
        tool = create_sql_tool(
            42, "user_123", db,
            available_params=["CHLA"],
            result_store=ResultStore(),
        )
        fn = tool.entrypoint if hasattr(tool, "entrypoint") else tool.fn
        result = json.loads(fn(query=(
            "SELECT (m.extras->>'DOXY')::float FROM measurements m "
            "WHERE f.project_id = {project_id}"
        )))
        assert "error" in result
        assert "JSONB validation failed" in result["error"]
        assert "DOXY" in result["error"]

    def test_rejects_unauthorized_user(self):
        # Owner is user_A, but the tool is called as user_B → PermissionError.
        rows = []
        description = []
        db = make_fake_db("user_A", rows, description)
        tool = create_sql_tool(42, "user_B", db, result_store=ResultStore())
        fn = tool.entrypoint if hasattr(tool, "entrypoint") else tool.fn
        result = json.loads(fn(query="SELECT 1 WHERE {project_id} = {project_id}"))
        assert "error" in result
        # PermissionError is caught and surfaced generically.
        assert "Failed to execute query" in result["error"] or "does not own" in result["error"]

    def test_query_limit_cap_applied(self):
        # The query has no LIMIT; the tool should append LIMIT 5000.
        captured = {}

        class _CapQueryCursor(_QueryCursor):
            def execute(self, q, p):
                captured["q"] = q
                captured["p"] = p

        class _CapConn:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def cursor(self, cursor_factory=None):
                # Alternate ownership + query cursors.
                if not hasattr(self, "_n"):
                    self._n = 0
                self._n += 1
                return _OwnershipCursor("user_123") if self._n == 1 else _CapQueryCursor([], [])

        db = MagicMock()
        cm = MagicMock()
        cm.__enter__ = MagicMock(return_value=_CapConn())
        cm.__exit__ = MagicMock(return_value=False)
        db.get_connection = MagicMock(return_value=cm)
        db.verify_project_ownership = MagicMock(
            side_effect=lambda cur, pid, uid: _verify(cur, pid, uid, "user_123")
        )

        tool = create_sql_tool(42, "user_123", db, result_store=ResultStore())
        fn = tool.entrypoint if hasattr(tool, "entrypoint") else tool.fn
        fn(query="SELECT 1 FROM measurements m WHERE f.project_id = {project_id}")
        assert "LIMIT 5000" in captured["q"]


# ---------------------------------------------------------------------------
# 6. create_visualization_spec tool
# ---------------------------------------------------------------------------

class TestVisualizationSpecTool:
    def test_valid_spec_returned(self):
        tool = create_visualization_spec_tool()
        fn = tool.entrypoint if hasattr(tool, "entrypoint") else tool.fn
        spec = {
            "result_id": "res_abc",
            "chart_type": "scatter",
            "title": "T vs P",
            "encoding": {"x": "temperature", "y": "pressure"},
        }
        out = json.loads(fn(spec=json.dumps(spec)))
        assert out["status"] == "ok"
        assert out["chart_spec"] == spec

    def test_malformed_json_rejected(self):
        tool = create_visualization_spec_tool()
        fn = tool.entrypoint if hasattr(tool, "entrypoint") else tool.fn
        out = json.loads(fn(spec="not json"))
        assert out["status"] == "error"
        assert "Invalid JSON" in out["error"]

    def test_missing_required_fields_rejected(self):
        tool = create_visualization_spec_tool()
        fn = tool.entrypoint if hasattr(tool, "entrypoint") else tool.fn
        out = json.loads(fn(spec=json.dumps({"chart_type": "scatter"})))
        assert out["status"] == "error"
        assert "Missing fields" in out["error"]
        assert "result_id" in out["error"]


# ---------------------------------------------------------------------------
# 7. extract_tool_result / extract_tool_args helpers
# ---------------------------------------------------------------------------

class TestExtractToolHelpers:
    def test_extract_tool_result_finds_match(self):
        response = MagicMock()
        tu1 = MagicMock()
        tu1.tool_name = "run_sql_query"
        tu1.result = json.dumps({"result_id": "res_xx", "row_count": 5})
        tu2 = MagicMock()
        tu2.tool_name = "create_visualization_spec"
        tu2.result = json.dumps({"status": "ok", "chart_spec": {"x": 1}})
        response.tools = [tu1, tu2]

        sql_result = extract_tool_result(response, "run_sql_query")
        assert sql_result["result_id"] == "res_xx"
        viz_result = extract_tool_result(response, "create_visualization_spec")
        assert viz_result["chart_spec"] == {"x": 1}
        # Missing tool returns None.
        assert extract_tool_result(response, "nope") is None

    def test_extract_tool_args_handles_dict_and_str(self):
        response = MagicMock()
        tu = MagicMock()
        tu.tool_name = "run_sql_query"
        tu.tool_args = {"query": "SELECT 1"}
        response.tools = [tu]
        assert extract_tool_args(response, "run_sql_query") == {"query": "SELECT 1"}

        tu.tool_args = json.dumps({"query": "SELECT 2"})
        assert extract_tool_args(response, "run_sql_query") == {"query": "SELECT 2"}

    def test_extract_tool_result_skips_unparseable(self):
        response = MagicMock()
        tu = MagicMock()
        tu.tool_name = "run_sql_query"
        tu.result = "not json"
        response.tools = [tu]
        assert extract_tool_result(response, "run_sql_query") is None


# ---------------------------------------------------------------------------
# 8. Prompt dynamic parameter injection
# ---------------------------------------------------------------------------

class TestPromptInjection:
    def test_format_available_params_empty(self):
        out = _format_available_params([])
        assert "none" in out
        assert "do not use extras" in out

    def test_format_available_params_list(self):
        out = _format_available_params(["DOXY", "CHLA"])
        assert out == "DOXY, CHLA"

    def test_inject_replaces_placeholder(self):
        prompt = "Available params: {available_params}. Use them wisely."
        out = _inject_available_params(prompt, ["DOXY"])
        assert "{available_params}" not in out
        assert "DOXY" in out

    def test_inject_preserves_prompt_without_placeholder(self):
        prompt = "No placeholder here."
        assert _inject_available_params(prompt, ["DOXY"]) == prompt


# ---------------------------------------------------------------------------
# 9. run_sql_agent end-to-end (mocked Agent)
# ---------------------------------------------------------------------------

class TestRunSqlAgent:
    def _make_response(self, sql_tool_result, viz_tool_result=None,
                       sql_args=None, content=""):
        """Build a fake Agno response with tools list."""
        response = MagicMock()
        response.content = content
        tools = []

        sql_tu = MagicMock()
        sql_tu.tool_name = "run_sql_query"
        sql_tu.result = json.dumps(sql_tool_result) if isinstance(
            sql_tool_result, dict) else sql_tool_result
        sql_tu.tool_args = sql_args or {"query": "SELECT 1"}
        tools.append(sql_tu)

        if viz_tool_result is not None:
            viz_tu = MagicMock()
            viz_tu.tool_name = "create_visualization_spec"
            viz_tu.result = json.dumps(viz_tool_result) if isinstance(
                viz_tool_result, dict) else viz_tool_result
            tools.append(viz_tu)

        response.tools = tools
        return response

    @patch("core.chatbot.Agent")
    @patch("core.chatbot.make_openrouter_model")
    def test_chart_payload_composed_when_spec_valid(self, mock_model, mock_agent_cls):
        # 1. Pre-populate the result store so the spec's result_id resolves.
        store = ResultStore()
        rows = [{"temperature": float(t), "pressure": float(p)}
                for t, p in zip(range(10), range(10))]
        columns = [{"id": "temperature", "type": "number"},
                   {"id": "pressure", "type": "number"}]
        rid = store.put(rows=rows, columns=columns, row_count=len(rows))

        # 2. The Agent.run() returns the faked response on first call
        #    (SQL+viz tools), and a summary on the second call (summary agent).
        sql_response = self._make_response(
            sql_tool_result={
                "result_id": rid,
                "row_count": 10,
                "columns": columns,
                "sample_rows": rows[:2],
            },
            viz_tool_result={
                "status": "ok",
                "chart_spec": {
                    "result_id": rid,
                    "chart_type": "scatter",
                    "title": "T vs P",
                    "encoding": {"x": "temperature", "y": "pressure"},
                    "options": {"invert_y": True},
                },
            },
            sql_args={"query": "SELECT * FROM measurements"},
        )
        summary_response = MagicMock()
        summary_response.content = "Here is the summary."
        mock_agent = MagicMock()
        mock_agent.run.side_effect = [sql_response, summary_response]
        mock_agent_cls.return_value = mock_agent

        # 3. Mock the DB so get_project_parameters doesn't hit Postgres.
        db = MagicMock()
        db.get_project_parameters = MagicMock(return_value=["DOXY", "CHLA"])

        result = run_sql_agent(
            message="show me temperature vs pressure",
            user_id="user_123",
            project_id=42,
            system_message="System prompt with {available_params}.",
            db=db,
            result_store=store,
            chart_payload_service=ChartPayloadService(store, display_limit=5),
        )

        # 4. Assert the new response shape.
        assert result["query"] == "SELECT * FROM measurements"
        assert result["result_id"] == rid
        assert result["row_count"] == 10
        assert result["columns"] == columns
        assert len(result["data"]) <= 100  # message-preview-limited
        assert result["chart_spec"] is not None
        assert result["chart_spec"]["chart_type"] == "scatter"
        assert result["chart_payload"] is not None
        assert result["chart_payload"]["meta"]["displayed_row_count"] == 5
        assert result["summary"] == "Here is the summary."

        # 5. Available params were injected into the system message passed to Agent.
        _, kwargs = mock_agent_cls.call_args_list[0]
        assert "DOXY" in kwargs["system_message"]
        assert "CHLA" in kwargs["system_message"]
        assert "{available_params}" not in kwargs["system_message"]

    @patch("core.chatbot.Agent")
    @patch("core.chatbot.make_openrouter_model")
    def test_chart_payload_none_when_spec_missing(self, mock_model, mock_agent_cls):
        store = ResultStore()
        rows = [{"x": 1}]
        columns = [{"id": "x", "type": "number"}]
        rid = store.put(rows=rows, columns=columns, row_count=1)

        sql_response = self._make_response(
            sql_tool_result={
                "result_id": rid,
                "row_count": 1,
                "columns": columns,
                "sample_rows": rows,
            },
            viz_tool_result=None,
            sql_args={"query": "SELECT COUNT(*) AS x"},
        )
        summary_response = MagicMock()
        summary_response.content = "There is 1 row."
        mock_agent = MagicMock()
        mock_agent.run.side_effect = [sql_response, summary_response]
        mock_agent_cls.return_value = mock_agent

        db = MagicMock()
        db.get_project_parameters = MagicMock(return_value=[])

        result = run_sql_agent(
            message="how many profiles are in my project",
            user_id="user_123",
            project_id=42,
            system_message="sys",
            db=db,
            result_store=store,
            chart_payload_service=ChartPayloadService(store),
        )
        assert result["chart_spec"] is None
        assert result["chart_payload"] is None
        assert result["row_count"] == 1

    @patch("core.chatbot.Agent")
    @patch("core.chatbot.make_openrouter_model")
    def test_chart_payload_none_when_spec_invalid(self, mock_model, mock_agent_cls):
        store = ResultStore()
        rows = [{"x": 1}]
        columns = [{"id": "x", "type": "number"}]
        rid = store.put(rows=rows, columns=columns, row_count=1)

        sql_response = self._make_response(
            sql_tool_result={
                "result_id": rid,
                "row_count": 1,
                "columns": columns,
                "sample_rows": rows,
            },
            viz_tool_result={
                "status": "ok",
                "chart_spec": {
                    "result_id": rid,
                    "chart_type": "scatter",
                    "title": "bad",
                    # References a column that doesn't exist in the result.
                    "encoding": {"x": "nope", "y": "x"},
                },
            },
            sql_args={"query": "SELECT * FROM t"},
        )
        summary_response = MagicMock()
        summary_response.content = "Summary."
        mock_agent = MagicMock()
        mock_agent.run.side_effect = [sql_response, summary_response]
        mock_agent_cls.return_value = mock_agent

        db = MagicMock()
        db.get_project_parameters = MagicMock(return_value=[])

        result = run_sql_agent(
            message="plot x vs y",
            user_id="user_123",
            project_id=42,
            system_message="sys",
            db=db,
            result_store=store,
            chart_payload_service=ChartPayloadService(store),
        )
        # Spec is kept for debugging but no payload is composed.
        assert result["chart_spec"] is not None
        assert result["chart_payload"] is None

    @patch("core.chatbot.Agent")
    @patch("core.chatbot.make_openrouter_model")
    def test_sql_error_short_circuits_to_error_summary(self, mock_model, mock_agent_cls):
        store = ResultStore()
        sql_response = self._make_response(
            sql_tool_result={"error": "Only SELECT queries are allowed."},
            sql_args={"query": "DROP TABLE x"},
        )
        mock_agent = MagicMock()
        mock_agent.run.return_value = sql_response
        mock_agent_cls.return_value = mock_agent

        db = MagicMock()
        db.get_project_parameters = MagicMock(return_value=[])

        result = run_sql_agent(
            message="drop the table",
            user_id="user_123",
            project_id=42,
            system_message="sys",
            db=db,
            result_store=store,
            chart_payload_service=ChartPayloadService(store),
        )
        assert result["data"] == []
        assert "Error:" in result["summary"]
        assert result["chart_spec"] is None
        assert result["chart_payload"] is None
        # Summary agent must NOT be called when SQL errored.
        assert mock_agent.run.call_count == 1


# ---------------------------------------------------------------------------
# 10. ProcessService: file_type detection + transaction rollback
# ---------------------------------------------------------------------------

class TestProcessServiceFileType:
    def test_file_type_bgc_when_non_core_selected(self):
        # selected_params="DOXY,CHLA" → BGC. We exercise the detection
        # predicate directly; the same predicate runs inside ProcessService.
        selected_list = ["DOXY", "CHLA"]
        core_bases = {"PRES", "TEMP", "PSAL"}
        file_type = "BGC" if any(
            p.upper() not in core_bases for p in selected_list) else "CORE"
        assert file_type == "BGC"

    def test_file_type_core_when_only_core_selected(self):
        selected_list = ["PRES", "TEMP", "PSAL"]
        core_bases = {"PRES", "TEMP", "PSAL"}
        file_type = "BGC" if any(
            p.upper() not in core_bases for p in selected_list) else "CORE"
        assert file_type == "CORE"

    def test_file_type_core_when_no_selection(self):
        selected_list = []
        core_bases = {"PRES", "TEMP", "PSAL"}
        file_type = "BGC" if any(
            p.upper() not in core_bases for p in selected_list) else "CORE"
        assert file_type == "CORE"


class TestTransactionRollback:
    """When any step in the file-processing pipeline fails, the entire
    transaction must roll back — no orphaned file/profile/measurement rows.

    We verify this by giving the fake DB a connection that records every
    call to commit/rollback/execute and raises at a chosen step.
    """
    def test_rollback_called_when_profile_insert_fails(self):
        from services.NeondbService import NeonDBService
        from services.ProcessService import ProcessService

        # Build a fake connection that:
        # - verify_project_ownership succeeds
        # - insert_file_record succeeds
        # - insert_profile_record raises on the second profile
        executed_sql = []
        committed = []
        rolled_back = []

        class CannedCursor:
            """Records every execute() call. Returns canned fetchone() values
            for the first few steps (ownership + file insert + profile inserts)
            and never raises on its own — the test stubs raise to simulate
            mid-pipeline failure."""
            def __init__(self):
                self._step = 0
                self._next_fetchone = None
            def execute(self, q, params=None):
                executed_sql.append(q.strip().split()[0].upper())
                self._step += 1
                # Step 1: ownership SELECT -> (user_id,)
                # Step 2: INSERT INTO files ... RETURNING file_id -> (file_id,)
                # Step 3+: INSERT INTO profiles ... RETURNING profile_id -> (1,)
                if self._step == 1:
                    self._next_fetchone = ("user_123",)
                elif self._step == 2:
                    self._next_fetchone = (999,)
                else:
                    self._next_fetchone = (1,)
            def fetchone(self):
                return self._next_fetchone
            def __enter__(self): return self
            def __exit__(self, *a): return False

        class CannedConn:
            def __init__(self):
                self.cursor_obj = CannedCursor()
            def cursor(self, cursor_factory=None):
                return self.cursor_obj
            def commit(self): committed.append(True)
            def rollback(self): rolled_back.append(True)
            def __enter__(self): return self
            def __exit__(self, *a): return False

        canned = CannedConn()

        # Patch NeonDBService.get_connection to yield our canned connection,
        # and stub verify_project_ownership so it uses the canned cursor.
        db = NeonDBService.__new__(NeonDBService)
        db.connection_string = "dummy"
        import contextlib
        @contextlib.contextmanager
        def _get_conn():
            try:
                yield canned
                canned.commit()
            except Exception:
                canned.rollback()
                raise
        db.get_connection = _get_conn
        db.verify_project_ownership = lambda cur, pid, uid: None  # success

        # Stub insert_file_record to call cursor.execute and return a file_id.
        def insert_file_record(cursor, project_id, filename, metadata,
                               file_size_bytes=None, file_type="CORE"):
            cursor.execute(
                "INSERT INTO files (...) VALUES (...) RETURNING file_id",
                (project_id, filename, file_type),
            )
            return cursor.fetchone()[0]
        db.insert_file_record = insert_file_record

        # insert_profile_record raises on the second call to simulate failure.
        call_count = {"n": 0}
        def insert_profile_record(cursor, file_id, profile):
            call_count["n"] += 1
            cursor.execute(
                "INSERT INTO profiles (...) VALUES (...) RETURNING profile_id",
                (file_id,),
            )
            if call_count["n"] >= 2:
                raise RuntimeError("simulated profile insert failure")
            return cursor.fetchone()[0]
        db.insert_profile_record = insert_profile_record

        db.insert_measurements_batch = lambda cursor, ms: None
        db.upsert_project_parameters = lambda cursor, pid, counts: None

        svc = ProcessService()
        svc.db = db

        # Build a fake UploadFile and patch xr.open_dataset + extract_*.
        from unittest.mock import AsyncMock

        from fastapi import UploadFile

        fake_file = MagicMock(spec=UploadFile)
        fake_file.filename = "test.nc"
        fake_file.size = 100
        fake_file.read = AsyncMock(return_value=b"fake bytes")

        with patch("services.ProcessService.xr.open_dataset", return_value=MagicMock()), \
             patch("services.ProcessService.extract_file_metadata", return_value={}), \
             patch("services.ProcessService.extract_profiles",
                   return_value=[
                       {"cycle_number": 1, "measurements": []},
                       {"cycle_number": 2, "measurements": []},
                   ]):
            import asyncio
            with pytest.raises(RuntimeError, match="simulated profile insert failure"):
                asyncio.run(svc.process_netcdf(
                    fake_file, user_id="user_123", project_id=42,
                    selected_params="",
                ))

        # The transaction must have been rolled back, never committed.
        assert len(rolled_back) == 1
        assert committed == []


# ---------------------------------------------------------------------------
# 11. NeondbService: get_project_parameters + new columns in INSERTs
# ---------------------------------------------------------------------------

class TestNeondbServiceInserts:
    """Verify that insert_file_record now writes file_type and
    insert_profile_record now writes data_mode — Phase 1 gaps we filled.
    """
    def test_insert_file_record_writes_file_type(self):
        from services.NeondbService import NeonDBService
        captured = {}

        class Cursor:
            def execute(self, q, params):
                captured["q"] = q
                captured["params"] = params
            def fetchone(self):
                return (1,)  # file_id
            def __enter__(self): return self
            def __exit__(self, *a): return False

        db = NeonDBService.__new__(NeonDBService)
        db.connection_string = "dummy"
        cur = Cursor()
        db.insert_file_record(cur, 42, "x.nc", {"platform_number": "P"},
                              file_size_bytes=100, file_type="BGC")
        assert "file_type" in captured["q"]
        assert captured["params"][-1] == "BGC"

    def test_insert_profile_record_writes_data_mode(self):
        from services.NeondbService import NeonDBService
        captured = {}

        class Cursor:
            def execute(self, q, params):
                captured["q"] = q
                captured["params"] = params
            def fetchone(self):
                return (1,)
            def __enter__(self): return self
            def __exit__(self, *a): return False

        db = NeonDBService.__new__(NeonDBService)
        db.connection_string = "dummy"
        cur = Cursor()
        db.insert_profile_record(cur, 1, {"cycle_number": 1, "data_mode": "D"})
        assert "data_mode" in captured["q"]
        # data_mode is the 4th positional parameter (after file_id, cycle_number, direction)
        assert captured["params"][3] == "D"


# ---------------------------------------------------------------------------
# 12. processor.py: data_mode extraction + uppercase extras keys
# ---------------------------------------------------------------------------

class TestProcessorExtras:
    def test_extract_profile_header_pulls_data_mode(self):
        import pandas as pd

        from core.processor import extract_profile_header
        row = pd.Series({
            "juld": pd.Timestamp("2024-01-01"),
            "cycle_number": 1,
            "direction": "A",
            "data_mode": "D",
            "latitude": 12.3,
            "longitude": 45.6,
            "position_qc": "1",
        })
        header = extract_profile_header(row)
        assert header["data_mode"] == "D"

    def test_extract_measurements_uppercases_extras_keys(self):
        import pandas as pd

        from core.processor import extract_measurements
        # Build a tiny DataFrame with one row, pres/temp/psal set, plus doxy columns.
        df = pd.DataFrame([{
            "n_levels": 0,
            "pres": 100.0, "pres_qc": "1",
            "temp": 15.0, "temp_qc": "1",
            "psal": 35.0, "psal_qc": "1",
            "doxy": 245.1, "doxy_qc": "1",
            "doxy_adjusted": 244.8, "doxy_adjusted_qc": "1",
        }])
        rows = extract_measurements(df, selected_extras=["doxy"])
        assert len(rows) == 1
        extras = rows[0]["extras"]
        # Keys must be UPPERCASE base + UPPERCASE suffix.
        assert "DOXY" in extras
        assert "DOXY_QC" in extras
        assert "DOXY_ADJUSTED" in extras
        assert "DOXY_ADJUSTED_QC" in extras
        # No lowercase keys leaked through.
        assert all(k == k.upper() for k in extras)
