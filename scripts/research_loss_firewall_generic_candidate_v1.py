"""First predeclared candidate using Frozen Loss-Only Entry Firewall V1.

FROZEN BEFORE winner-collateral evaluation is observed.

No winning-entry pattern is used to create the trigger. The generic activation is:
- observe every 6h;
- choose LONG only when causal 6h and 24h volatility-normalized returns are both
  above +0.25, SHORT only when both are below -0.25;
- among simultaneously eligible symbols, fill at most two vacant slots by the
  larger minimum absolute 6h/24h normalized move;
- reject an entry if ANY frozen Loss Firewall V1 blocker matches;
- fixed 24h holding period; no learned exit, trailing rule, pair-specific parameter,
  rank replacement, or winner-derived lifecycle;
- total portfolio gross <= 1.0, two equal 0.5 slots. No leverage increase to meet
  the return target.

Normal execution = 10bps per side, delay0. Stress = 30bps per side, entry/exit delay1h.
Historical 2023-07 to 2026-07 is already inspected design evidence; no Fresh OOS.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from collections import defaultdict
from pathlib import Path

import research_lab_pair_specific_v101 as b
import research_loss_only_firewall_discovery as discovery
import research_loss_only_firewall_frozen_v1 as fw
import research_priority_router_v6_historical_robustness as hist

HOUR=b.HOUR
DAY=24*HOUR
TRADE=("ETH","BNB","SOL","LINK","AVAX")
OBS_HOURS=6
HOLD_HOURS=24
MAX_POSITIONS=2
TOTAL_GROSS=1.0
SLOT_GROSS=TOTAL_GROSS/MAX_POSITIONS
ACTIVATION_Z=0.25
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


def signal(candles,idx,s,ts):
    i=idx[s].get(ts)
    if i is None or i<336:return None
    c=candles[s];v=b.vol(c,i,168)
    if v<=1e-12:return None
    r6=b.ret(c,i,6);r24=b.ret(c,i,24)
    if r6 is None or r24 is None:return None
    z6=float(r6)/(v*math.sqrt(6)+1e-12);z24=float(r24)/(v*math.sqrt(24)+1e-12)
    side="LONG" if z6>ACTIVATION_Z and z24>ACTIVATION_Z else "SHORT" if z6<-ACTIVATION_Z and z24<-ACTIVATION_Z else None
    if side is None:return None
    f=discovery.causal_features({"symbol":s,"side":side,"entryTs":ts},candles,idx)
    if f is None:return None
    matches=fw.matched_blockers(f)
    return {"symbol":s,"side":side,"sideSign":1 if side=="LONG" else -1,"strength":min(abs(z6),abs(z24)),"features":f,"matchedBlockers":matches,"blocked":bool(matches)}


def metric(exit_returns,start,end):
    if not exit_returns:
        return {"exitIntervals":0,"trades":0,"returnPct":0.0,"cagrPct":0.0,"pf":None,"pfWithoutBest":None,"maxDDPct":0.0,"winRatePct":0.0}
    rs=[x[1] for x in sorted(exit_returns)]
    trade_count=sum(x[2] for x in exit_returns)
    eq=peak=1.0;dd=0.0;g=l=0.0
    for r in rs:
        eq*=max(0.001,1+r/100.0);peak=max(peak,eq);dd=min(dd,(eq/peak-1)*100)
        g+=max(0.0,r);l+=max(0.0,-r)
    years=max((end-start)/(365.25*DAY),1e-9);total=(eq-1)*100;cagr=(eq**(1/years)-1)*100 if eq>0 else -100.0
    pf=g/l if l>1e-12 else (999.0 if g>0 else None)
    bi=max(range(len(rs)),key=rs.__getitem__);wo=rs[:bi]+rs[bi+1:];wg=sum(x for x in wo if x>0);wl=abs(sum(x for x in wo if x<0));pfwo=wg/wl if wl>1e-12 else (999.0 if wg>0 else None)
    return {"exitIntervals":len(rs),"trades":trade_count,"returnPct":total,"cagrPct":cagr,"pf":pf,"pfWithoutBest":pfwo,"maxDDPct":dd,"winRatePct":100*sum(x>0 for x in rs)/len(rs),"bestExitIntervalPct":max(rs)}


def simulate(candles,idx,start,end,cost_bps_per_side,delay_hours):
    times=[int(r["ts"]) for r in candles["BTC"] if start<=int(r["ts"])<end][::OBS_HOURS]
    active=[];exits=defaultdict(lambda:[0.0,0]);records=[];blocked_candidates=0;allowed_candidates=0
    for ts in times:
        # close positions whose fixed holding period has elapsed
        still=[]
        for p in active:
            if ts < p["decisionExitTs"]:
                still.append(p);continue
            s=p["symbol"];i=idx[s].get(ts)
            if i is None:continue
            xi=i+delay_hours
            if xi>=len(candles[s]) or int(candles[s][xi]["ts"])>=end:continue
            xp=float(candles[s][xi]["open"]);gross=p["sideSign"]*(xp/p["entryPrice"]-1)*100*SLOT_GROSS
            cost=SLOT_GROSS*(2*cost_bps_per_side/100.0);net=gross-cost
            exits[ts][0]+=net;exits[ts][1]+=1
            records.append({"symbol":s,"side":p["side"],"entryDecisionTs":p["entryDecisionTs"],"exitDecisionTs":ts,"netReturnPctPoints":net})
        active=still
        occupied={p["symbol"] for p in active}
        vacancies=MAX_POSITIONS-len(active)
        if vacancies<=0:continue
        cs=[]
        for s in TRADE:
            if s in occupied:continue
            q=signal(candles,idx,s,ts)
            if not q:continue
            if q["blocked"]:
                blocked_candidates+=1;continue
            allowed_candidates+=1;cs.append(q)
        cs.sort(key=lambda q:q["strength"],reverse=True)
        for q in cs[:vacancies]:
            s=q["symbol"];i=idx[s].get(ts);ei=i+1+delay_hours
            if ei>=len(candles[s]):continue
            ep=float(candles[s][ei]["open"])
            if ep<=0:continue
            active.append({"symbol":s,"side":q["side"],"sideSign":q["sideSign"],"entryDecisionTs":ts,"decisionExitTs":ts+HOLD_HOURS*HOUR,"entryPrice":ep})
    exit_returns=[(ts,v[0],v[1]) for ts,v in exits.items()]
    m=metric(exit_returns,start,end);m.update({"blockedEntryCandidates":blocked_candidates,"allowedEntryCandidates":allowed_candidates,"tradeRecords":len(records),"maxPositions":MAX_POSITIONS,"totalGross":TOTAL_GROSS})
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
    out={"researchLine":"LOSS_FIREWALL_GENERIC_CANDIDATE_V1","researchOnly":True,"firewallId":fw.FIREWALL_ID,"candidateFrozenBeforeCollateralResult":True,"winnerPatternsUsed":False,"pairSpecificParameters":False,"parameterGrid":False,"activationZ":ACTIVATION_Z,"observationHours":OBS_HOURS,"holdHours":HOLD_HOURS,"maxPositions":MAX_POSITIONS,"totalGross":TOTAL_GROSS,"leverageRaisedToMeetTarget":False,"productionChanged":False,"vpsChanged":False,"liveChanged":False,"realTradingEnabled":False,"freshOosRead":False,"normal":normal,"stress":stress,"classification":cl,"status":cl["status"],"nextAction":"FREEZE_RESULT_NO_SAME_DATA_RETUNE"}
    root=Path(os.environ.get("RESEARCH_STATE_DIR",".research-state"));root.mkdir(parents=True,exist_ok=True);(root/"loss-firewall-generic-candidate-v1.json").write_text(json.dumps(out,indent=2,sort_keys=True),encoding="utf-8")
    with (root/"loss-firewall-generic-candidate-v1-trades.jsonl").open("w",encoding="utf-8") as f:
        for label in ("year1_2023_24","year2_2024_25","year3_2025_26"):
            for r in records[label]:q=dict(r);q["period"]=label;f.write(json.dumps(q,sort_keys=True)+"\n")
    print(json.dumps(out,indent=2,sort_keys=True))

if __name__=="__main__":main()
