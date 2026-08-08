from __future__ import annotations

import bisect
import hashlib
import json
import math
import os
import statistics
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4

STRATEGY_ID = "CROSS_SECTIONAL_DISPERSION_REVERSAL_V48_FAST"
SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]
TRADE_SYMBOLS = ["ETH", "BNB", "SOL", "LINK", "AVAX"]
SIGNAL_WINDOWS = [12, 24, 48]
DISPERSION_LOOKBACKS = [168, 336, 720]
DISPERSION_Z = [1.5, 2.0, 2.5]
HOLD_HOURS = [12, 24, 48]
REBALANCE_HOURS = [12, 24]
NORMAL_ROUND_TRIP_BPS_PER_LEG = 10.0
STRESS_ROUND_TRIP_BPS_PER_LEG = 30.0
STRESS_DELAY_HOURS = 1

@dataclass(frozen=True)
class Variant:
    variant_id: str
    signal_window: int
    dispersion_lookback: int
    dispersion_z: float
    hold_hours: int
    rebalance_hours: int

def mean(values: List[float]) -> float:
    return statistics.fmean(values) if values else 0.0

def product_return(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value / 100.0)
    return (equity - 1.0) * 100.0

def profit_factor(values: List[float]) -> Optional[float]:
    wins = sum(v for v in values if v > 0)
    losses = abs(sum(v for v in values if v < 0))
    return wins / losses if losses > 1e-12 else (999.0 if wins > 0 else None)

def max_drawdown(values: List[float]) -> float:
    equity = peak = 1.0
    worst = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value / 100.0)
        peak = max(peak, equity)
        worst = min(worst, (equity / peak - 1.0) * 100.0)
    return worst

def quantile(values: List[float], q: float) -> float:
    if not values:
        return 0.0
    xs = sorted(values)
    p = (len(xs) - 1) * q
    lo, hi = math.floor(p), math.ceil(p)
    return xs[lo] if lo == hi else xs[lo] * (hi - p) + xs[hi] * (p - lo)

def clean(raw: Dict[str, dict]) -> Dict[str, dict]:
    result = {}
    for symbol in SYMBOLS:
        rows = sorted(raw[symbol]["candles"], key=lambda r: int(r["ts"]))
        deduped, last = [], None
        for row in rows:
            ts = int(row["ts"])
            if ts != last:
                deduped.append(row)
                last = ts
        result[symbol] = {"candles": deduped, "funding": raw[symbol].get("funding", [])}
    return result

def aligned(raw: Dict[str, dict]) -> Tuple[List[int], Dict[str, List[dict]]]:
    common = {int(r["ts"]) for r in raw[SYMBOLS[0]]["candles"]}
    for symbol in SYMBOLS[1:]:
        common &= {int(r["ts"]) for r in raw[symbol]["candles"]}
    timestamps = sorted(common)
    maps = {s: {int(r["ts"]): r for r in raw[s]["candles"]} for s in SYMBOLS}
    return timestamps, {s: [maps[s][ts] for ts in timestamps] for s in SYMBOLS}

def log_returns(rows: List[dict]) -> List[float]:
    out = [0.0]
    for i in range(1, len(rows)):
        a, b = float(rows[i-1]["close"]), float(rows[i]["close"])
        out.append(math.log(b / a) if a > 0 and b > 0 else 0.0)
    return out

def prefix(values: List[float]) -> List[float]:
    out = [0.0]
    for v in values:
        out.append(out[-1] + v)
    return out

def variants() -> List[Variant]:
    return [Variant(f"W{w}_L{l}_Z{str(z).replace('.', 'p')}_H{h}_R{r}", w,l,z,h,r)
            for w in SIGNAL_WINDOWS for l in DISPERSION_LOOKBACKS for z in DISPERSION_Z
            for h in HOLD_HOURS for r in REBALANCE_HOURS if r <= h]

