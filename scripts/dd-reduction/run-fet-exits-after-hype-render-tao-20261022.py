#!/usr/bin/env python3
"""FET LONG exit-only research, with cumulatively user-adopted HYPE+Idle rules.

Causal completed-M5 price replay and dynamic 8-logic portfolio re-selection.
Study uses the same previous accepted HYPE/V12/Q102/PENGU/Idle/Risk rules.
No VPS, LIVE, orders or Production changes are authorized.
"""
from __future__ import annotations
import argparse
import bisect
import collections
import hashlib
import importlib.util
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
ROOT = Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")

spec = importlib.util.spec_from_file_location(
    "fet_parent_adopted_idle_full8",
    HERE / "run-idle-five-entry-full8-after-hype-20261022.py")
assert spec and spec.loader
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

ADOPTED = json.loads((REPO / "config/research/hype-render-tao-cumulative-adopted-20261022.json").read_text(encoding="utf-8"))
assert ADOPTED["sourceResearch"]["selectedIntegratedCaseId"] == "TAO_RET1H_PLUS_RENDER_SKIP_AND_PROFIT"
TRIPLE = "TAO_RET1H_PLUS_RENDER_SKIP_AND_PROFIT"
HYPE = json.loads((REPO / "config/research/hype-entry-adopted-20261022.json").read_text(encoding="utf-8"))
assert HYPE["adoptedCombinedCaseId"] == "COMBO_I1H1_P3F1P5"

BASE = "FET_AFTER_ALL_ADOPTED_BASELINE"
RULES = {
    "FET_TRAIL_5P_GIVEBACK_3P": {"kind": "fet_trail", "arm": 0.05, "giveback": 0.03},
    "FET_TRAIL_5P_GIVEBACK_5P": {"kind": "fet_trail", "arm": 0.05, "giveback": 0.05},
    "FET_TRAIL_8P_GIVEBACK_4P": {"kind": "fet_trail", "arm": 0.08, "giveback": 0.04},
    "FET_INITIAL_3H_MINUS1P5_LOW_MFE": {
        "kind": "initial", "arm_hours": 3, "stop_pct": 0.015,
        "mfe_gate_pct": 0.005, "reentry_hours": 0,
    },
    "FET_INITIAL_4H_MINUS2P_LOW_MFE": {
        "kind": "initial", "arm_hours": 4, "stop_pct": 0.020,
        "mfe_gate_pct": 0.005, "reentry_hours": 0,
    },
}
RULES = {
    k: dict(v, id=k, strategy="FET", sides=["LONG"]) for k,v in RULES.items()
}
CASE_NAMES = [BASE, *RULES]
M5 = 300000
HOUR = 3600000
APPLY_PARENT = m.apply

def _safe_matching(row, rule):
    return rule.get("strategy") == "FET" and row.get("strategy_id") == "FET" \
        and row.get("side") == "LONG" and row.get("symbol") == "FETUSDT"

def apply_fet_trail(row, rule, source, cost_bps, obs):
    if not _safe_matching(row, rule): return row
    start_ts = int(row["entry_ts_ms"])
    original_exit_ts = int(row["exit_ts_ms"])
    entry = float(row["entry_price"])
    if not math.isfinite(entry) or entry <= 0 or original_exit_ts <= start_ts + M5:
        return row
    bars, times = source.getdata("FETUSDT")
    first = bisect.bisect_left(times, start_ts)
    end = bisect.bisect_left(times, original_exit_ts)
    if first >= end or first >= len(times) or times[first] > start_ts + M5:
        obs["data_gap"] += 1
        return row
    raw_start = float(bars[first][1])
    if raw_start <= 0 or abs(raw_start / entry - 1) > 0.025:
        obs["entry_mismatch"] += 1
        return row
    scale = entry / raw_start
    best_completed_gain = 0.0
    existing_price_stop = None
    armed = False
    touched_count = 0
    for idx in range(first, end):
        ts, raw_open, raw_high, raw_low, raw_close, _ = bars[idx]
        if idx > first and ts - bars[idx-1][0] != M5:
            obs["internal_gap"] += 1
            return row
        op, lo, cl = float(raw_open)*scale, float(raw_low)*scale, float(raw_close)*scale
        if min(op,lo,cl) <= 0 or not all(math.isfinite(x) for x in (op,lo,cl)):
            obs["invalid_input"] += 1
            return row
        # An armed stop from an EARLIER closed M5 is tested before this M5
        # can update the best gain. Gap-through fills at the worse M5 open.
        if armed and existing_price_stop is not None and min(op, lo) <= existing_price_stop:
            filled = min(op, existing_price_stop) * (1 - cost_bps / 10000)
            exit_ts = ts + M5
            if exit_ts < original_exit_ts and filled > 0:
                obs["triggered"] += 1
                obs["by_reason"]["FET_FAVORABLE_CLOSE_HIGH_WATER_GIVEBACK"] += 1
                touched_count += 1
                return dict(row, exit_ts_ms=exit_ts, exit_price=filled,
                            unit_price_return=filled / entry - 1,
                            exit_reason="RESEARCH_" + rule["id"])
        gain = cl / entry - 1
        best_completed_gain = max(best_completed_gain, gain)
        if best_completed_gain >= rule["arm"]:
            armed = True
            candidate = entry * (1 + best_completed_gain - rule["giveback"])
            if existing_price_stop is None or candidate > existing_price_stop:
                existing_price_stop = candidate
    return row

