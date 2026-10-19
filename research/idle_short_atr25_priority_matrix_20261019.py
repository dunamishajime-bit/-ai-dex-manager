#!/usr/bin/env python3
"""Research only: ATR<=2.5% fixed, STOP budget/latency/H1 causality continuation.

Uses 61 historical *accepted* Idle SHORT intents and fixed outcomes. This is NOT
a current integrated portfolio backtest, actual STOP ledger or 5m fill replay.
All score inputs are pre-entry; optional prior edge uses *exited* trades only.
"""
from __future__ import annotations
import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from idle_short_cluster_guard_frozen_replay_20261019 import (
    load, replay, summarize, sha256, HOUR, HOLDOUT_START_MS
)

ROOT = Path(__file__).resolve().parents[1]
ATR_ADOPTED = .025
HARD_STOP = .10
RISK_BUDGETS = (15., 20.)
ADVERSE_GAPS = (0., 1., 2.)
LATENCY_MINUTES = (5, 10, 15, 30)
MIN_PRIOR_COMPLETED_FOR_EDGE = 5

def causal_score(x: dict) -> float:
    """Heuristic ranking, not a fitted/calibrated estimate of expected profit."""
    return round(
        100 * (.35 * max(0., -x["ret12"]) + .35 * max(0., -x["rel24"]))
        + .5 * min(2., max(-1., x["vol_ratio"]-1.))
        - 20 * max(0., x["atr_ratio"]-.015), 7
    )

def h1_rank(items: list[dict], completed: list[dict]) -> tuple[list[dict], list[dict]]:
    by_route = defaultdict(list)
    for old in completed:
        by_route[old["route"]].append(old["return_10bps"])
    diag = []
    for x in items:
        prior = by_route[x["route"]]
        ev = sum(prior)/len(prior) if len(prior)>=MIN_PRIOR_COMPLETED_FOR_EDGE else None
        diag.append({
            "symbol": x["symbol"], "route": x["route"], "entry_ts_ms":x["entry_ts_ms"],
            "atr_pct":round(100*x["atr_ratio"],4),
            "preentry_score":causal_score(x),
            "prior_completed_trades":len(prior),
            "prior_completed_mean_return_pct":round(100*ev,4) if ev is not None else None,
            "has_calibrated_forward_ev":False,
            "nominal_10pct_stop_risk_pct_of_wallet":round(10*x["gross"],4),
        })
    # If one candidate lacks route samples, rank all with feature evidence.
    # Prior mean is a historical causal observation, NOT a trained EV forecast.
    comparable = all(d["prior_completed_mean_return_pct"] is not None for d in diag)
    lookup = {d["symbol"]:d for d in diag}
    for d in diag:
        volatility_floor_pct=max(.5,d["atr_pct"])
        # Ex ante composite: previous *completed* route returns (60%),
        # finalized-bar signal score (40%), each divided by ATR risk.
        # If route evidence is scarce, use score / ATR without guessed EV.
        d["ranking_score_per_atr_risk"]=round((
            .6*d["prior_completed_mean_return_pct"]+.4*d["preentry_score"]
            if comparable else d["preentry_score"]) / volatility_floor_pct,7)
    order=sorted(items,key=lambda x:(
        -lookup[x["symbol"]]["ranking_score_per_atr_risk"],
        x["atr_ratio"],x["symbol"]))
    for i,x in enumerate(order):
        lookup[x["symbol"]]["rank"]=i+1
        lookup[x["symbol"]]["ranking_basis"]=(
            "PRIOR_COMPLETED_ROUTE_MEAN_IN_SAMPLE_NOT_CALIBRATED_EV" if comparable
            else "CAUSAL_FEATURE_SCORE_PROXY_NOT_EXPECTANCY"
        )
    return order,diag

