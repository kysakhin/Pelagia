"""Run the benchmark questions through the real chat pipeline and score them.

Usage (from OceoGeoAPI/):
    .venv/bin/python -m evals.run_eval --label baseline
    .venv/bin/python -m evals.run_eval --label ontology --only p8_mld_time,p8_mow

Uses the configured LLM (LLM_PROVIDER / LLM_MODEL in .env) and the real
database, so each full run costs real tokens (~$0.30–0.60 on muse-spark).
Results are written to evals/results/<label>.json; compare two runs with
    .venv/bin/python -m evals.run_eval --compare baseline ontology
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT.parent / ".env")

import psycopg2  # noqa: E402
from agno.agent import Agent  # noqa: E402

from config import LLM_MODEL, LLM_PROVIDER  # noqa: E402
from services.ChatService import ChatService  # noqa: E402

RESULTS_DIR = ROOT / "results"

# ── Token accounting ────────────────────────────────────────────────────────
# Wrap Agent.run so every agent call made while answering a question adds its
# token usage to that question's (thread-local) counters.

_usage = threading.local()
_original_run = Agent.run


def _counting_run(self, *args, **kwargs):
    out = _original_run(self, *args, **kwargs)
    metrics = getattr(out, "metrics", None)
    if metrics is not None and hasattr(_usage, "counts"):
        _usage.counts["llm_calls"] += 1
        _usage.counts["input_tokens"] += getattr(metrics, "input_tokens", 0) or 0
        _usage.counts["output_tokens"] += getattr(metrics, "output_tokens", 0) or 0
    return out


Agent.run = _counting_run


# ── Scoring ─────────────────────────────────────────────────────────────────

def _columns(resp: dict) -> list[str]:
    cols = resp.get("columns") or []
    ids = [c.get("id") for c in cols if isinstance(c, dict)]
    if not ids and resp.get("data"):
        ids = list(resp["data"][0].keys())
    return [i for i in ids if isinstance(i, str)]


def _match_column(cols: list[str], needles: list[str]) -> str | None:
    for needle in needles:
        for c in cols:
            if needle.lower() in c.lower():
                return c
    return None


def _numeric_values(rows: list[dict], col: str) -> list[float]:
    out = []
    for r in rows:
        v = r.get(col)
        if isinstance(v, bool) or v is None:
            continue
        try:
            out.append(float(v))
        except (TypeError, ValueError):
            continue
    return out


def score(resp: dict, expect: dict) -> list[str]:
    """Return a list of failed-check descriptions (empty = pass)."""
    fails: list[str] = []
    intent = resp.get("intent")
    rows = resp.get("data") or []
    cols = _columns(resp)
    spec = resp.get("chart_spec") or {}
    payload = resp.get("chart_payload")
    text = (resp.get("summary") or resp.get("response") or "").lower()
    sql = (resp.get("query") or "").lower()
    row_count = resp.get("row_count", len(rows)) or 0

    if intent == "ERROR":
        fails.append(f"pipeline error: {text[:120]}")

    exp_intent = expect.get("intent")
    if exp_intent:
        allowed = exp_intent if isinstance(exp_intent, list) else [exp_intent]
        if intent not in allowed:
            fails.append(f"intent {intent} not in {allowed}")

    if "min_rows" in expect and row_count < expect["min_rows"]:
        fails.append(f"rows {row_count} < {expect['min_rows']}")
    if "max_rows" in expect and row_count > expect["max_rows"]:
        fails.append(f"rows {row_count} > {expect['max_rows']}")

    if "chart" in expect:
        ctype = spec.get("chart_type")
        if ctype not in expect["chart"] or not payload:
            fails.append(f"chart {ctype!r} (payload={bool(payload)}) not in {expect['chart']}")
    if expect.get("no_chart") and payload:
        fails.append("unexpected chart")

    if "column_like" in expect and not _match_column(cols, expect["column_like"]):
        fails.append(f"no column like {expect['column_like']} in {cols}")

    vr = expect.get("value_range")
    if vr:
        col = _match_column(cols, vr["column_like"])
        if not col:
            fails.append(f"value_range: no column like {vr['column_like']} in {cols}")
        else:
            vals = _numeric_values(rows, col)
            if not vals:
                fails.append(f"value_range: no numeric values in {col}")
            elif min(vals) < vr["min"] or max(vals) > vr["max"]:
                fails.append(
                    f"{col} range [{min(vals):.3g}, {max(vals):.3g}] outside [{vr['min']}, {vr['max']}]"
                )

    if "text_any" in expect and not any(t.lower() in text for t in expect["text_any"]):
        fails.append(f"response lacks any of {expect['text_any']}")
    if "sql_any" in expect and not any(t.lower() in sql for t in expect["sql_any"]):
        fails.append(f"SQL lacks any of {expect['sql_any']}")

    return fails


# ── Runner ──────────────────────────────────────────────────────────────────

def _project_owners(project_ids: set[int]) -> dict[int, str]:
    from services.NeondbService import NeonDBService

    conn = psycopg2.connect(NeonDBService().connection_string)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT project_id, user_id FROM projects WHERE project_id = ANY(%s)",
                (list(project_ids),),
            )
            return dict(cur.fetchall())
    finally:
        conn.close()


def run_one(service: ChatService, q: dict, owner: str) -> dict:
    _usage.counts = {"llm_calls": 0, "input_tokens": 0, "output_tokens": 0}
    t0 = time.time()
    try:
        resp = service.process_message(q["question"], owner, q["project"])
    except Exception as exc:  # pipeline should never raise, but record it
        resp = {"intent": "ERROR", "response": f"{type(exc).__name__}: {exc}"}
    secs = time.time() - t0
    fails = score(resp, q.get("expect", {}))
    return {
        "id": q["id"],
        "project": q["project"],
        "question": q["question"],
        "passed": not fails,
        "fails": fails,
        "secs": round(secs, 1),
        **_usage.counts,
        "intent": resp.get("intent"),
        "sql": resp.get("query"),
        "columns": _columns(resp),
        "row_count": resp.get("row_count"),
        "chart_type": (resp.get("chart_spec") or {}).get("chart_type"),
        "answer": (resp.get("summary") or resp.get("response") or "")[:600],
    }


def run(label: str, only: set[str] | None, workers: int) -> dict:
    spec = yaml.safe_load((ROOT / "questions.yaml").read_text())
    questions = [q for q in spec["questions"] if not only or q["id"] in only]
    owners = _project_owners({q["project"] for q in questions})
    service = ChatService()

    started = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda q: run_one(service, q, owners[q["project"]]), questions))

    passed = sum(r["passed"] for r in results)
    summary = {
        "label": label,
        "model": f"{LLM_PROVIDER}/{LLM_MODEL}",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "questions": len(results),
        "passed": passed,
        "pass_rate": round(passed / len(results), 3) if results else 0,
        "median_secs": round(statistics.median(r["secs"] for r in results), 1),
        "mean_input_tokens": round(statistics.mean(r["input_tokens"] for r in results)),
        "mean_output_tokens": round(statistics.mean(r["output_tokens"] for r in results)),
        "mean_llm_calls": round(statistics.mean(r["llm_calls"] for r in results), 1),
        "wall_secs": round(time.time() - started, 1),
    }
    RESULTS_DIR.mkdir(exist_ok=True)
    out = {"summary": summary, "results": results}
    (RESULTS_DIR / f"{label}.json").write_text(json.dumps(out, indent=1, default=str))
    return out


def print_report(out: dict) -> None:
    s = out["summary"]
    print(f"\n{s['label']}  ({s['model']}, {s['timestamp']})")
    print(f"  passed {s['passed']}/{s['questions']}  median {s['median_secs']}s  "
          f"tokens in/out {s['mean_input_tokens']}/{s['mean_output_tokens']}  "
          f"LLM calls {s['mean_llm_calls']}")
    for r in out["results"]:
        mark = "PASS" if r["passed"] else "FAIL"
        print(f"  {mark} {r['id']:<24} {r['secs']:>5}s  {r['input_tokens']:>6} tok"
              + ("" if r["passed"] else f"  — {'; '.join(r['fails'])[:150]}"))


def compare(a: str, b: str) -> None:
    ra = json.loads((RESULTS_DIR / f"{a}.json").read_text())
    rb = json.loads((RESULTS_DIR / f"{b}.json").read_text())
    sa, sb = ra["summary"], rb["summary"]
    print(f"{'':<22}{a:>14}{b:>14}")
    for key in ("passed", "median_secs", "mean_input_tokens", "mean_output_tokens", "mean_llm_calls"):
        print(f"{key:<22}{sa[key]:>14}{sb[key]:>14}")
    by_id = {r["id"]: r for r in ra["results"]}
    for r in rb["results"]:
        prev = by_id.get(r["id"])
        if prev and prev["passed"] != r["passed"]:
            print(f"  {r['id']}: {'FAIL→PASS' if r['passed'] else 'PASS→FAIL'}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="run")
    ap.add_argument("--only", help="comma-separated question ids")
    ap.add_argument("--workers", type=int, default=5)
    ap.add_argument("--compare", nargs=2, metavar=("A", "B"))
    args = ap.parse_args()
    if args.compare:
        compare(*args.compare)
        return
    only = set(args.only.split(",")) if args.only else None
    print_report(run(args.label, only, args.workers))


if __name__ == "__main__":
    main()
