"""Independent one-case rerun of V2_M150_D05_CORE_NATIVE in the existing full multi-strategy H1 engine.
Research-only: no live connection, deployment, orders, or mutation to frozen reference ledgers.
"""
import contextlib
import io
import json
import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_v4_priority_gross_v2_sweep as v2

ROOT = v2.ROOT
OUT = ROOT / "docs/research/results/v12-v2-integrated-confirm-20261009"
NAME = "V2_M150_D05_CORE_NATIVE"
COSTS = "10,20,30"
REF_10 = ROOT / "docs/research/results/v12-v4-priority-gross-v2-sweep-20261009/comparison-summary.json"
REF_STRESS = ROOT / "docs/research/results/v12-v4-priority-gross-v2-stress-20261009/comparison-summary.json"

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    s = v2.s
    s.w.OUT = OUT
    s.w.setup()
    v2.v4.install_virtual_leg_study_adapter()
    v2.final.install_final_routes()
    v2.v3.stage3_transform = v2.final.stage3_candidate_all
    v2.v3.FAILED = v2.ml.failed_candidates()
    v2.v3.v2.FAILED = v2.v3.FAILED
    s.w.base.source_batch = v2.ind.custom_source_batch
    s.w.base.read_table = v2.v3.v2.read_table
    previous_patch = s.w.base.patch_admission
    cfg = dict(v2.CASES[NAME])
    v2.v3.CASE[NAME] = {"family_cap": v2.CAP["family"], "gross": .10, "slots": 16}
    v2.ind.ACTIVE_RECOVERY_CAP = v2.CAP["family"]
    v2.mlift.MAX_LIFT_GROSS = .30
    v2.ind.ORIG_PATCH = previous_patch
    s.w.base.patch_admission = v2.patch
    s.w.base._study_filter = v2.make_filter(NAME, cfg)
    print("START FULL-PORTFOLIO FROZEN ONE-CASE RERUN", NAME, COSTS, flush=True)
    run = s.w.base.run_study(NAME, COSTS)
    run["cfg"] = {**v2.CAP, **cfg}
    rows = []
    prior_10 = next(x for x in json.loads(REF_10.read_text(encoding="utf-8")) if x["case"] == NAME)
    prior_stress = next(x for x in json.loads(REF_STRESS.read_text(encoding="utf-8")) if x["case"] == NAME)
    prior_scenarios = {s["scenario_id"]: s for s in prior_10["scenarios"] + prior_stress["scenarios"]}
    for sc in run["scenarios"]:
        name = sc["scenario_id"]
        all_trades = s.rows(OUT / "cases" / NAME / "runs" / name / "portfolio-trades.jsonl")
        grouped = sorted(set(t["strategy_id"] for t in all_trades))
        v12 = [t for t in all_trades if t["strategy_id"] == "V12"]
        ref = prior_scenarios[name]
        check = {
            "equity_abs_diff": abs(sc["final_equity_jpy"] - ref["final_equity_jpy"]),
            "dd_abs_diff": abs(sc["maximum_mtm_drawdown"] - ref["maximum_mtm_drawdown"]),
            "closed_trades_match": sc["closed_trades"] == ref["closed_trades"],
            "strategy_groups_match": set(grouped) == set(ref["strategy_trade_outcome_aggregates"]["by_strategy"]),
            "accounting": sc["accounting_reconciliation"]["status"],
            "reference_matched": (
                math.isclose(sc["final_equity_jpy"], ref["final_equity_jpy"], rel_tol=1e-9, abs_tol=.01)
                and math.isclose(sc["maximum_mtm_drawdown"], ref["maximum_mtm_drawdown"], abs_tol=1e-8)
                and sc["closed_trades"] == ref["closed_trades"]
                and set(grouped) == set(ref["strategy_trade_outcome_aggregates"]["by_strategy"])
            )
        }
        row = {
            "case": NAME,
            "scenario": name,
            "final_equity_jpy": sc["final_equity_jpy"],
            "max_mtm_dd": sc["maximum_mtm_drawdown"],
            "portfolio_pf": sc["profit_factor"],
            "total_trades": sc["closed_trades"],
            "v12_trades": len(v12),
            "strategy_pnl_jpy": sc["strategy_pnl_jpy"],
            "strategy_trade_aggregates": sc["strategy_trade_outcome_aggregates"]["by_strategy"],
            "groups": grouped,
            "parity": check,
            "replay_status": sc["status"],
            "ownership_conflicts": sc.get("ownership_conflicts"),
            "q102_scope": run.get("q_scope"),
            "v52_funding_verified": run.get("v52_funding_verified"),
            "v52_model_complete": run.get("v52_model_complete"),
        }
        rows.append(row)
        print("RERUN",name,"trades",row["total_trades"],"V12",row["v12_trades"],
              "equity",round(row["final_equity_jpy"],3),"DD",round(row["max_mtm_dd"],7),
              "PARITY",row["parity"]["reference_matched"],flush=True)
    result = {
        "status": "FULL_PORTFOLIO_PRICE_MODEL_RERUN_NOT_CURRENT_VPS_PARITY_PROVEN",
        "read_only_research": True,
        "source_scenario": NAME,
        "costs_bps": [10,20,30],
        "live_sha_verified": False,
        "vps_current_implementation_verified": False,
        "price_model_not_exchange_level2": True,
        "whole_portfolio_replay": True,
        "cases": rows,
    }
    (OUT/"fresh-run-summary.json").write_text(json.dumps(result,indent=2,ensure_ascii=False,allow_nan=False)+"\n",encoding="utf-8")
    if any(not row["parity"]["reference_matched"] for row in rows):
        raise RuntimeError("EXISTING_REFERENCE_REPLAY_PARITY_MISMATCH")
    print("FINISHED ALL_REPLAY_MATCHED, output",OUT,flush=True)

if __name__ == "__main__":
    main()
