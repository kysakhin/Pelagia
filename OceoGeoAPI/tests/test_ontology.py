"""Offline tests for the ontology files and loader."""

import textwrap

import pytest

from core.ontology import get_ontology, load_ontology


@pytest.fixture(scope="module")
def onto():
    return load_ontology()


def test_shipped_ontology_is_valid(onto):
    assert onto.validate() == []
    get_ontology()  # cached, raises if invalid


def test_covers_every_kind(onto):
    for kind in ("variable", "coordinate", "derived", "feature", "water_mass", "region"):
        assert onto.by_kind(kind), kind


def test_every_variable_with_requires_param_reads_that_param(onto):
    for v in onto.by_kind("variable"):
        param = v.get("requires_param")
        if param:
            assert f"'{param}'" in v.get("source")["sql"], v.id
            assert f"'{param}'" in v.get("source")["filter"], v.id


def test_required_params_are_transitive(onto):
    assert onto.required_params("oxygen_minimum_zone") == {"DOXY"}
    assert onto.required_params("deep_chlorophyll_maximum") == {"CHLA"}
    assert onto.required_params("mediterranean_outflow_water") == set()
    assert onto.required_params("mixed_layer") == set()


def test_unavailable_concepts(onto):
    assert not onto["density"].available
    assert [c.id for c in onto.unavailable_dependencies("density")] == ["density"]
    assert onto.unavailable_dependencies("mixed_layer_depth") == []


def test_regions_containing_prefers_most_specific(onto):
    # Project 8's float: ~24.5°N, 21.5°W
    ids = [r.id for r in onto.regions_containing(24.5, -21.5)]
    assert ids[:2] == ["canary_basin", "north_atlantic"]
    assert [r.id for r in onto.regions_containing(-70, 10)] == ["southern_ocean"]
    # Antimeridian-crossing basin
    assert "north_pacific" in [r.id for r in onto.regions_containing(30, -150)]
    assert "north_pacific" in [r.id for r in onto.regions_containing(30, 160)]


def test_region_filter_sql(onto):
    assert onto.region_filter_sql("canary_basin") == (
        "(latitude BETWEEN 20 AND 36 AND (longitude BETWEEN -30 AND -10))"
    )
    with pytest.raises(ValueError):
        onto.region_filter_sql("temperature")


def test_relations_both_directions(onto):
    assert ("identified_by", "intermediate_salinity_maximum") in onto.relations(
        "mediterranean_outflow_water"
    )
    assert ("identified_by", "mediterranean_outflow_water") in onto.incoming(
        "intermediate_salinity_maximum"
    )


def test_validator_catches_problems(tmp_path):
    (tmp_path / "bad.yaml").write_text(textwrap.dedent("""
        concepts:
          - id: temperature
            kind: variable
            label: Temperature
            aliases: [temp]
            meaning: x
            unit: C
            source: {sql: temperature}
            valid_range: [40, -2]
          - id: thing
            kind: derived
            label: Thing
            aliases: [Temp]
            requires: [nonexistent]
            definition: x
            method: x
            output: [a]
            sql_template: "DELETE FROM obs"
          - id: blob
            kind: region
            label: Blob
            aliases: [blob]
            lat: [10, 5]
            lon: [[0, 200]]
          - id: blob
            kind: wizard
            label: Dup
            aliases: [dup]
    """))
    errors = "\n".join(load_ontology(tmp_path).validate())
    assert "duplicate id: blob" in errors
    assert "unknown kind 'wizard'" in errors
    assert "valid_range" in errors
    assert "already used by temperature" in errors
    assert "unknown concept 'nonexistent'" in errors
    assert "rejected by scoped-SQL validator" in errors