def apply(row,rule,source,cost_bps,obs,original_row=None):
    if rule.get("strategy") != "FET":
        return APPLY_PARENT(row,rule,source,cost_bps,obs,original_row=original_row)
    if not _safe_matching(row,rule): return row
    if rule["kind"] == "fet_trail":
        return apply_fet_trail(row,rule,source,cost_bps,obs)
    if rule["kind"] == "initial":
        return m.base.ORIGINAL_APPLY(row,rule,source,cost_bps,obs,original_row=original_row)
    raise ValueError("INVALID_FET_RESEARCH_RULE")

def sha(p):
    h=hashlib.sha256()
    with Path(p).open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def replay(case,cost,source,helper,previous):
    current=None
    history=[]
    for iteration in range(5):
        m.base.CURRENT.clear()
        if current is not None:
            m.base.CURRENT["cooldown_events"]=current
        m.entry.ACTIVE["policy"]=m.hype.GATE
        for k in ("lookups","passed","blocked","missing"):
            m.entry.ACTIVE[k].clear()
        for k in ("passed","blocked","missing"):m.ACTIVE[k].clear()
        m.ACTIVE["checked"]=0
        # HYPE fixed and both RENDER/TAO entry conditions ALWAYS fixed.
        m.ACTIVE["policy"]=m.POLICIES[TRIPLE]
        overlays=[
            m.hype.V4,
            m.hype.Q102,
            m.idle.HYPE_RULE,
            m.EXIT_RULES[TRIPLE],  # RENDER SHORT existing adopted +1.5% -> +0.25%
        ]
        if case != BASE:overlays.append(RULES[case])
        row=m.core._run_engine(
            "FET_NEXT_"+case+"_C"+str(cost)+"_I"+str(iteration),
            "V12_LONG_COMPOSITE",overlays,cost,source,helper,previous)
        assert row["accounting"]=="PASS"
        assert not m.ACTIVE["missing"] and not m.entry.ACTIVE["missing"], "CLOSED_M5_HISTORY_MISSING"
        events=m.base.actual_cooldown_events(row)
        history.append({"iteration":iteration,"v12ShortCooldownEvents":len(events)})
        if current==events:
            return row,history
        if iteration==4:raise RuntimeError("FET_LIFECYCLE_RESELECTION_NOT_CONVERGED")
        current=events
    raise AssertionError("UNREACHABLE")