def build_feature_cache(returns: Dict[str, List[float]]) -> Dict[Tuple[int,int], dict]:
    n = len(returns["BTC"])
    ps = {s: prefix(returns[s]) for s in SYMBOLS}
    ps2 = {s: prefix([x*x for x in returns[s]]) for s in SYMBOLS}
    pxy = {s: prefix([a*b for a,b in zip(returns["BTC"], returns[s])]) for s in TRADE_SYMBOLS}
    cache = {}
    for window in SIGNAL_WINDOWS:
        for lookback in DISPERSION_LOOKBACKS:
            snapshots: List[Optional[Dict[str,float]]] = [None] * n
            dispersions: List[Optional[float]] = [None] * n
            for i in range(max(window, lookback), n):
                ws = i - window + 1
                ls = i - lookback + 1
                if ws < 1 or ls < 1:
                    continue
                btc_move = ps["BTC"][i+1] - ps["BTC"][ws]
                sx = ps["BTC"][i+1] - ps["BTC"][ls]
                sx2 = ps2["BTC"][i+1] - ps2["BTC"][ls]
                mx = sx / lookback
                var = sx2 / lookback - mx*mx
                if var <= 1e-12:
                    continue
                snap = {}
                for s in TRADE_SYMBOLS:
                    sy = ps[s][i+1] - ps[s][ls]
                    sxy = pxy[s][i+1] - pxy[s][ls]
                    my = sy / lookback
                    cov = sxy / lookback - mx*my
                    beta = max(0.15, min(3.0, cov / var))
                    move = ps[s][i+1] - ps[s][ws]
                    snap[s] = move - beta * btc_move
                snapshots[i] = snap
                vals = list(snap.values())
                dispersions[i] = statistics.pstdev(vals)
            valid = [1 if x is not None else 0 for x in dispersions]
            vals = [0.0 if x is None else x for x in dispersions]
            pc, pv, pv2 = [0], [0.0], [0.0]
            for ok, x in zip(valid, vals):
                pc.append(pc[-1] + ok); pv.append(pv[-1] + x); pv2.append(pv2[-1] + x*x)
            zscores: List[Optional[float]] = [None] * n
            for i in range(n):
                if dispersions[i] is None:
                    continue
                a = max(window, i - lookback); b = i
                count = pc[b] - pc[a]
                if count < 96:
                    continue
                s1 = pv[b] - pv[a]; s2 = pv2[b] - pv2[a]
                m = s1 / count; variance = max(0.0, s2 / count - m*m)
                scale = math.sqrt(variance)
                if scale > 1e-10:
                    zscores[i] = (dispersions[i] - m) / scale
            cache[(window, lookback)] = {"snapshots": snapshots, "z": zscores}
    return cache

def build_funding(raw: Dict[str,dict]) -> Dict[str,Tuple[List[int],List[float]]]:
    out = {}
    for s in SYMBOLS:
        pts = sorted((int(p["ts"]), float(p["rate"])*100.0) for p in raw[s].get("funding", []))
        ts, pref = [], [0.0]
        for t,r in pts:
            ts.append(t); pref.append(pref[-1]+r)
        out[s] = (ts,pref)
    return out

def funding_pct(index: Dict[str,Tuple[List[int],List[float]]], symbol: str, start_ts:int, end_ts:int, direction:int, weight:float) -> float:
    ts,pref = index[symbol]
    a,b = bisect.bisect_left(ts,start_ts), bisect.bisect_left(ts,end_ts)
    return -direction * weight * (pref[b]-pref[a])

def forward_return(rows: List[dict], signal_index:int, hold:int, delay:int) -> Optional[Tuple[float,int,int]]:
    entry_index = signal_index + 1 + delay
    exit_index = entry_index + hold - 1
    if entry_index >= len(rows) or exit_index >= len(rows): return None
    entry, exit_price = float(rows[entry_index]["open"]), float(rows[exit_index]["close"])
    if entry <= 0: return None
    return (exit_price/entry-1.0)*100.0, entry_index, exit_index

