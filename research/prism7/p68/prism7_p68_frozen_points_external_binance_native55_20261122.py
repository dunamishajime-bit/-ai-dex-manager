#!/usr/bin/env python3
"""P68 frozen P66 W/D/12H/4H/1H score on external Binance USD-M Native55.

P66 points weights 5,4,3,2,1 and allocation policies EXACT imported (no refit).
Data is 2025-Jan-Jul Binance public H1 PENGU/BTC (official zip SHA verified P61).
Aster Native53 and Binance Native55 source prices DIFFER - do not pool.
Only H1 source native price entry/exit and realized DD, NOT M5 account/high DD.
Same one natural slot/source Native exit as P61 external, >0 gross tier at entry.
Compare source original 55 natural wins/eligible winners and 23 baseline one-slot
gross0.75 30bps original H1 exit parity to P61.
"""
from __future__ import annotations
import gzip,json,hashlib,math,datetime,collections
from pathlib import Path
from collections import Counter,defaultdict
from prism7_p66_native53_multitimeframe_score_size_20261122 import (
 TF_HOURS, WEIGHTS, aggregates, trend_features,tier_score)
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R
BASE=R.parent/"p61_new_prebaseline_archive_futures_um_202412_202507"
P61=R/"PRISM7_P61_EARLY_BINANCE_CROSS_VENUE_NATIVE_V20_P44_FROZEN_20261122.json"
MANIFEST=R/"PRISM7_P61_NEW_EARLIER_H1_ARCHIVE_SOURCE_MANIFEST_20261122.json"
OUT=R/"PRISM7_P68_P66_FROZEN_MULTI_TF_SCORE_EXTERNAL_BINANCE_NATIVE55_20261122.json"
LEDGER=R/"PRISM7_P68_EXTERNAL_BINANCE_NATIVE55_ASOF_MULTI_TF_SCORE_LEDGER_20261122.jsonl"
MD=R/"PRISM7_P68_P66_FROZEN_MULTI_TF_SCORE_EXTERNAL_BINANCE_NATIVE55_20261122.md"
M5=300000;H=3600000
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
POLICIES=("NATIVE_UNCHANGED_075","NATIVE_UNCHANGED_100",
 "POINTS_LAX","POINTS_STRICT","POINTS_NO_REJECT",
 "POINTS_LAX_WEEKLY_FAIL_CLOSED","POINTS_LAX_REJECT_BTC_WEEK_DAY_UP",
 "NATIVE075_BTC_WEEK_DAY_UP_VETO")
EXEC=((10,0),(30,0),(30,100))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rnd(x):return round(float(x),6)
def load_h1(sym):
 path=BASE/(sym+"-1h-20241218-20250801-VERIFIED_FUTURES_UM.jsonl.gz")
 raw=path.read_bytes()
 with gzip.open(path,"rt",encoding="utf8") as fp:
  rows=[json.loads(x) for x in fp if x.strip()]
 assert len(rows)==5424
 out=[{"time":int(x[0]),"open":float(x[1]),"high":float(x[2]),
    "low":float(x[3]),"close":float(x[4]),"volume":float(x[5])}
      for x in rows]
 assert all(out[i]["time"]-out[i-1]["time"]==H for i in range(1,len(out)))
 return out,sha(path)
def actual_natives_one_slot(rows,fee,slip):
 sortedrows=sorted(rows,key=lambda x:(x["entryTs"],x["key"]))
 nav=10000.;peak=nav;maxRealDD=0.;busy=-1
 booked=[];skip=0;reject=0;rejectWins=0
 for z in sortedrows:
  gross=z["grossAllocation"]
  if gross<=0:
   reject+=1
   rejectWins+=int(z["originalNativeWin"])
   continue
  if z["entryTs"]<busy:
   skip+=1;continue
  ep=z["entryPrice"];xp=z["exitPrice"]*(1+slip/10000)
  pnlPct=100*gross*((ep-xp)/ep-fee/10000)
  nav*=1+pnlPct/100
  if nav<=0:raise ValueError("P68_HYPOTHETICAL_NAV_NEGATIVE")
  peak=max(peak,nav)
  maxRealDD=max(maxRealDD,100*(1-nav/peak))
  booked.append({"key":z["key"],"entryTs":z["entryTs"],"exitTs":z["exitTs"],
     "grossAllocation":gross,"points":z["score"],"netEquityReturnPct":rnd(pnlPct),
     "originalNativeWin":z["originalNativeWin"],"realizedResultWin":pnlPct>0})
  busy=z["exitTs"]+M5
 wins=sum(x["realizedResultWin"] for x in booked)
 return {"native55NaturalSignals":len(rows),"sourceNaturalVetoed":reject,
   "sourceNaturalWinnersVetoed":rejectWins,
   "overlapBlocked":skip,"oneSlotClosed":len(booked),"oneSlotWins":wins,
   "oneSlotWinPct":rnd(100*wins/len(booked)) if booked else None,
   "originalSourceKeptWinnerCount":sum(x["originalNativeWin"] and x["grossAllocation"]>0 for x in rows),
   "realizedOnlyDDPct":rnd(maxRealDD),
   "finalNAVYen":round(nav,2),
   "oneSlotGrossByEntry":{str(g):sum(x["grossAllocation"]==g for x in booked) for g in (0,.25,.5,.75,1)},
   "booked":booked}
