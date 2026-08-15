"""First frozen Profit-Tier + Loss-Firewall Candidate V1.

Architecture was predeclared before this backtest:
- evaluate LONG and SHORT causal entry features every 6h for 5 alts;
- reject any Frozen Loss Firewall V1 match;
- score only Frozen Profit-Tier Pattern V1 matches (BIG=4, MEDIUM=2, SMALL=1);
- require >=1 BIG pattern and total score >=4;
- if both sides of one symbol qualify, higher score wins; exact tie rejects symbol;
- fill at most two vacant fixed slots by score; no rank replacement;
- fixed 24h hold, equal 0.5 slots, max gross 1.0;
- Normal 10bps/side delay0; Stress 30bps/side delay1h.

No pair-specific tuning, grid, learned exit, Fresh OOS, production/VPS/LIVE/order mutation.
"""
from __future__ import annotations

import json
import os
import statistics
from collections import defaultdict
from pathlib import Path

import research_lab_pair_specific_v101 as b
import research_loss_only_firewall_discovery as features
import research_loss_only_firewall_frozen_v1 as lossfw
import research_profit_tier_patterns_frozen_v1 as profit
import research_priority_router_v6_historical_robustness as hist

HOUR=b.HOUR
DAY=24*HOUR
TRADE=("ETH","BNB","SOL","LINK","AVAX")
OBS_HOURS=6
HOLD_HOURS=24
MAX_POSITIONS=2
TOTAL_GROSS=1.0
SLOT_GROSS=0.5
NORMAL_BPS_PER_SIDE=10.0
STRESS_BPS_PER_SIDE=30.0
STRESS_DELAY_HOURS=1

START_2023=hist.jst08(2023,7,1)
START_2024=hist.jst08(2024,7,1)
START_2025=hist.jst08(2025,7,1)
END_2026=hist.jst08(2026,7,1)
PERIODS={
    "year1_2023_24":(START_2023,START_2024),
    "year2_2024_25":(START_2024,START_2025),
    "year3_2025_26":(START_2025,END_2026),
    "combined3Y":(START_2023,END_2026),
}


def side_candidate(candles,idx,s,ts,side):
    f=features.causal_features({"symbol":s,"side":side,"entryTs":ts},candles,idx)
    if f is None:return None
    loss_matches=lossfw.matched_blockers(f)
    if loss_matches:
        return {"symbol":s,"side":side,"blocked":True,"lossMatches":loss_matches,"score":0,"profitMatches":{}}
    score,matches=profit.score(f)
    ok=(bool(matches["BIG"]) and score>=profit.MIN_SCORE)
    return {"symbol":s,"side":side,"blocked":False,"lossMatches":[],"score":score,"profitMatches":matches,"qualifies":ok,"features":f}


def choose_symbol_side(candles,idx,s,ts):
    rows=[]
    for side in ("LONG","SHORT"):
        q=side_candidate(candles,idx,s,ts,side)
        if q and not q.get("blocked") and q.get("qualifies"):rows.append(q)
    if not rows:return None
    rows.sort(key=lambda q:(q["score"],len(q["profitMatches"]["BIG"]),len(q["profitMatches"]["MEDIUM"]),len(q["profitMatches"]["SMALL"])),reverse=True)
    if len(rows)>1:
        a,bq=rows[0],rows[1]
        ka=(a["score"],len(a["profitMatches"]["BIG"]),len(a["profitMatches"]["MEDIUM"]),len(a["profitMatches"]["SMALL"]))
        kb=(bq["score"],len(bq["profitMatches"]["BIG"]),len(bq["profitMatches"]["MEDIUM"]),len(bq["profitMatches"]["SMALL"]))
        if ka==kb:return None
    return rows[0]


