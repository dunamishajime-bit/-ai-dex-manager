#!/usr/bin/env python3
"""PRISM VII P47: two-layer causal bearish-preparation vs first-downleg onset.

Standalone research, NO LIVE changes. Model names and thresholds are fixed below
before outcomes are accessed. Source H1 PENGU/BTC from immutable P20/P42 feed,
source M5 archived, source native53 for contextual comparator ONLY.

LAYER A (before onset): six-hour seller-pressure, lower highs, BTC relative
weakness, falling EMA, previous 3/6h stable bearish state, or negative control.
LAYER B (now): first substantial H1 bearish break after non-oversold 24h,
or P42 comparator first crossing 24h -3%.
All signals are known at closed H1 and only enter at next H1 first positive M5.

Early-leg economic stop72 is same P20 reference overlay (NOT exact V20 phase
exit) and simple one-position 0.75x M5 mark/fee stress (NOT production DD).
"""
from __future__ import annotations
import json,gzip,hashlib,math,statistics
from collections import Counter,defaultdict
from pathlib import Path
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import (
    h1_source,moving_ema,stop72,execution_proxy,H,M5,cohort,DATA_END
)
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import (
    R,SOURCES,PENGUH1,BTCH1,SOURCE,economic,single_slot,GROSS
)
SCRIPT_VERSION="P47_CAUSAL_TWO_STAGE_BEARISH_SUPPLY_V1"
ARMS=(
 "A_NONE_CONTROL",
 "A_BTC_REL_WEAK_6H",
 "A_SELLER_FOOTPRINT",
 "A_TREND_SUPPLY",
 "A_PREARM_3H_STABLE",
 "A_PREARM_6H_STABLE",
 "A_PREARM_3H_PLUS_SELLERS",
 "A_NEGATIVE_CONTROL_BULL",
)
BMODES=("B_FIRST_H1_MINUS1_BREAK","B_FIRST_24H_MINUS3_CROSS")
COMBINATIONS=tuple((a,b) for a in ARMS for b in BMODES)
FEES=(10,30)
SLIPS=(0,100)
OUTPUT=R/"PRISM7_P47_LAYER_A_SELLER_STRUCTURE_B_FIRST_DOWNLEG_20261122.json"
NOTE=R/"PRISM7_P47_LAYER_A_SELLER_STRUCTURE_B_FIRST_DOWNLEG_20261122.md"
CAND=R/"PRISM7_P47_ALL_CAUSAL_B_ONSET_PRECONDITION_LEDGER_20261122.jsonl.gz"
def rnd(x,n=5):return round(float(x),n)
def sha(f):return hashlib.sha256(Path(f).read_bytes()).hexdigest()
def ema(closes,span):
 alpha=2/(span+1);out=[];cur=None
 for x in closes:
  cur=x if cur is None else cur*(1-alpha)+x*alpha
  out.append(cur)
 return out
