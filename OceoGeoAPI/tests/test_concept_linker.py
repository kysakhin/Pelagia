"""Tests for concept linking, availability checks, prompt cards and wiring."""

from unittest.mock import MagicMock, patch

import pytest

from core.chatbot import _NO_ONTOLOGY_CONTEXT, _inject_ontology_context
from core.concept_linker import (
    MAX_CARDS,
    build_context,
    check_availability,
    expand,
    link_concepts,
    ontology_context_for,
    unavailable_answer,
)
from core.ontology import load_ontology


@pytest.fixture(scope="module")
def onto():
    return load_ontology()


def ids(matches):
    return [m.concept.id for m in matches]


class TestLinking:
    def test_longest_alias_wins(self, onto):
        assert "mixed_layer_depth" in ids(link_concepts("How deep is the mixed layer depth?", onto))
        found = ids(link_concepts("is there a deep chlorophyll maximum", onto))
        assert "deep_chlorophyll_maximum" in found
        assert "pressure" not in found  # "deep" is inside the longer match

    def test_case_and_punctuation_insensitive(self, onto):
        assert "mixed_layer_depth" in ids(link_concepts("MLD?", onto))
        assert "mediterranean_outflow_water" in ids(link_concepts("Any MOW here??", onto))

    def test_patterns(self, onto):
        assert "isotherm_depth" in ids(link_concepts("depth of the 12.5°C isotherm", onto))
        assert "value_at_depth" in ids(link_concepts("temperature at 500 m", onto))
        assert "oxygen_minimum" in ids(link_concepts("where is oxygen lowest", onto))

    def test_generic_where_is_not_position(self, onto):
        found = ids(link_concepts("where is the salinity maximum below 500 m?", onto))
        assert "position" not in found
        assert "intermediate_salinity_maximum" in found

    def test_unrelated_text(self, onto):
        assert link_concepts("hello there", onto) == []


def test_expand_follows_relations(onto):
    got = ids(expand(link_concepts("Is there Mediterranean Outflow Water?", onto), onto))
    assert got[:3] == ["mediterranean_outflow_water", "intermediate_salinity_maximum", "salinity"]
    got = ids(expand(link_concepts("thermocline depth changes", onto), onto))
    assert "thermocline_depth" in got and "temperature" in got


class TestAvailability:
    def test_missing_bgc_param_blocks(self, onto):
        av = check_availability(link_concepts("plot dissolved oxygen vs depth", onto), onto, [])
        assert av.blocking
        assert av.missing[0][0].id == "doxy"
        assert "DOXY" in av.missing[0][1]

    def test_partial_is_not_blocking(self, onto):
        av = check_availability(link_concepts("compare temperature and oxygen", onto), onto, [])
        assert not av.blocking
        assert [c.id for c, _ in av.missing] == ["doxy"]

    def test_available_param_passes(self, onto):
        av = check_availability(link_concepts("oxygen profile", onto), onto, ["DOXY", "DOXY_QC"])
        assert av.missing == []

    def test_unavailable_concept_blocks(self, onto):
        av = check_availability(link_concepts("plot potential density", onto), onto, [])
        assert av.blocking and "TEOS-10" in av.missing[0][1]

    def test_unknown_params_skip_bgc_check(self, onto):
        av = check_availability(link_concepts("oxygen profile", onto), onto, None)
        assert av.missing == []

    def test_answer_lists_what_exists(self, onto):
        av = check_availability(link_concepts("oxygen", onto), onto, [])
        text = unavailable_answer(av, [], onto)
        assert "Dissolved oxygen" in text and "core Argo data only" in text
        text = unavailable_answer(av, ["CHLA", "CHLA_QC"], onto)
        assert "CHLA" in text and "CHLA_QC" not in text


class TestContext:
    def test_cards_include_tested_sql_and_methods(self, onto):
        ctx, av, _ = ontology_context_for(
            "Is there Mediterranean Outflow Water?", onto, available_params=[],
            project_regions=onto.regions_containing(24.5, -21.5)[:1],
        )
        assert "Project location: profiles lie in Canary Basin" in ctx.prompt
        assert "Tested SQL" in ctx.prompt and "LEAD(salinity)" in ctx.prompt
        assert any("Emery & Meincke" in n for n in ctx.method_notes)
        assert not av.blocking

    def test_card_budget(self, onto):
        many = link_concepts(
            "temperature salinity oxygen chlorophyll mixed layer depth thermocline depth "
            "isotherm stratification anomaly backscatter", onto)
        ctx = build_context(expand(many, onto), onto)
        assert len(ctx.concept_ids) <= MAX_CARDS

    def test_previous_message_concepts_carry_over(self, onto):
        ctx, _, direct = ontology_context_for(
            "now do that for salinity", onto, available_params=[],
            previous_user_message="plot the mixed layer depth over time",
        )
        assert "salinity" in ids(direct) and "mixed_layer_depth" in ids(direct)
        assert ids(direct)[0] == "salinity"  # current question first

    def test_not_available_note_in_prompt(self, onto):
        ctx, _, _ = ontology_context_for("compare temperature and oxygen", onto, available_params=[])
        assert "NOT AVAILABLE — Dissolved oxygen" in ctx.prompt

    def test_empty_when_nothing_matches(self, onto):
        ctx, _, _ = ontology_context_for("how many profiles?", onto, available_params=[])
        assert ctx.prompt == "" and ctx.concept_ids == []


