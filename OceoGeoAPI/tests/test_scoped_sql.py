"""Tests for the project-scoped SQL layer and the SQL self-correction loop."""

import json
from unittest.mock import MagicMock, patch

from core.chart_payload import ChartPayloadService, ResultStore
from core.chatbot import _SQL_CORRECTION_ATTEMPTS, run_sql_agent
from core.scoped_sql import (
    PROJECT_PARAM,
    SCOPED_CTES,
    build_scoped_query,
    validate_agent_sql,
)
from core.tools import create_sql_tool, extract_tool_args, extract_tool_result


# ---------------------------------------------------------------------------
# validate_agent_sql
# ---------------------------------------------------------------------------

class TestValidateAgentSql:
    def test_allows_select_and_with(self):
        assert validate_agent_sql("SELECT AVG(temperature) FROM obs") is None
        assert validate_agent_sql(
            "WITH t AS (SELECT * FROM obs) SELECT * FROM t"
        ) is None

    def test_allows_window_functions_and_distinct_on(self):
        q = ("SELECT DISTINCT ON (profile_id) profile_id, pressure, "
             "LAG(temperature) OVER (PARTITION BY profile_id ORDER BY pressure) "
             "FROM obs ORDER BY profile_id, ABS(pressure - 1000)")
        assert validate_agent_sql(q) is None

    def test_rejects_writes(self):
        for q in ("DELETE FROM measurements",
                  "WITH x AS (DELETE FROM files RETURNING *) SELECT * FROM x",
                  "SELECT 1; DROP TABLE files"):
            assert validate_agent_sql(q) is not None

    def test_rejects_multiple_statements(self):
        assert "single" in validate_agent_sql("SELECT 1; SELECT 2")

    def test_rejects_schema_qualified_escape(self):
        err = validate_agent_sql("SELECT * FROM public.measurements")
        assert err and "Schema-qualified" in err
        assert validate_agent_sql("SELECT * FROM information_schema.tables")

    def test_rejects_catalog_and_server_functions(self):
        assert validate_agent_sql("SELECT pg_sleep(100)")
        assert validate_agent_sql("SELECT * FROM pg_tables")
        assert validate_agent_sql("SELECT current_setting('x')")

    def test_keywords_inside_strings_and_comments_ignored(self):
        q = "SELECT 'please do not update' AS note -- drop everything\nFROM obs"
        assert validate_agent_sql(q) is None

    def test_column_names_containing_keywords_ok(self):
        assert validate_agent_sql(
            "SELECT upload_date, file_type FROM files"
        ) is None


# ---------------------------------------------------------------------------
# build_scoped_query
# ---------------------------------------------------------------------------

class TestBuildScopedQuery:
    def test_prefixes_scoped_ctes_and_wraps(self):
        out = build_scoped_query("SELECT * FROM obs", 5000)
        assert out.startswith(SCOPED_CTES)
        assert "SELECT * FROM (\nSELECT * FROM obs\n) AS _agent_query" in out

    def test_every_raw_table_is_shadowed(self):
        for table in ("projects", "files", "profiles", "measurements",
                      "project_parameters", "users", "conversations", "messages"):
            assert f"\n{table} AS NOT MATERIALIZED" in SCOPED_CTES

    def test_project_scoping_uses_named_param(self):
        assert f"%({PROJECT_PARAM})s" in SCOPED_CTES

    def test_legacy_placeholder_substituted(self):
        out = build_scoped_query(
            "SELECT 1 FROM files f WHERE f.project_id = {project_id}", 10
        )
        assert "{project_id}" not in out
        assert out.count(f"%({PROJECT_PARAM})s") == SCOPED_CTES.count(
            f"%({PROJECT_PARAM})s") + 1

    def test_percent_escaped_for_psycopg2(self):
        out = build_scoped_query(
            "SELECT cycle_number % 2 FROM obs WHERE filename LIKE '%nc'", 10
        )
        assert "cycle_number %% 2" in out
        assert "LIKE '%%nc'" in out


# ---------------------------------------------------------------------------
# run_sql_query tool integration
# ---------------------------------------------------------------------------

