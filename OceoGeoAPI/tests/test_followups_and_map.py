"""Tests for conversation history (follow-ups) and the map chart type."""

from unittest.mock import MagicMock, patch

import pytest

from core.chart_payload import ChartPayloadService, ChartSpecError, ResultStore
from core.chatbot import (
    _HISTORY_CONTENT_CHARS,
    _HISTORY_MAX_TURNS,
    _infer_chart_spec,
    classify_intent,
    format_history,
    run_sql_agent,
    with_history,
)


class TestFormatHistory:
    def test_empty(self):
        assert format_history(None) == ""
        assert format_history([]) == ""

    def test_includes_previous_sql(self):
        text = format_history([
            {"role": "user", "content": "plot temperature vs depth"},
            {"role": "assistant", "content": "Here it is.", "sql_query": "SELECT temperature FROM obs"},
        ])
        assert "User: plot temperature vs depth" in text
        assert "Assistant: Here it is." in text
        assert "SELECT temperature FROM obs" in text

    def test_keeps_only_recent_turns(self):
        turns = [{"role": "user", "content": f"q{i}"} for i in range(20)]
        text = format_history(turns)
        assert "q19" in text
        assert f"q{19 - _HISTORY_MAX_TURNS}" not in text

    def test_truncates_long_content(self):
        text = format_history([{"role": "assistant", "content": "x" * 5000}])
        assert len(text) < _HISTORY_CONTENT_CHARS + 50

    def test_with_history_passthrough_when_empty(self):
        assert with_history("hello", "") == "hello"

    def test_with_history_marks_current_question(self):
        out = with_history("now for salinity", "User: plot temperature")
        assert out.endswith("Current question: now for salinity")
        assert "User: plot temperature" in out


@patch("core.chatbot.Agent")
@patch("core.chatbot.make_model")
def test_sql_agent_receives_history(_model, agent_cls):
    store = ResultStore()
    rows = [{"salinity": 35.0}]
    cols = [{"id": "salinity", "type": "number"}]
    rid = store.put(rows=rows, columns=cols, row_count=1)
    tu = MagicMock(tool_name="run_sql_query", tool_args={"query": "SELECT salinity FROM obs"})
    tu.result = '{"result_id": "%s", "row_count": 1, "columns": [{"id": "salinity", "type": "number"}], "sample_rows": []}' % rid
    sql_resp = MagicMock(content="", tools=[tu])
    summary = MagicMock(content="ok", tools=[])
    agent = MagicMock()
    agent.run.side_effect = [sql_resp, summary]
    agent_cls.return_value = agent
    db = MagicMock()
    db.get_project_parameters = MagicMock(return_value=[])

    run_sql_agent(
        message="now do that for salinity", user_id="u", project_id=1,
        system_message="sys", db=db, result_store=store,
        chart_payload_service=ChartPayloadService(store),
        history_text="User: plot temperature vs depth\n[SQL ...]\nSELECT temperature FROM obs",
    )
    sql_input = agent.run.call_args_list[0].args[0]
    assert "SELECT temperature FROM obs" in sql_input
    assert sql_input.endswith("Current question: now do that for salinity")


@patch("core.chatbot.Agent")
@patch("core.chatbot.make_model")
def test_intent_classifier_receives_history(_model, agent_cls):
    agent = MagicMock()
    agent.run.return_value = MagicMock(content="SQL")
    agent_cls.return_value = agent
    assert classify_intent("now for salinity", "sys", "User: plot temperature") == "SQL"
    assert "User: plot temperature" in agent.run.call_args.args[0]


class TestMapChart:
    def _store(self):
        store = ResultStore()
        rows = [{"longitude": 73.4, "latitude": -40.3, "observed_at": "2006-10-22"}]
        cols = [{"id": "longitude", "type": "number"}, {"id": "latitude", "type": "number"},
                {"id": "observed_at", "type": "datetime"}]
        return store, store.put(rows=rows, columns=cols, row_count=1)

    def test_map_spec_accepted(self):
        store, rid = self._store()
        payload = ChartPayloadService(store).build({
            "result_id": rid, "chart_type": "map", "title": "Track",
            "encoding": {"x": "longitude", "y": "latitude", "color": "observed_at"},
        })
        assert payload["spec"]["chart_type"] == "map"

    def test_map_requires_coordinates(self):
        store, rid = self._store()
        with pytest.raises(ChartSpecError):
            ChartPayloadService(store).build({
                "result_id": rid, "chart_type": "map", "title": "Track",
                "encoding": {"x": "longitude"},
            })

    def test_inferred_from_wording(self):
        cols = [{"id": c} for c in ("file_id", "observed_at", "latitude", "longitude")]
        spec = _infer_chart_spec("where has the float been?", "res_1", cols)
        assert spec["chart_type"] == "map"
        assert spec["encoding"] == {
            "x": "longitude", "y": "latitude", "color": "observed_at", "series": "file_id",
        }
