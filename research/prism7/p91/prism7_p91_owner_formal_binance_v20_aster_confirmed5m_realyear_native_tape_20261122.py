#!/usr/bin/env python3
"""P91: REAL historical signal-to-ASTER-entry tape for adopted PENGU V20.
2025-10-01 inclusive .. 2026-10-01 exclusive, Binance independently pinned
Native source from verified official Binance H1/M5 P74/P75; Aster historic
M5 first **COMPLETED** candle at +5m, score P87 frozen before user adoption.
Candidate admitted only if prior P73 owner gross (.5/.75) and Score5>=2.
Aster native exit and initial size-specific persistent STOP re-evaluated after
Aster M5 entry by P80 pinned code. All missing/terminal censored recorded.
NO portfolio replay performed by this script; no LIVE change.
"""
from __future__ import annotations
from pathlib import Path
import json,hashlib,gzip,collections,datetime,sys,math,statistics
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p73_no025_dualmarket_score_veto_half_full_20261122 import allocation
from prism7_p87_p88_m5_5_to_15_or_entry_causal_score_native_20261122 import check5
ROOT=R.parent
BIN_SOURCE=R/"PRISM7_P75_BINANCE_NATIVE62_SAME_UTC_DUAL_POINTS_NO025_TRANSFER_20261122.json"
M5_SOURCE=R/"PRISM7_P80_M5_DELAY_0_5_15_REPRICED_AST_BIN_NATIVE_STOP_20261122.json"
H1_SOURCE=Path(r"C:\tmp\disdex-bt-20251001-20261001\aster-public-v3-h1\PENGUUSDT-1h-20250924-20261001.jsonl.gz")
PENGU_NATIVE_ORIGINAL=Path(r"C:\tmp\disdex-bt-20251001-20261001\native-new-signal-20251001-20261001\native-PENGU-raw-intentions.jsonl")
OUT=R/"PRISM7_P91_OWNER_ADOPTED_REAL_1Y_BINANCE_TRIGGER_ASTER_CONFIRMED_M5_SOURCE_TAPE_20261122.json"
DECISIONS=R/"PRISM7_P91_REAL_1Y_BINANCE_V20_ALL_NATIVE_ENTRY_SCORE_DECISIONS_20261122.jsonl"
ACCEPTED=R/"PRISM7_P91_REAL_1Y_BINANCE_TO_ASTER_5M_ACCEPTED_NATIVE_V20_20261122.jsonl"
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
YEAR_START=1759276800000;YEAR_END=1790812800000;H=3600000;M5=300000
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def dt(t):return datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat()
def main():
 original=json.loads(BIN_SOURCE.read_text(encoding="utf8"))
 evs=json.loads(M5_SOURCE.read_text(encoding="utf8"))
 assert original["sourceIndependentBinanceNative62FromUnmodifiedPINOriginal"] and original["originalPinnedSourceSHA"]==PIN
 assert evs["originalASTER53_H1PinnedParityFromP78"]=="PASS_53_OF_53" and evs["noGross0p25"]
 allBin=original["independentSource62DualMarketAsOfFeatureLedger"]
 year=[z for z in allBin if YEAR_START<=z["entryTs"]<YEAR_END]
 assert len(allBin)==62 and len(year)==41
 year_times={z["entryTs"] for z in year}
 assert len(year_times)==len(year)
 m5,m5sha=load_m5(SOURCES)
 with gzip.open(H1_SOURCE,"rt",encoding="utf8") as f:
  h1={int(z[0]):z for line in f if line.strip() for z in [json.loads(line)]}
 m5ByHour={z["sourceNativeIntentTs"]:z for z in evs["allModeledGrossAndDelayM5Events"]
   if z["source"]=="BINANCE_NATIVE_SOURCE_EXECUTE_ASTER" and
      z["sizePolicy"]=="P73_CONDITIONAL_HALF_OR_SKIP" and
      z["requestedMinimumDelayMinutes"]==5 and YEAR_START<=z["sourceNativeIntentTs"]<YEAR_END}
 assert len(m5ByHour)==33
 originals=[json.loads(t) for t in PENGU_NATIVE_ORIGINAL.read_text(encoding="utf8").splitlines() if t.strip()]
 original_short=[z for z in originals if z["route"]=="SHORT_V20" and YEAR_START<=int(z["entryTs"])<YEAR_END]
 original_other=[z for z in originals if z["route"]!="SHORT_V20" and YEAR_START<=int(z["entryTs"])<YEAR_END]
 # These form the shared portfolio opportunities BEFORE slot / risk gates.
 decisions=[];accepted=[];stat=collections.Counter()
 original_matches=0
 for z in sorted(year,key=lambda q:q["entryTs"]):
  t=int(z["entryTs"])
  sourceKey=z["key"]
  assert int(z["referenceNativeV20Pin"] is not None) if False else z["referenceNativeV20Pin"]==PIN
  srcGross=allocation("MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT",z)
  assert srcGross in (0,.5,.75)
  assert t in h1 and t-H in h1
  prev=float(h1[t-H][4])
  assert prev>0 and float(h1[t][1])>0
  assert t in m5 and len(m5[t])>=6
  gate=check5(m5,t,prev)
  assert gate["observableEndTs"]==t+M5
  if gate["pass"] and srcGross>0: assert float(m5[t][5])>0
  m5Rec=m5ByHour.get(t)
  if srcGross>0:
   assert m5Rec is not None and m5Rec["gross"]==srcGross
  else:
   assert m5Rec is None,("GROSS0_WITH_M5_REPLAY",t)
  origA=any(q["entryTs"]==t for q in original_short)
  if origA:original_matches+=1
  decision={
    "sourcePinnedNativeOriginalV20SHA":PIN,"sourceNativeMarket":"BINANCE",
    "executionMarket":"ASTER","entrySourceId":sourceKey,
    "signalSourceUTC":dt(t),"nativeSignalAtUtcH1Close":t,
    "nativeExecutedLimitEarliestTs":t+M5,
    "asterLastFullyCompletedH1CloseAtSignal":prev,
    "asterClosedM5Check":gate,
    "macroSignedScore":z["dualSigned"]["grossSignedScore"],
    "ownerP73GrossBeforeM5":srcGross,
    "originalAsterV20WouldSignal":origA,
    "sourceNativeBinanceNet30PctOnlyAsResearchReference":z["sourceNativeNet30Pct"],
    "nativeDecisionLastFullyCompletedM5Ts":t+M5,
    "modelEventStatus":m5Rec["status"] if m5Rec else None}
  if srcGross==0:
   decision["final"]="REJECT_MACRO_0_GROSS";stat[decision["final"]]+=1
  elif not gate["pass"]:
   decision["final"]="REJECT_5M_SCORE_OR_NO_PRINT";stat[decision["final"]]+=1
  elif m5Rec["status"]!="PRICE_PROXY_CLOSED":
   decision["final"]="NOT_EXECUTABLE_OR_EXIT_CENSORED_"+m5Rec["status"];stat[decision["final"]]+=1
  elif m5Rec["ambiguousEntryAndExitWithinSameM5"]:
   decision["final"]="REJECT_SAME_5M_BAR_STOP_ORDERING_UNKNOWN";stat[decision["final"]]+=1
  else:
   assert m5Rec["observedEntryTs"]>=t+M5
   assert m5Rec["observedExitTs"]>m5Rec["observedEntryTs"]
   assert m5Rec["observedEntryPrice"]>0 and m5Rec["observedExitPrice"]>0
   assert m5Rec["gross"] in (.5,.75)
   decision["final"]="ACCEPT_5M_NATIVE_SOURCE_AS_RESEARCH_HYPOTHESIS"
   decision["execEntryTs"]=int(m5Rec["observedEntryTs"])
   decision["execEntryPrice"]=float(m5Rec["observedEntryPrice"])
   decision["exitTs"]=int(m5Rec["observedExitTs"])
   decision["exitPrice"]=float(m5Rec["observedExitPrice"])
   stat[decision["final"]]+=1
   entry={
     "strategy_id":"PENGU","source_runtime_sha":PIN,
     "sourceSignalPolicy":"BINANCE_NATIVE_V20_ONLY_P73_ASTERM5_CLOSED5_RESEARCH_ADOPTED",
     "sourceBinanceSignalId":sourceKey,
     "route":"SHORT_V20","side":"SHORT","symbol":"PENGUUSDT",
     "signalTs":t-1,
     "entryTs":int(m5Rec["observedEntryTs"]),
     "entryReferenceOpenPrice":float(m5Rec["observedEntryPrice"]),
     "requestedGross":m5Rec["gross"],
     "shortHardStopPct":.08,"shortMaxHoldHours":72,
     "nativeEvaluationKind":"BINANCE_NATIVE_SIGNAL_ASOF_ASTER_M5_CONFIRMED_NATIVE_EXIT_REPLAY",
     "modelEntryExit":{
       "entryTs":int(m5Rec["observedEntryTs"]),
       "entryPrice":float(m5Rec["observedEntryPrice"]),
       "exitTs":int(m5Rec["observedExitTs"]),
       "exitPrice":float(m5Rec["observedExitPrice"]),
       "exitReason":"PENGU_NATIVE_"+m5Rec["observedExitReason"],
       "exitType":m5Rec["observedExitType"]},
     "sourceNativeEntryHourTs":t,
     "marketDataDecisionScore5":gate["score"],
     "signedExecutionVerified":False,
     "nativeStopExecutionPriceIsM5HighTouchProxyNotOrderbook":True,
     "noGross025":True}
   # Preserve research-only source evidence and all Native V20 no order claim.
   accepted.append(entry)
  decisions.append(decision)
 assert len(decisions)==len(year)==41
 assert len(accepted)==stat["ACCEPT_5M_NATIVE_SOURCE_AS_RESEARCH_HYPOTHESIS"]
 assert all(YEAR_START<=x["entryTs"]<YEAR_END for x in accepted)
 assert len({z["entryTs"] for z in accepted})==len(accepted)
 assert original_matches<=len(original_short)
 assert len(original_short)>0 and len(original_other)>0
 DECISIONS.write_text("".join(json.dumps(z,ensure_ascii=False,sort_keys=True)+"\n" for z in decisions),encoding="utf8")
 ACCEPTED.write_text("".join(json.dumps(z,ensure_ascii=False,sort_keys=True)+"\n" for z in accepted),encoding="utf8")
 report={
  "schema":"prism7-p91-formally-selected-binance-native-V20-Aster-confirmed5m-2025Oct2026Oct-source-intents/v1",
  "ownerOfficialStrategySelected":True,"realHistoricalPricesSynthetic":False,
  "dataTradingCalendar":[dt(YEAR_START),dt(YEAR_END)+" (exclusive)"],
  "originalNativePIN":PIN,"originalBINANCEAll62":62,
  "binanceNativeYearNatural41":len(year),
  "binanceSourceYearP73OwnerMacroEligible":len(m5ByHour),
  "sourceOriginalAsterV20NativeYear":len(original_short),
  "sourceOriginalAsterOtherPENGULongRecoveryYear":len(original_other),
  "binanceAndAsterOriginalSameHourNativeYear":original_matches,
  "P73GrossInYears":dict(collections.Counter(str(allocation("MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT",z)) for z in year)),
  "decisionCounts":dict(stat),
  "acceptedBinance5mCausalNativeResearchCandidateCount":len(accepted),
  "acceptedGrossBySize":dict(collections.Counter(str(z["requestedGross"]) for z in accepted)),
  "acceptedExitReason":dict(collections.Counter(z["modelEntryExit"]["exitReason"] for z in accepted)),
  "acceptedNativeReturn30bpsGrossUnlevered":[
    {"entryTs":x["entryTs"],"exitTs":x["modelEntryExit"]["exitTs"],
     "gross":x["requestedGross"],
     "unleveredReturn30bpsPct":round(100*(1-x["modelEntryExit"]["exitPrice"]/x["modelEntryExit"]["entryPrice"])-.3,8)} for x in accepted],
  "sourceProtocol":"Binance pinned original Short V20 signal previous closed H1 as of t; frozen P73 multi-horizon signed macro (0/0.5/0.75) + P87 ASTER completed M5 [t,t+5) 5m score>=2; execute only at observed Aster first positive trade M5 open at or later than t+5; exit native P80 Aster source pure M5 stop after size-specific replay",
  "noFutureKlineReadAtEntry":True,"no0p25Size":True,
  "noRealSignedFillOrSignedSTOP":True,
  "allOtherRunnersAndPENGULongRecoveryNotAlteredInThisTape":True,
  "fullPortfolioRerunPending":True,
  "noLiveOrdersPositionsSTOPRunnerChanged":True,
  "sourcesSha256":{"BinanceOfficialIndependentV20AndAsOfMacroP75":sha(BIN_SOURCE),
    "AsterNativeM5EntryExitP80":sha(M5_SOURCE),
    "AsterSourceH1":sha(H1_SOURCE),
    "AsterM5":m5sha,
    "originalAllPENGUNativeRawIntents":sha(PENGU_NATIVE_ORIGINAL),
    "all41DecisionTape":sha(DECISIONS),
    "eligibleEntryNativeStopTape":sha(ACCEPTED)},
  "limitations":[
   "P80 Native M5 stop uses high-touch proxy, no signed STOP actual fill, first print at M5 open may not be executable at actual bid after asof confirmation.",
   "This is source intent evidence only; no fills realized until full account/portfolio replayer performs chronological admission, funding, shared daily kill switch/Gross, DD and cross-runner preemption.",
   "Owner P73 macro veto is unchanged; 0.25 prohibited. Synthetic test P88 not a guarantee.",
   "Only replaces PENGU SHORT_V20, not PENGU LONG_V64 / RECOVERY_V8 or any other Runner.",
   "Portfolio original engine often samples every 30min; new PENGU entry after t+5m requires minute-accurate or event-time replay. Any old 30-min-only replay is invalid unless corrected.",
   "Binance Original native hourly trigger not the same as Aster source-native signal; losing original Aster-only V20 events is intentional and must be modeled as replacement, not OR union.",
   "Production unchanged."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
 print("P91_REAL_BINANCE_NATIVE_ENTRY_ASTER_POST5M_SCORE_STRICT_ONE_YEAR_41_SOURCE_DONE",
  json.dumps({"originalAsterV20":len(original_short),"originalLongAndRecovery":len(original_other),
   "binanceNativeOriginalYear":len(year),"P73GrossEligible":len(m5ByHour),
   "decision":dict(stat),"accepted":len(accepted),"gross":report["acceptedGrossBySize"]},
    ensure_ascii=False),flush=True)
 print("FILES",OUT,DECISIONS,ACCEPTED)
if __name__=="__main__":main()
