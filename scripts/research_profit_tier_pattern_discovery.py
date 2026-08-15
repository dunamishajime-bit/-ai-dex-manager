"""Discover BIG/MEDIUM/SMALL profit entry patterns after Frozen Loss Firewall V1.

Profit tiers and acceptance gates are predeclared in
PROFIT_TIER_ENTRY_PATTERN_PROTOCOL_20260816.md. Historical winning entries that match
any frozen loss blocker are excluded BEFORE profit-pattern discovery. No Fresh OOS,
production, VPS, LIVE, order, or deployment mutation.
"""
from __future__ import annotations

import json
import os
import statistics
from collections import defaultdict
from pathlib import Path

import research_lab_pair_specific_v101 as b
import research_loss_only_firewall_discovery as feat
import research_loss_only_firewall_frozen_v1 as fw

SYMS=("ETH","BNB","SOL","LINK","AVAX")
TIERS=("BIG","MEDIUM","SMALL")
MAX_PATTERNS_PER_TIER=5
MIN_DISCOVERY_MATCHED=20
MIN_VALIDATION_MATCHED=30
MIN_DISCOVERY_FAMILIES=3
MIN_VALIDATION_FAMILIES=2
MIN_SYMBOLS=3
MIN_PERIODS=2
LIFT_GATES={
    "BIG":(1.20,1.10),
    "MEDIUM":(1.10,1.05),
    "SMALL":(1.05,1.00),
}


def percentile(xs,p):
    ys=sorted(float(x) for x in xs)
    if not ys: raise RuntimeError("EMPTY_PERCENTILE_INPUT")
    if len(ys)==1:return ys[0]
    k=(len(ys)-1)*p
    lo=int(k);hi=min(lo+1,len(ys)-1);w=k-lo
    return ys[lo]*(1-w)+ys[hi]*w


def load_positive(path):
    out=[]
    with open(path,encoding="utf-8") as f:
        for line in f:
            if not line.strip():continue
            r=json.loads(line)
            if r.get("symbol") not in SYMS or r.get("side") not in ("LONG","SHORT"):continue
            if float(r.get("returnPct") or 0)<=0:continue
            out.append(r)
    return out


def tier_of(x,p33,p67):
    x=float(x)
    if x<=p33:return "SMALL"
    if x<p67:return "MEDIUM"
    return "BIG"


def period(ts):return feat.year_bucket(int(ts))


def enrich(rows,candles,idx):
    out=[];dropped=0;firewall_rejected=0
    for r in rows:
        f=feat.causal_features(r,candles,idx)
        if f is None:
            dropped+=1;continue
        matches=fw.matched_blockers(f)
        if matches:
            firewall_rejected+=1;continue
        q=dict(r);q["features"]=f;q["period"]=period(r["entryTs"]);q["lossFirewallClean"]=True
        out.append(q)
    return out,dropped,firewall_rejected


def baseline(rows,tier):
    return sum(r["profitTier"]==tier for r in rows)/len(rows) if rows else 0.0


def stats(rows,feature,value,tier,base):
    xs=[r for r in rows if r["features"].get(feature)==value]
    tier_x=[r for r in xs if r["profitTier"]==tier]
    share=len(tier_x)/len(xs) if xs else 0.0
    fams={r["sourceFamily"] for r in xs};syms={r["symbol"] for r in xs};periods={r["period"] for r in xs}
    return {
        "matchedPositive":len(xs),"tierCount":len(tier_x),"tierShare":share,
        "baselineTierShare":base,"lift":share/base if base>1e-12 else None,
        "families":len(fams),"symbols":len(syms),"periods":len(periods),
        "medianMatchedReturnPct":statistics.median(float(r["returnPct"]) for r in xs) if xs else None,
        "medianTierReturnPct":statistics.median(float(r["returnPct"]) for r in tier_x) if tier_x else None,
    }


def qualifies(ds,vs,tier):
    dg,vg=LIFT_GATES[tier]
    return (
        ds["matchedPositive"]>=MIN_DISCOVERY_MATCHED and vs["matchedPositive"]>=MIN_VALIDATION_MATCHED and
        ds["families"]>=MIN_DISCOVERY_FAMILIES and vs["families"]>=MIN_VALIDATION_FAMILIES and
        ds["symbols"]>=MIN_SYMBOLS and vs["symbols"]>=MIN_SYMBOLS and
        ds["periods"]>=MIN_PERIODS and vs["periods"]>=MIN_PERIODS and
        (ds["lift"] or 0)>=dg and (vs["lift"] or 0)>=vg
    )


