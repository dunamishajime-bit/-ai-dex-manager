#!/usr/bin/env python3
"""P79: trading PENGU on ASTER driven by Binance native signal, validated P78
AST-execution native SOURCE EXIT; compare AST-only, BIN-only, either, both.

Two signal feeds share same UTC but must not share venue execution prices.
All executable trades are ASTER 1H source open; ASTER native V20 original
exit state replays with ASTER H1 source (P78 validates all 53 original exits).
Market scoring as-of same clock, exactly P73 gross0 /0.5 /0.75 /1.0.
Source 53 native AST trades and 57 Binance-trigger AST counterfactual trades.
Use existing P66 M5 high risk/one slot simulator for all modes, 10/30bps
fees and +100bps buy cover. Source clock same for every comparison.

EXECUTION CAVEAT: Instant ASTER 1H open fill at Binance H1 alert with zero
cross-venue transport, no queue/slippage/stock exchange fill proof.
Each cohort's H1 native pure stop price, not signed M5 STOP fill.
"""
from __future__ import annotations
import json,hashlib,datetime,collections,statistics
from pathlib import Path
from collections import Counter,defaultdict
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE,SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p66_native53_multitimeframe_score_size_20261122 import replay
from prism7_p73_no025_dualmarket_score_veto_half_full_20261122 import allocation
P71=R/"PRISM7_P71_DUAL_MARKET_SIGNED_TF_POINTS_NATIVE53_20261122.json"
P73=R/"PRISM7_P73_NO_GROSS025_V20_SIGNED_AST_BIN_RISK_REJECT_VS_HALF_20261122.json"
P75=R/"PRISM7_P75_BINANCE_NATIVE62_SAME_UTC_DUAL_POINTS_NO025_TRANSFER_20261122.json"
P78=R/"PRISM7_P78_BINANCE_NATIVE_ENTRY_EXECUTE_ASTER_PINNED_NATIVE_EXIT_20261122.json"
P76=R/"PRISM7_P76_EXACT_SAME_HOUR_AST_BIN_NATIVE_ENTRY_WIN_AND_SIGNED_SCORE_20261122.json"
OUT=R/"PRISM7_P79_BINANCE_SIGNAL_ASTER_EXECUTION_VS_ASTER_ONLY_OR_BOTH_20261122.json"
LEDGER=R/"PRISM7_P79_AST_EXEC_ALL83_DISTINCT_NATIVE_BINSIGNAL_SOURCE_CANDIDATES_20261122.jsonl"
MD=R/"PRISM7_P79_BINANCE_TRIGGER_EXECUTE_ASTER_NATIVE_PENGU_SHORT_COMPARISON_20261122.md"
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
SOURCES_MODES=(
 "ASTER_NATIVE_SOURCE_ONLY",
 "BINANCE_TRIGGER_ASTER_EXECUTION",
 "BINANCE_TRIGGER_ASTER_EXECUTION_BINANCE_ONLY_NONOVERLAP",
 "ASTER_AND_BINANCE_SIMULTANEOUS_SIGNAL",
 "ASTER_OR_BINANCE_ANY_SIGNAL",
)
ALLOCATION_MODES=("GROSS_075","GROSS_100","P73_CONDITIONAL_HALF_OR_SKIP","P73_MACRO_BULL_VETO",
                  "P73_NEGATIVE_SCORE_STRONG_VETO")
COSTS=((10,0),(30,0),(30,100))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def utc(t):return datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat()
def policy_alloc(name,x):
 if name=="GROSS_075":return .75
 if name=="GROSS_100":return 1.
 if name=="P73_CONDITIONAL_HALF_OR_SKIP":
  return allocation("MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT",x)
 if name=="P73_MACRO_BULL_VETO":return allocation("MACRO_BULL_VETO_075",x)
 if name=="P73_NEGATIVE_SCORE_STRONG_VETO":
  return allocation("SIGNED_LESS_MINUS6_VETO_ELSE_075",x)
 raise ValueError("UNKNOWN_POLICY "+name)
def to_aster(x):
 return {**x,"key":x["key"],"signalSource":"ASTER_NATIVE_V20",
   "executionMarket":"ASTER_PRICE_SOURCE","originalAsterNativeSignal":True,
   "binanceNativeSignal":False,
   "score":x["dualSigned"]["grossSignedScore"],"sourceNativeWin":x["sourceNativeNet30Pct"]>0}
