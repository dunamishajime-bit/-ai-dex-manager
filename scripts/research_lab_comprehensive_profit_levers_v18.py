from __future__ import annotations

import hashlib
import json
import math
import os
import statistics
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_asymmetric_bear_hedge_v5 as v5
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_fixed_candidate_robustness_v7 as v7

COMPONENTS = [
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M10_B3.5_K1", 30, 10, 3.5, 1),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M10_B5.5_K1", 30, 10, 5.5, 1),
    v4.Component("MH_12H_LONG_CASH_CORE3_R42_M10_B3.5_K1", 42, 10, 3.5, 1),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M30_B3.5_K2", 30, 30, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R42_M30_B3.5_K2", 42, 30, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M10_B3.5_K2", 30, 10, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M10_B5.5_K2", 30, 10, 5.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M20_B3.5_K2", 30, 20, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R42_M10_B3.5_K2", 42, 10, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R42_M20_B3.5_K2", 42, 20, 3.5, 2),
]
OVERLAY = v4.Overlay("BAG_V50_S0_TV45_G1.1_CNONE", 0.5, 0, 45, 1.1, None)
HEDGE = v5.Hedge("H_BTC_S60_M30_G0.4", 60, 30, 0.4, "BTC")
CONFIRM_BARS = 4

SCENARIOS = [
    v7.ExecutionScenario("BASE_10BPS", 10, 0, 0),
    v7.ExecutionScenario("COST30", 30, 0, 0),
    v7.ExecutionScenario("DELAY12H", 10, 1, 0),
    v7.ExecutionScenario("SEVERE_50BPS_DELAY12H_FUND3", 50, 1, 3),
]
EXECUTION_SENSITIVITY = [
    v7.ExecutionScenario("V17_OPTIMISTIC_8BPS", 8, 0, 0),
    v7.ExecutionScenario("V17_CONSERVATIVE_12BPS", 12, 0, 0),
]

@dataclass(frozen=True)
class Policy:
    policy_id: str
    family: str
    entry_confirm_bars: int = 1
    min_entry_support: float = 0.0
    early_stop_bars: int = 0
    early_stop_pct: float = 0.0
    hard_stop_pct: float = 0.0
    bear_hard_stop_pct: float = 0.0
    trail_arm_pct: float = 0.0
    trail_drawdown_pct: float = 0.0
    winner_hold_bars: int = 0
    winner_min_profit_pct: float = 0.0
    winner_hold_fraction: float = 1.0
    satellite_lookback_bars: int = 0
    satellite_entry_z: float = 0.0
    satellite_max_hold_bars: int = 0
    satellite_gross: float = 0.0
    satellite_btc_range_momentum_pct: float = 0.0

BASE_POLICY = Policy("V6_BASELINE", "BASELINE")

def side(w: Dict[str, float]) -> int:
    n = sum(w.values())
    return 1 if n > .02 else (-1 if n < -.02 else 0)

def clean(w: Dict[str, float]) -> Dict[str, float]:
    return {s: float(x) for s, x in w.items() if abs(x) >= 1e-8}

def sig(w: Dict[str, float]) -> Tuple[Tuple[str, int], ...]:
    return tuple(sorted((s, 1 if x > 0 else -1) for s, x in w.items() if abs(x) >= .05))

def prod(xs: List[float]) -> float:
    return v4.product_return(xs)

def scale(w: Dict[str, float], f: float) -> Dict[str, float]:
    return clean({s: x * f for s, x in w.items()})

def support_map(projected: Dict[int, List[Dict[str, float]]], times: List[int]) -> Dict[int, float]:
    return {ts: (sum(v4.gross_exposure(x) > .05 for x in projected[ts]) / len(projected[ts]) if projected[ts] else 0) for ts in times}

def bar_return(weights, ts, bars, indexes) -> float:
    total = 0.0
    for symbol, weight in weights.items():
        i = indexes[symbol].get(ts)
        if i is not None:
            b = bars[symbol][i]
            total += weight * (float(b["close"]) / float(b["open"]) - 1) * 100
    return total

def zscore(rows: List[dict], index: int, lookback: int) -> Optional[float]:
    if index - lookback + 1 < 0:
        return None
    xs = [float(x["close"]) for x in rows[index-lookback+1:index+1]]
    sd = statistics.pstdev(xs)
    return (xs[-1] - statistics.fmean(xs)) / sd if sd > 0 else None

