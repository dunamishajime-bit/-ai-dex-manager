#!/usr/bin/env python3
"""P81 executable-ish positive M5 prints and 0/5/15min delay scenarios for
Binance V20 signal execution on ASTER source, compared Aster own native signals.

Use P80 source-pinned *recomputed* stop & H1 native exit for each delayed
entry price and requested gross, not P78 optimistic H1 native price.
M5 exit price includes first traded M5 stop high price touch / next positive
print for native H1 timed exit; gaps approximated with max(open, stop).
Source no-positive-print entries are NOT treated as profitable fills.
Coinciding first entry/exit M5 bar ambiguous -> excluded.
No 0.25 sizes. Fee 10/30bps plus +100bps buy cover stress.
One-slot accounting using same ASTER M5 high marked DD and compounding.
"""
from __future__ import annotations
from pathlib import Path
import json,hashlib,collections,math
from collections import Counter
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p66_native53_multitimeframe_score_size_20261122 import replay
P80=R/"PRISM7_P80_M5_DELAY_0_5_15_REPRICED_AST_BIN_NATIVE_STOP_20261122.json"
P79=R/"PRISM7_P79_BINANCE_SIGNAL_ASTER_EXECUTION_VS_ASTER_ONLY_OR_BOTH_20261122.json"
OUT=R/"PRISM7_P81_BINANCE_SIGNAL_ASTER_M5_REPRICE_0_5_15_MIN_NATIVE_STOP_ECONOMIC_20261122.json"
MD=R/"PRISM7_P81_BINANCE_ENTRY_ASTER_EXEC_M5_STOP_0_5_15_LATENCY_STRESS_20261122.md"
SOURCE=("ASTER_NATIVE_SOURCE","BINANCE_NATIVE_SOURCE_EXECUTE_ASTER")
SIZES=("GROSS_075","P73_CONDITIONAL_HALF_OR_SKIP")
DELAYS=(0,5,15)
COSTS=((10,0),(30,0),(30,100))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
 info=json.loads(P80.read_text(encoding="utf8"))
 optimistic=json.loads(P79.read_text(encoding="utf8"))
 assert info["originalASTER53_H1PinnedParityFromP78"]=="PASS_53_OF_53"
 assert info["variationFromP14"].startswith("first printed ASTER")
 assert optimistic["originalASTER53NativeReplayParityAll"]
 assert len(info["allModeledGrossAndDelayM5Events"])==618
 events=info["allModeledGrossAndDelayM5Events"]
 m5,m5sha=load_m5(SOURCES)
 result=[];audit=[]
 for source in SOURCE:
  for size in SIZES:
   for delay in DELAYS:
    allEvents=[x for x in events if x["source"]==source and
       x["sizePolicy"]==size and x["requestedMinimumDelayMinutes"]==delay]
    valid=[z for z in allEvents if z["status"]=="PRICE_PROXY_CLOSED" and not z["ambiguousEntryAndExitWithinSameM5"]]
    missing=[z for z in allEvents if z["status"]!="PRICE_PROXY_CLOSED"]
    ambiguous=[z for z in allEvents if z["ambiguousEntryAndExitWithinSameM5"]]
    assert len(allEvents)==len(valid)+len(missing)+len(ambiguous)
    accepted=[]
    for z in valid:
     assert z["observedEntryTs"]<z["observedExitTs"],z["sourceKey"]
     assert z["observedEntryDelayMinutes"]>=delay
     assert z["gross"] in (.5,.75,1.0)
     assert abs(z["observedGrossProfitReturn30Pct"]-(100*(1-z["observedExitPrice"]/z["observedEntryPrice"])-.3))<1e-8
     accepted.append({
      "key":z["sourceKey"],"entryTs":z["observedEntryTs"],
      "entryPrice":z["observedEntryPrice"],"exitTs":z["observedExitTs"],
      "exitPrice":z["observedExitPrice"],"grossAllocation":z["gross"],
      "sourceNativeNet30Pct":z["observedGrossProfitReturn30Pct"],
      "sourceNativeWin":z["observedGrossProfitReturn30Pct"]>0,
      "score":z["dualMarketSignedScore"],
      "nativeSourceExitReason":z["observedExitReason"],
      "nativeSourceExitType":z["observedExitType"],
      "nativeM5PrintedFillProxy":True
     })
    modelCase={
      "source":source,"riskSize":size,"requestDelayMinutes":delay,
      "originalSourceCandidateCount":53 if source==SOURCE[0] else 57,
      "marketRejectedBeforeM5":(53 if source==SOURCE[0] else 57)-len(allEvents),
      "allNativeM5SourceModelEvents":len(allEvents),
      "noPrintOrCensored":len(missing),"firstBarStopUncertain":len(ambiguous),
      "validPrintedEntryAndNativeExitSourceModels":len(accepted),
      "gross0p25Prohibited":True,
      "nativeExitRecomputedOnEveryObservedEntryPriceGross":True,
      "nativeM5StopSameFeeAllSources":True}
    audit.append(modelCase)
    for fee,slip in COSTS:
     econ=replay(accepted,m5,fee,slip)
     result.append({**modelCase,"feeBps":fee,"extraBuyCoverBps":slip,
      "economic":{k:v for k,v in econ.items() if k!="capitalTradeLedger"},
      "selectedTradeLedger30bps":econ["capitalTradeLedger"] if fee==30 and slip==0 else None})
 # Earlier source P14 had original Aster53 52/53 positive-print modeled
 assert next(z for z in audit if z["source"]=="ASTER_NATIVE_SOURCE" and z["riskSize"]=="GROSS_075" and z["requestDelayMinutes"]==0)["validPrintedEntryAndNativeExitSourceModels"]==52
 assert next(z for z in audit if z["source"]=="BINANCE_NATIVE_SOURCE_EXECUTE_ASTER" and z["riskSize"]=="GROSS_075" and z["requestDelayMinutes"]==0)["validPrintedEntryAndNativeExitSourceModels"]==53
 normal=[]
 for r in result:
  if r["feeBps"]==30 and r["extraBuyCoverBps"]==0:
   stress=next(z for z in result if z["source"]==r["source"] and z["riskSize"]==r["riskSize"] and
      z["requestDelayMinutes"]==r["requestDelayMinutes"] and
      z["feeBps"]==30 and z["extraBuyCoverBps"]==100)
   econ=r["economic"];se=stress["economic"]
   normal.append({"source":r["source"],"riskSize":r["riskSize"],
      "requestDelayMinutes":r["requestDelayMinutes"],
      "originalNativeSourceIntents":r["originalSourceCandidateCount"],
      "marketRejected":r["marketRejectedBeforeM5"],"m5NoPrint":r["noPrintOrCensored"],
      "nativeM5Models":r["validPrintedEntryAndNativeExitSourceModels"],
      "singleSlotClosed":econ["closed"],"wins":econ["wins"],"winPct":econ["winPct"],
      "maxM5HighDDPct":econ["M5HighStressDDPct"],"finalNAVJPY":econ["finalNAVYen"],
      "plus100CoverDDPct":se["M5HighStressDDPct"],
      "plus100CoverNAVJPY":se["finalNAVYen"],
      "selectionOriginalSourceKeys":econ["singleSlotNativeSourceKeys"]})
 assert len(normal)==len(SOURCE)*len(SIZES)*len(DELAYS)==12
 # Inspect stress full 0/5/15 vs original ASTER, no output should be declared guaranteed actual fill
 report={"schema":"prism7-p81-binance-native-signal-Aster-native-M5-priced-0-5-15min-event-time-economy/v1",
  "status":"RESEARCH_ONLY_FIRST_POSITIVE_M5_BAR_PROXY_CAUSAL_NATIVE_EXIT_RECALCULATED",
  "sourceNativePin":"1657e173d250ad58f53e62f7bb0a3428fb405496",
  "nativeM5StopAndVOL_TARGETStateRecomputedAfterEachDelayedEntry":True,
  "sourceAsterNative53AndBinanceNativeAster57":True,
  "delaysMinutes":DELAYS,"grossAcceptedOnly":[.5,.75,1.0],
  "excludedGross0p25":True,
  "originalH1OptimisticSameClockP79Unchanged":True,
  "sourcePositiveM5VolumeMustExistBeforeEligibleProxyFill":True,
  "nativeSameM5EntryStopOrderingUncertainExcluded":True,
  "all36PriceScenarioAndPositionResults":result,
  "comparison30bpsNormalPlus100bpsStress":normal,
  "noPositiveM5PrintAndVetoAudit":audit,
  "inputSHA256":{"P80":sha(P80),"P79":sha(P79),"sourceASTERPositiveM5":m5sha},
  "limitations":[
   "M5 positive-volume first-open proxy is not a signed Aster orderbook executable fill. Delay 5/15m excludes any bars printed before delay; ignores spread and cross-venue network ordering.",
   "Native exit is recomputed for exact M5 entry price, entry time and requested gross using P14 native resident STOP and H1 state. It differs economically from original source H1-native exits, so do not directly confuse with P79 source H1 results.",
   "M5 high touch can be before an order could be sent/fill and represents only candle high, not exact intra-M5 trade sequence. Stop-gaps approximated by max(open, stop); true slip may exceed that.",
   "No-print candidates are excluded from trade, but counts retained and shown. They cannot be assumed profitable.",
   "The Native source H1 features have known ASTER H1 vs M5 mismatches, not exchange fills. Exit after H1 decision uses next positive printed M5 open, not native historical H1 open.",
   "All source periods previously used; unseen future Aster data and signed fills needed before production.",
   "No live Gross/STOP/orders/positions/master/Runner changes."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 lines=["# P81 | Binance発火→ASTER実行：0/5/15分遅延・ASTER M5実価格モデル・Native STOP再計算",
  "",
  "原Native 53件のH1出口元ソース完全一致はP78で確認済み。P80/P81はASTERの実約定ではなく「実際に出来高がある最初のM5ローソク足の始値」仮想約定。Binance発火57候補、ASTER自身発火53候補。エントリー時刻と価格を変えたNative出口および8%住み付きSTOPを純関数から再計算。0.25倍は禁止。",
  "",
  "| 発火→ASTER | ロット | 遅延 | 発火候補 | M5無取引で不成立 | 単一建玉・勝ち | M5最大DD | 1万円最終 | +100bpsDD | +100bps最終 |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
 for z in normal:
  lines.append("| "+z["source"]+" | "+z["riskSize"]+" | "+str(z["requestDelayMinutes"])+
   "分 | "+str(z["originalNativeSourceIntents"])+" | "+str(z["m5NoPrint"])+
   " | "+str(z["singleSlotClosed"])+"/"+str(z["wins"])+
   " | "+str(z["maxM5HighDDPct"])+"% | "+str(z["finalNAVJPY"])+
   " | "+str(z["plus100CoverDDPct"])+"% | "+str(z["plus100CoverNAVJPY"])+" |")
 lines+=["","**注意：** H1元モデルの約定を再現したものではなく、M5価格とストップ条件を入り直して再シミュレートした別の経済モデル。価格の元データが同じでも、価格始値・確定足・注文配信と出来高の有無で実際の約定可能性は変わる。独立の新規ASTER期と実際の署名付き約定では未検証。本番変更なし。",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P81_NATIVE_DELAYED_POSITIVE_M5_PRINT_REPRICE_BINANCE_ENTRY_ASTER_VS_ASTER_PASS",
  json.dumps(normal,ensure_ascii=False),flush=True)
 print("FILES",OUT,MD)
if __name__=="__main__":main()