def simulate(variant:Variant, timestamps:List[int], rows:Dict[str,List[dict]], features:Dict[Tuple[int,int],dict], funding:dict, start:int, end:int) -> dict:
    normal_values=[]; stress_values=[]; year_values={}; next_free=0; zs=[]
    feature = features[(variant.signal_window, variant.dispersion_lookback)]
    for i,ts in enumerate(timestamps):
        if ts < start or ts >= end or i < next_free or i % variant.rebalance_hours != 0: continue
        z = feature["z"][i]; snap = feature["snapshots"][i]
        if z is None or snap is None or z < variant.dispersion_z: continue
        winner, loser = max(snap,key=snap.get), min(snap,key=snap.get)
        ln=forward_return(rows[loser],i,variant.hold_hours,0); sn=forward_return(rows[winner],i,variant.hold_hours,0)
        ls=forward_return(rows[loser],i,variant.hold_hours,STRESS_DELAY_HOURS); ss=forward_return(rows[winner],i,variant.hold_hours,STRESS_DELAY_HOURS)
        if None in (ln,sn,ls,ss): continue
        assert ln and sn and ls and ss
        weight=.5
        normal=weight*ln[0]-weight*sn[0]-2*NORMAL_ROUND_TRIP_BPS_PER_LEG/100.0
        stress=weight*ls[0]-weight*ss[0]-2*STRESS_ROUND_TRIP_BPS_PER_LEG/100.0
        et,xt=timestamps[ln[1]],timestamps[ln[2]]+v4.HOUR
        est,xst=timestamps[ls[1]],timestamps[ls[2]]+v4.HOUR
        normal += funding_pct(funding,loser,et,xt,1,weight)+funding_pct(funding,winner,et,xt,-1,weight)
        stress += funding_pct(funding,loser,est,xst,1,weight)+funding_pct(funding,winner,est,xst,-1,weight)
        normal_values.append(normal); stress_values.append(stress); zs.append(z)
        year_values.setdefault(str(datetime.fromtimestamp(ts/1000,tz=timezone.utc).year),[]).append(normal)
        next_free=ln[2]+1
    lo=quantile(normal_values,.01) if normal_values else 0.0; hi=quantile(normal_values,.99) if normal_values else 0.0
    wins=[min(hi,max(lo,x)) for x in normal_values]; without=sorted(normal_values)[:-1] if len(normal_values)>1 else []
    best_share=(max(normal_values)/sum(x for x in normal_values if x>0)*100.0) if normal_values and sum(x for x in normal_values if x>0)>0 else 0.0
    return {"trades":len(normal_values),"winRatePct":100*sum(x>0 for x in normal_values)/len(normal_values) if normal_values else 0.0,
            "averagePct":mean(normal_values),"winsorizedAveragePct":mean(wins),"compoundedReturnPct":product_return(normal_values),
            "stressCompoundedReturnPct":product_return(stress_values),"profitFactor":profit_factor(normal_values),"stressProfitFactor":profit_factor(stress_values),
            "profitFactorWithoutBest":profit_factor(without),"bestTradeProfitSharePct":best_share,"maxDrawdownPct":max_drawdown(normal_values),
            "medianDispersionZ":statistics.median(zs) if zs else 0.0,
            "yearBreakdown":{y:{"trades":len(xs),"returnPct":product_return(xs),"profitFactor":profit_factor(xs),"maxDrawdownPct":max_drawdown(xs)} for y,xs in sorted(year_values.items())}}

def gate(m:dict, stage:str) -> bool:
    minimum={"development":20,"validation":14,"confirmation":14,"final":8}[stage]
    pf_floor={"development":1.20,"validation":1.20,"confirmation":1.20,"final":1.00}[stage]
    return m["trades"]>=minimum and m["compoundedReturnPct"]>0 and m["winsorizedAveragePct"]>0 and (m["profitFactor"] or 0)>=pf_floor and (m["stressProfitFactor"] or 0)>1.0 and (m["profitFactorWithoutBest"] or 0)>=1.0 and m["bestTradeProfitSharePct"]<45 and m["maxDrawdownPct"]>-20.0

def is_neighbor(a:Variant,b:Variant)->bool:
    dims=[(SIGNAL_WINDOWS,a.signal_window,b.signal_window),(DISPERSION_LOOKBACKS,a.dispersion_lookback,b.dispersion_lookback),(DISPERSION_Z,a.dispersion_z,b.dispersion_z),(HOLD_HOURS,a.hold_hours,b.hold_hours),(REBALANCE_HOURS,a.rebalance_hours,b.rebalance_hours)]
    diff=0
    for values,x,y in dims:
        if x==y: continue
        if abs(values.index(x)-values.index(y))!=1: return False
        diff+=1
    return diff==1

def rounded(x):
    if isinstance(x,float): return round(x,4)
    if isinstance(x,dict): return {k:rounded(v) for k,v in x.items()}
    if isinstance(x,list): return [rounded(v) for v in x]
    return x