def build_targets(raw, projected, times, bars, indexes, policy: Policy):
    supports = support_map(projected, times)
    out: Dict[int, Dict[str, float]] = {}
    held: Dict[str, float] = {}
    origin = "NONE"
    cycle: List[float] = []
    peak = 0.0
    block = tuple()
    entry_candidate = tuple(); entry_count = 0
    extension_used = 0
    sat_symbol: Optional[str] = None; sat_dir = 0; sat_bars = 0

    for ts in times:
        if held:
            cycle.append(bar_return(held, ts, bars, indexes))
            peak = max(peak, prod(cycle))
        raw_desired = clean(raw.get(ts, {}))
        raw_sig = sig(raw_desired)
        if block and raw_sig != block:
            block = tuple()

        risk_exit = False
        if held and cycle:
            cumulative = prod(cycle); bars_held = len(cycle)
            hard = policy.bear_hard_stop_pct if side(held) < 0 and policy.bear_hard_stop_pct else policy.hard_stop_pct
            risk_exit = (
                (hard > 0 and cumulative <= -hard)
                or (policy.early_stop_bars > 0 and bars_held <= policy.early_stop_bars and cumulative <= -policy.early_stop_pct)
                or (policy.trail_arm_pct > 0 and peak >= policy.trail_arm_pct and peak - cumulative >= policy.trail_drawdown_pct)
            )

        desired = raw_desired
        next_origin = "V6" if desired else "NONE"
        if risk_exit:
            desired = {}; next_origin = "NONE"; block = raw_sig
        elif block and raw_sig == block:
            desired = {}; next_origin = "NONE"
        elif not held and side(raw_desired) > 0 and (policy.entry_confirm_bars > 1 or policy.min_entry_support > 0):
            if raw_sig == entry_candidate: entry_count += 1
            else: entry_candidate, entry_count = raw_sig, 1
            if entry_count < policy.entry_confirm_bars or supports.get(ts, 0) < policy.min_entry_support:
                desired = {}; next_origin = "NONE"
            else:
                entry_candidate = tuple(); entry_count = 0
        elif side(raw_desired) <= 0:
            entry_candidate = tuple(); entry_count = 0

        if held and side(held) > 0 and not raw_desired and not risk_exit and policy.winner_hold_bars > 0 and cycle:
            i = indexes["BTC"].get(ts); trend_ok = False
            if i is not None:
                ma = v4.sma(bars["BTC"], i, 60); mom = v4.momentum(bars["BTC"], i, 20)
                trend_ok = ma is not None and mom is not None and float(bars["BTC"][i]["close"]) > ma and mom > 0
            if prod(cycle) >= policy.winner_min_profit_pct and trend_ok and extension_used < policy.winner_hold_bars:
                desired = scale(held, policy.winner_hold_fraction); next_origin = origin; extension_used += 1

        if policy.satellite_lookback_bars > 0:
            if raw_desired:
                sat_symbol = None; sat_dir = 0; sat_bars = 0
            elif origin == "SAT" and held:
                sat_bars += 1
                i = indexes[sat_symbol].get(ts) if sat_symbol else None
                z = zscore(bars[sat_symbol], i, policy.satellite_lookback_bars) if i is not None and sat_symbol else None
                btc_i = indexes["BTC"].get(ts); btc_m = v4.momentum(bars["BTC"], btc_i, 40) if btc_i is not None else None
                range_ok = btc_m is not None and abs(btc_m) <= policy.satellite_btc_range_momentum_pct
                crossed = z is None or (sat_dir > 0 and z >= 0) or (sat_dir < 0 and z <= 0)
                if range_ok and not crossed and sat_bars < policy.satellite_max_hold_bars:
                    desired = {sat_symbol: sat_dir * policy.satellite_gross}; next_origin = "SAT"
                else:
                    sat_symbol = None; sat_dir = 0; sat_bars = 0; desired = {}; next_origin = "NONE"
            elif not held and not raw_desired and not block:
                btc_i = indexes["BTC"].get(ts); btc_m = v4.momentum(bars["BTC"], btc_i, 40) if btc_i is not None else None
                if btc_m is not None and abs(btc_m) <= policy.satellite_btc_range_momentum_pct:
                    choices = []
                    for symbol in ["LINK", "AVAX"]:
                        i = indexes[symbol].get(ts); z = zscore(bars[symbol], i, policy.satellite_lookback_bars) if i is not None else None
                        if z is not None: choices.append((abs(z), symbol, z))
                    if choices:
                        _, symbol, z = max(choices)
                        if abs(z) >= policy.satellite_entry_z:
                            sat_symbol, sat_dir, sat_bars = symbol, (-1 if z > 0 else 1), 0
                            desired = {symbol: sat_dir * policy.satellite_gross}; next_origin = "SAT"

        desired = clean(desired)
        if desired != held:
            held = desired; origin = next_origin; cycle = []; peak = 0.0; extension_used = 0
        out[ts] = dict(held)
    return out

