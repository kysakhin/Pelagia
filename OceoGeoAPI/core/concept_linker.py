"""Link a user question to ontology concepts and turn them into prompt context.

Pipeline (no LLM involved, ~1 ms):

1. ``link_concepts`` finds concepts mentioned in the text by alias (word
   boundaries, longest alias first so "mixed layer depth" wins over "mixed
   layer") and by regex ``patterns`` (e.g. "the 10°C isotherm").
2. ``expand`` follows relations so the agent gets what it needs to compute
   the answer: a feature brings its measuring derived quantity, a water mass
   its detector, a derived quantity its required variables.
3. ``check_availability`` compares the concepts with the project's BGC
   parameters and the ontology's unavailable concepts (e.g. density).
4. ``build_context`` renders compact "concept cards" for the SQL prompt and
   short method notes for the summary/provenance.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from core.ontology import Concept, Ontology

# Never worth a card on their own: implied by nearly every question.
_BACKGROUND = {"pressure", "time", "position"}
# Card budget so prompts stay small however large the ontology grows.
MAX_CARDS = 6


@dataclass(frozen=True)
class ConceptMatch:
    concept: Concept
    matched: str          # alias / pattern text that matched, or "via <id>"
    direct: bool          # mentioned by the user (vs. pulled in by a relation)


def _normalise(text: str) -> str:
    text = text.lower().replace("–", "-").replace("—", "-")
    return re.sub(r"[^\w°.\-~ ]+", " ", text)


@dataclass
class _AliasIndex:
    entries: list[tuple[str, re.Pattern, str]] = field(default_factory=list)
    patterns: list[tuple[re.Pattern, str]] = field(default_factory=list)


_INDEX_CACHE: dict[int, _AliasIndex] = {}


def _index(onto: Ontology) -> _AliasIndex:
    cached = _INDEX_CACHE.get(id(onto))
    if cached:
        return cached
    idx = _AliasIndex()
    for c in onto.concepts.values():
        for alias in c.aliases:
            a = _normalise(alias).strip()
            if a:
                idx.entries.append((a, re.compile(rf"(?<!\w){re.escape(a)}(?!\w)"), c.id))
        for pat in c.get("patterns") or []:
            idx.patterns.append((re.compile(pat, re.IGNORECASE), c.id))
    # Longest alias first: multi-word, specific aliases claim their span
    # before shorter generic ones ("deep chlorophyll maximum" before "deep").
    idx.entries.sort(key=lambda e: -len(e[0]))
    _INDEX_CACHE[id(onto)] = idx
    return idx


def link_concepts(text: str, onto: Ontology) -> list[ConceptMatch]:
    """Concepts the text mentions directly, in order of first appearance."""
    norm = _normalise(text)
    idx = _index(onto)
    claimed = [False] * len(norm)
    found: dict[str, tuple[int, str]] = {}

    for pat, cid in idx.patterns:
        m = pat.search(norm)
        if m and cid not in found:
            found[cid] = (m.start(), m.group(0).strip())
            for i in range(m.start(), m.end()):
                claimed[i] = True

    for alias, rx, cid in idx.entries:
        for m in rx.finditer(norm):
            if any(claimed[m.start():m.end()]):
                continue  # inside a longer match
            for i in range(m.start(), m.end()):
                claimed[i] = True
            if cid not in found:
                found[cid] = (m.start(), alias)
            break

    ordered = sorted(found.items(), key=lambda kv: kv[1][0])
    return [ConceptMatch(onto[cid], matched, True) for cid, (_, matched) in ordered]


def expand(matches: list[ConceptMatch], onto: Ontology) -> list[ConceptMatch]:
    """Add concepts needed to answer: detectors, measuring quantities, variables."""
    out = list(matches)
    seen = {m.concept.id for m in matches}

    def add(cid: str | None, via: str) -> None:
        if cid and cid not in seen and cid in onto:
            seen.add(cid)
            out.append(ConceptMatch(onto[cid], f"via {via}", False))

    for m in matches:
        c = m.concept
        add(c.get("measured_by"), c.id)        # feature -> derived
        add(c.get("identified_by"), c.id)      # water mass -> detector
    for m in list(out):
        for var in m.concept.refs("requires") + m.concept.refs("feature_of"):
            add(var, m.concept.id)             # -> variables (units, ranges)
    return out


# ── Availability ────────────────────────────────────────────────────────────

@dataclass
class Availability:
    missing: list[tuple[Concept, str]]   # (concept, human reason)
    blocking: bool                       # nothing answerable remains


def check_availability(
    matches: list[ConceptMatch], onto: Ontology, available_params: list[str] | None
) -> Availability:
    """Which directly-mentioned concepts this project cannot provide.

    ``blocking`` is True when every substantive concept the user asked about
    is missing — the question can be answered without running any SQL.
    ``available_params=None`` means unknown: BGC checks are skipped.
    """
    have = {p.upper() for p in available_params} if available_params is not None else None
    missing: list[tuple[Concept, str]] = []
    substantive = [m for m in matches if m.direct and m.concept.id not in _BACKGROUND
                   and m.concept.kind not in ("region", "coordinate")]

    for m in substantive:
        c = m.concept
        unavailable = onto.unavailable_dependencies(c.id)
        if unavailable:
            reason = _oneline(unavailable[0].get("unavailable_reason")) or "not available yet"
            missing.append((c, reason))
            continue
        if have is not None:
            needed = onto.required_params(c.id) - have
            if needed:
                missing.append((c, f"this project has no {', '.join(sorted(needed))} data"))

    blocking = bool(substantive) and len(missing) == len(substantive)
    return Availability(missing=missing, blocking=blocking)


def unavailable_answer(av: Availability, available_params: list[str] | None, onto: Ontology) -> str:
    """User-facing answer when nothing asked for is available (no SQL run)."""
    lines = []
    for c, reason in av.missing:
        lines.append(f"**{c.label}** can't be shown for this project: {reason.rstrip('.')}.")
    bgc = sorted({p for p in (available_params or [])
                  if not re.search(r"_(QC|ADJUSTED|ADJUSTED_QC|ADJUSTED_ERROR)$", p)})
    if bgc:
        lines.append(f"Biogeochemical parameters available here: {', '.join(bgc)}.")
    else:
        lines.append("This project contains core Argo data only (temperature, salinity, pressure).")
    return "\n\n".join(lines)


# ── Prompt context ──────────────────────────────────────────────────────────

def _oneline(text: str | None) -> str:
    return " ".join((text or "").split())


def _card(c: Concept, onto: Ontology) -> str:
    lines = [f"### {c.label}  (`{c.id}`, {c.kind.replace('_', ' ')})"]
    if c.kind == "variable":
        src = c.get("source") or {}
        lines.append(f"- Unit: {c.get('unit')}. SQL: `{src.get('sql')}`"
                     + (f", filter rows with `{src['filter']}`" if src.get("filter") else "")
                     + (f", QC column `{src['qc']}`" if src.get("qc") else ""))
        if c.get("valid_range"):
            lo, hi = c.get("valid_range")
            lines.append(f"- Physically valid range: {lo} to {hi} {c.get('unit')}; outside = bad data.")
        if c.get("typical"):
            lines.append("- Typical: " + "; ".join(f"{k} {v}" for k, v in c.get("typical").items()))
    elif c.kind in ("derived", "feature"):
        lines.append(f"- Definition: {_oneline(c.get('definition'))}")
        if c.get("method") or c.get("detection"):
            lines.append(f"- Method: {_oneline(c.get('method') or c.get('detection'))}")
        if c.get("measured_by"):
            lines.append(f"- Measured by: `{c.get('measured_by')}` (card below).")
        if c.get("parameters"):
            lines.append("- Adjustable literals: " + ", ".join(
                f"{k}={v.get('default')}" for k, v in c.get("parameters").items()))
        if c.get("default_chart"):
            ch = c.get("default_chart")
            lines.append(f"- Default chart (only if the question doesn't imply another): "
                         f"{ch.get('chart_type')} x={ch.get('x')} y={ch.get('y')}"
                         + (" invert_y" if ch.get("invert_y") else ""))
        if c.get("sql_template"):
            lines.append("- Tested SQL (start from this; change only literals/variable):")
            lines.append("```sql\n" + c.get("sql_template").strip() + "\n```")
    elif c.kind == "water_mass":
        top, bottom = c.get("depth_range_dbar")
        props = c.get("core_properties") or {}
        lines.append(f"- Signature: {_oneline(c.get('signature'))}")
        lines.append(f"- Depth band: {top}–{bottom} dbar. Core properties (undiluted): "
                     + ", ".join(f"{k} {v[0]}–{v[1]}" for k, v in props.items()))
        if c.get("identified_by"):
            lines.append(f"- Detect with `{c.get('identified_by')}` (card below), then compare its "
                         "depth/salinity with the band above. Diluted signals still count — say so.")
        lines.append("- Found in: " + ", ".join(onto[r].label for r in c.refs("found_in")))
    elif c.kind == "region":
        lines.append(f"- Filter: `{onto.region_filter_sql(c.id)}` (works on obs and profile_summary)")
        if c.get("note"):
            lines.append(f"- Note: {_oneline(c.get('note'))}")
    elif c.kind == "coordinate":
        lines.append(f"- {_oneline(c.get('meaning'))}")
    return "\n".join(lines)


def method_note(c: Concept) -> str | None:
    """One-line provenance for the summary / UI footnote."""
    method = c.get("method") or c.get("detection") or c.get("signature")
    if not method or c.kind not in ("derived", "feature", "water_mass"):
        return None
    refs = c.get("references") or []
    ref = f" ({refs[0]})" if refs else ""
    return f"{c.label}: {_oneline(method)}{ref}"


@dataclass
class OntologyContext:
    prompt: str                       # text for the SQL agent's system prompt
    concept_ids: list[str]            # direct + expanded, in card order
    method_notes: list[str]           # provenance lines for summary / UI


def build_context(
    matches: list[ConceptMatch],
    onto: Ontology,
    *,
    availability: Availability | None = None,
    project_regions: list[Concept] | None = None,
) -> OntologyContext:
    cards: list[str] = []
    ids: list[str] = []
    notes: list[str] = []

    budgeted = [m for m in matches if m.concept.id not in _BACKGROUND][:MAX_CARDS]
    for m in budgeted:
        cards.append(_card(m.concept, onto))
        ids.append(m.concept.id)
        if m.direct or m.concept.kind == "derived":
            note = method_note(m.concept)
            if note:
                notes.append(note)

    header: list[str] = []
    if project_regions:
        location = ("Project location: profiles lie in "
                    + " / ".join(f"{r.label}" for r in project_regions)
                    + " (approximate region boxes).")
        header.append(location)
        notes.insert(0, location)
    if availability and availability.missing:
        for c, reason in availability.missing:
            header.append(f"NOT AVAILABLE — {c.label}: {reason}. Do not query or invent it; "
                          "tell the user and answer the rest.")

    if not cards and not header:
        return OntologyContext("", [], [])
    body = "\n".join(header)
    if cards:
        body += ("\n\n" if body else "") + "\n\n".join(cards)
    return OntologyContext(body, ids, notes)


def ontology_context_for(
    message: str,
    onto: Ontology,
    *,
    available_params: list[str] | None,
    previous_user_message: str | None = None,
    project_regions: list[Concept] | None = None,
) -> tuple[OntologyContext, Availability, list[ConceptMatch]]:
    """Convenience wrapper: link → expand → availability → cards.

    Concepts from the previous user message are included (after the current
    ones) so follow-ups like "now do that for salinity" keep the concept.
    """
    direct = link_concepts(message, onto)
    if previous_user_message:
        current = {m.concept.id for m in direct}
        direct += [
            ConceptMatch(m.concept, m.matched, False)
            for m in link_concepts(previous_user_message, onto)
            if m.concept.id not in current
        ]
    availability = check_availability(direct, onto, available_params)
    expanded = expand(direct, onto)
    ctx = build_context(expanded, onto, availability=availability, project_regions=project_regions)
    return ctx, availability, direct


# ── Glossary for the context agent ──────────────────────────────────────────

def glossary_text(onto: Ontology, concept_ids: list[str] | None = None) -> str:
    """Ground-truth glossary for the context agent, generated from the
    ontology (replaces the old hand-maintained glossary.py).

    With ``concept_ids``, those concepts (plus related variables) are
    described; otherwise every variable is, as the old glossary did.
    """
    if concept_ids:
        matches = expand([ConceptMatch(onto[c], c, True) for c in concept_ids if c in onto], onto)
        concepts = [m.concept for m in matches]
    else:
        concepts = onto.by_kind("variable")

    lines = ["GLOSSARY GROUND TRUTH (from the OceoGeo ontology):"]
    for c in concepts:
        unit = f" ({c.get('unit')})" if c.get("unit") else ""
        meaning = c.get("meaning") or c.get("definition") or c.get("signature")
        lines.append(f"- {c.label}{unit}: {_oneline(meaning)}")
        if not c.available:
            lines.append(f"  Not available in OceoGeo data: {_oneline(c.get('unavailable_reason'))}")
        if c.get("valid_range"):
            lo, hi = c.get("valid_range")
            lines.append(f"  Physically valid range: {lo} to {hi}{unit}")
        if c.get("typical"):
            lines.append("  Typical: " + "; ".join(f"{k} {v}" for k, v in c.get("typical").items()))
        if c.kind == "water_mass":
            top, bottom = c.get("depth_range_dbar")
            lines.append(f"  Depth band: {top}-{bottom} dbar; core properties: "
                         + ", ".join(f"{k} {v[0]}-{v[1]}" for k, v in (c.get("core_properties") or {}).items()))
        if c.get("method"):
            lines.append(f"  Method: {_oneline(c.get('method'))}")
        if c.get("anomaly_note"):
            lines.append(f"  Anomalies: {_oneline(c.get('anomaly_note'))}")
        if c.get("references"):
            lines.append(f"  References: {'; '.join(c.get('references'))}")
    return "\n".join(lines)
