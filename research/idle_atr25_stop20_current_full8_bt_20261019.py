#!/usr/bin/env python3
"""Research-only exact Oct-17 eight-strategy compound portfolio replay with
Idle SHORT ATR<=2.5% and a *MODELED* account-wide short STOP-risk 20% budget.

Pinned source code, Q102/HYPE M5 exit overlays, DOT/RENDER 0.25x and trail,
V12 V4 routes, PENGU exits and every non-Idle candidate are unchanged.
No venue access or LIVE mutation. Other-runner STOPs are unavailable in the
historical portfolio, so the adverse STOP assumption is explicitly swept.
Historical pending exposure is not observable (H1 atomic fill model).
"""
from __future__ import annotations
import argparse, collections, hashlib, json, math, os, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
REPLAY = Path(r"C:/Users/dis/Desktop/disdex-idle-basket-bt-20261019")
sys.path.insert(0, str(REPLAY / "research"))
import long_two_axis_latest_full8_20261019 as prev

OUT = HERE / "docs/research/results/idle-atr25-stop20-full8-20261019"
OUT.mkdir(parents=True, exist_ok=True)
HOUR = 3_600_000
SYMS = ("DOTUSDT", "JUPUSDT", "RENDERUSDT", "TAOUSDT", "TIAUSDT")
CONTROL = {
    10: {"jpy": 222818966.87803495, "dd_pct": -15.62063681288941, "pf": 3.4587962777009813, "trades": 1310},
    30: {"jpy": 124289206.81827945, "dd_pct": -16.78776877493442, "pf": 3.0785603081685435, "trades": 1307},
}

# Three clearly distinct models. In all, the causal ATR filter is used.
# "FULL" rejects when risk cannot cover requested order; "PARTIAL" reduces
# quantity down to 0.25x, while retaining venue fractional feasibility.
CASES = {
    "ATR_ONLY": {"basket": False, "partial": False, "gap_pct": 2, "other_stop_pct": 10},
    "ATR_BUDGET20_FULL_REJECT_GAP2_OTHERSTOP10": {"basket": True, "partial": False, "gap_pct": 2, "other_stop_pct": 10},
    "ATR_BUDGET20_PARTIAL_GAP2_OTHERSTOP10": {"basket": True, "partial": True, "gap_pct": 2, "other_stop_pct": 10},
    "ATR_BUDGET20_PARTIAL_GAP0_OTHERSTOP10": {"basket": True, "partial": True, "gap_pct": 0, "other_stop_pct": 10},
    "ATR_BUDGET20_PARTIAL_GAP1_OTHERSTOP10": {"basket": True, "partial": True, "gap_pct": 1, "other_stop_pct": 10},
    "ATR_BUDGET20_PARTIAL_GAP2_OTHERSTOP5": {"basket": True, "partial": True, "gap_pct": 2, "other_stop_pct": 5},
    "ATR_BUDGET20_PARTIAL_GAP2_OTHERSTOP15": {"basket": True, "partial": True, "gap_pct": 2, "other_stop_pct": 15},
}

R, P = prev.bootstrap()
prev.ensure_baseline(P)
R.COUNTS = {"changed":0,"byStrategy":{},"byReason":{},"warnings":{}}
P.OUT = OUT
P.base.OUTROOT = OUT
OLD_SOURCE_PATCH = P.base.BASE_ADMISSION_PATCH
OLD_EXPERIMENT_FILTER = P.experiment_filter
RUN_CONFIG = dict(CASES["ATR_ONLY"])
RUN_CASE = "ATR_ONLY"
ATR_OBS: dict[str, object] = {}

def current_h1_atr_ratio(candidate: dict) -> float | None:
    ts = int(candidate["entry_ts_ms"])
    symbol = str(candidate["symbol"])
    if ts % HOUR != 0:
        return None
    # s.w.bars is from the frozen Aster H1 archive. Exactly 14 prior
    # confirmed hours are used, never any OPEN/current H1 candle.
    atr = P.base.atr14(symbol, ts)
    prev_close = P.base.hbar(symbol, ts-HOUR)
    if atr is None or not prev_close or float(prev_close["close"]) <= 0:
        return None
    ratio = float(atr) / float(prev_close["close"])
    return ratio if math.isfinite(ratio) and ratio >= 0 else None

def decorated_filter(base_filter, policy, obs):
    upstream = OLD_EXPERIMENT_FILTER(base_filter, policy, obs)
    def filt(candidates, case):
        rows = upstream(candidates, case)
        counts = obs.setdefault("atr25_research_candidate_counts", {"all":0,"over_2p5":0,"unknown":0})
        for row in rows:
            if row["strategy_id"] != "IDLE":
                continue
            atr = current_h1_atr_ratio(row)
            row["_idle_confirmed_atr_ratio"] = atr
            counts["all"] += 1
            if atr is None: counts["unknown"] += 1
            elif atr > .025: counts["over_2p5"] += 1
        return rows
    return filt

P.base.wrapped_filter = decorated_filter