class _RecordingCursor:
    def __init__(self, log, owner="user_123", rows=None, description=None):
        self.log = log
        self.owner = owner
        self.rows = rows or []
        self.description = description or []

    def execute(self, q, p):
        self.log.append((q, p))

    def fetchone(self):
        return (self.owner,)

    def fetchall(self):
        return list(self.rows)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _recording_db(log):
    class _Conn:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def cursor(self, cursor_factory=None):
            return _RecordingCursor(log)

    db = MagicMock()
    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=_Conn())
    cm.__exit__ = MagicMock(return_value=False)
    db.get_connection = MagicMock(return_value=cm)
    db.verify_project_ownership = MagicMock()
    return db


class TestScopedTool:
    def _fn(self, db):
        tool = create_sql_tool(42, "user_123", db, result_store=ResultStore())
        return tool.entrypoint if hasattr(tool, "entrypoint") else tool.fn

    def test_query_runs_read_only_with_timeout_and_scope(self):
        log = []
        result = json.loads(self._fn(_recording_db(log))(
            query="SELECT AVG(temperature) AS t FROM obs"
        ))
        assert "error" not in result
        statements = [q for q, _ in log]
        assert statements[0] == "SET TRANSACTION READ ONLY"
        assert statements[1].startswith("SET LOCAL statement_timeout")
        final_q, final_p = log[-1]
        assert final_q.startswith(SCOPED_CTES)
        assert final_p == {PROJECT_PARAM: 42}

    def test_scope_escape_is_rejected_before_db(self):
        db = _recording_db([])
        result = json.loads(self._fn(db)(query="SELECT * FROM public.files"))
        assert "error" in result and result["retryable"] is True
        db.get_connection.assert_not_called()

    def test_write_is_rejected_non_retryable(self):
        result = json.loads(self._fn(_recording_db([]))(query="DROP TABLE files"))
        assert result["retryable"] is False


# ---------------------------------------------------------------------------
# last-call extraction
# ---------------------------------------------------------------------------

def _tool_use(name, result, args=None):
    tu = MagicMock()
    tu.tool_name = name
    tu.result = json.dumps(result)
    tu.tool_args = args or {}
    return tu


def test_extract_last_tool_call():
    response = MagicMock()
    response.tools = [
        _tool_use("run_sql_query", {"error": "bad"}, {"query": "SELECT bad"}),
        _tool_use("run_sql_query", {"result_id": "r2"}, {"query": "SELECT good"}),
    ]
    assert extract_tool_result(response, "run_sql_query") == {"error": "bad"}
    assert extract_tool_result(response, "run_sql_query", last=True) == {"result_id": "r2"}
    assert extract_tool_args(response, "run_sql_query", last=True) == {"query": "SELECT good"}


# ---------------------------------------------------------------------------
# Self-correction loop in run_sql_agent
# ---------------------------------------------------------------------------

def _response(tools, content=""):
    r = MagicMock()
    r.content = content
    r.tools = tools
    return r