def trace_cycles(targets, times, bars, indexes, funding, start, end, cost_bps=10):
    active = [ts for ts in times if start <= ts < end]; gi = {ts:i for i,ts in enumerate(times)}
    portfolio = {}; values=[]; pre=[]; peaks=[]; records=[]; start_ts=-1
    def close(ts, reason):
        nonlocal values, pre, peaks, start_ts
        if start_ts >= 0 and values:
            records.append({"startTs":start_ts,"endTs":ts,"netPct":prod(values),"preCostPct":prod(pre),"peakPct":max(peaks) if peaks else 0,"firstTwoPeakPct":max(peaks[:2]) if peaks else 0,"startSide":side(portfolio),"exitReason":reason})
        values=[]; pre=[]; peaks=[]; start_ts=-1
    for ts in active:
        si=gi[ts]-1; nxt=targets.get(times[si],{}) if si>=0 else {}
        if nxt != portfolio:
            reason = "LONG_ROTATION" if side(portfolio)>0 and side(nxt)>0 else ("CASH_EXIT" if not nxt else ("OPPOSITE_SIDE" if side(portfolio) and side(nxt)!=side(portfolio) else "ENTRY"))
            close(ts-1,reason); turnover=v4.turnover(portfolio,nxt); portfolio=nxt
            if portfolio: start_ts=ts
        else: turnover=0
        gross=bar_return(portfolio,ts,bars,indexes); actual=sum(w*funding.get(s,{}).get(ts,0) for s,w in portfolio.items())
        p=gross-actual; n=p-turnover*cost_bps/100
        if start_ts>=0:
            values.append(n); pre.append(p); peaks.append(prod(values))
    if portfolio and values: values[-1]-=v4.gross_exposure(portfolio)*cost_bps/100
    close(end-1,"END_OF_PERIOD")
    return records

def enrich(metrics, records):
    wins=[x["netPct"] for x in records if x["netPct"]>0]; losses=[x["netPct"] for x in records if x["netPct"]<0]
    m=dict(metrics); m["cycleEnrichment"]={"averageWinPct":statistics.fmean(wins) if wins else None,"averageLossPct":statistics.fmean(losses) if losses else None,"payoffRatio":(statistics.fmean(wins)/abs(statistics.fmean(losses))) if wins and losses else None,"tailLossCyclesLeMinus5":sum(x<=-5 for x in losses)}
    return m

def run(targets,times,bars,indexes,funding,start,end,include_exec=False):
    result={}
    for sc in SCENARIOS + (EXECUTION_SENSITIVITY if include_exec else []):
        m=v7.simulate_scenario(sc,targets,times,bars,indexes,funding,start,end)
        result[sc.scenario_id]=enrich(m,trace_cycles(targets,times,bars,indexes,funding,start,end,sc.cost_bps_per_side)) if sc.scenario_id=="BASE_10BPS" else m
    return result

