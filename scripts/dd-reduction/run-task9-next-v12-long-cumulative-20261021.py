#!/usr/bin/env python3
"""Causal full8 research: V12 LONG stop alone and cumulatively after V12 SHORT.

Previous SHORT candidate is carried forward as an *experimental* predecessor,
not as an accepted LIVE setting. Only admitted modeled STOP exits can initiate
symbol+side-specific 12h cooldown. No LIVE/VPS/venue mutation.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import task9_initial_adverse_stop_20261020 as engine
from task9_legacy_evidence_capture import install_legacy_capture

SOURCE_PATH = HERE / "run-task9-sourcebacked-5m-bt-20261021.py"
spec = importlib.util.spec_from_file_location("task9_frozen_source", SOURCE_PATH)
assert spec and spec.loader
frozen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frozen)

SHORT_ID = "V12_SHORT_PCT2P5_12H_MFE1P0_R12"
LONG_ID = "V12_LONG_PCT2P0_12H_MFE1P0_R12"
REPO = HERE.parents[1]
DEFAULT_PRIOR = Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-21_task9_full8_evidence_mtm_v3_independent")
DEFAULT_OUTPUT = Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-21_task9_next_v12_long_cumulative")
HOUR = 3600000


def require(condition, label):
    if not condition:
        raise RuntimeError("TASK9_NEXT_LONG_FAIL_CLOSED:" + label)


def load_jsonl(path):
    require(path.is_file(), "missing " + path.name)
    return [json.loads(line) for line in path.read_text("utf8").splitlines() if line]


def audit_case(result, expected_sides):
    root = Path(result["ledger"]).parent
    trades = load_jsonl(root / "portfolio-trades.jsonl")
    decisions = load_jsonl(root / "candidate-decisions.jsonl")
    events = load_jsonl(root / "portfolio-events.jsonl")
    marks = load_jsonl(root / "task9-mtm.jsonl")
    require(len(decisions) == 3185 and len(marks) == 8761, "full8/H1 count")
    excluded = [d for d in decisions if d["decision"] == "EXCLUDED_PREALLOCATION"]
    accepted = [d for d in decisions if d["decision"] == "ACCEPTED_MODELED_ENTRY"]
    require(len(excluded) == 16 and len(accepted) == len(trades), "admission/trade count")
    require({d["candidate_id"] for d in accepted} == {t["candidate_id"] for t in trades}, "admitted IDs")
    require(len({d["strategy_id"] for d in decisions}) == 8, "8 strategies")

    stopped = [t for t in trades if str(t.get("exit_reason_actual", "")).startswith("RESEARCH_INITIAL_ADVERSE_STOP_")]
    stops = [e for e in events if e.get("event_type") == "TASK9_MODELED_STOP_COOLDOWN"]
    rejected = [d for d in decisions if d.get("reason") == "V12:TASK9_ADVERSE_SIDE_COOLDOWN"]
    require(len(stopped) == len(stops), "STOP exit/event mismatch")
    stop_ids = {t["candidate_id"] for t in stopped}
    require(len(stop_ids) == len(stopped) and stop_ids == {e["candidate_id"] for e in stops},
            "STOP event source must be accepted positions")
    require({t["side"] for t in stopped} == set(expected_sides), "wrong side or no STOP")
    for t in stopped:
        require(t["strategy_id"] == "V12", "non-V12 STOP in LONG case")
        require(str(t["exit_reason_actual"]).endswith(
            SHORT_ID if t["side"] == "SHORT" else LONG_ID), "STOP reason/id drift")
    windows = defaultdict(list)
    for e in stops:
        require(e["strategy_id"] == "V12" and e["source_venue_signed"] is False,
                "venue provenance or strategy drift")
        require(e["side"] in expected_sides, "cross-side STOP")
        require(e["until_ts_ms"] - e["ts_ms"] == 12 * HOUR, "12h cooldown expiry")
        windows[(e["symbol"], e["side"])].append((e["ts_ms"], e["until_ts_ms"]))
    for d in rejected:
        key = (d["symbol"], d["side"])
        require(any(start <= d["decision_ts_ms"] < end for start, end in windows[key]),
                "phantom or wrong-side cooldown")
        require(d["quantity_actual_fill"] is False, "rejected candidate treated as fill")
    for before, after in zip(marks, marks[1:]):
        require(after["timestamp_ms"] - before["timestamp_ms"] == HOUR, "H1 gap")
    require(result["accounting"] == "PASS", "economic accounting")
    require(math.isclose(marks[-1]["equity_jpy"],result["final_equity_jpy"],rel_tol=2e-10),
            "H1 final wallet")
    return {
        "finalEquityJpy": result["final_equity_jpy"],
        "maxDrawdownPct": result["maximum_mtm_drawdown_pct"],
        "profitFactor": result["profit_factor"],
        "closedTrades": result["closed_trades"],
        "confirmedStopExits": len(stopped),
        "stopBySide": {s: sum(t["side"] == s for t in stopped) for s in expected_sides},
        "confirmedCooldownRejections": len(rejected),
        "h1Marks": len(marks),
        "candidateCount": len(decisions),
        "acceptedCandidateCount": len(accepted),
        "accounting": "PASS",
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--prior-model-root", type=Path, default=DEFAULT_PRIOR)
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = p.parse_args()
    require(args.output.resolve() != args.prior_model_root.resolve(), "output must not overwrite predecessor")
    require(REPO.resolve() not in args.output.resolve().parents, "raw replay data must stay outside Git")
    prior = json.loads((args.prior_model_root / "manifest.json").read_text("utf8"))
    require(prior["status"] == "COMPLETE_REPRODUCIBLE_RESEARCH_ONLY_NONCANONICAL"
            and prior["dynamicBaseline8LogicExact"], "predecessor manifest")
    require(prior["sourceArchive"]["archiveSha256"] == frozen.data_inventory()["archiveSha256"],
            "market archive drift")
    require(SHORT_ID in prior["candidateResults"], "previous SHORT not available")

    engine.OUTPUT = args.output
    engine.BOOTSTRAP_REDIRECT = args.output / "_legacy-bootstrap-cache"
    engine._transform_rows = frozen._preallocation_candidate_transform
    source, helper = engine.task8.legacy.bootstrap()
    install_legacy_capture(helper, enable_v12_long=True)
    engine.Path.write_text = engine._path_write_text
    engine.task8.legacy.ensure_baseline(helper)
    previous_factory = helper.experiment_filter
    short_rule = frozen.EXPLORATORY_RULES[SHORT_ID]
    long_rule = next(r for r in engine.candidate_grid("V12_LONG") if r["id"] == LONG_ID)

    cases = {
        "V12_LONG_ALONE": ([long_rule], {"LONG"}),
        "CARRY_SHORT_THEN_ADD_V12_LONG": ([short_rule, long_rule], {"SHORT", "LONG"}),
    }
    report = {
        "schemaVersion": 1,
        "status": "RESEARCH_ONLY_CUMULATIVE_V12_LONG_NOT_LIVE",
        "predecessorPolicyId": SHORT_ID,
        "predecessorResearchGate": "FAIL_BELOW_75PCT_30BPS_EQUITY_RETENTION",
        "newPolicyId": LONG_ID,
        "sample": "2025-08-10_to_2026-08-10",
        "initialCapitalJpy": 10000,
        "cases": {}, "productionChanges": 0, "liveChanges": 0,
        "independentTypeScriptAllocatorParityProven": False,
        "venueFillParityProven": False,
    }
    for cost in (10, 30):
        prior_baseline = prior["baseline"][str(cost)]
        parent_short = prior["candidateResults"][SHORT_ID]["results"][str(cost)]
        require(math.isclose(prior_baseline["finalEquityJpy"],
                             engine.BASELINE_EXPECTED[cost]["final"], rel_tol=2e-10),
                "old baseline anchor mismatch")
        for case_name, (rules, sides) in cases.items():
            current = engine._run_engine(case_name, "V12_COMPOSITE", rules, cost,
                                         source, helper, previous_factory)
            audit = audit_case(current, sides)
            audit["vsFrozenBaseline"] = {
                "ddImprovementPp": audit["maxDrawdownPct"] - prior_baseline["maximumMtmDdPct"],
                "equityRetention": audit["finalEquityJpy"] / prior_baseline["finalEquityJpy"],
            }
            audit["vsCarriedShort"] = {
                "ddImprovementPp": audit["maxDrawdownPct"] - parent_short["maximumMtmDdPct"],
                "equityRetention": audit["finalEquityJpy"] / parent_short["finalEquityJpy"],
            }
            key = f"{case_name}_{cost}bps"
            report["cases"][key] = audit
            print("NEXT_V12_LONG_RESULT", key, json.dumps(audit, sort_keys=True), flush=True)
    for case_name in cases:
        a = report["cases"][f"{case_name}_10bps"]
        b = report["cases"][f"{case_name}_30bps"]
        report.setdefault("researchGates", {})[case_name] = {
            "bothCostDDImprove0p1Pp": all(
                x["vsFrozenBaseline"]["ddImprovementPp"] >= 0.1 for x in (a, b)),
            "bothCostEquityRetention75Pct": all(
                x["vsFrozenBaseline"]["equityRetention"] >= .75 for x in (a, b)),
            "bothCostAccountingPass": all(x["accounting"] == "PASS" for x in (a, b)),
            "previousShortWasResearchRejected": True,
            "researchOnly": True,
        }
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output / "next-v12-long-cumulative-report.json").write_text(
        json.dumps(report,indent=2,ensure_ascii=False)+"\n","utf8")
    print("NEXT_V12_LONG_DONE", json.dumps(report["researchGates"],sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
