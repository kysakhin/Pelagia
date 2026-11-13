"""Export the ontology as a SKOS knowledge graph (JSON-LD) and a Mermaid diagram.

Usage (from OceoGeoAPI/):
    .venv/bin/python -m core.ontology_export            # writes docs/ontology/
    .venv/bin/python -m core.ontology_export --check    # fail if outputs are stale

Outputs (repo root):
    docs/ontology/ontology.jsonld   SKOS concept scheme; variables linked to CF
                                    standard names via skos:exactMatch
    docs/ontology/graph.md          Mermaid concept graph + concept table

The YAML in OceoGeoAPI/ontology/ stays the source of truth; these files are
generated for sharing, review and visualisation.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # OceoGeoAPI/
sys.path.insert(0, str(ROOT))

from core.ontology import Ontology, get_ontology  # noqa: E402

OUT_DIR = ROOT.parent / "docs" / "ontology"
BASE = "https://oceogeo.app/ontology#"
CF_BASE = "http://vocab.nerc.ac.uk/standard_name/"

# YAML relation -> RDF property (custom properties live in the oceogeo namespace)
_RELATIONS = {
    "requires": "oceogeo:derivedFrom",
    "feature_of": "oceogeo:featureOf",
    "measured_by": "oceogeo:measuredBy",
    "found_in": "oceogeo:foundIn",
    "identified_by": "oceogeo:identifiedBy",
    "part_of": "skos:broader",
}

_KIND_TITLE = {
    "variable": "Variables",
    "coordinate": "Coordinates",
    "derived": "Derived quantities",
    "feature": "Features",
    "water_mass": "Water masses",
    "region": "Regions",
}


def _one(text) -> str | None:
    return " ".join(str(text).split()) if text else None


def _alt_labels(c) -> list[str]:
    """Aliases minus the preferred label and case-only duplicates."""
    seen = {c.label.lower()}
    out = []
    for a in c.aliases:
        if a.lower() not in seen:
            seen.add(a.lower())
            out.append(a)
    return out


def to_jsonld(onto: Ontology) -> dict:
    graph: list[dict] = [{
        "@id": "oceogeo:scheme",
        "@type": "skos:ConceptScheme",
        "dct:title": "OceoGeo oceanographic ontology",
        "dct:description": "Concepts used to ground natural-language questions about Argo float data.",
    }]
    for kind, title in _KIND_TITLE.items():
        members = [f"oceogeo:{c.id}" for c in onto.by_kind(kind)]
        if members:
            graph.append({"@id": f"oceogeo:collection_{kind}", "@type": "skos:Collection",
                          "skos:prefLabel": title, "skos:member": members})

    for c in sorted(onto.concepts.values(), key=lambda c: (c.kind, c.id)):
        node: dict = {
            "@id": f"oceogeo:{c.id}",
            "@type": "skos:Concept",
            "skos:inScheme": "oceogeo:scheme",
            "skos:prefLabel": c.label,
            "skos:altLabel": _alt_labels(c),
            "oceogeo:kind": c.kind,
        }
        definition = _one(c.get("definition") or c.get("meaning") or c.get("signature"))
        if definition:
            node["skos:definition"] = definition
        if c.get("method") or c.get("detection"):
            node["oceogeo:method"] = _one(c.get("method") or c.get("detection"))
        if c.get("unit"):
            node["oceogeo:unit"] = c.get("unit")
        if c.get("argo_name"):
            node["oceogeo:argoParameter"] = c.get("argo_name")
        if c.get("cf_standard_name"):
            node["skos:exactMatch"] = {"@id": f"{CF_BASE}{c.get('cf_standard_name')}/"}
        if c.get("references"):
            node["dct:source"] = c.get("references")
        if not c.available:
            node["oceogeo:available"] = False
        if c.kind == "region":
            node["oceogeo:latRange"] = c.get("lat")
            node["oceogeo:lonRanges"] = c.get("lon")
        if c.kind == "water_mass":
            node["oceogeo:depthRangeDbar"] = c.get("depth_range_dbar")
        for rel, prop in _RELATIONS.items():
            targets = c.refs(rel)
            if targets:
                node[prop] = [{"@id": f"oceogeo:{t}"} for t in targets]
        graph.append(node)

    return {
        "@context": {
            "skos": "http://www.w3.org/2004/02/skos/core#",
            "dct": "http://purl.org/dc/terms/",
            "oceogeo": BASE,
        },
        "@graph": graph,
    }


def _mermaid(onto: Ontology) -> str:
    # Coordinates and pressure are linked to nearly everything; leaving them
    # out keeps the diagram readable.
    hidden = {"pressure"} | {c.id for c in onto.by_kind("coordinate")}
    lines = ["```mermaid", "flowchart LR"]
    styles = {
        "variable": "fill:#F2F7FB,stroke:#4A87BE",
        "derived": "fill:#F3F9F5,stroke:#4E9A6B",
        "feature": "fill:#FBF8F2,stroke:#B08A4A",
        "water_mass": "fill:#F7F5FB,stroke:#8064A2",
        "region": "fill:#F8F9FA,stroke:#7A8A9A",
    }
    for kind, title in _KIND_TITLE.items():
        concepts = [c for c in onto.by_kind(kind) if c.id not in hidden]
        if not concepts:
            continue
        lines.append(f'  subgraph {kind}["{title}"]')
        for c in concepts:
            label = c.label.replace('"', "'") + ("<br/><i>not available</i>" if not c.available else "")
            lines.append(f'    {c.id}["{label}"]')
        lines.append("  end")
    # found_in (water mass -> regions) is many-to-many and swamps the layout;
    # it is listed in the concept table and the JSON-LD instead.
    edge_label = {"requires": "uses", "feature_of": "feature of", "measured_by": "measured by",
                  "identified_by": "identified by", "part_of": "part of"}
    for c in sorted(onto.concepts.values(), key=lambda c: c.id):
        if c.id in hidden:
            continue
        for rel, label in edge_label.items():
            for t in c.refs(rel):
                if t not in hidden:
                    lines.append(f"  {c.id} -->|{label}| {t}")
    for kind, style in styles.items():
        ids = [c.id for c in onto.by_kind(kind) if c.id not in hidden]
        if ids:
            lines.append(f"  classDef {kind} {style}")
            lines.append(f"  class {','.join(ids)} {kind}")
    lines.append("```")
    return "\n".join(lines)


def to_markdown(onto: Ontology) -> str:
    out = [
        "# OceoGeo ontology — concept graph",
        "",
        "_Generated by `OceoGeoAPI/core/ontology_export.py` from `OceoGeoAPI/ontology/*.yaml`. "
        "Do not edit by hand._",
        "",
        f"{len(onto)} concepts. Pressure and the time/position coordinates are omitted from the "
        "diagram because almost everything uses them; water-mass → region (`found in`) links are "
        "listed in the tables below.",
        "",
        _mermaid(onto),
        "",
        "## Concepts",
        "",
    ]
    for kind, title in _KIND_TITLE.items():
        concepts = sorted(onto.by_kind(kind), key=lambda c: c.label)
        if not concepts:
            continue
        out += [f"### {title}", "", "| Concept | Aliases (sample) | Definition | Standard |", "|---|---|---|---|"]
        for c in concepts:
            definition = _one(c.get("definition") or c.get("meaning") or c.get("signature")) or ""
            if len(definition) > 140:
                definition = definition[:137] + "…"
            if not c.available:
                definition = "**Not available yet.** " + definition
            std = c.get("cf_standard_name") or c.get("argo_name") or ""
            if c.kind == "region":
                std = f"lat {c.get('lat')}, lon {c.get('lon')}"
            if c.kind == "water_mass":
                std = (f"{c.get('depth_range_dbar')[0]}–{c.get('depth_range_dbar')[1]} dbar; found in "
                       + ", ".join(onto[r].label for r in c.refs("found_in")))
            aliases = ", ".join(list(c.aliases)[:4]).replace("|", "/")
            out.append(f"| **{c.label}** (`{c.id}`) | {aliases} | {definition.replace('|', '/')} | {std} |")
        out.append("")
    return "\n".join(out)


def render(onto: Ontology) -> dict[Path, str]:
    return {
        OUT_DIR / "ontology.jsonld": json.dumps(to_jsonld(onto), indent=1, ensure_ascii=False) + "\n",
        OUT_DIR / "graph.md": to_markdown(onto) + "\n",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="exit 1 if generated files are out of date")
    args = ap.parse_args()
    files = render(get_ontology())
    stale = [p for p, text in files.items() if not p.exists() or p.read_text(encoding="utf-8") != text]
    if args.check:
        if stale:
            print("Out of date: " + ", ".join(str(p) for p in stale) +
                  "\nRun: .venv/bin/python -m core.ontology_export")
            sys.exit(1)
        print("Ontology exports are up to date.")
        return
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for path, text in files.items():
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()