def augmented_source_patch(source, strict):
    q = OLD_SOURCE_PATCH(source, strict)
    if RUN_CONFIG["basket"] and RUN_CONFIG["partial"]:
        original = "elif room + 1e-9 < (float(candidate['requested_gross']) if strategy=='IDLE' else 1.0):"
        changed = "elif room + 1e-9 < (min(0.25,float(candidate['requested_gross'])) if strategy=='IDLE' else 1.0):"
        assert q.count(original)==1, ("PARTIAL_ROOM_HOOK_MISMATCH",q.count(original))
        q = q.replace(original, changed, 1)

    target = "                accepted_gross = min(requested, room)\n"
    assert q.count(target)==1, ("RISK_HOOK_MISMATCH",q.count(target))
    s = '''                if strategy == "IDLE":
                    idle_atr = candidate.get("_idle_confirmed_atr_ratio")
                    if idle_atr is None or not math.isfinite(float(idle_atr)):
                        reason="IDLE:ATR25_H1_DATA_UNAVAILABLE"
                        record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts)
                        rejected[reason]+=1
                        continue
                    if float(idle_atr)>0.025+1e-12:
                        reason="IDLE:ATR25_GATE"
                        record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts)
                        rejected[reason]+=1
                        continue
'''
    if RUN_CONFIG["basket"]:
        gap = RUN_CONFIG["gap_pct"]/100
        other = RUN_CONFIG["other_stop_pct"]/100
        s += f'''                    # Counterfactual historical portfolio STOP-risk (NOT verified venue STOP).
                    basket_existing_risk = 0.0
                    for existing in active.values():
                        if existing["side"]!="SHORT":
                            continue
                        mark_existing=_mark(market,existing["symbol"],ts)
                        if mark_existing is None or mark_existing<=0:
                            raise ValueError("BASKET_SHORT_MARK_UNVERIFIED")
                        actual_entry=float(existing["entry_price"])
                        native_stop=.10 if existing["strategy_id"]=="IDLE" else {other!r}
                        modeled_stressed_stop=actual_entry*(1+native_stop+{gap!r})
                        basket_existing_risk+=float(existing["quantity"])*max(0.,modeled_stressed_stop-mark_existing)
                    basket_remaining=max(0.,equity*0.20-basket_existing_risk)
                    basket_order_risk_per_notional=(0.10+{gap!r}+0.001)
                    basket_possible_gross=basket_remaining/(equity*basket_order_risk_per_notional)
                    basket_requested=min(requested,room)
'''
        if RUN_CONFIG["partial"]:
            s += '''                    # The formal Idle SHORT partial-sizing contract requires a
                    # minimum attempted order size of 0.25x, not the smaller
                    # raw H1 intent gross. Never promote a subfloor order.
                    if min(basket_possible_gross,basket_requested)+1e-9<0.25:
                        reason="IDLE:BASKET20_LT_MIN025"
                        record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts)
                        rejected[reason]+=1
                        continue
                    requested=min(requested,basket_possible_gross)
'''
        else:
            s += '''                    if basket_possible_gross+1e-9<basket_requested:
                        reason="IDLE:BASKET20_FULL_REJECT"
                        record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts)
                        rejected[reason]+=1
                        continue
'''
    q = q.replace(target, s+target, 1)
    if RUN_CONFIG["basket"] and RUN_CONFIG["partial"]:
        # Venue quantity normalization can floor the actual filled gross
        # far below the 0.25x attempted budget gross on integer-lot assets.
        # Exactly one venue step of <=1% of approved gross is tolerated.
        fill_target="                accepted_gross=notional/equity\n"
        assert q.count(fill_target)==1, ("ACTUAL_GROSS_HOOK_MISMATCH",q.count(fill_target))
        fill_gate = """                if strategy=="IDLE" and accepted_gross < 0.2475 - 1e-9:
                    reason="IDLE:BASKET20_VENUE_FLOOR_BELOW_MIN025"
                    record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts)
                    rejected[reason]+=1
                    continue
"""
        q=q.replace(fill_target,fill_target+fill_gate,1)
    return q

P.base.BASE_ADMISSION_PATCH = augmented_source_patch

def rows_jsonl(p: Path):
    with p.open(encoding="utf8") as f:
        for ln in f:
            if ln.strip(): yield json.loads(ln)