def precontext(i,p,b,ema24,ema72,ema168,btcema72):
 # i is observable ONSET H1 index. Only inspect fully closed bars up through i-1,
 # and earlier i-3/i-6 data. No current H1 price/volume in Layer A.
 k=i-1
 seg6=p[k-5:k+1]
 seg12=p[k-11:k+1]
 seg24=p[k-23:k+1]
 if len(seg6)!=6 or len(seg12)!=12 or len(seg24)!=24:raise ValueError("P47_PRE_FEATURE_HISTORY_GAP")
 v6=sum(row["volume"] for row in seg6)
 redv6=sum(row["volume"] for row in seg6 if row["close"]<row["open"])
 rvol=redv6/v6 if v6>0 else None
 count_lower_high=sum(p[j]["high"]<p[j-1]["high"] for j in range(k-4,k+1))
 count_lower_close=sum(p[j]["close"]<p[j-1]["close"] for j in range(k-4,k+1))
 retP6=p[k]["close"]/p[k-6]["close"]-1
 retB6=b[k]["close"]/b[k-6]["close"]-1
 retP24=p[k]["close"]/p[k-24]["close"]-1
 retB24=b[k]["close"]/b[k-24]["close"]-1
 r6=retP6-retB6
 r24=retP24-retB24
 prev3=[]
 for lag in (3,6):
    j=i-lag
    pj24=p[j]["close"]/p[j-24]["close"]-1
    bj24=b[j]["close"]/b[j-24]["close"]-1
    f={
      "btcBear":bj24<=0,
      "relativeWeak":pj24-bj24<=-.01,
      "emaBear":ema72[j]<ema168[j] and p[j]["close"]<ema72[j]
    }
    prev3.append({"leadHours":lag,"asofH1ReferenceTs":p[j]["time"],
        "flags":f,"all3":all(f.values()),
        "prior24hAlreadyUnderMinus3":pj24<=-.03})
 f={
  "btcBear6":retB6<=0,
  "relativeWeak6":r6<=-.01,
  "sellerVolumeDominance6":rvol is not None and rvol>=.55,
  "lowerHighStructure6":count_lower_high>=3,
  "emaBearish72Over168":ema72[k]<ema168[k] and p[k]["close"]<ema72[k],
  "shortTrendEMA24BelowEMA72":ema24[k]<ema72[k],
  "btcNoBullExpansion":b[k]["close"]<btcema72[k]*1.02
 }
 return {
  "lastLayerAH1ReferenceTs":p[k]["time"],
  "layerAFeatureKnownAtTs":p[k]["time"]+H,
  "pengu6hReturnPct":rnd(100*retP6),"btc6hReturnPct":rnd(100*retB6),
  "penguMinusBTC6hPct":rnd(100*r6),
  "pengu24hBeforeOnsetPct":rnd(100*retP24),
  "btc24hBeforeOnsetPct":rnd(100*retB24),
  "relative24hBeforeOnsetPct":rnd(100*r24),
  "priorSixH1RedCandleVolumeShare":rnd(rvol) if rvol is not None else None,
  "priorSixLowerHighCount":count_lower_high,
  "priorSixLowerCloseCount":count_lower_close,
  "priorH1CloseBelowEMA24":p[k]["close"]<ema24[k],
  "priorH1CloseBelowEMA72":p[k]["close"]<ema72[k],
  "prearmahead":prev3,
  "flags":f,
  "strictPriorCompletedHourOnly":True
 }
def arm_pass(a,model):
 f=a["flags"]
 if model=="A_NONE_CONTROL":return True
 if model=="A_BTC_REL_WEAK_6H":
    return f["btcBear6"] and f["relativeWeak6"] and f["emaBearish72Over168"]
 if model=="A_SELLER_FOOTPRINT":
    return f["sellerVolumeDominance6"] and f["lowerHighStructure6"] and f["btcNoBullExpansion"]
 if model=="A_TREND_SUPPLY":
    return f["emaBearish72Over168"] and f["shortTrendEMA24BelowEMA72"] and f["sellerVolumeDominance6"]
 if model=="A_PREARM_3H_STABLE":return a["prearmahead"][0]["all3"]
 if model=="A_PREARM_6H_STABLE":return a["prearmahead"][1]["all3"]
 if model=="A_PREARM_3H_PLUS_SELLERS":
    return a["prearmahead"][0]["all3"] and f["sellerVolumeDominance6"] and f["lowerHighStructure6"]
 if model=="A_NEGATIVE_CONTROL_BULL":
    return not f["btcBear6"] and not f["relativeWeak6"] and not f["emaBearish72Over168"]
 raise ValueError("P47_UNKNOWN_ARM:"+model)
def build(p,b):
 pp=[x["close"] for x in p]
 ema24=moving_ema(p,24);ema72=moving_ema(p,72);ema168=moving_ema(p,168)
 btcema72=moving_ema(b,72)
 raw=[]
 lastraw={}
 for i in range(182,len(p)-1):
   cur=p[i];prev=p[i-1]
   if not(cur["volume"]>0 and prev["volume"]>0 and b[i]["volume"]>0 and b[i-1]["volume"]>0):
     continue
   intent=cur["time"]+H
   phase=cohort(intent)
   if phase=="OUTSIDE_COHORT":continue
   prior24=pp[i-1]/pp[i-25]-1
   curr24=pp[i]/pp[i-24]-1
   curr1=cur["close"]/cur["open"]-1
   # Two independent LayerB types, not cross-validation leakage or 53-filtering
   candidates={
    "B_FIRST_H1_MINUS1_BREAK":
       prior24>-.03 and curr24>-.07 and curr24<0
       and curr1<=-.01 and cur["close"]<prev["low"]
       and cur["close"]<cur["open"],
    "B_FIRST_24H_MINUS3_CROSS":
       prior24>-.03 and curr24<=-.03
   }
   for bmodel,on in candidates.items():
     if not on:continue
     # Treat raw onset events as the same episode if they recur within 24h.
     prior_seen=lastraw.get(bmodel,None)
     episodefirst=prior_seen is None or intent-prior_seen>24*H
     lastraw[bmodel]=intent
     context=precontext(i,p,b,ema24,ema72,ema168,btcema72)
     if context["layerAFeatureKnownAtTs"]!=cur["time"]:
       raise ValueError("P47_PRECONDITION_NOT_KNOWN_PRIOR_ONSET")
     raw.append({
       "id":"P47_"+bmodel+"_"+str(i),
       "intentTs":intent,"signalReferenceTs":cur["time"],
       "cohort":phase,"route":bmodel,"episodeFirst24h":episodefirst,
       "prior24hBeforeOnsetPct":rnd(100*prior24),
       "onset24hReturnPct":rnd(100*curr24),
       "onsetH1ReturnPct":rnd(100*curr1),
       "onsetClosesBelowPreviousLow":cur["close"]<prev["low"],
       "layerA":context,
       "signalTimeUsesNoFuturePrices":True,
       "earlyNativeV20SourceSignal":False
     })
 return raw