def classify(records):
    names={"ENTRY_IMMEDIATE_ADVERSE":lambda x:x["firstTwoPeakPct"]<=0,"PROFIT_REVERSAL_TO_LOSS":lambda x:x["peakPct"]>=2,"LONG_ROTATION_LOSS":lambda x:x["exitReason"]=="LONG_ROTATION","REGIME_OR_CASH_EXIT_LOSS":lambda x:x["exitReason"] in {"CASH_EXIT","OPPOSITE_SIDE","END_OF_PERIOD"},"COST_FLIP":lambda x:x["preCostPct"]>0,"TAIL_LOSS_LE_MINUS5":lambda x:x["netPct"]<=-5,"BEAR_HEDGE_LOSS":lambda x:x["startSide"]<0}
    losses=[x for x in records if x["netPct"]<0]; total=abs(sum(x["netPct"] for x in losses))
    return {n:{"cycles":len(xs:= [x for x in losses if fn(x)]),"netLossPctSum":sum(x["netPct"] for x in xs),"shareOfAbsoluteLossPct":abs(sum(x["netPct"] for x in xs))/total*100 if total else 0} for n,fn in names.items()}

def delta(c,b):
    x=c["BASE_10BPS"]; y=b["BASE_10BPS"]; xe=x["cycleEnrichment"]; ye=y["cycleEnrichment"]
    return {"winRateDeltaPctPoint":(x["winRatePct"] or 0)-(y["winRatePct"] or 0),"cycleDeltaPct":((x["cycles"]/y["cycles"]-1)*100 if y["cycles"] else 0),"cagrDeltaPctPoint":x["cagrPct"]-y["cagrPct"],"cagrRetentionPct":x["cagrPct"]/y["cagrPct"]*100 if y["cagrPct"]>0 else 0,"pfDelta":(x["profitFactor"] or 0)-(y["profitFactor"] or 0),"ddImprovementPctPoint":x["maxDrawdownPct"]-y["maxDrawdownPct"],"worstCycleImprovementPctPoint":(x["worstCyclePct"] or 0)-(y["worstCyclePct"] or 0),"averageWinDeltaPctPoint":(xe["averageWinPct"] or 0)-(ye["averageWinPct"] or 0),"averageLossImprovementPctPoint":(xe["averageLossPct"] or 0)-(ye["averageLossPct"] or 0),"severeReturnDeltaPctPoint":c["SEVERE_50BPS_DELAY12H_FUND3"]["compoundedReturnPct"]-b["SEVERE_50BPS_DELAY12H_FUND3"]["compoundedReturnPct"]}

def families():
    return {
      "WIN_RATE":[Policy(f"ENTRY_Q{q}_S{int(s*100)}","WIN_RATE",entry_confirm_bars=q,min_entry_support=s) for q in [2,3] for s in [.5,.6,.7]],
      "LOSS_REDUCTION":[Policy("LOSS_HARD4","LOSS_REDUCTION",hard_stop_pct=4),Policy("LOSS_HARD6","LOSS_REDUCTION",hard_stop_pct=6),Policy("LOSS_HARD8","LOSS_REDUCTION",hard_stop_pct=8),Policy("LOSS_EARLY1_2_H8","LOSS_REDUCTION",early_stop_bars=1,early_stop_pct=2,hard_stop_pct=8),Policy("LOSS_EARLY2_3_H8","LOSS_REDUCTION",early_stop_bars=2,early_stop_pct=3,hard_stop_pct=8),Policy("LOSS_TRAIL3_3_H8","LOSS_REDUCTION",hard_stop_pct=8,trail_arm_pct=3,trail_drawdown_pct=3),Policy("LOSS_TRAIL5_4_H8","LOSS_REDUCTION",hard_stop_pct=8,trail_arm_pct=5,trail_drawdown_pct=4),Policy("LOSS_ASYM","LOSS_REDUCTION",early_stop_bars=2,early_stop_pct=3,hard_stop_pct=8,bear_hard_stop_pct=4,trail_arm_pct=4,trail_drawdown_pct=3)],
      "PROFIT_EXTENSION":[Policy(f"PROFIT_H{h}_P{int(p)}_F{int(f*100)}","PROFIT_EXTENSION",winner_hold_bars=h,winner_min_profit_pct=p,winner_hold_fraction=f) for h in [1,2] for p in [2.,4.] for f in [.5,1.]],
      "TRADE_COUNT":[Policy(f"OPP_L{l}_Z{str(z).replace('.','')}_H{h}","TRADE_COUNT",satellite_lookback_bars=l,satellite_entry_z=z,satellite_max_hold_bars=h,satellite_gross=.3,satellite_btc_range_momentum_pct=10) for l in [20,40] for z in [1.5,2.] for h in [4,8]],
    }