def metric(exit_returns,start,end):
    if not exit_returns:
        return {"exitIntervals":0,"trades":0,"returnPct":0.0,"cagrPct":0.0,"pf":None,"pfWithoutBest":None,"maxDDPct":0.0,"winRatePct":0.0}
    ordered=sorted(exit_returns);rs=[x[1] for x in ordered];trade_count=sum(x[2] for x in ordered)
    eq=peak=1.0;dd=0.0;g=l=0.0
    for r in rs:
        eq*=max(0.001,1+r/100.0);peak=max(peak,eq);dd=min(dd,(eq/peak-1)*100.0);g+=max(0.0,r);l+=max(0.0,-r)
    years=max((end-start)/(365.25*DAY),1e-9);total=(eq-1)*100.0;cagr=(eq**(1/years)-1)*100.0 if eq>0 else -100.0
    pf=g/l if l>1e-12 else (999.0 if g>0 else None)
    bi=max(range(len(rs)),key=rs.__getitem__);wo=rs[:bi]+rs[bi+1:];wg=sum(x for x in wo if x>0);wl=abs(sum(x for x in wo if x<0));pfwo=wg/wl if wl>1e-12 else (999.0 if wg>0 else None)
    return {"exitIntervals":len(rs),"trades":trade_count,"returnPct":total,"cagrPct":cagr,"pf":pf,"pfWithoutBest":pfwo,"maxDDPct":dd,"winRatePct":100*sum(x>0 for x in rs)/len(rs),"bestExitIntervalPct":max(rs)}


def simulate(candles,idx,start,end,cost_bps_per_side,delay_hours):
    times=[int(r["ts"]) for r in candles["BTC"] if start<=int(r["ts"])<end][::OBS_HOURS]
    active=[];exits=defaultdict(lambda:[0.0,0]);records=[]
    blocked_hypotheses=qualified_hypotheses=side_ties=0
    contribution={s:0.0 for s in TRADE};side_counts={"LONG":0,"SHORT":0};score_counts={}
    for ts in times:
        still=[]
        for p in active:
            if ts<p["decisionExitTs"]:
                still.append(p);continue
            s=p["symbol"];i=idx[s].get(ts)
            if i is None:continue
            xi=i+delay_hours
            if xi>=len(candles[s]) or int(candles[s][xi]["ts"])>=end:continue
            xp=float(candles[s][xi]["open"]);gross=p["sideSign"]*(xp/p["entryPrice"]-1)*100*SLOT_GROSS
            cost=SLOT_GROSS*(2*cost_bps_per_side/100.0);net=gross-cost
            exits[ts][0]+=net;exits[ts][1]+=1;contribution[s]+=net
            records.append({"symbol":s,"side":p["side"],"entryDecisionTs":p["entryDecisionTs"],"exitDecisionTs":ts,"score":p["score"],"profitMatches":p["profitMatches"],"netReturnPctPoints":net})
        active=still
        occupied={p["symbol"] for p in active};vacancies=MAX_POSITIONS-len(active)
        if vacancies<=0:continue
        cs=[]
        for s in TRADE:
            if s in occupied:continue
            raw=[]
            for side in ("LONG","SHORT"):
                q=side_candidate(candles,idx,s,ts,side)
                if not q:continue
                if q.get("blocked"):blocked_hypotheses+=1
                elif q.get("qualifies"):qualified_hypotheses+=1;raw.append(q)
            if not raw:continue
            raw.sort(key=lambda q:(q["score"],len(q["profitMatches"]["BIG"]),len(q["profitMatches"]["MEDIUM"]),len(q["profitMatches"]["SMALL"])),reverse=True)
            if len(raw)>1:
                ka=(raw[0]["score"],len(raw[0]["profitMatches"]["BIG"]),len(raw[0]["profitMatches"]["MEDIUM"]),len(raw[0]["profitMatches"]["SMALL"]))
                kb=(raw[1]["score"],len(raw[1]["profitMatches"]["BIG"]),len(raw[1]["profitMatches"]["MEDIUM"]),len(raw[1]["profitMatches"]["SMALL"]))
                if ka==kb:side_ties+=1;continue
            cs.append(raw[0])
        cs.sort(key=lambda q:(q["score"],len(q["profitMatches"]["BIG"]),len(q["profitMatches"]["MEDIUM"]),len(q["profitMatches"]["SMALL"]),q["symbol"]),reverse=True)
        for q in cs[:vacancies]:
            s=q["symbol"];i=idx[s].get(ts);ei=i+1+delay_hours
            if ei>=len(candles[s]):continue
            ep=float(candles[s][ei]["open"])
            if ep<=0:continue
            side_counts[q["side"]]+=1;score_counts[str(q["score"])]=score_counts.get(str(q["score"]),0)+1
            active.append({"symbol":s,"side":q["side"],"sideSign":1 if q["side"]=="LONG" else -1,"entryDecisionTs":ts,"decisionExitTs":ts+HOLD_HOURS*HOUR,"entryPrice":ep,"score":q["score"],"profitMatches":q["profitMatches"]})
    er=[(ts,v[0],v[1]) for ts,v in exits.items()];m=metric(er,start,end)
    m.update({"blockedHypotheses":blocked_hypotheses,"qualifiedProfitHypotheses":qualified_hypotheses,"sideTieRejects":side_ties,"contributionPctPoints":contribution,"sideEntryCounts":side_counts,"scoreEntryCounts":score_counts,"tradeRecords":len(records),"maxPositions":MAX_POSITIONS,"totalGross":TOTAL_GROSS})
    return m,records