def to_bin(x,score):
 assert x["asterHypotheticalExitStatus"]=="NATIVE_EXIT_MODELED"
 assert x["entryTs"]==x["binanceEntryTs"] if "entryTs" in x else True
 s=score[x["binanceEntryTs"]]
 return {"key":"BINANCE_SIGNAL|"+x["binanceNativeSignalID"]+"|"+str(x["binanceEntryTs"]),
   "entryTs":x["binanceEntryTs"],"entryPrice":x["asterHypotheticalEntryPrice"],
   "exitTs":x["asterHypotheticalExitTs"],"exitPrice":x["asterHypotheticalExitPrice"],
   "sourceNativeNet30Pct":x["asterHypotheticalNet30Pct"],"sourceNativeWin":x["asterHypotheticalWin30Pct"],
   "cohort":x["period"],
   "signalSource":"BINANCE_NATIVE_V20","executionMarket":"ASTER_PRICE_SOURCE",
   "originalAsterNativeSignal":x["asterOriginalNativeWouldSignal"],
   "binanceNativeSignal":True,
   "binanceNativeSourceWin":x["binanceNativeOriginalWin"],
   "binanceNativeSourceNet30Pct":x["binanceNativeOriginalNet30Pct"],
   "asterCounterfactualExitReason":x["asterHypotheticalNativeExitReason"],
   "score":s["dualSigned"]["grossSignedScore"],
   "dualSigned":s["dualSigned"],"featuresAtNativeEntry":s["featuresAtNativeEntry"],
   "instantOpenExecutionLatencyOptimistic":True}