def select(raw,bmodel,arm):
 return [x for x in raw if x["route"]==bmodel and x["episodeFirst24h"] and arm_pass(x["layerA"],arm)]
def main():
 p,psha=h1_source(PENGUH1)
 b,bsha=h1_source(BTCH1)
 assert len(p)==len(b) and all(x["time"]==y["time"] for x,y in zip(p,b))
 native=json.loads(SOURCE.read_text(encoding="utf8"))
 assert len(native)==53 and sum(z["net30pct"]>0 for z in native)==29
 p47raw=build(p,b)
 m5,m5hash=load_m5(SOURCES)
 assert len(p47raw)>=100
 raw_count=Counter(x["route"] for x in p47raw)
 first_count=Counter(x["route"] for x in p47raw if x["episodeFirst24h"])
 print("P47_NATIVE_SOURCE53_PRESERVED",len(native),"RAW_CAUSAL_H1_B_TRIGGERS",dict(raw_count),"FIRST24H",dict(first_count),flush=True)
 modelCache={}
 scenarios=[]
 indiv=[]
 for arm,bmode in COMBINATIONS:
   elig=select(p47raw,bmode,arm)
   selected,blocked=single_slot(elig,modelCache,m5)
   for fee in FEES:
     for cover in SLIPS:
       econ=economic(selected,m5,fee,cover)
       scenarios.append({
        "layerA":arm,"layerB":bmode,"gross":GROSS,
        "feeBps":fee,"extraBuyCoverBps":cover,
        "totalInitialLayerBEvents":raw_count[bmode],
        "initialDistinctLayerBEpisodes":first_count[bmode],
        "prequalifiedLayerAEligible":len(elig),
        "oneSlotSelected":len(selected),"occupiedSlotBlocked":blocked["blocked"],
        "nonprint":blocked["nonprint"],"rightCensored":blocked["censored"],
        "capital":econ})
   indiv.append({"layerA":arm,"layerB":bmode,
      "eligibleIds":[x["id"] for x in elig],
      "selected":[{"id":x["id"],"entryTs":x["entryTs"],"entryPrice":x["entryPrice"],
         "exitTs":x.get("exitTs"),"exitPrice":x.get("exitPrice"),
         "exitReason":x.get("reason"),"cohort":x["cohort"]} for x in selected]})
 assert len(scenarios)==len(COMBINATIONS)*len(FEES)*len(SLIPS)
 norm=[x for x in scenarios if x["feeBps"]==30 and x["extraBuyCoverBps"]==0]
 def qualifies(x):
   return x["capital"]["closed"]>=15 and x["capital"]["conditionalWinPct"]>=70 and x["capital"]["M5HighStressDDPct"]<=20
 cand=[x for x in norm if qualifies(x)]
 sourcecontrols={}
 for bmode in BMODES:
   x=[z for z in norm if z["layerA"]=="A_NONE_CONTROL" and z["layerB"]==bmode]
   assert len(x)==1
   sourcecontrols[bmode]=x[0]
 report={
  "schema":"prism7-p47-strict-pre-onset-layerA-vs-layerB-first-leg-supply-structure/v1",
  "proposedResearchModelName":SCRIPT_VERSION,
  "status":"READ_ONLY_NOT_INDEPENDENT_OOS",
  "studyNativeSource53Unchanged":True,"nativeWins29Losses24":True,
  "layerAUsesOnlyPreviousFullyCompletedH1":True,
  "modelEntryAtFirstPositiveM5AfterSignalH1Close":True,
  "rawOnsetEpisodesFirst24HoursOnly":True,
  "layerARulesPredeclared":list(ARMS),"layerBTriggersPredeclared":list(BMODES),
  "retrospectiveHistoricalP42P46SourceViewedBefore":True,
  "sourceM5OverlayMatchesNativeV20PhaseExit":False,
  "gross":GROSS,"sourceFees":FEES,"extraCoverSlippage":SLIPS,
  "sampleH1Rows":len(p),"rawLayerBEvents":dict(raw_count),
  "oneEpisodeFirst24hCount":dict(first_count),
  "allScenarios":scenarios,"scenarioCount":len(scenarios),
  "30bpsRegularFeeNoExtraCover":norm,
  "frozenEvidenceThresholdDiagnosticNotProduction":cand,
  "perCandidateResearchLedger":indiv,
  "sourceHash":{"native53":sha(SOURCE),"penguH1":psha,
    "btcH1":bsha,"penguM5":m5hash},
  "limits":[
    "This is a new research implementation: all existing Native V20 signals unchanged, no live integration.",
    "All Aug 2025-Nov 2026 histories were already inspected in P8-P46; no unseen validation and high risk of model overfit.",
    "Layer A constructed prior to current B H1; it need not be a negative-position anticipation 6h earlier. Only 3h/6h prior all3 models explicitly carry earlier bar readiness.",
    "Current B H1 close is observed before next H1 first positive-volume M5; no orderbook, signed fill or fee/funding validation.",
    "B early first candle is detected only at H1 close; a faster M5 first impulse could be missed.",
    "Stop uses P20 research reference 8% hard / 15% trail activation / 4% retrace / max72h, NOT source Native V20 full exit.",
    "M5 intrabar high-low order, gaps, funding, basis, shared gross, venue resident STOP and cross-Runner DD not accounted.",
    "One slot may serialize multiple legitimate independent runner signals; this is not production DD.",
    "Winner/loser features not used to train gates, but many gates tried on same observed history; results not proof of future performance."
  ]
 }
 OUTPUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 with gzip.open(CAND,"wt",encoding="utf8") as f:
   for x in p47raw:f.write(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n")
 lines=["# P47 | Layer A pre-onset bearish setup + Layer B actual first-downleg",
   "",
   "Fixed candidates from all chronological PRE, BASE, POST H1 bars, a non-event control exists. Layer A uses only earlier finished H1; B requires H1 close. Native53 wins29 losses24 kept unchanged.",
   "",
   "| A preregistered arm | B trigger | H1 eligible | One-slot closed | Wins | Win rate | M5 high DD | 10k NAV |",
   "|---|---|---:|---:|---:|---:|---:|---:|"]
 for x in norm:
   y=x["capital"]
   lines.append("| "+x["layerA"]+" | "+x["layerB"]+" | "+str(x["prequalifiedLayerAEligible"])+" | "+str(y["closed"])+" | "+str(y["wins"])+" | "+str(y["conditionalWinPct"])+"% | "+str(y["M5HighStressDDPct"])+"% | "+str(y["finalProxyNavYen"])+" |")
 lines.extend(["","A flags from the fully completed prior bar; model group differences are in-sample; no independent holdout or production readiness."])
 NOTE.write_text("\n".join(lines)+"\n",encoding="utf8")
 print("P47_TWO_STAGE_PREONSET_CAUSAL_H1_INITIAL_DOWNLEG_PASS",json.dumps({
   "raw":dict(raw_count),"firstEpisodes":dict(first_count),
   "scenarios":len(scenarios),
   "normal":[{"arm":x["layerA"],"onset":x["layerB"],"eligible":x["prequalifiedLayerAEligible"],
      "closed":x["capital"]["closed"],"wins":x["capital"]["wins"],
      "wr":x["capital"]["conditionalWinPct"],"DD":x["capital"]["M5HighStressDDPct"],
      "NAV":x["capital"]["finalProxyNavYen"]} for x in norm],
   "researchMatching70WR20DD":[{"arm":x["layerA"],"onset":x["layerB"]} for x in cand]
 },ensure_ascii=False),flush=True)
 print("FILES",OUTPUT,NOTE,CAND)
if __name__=="__main__":main()