def fixed_intent_grid(rows: list[dict], budget: float, gap: float,
                      *, ranking: bool, max_one_same_h1: bool=False) -> dict:
    """Ordinal entry admission, not STOP path outcome / portfolio compounding."""
    hourgroups=defaultdict(list)
    for x in rows:
        hourgroups[int(x["entry_ts_ms"])//HOUR].append(x)
    open_positions=[];accepted=[];excluded=[];h1_diag=[]
    peak=0.
    for h, items in sorted(hourgroups.items()):
        now=min(x["entry_ts_ms"] for x in items)
        open_positions=[p for p in open_positions if p["exit_ts_ms"]>now]
        completed=[x for x in rows if x["exit_ts_ms"]<=now and x["entry_ts_ms"]<now]
        if ranking and len(items)>1:
            items, d=h1_rank(items,completed)
            h1_diag.append({"utc_h1":datetime.fromtimestamp(h*3600,timezone.utc).isoformat(),
                            "candidate_rank":sorted(d,key=lambda e:e["rank"]),
                            "historical_truth_used_for_priority":False})
        else:
            items=sorted(items,key=lambda x:(x["entry_ts_ms"],x["symbol"]))
        accepted_in_hour=0
        for x in items:
            if x["atr_ratio"]>ATR_ADOPTED:
                why="ATR2_5_EXCEED"
            elif max_one_same_h1 and accepted_in_hour>=1:
                why="SAME_H1_LOWER_RANK"
            elif (sum(p["gross"] for p in open_positions)+x["gross"])*(HARD_STOP+gap/100)>budget/100+1e-12:
                why="STOP_BUDGET_PROXY"
            else:
                why=None
            if why:
                excluded.append({"symbol":x["symbol"],"entry_ts_ms":x["entry_ts_ms"],
                                 "reason":why, "weighted_return_pct":round(100*x["gross"]*x["return_10bps"],5)})
            else:
                accepted.append(x); open_positions.append(x);accepted_in_hour+=1
                peak=max(peak,sum(p["gross"] for p in open_positions))
    return {
        "atr_pct":2.5, "budget_pct":budget, "adverse_gap_pct":gap,
        "same_h1_priority":"causal_proxy_rank" if ranking else "frozen_symbol_order",
        "one_per_h1":max_one_same_h1,
        "10bps":summarize(accepted,10),"20bps":summarize(accepted,20),"30bps":summarize(accepted,30),
        "pre_may_2026":summarize([x for x in accepted if x["entry_ts_ms"]<HOLDOUT_START_MS],10),
        "may_2026_onward":summarize([x for x in accepted if x["entry_ts_ms"]>=HOLDOUT_START_MS],10),
        "max_historical_open_gross":round(peak,4),
        "max_nominal_at_stop_pct":round(peak*(10+gap),4),
        "blocked_winners":sum(x["weighted_return_pct"]>0 for x in excluded),
        "blocked_losers":sum(x["weighted_return_pct"]<0 for x in excluded),
        "excluded":excluded, "same_h1_diagnostics":h1_diag
    }

def protected_short_add_on(active: list[dict]) -> tuple[bool,str]:
    """Spec/test scaffold. Stop claims need signed venue read-back before action."""
    for p in active:
        if not p.get("venue_signed_stop_verified",False):
            return False,"MISSING_SIGNED_RESIDENT_STOP"
        if (not p.get("reduce_only",False) or not p.get("stop_quantity_matches_position",False)):
            return False,"STOP_NOT_FULLY_PROTECTIVE"
        if p.get("net_profit_at_stop_pct",0)<=0:
            return False,"NO_PROTECTED_NET_PROFIT_AT_STOP"
    return True,"ALL_EXISTING_SHORT_PROFIT_LOCKED" if active else "NO_EXISTING_SHORT"

def latency_status(root: Path) -> list[dict]:
    # Existing fixed accepted intents specify hour timestamps, NOT actual 5m
    # fill quotes. Even if normalized source is present, it needs ingestion and
    # signed time/venue matching; do not silently perform costless delays.
    return [{"delay_min":m,"status":"UNCOMPUTABLE_WITH_FROZEN_H1_INTENTS",
             "required":"venue-matched 5m (or finer) prices, quote spreads, order event clocks, signal validity, path STOP"}
            for m in LATENCY_MINUTES]

def run() -> dict:
    rows=load(ROOT)
    base=replay(rows,atr_ceiling=ATR_ADOPTED)
    budgets=[]
    for gap in ADVERSE_GAPS:
        for budget in RISK_BUDGETS:
            budgets.append(fixed_intent_grid(rows,budget,gap,ranking=False))
    ranking=[fixed_intent_grid(rows,b,g,ranking=True,max_one_same_h1=True)
             for g in ADVERSE_GAPS for b in RISK_BUDGETS]
    same_h1=next(x["same_h1_diagnostics"] for x in ranking if x["same_h1_diagnostics"])
    at_stop_examples=[
      {"description":"SHORT100 currently95, STOP101","entry":100,"mark":95,"stop":101,
       "net_floor_bps_ex_fees":-100},
      {"description":"SHORT100 currently95, STOP98","entry":100,"mark":95,"stop":98,
       "net_floor_bps_ex_fees":200},
    ]
    return {
        "status":"ATR2_5_ADOPTED_FOR_RESEARCH_PROXY_ONLY__FORMAL_BT_BLOCKED_BY_MISSING_EVIDENCE",
        "change_scope":"isolated research worktree; no LIVE/VPS or risk latch writes",
        "selection":{"atr_gate_pct":2.5,"atr_comparator_pct":2.7,"blanket_gross_cap":None,
                     "profit_locked_only_add_on":"CANDIDATE_NOT_ADOPTED",
                     "risk_budget_selection":"UNDETERMINED",
                     "ranking_policy_selection":"UNDETERMINED"},
        "source_sha256":{f:sha256(ROOT/f) for f in (
            "research/idle_priority_61_intents.json",
            "research/idle_priority_61_target_net.json",
            "research/idle_priority_393_generic_candidate_features.csv")},
        "baseline_atr25":{k:base[k] for k in ("10bps","20bps","30bps","pre_may_2026","may_2026_onward","highest_open_gross")},
        "baseline_atr27_comparator":{k:replay(rows,atr_ceiling=.027)[k]
                                      for k in ("10bps","20bps","30bps")},
        "atr25_stop_budget_proxy_6_cases":budgets,
        "atr25_same_h1_one_per_hour_ranked_6_cases":ranking,
        "same_h1_ranked_examples":same_h1,
        "profit_protection":{
            "eligibility":"requires net positive at signed verified resident STOP, full reduceOnly qty and reconcilable fees",
            "historical_exposure_status":"UNKNOWN__NO_SIGNED_HISTORICAL_STOP_READBACK",
            "hypothetical":at_stop_examples,
            "historical_profit_protected_only_bt":None},
        "latency":latency_status(ROOT),
        "integrated_v4_q102_hype_pengu_v52_fet_asset_and_dd":None,
        "limitations":[
            "Frozen accepted intents only: rejected Idle signals are not replaced by other strategies.",
            "STOP budget proxy uses each position's original gross and uniform 10% STOP; never historical venue STOP.",
            "RISK: no price path, mark-to-market equity, shared SHORT across runners or margin ownership.",
            "Same-H1 rank feature score is an a priori heuristic, NOT statistical expected value;",
            "Route prior completed outcome mean, where available, is from older realized trades only.",
            "Missing 5m/cross-venue fills and signed STOP snapshots: latency and profit-locked variants are NOT backtested.",
            "ATR2.5% was selected after inspecting the historical outlier; prospective/untouched validation needed.",
            "Net-weighted return attribution IS NOT portfolio final wealth or max drawdown."
        ]
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--output",type=Path)
    args=p.parse_args()
    d=run()
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(d,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"status":d["status"],"atr25":d["baseline_atr25"]["10bps"],
      "cases":[{"budget":q["budget_pct"],"gap":q["adverse_gap_pct"],
                "trades":q["10bps"]["trades"],"wins":q["10bps"]["wins"],
                "pf":q["10bps"]["pf"],"sum_pct":q["10bps"]["weighted_sum_return_pct"],
                "blocked_wins":q["blocked_winners"]}
               for q in d["atr25_stop_budget_proxy_6_cases"]],
      "same_h1_rank":d["same_h1_ranked_examples"],
      "latency_status":[x["status"] for x in d["latency"]]
    },ensure_ascii=False))

if __name__=="__main__":main()