def classify(normal,stress):
    labels=("year1_2023_24","year2_2024_25","year3_2025_26")
    annual=[float(normal[x]["returnPct"]) for x in labels];sa=[float(stress[x]["returnPct"]) for x in labels];c=normal["combined3Y"];cs=stress["combined3Y"]
    med=statistics.median(annual);mn=min(annual);cagr=float(c["cagrPct"])
    robust=(float(c.get("pf") or 0)>=1.40 and float(c.get("pfWithoutBest") or 0)>=1.25 and float(c["maxDDPct"])>=-40 and int(c["trades"])>=100 and float(cs["cagrPct"])>=45 and float(cs.get("pf") or 0)>=1.08 and float(cs.get("pfWithoutBest") or 0)>=1.0 and float(cs["maxDDPct"])>=-50 and sum(x>0 for x in sa)>=2 and min(sa)>-25)
    floor=mn>=80;primary=floor and med>=100 and cagr>=100 and robust;strong=min(annual)>=100 and cagr>=120 and robust
    status="ANNUAL_80_FLOOR_FAIL" if not floor else "BELOW_PENGU_CLASS_RETURN_STANDARD" if not (med>=100 and cagr>=100) else "RETURN_PASS_ROBUSTNESS_FAIL" if not robust else "STRONG_100PCT_PLUS_ANNUAL_CANDIDATE" if strong else "100PCT_CLASS_CANDIDATE"
    return {"annualReturnPct":dict(zip(labels,annual)),"annualStressReturnPct":dict(zip(labels,sa)),"minimumAnnualReturnPct":mn,"medianAnnualReturnPct":med,"combined3YCagrPct":cagr,"robustnessPass":robust,"primaryCandidatePass":primary,"strongCandidatePass":strong,"status":status}


def main():
    candles,idx,_=b.base.load()
    if END_2026>hist.DATA_END:raise RuntimeError("HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA")
    normal={};stress={};records={}
    for label,(a,z) in PERIODS.items():
        normal[label],records[label]=simulate(candles,idx,a,z,NORMAL_BPS_PER_SIDE,0)
        stress[label],_=simulate(candles,idx,a,z,STRESS_BPS_PER_SIDE,STRESS_DELAY_HOURS)
    cl=classify(normal,stress)
    out={
        "researchLine":"PROFIT_LOSS_COMBINED_CANDIDATE_V1","researchOnly":True,
        "lossFirewallId":lossfw.FIREWALL_ID,"profitPatternId":profit.PROFIT_PATTERN_ID,
        "profitPatternsFrozenBeforeBacktest":profit.FROZEN_BEFORE_CANDIDATE_BACKTEST,
        "candidateRuleFrozenBeforeBacktest":True,"pairSpecificParameters":False,"parameterGrid":False,
        "observationHours":OBS_HOURS,"holdHours":HOLD_HOURS,"maxPositions":MAX_POSITIONS,"totalGross":TOTAL_GROSS,"leverageRaisedToMeetTarget":False,
        "productionChanged":False,"vpsChanged":False,"liveChanged":False,"realTradingEnabled":False,"freshOosRead":False,
        "normal":normal,"stress":stress,"classification":cl,"status":cl["status"],"nextAction":"FREEZE_RESULT_NO_SAME_DATA_RESCUE_TUNING",
    }
    root=Path(os.environ.get("RESEARCH_STATE_DIR",".research-state"));root.mkdir(parents=True,exist_ok=True)
    (root/"profit-loss-combined-candidate-v1.json").write_text(json.dumps(out,indent=2,sort_keys=True),encoding="utf-8")
    with (root/"profit-loss-combined-candidate-v1-trades.jsonl").open("w",encoding="utf-8") as f:
        for label in ("year1_2023_24","year2_2024_25","year3_2025_26"):
            for r in records[label]:q=dict(r);q["period"]=label;f.write(json.dumps(q,sort_keys=True)+"\n")
    print(json.dumps(out,indent=2,sort_keys=True))

if __name__=="__main__":main()