def main():
 p61=json.loads(P61.read_text(encoding="utf8"))
 manifest=json.loads(MANIFEST.read_text(encoding="utf8"))
 assert manifest["monthlyOfficialChecksumVerified"] and p61["sourceNativeNaturalCrossVenueCandidates"]==55
 assert p61["nativeCodePinnedSourceSHA"]==PIN
 p,ph=load_h1("PENGUUSDT")
 b,bh=load_h1("BTCUSDT")
 assert len(p)==len(b)==5424 and all(x["time"]==y["time"] for x,y in zip(p,b))
 assert manifest["derivedSource"]["PENGUUSDT"]["sourceGzSha256"]==ph
 assert manifest["derivedSource"]["BTCUSDT"]["sourceGzSha256"]==bh
 pcache={k:(agg,[x["end"] for x in agg]) for k in TF_HOURS for agg in [aggregates(p,k)]}
 bcache={k:(agg,[x["end"] for x in agg]) for k in TF_HOURS for agg in [aggregates(b,k)]}
 natural=[]
 for z in p61["sourceAllNaturalSignalLedger"]:
  assert z["nativeReplay"]["status"]=="NATIVE_EXIT_MODELED"
  ts=int(z["entryTs"]);ex=int(z["nativeReplay"]["exitTs"])
  assert 0<ts<ex and float(z["entryPrice"])>0 and float(z["nativeReplay"]["exitPrice"])>0
  feat=trend_features(pcache,bcache,ts)
  natural.append({"key":z["id"]+"|"+str(ts),"entryTs":ts,"entryPrice":z["entryPrice"],
   "exitTs":ex,"exitPrice":z["nativeReplay"]["exitPrice"],
   "originalNativeWin":z["net30pct"]>0,
   "originalNativeSourceNet30Pct":z["net30pct"],
   "score":feat["weightedDownPoints"],
   "featuresAtNativeEntry":feat,
   "sourceMarket":"BINANCE_FUTURES_UM_NOT_ASTER",
   "sourceSignedFillProven":False,
   "month":datetime.datetime.fromtimestamp(ts/1000,datetime.timezone.utc).strftime("%Y-%m")})
 assert len(natural)==55 and sum(z["originalNativeWin"] for z in natural)==28
 check=actual_natives_one_slot([{**x,"grossAllocation":.75} for x in natural],30,0)
 sourceRef=next(z for z in p61["comparison"] if z["gate"]=="ORIGINAL_PINNED_NATIVE_SOURCE_ALL")
 sr=sourceRef["noSlipNaturalSingleSlotPriceProxy"]
 assert sr["trades"]==check["oneSlotClosed"]==23 and sr["wins"]==check["oneSlotWins"]==13
 assert abs(check["finalNAVYen"]-sr["finalNavYen"])<.02,(check["finalNAVYen"],sr["finalNavYen"])
 assert abs(check["realizedOnlyDDPct"]-sr["realizedOnlyDDPct"])<1e-3
 scenarios=[]
 for rule in POLICIES:
  allocated=[{**z,"grossAllocation":tier_score(rule,z["featuresAtNativeEntry"])} for z in natural]
  for fee,slip in EXEC:
   result=actual_natives_one_slot(allocated,fee,slip)
   scenarios.append({"policy":rule,"feeBps":fee,"extraCoverBps":slip,
    "sourceOriginal55CaseWins28":True,
    "sourceOriginalNativeExitPricesUntouched":True,
    "H1RealizedOnlyDDNotM5AccountDD":True,
    "econ":{k:v for k,v in result.items() if k!="booked"},
    "selectedSlotLedger30bps":result["booked"] if fee==30 and slip==0 else None})
 assert len(scenarios)==len(POLICIES)*len(EXEC)
 selected=[z for z in scenarios if z["feeBps"]==30 and z["extraCoverBps"]==0]
 strict=next(x for x in selected if x["policy"]=="POINTS_LAX_WEEKLY_FAIL_CLOSED")
 lax=next(x for x in selected if x["policy"]=="POINTS_LAX")
 base=next(x for x in selected if x["policy"]=="NATIVE_UNCHANGED_075")
 scoreCounts=defaultdict(list)
 for z in natural:scoreCounts[z["score"]].append(z)
 out={
  "schema":"prism7-p68-frozen-p66-trend-score-transfer-on-binance-external-2025jan-jul-native55/v1",
  "status":"RESEARCH_EXTERNAL_MARKET_FALSIFICATION_NOT_PRODUCTION_OOS",
  "sourceBinanceOfficialMonthlyZipAll16SHA256Verified":True,
  "sourceBinanceDifferentOHLCVVersusAsterOverlap":True,
  "originalSourceNativeCodePinnedSHA":PIN,
  "sourceNative55NaturalWin28":True,
  "sourceNative55OriginalEntryExitH1ParityP61":True,
  "sourceOneSlot23Win13NAVParityP61":True,
  "sameFrozen15PointWeightsAndTrendDefinitionAsP66":True,
  "allMultiTFH1ClosedBeforeOriginalNativeEntry":True,
  "noPolicyRetunedOnBinanceExternalResult":True,
  "sourceOriginal55NativeEntryFeatureLedger":natural,
  "sourceScoreConfusion":{str(k):{"n":len(v),"wins":sum(x["originalNativeWin"] for x in v),
    "loss":sum(not x["originalNativeWin"] for x in v)}
    for k,v in sorted(scoreCounts.items())},
  "sourceBTCMacroWeeklyDailyUpN":sum(z["featuresAtNativeEntry"]["BTCWDUp"] for z in natural),
  "sourcePenguMacroWeeklyDailyUpN":sum(z["featuresAtNativeEntry"]["PENGUWDUp"] for z in natural),
  "sourceUnscorableWeeklyN":sum(not z["featuresAtNativeEntry"]["PENGUWeeklyKnown"] for z in natural),
  "preRegisteredPointPoliciesFromP66":POLICIES,
  "scenarioCount":len(scenarios),"allScenarios":scenarios,"normal30bps":selected,
  "sourceSHA256":{"P61":sha(P61),"P61verifiedOfficialMonthlyShaManifest":sha(MANIFEST),
    "PENGUH1_2024Dec_2025Jul":ph,"BTCH1_2024Dec_2025Jul":bh},
  "limitations":[
   "Cross-venue Binance USD-M 2025Jan-Jul differs from Aster historical Native53 market prices, this is a robustness stress test and cannot directly assert original Aster out-of-sample outcomes.",
   "Source 55 natural signals may overlap: original one-slot baseline has 23; score can change chronological admissions and total trading frequency.",
   "Only H1 source exit prices available in this external period: realized-only DD dramatically underestimates possible M5 high/intrabar DD.",
   "P66 score and policy tiers were explored on already inspected Native53; Binance P61 outcomes already inspected for another P44 analysis, so this is not strict blinded prospective holdout.",
   "BTC weekly+D bullish defined using TWO consecutive closed up-candles may not capture a rising long-term trend with daily corrections.",
   "Fee+100bps stress is hypothetical buy cover slippage, signed real order fills/STOP priority/funding/multi-runner shared risk absent.",
   "Do not promote any rule to production or alter Gross or STOP on this evidence."
  ]}
 OUT.write_text(json.dumps(out,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(z,ensure_ascii=False,sort_keys=True)+"\n" for z in natural),encoding="utf8")
 lines=["# P68 | Frozen P66 15-point entry score on external Binance original Native55",
  "",
  "Binance Futures USD-M Jan15-Jul17 2025, public Binance H1 monthly checksum-verified, DIFFERENT market venue than Aster native source53. Exactly same P66 causal completed W/D/12H/4H/1H trend points (5/4/3/2/1) and predeclared lot tiers, never changed based on Binance result.",
  "",
  "Native55 price-source 28 winners; one-slot original 23/13 wins, 30bps 0.75 NAV ¥14,397.7, only REALIZED exit-to-exit DD (no M5).",
  "",
  "| Frozen P66 scoring policy | Natural accepted | Orig source winners rejected | One slot | Wins | realized DD | NAV ¥ |",
  "|---|---:|---:|---:|---:|---:|---:|"]
 for z in selected:
  e=z["econ"]
  lines.append("| "+z["policy"]+" | "+str(55-e["sourceNaturalVetoed"])+" | "+str(e["sourceNaturalWinnersVetoed"])+
     " | "+str(e["oneSlotClosed"])+" | "+str(e["oneSlotWins"])+" | "+str(e["realizedOnlyDDPct"])+"% | "+str(e["finalNAVYen"])+" |")
 lines+=["","Do not compare this realized-only DD to the Aster P66 5-minute high-stress DD. Model source signals already inspected for P61 P44, thus not strict untouched OOS. If 15-point tier fails to transfer, do NOT refit using this same data.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P68_P66_FROZEN_SCORE_EXTERNAL_BINANCE_NATIVE55_P61_PARITY_PASS",
  json.dumps({"scenarioCount":len(scenarios),"macroBTCbullCount":out["sourceBTCMacroWeeklyDailyUpN"],
   "unknownW":out["sourceUnscorableWeeklyN"],
   "normal":[{"policy":z["policy"],"n":z["econ"]["oneSlotClosed"],
     "wins":z["econ"]["oneSlotWins"],"DDrealizedOnly":z["econ"]["realizedOnlyDDPct"],
     "NAV":z["econ"]["finalNAVYen"],"sourceWinRejected":z["econ"]["sourceNaturalWinnersVetoed"]}
    for z in selected]},ensure_ascii=False),flush=True)
 print("FILES",OUT,LEDGER,MD)
if __name__=="__main__":main()