class TestSelfCorrection:
    def _setup_store(self):
        store = ResultStore()
        rows = [{"avg_temperature": 4.5}]
        cols = [{"id": "avg_temperature", "type": "number"}]
        rid = store.put(rows=rows, columns=cols, row_count=1)
        ok = {"result_id": rid, "row_count": 1, "columns": cols, "sample_rows": rows}
        return store, ok

    def _db(self):
        db = MagicMock()
        db.get_project_parameters = MagicMock(return_value=[])
        return db

    @patch("core.chatbot.Agent")
    @patch("core.chatbot.make_model")
    def test_retries_with_error_then_succeeds(self, _model, agent_cls):
        store, ok = self._setup_store()
        failed = _response([_tool_use(
            "run_sql_query",
            {"error": 'UndefinedColumn: column "temp" does not exist', "retryable": True},
            {"query": "SELECT AVG(temp) FROM obs"},
        )])
        fixed = _response([_tool_use(
            "run_sql_query", ok, {"query": "SELECT AVG(temperature) AS avg_temperature FROM obs"},
        )])
        summary = _response([], content="Average is 4.5 °C.")
        agent = MagicMock()
        agent.run.side_effect = [failed, fixed, summary]
        agent_cls.return_value = agent

        result = run_sql_agent(
            message="average temperature?", user_id="u", project_id=1,
            system_message="sys", db=self._db(), result_store=store,
            chart_payload_service=ChartPayloadService(store),
        )

        assert result["data"] == [{"avg_temperature": 4.5}]
        assert "avg_temperature AS" in result["query"] or "AVG(temperature)" in result["query"]
        assert result["summary"] == "Average is 4.5 °C."
        correction_prompt = agent.run.call_args_list[1].args[0]
        assert "average temperature?" in correction_prompt
        assert "SELECT AVG(temp) FROM obs" in correction_prompt
        assert 'column "temp" does not exist' in correction_prompt

    @patch("core.chatbot.Agent")
    @patch("core.chatbot.make_model")
    def test_gives_up_after_max_attempts(self, _model, agent_cls):
        store, _ = self._setup_store()
        failed = _response([_tool_use(
            "run_sql_query", {"error": "SyntaxError: nope", "retryable": True},
            {"query": "SELEC"},
        )])
        agent = MagicMock()
        agent.run.return_value = failed
        agent_cls.return_value = agent

        result = run_sql_agent(
            message="q", user_id="u", project_id=1, system_message="sys",
            db=self._db(), result_store=store,
            chart_payload_service=ChartPayloadService(store),
        )
        assert result["summary"].startswith("Error:")
        assert agent.run.call_count == 1 + _SQL_CORRECTION_ATTEMPTS

    @patch("core.chatbot.Agent")
    @patch("core.chatbot.make_model")
    def test_non_retryable_error_not_retried(self, _model, agent_cls):
        store, _ = self._setup_store()
        denied = _response([_tool_use(
            "run_sql_query", {"error": "User does not own project", "retryable": False},
            {"query": "SELECT 1"},
        )])
        agent = MagicMock()
        agent.run.return_value = denied
        agent_cls.return_value = agent

        run_sql_agent(
            message="q", user_id="u", project_id=1, system_message="sys",
            db=self._db(), result_store=store,
            chart_payload_service=ChartPayloadService(store),
        )
        assert agent.run.call_count == 1

    @patch("core.chatbot.Agent")
    @patch("core.chatbot.make_model")
    def test_in_run_self_correction_uses_last_call(self, _model, agent_cls):
        store, ok = self._setup_store()
        both = _response([
            _tool_use("run_sql_query", {"error": "bad", "retryable": True}, {"query": "SELECT bad"}),
            _tool_use("run_sql_query", ok, {"query": "SELECT good"}),
        ])
        summary = _response([], content="ok")
        agent = MagicMock()
        agent.run.side_effect = [both, summary]
        agent_cls.return_value = agent

        result = run_sql_agent(
            message="q", user_id="u", project_id=1, system_message="sys",
            db=self._db(), result_store=store,
            chart_payload_service=ChartPayloadService(store),
        )
        assert result["query"] == "SELECT good"
        assert result["data"] == [{"avg_temperature": 4.5}]
        assert agent.run.call_count == 2  # no correction round needed


@patch("core.chatbot.Agent")
@patch("core.chatbot.make_model")
def test_charted_result_wins_over_later_exploratory_query(_model, agent_cls):
    store = ResultStore()
    rows = [{"observed_at": "2002-03-15", "mixed_layer_depth": 40.0}]
    cols = [{"id": "observed_at", "type": "datetime"}, {"id": "mixed_layer_depth", "type": "number"}]
    rid = store.put(rows=rows, columns=cols, row_count=1)
    stats_rid = store.put(rows=[{"n": 25}], columns=[{"id": "n", "type": "integer"}], row_count=1)
    answer = {"result_id": rid, "row_count": 1, "columns": cols, "sample_rows": rows}
    stats = {"result_id": stats_rid, "row_count": 1, "columns": [{"id": "n", "type": "integer"}], "sample_rows": []}
    viz = {"status": "ok", "chart_spec": {"result_id": rid, "chart_type": "line", "title": "MLD",
                                           "encoding": {"x": "observed_at", "y": "mixed_layer_depth"}}}
    resp = _response([
        _tool_use("run_sql_query", answer, {"query": "SELECT mld"}),
        _tool_use("create_visualization_spec", viz),
        _tool_use("run_sql_query", stats, {"query": "SELECT COUNT(*)"}),
    ])
    agent = MagicMock()
    agent.run.side_effect = [resp, _response([], content="ok")]
    agent_cls.return_value = agent

    result = run_sql_agent(message="mld over time", user_id="u", project_id=1, system_message="sys",
                           db=MagicMock(get_project_parameters=MagicMock(return_value=[])),
                           result_store=store, chart_payload_service=ChartPayloadService(store))
    assert result["query"] == "SELECT mld"
    assert result["data"] == rows
    assert result["chart_payload"] is not None
