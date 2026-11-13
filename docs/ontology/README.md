# OceoGeo domain ontology

The ontology is a structured model of the oceanographic concepts users ask
about — variables, derived quantities, features, water masses and regions —
and how they relate. It is the semantic layer between natural-language
questions and SQL: instead of the LLM improvising what "mixed layer depth" or
"Mediterranean water" means, the backend looks the concept up and hands the
model a cited definition and a tested query.

- **Source of truth:** [`OceoGeoAPI/ontology/*.yaml`](../../OceoGeoAPI/ontology/)
- **Loader / validator:** [`OceoGeoAPI/core/ontology.py`](../../OceoGeoAPI/core/ontology.py)
- **Question → concepts → prompt:** [`OceoGeoAPI/core/concept_linker.py`](../../OceoGeoAPI/core/concept_linker.py)
- **Result range checks:** [`OceoGeoAPI/core/result_checks.py`](../../OceoGeoAPI/core/result_checks.py)
- **Concept graph (generated):** [graph.md](graph.md) · **SKOS / JSON-LD (generated):** [ontology.jsonld](ontology.jsonld)

## What is in it

| Kind | Examples | Carries |
|---|---|---|
| Variable | temperature, salinity, dissolved oxygen, chlorophyll-a, nitrate, pH | unit, CF standard name, Argo code, SQL expression on `obs`, valid & typical ranges, required BGC parameter |
| Derived quantity | mixed layer depth, thermocline depth, isotherm depth, intermediate salinity max/min, oxygen minimum | definition, method + parameters, literature reference, **tested SQL template**, output columns, default chart |
| Feature | thermocline, temperature inversion, oxygen minimum zone, deep chlorophyll maximum | what it is a feature of, which derived quantity measures it, detection rule |
| Water mass | Mediterranean Outflow, Antarctic Intermediate, North Atlantic Central/Deep, Subantarctic Mode | depth band, core T/S properties, signature, detector, where it is found |
| Region | Canary Basin, North Atlantic, Indian Ocean, Southern Ocean, Arctic | lat/lon boxes (antimeridian-aware), parent region |

Concepts the app cannot compute yet (density, sound speed) are included and
marked `available: false`, so the app can say *why* rather than guess.

Relations: `requires` (derived from), `feature_of`, `measured_by`,
`identified_by`, `found_in`, `part_of`. See the [concept graph](graph.md).

## How a question uses it

```
question ──► link concepts (aliases + patterns, no LLM, ~1 ms)
         ──► expand relations (water mass → detector → variables)
         ──► availability check against the project's BGC parameters
               └─ nothing answerable? reply immediately, no SQL
         ──► concept cards (definition, method, tested SQL) + project region
               into the SQL agent's prompt (≤ 6 cards)
         ──► SQL agent ─► result range checks (valid_range) ─► summary
               with method line + data-quality warnings
         ──► API returns concepts / methods / quality_flags; chat UI shows
               "Based on" chips, "Method & sources", data-quality box
```

Example: *"Is there Mediterranean Outflow Water in this data?"* on project 8
links `mediterranean_outflow_water`, expands to its detector
`intermediate_salinity_maximum` (local salinity maximum at 600–1600 dbar,
via LAG/LEAD) and `salinity`, notes the project lies in the Canary Basin, and
the model reports a diluted MOW core at ~1150–1350 dbar, ~35.25 PSU — citing
the method.

## Why (measured)

A 25-question benchmark ([`OceoGeoAPI/evals/`](../../OceoGeoAPI/evals/)) was
run through the real pipeline before and after the ontology (same model,
`opencode/muse-spark-1.3`):

| | Without ontology | With ontology |
|---|---|---|
| Questions passed | 22 / 25 | **25 / 25** |
| Median latency | 24.2 s | **21.8 s** |
| Mean input tokens / question | 22,121 | **14,831 (−33 %)** |
| Mean output tokens / question | 1,825 | **1,216 (−33 %)** |
| "Is there Mediterranean water?" | 70 s, 55k tokens | **28 s, 21k tokens** |
| Oxygen in a core-only project, density | 11–44 s, model improvises | **~3 s, explicit answer, no SQL** |

The benchmark was later extended to 30 questions (region filtering, Arctic
BGC-only files); the full set scores 29/30 with the ontology (28/30 in the recorded run plus one scoring fix). Known weak spot:
when the model runs an extra exploratory query after its answer and makes no
chart, the last query is what gets shown (`p4_arctic_no_temp`).

Single runs per configuration; LLM output varies run to run (latency also
depends on load — the 30-question run had a median of 25.4 s while sharing the
API with other traffic), so read these as trends. Re-run with `python -m evals.run_eval --label <name>` and compare with
`--compare baseline <name>`.

Beyond the numbers: consistent, cited definitions; answers that say when data
is missing; flags for physically impossible values; and new metrics added as
data rather than prompt edits.

## Standards alignment

- Variables map to **CF Standard Names** (`skos:exactMatch` to the NERC
  Vocabulary Server URI in the JSON-LD export) and **Argo parameter codes**.
  Names we could not verify are left empty rather than guessed.
- The export is a **SKOS** concept scheme in **JSON-LD**, loadable by any RDF
  tool or triple store if a graph database is ever needed.
- Water-mass property ranges are approximate core values after Emery &
  Meincke (1986) and Talley et al. (2011); detection relies on signatures
  (local extrema in a depth band) because water masses dilute as they spread.

## Why YAML, not a graph database

A few hundred concepts that change with the code are best versioned, reviewed
and tested alongside it. The relations are traversed in memory in
microseconds. The JSON-LD export gives a standard knowledge-graph artefact for
anyone who wants to load it into a triple store or graph tool.

## Adding or changing a concept

1. Edit the right file in `OceoGeoAPI/ontology/` (`variables.yaml`,
   `derived.yaml`, `features.yaml`, `water_masses.yaml`, `regions.yaml`).
   Give it an `id`, `kind`, `label`, `aliases` (words users say) and the
   kind's required fields; add `patterns` for phrases with numbers.
2. For derived quantities and features, write a `sql_template` against the
   scoped views (`obs`, `profile_summary`) and list its `output` columns.
3. Run the tests — they validate references/aliases/ranges and **execute every
   SQL template against real project data**:
   `cd OceoGeoAPI && .venv/bin/python -m pytest tests/test_ontology*.py tests/test_concept_linker.py`
4. Regenerate the docs: `.venv/bin/python -m core.ontology_export`
   (a test fails if you forget).
5. Optionally add a benchmark question to `evals/questions.yaml` and re-run
   the evaluation.