def main():
 d71=json.loads(P71.read_text(encoding="utf8"))
 d73=json.loads(P73.read_text(encoding="utf8"))
 d75=json.loads(P75.read_text(encoding="utf8"))
 d78=json.loads(P78.read_text(encoding="utf8"))
 d76=json.loads(P76.read_text(encoding="utf8"))
 assert d78["originalAsterNative53Parity"]=="PASS_53_OF_53"
 assert d78["sourceBinancePriceIsNeverAsterEntryOrExitFill"]
 assert d78["sourceAsterNativeEntrySignalIsNotRequiredForBinanceOnlyMode"]
 assert d75["sourceIndependentBinanceNative62FromUnmodifiedPINOriginal"]
 assert d73["gross025ExcludedByOwnerRequest"] and d76["pairedExactSameUTCNativeEntryCount"]==27
 a=[to_aster(x) for x in d71["crossVenueSourceCaseAsOfScoreLedger53"]]
 indexedB={x["entryTs"]:x for x in d75["independentSource62DualMarketAsOfFeatureLedger"]}
 b=[to_bin(x,indexedB) for x in d78["exactSourcePriceCounterfactualEvents"]]
 assert len(a)==53 and len(b)==57 and sum(x["sourceNativeWin"] for x in a)==29
 assert sum(x["sourceNativeWin"] for x in b)==32
 at={x["entryTs"]:x for x in a};bt={x["entryTs"]:x for x in b}
 both=set(at)&set(bt)
 assert len(both)==27
 assert all(x["executionMarket"]=="ASTER_PRICE_SOURCE" for x in a+b)
 for t in both:
  x,y=at[t],bt[t]
  assert x["entryPrice"]==y["entryPrice"],(t,"ASTER_ENTRY_PRICE_CONFLICT")
  assert x["exitTs"]==y["exitTs"],(t,"ASTER_EXIT_TIME_CONFLICT")
  assert abs(x["exitPrice"]-y["exitPrice"])<1e-10,(t,"ASTER_EXIT_PRICE_CONFLICT")
  assert x["score"]==y["score"],(t,"ASOF_MACRO_SIGNED_SCORE_CONFLICT")
 # Merge entry policies by original UTC hour, not by different venue fill.
 union=[{**x,"binanceNativeSignal":x["entryTs"] in bt,
    "binanceNativeSourceNet30Pct":bt[x["entryTs"]]["binanceNativeSourceNet30Pct"]
       if x["entryTs"] in bt else None} for x in a]
 union+=[z for z in b if z["entryTs"] not in at]
 assert len(union)==53+57-27==83
 bothRows=[{**at[t],"binanceNativeSignal":True} for t in sorted(both)]
 onlyBin=[z for z in b if z["entryTs"] not in at]
 assert len(onlyBin)==30 and sum(z["sourceNativeWin"] for z in onlyBin)==17
 candidates={
  "ASTER_NATIVE_SOURCE_ONLY":a,
  "BINANCE_TRIGGER_ASTER_EXECUTION":b,
  "BINANCE_TRIGGER_ASTER_EXECUTION_BINANCE_ONLY_NONOVERLAP":onlyBin,
  "ASTER_AND_BINANCE_SIMULTANEOUS_SIGNAL":bothRows,
  "ASTER_OR_BINANCE_ANY_SIGNAL":union,
 }
 m5,m5sha=load_m5(SOURCES)
 results=[];sourceGroups={}
 for src in SOURCES_MODES:
  rows=candidates[src]
  sourceGroups[src]={"sourceCandidates":len(rows),"sourceWins":sum(z["sourceNativeWin"] for z in rows),
     "sourceLosses":sum(not z["sourceNativeWin"] for z in rows),
     "firstUTC":utc(min(z["entryTs"] for z in rows)),
     "lastUTC":utc(max(z["entryTs"] for z in rows)),
     "sourceProfitPointSum30":round(sum(z["sourceNativeNet30Pct"] for z in rows),6)}
  for size in ALLOCATION_MODES:
   selections=[{**x,"grossAllocation":policy_alloc(size,x)} for x in rows]
   assert all(z["grossAllocation"] in (0.,.5,.75,1.) for z in selections)
   for fee,slip in COSTS:
    result=replay(selections,m5,fee,slip)
    results.append({"sourcePolicy":src,"allocationPolicy":size,"feeBps":fee,
      "extraBuyCoverSlippageBps":slip,"binanceTriggersButAsterOpenAndNativeExit":True,
      "gross0p25NeverUsed":True,
      "sourceCandidates":len(rows),
      "sourceGrossSkippedBeforeSlot":result["sourceRejectedBeforeSlot"],
      "sourceWinsRejected":result["sourceRejectedWinningSignals"],
      "economic":{k:v for k,v in result.items() if k!="capitalTradeLedger"},
      "selectedTrades30bps":result["capitalTradeLedger"] if fee==30 and slip==0 else None})
 assert len(results)==len(SOURCES_MODES)*len(ALLOCATION_MODES)*len(COSTS)
 # Full original ASTER native unmodified economic reference exactly from P73.
 for fee,slip in COSTS:
  observed=next(z for z in results if z["sourcePolicy"]=="ASTER_NATIVE_SOURCE_ONLY" and
      z["allocationPolicy"]=="GROSS_075" and z["feeBps"]==fee and z["extraBuyCoverSlippageBps"]==slip)
  native=next(z for z in d73["allCostScenarios"] if z["policy"]=="ORIGINAL_075" and
      z["feeBps"]==fee and z["extraCoverSlippageBps"]==slip)
  for key in ("closed","wins","finalNAVYen","M5HighStressDDPct"):
   assert abs(observed["economic"][key]-native["econ"][key])<.001,(fee,slip,key)
  # P78 27 SAME HOUR candidate ASTER native P35 parity already tested.
 normal=[z for z in results if z["feeBps"]==30 and z["extraBuyCoverSlippageBps"]==0]
 stressed=[z for z in results if z["feeBps"]==30 and z["extraBuyCoverSlippageBps"]==100]
 compact=[]
 for z in normal:
  e=z["economic"]
  s=next(v for v in stressed if v["sourcePolicy"]==z["sourcePolicy"] and v["allocationPolicy"]==z["allocationPolicy"])
  compact.append({"source":z["sourcePolicy"],"riskSize":z["allocationPolicy"],
    "natural":z["sourceCandidates"],"selected":e["closed"],"wins":e["wins"],
    "winPct":e["winPct"],"M5HighDD":e["M5HighStressDDPct"],
    "finalNavJPY":e["finalNAVYen"],
    "M5HighDDPlus100Cover":s["economic"]["M5HighStressDDPct"],
    "finalNavJPYPlus100Cover":s["economic"]["finalNAVYen"],
    "originalSourceWinnersSkippedByVeto":z["sourceWinsRejected"],
    "oneSlotPositionKeys":e["singleSlotNativeSourceKeys"]})
 benchmark=next(z for z in compact if z["source"]=="ASTER_NATIVE_SOURCE_ONLY" and z["riskSize"]=="GROSS_075")
 result={
  "schema":"prism7-p79-binance-native-trigger-aster-native-source-fill-source-exit-economic-comparison/v1",
  "status":"RESEARCH_ONLY_BINANCE_ENTRY_ASTER_EXECUTION_PRICE_AND_NATIVE_EXIT_ECONOMY",
  "sourceNativePin":PIN,
  "originalASTER53NativeReplayParityAll":True,
  "BinanceNative57ChosenInASTEROriginal53FirstLastClock":True,
  "BinanceNativeButASTERNoNativeSignal30":True,
  "AsterBinanceBothNativeSignalSame27":True,
  "sourceBinanceNativeExitPricesNotUsedForASTERProfit":True,
  "sourceASTERNativeExitPureReplayOnBinanceEntrys":True,
  "originalNative53SourceSignalAndExitUnchanged":True,
  "asofScoreFrozenP73NoGross0p25":True,
  "grossValuesAllowed":[0,.5,.75,1.],
  "feeStress":COSTS,
  "oneSlotProfitAndM5HighStress":True,
  "researchSourceCandidateGroups":sourceGroups,
  "all75PriceScenarioGrid":results,
  "normal30bpsVs100bpsCoverStress":compact,
  "originalASTER53Native075Benchmark":{
     "closed":benchmark["selected"],"wins":benchmark["wins"],
     "NAV":benchmark["finalNavJPY"],"DD":benchmark["M5HighDD"],
     "M5DDCover100":benchmark["M5HighDDPlus100Cover"]},
  "allUniqueOriginalSource83SameUTC":union,
  "sourceSHA256":{"P71":sha(P71),"P73":sha(P73),"P75":sha(P75),
    "P78":sha(P78),"P76":sha(P76),"ASTER_M5":m5sha},
  "limitations":[
    "ASTER hypothetical fills all use same-hour H1 OPEN at Binance signal time (no delay, order book, queue or auction), an optimistic assumption; real trans-venue alert and fill may be later.",
    "ASTER original Native exit code source exactly validated 53/53; Binance-native triggered ASTER native exits recomputed, not simply substituting Binance native winners.",
    "If Aster native didn't signal, policy still permits Aster execution upon Binance signal as requested; this changes live admission semantics and needs separate owner approval to deploy.",
    "All runs have fixed natural Native instrument PENGUUSDT H1 exit and Aster price source M5 marked high. No signed venue STOP fill, funding, Shared Risk or multi-runner Gross.",
    "Data periods previously viewed; not untouched independent OOS. Same first-last Aster source entry dates; raw Source53/57/83 opportunities not 53/57/83 realized positions.",
    "Risk tiers 0.5,0.75,1.0 exploratory only; minimum 0.5 for accepted trades; no gross0.25.",
    "Source55 vs 62 original Binance signal candidate study differs, this uses P74 exact same-calendar native62 and the 57 matching Aster original entry range.",
    "Original ASTER H1 source includes three cohort context source models, potential H1 MACD/EMA initial context differences are guarded by parity against all 53 original signals and exits.",
    "Production LIVE, risk, STOP, orders, positions, GitHub master unchanged."
  ]}
 OUT.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(z,ensure_ascii=False,sort_keys=True)+"\n" for z in union),encoding="utf8")
 lines=["# P79 — Binance native trigger => ASTER execution with ASTER Native V20 exit",
  "",
  "ASTER original 53 pure pinned source entries/exits passed 53/53 parity. Binance original Native62 source triggers in the Aster original first-last entry clock yield 57 intents, 27 simultaneous with Aster Native53 and 30 Binance-only. All 57 executed at ASTER same UTC H1 source OPEN and independently exited by ASTER pinned native V20 pure EXIT function; Binance exit/price not used for profit.",
  "",
  "Prices are ASTER source, one-slot, 10/30bps + extra 100bps cover stress and M5 high stress mark; Gross 0/.5/.75/1.0 (never .25). Same-hour entry without latency is an OPTIMISTIC research proxy and not live executable fill.",
  "",
  "| Source entry policy | Sizing policy | selected/wins | Max M5 DD | 10k NAV | +100bps cover DD | +100bps NAV |",
  "|---|---|---:|---:|---:|---:|---:|"]
 for z in compact:
  lines.append("| "+z["source"]+" | "+z["riskSize"]+" | "+
   str(z["selected"])+"/"+str(z["wins"])+" | "+
   str(z["M5HighDD"])+"% | "+str(z["finalNavJPY"])+" | "+
   str(z["M5HighDDPlus100Cover"])+"% | "+str(z["finalNavJPYPlus100Cover"])+" |")
 lines+=["","**Research-only, no live changes.** 0.5 or skip is owner preference, but exact source portfolio risk and real signed STOP fill are not checked. Need treat cross-venue transport latency, spread, and opposing venue quote movement before considering implementation.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 highlights=[z for z in compact if z["riskSize"] in ("GROSS_075","P73_CONDITIONAL_HALF_OR_SKIP")]
 print("P79_BINANCE_TRIGGER_ASTER_NATIVE_PRICE_EXIT_57_P78_53_PARITY_ECONOMIC_75_CASES_PASS",
  json.dumps({"originalAsterGross075NAVDD":benchmark,
   "sourceGroups":sourceGroups,
   "comparison":highlights},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
