"""Domain ontology: oceanographic concepts and how they relate.

The ontology lives as YAML in ``OceoGeoAPI/ontology/*.yaml``. Each file has a
top-level ``concepts:`` list; every concept has an ``id``, a ``kind``, a
``label`` and ``aliases`` (the words users say), plus kind-specific fields:

    variable    measured quantity: unit, source.sql (expression on the obs
                view), valid_range, requires_param (BGC), CF/Argo names
    coordinate  time / position
    derived     computed quantity: requires, method, references, tested
                sql_template, output columns, default_chart
    feature     phenomenon: feature_of (variables), measured_by (derived)
    water_mass  found_in (regions), identified_by (derived), depth range,
                core properties, signature
    region      lat [south, north], lon [[west, east], ...], part_of

Relations between concepts are the reference fields listed in ``_REFS``;
``validate()`` checks they point at existing concepts of the right kind.

This module only loads and validates. Matching questions to concepts and
injecting them into prompts is built on top of it.
"""

from __future__ import annotations

import functools
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import yaml

from core.scoped_sql import validate_agent_sql

ONTOLOGY_DIR = Path(__file__).resolve().parent.parent / "ontology"

KINDS = ("variable", "coordinate", "derived", "feature", "water_mass", "region")

# relation field -> (allowed target kinds, is_list)
_REFS: dict[str, tuple[set[str], bool]] = {
    "requires": ({"variable", "coordinate"}, True),
    "feature_of": ({"variable"}, True),
    "measured_by": ({"derived"}, False),
    "found_in": ({"region"}, True),
    "identified_by": ({"derived"}, False),
    "part_of": ({"region"}, False),
}


@dataclass(frozen=True)
class Concept:
    id: str
    kind: str
    label: str
    aliases: tuple[str, ...]
    data: dict[str, Any] = field(repr=False, hash=False, compare=False)
    source_file: str = ""

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    @property
    def available(self) -> bool:
        """False for concepts the app cannot compute yet (e.g. density)."""
        return self.data.get("available", True) is not False

    def refs(self, relation: str) -> list[str]:
        """Target ids of a relation field, always as a list."""
        value = self.data.get(relation)
        if value is None:
            return []
        return list(value) if isinstance(value, list) else [value]


class Ontology:
    def __init__(self, concepts: Iterable[Concept]):
        self.concepts: dict[str, Concept] = {}
        self._duplicate_ids: list[str] = []
        for c in concepts:
            if c.id in self.concepts:
                self._duplicate_ids.append(c.id)
            self.concepts[c.id] = c

    # ── Lookup ──────────────────────────────────────────────────────────────

    def __getitem__(self, concept_id: str) -> Concept:
        return self.concepts[concept_id]

    def __contains__(self, concept_id: str) -> bool:
        return concept_id in self.concepts

    def __len__(self) -> int:
        return len(self.concepts)

    def by_kind(self, kind: str) -> list[Concept]:
        return [c for c in self.concepts.values() if c.kind == kind]

    def relations(self, concept_id: str) -> list[tuple[str, str]]:
        """Outgoing (relation, target_id) edges of a concept."""
        c = self.concepts[concept_id]
        return [(rel, t) for rel in _REFS for t in c.refs(rel)]

    def incoming(self, concept_id: str) -> list[tuple[str, str]]:
        """Incoming (relation, source_id) edges pointing at a concept."""
        return [
            (rel, c.id)
            for c in self.concepts.values()
            for rel in _REFS
            if concept_id in c.refs(rel)
        ]

    def required_params(self, concept_id: str) -> set[str]:
        """BGC project_parameters needed (transitively) to compute a concept.

        Empty set = only core data (temperature/salinity/pressure) is needed.
        """
        seen: set[str] = set()
        params: set[str] = set()

        def walk(cid: str) -> None:
            if cid in seen or cid not in self.concepts:
                return
            seen.add(cid)
            c = self.concepts[cid]
            if c.get("requires_param"):
                params.add(c.get("requires_param"))
            for rel in ("requires", "feature_of", "measured_by", "identified_by"):
                for target in c.refs(rel):
                    walk(target)

        walk(concept_id)
        return params

    def unavailable_dependencies(self, concept_id: str) -> list[Concept]:
        """Concepts this one depends on that the app cannot compute yet."""
        out: list[Concept] = []
        seen: set[str] = set()

        def walk(cid: str) -> None:
            if cid in seen or cid not in self.concepts:
                return
            seen.add(cid)
            c = self.concepts[cid]
            if not c.available:
                out.append(c)
            for rel in ("requires", "feature_of", "measured_by", "identified_by"):
                for target in c.refs(rel):
                    walk(target)

        walk(concept_id)
        return out

    # ── Regions ─────────────────────────────────────────────────────────────

    def region_filter_sql(
        self, region_id: str, lat_col: str = "latitude", lon_col: str = "longitude"
    ) -> str:
        """SQL predicate selecting rows inside a region's bounding box(es)."""
        r = self.concepts[region_id]
        if r.kind != "region":
            raise ValueError(f"{region_id} is not a region")
        south, north = r.get("lat")
        lon_parts = " OR ".join(
            f"{lon_col} BETWEEN {west} AND {east}" for west, east in r.get("lon")
        )
        return f"({lat_col} BETWEEN {south} AND {north} AND ({lon_parts}))"

    def regions_containing(self, lat: float, lon: float) -> list[Concept]:
        """Regions whose box contains the point, most specific first."""
        hits = [
            r for r in self.by_kind("region")
            if r.get("lat")[0] <= lat <= r.get("lat")[1]
            and any(w <= lon <= e for w, e in r.get("lon"))
        ]
        # Sub-regions (part_of something) before their parents, then smaller boxes first.
        def area(r: Concept) -> float:
            s, n = r.get("lat")
            return (n - s) * sum(e - w for w, e in r.get("lon"))
        return sorted(hits, key=lambda r: (r.get("part_of") is None, area(r)))

    # ── Validation ──────────────────────────────────────────────────────────

    def validate(self) -> list[str]:
        """Return a list of human-readable problems (empty = valid)."""
        errors: list[str] = [f"duplicate id: {cid}" for cid in self._duplicate_ids]
        alias_owner: dict[str, str] = {}

        for c in self.concepts.values():
            where = f"{c.id} ({c.source_file})"
            if c.kind not in KINDS:
                errors.append(f"{where}: unknown kind {c.kind!r}")
                continue
            if not c.label:
                errors.append(f"{where}: missing label")
            if not c.aliases:
                errors.append(f"{where}: needs at least one alias")
            for alias in c.aliases:
                key = alias.strip().lower()
                if not key:
                    errors.append(f"{where}: empty alias")
                elif key in alias_owner and alias_owner[key] != c.id:
                    errors.append(f"{where}: alias {alias!r} already used by {alias_owner[key]}")
                else:
                    alias_owner[key] = c.id

            for pat in c.get("patterns") or []:
                try:
                    re.compile(pat)
                except re.error as exc:
                    errors.append(f"{where}: bad pattern {pat!r}: {exc}")

            for rel, (kinds, is_list) in _REFS.items():
                if rel not in c.data or c.data[rel] is None:
                    continue
                value = c.data[rel]
                if is_list != isinstance(value, list):
                    errors.append(f"{where}: {rel} must be {'a list' if is_list else 'a single id'}")
                    continue
                for target in c.refs(rel):
                    if target not in self.concepts:
                        errors.append(f"{where}: {rel} -> unknown concept {target!r}")
                    elif self.concepts[target].kind not in kinds:
                        errors.append(
                            f"{where}: {rel} -> {target} is a {self.concepts[target].kind}, "
                            f"expected {sorted(kinds)}"
                        )

            errors.extend(f"{where}: {e}" for e in _validate_kind(c))

        return errors


