"""Sanity checks on SQL results using the ontology's physical valid ranges.

A result column is checked against a variable's ``valid_range`` when its name
refers to that variable (``temperature``, ``avg_temperature``,
``smax_salinity``, ``min_doxy`` …). Columns that hold *differences* or
statistics of a variable (anomaly, change, gradient, stddev, correlation …)
are skipped — their values are not on the variable's physical scale.
"""

from __future__ import annotations

import re

from core.ontology import Ontology

_SKIP = re.compile(
    r"anomal|increase|change|diff|delta|gradient|dtdp|std|stddev|var(iance)?\b|corr|count|^n$|^n_|_n$"
    r"|pct|percent|ratio|slope|trend|null|total|num|number|_obs|samples|levels|range"
)


def _variable_for_column(column: str, onto: Ontology):
    col = column.lower()
    if _SKIP.search(col):
        return None
    for v in onto.by_kind("variable"):
        if not v.available or not v.get("valid_range"):
            continue
        tokens = {v.id, (v.get("argo_name") or "").lower()}
        if v.id == "pressure":
            tokens |= {"pressure", "pres"}
        for t in tokens:
            if t and re.search(rf"(^|_){re.escape(t)}($|_)", col):
                return v
    return None


def result_quality_flags(rows: list[dict], columns: list[dict], onto: Ontology) -> list[str]:
    """Human-readable warnings for values outside physically valid ranges."""
    flags: list[str] = []
    for col in columns:
        cid = col.get("id")
        if not isinstance(cid, str) or col.get("type") not in ("number", "integer", None):
            continue
        var = _variable_for_column(cid, onto)
        if var is None:
            continue
        lo, hi = var.get("valid_range")
        values = [r.get(cid) for r in rows]
        bad = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)
               and not (lo <= v <= hi)]
        if bad:
            flags.append(
                f"{len(bad)} value(s) in `{cid}` are outside the physically valid range for "
                f"{var.label.lower()} ({lo} to {hi} {var.get('unit')}), e.g. {bad[0]:g} — "
                "likely bad data; consider filtering with QC flags."
            )
    return flags
