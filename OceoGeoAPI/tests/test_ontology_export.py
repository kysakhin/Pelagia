"""The generated ontology docs must match the YAML (regenerate on change)."""

import json

from core.ontology import get_ontology
from core.ontology_export import render, to_jsonld


def test_exports_are_up_to_date():
    for path, text in render(get_ontology()).items():
        assert path.exists(), f"{path} missing — run: python -m core.ontology_export"
        assert path.read_text(encoding="utf-8") == text, (
            f"{path.name} is stale — run: .venv/bin/python -m core.ontology_export"
        )


def test_jsonld_is_a_skos_scheme_with_every_concept():
    onto = get_ontology()
    doc = json.loads(json.dumps(to_jsonld(onto)))
    concepts = [n for n in doc["@graph"] if n["@type"] == "skos:Concept"]
    assert {n["@id"] for n in concepts} == {f"oceogeo:{cid}" for cid in onto.concepts}
    temp = next(n for n in concepts if n["@id"] == "oceogeo:temperature")
    assert temp["skos:exactMatch"]["@id"].endswith("/standard_name/sea_water_temperature/")
    mow = next(n for n in concepts if n["@id"] == "oceogeo:mediterranean_outflow_water")
    assert {"@id": "oceogeo:intermediate_salinity_maximum"} in mow["oceogeo:identifiedBy"]
    assert len(mow["skos:altLabel"]) == len({a.lower() for a in mow["skos:altLabel"]})
