"""Evaluate frozen Loss-Only Entry Firewall V1 on the full historical trade corpus.

This is the FIRST stage allowed to inspect winning/flat trade features. The firewall
is imported as an immutable constant set frozen before this evaluation. No blocker
selection, threshold modification, or rescue tuning occurs here.

Outputs are evidence-dataset diagnostics, NOT a portfolio backtest, because records
come from multiple research architectures and may represent overlapping market events.
"""
from __future__ import annotations

import json
import os
import statistics
from collections import defaultdict
from pathlib import Path

import research_lab_pair_specific_v101 as b
import research_loss_only_firewall_discovery as discovery
import research_loss_only_firewall_frozen_v1 as fw

SYMS=("ETH","BNB","SOL","LINK","AVAX")


def load_rows(path):
    out=[]
    with open(path,encoding="utf-8") as f:
        for line in f:
            if line.strip():
                r=json.loads(line)
                if r.get("symbol") in SYMS and r.get("side") in ("LONG","SHORT"):
                    out.append(r)
    return out


def sample_metric(rows):
    vals=[float(r["returnPct"]) for r in rows]
    if not vals:
        return {"count":0,"wins":0,"losses":0,"winRatePct":None,"meanReturnPct":None,"medianReturnPct":None,"sumPctPoints":0.0,"evidencePf":None,"medianAbsLossPct":None}
    g=sum(x for x in vals if x>0);l=abs(sum(x for x in vals if x<0))
    losses=[abs(x) for x in vals if x<0]
    return {
        "count":len(vals),"wins":sum(x>0 for x in vals),"losses":sum(x<0 for x in vals),
        "winRatePct":100*sum(x>0 for x in vals)/len(vals),
        "meanReturnPct":statistics.fmean(vals),"medianReturnPct":statistics.median(vals),"sumPctPoints":sum(vals),
        "evidencePf":g/l if l>1e-12 else (999.0 if g>0 else None),
        "medianAbsLossPct":statistics.median(losses) if losses else None,
    }


def period(ts):
    return discovery.year_bucket(int(ts))


def evaluate_group(rows):
    usable=[r for r in rows if r.get("features") is not None]
    blocked=[r for r in usable if r["blocked"]]
    kept=[r for r in usable if not r["blocked"]]
    losers=[r for r in usable if float(r["returnPct"])<0]
    winners=[r for r in usable if float(r["returnPct"])>=0]
    blocked_l=[r for r in blocked if float(r["returnPct"])<0]
    blocked_w=[r for r in blocked if float(r["returnPct"])>=0]
    return {
        "input":sample_metric(usable),"blocked":sample_metric(blocked),"kept":sample_metric(kept),
        "lossRecallPct":100*len(blocked_l)/len(losers) if losers else None,
        "winnerCollateralPct":100*len(blocked_w)/len(winners) if winners else None,
        "blockedLosers":len(blocked_l),"totalLosers":len(losers),"blockedWinningOrFlat":len(blocked_w),"totalWinningOrFlat":len(winners),
        "keptFractionPct":100*len(kept)/len(usable) if usable else None,
    }


def main():
    path=os.environ.get("LOSS_ONLY_ALL_TRADES_PATH",".research-state/loss-only-normalized-trades.jsonl")
    rows=load_rows(path)
    candles,idx,_=b.base.load()
    enriched=[];dropped=0
    for r in rows:
        f=discovery.causal_features(r,candles,idx)
        if f is None:
            dropped+=1;continue
        q=dict(r);q["features"]=f;q["period"]=period(r["entryTs"]);q["matchedBlockers"]=fw.matched_blockers(f);q["blocked"]=bool(q["matchedBlockers"])
        enriched.append(q)
    if not enriched: raise RuntimeError("NO_FEATURE_USABLE_TRADES")

    by_blocker={}
    for k,v in fw.BLOCKERS:
        pid=f"{k}={v}"
        xs=[r for r in enriched if r["features"].get(k)==v]
        losers=[r for r in enriched if float(r["returnPct"])<0];wins=[r for r in enriched if float(r["returnPct"])>=0]
        xl=[r for r in xs if float(r["returnPct"])<0];xw=[r for r in xs if float(r["returnPct"])>=0]
        by_blocker[pid]={
            "matched":len(xs),"matchedLosers":len(xl),"matchedWinningOrFlat":len(xw),
            "lossRecallPct":100*len(xl)/len(losers) if losers else None,
            "winnerCollateralPct":100*len(xw)/len(wins) if wins else None,
            "matchedEvidence":sample_metric(xs),
        }

    by_symbol={s:evaluate_group([r for r in enriched if r["symbol"]==s]) for s in SYMS}
    by_period={p:evaluate_group([r for r in enriched if r["period"]==p]) for p in sorted({r["period"] for r in enriched})}
    by_partition={p:evaluate_group([r for r in enriched if r["partition"]==p]) for p in ("LOSS_DISCOVERY","LOSS_VALIDATION")}
    by_side={p:evaluate_group([r for r in enriched if r["side"]==p]) for p in ("LONG","SHORT")}
    overall=evaluate_group(enriched)

    out={
        "researchLine":"LOSS_ONLY_FIREWALL_COLLATERAL_EVAL_V1","researchOnly":True,
        "firewallId":fw.FIREWALL_ID,"firewallFrozenBeforeWinnerEvaluation":fw.FROZEN_BEFORE_WINNER_EVALUATION,
        "winnerFeaturesNowInspected":True,"blockersModifiedAfterWinnerInspection":False,
        "productionChanged":False,"vpsChanged":False,"liveChanged":False,"realTradingEnabled":False,"freshOosRead":False,
        "inputRecords":len(rows),"featureUsableRecords":len(enriched),"featureDroppedRecords":dropped,
        "frozenBlockers":[f"{k}={v}" for k,v in fw.BLOCKERS],
        "overall":overall,"byBlocker":by_blocker,"bySymbol":by_symbol,"byPeriod":by_period,"byPartition":by_partition,"bySide":by_side,
        "interpretationBoundary":"EVIDENCE_DATASET_DIAGNOSTIC_NOT_PORTFOLIO_BACKTEST",
        "nextAction":"KEEP_FIREWALL_FROZEN_AND_RUN_PREDECLARED_GENERIC_TRIGGER_CANDIDATE",
    }
    root=Path(os.environ.get("RESEARCH_STATE_DIR",".research-state"));root.mkdir(parents=True,exist_ok=True)
    (root/"loss-only-firewall-collateral-eval.json").write_text(json.dumps(out,indent=2,sort_keys=True),encoding="utf-8")
    with (root/"loss-only-firewall-collateral-trades.jsonl").open("w",encoding="utf-8") as f:
        for r in enriched:f.write(json.dumps(r,sort_keys=True)+"\n")
    md=["# Frozen Loss-Only Firewall V1 — Collateral Evaluation","",f"Feature-usable records: **{len(enriched)}**",f"Loss recall: **{overall['lossRecallPct']:.2f}%**",f"Winner/flat collateral: **{overall['winnerCollateralPct']:.2f}%**",f"Kept fraction: **{overall['keptFractionPct']:.2f}%**",f"Kept evidence PF: **{overall['kept']['evidencePf']:.3f}**",f"Kept win rate: **{overall['kept']['winRatePct']:.2f}%**","","This is not a portfolio return backtest; blocker definitions remain frozen regardless of this result."]
    (root/"loss-only-firewall-collateral-eval.md").write_text("\n".join(md)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in out.items() if k not in ("byBlocker","bySymbol","byPeriod")},indent=2,sort_keys=True))

if __name__=="__main__":main()