def dev_pass(f,r,b,d):
    x=r["BASE_10BPS"]; common=x["compoundedReturnPct"]>0 and (x["profitFactor"] or 0)>=1.2 and x["maxDrawdownPct"]>=-35 and (r["COST30"]["profitFactor"] or 0)>=1.12 and (r["DELAY12H"]["profitFactor"] or 0)>=1.08 and r["SEVERE_50BPS_DELAY12H_FUND3"]["maxDrawdownPct"]>=-50 and d["cagrRetentionPct"]>=70
    return common and ((f=="WIN_RATE" and d["winRateDeltaPctPoint"]>=2 and d["cagrRetentionPct"]>=80 and d["pfDelta"]>=-.03) or (f=="LOSS_REDUCTION" and d["averageLossImprovementPctPoint"]>=.25 and d["worstCycleImprovementPctPoint"]>=1 and (d["ddImprovementPctPoint"]>=1 or d["severeReturnDeltaPctPoint"]>=3) and d["pfDelta"]>=0) or (f=="PROFIT_EXTENSION" and d["averageWinDeltaPctPoint"]>=.2 and d["cagrDeltaPctPoint"]>=2 and d["pfDelta"]>=-.02) or (f=="TRADE_COUNT" and d["cycleDeltaPct"]>=15 and d["cagrDeltaPctPoint"]>=2 and (x["profitFactor"] or 0)>=1.25))
def val_pass(f,r,b,d):
    x=r["BASE_10BPS"]; common=x["compoundedReturnPct"]>0 and (x["profitFactor"] or 0)>=1.05 and (r["COST30"]["profitFactor"] or 0)>=1 and (r["DELAY12H"]["profitFactor"] or 0)>=1 and r["SEVERE_50BPS_DELAY12H_FUND3"]["maxDrawdownPct"]>=-30 and d["cagrRetentionPct"]>=60
    return common and ((f=="WIN_RATE" and d["winRateDeltaPctPoint"]>=1 and d["pfDelta"]>=-.05) or (f=="LOSS_REDUCTION" and d["averageLossImprovementPctPoint"]>0 and d["worstCycleImprovementPctPoint"]>0 and d["pfDelta"]>=-.03) or (f=="PROFIT_EXTENSION" and d["averageWinDeltaPctPoint"]>0 and d["cagrDeltaPctPoint"]>0 and d["pfDelta"]>=-.04) or (f=="TRADE_COUNT" and d["cycleDeltaPct"]>=10 and d["cagrDeltaPctPoint"]>0 and (x["profitFactor"] or 0)>=1.1))
def merge(pid,ps):
    m=Policy(pid,"COMBINED")
    for p in ps:
        for k in Policy.__dataclass_fields__:
            if k not in {"policy_id","family"} and getattr(p,k)!=getattr(BASE_POLICY,k): m=replace(m,**{k:getattr(p,k)})
    return m
def overall(r,b,d):
    x=r["BASE_10BPS"]
    return x["compoundedReturnPct"]>0 and (x["profitFactor"] or 0)>=max(1.25,(b["BASE_10BPS"]["profitFactor"] or 0)+.02) and d["cagrRetentionPct"]>=80 and (r["COST30"]["profitFactor"] or 0)>=(b["COST30"]["profitFactor"] or 0) and (r["DELAY12H"]["profitFactor"] or 0)>=(b["DELAY12H"]["profitFactor"] or 0)-.02 and d["severeReturnDeltaPctPoint"]>=2 and max(d["ddImprovementPctPoint"],d["worstCycleImprovementPctPoint"],d["winRateDeltaPctPoint"],d["cycleDeltaPct"]/7.5,d["averageWinDeltaPctPoint"]*5)>=1
def holdout(r):
    return r["BASE_10BPS"]["compoundedReturnPct"]>0 and (r["BASE_10BPS"]["profitFactor"] or 0)>=1.1 and r["COST30"]["compoundedReturnPct"]>0 and (r["COST30"]["profitFactor"] or 0)>=1.05 and r["DELAY12H"]["compoundedReturnPct"]>0 and (r["DELAY12H"]["profitFactor"] or 0)>=1 and r["SEVERE_50BPS_DELAY12H_FUND3"]["compoundedReturnPct"]>=0 and all(x["maxDrawdownPct"]>=-20 for x in r.values())