def main():
    state_dir=Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR",".research-state")).resolve(); cache_root=Path.cwd()/".cache"/"perp-research-usdm"
    raw=clean({s:v4.load_symbol(cache_root,s) for s in SYMBOLS}); timestamps,rows=aligned(raw); returns={s:log_returns(rows[s]) for s in SYMBOLS}
    features=build_feature_cache(returns); funding=build_funding(raw); model={v.variant_id:v for v in variants()}; tested=[]
    for v in variants():
        dev=simulate(v,timestamps,rows,features,funding,v4.START_2023,v4.START_2024); val=simulate(v,timestamps,rows,features,funding,v4.START_2024,v4.START_2025)
        tested.append({"variant":v.__dict__,"development2023":dev,"validation2024":val,"developmentPassed":gate(dev,"development"),"validationPassed":gate(val,"validation"),"neighborCount":0,"neighborhoodScore":-999.0})
    passed=[x for x in tested if x["developmentPassed"] and x["validationPassed"]]
    for item in passed:
        cur=model[item["variant"]["variant_id"]]; neigh=[o for o in passed if is_neighbor(cur,model[o["variant"]["variant_id"]])]; item["neighborCount"]=len(neigh)
        if neigh: item["neighborhoodScore"]=statistics.median(min(o["development2023"]["stressProfitFactor"] or 0,o["validation2024"]["stressProfitFactor"] or 0) for o in neigh)
    robust=[x for x in passed if x["neighborCount"]>=2]; robust.sort(key=lambda x:(x["neighborhoodScore"],min(x["development2023"]["profitFactor"] or 0,x["validation2024"]["profitFactor"] or 0)),reverse=True)
    selected=robust[0] if robust else None; confirmation=final=None; cp=fp=False
    if selected:
        v=model[selected["variant"]["variant_id"]]; confirmation=simulate(v,timestamps,rows,features,funding,v4.START_2025,v4.START_2026); cp=gate(confirmation,"confirmation")
        if cp:
            final=simulate(v,timestamps,rows,features,funding,v4.START_2026,v4.END); fp=gate(final,"final")
    status="NO_ROBUST_DISPERSION_REVERSAL_EDGE" if not selected else "CONFIRMATION_REJECTED" if not cp else "FINAL_PERIOD_REJECTED" if not fp else "FORWARD_PAPER_CANDIDATE"
    result=rounded({"version":"48-fast-equivalent","strategyId":STRATEGY_ID,"generatedAt":datetime.now(timezone.utc).isoformat(),"status":status,"evaluatedVariants":len(tested),"developmentValidationPassed":len(passed),"robustNeighborhoodCandidates":len(robust),"selected":selected,"confirmation2025":confirmation,"confirmationPassed":cp,"final2026H1":final,"finalPassed":fp,"paperEligible":status=="FORWARD_PAPER_CANDIDATE","liveEligible":False,"productionChanged":False,"realTradingEnabled":False,"topRobust":robust[:20],"constraints":["V48の経済仮説とパラメータ格子は変更せず、重複ローリング計算のみ事前計算化。","Development 2023 -> Validation 2024 -> Confirmation 2025 -> untouched final 2026H1。Holdout閲覧後の再調整なし。","Normal/Stress fee, funding, 1h delay, winsorize, best-trade removal, concentration gateを含む。","Frozen V6/V9、本番、VPS、.env、runner、realTradingEnabledは変更しない。"],"fingerprint":hashlib.sha256(json.dumps({"variants":[v.__dict__ for v in variants()],"costs":[NORMAL_ROUND_TRIP_BPS_PER_LEG,STRESS_ROUND_TRIP_BPS_PER_LEG],"delay":STRESS_DELAY_HOURS},sort_keys=True).encode()).hexdigest()})
    report=["# Cross-Sectional Dispersion Reversal V48 Fast","",f"- Status: **{status}**",f"- Evaluated variants: {len(tested)}",f"- Dev+Validation passed: {len(passed)}",f"- Robust neighborhoods: {len(robust)}",f"- Selected: `{selected['variant']['variant_id'] if selected else 'NONE'}`",f"- Confirmation 2025: **{'PASS' if cp else 'FAIL / NOT RUN'}**",f"- Untouched final 2026H1: **{'PASS' if fp else 'FAIL / NOT RUN'}**",f"- Paper eligible: **{'YES' if result['paperEligible'] else 'NO'}**","- Production changed: NO","- Real trading: DISABLED"]
    state_dir.mkdir(parents=True,exist_ok=True); (state_dir/"cross-sectional-dispersion-reversal-v48-fast.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8"); (state_dir/"cross-sectional-dispersion-reversal-v48-fast.md").write_text("\n".join(report),encoding="utf-8")
    summary=os.environ.get("GITHUB_STEP_SUMMARY");
    if summary:
        with open(summary,"a",encoding="utf-8") as h: h.write("\n\n"+"\n".join(report))
    print("\n".join(report))

if __name__=="__main__": main()