def main():
    path=os.environ.get("PROFIT_ALL_TRADES_PATH",".research-state/loss-only-normalized-trades.jsonl")
    raw=load_positive(path)
    candles,idx,_=b.base.load()
    clean,dropped,fw_rejected=enrich(raw,candles,idx)
    disc=[r for r in clean if r.get("partition")=="LOSS_DISCOVERY"]
    val=[r for r in clean if r.get("partition")=="LOSS_VALIDATION"]
    if not disc or not val:raise RuntimeError("EMPTY_PROFIT_DISCOVERY_OR_VALIDATION")

    p33=percentile([r["returnPct"] for r in disc],1/3)
    p67=percentile([r["returnPct"] for r in disc],2/3)
    for r in clean:r["profitTier"]=tier_of(r["returnPct"],p33,p67)
    disc=[r for r in clean if r.get("partition")=="LOSS_DISCOVERY"]
    val=[r for r in clean if r.get("partition")=="LOSS_VALIDATION"]

    bases={tier:{"discovery":baseline(disc,tier),"validation":baseline(val,tier)} for tier in TIERS}
    feature_values=defaultdict(set)
    for r in disc:
        for k,v in r["features"].items():feature_values[k].add(v)

    all_candidates=[];accepted_by_tier={}
    for tier in TIERS:
        candidates=[]
        for feature in sorted(feature_values):
            for value in sorted(feature_values[feature]):
                ds=stats(disc,feature,value,tier,bases[tier]["discovery"])
                vs=stats(val,feature,value,tier,bases[tier]["validation"])
                candidates.append({"tier":tier,"patternId":f"{feature}={value}","feature":feature,"value":value,"acceptedBase":qualifies(ds,vs,tier),"discovery":ds,"validation":vs})
        accepted=[]
        for feature in sorted({c["feature"] for c in candidates}):
            qs=[c for c in candidates if c["feature"]==feature and c["acceptedBase"]]
            if not qs:continue
            qs.sort(key=lambda c:(min(c["discovery"]["lift"],c["validation"]["lift"]),min(c["discovery"]["tierShare"],c["validation"]["tierShare"])),reverse=True)
            accepted.append(qs[0])
        accepted.sort(key=lambda c:(min(c["discovery"]["lift"],c["validation"]["lift"]),min(c["discovery"]["tierShare"],c["validation"]["tierShare"])),reverse=True)
        accepted=accepted[:MAX_PATTERNS_PER_TIER]
        ids={c["patternId"] for c in accepted}
        for c in candidates:c["accepted"]=c["patternId"] in ids
        accepted_by_tier[tier]=accepted
        all_candidates.extend(candidates)

    out={
        "researchLine":"PROFIT_TIER_PATTERN_DISCOVERY_V1","researchOnly":True,
        "lossFirewallId":fw.FIREWALL_ID,"lossFirewallAppliedBeforeProfitDiscovery":True,
        "freshOosRead":False,"productionChanged":False,"vpsChanged":False,"liveChanged":False,"realTradingEnabled":False,
        "rawPositiveTrades":len(raw),"featureDroppedPositiveTrades":dropped,"lossFirewallRejectedPositiveTrades":fw_rejected,
        "firewallCleanPositiveTrades":len(clean),"discoveryPositiveTrades":len(disc),"validationPositiveTrades":len(val),
        "profitTierBoundariesFromDiscovery":{"p33ReturnPct":p33,"p67ReturnPct":p67,"rule":"SMALL<=P33; P33<MEDIUM<P67; BIG>=P67"},
        "tierCounts":{p:{tier:sum(r["profitTier"]==tier for r in rows) for tier in TIERS} for p,rows in (("discovery",disc),("validation",val))},
        "tierBaselines":bases,
        "predeclaredRules":{"maxPatternsPerTier":MAX_PATTERNS_PER_TIER,"minDiscoveryMatched":MIN_DISCOVERY_MATCHED,"minValidationMatched":MIN_VALIDATION_MATCHED,"minDiscoveryFamilies":MIN_DISCOVERY_FAMILIES,"minValidationFamilies":MIN_VALIDATION_FAMILIES,"minSymbols":MIN_SYMBOLS,"minPeriods":MIN_PERIODS,"liftGates":LIFT_GATES,"onePatternPerFeaturePerTier":True},
        "acceptedPatterns":{tier:[{"patternId":c["patternId"],"feature":c["feature"],"value":c["value"],"discovery":c["discovery"],"validation":c["validation"]} for c in accepted_by_tier[tier]] for tier in TIERS},
        "candidatePatterns":all_candidates,
        "nextAction":"FREEZE_PROFIT_PATTERNS_THEN_RUN_PREDECLARED_CANDIDATE_ONCE",
    }
    root=Path(os.environ.get("RESEARCH_STATE_DIR",".research-state"));root.mkdir(parents=True,exist_ok=True)
    (root/"profit-tier-pattern-discovery.json").write_text(json.dumps(out,indent=2,sort_keys=True),encoding="utf-8")
    with (root/"profit-tier-firewall-clean-winners.jsonl").open("w",encoding="utf-8") as f:
        for r in clean:f.write(json.dumps(r,sort_keys=True)+"\n")
    md=["# Profit-Tier Pattern Discovery V1","",f"Raw positive trades: **{len(raw)}**",f"Firewall-clean positives: **{len(clean)}**",f"P33/P67: **{p33:.4f}% / {p67:.4f}%**",""]
    for tier in TIERS:
        md += [f"## {tier}","", "| Pattern | D lift | V lift | D matched | V matched |", "|---|---:|---:|---:|---:|"]
        for c in accepted_by_tier[tier]:
            md.append(f"| `{c['patternId']}` | {c['discovery']['lift']:.3f} | {c['validation']['lift']:.3f} | {c['discovery']['matchedPositive']} | {c['validation']['matchedPositive']} |")
        md.append("")
    (root/"profit-tier-pattern-discovery.md").write_text("\n".join(md)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in out.items() if k!="candidatePatterns"},indent=2,sort_keys=True))

if __name__=="__main__":main()
