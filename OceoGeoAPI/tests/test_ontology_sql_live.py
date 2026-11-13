"""Runs every ontology SQL template against real project data.

Skipped when the database is not reachable. Projects (see evals/questions.yaml):
8 = core-only single float in the Canary Basin; 13 = has DOXY; 4 = has CHLA.
"""

import json
import os
import statistics

import pytest

from core.chart_payload import ResultStore
from core.ontology import load_ontology

psycopg2 = pytest.importorskip("psycopg2")

ONTO = load_ontology()
PROJECT_FOR_PARAM = {"DOXY": 13, "CHLA": 4}
CORE_PROJECT = 8


def _db_and_owners():
    from dotenv import load_dotenv
    load_dotenv()
    if not os.getenv("NEON_DEV_DATABASE_URL"):
        pytest.skip("no database configured")
    from services.NeondbService import NeonDBService
    db = NeonDBService()
    try:
        conn = psycopg2.connect(db.connection_string, connect_timeout=10)
    except psycopg2.OperationalError:
        pytest.skip("database not reachable")
    with conn, conn.cursor() as cur:
        cur.execute("SELECT project_id, user_id FROM projects WHERE project_id IN (4, 8, 13)")
        owners = dict(cur.fetchall())
    conn.close()
    return db, owners


@pytest.fixture(scope="module")
def run_sql():
    db, owners = _db_and_owners()
    from core.tools import create_sql_tool

    def run(project_id: int, sql: str) -> dict:
        tool = create_sql_tool(project_id, owners[project_id], db,
                               available_params=None, result_store=ResultStore())
        fn = tool.entrypoint if hasattr(tool, "entrypoint") else tool.fn
        return json.loads(fn(query=sql))

    return run


TEMPLATED = [c for c in ONTO.concepts.values() if c.get("sql_template")]


@pytest.mark.parametrize("concept", TEMPLATED, ids=[c.id for c in TEMPLATED])
def test_sql_template_runs(run_sql, concept):
    params = ONTO.required_params(concept.id)
    project = PROJECT_FOR_PARAM[next(iter(params))] if params else CORE_PROJECT
    out = run_sql(project, concept.get("sql_template"))
    assert "error" not in out, out.get("error")
    # Columns returned must match the documented output columns.
    returned = [c["id"] for c in out["columns"]]
    for col in concept.get("output", []):
        assert col in returned, f"{concept.id}: documented output {col!r} not in {returned}"
    # Features may legitimately find nothing; derived quantities must not.
    if concept.kind == "derived":
        assert out["row_count"] > 0, f"{concept.id} returned no rows on project {project}"


@pytest.mark.parametrize("water_mass", ["mediterranean_outflow_water", "antarctic_intermediate_water"])
def test_water_mass_signature_found_where_expected(run_sql, water_mass):
    """Project 8 (Canary Basin) should show diluted MOW and AAIW signatures
    inside each water mass's documented depth band."""
    wm = ONTO[water_mass]
    detector = ONTO[wm.get("identified_by")]
    out = run_sql(CORE_PROJECT, detector.get("sql_template"))
    assert "error" not in out
    depth_col = next(c["id"] for c in out["columns"] if c["id"].endswith("_depth"))
    depths = [r[depth_col] for r in out["sample_rows"] if r[depth_col] is not None]
    assert depths, f"no {detector.id} found"
    top, bottom = wm.get("depth_range_dbar")
    assert top <= statistics.median(depths) <= bottom