def rounded(x):
    if isinstance(x,float): return round(x,4)
    if isinstance(x,dict): return {k:rounded(v) for k,v in x.items()}
    if isinstance(x,list): return [rounded(v) for v in x]
    return x

def main():
    state=Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR",".research-state")).resolve(); cache=Path.cwd()/".cache"/"perp-research-usdm"
    raw={s:v4.load_symbol(cache,s) for s in v4.SYMBOLS}; bars={s:v4.resample_12h(raw[s]["candles"]) for s in v4.SYMBOLS}; indexes={s:{int(b["ts"]):i for i,b in enumerate(rows)} for s,rows in bars.items()}; funding=v6.funding_buckets({s:raw[s]["funding"] for s in v4.SYMBOLS}); times=[int(b["ts"]) for b in bars["BTC"] if v4.START_2023<=int(b["ts"])<v4.END]
    projected=v6.precompute_projected_members(COMPONENTS,times,bars,indexes); base=v6.precompute_base_targets([OVERLAY],times,projected,bars,indexes); bear=v6.precompute_bear_targets([HEDGE],times,bars,indexes); raw_targets=v7.desired_targets(OVERLAY,HEDGE,CONFIRM_BARS,times,base,bear)
    bdev=run(raw_targets,times,bars,indexes,funding,v4.START_2023,v4.START_2025,True); bval=run(raw_targets,times,bars,indexes,funding,v4.START_2025,v4.START_2026); attribution=classify(trace_cycles(raw_targets,times,bars,indexes,funding,v4.START_2023,v4.START_2025))
    results={}; winners={}
    for fam,ps in families().items():
        cs=[]; cache_targets={}
        for p in ps:
            t=build_targets(raw_targets,projected,times,bars,indexes,p); cache_targets[p.policy_id]=t; r=run(t,times,bars,indexes,funding,v4.START_2023,v4.START_2025); d=delta(r,bdev); cs.append({"policy":p.__dict__,"development":r,"developmentDelta":d,"developmentPassed":dev_pass(fam,r,bdev,d)})
        passed=[x for x in cs if x["developmentPassed"]]; passed.sort(key=lambda x:(x["development"]["BASE_10BPS"]["profitFactor"] or 0,x["development"]["BASE_10BPS"]["cagrPct"],x["developmentDelta"]["severeReturnDeltaPctPoint"]),reverse=True); sel=passed[0] if passed else None
        vr=vd=None; vok=False
        if sel:
            p=Policy(**sel["policy"]); winners[fam]=p; vr=run(cache_targets[p.policy_id],times,bars,indexes,funding,v4.START_2025,v4.START_2026); vd=delta(vr,bval); vok=val_pass(fam,vr,bval,vd)
        results[fam]={"candidateCount":len(cs),"developmentPassed":len(passed),"selected":({**sel,"validation":vr,"validationDelta":vd,"validationPassed":vok} if sel else None),"candidates":cs}
    combos=[]; vals=list(winners.values())
    if "WIN_RATE" in winners and "LOSS_REDUCTION" in winners: combos.append(merge("COMBO_ENTRY_LOSS",[winners["WIN_RATE"],winners["LOSS_REDUCTION"]]))
    if "LOSS_REDUCTION" in winners and "PROFIT_EXTENSION" in winners: combos.append(merge("COMBO_LOSS_PROFIT",[winners["LOSS_REDUCTION"],winners["PROFIT_EXTENSION"]]))
    if "LOSS_REDUCTION" in winners and "TRADE_COUNT" in winners: combos.append(merge("COMBO_LOSS_OPPORTUNITY",[winners["LOSS_REDUCTION"],winners["TRADE_COUNT"]]))
    if len(vals)>=2: combos.append(merge("COMBO_ALL_DEV_WINNERS",vals))
    cc=[]; ct={}
    for p in combos:
        t=build_targets(raw_targets,projected,times,bars,indexes,p); ct[p.policy_id]=t; r=run(t,times,bars,indexes,funding,v4.START_2023,v4.START_2025); d=delta(r,bdev); cc.append({"policy":p.__dict__,"development":r,"developmentDelta":d,"developmentPassed":overall(r,bdev,d)})
    cp=[x for x in cc if x["developmentPassed"]]; cp.sort(key=lambda x:(x["development"]["BASE_10BPS"]["profitFactor"] or 0,x["development"]["BASE_10BPS"]["cagrPct"]),reverse=True); sel=cp[0] if cp else None; vr=vd=final=None; vok=fok=False
    if sel:
        p=Policy(**sel["policy"]); vr=run(ct[p.policy_id],times,bars,indexes,funding,v4.START_2025,v4.START_2026); vd=delta(vr,bval); vok=overall(vr,bval,vd)
        if vok: final=run(ct[p.policy_id],times,bars,indexes,funding,v4.START_2026,v4.END); fok=holdout(final)
    status="FORWARD_PAPER_CANDIDATE_ALL_PROFIT_LEVERS" if fok else ("FINAL_2026_COMBINED_REJECTED" if vok else ("VALIDATION_2025_COMBINED_REJECTED" if sel else "NO_COMBINED_ROBUST_PROFIT_IMPROVEMENT"))
    result=rounded({"version":18,"strategyId":"COMPREHENSIVE_PROFIT_LEVERS_V18","generatedAt":__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),"status":status,"researchDesign":{"development":"2023-2024","validation":"2025","holdout":"2026H1 only after validation","families":["WIN_RATE","LOSS_REDUCTION","PROFIT_EXTENSION","TRADE_COUNT","EXECUTION_COST_SENSITIVITY"],"noSameRunRetuningAfterValidation":True},"baselineDevelopment":bdev,"baselineValidation":bval,"baselineLossAttribution2023_2024":attribution,"executionCostSensitivity":{"note":"V17 8/12bps is sensitivity only, not historical order-book BT.","optimistic8bps":bdev["V17_OPTIMISTIC_8BPS"],"conservative12bps":bdev["V17_CONSERVATIVE_12BPS"]},"families":results,"combinations":{"candidateCount":len(cc),"developmentPassed":len(cp),"selected":({**sel,"validation":vr,"validationDelta":vd,"validationPassed":vok,"holdout2026H1":final,"holdoutPassed":fok,"paperEligible":fok,"liveEligible":False} if sel else None),"candidates":cc},"productionChanged":False,"realTradingEnabled":False,"fingerprint":hashlib.sha256(json.dumps({"families":{k:[p.__dict__ for p in v] for k,v in families().items()},"scenarios":[s.__dict__ for s in SCENARIOS]},sort_keys=True).encode()).hexdigest(),"limitations":["12h OHLCV/Funding; intrabar execution not reproduced.","V17 costs are sensitivity, not historical book BT.","2025 did not retune same run.","Fresh Forward required; Live prohibited.","Production/VPS/.env/live runner unchanged."]})
    report=["# Comprehensive Profit Levers V18","",f"- Status: **{status}**","- Production changed: NO","- Real trading: DISABLED","","## Loss Attribution","","| Category | Cycles | Loss sum | Share |","|---|---:|---:|---:|"]+[f"| {k} | {v['cycles']} | {v['netLossPctSum']}% | {v['shareOfAbsoluteLossPct']}% |" for k,v in result["baselineLossAttribution2023_2024"].items()]+["","## Families","","| Family | Candidates | Dev passed | Selected | 2025 passed |","|---|---:|---:|---|---|"]
    for f,x in result["families"].items():
        s=x["selected"]; report.append(f"| {f} | {x['candidateCount']} | {x['developmentPassed']} | {s['policy']['policy_id'] if s else 'NONE'} | {'YES' if s and s['validationPassed'] else 'NO'} |")
    s=result["combinations"]["selected"]; report += ["","## Combined",f"- Selected: **{s['policy']['policy_id'] if s else 'NONE'}**",f"- Validation passed: **{'YES' if s and s['validationPassed'] else 'NO'}**",f"- Holdout opened: **{'YES' if s and s['holdout2026H1'] else 'NO'}**",f"- Paper eligible: **{'YES' if s and s['paperEligible'] else 'NO'}**","","## Verdict","","Forward Paper candidate; Live prohibited." if fok else "All profit levers tested; no candidate completed fixed gates."]
    state.mkdir(parents=True,exist_ok=True); (state/"comprehensive-profit-levers-v18.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8"); (state/"comprehensive-profit-levers-v18.md").write_text("\n".join(report),encoding="utf-8"); print("\n".join(report))
if __name__=="__main__": main()