def test_inject_ontology_context():
    assert _inject_ontology_context("A {ontology_context} B", "cards") == "A cards B"
    assert _NO_ONTOLOGY_CONTEXT in _inject_ontology_context("A {ontology_context}", "")
    assert _inject_ontology_context("A", "cards").endswith("cards")


# ── ChatService wiring ──────────────────────────────────────────────────────

def _service(params):
    with patch("services.ChatService.NeonDBService"):
        from services.ChatService import ChatService
        svc = ChatService()
    svc.db = MagicMock()
    svc.db.get_project_parameters = MagicMock(return_value=params)
    svc.db.get_connection = MagicMock(side_effect=RuntimeError("no db in tests"))
    return svc


@patch("services.ChatService.run_sql_agent")
@patch("services.ChatService.classify_intent", return_value="SQL")
def test_blocking_question_skips_sql_agent(_intent, sql_agent):
    out = _service([]).process_message("Plot dissolved oxygen vs depth", "u", 8)
    sql_agent.assert_not_called()
    assert out["intent"] == "SQL"
    assert "DOXY" in out["summary"]
    assert out["concepts"][0] == {"id": "doxy", "label": "Dissolved oxygen", "kind": "variable"}


@patch("services.ChatService.run_sql_agent", return_value={"query": "q", "data": [], "summary": "s"})
@patch("services.ChatService.classify_intent", return_value="SQL")
def test_answerable_question_gets_cards(_intent, sql_agent):
    out = _service([]).process_message("How has the mixed layer depth changed?", "u", 8)
    kwargs = sql_agent.call_args.kwargs
    assert "Mixed layer depth" in kwargs["ontology_context"]
    assert kwargs["available_params"] == []
    assert any("de Boyer Montégut" in n for n in kwargs["method_notes"])
    assert "mixed_layer_depth" in [c["id"] for c in out["concepts"]]


@patch("services.ChatService.run_sql_agent", return_value={"query": "q", "data": [], "summary": "s"})
@patch("services.ChatService.get_ontology", side_effect=RuntimeError("broken ontology"))
@patch("services.ChatService.classify_intent", return_value="SQL")
def test_ontology_failure_degrades_gracefully(_intent, _onto, sql_agent):
    out = _service([]).process_message("mixed layer depth", "u", 8)
    assert sql_agent.call_args.kwargs["ontology_context"] == ""
    assert out["concepts"] == []


# ── Range checks and glossary ───────────────────────────────────────────────

def test_result_quality_flags(onto):
    from core.result_checks import result_quality_flags
    cols = [{"id": "avg_temperature", "type": "number"}, {"id": "smax_salinity", "type": "number"},
            {"id": "temperature_anomaly", "type": "number"}, {"id": "pressure_bin", "type": "number"},
            {"id": "observed_at", "type": "datetime"}]
    ok = {"avg_temperature": 12.0, "smax_salinity": 35.2, "temperature_anomaly": -55.0,
          "pressure_bin": 100.0, "observed_at": "2002"}
    # Anomaly columns are skipped even with large values.
    assert result_quality_flags([ok], cols, onto) == []
    # Counts of a variable are not readings of it.
    count_cols = [{"id": c, "type": "integer"} for c in ("non_null_pres", "n_temperature", "total_salinity_obs")]
    assert result_quality_flags([{"non_null_pres": 6819, "n_temperature": 900, "total_salinity_obs": 77}],
                                count_cols, onto) == []
    bad = dict(ok, avg_temperature=99.0, pressure_bin=-50.0)
    flags = result_quality_flags([ok, bad], cols, onto)
    assert len(flags) == 2
    assert any("avg_temperature" in f and "99" in f for f in flags)
    assert any("pressure_bin" in f for f in flags)


def test_glossary_from_ontology(onto):
    from core.concept_linker import glossary_text
    full = glossary_text(onto)
    for label in ("Temperature", "Salinity", "Nitrate", "pH (total scale)", "Sound speed"):
        assert f"- {label}" in full
    assert "Not available in OceoGeo data" in full  # density / sound speed
    focused = glossary_text(onto, ["mediterranean_outflow_water"])
    assert "Depth band: 600-1600 dbar" in focused
    assert "Intermediate salinity maximum" in focused
    assert "Nitrate" not in focused