def _validate_kind(c: Concept) -> list[str]:
    errs: list[str] = []
    d = c.data

    def has(key: str) -> bool:
        return d.get(key) not in (None, "", [], {})

    if c.kind == "variable":
        if not has("meaning"):
            errs.append("variable needs `meaning`")
        if c.available:
            for key in ("unit", "source", "valid_range"):
                if not has(key):
                    errs.append(f"variable needs `{key}`")
            if has("source") and not d["source"].get("sql"):
                errs.append("variable source needs `sql`")
            vr = d.get("valid_range")
            if vr and not (isinstance(vr, list) and len(vr) == 2 and vr[0] < vr[1]):
                errs.append("valid_range must be [low, high] with low < high")
        elif not has("unavailable_reason"):
            errs.append("unavailable variable needs `unavailable_reason`")

    elif c.kind == "derived":
        for key in ("requires", "definition", "method", "sql_template", "output"):
            if not has(key):
                errs.append(f"derived needs `{key}`")
        if has("sql_template"):
            problem = validate_agent_sql(d["sql_template"].strip())
            if problem:
                errs.append(f"sql_template rejected by scoped-SQL validator: {problem}")

    elif c.kind == "feature":
        for key in ("feature_of", "definition"):
            if not has(key):
                errs.append(f"feature needs `{key}`")
        if has("sql_template"):
            problem = validate_agent_sql(d["sql_template"].strip())
            if problem:
                errs.append(f"sql_template rejected by scoped-SQL validator: {problem}")

    elif c.kind == "water_mass":
        for key in ("found_in", "depth_range_dbar", "core_properties", "signature", "references"):
            if not has(key):
                errs.append(f"water_mass needs `{key}`")
        dr = d.get("depth_range_dbar")
        if dr and not (isinstance(dr, list) and len(dr) == 2 and 0 <= dr[0] < dr[1]):
            errs.append("depth_range_dbar must be [top, bottom] with 0 <= top < bottom")

    elif c.kind == "region":
        lat, lon = d.get("lat"), d.get("lon")
        if not (isinstance(lat, list) and len(lat) == 2 and -90 <= lat[0] < lat[1] <= 90):
            errs.append("lat must be [south, north] within [-90, 90]")
        if not (isinstance(lon, list) and lon and all(
            isinstance(r, list) and len(r) == 2 and -180 <= r[0] < r[1] <= 180 for r in lon
        )):
            errs.append("lon must be a list of [west, east] ranges within [-180, 180]")

    elif c.kind == "coordinate":
        if not has("source"):
            errs.append("coordinate needs `source`")

    return errs


def load_ontology(directory: Path | str = ONTOLOGY_DIR) -> Ontology:
    """Load every *.yaml file in `directory` into an Ontology (not validated)."""
    concepts: list[Concept] = []
    for path in sorted(Path(directory).glob("*.yaml")):
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for raw in doc.get("concepts", []):
            concepts.append(
                Concept(
                    id=str(raw.get("id", "")),
                    kind=str(raw.get("kind", "")),
                    label=str(raw.get("label", "")),
                    aliases=tuple(str(a) for a in raw.get("aliases") or []),
                    data=raw,
                    source_file=path.name,
                )
            )
    return Ontology(concepts)


@functools.lru_cache(maxsize=1)
def get_ontology() -> Ontology:
    """The app's ontology, loaded once and validated (raises if invalid)."""
    onto = load_ontology()
    problems = onto.validate()
    if problems:
        raise ValueError("Invalid ontology:\n  " + "\n  ".join(problems))
    return onto
