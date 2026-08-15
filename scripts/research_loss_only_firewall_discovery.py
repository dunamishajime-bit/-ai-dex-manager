"""Discover recurring entry-loss conditions using losing trades only.

Winner trade records are intentionally inaccessible in this stage. Entry-time causal
features are reconstructed from frozen hourly OHLCV only. All categorical bins and
acceptance rules are predeclared here before discovery results are observed.
Research-only; no Fresh OOS, VPS, LIVE, orders, deployment, or production mutation.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from collections import defaultdict
from pathlib import Path

import research_lab_pair_specific_v101 as b

HOUR=b.HOUR
SYMS=tuple(b.SYMS)
MAX_BLOCKERS=8
MIN_DISCOVERY_COUNT=25
MIN_VALIDATION_COUNT=15
MIN_DISCOVERY_FAMILIES=3
MIN_VALIDATION_FAMILIES=2
MIN_SYMBOLS=3
MIN_PERIODS=2
MIN_LOSER_SHARE=0.04
DISCOVERY_SEVERITY_RATIO=1.05
VALIDATION_SEVERITY_RATIO=0.95


def mean(xs):return statistics.fmean(xs) if xs else 0.0

def sd(xs):return statistics.pstdev(xs) if len(xs)>1 else 0.0

def signed_bin(z):
    if z < -1.0:return "STRONG_AGAINST"
    if z < -0.25:return "AGAINST"
    if z <= 0.25:return "NEUTRAL"
    if z <= 1.0:return "WITH"
    return "STRONG_WITH"

def year_bucket(ts):
    from datetime import datetime, timezone
    d=datetime.fromtimestamp(ts/1000,tz=timezone.utc)
    return f"{d.year}H{1 if d.month<=6 else 2}"

def side_sign(side):return 1.0 if side=="LONG" else -1.0

def get_index(idx,s,ts):
    t=ts-ts%HOUR
    i=idx[s].get(t)
    if i is not None:return i,t
    for q in (t-HOUR,t+HOUR):
        i=idx[s].get(q)
        if i is not None:return i,q
    return None,None

def causal_features(r,candles,idx):
    s=r["symbol"];side=side_sign(r["side"]);i,ts=get_index(idx,s,int(r["entryTs"]))
    if i is None or i<336:return None
    c=candles[s]
    v168=b.vol(c,i,168);v24=b.vol(c,i,24);v96=b.vol(c,i,96)
    if v168<=1e-12 or v96<=1e-12:return None
    def rr(n):return b.ret(c,i,n) or 0.0
    def z(n):return side*rr(n)/(v168*math.sqrt(n)+1e-12)
    r3,r6,r12,r24,r72=(rr(n) for n in (3,6,12,24,72))
    med24=b.median_move(candles,idx,ts,24);med72=b.median_move(candles,idx,ts,72)
    rel24=side*(r24-med24)/(v168*math.sqrt(24)+1e-12)
    rel72=side*(r72-med72)/(v168*math.sqrt(72)+1e-12)
    bi=idx["BTC"].get(ts);btc24=0.0
    if bi is not None:
        btc24=side*(b.ret(candles["BTC"],bi,24) or 0.0)/(v168*math.sqrt(24)+1e-12)
    eff=float(b.efficiency(c,i,72));rp=float(b.range_position(c,i,96));br=float(b.breadth(candles,idx,ts,24))
    vr=v24/v96
    range_state="CHASE_EXTREME" if (side>0 and rp>=.85) or (side<0 and rp<=.15) else "OPPOSITE_EXTREME" if (side>0 and rp<=.15) or (side<0 and rp>=.85) else "CENTER"
    breadth_state="WITH_SIDE" if (side>0 and br>=2/3) or (side<0 and br<=1/3) else "AGAINST_SIDE" if (side>0 and br<=1/3) or (side<0 and br>=2/3) else "MIXED"
    z3,z6,z24,z72=(z(n) for n in (3,6,24,72))
    horizon_state="ALIGNED" if z6>0 and z24>0 and z72>0 else "LONG_HORIZON_COUNTER" if z72<0 else "MID_HORIZON_COUNTER" if z24<0 else "MIXED"
    micro_state="MICRO_REVERSAL_AGAINST" if z3<0 and z24>0 else "MICRO_WITH" if z3>0 and z24>0 else "OTHER"
    extension_state="EXTENDED_CHASE" if z24>1.0 and range_state=="CHASE_EXTREME" else "EXTENDED_NOT_EXTREME" if z24>1.0 else "NOT_EXTENDED"
    market_conflict="BTC_CONFLICT" if btc24<-.5 and z24>0 else "BTC_WITH" if btc24>.5 and z24>0 else "NO_STRONG_CONFLICT"
    vol_path_state="EXPANSION_CHOP" if vr>1.25 and eff<.15 else "EXPANSION_DIRECTIONAL" if vr>1.25 and eff>.35 else "OTHER"
    return {
        "sideZ24":signed_bin(z24),"sideZ72":signed_bin(z72),"sideRelative24":signed_bin(rel24),"sideRelative72":signed_bin(rel72),
        "sideBTC24":signed_bin(btc24),
        "volState":"COMPRESSED" if vr<.8 else "NORMAL" if vr<=1.25 else "EXPANDED",
        "efficiencyState":"CHOPPY" if eff<.15 else "MIXED" if eff<=.35 else "DIRECTIONAL",
        "rangeState":range_state,"breadthState":breadth_state,"horizonState":horizon_state,"microState":micro_state,
        "extensionState":extension_state,"marketConflict":market_conflict,"volPathState":vol_path_state,
    }

def load_losers(path):
    out=[]
    with open(path,encoding="utf-8") as f:
        for line in f:
            if line.strip():
                r=json.loads(line)
                if r.get("loser") is True and r.get("symbol") in SYMS and r.get("side") in ("LONG","SHORT"):out.append(r)
    return out

def condition_stats(rows,feature,value,overall_med):
    xs=[r for r in rows if r["features"].get(feature)==value]
    sev=[abs(float(r["returnPct"])) for r in xs]
    fams={r["sourceFamily"] for r in xs};syms={r["symbol"] for r in xs};periods={r["period"] for r in xs}
    stress=[x for x in xs if x.get("mode")=="STRESS"]
    return {
        "count":len(xs),"share":len(xs)/len(rows) if rows else 0.0,"families":len(fams),"symbols":len(syms),"periods":len(periods),
        "medianAbsLossPct":statistics.median(sev) if sev else None,
        "severityRatio":(statistics.median(sev)/overall_med) if sev and overall_med>1e-12 else None,
        "stressCount":len(stress),"stressMedianAbsLossPct":statistics.median([abs(float(x["returnPct"])) for x in stress]) if stress else None,
    }

def qualifies(d,v):
    return (
        d["count"]>=MIN_DISCOVERY_COUNT and v["count"]>=MIN_VALIDATION_COUNT and
        d["share"]>=MIN_LOSER_SHARE and v["share"]>=MIN_LOSER_SHARE and
        d["families"]>=MIN_DISCOVERY_FAMILIES and v["families"]>=MIN_VALIDATION_FAMILIES and
        d["symbols"]>=MIN_SYMBOLS and v["symbols"]>=MIN_SYMBOLS and d["periods"]>=MIN_PERIODS and v["periods"]>=MIN_PERIODS and
        (d["severityRatio"] or 0)>=DISCOVERY_SEVERITY_RATIO and (v["severityRatio"] or 0)>=VALIDATION_SEVERITY_RATIO
    )

def main():
    loser_path=os.environ.get("LOSS_ONLY_LOSERS_PATH",".research-state/loss-only-losing-trades.jsonl")
    rows=load_losers(loser_path)
    candles,idx,_=b.base.load()
    enriched=[];dropped=0
    for r in rows:
        f=causal_features(r,candles,idx)
        if f is None:dropped+=1;continue
        q=dict(r);q["features"]=f;q["period"]=year_bucket(int(r["entryTs"]));enriched.append(q)
    disc=[r for r in enriched if r["partition"]=="LOSS_DISCOVERY"];val=[r for r in enriched if r["partition"]=="LOSS_VALIDATION"]
    if not disc or not val:raise RuntimeError("EMPTY_DISCOVERY_OR_VALIDATION")
    dmed=statistics.median(abs(float(r["returnPct"])) for r in disc);vmed=statistics.median(abs(float(r["returnPct"])) for r in val)
    feature_values=defaultdict(set)
    for r in disc:
        for k,v in r["features"].items():feature_values[k].add(v)
    candidates=[]
    for feature in sorted(feature_values):
        for value in sorted(feature_values[feature]):
            ds=condition_stats(disc,feature,value,dmed);vs=condition_stats(val,feature,value,vmed);ok=qualifies(ds,vs)
            candidates.append({"patternId":f"{feature}={value}","feature":feature,"value":value,"acceptedBase":ok,"discovery":ds,"validation":vs})
    # One blocker per feature family prevents near-duplicate blocker stacking. Ranking uses losing records only.
    accepted=[]
    for feature in sorted({c["feature"] for c in candidates}):
        qs=[c for c in candidates if c["feature"]==feature and c["acceptedBase"]]
        if not qs:continue
        qs.sort(key=lambda c:(min(c["discovery"]["severityRatio"],c["validation"]["severityRatio"]),min(c["discovery"]["share"],c["validation"]["share"])),reverse=True)
        accepted.append(qs[0])
    accepted.sort(key=lambda c:(min(c["discovery"]["severityRatio"],c["validation"]["severityRatio"]),min(c["discovery"]["share"],c["validation"]["share"])),reverse=True)
    accepted=accepted[:MAX_BLOCKERS]
    accepted_ids={c["patternId"] for c in accepted}
    for c in candidates:c["accepted"]=c["patternId"] in accepted_ids
    root=Path(os.environ.get("RESEARCH_STATE_DIR",".research-state"));root.mkdir(parents=True,exist_ok=True)
    firewall={
        "researchLine":"LOSS_ONLY_FIREWALL_DISCOVERY","researchOnly":True,"losersOnly":True,"winnerFileRead":False,"winnerFeaturesInspected":False,
        "productionChanged":False,"vpsChanged":False,"liveChanged":False,"realTradingEnabled":False,"freshOosRead":False,
        "predeclaredRules":{"maxBlockers":MAX_BLOCKERS,"minDiscoveryCount":MIN_DISCOVERY_COUNT,"minValidationCount":MIN_VALIDATION_COUNT,"minDiscoveryFamilies":MIN_DISCOVERY_FAMILIES,"minValidationFamilies":MIN_VALIDATION_FAMILIES,"minSymbols":MIN_SYMBOLS,"minPeriods":MIN_PERIODS,"minLoserShare":MIN_LOSER_SHARE,"discoverySeverityRatio":DISCOVERY_SEVERITY_RATIO,"validationSeverityRatio":VALIDATION_SEVERITY_RATIO,"oneBlockerPerFeature":True},
        "inputLosers":len(rows),"featureUsableLosers":len(enriched),"featureDroppedLosers":dropped,"discoveryLosers":len(disc),"validationLosers":len(val),
        "discoveryMedianAbsLossPct":dmed,"validationMedianAbsLossPct":vmed,
        "acceptedBlockers":[{"patternId":c["patternId"],"feature":c["feature"],"value":c["value"],"discovery":c["discovery"],"validation":c["validation"]} for c in accepted],
        "candidatePatterns":candidates,
        "nextAction":"FREEZE_BLOCKERS_BEFORE_WINNER_COLLATERAL_EVALUATION",
    }
    (root/"loss-only-firewall-discovery.json").write_text(json.dumps(firewall,indent=2,sort_keys=True),encoding="utf-8")
    with (root/"loss-only-enriched-losers.jsonl").open("w",encoding="utf-8") as f:
        for r in enriched:f.write(json.dumps(r,sort_keys=True)+"\n")
    md=["# Loss-Only Firewall Discovery","",f"Usable losing entries: **{len(enriched)}** (Discovery {len(disc)}, Validation {len(val)})","",f"Accepted blockers: **{len(accepted)}**","", "| Pattern | D count | D sev ratio | V count | V sev ratio | D/V symbols |", "|---|---:|---:|---:|---:|---:|"]
    for c in accepted:md.append(f"| `{c['patternId']}` | {c['discovery']['count']} | {c['discovery']['severityRatio']:.3f} | {c['validation']['count']} | {c['validation']['severityRatio']:.3f} | {c['discovery']['symbols']}/{c['validation']['symbols']} |")
    md += ["","Winner records were not read in this stage. Blocker definitions must be frozen before collateral evaluation."]
    (root/"loss-only-firewall-discovery.md").write_text("\n".join(md)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in firewall.items() if k!="candidatePatterns"},indent=2,sort_keys=True))

if __name__=="__main__":main()