def result_one(case: str, cost: int) -> dict:
    global RUN_CONFIG, RUN_CASE
    RUN_CONFIG=dict(CASES[case])
    RUN_CASE=case
    # Include five symbols in the eligible-fractional set; only DOT/RENDER
    # actually change original requested gross. Others retain 1x unless
    # 20% basket residual sizing is triggered.
    # Original Oct-17 policies were venue-fractional-enabled ONLY for DOT
    # and RENDER. Keep this exact policy for ATR-only and full-reject runs.
    # The partial experiment explicitly widens fractional eligibility; report
    # and isolate this policy widening from the STOP budget effect.
    sizes = {"DOTUSDT":.25, "RENDERUSDT":.25}
    if RUN_CONFIG["partial"]:
        sizes.update({"JUPUSDT":1., "TAOUSDT":1., "TIAUSDT":1.})
    P.POLICIES[case] = {
        "sizes": sizes,
        "exit": "IDLE_13_TRAIL_3_GIVEBACK_1p5",
        "symbols": {"DOTUSDT", "RENDERUSDT"},
    }
    print("START_FULL8_ATR25_BASKET",case,cost,flush=True)
    st=time.monotonic()
    result=P.run(case,cost)
    assert result["accounting"]=="PASS", ("ACCOUNTING_FAIL",case,cost)
    folder=OUT/case/f"{cost}bps"/"cases"/P.base.CASE_NAME/"runs"
    ledgers=list(folder.glob("*/portfolio-trades.jsonl"))
    decisions=list(folder.glob("*/candidate-decisions.jsonl"))
    assert len(ledgers)==len(decisions)==1, (case,cost,"REPLAY_LEDGER_MISSING")
    trades=list(rows_jsonl(ledgers[0]))
    decs=list(rows_jsonl(decisions[0]))
    idle=[t for t in trades if t["strategy_id"]=="IDLE"]
    idle_dec=[d for d in decs if d["strategy_id"]=="IDLE"]
    reasons=dict(collections.Counter(d["reason"] for d in idle_dec if d["decision"]!="ACCEPTED_MODELED_ENTRY"))
    # Historical fractional / capacity: accepted can shrink also due to
    # exchange lot floor and old per-strategy gross, so compare to source
    # requested gross for an upper-bound, do not claim every shrink was basket.
    details=[{
        "symbol":t["symbol"],"entry_ts_ms":t["entry_ts_ms"],
        "requested_gross":t.get("candidate_requested_gross"),"accepted_gross":t.get("accepted_gross"),
        "side":t["side"],"pnl":t.get("total_pnl_jpy"),"exit_ts_ms":t["exit_ts_ms"],
    } for t in idle]
    baseline=CONTROL[cost]
    out={
      "case":case,"cost_bps":cost,"source":"2026-10-17 latest frozen H1 8-strategy portfolio + 5m Q102/HYPE/Idle overlays",
      "case_config":RUN_CONFIG,"research_only":True,
      "model_limitations":[
         "Other-runner historical resident STOPs unknown. Non-Idle SHORT assumed a static initial STOP at other_stop_pct of entry, with no profit locking.",
         "Idle resident STOP assumed initial 10%, with 0-2% adverse gap and roundtrip 10bps assumed in new-order loss budget; physical STOP fills are NOT replayed.",
         "Only Idle admission and size change; all eight source engine candidate/exits otherwise unchanged.",
         "H1 atomic simulator has no actual pending async order reservation, venue signatures, margin orders or account-lock latency.",
         "In-sample public market M5 normalized on historical Aster H1; not Aster tick execution.",
         "No exact current trading LIVE certification or 2026-Oct19 updated entry signatures.",
      ],
      "final_jpy":result["final_jpy"],"max_dd_pct":result["max_dd_pct"],
      "pf":result["pf"],"win_pct":result["win_pct"],"trades":result["annual_trades"],
      "accounting":result["accounting"],"trade_counts":result["all_trades_by_strategy"],
      "baseline_jpy":baseline["jpy"],"baseline_dd_pct":baseline["dd_pct"],
      "delta_jpy":result["final_jpy"]-baseline["jpy"],
      "dd_improvement_pp":result["max_dd_pct"]-baseline["dd_pct"],
      "idle_trades":len(idle),"idle_trade_details":details,
      "idle_rejected_reasons":reasons,
      "idle_capped_or_venue_rounded_trades":sum(
        0<float(x["accepted_gross"])<float(x["candidate_requested_gross"])-0.01
        for x in idle if x.get("candidate_requested_gross")
      ),
      "observations":result.get("sizing_candidate_N"),
      "timing_seconds":round(time.monotonic()-st,2),
    }
    file=OUT/(case+f"_{cost}BPS.json")
    file.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print("FULL8_ATR25_BASKET_RESULT",json.dumps({k:out[k] for k in (
        "case","cost_bps","final_jpy","max_dd_pct","pf","win_pct","trades",
        "delta_jpy","dd_improvement_pp","idle_trades","idle_rejected_reasons",
        "idle_capped_or_venue_rounded_trades","timing_seconds"
    )},ensure_ascii=False),flush=True)
    return out

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--cases",default="ATR_ONLY,ATR_BUDGET20_FULL_REJECT_GAP2_OTHERSTOP10,ATR_BUDGET20_PARTIAL_GAP2_OTHERSTOP10")
    parser.add_argument("--costs",default="10,30")
    args=parser.parse_args()
    chosen=args.cases.split(",");costs=[int(x) for x in args.costs.split(",")]
    for case in chosen:
        if case not in CASES:raise ValueError(case)
        for cost in costs:result_one(case,cost)
    print("ALL_CAUSAL_FULL8_BASKET_REPLAYS_DONE",len(chosen)*len(costs),flush=True)

if __name__=="__main__":
    main()