def main():
    parser=argparse.ArgumentParser(description="FET SHORT? No, FET LONG exit-only, full8 cumulative research")
    parser.add_argument("--output",required=True,type=Path)
    parser.add_argument("--cases",nargs="+",default=CASE_NAMES)
    args=parser.parse_args()
    assert len(set(args.cases))==len(args.cases)
    assert set(args.cases)<=set(CASE_NAMES)
    assert args.output.resolve()!=REPO.resolve()
    args.output.mkdir(parents=True,exist_ok=True)
    m.core.OUTPUT=args.output
    m.core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
    m.core._transform_rows=m.entry_filter
    m.core._apply_initial_stop=apply
    m.core._matches=m.idle.matches
    source,helper=m.core.task8.legacy.bootstrap()
    m.base.install_legacy_capture(helper)
    m.core.Path.write_text=m.core._path_write_text
    m.core.task8.legacy.ensure_baseline(helper)
    previous=helper.experiment_filter
    out={"status":"RESEARCH_ONLY_FET_EXIT_AFTER_USER_ADOPTED_ALL_RULES",
         "adoptedSource":"config/research/hype-render-tao-cumulative-adopted-20261022.json",
         "side":"LONG","symbol":"FETUSDT",
         "cases":{},"costsBps":[10,30],
         "caveats":["Causal model replays confirmed M5 bars; not actual signed venue STOP fills",
                    "Optimized on same in-sample period, only eight FET accepted fills",
                    "Independent Task9 TypeScript parity / OOS and venue certification incomplete",
                    "No LIVE, VPS, position, HP or Production modifications"]}

    for case in args.cases:
        costs={}
        for cost in (10,30):
            data,history=replay(case,cost,source,helper,previous)
            trades=m.jsonl(data["ledger"])
            fet=[r for r in trades if r.get("strategy_id")=="FET"]
            wins=sum(float(r["modeled_realized_pnl_jpy_at_exit_fx"])>0 for r in fet)
            assert len(fet)>0
            symbols=["HYPE_LONG","IDLE","FET","PENGU","V12","Q102","V52","RESIDUAL"]
            amounts={strategy:sum(float(r["modeled_realized_pnl_jpy_at_exit_fx"]) for r in trades if r.get("strategy_id")==strategy) for strategy in symbols}
            ft={"trades":len(fet),"wins":wins,"losses":len(fet)-wins,
                "winRatePct":100*wins/len(fet),
                "modeledPnlJpy":sum(float(r["modeled_realized_pnl_jpy_at_exit_fx"]) for r in fet),
                "byExit":dict(collections.Counter(str(r.get("exit_reason_actual") or r.get("exit_reason")) for r in fet)),
                "fills":[{"id":r["candidate_id"],"pnl":r["modeled_realized_pnl_jpy_at_exit_fx"],
                          "entryTsMs":r["entry_ts_ms"],"exitTsMs":r["exit_ts_ms"],
                          "exitReason":r.get("exit_reason_actual") or r.get("exit_reason")}
                         for r in fet]}
            expected=ADOPTED["modeledEightStrategyIntegratedBaseline"]["cost10bps" if cost==10 else "cost30bps"]
            if case==BASE:
                assert abs(data["final_equity_jpy"]-expected["finalEquityJPY"])<.2
                assert abs(data["maximum_mtm_drawdown_pct"]-expected["maxMtmDrawdownPct"])<1e-7
                assert wins==7 if cost==10 else wins==6
                assert len(fet)==8
            costs[str(cost)]={"portfolioFinalEquityJpy":data["final_equity_jpy"],
                              "deltaVsFormalAdoptedJpy":data["final_equity_jpy"]-expected["finalEquityJPY"],
                              "maxMtmDdPct":data["maximum_mtm_drawdown_pct"],
                              "profitFactor":data["profit_factor"],
                              "closedTrades":data["closed_trades"],
                              "replayHistory":history,
                              "fet":ft,
                              "sourceLedgerSha256":sha(data["ledger"]),
                              "accounting":data["accounting"]}
            print("FET_CASE_RESULT",case,cost,"PORTFOLIO",round(data["final_equity_jpy"]),
                  "DELTA",round(costs[str(cost)]["deltaVsFormalAdoptedJpy"]),
                  "DD",round(data["maximum_mtm_drawdown_pct"],5),
                  "FET",wins,"/",len(fet),round(ft["modeledPnlJpy"]),
                  "REASONS",ft["byExit"],flush=True)
        out["cases"][case]={"rule":RULES.get(case),"costs":costs}
        (args.output/"FET_NEXT_FULL8_RESEARCH_20261022.json").write_text(
            json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
    print("FET_RESEARCH_FINISHED",list(out["cases"]),flush=True)

if __name__=="__main__": main()
