#!/usr/bin/env python3
"""P83: owner selected OR entry: ASTER OR Binance pinned Native V20 short trigger,
execute ONCE at ASTER on equal UTC time. Research, no LIVE changes.

Use P80 source-pinned Aster V20 native STOP M5 causal exit/event replay with
0,5,15min first positive-volume M5 print; P81 accounting identical controls.
Source native intents AST 53 and BIN 57 in same source entry window,
27 exact-hour shared native signals => 83 distinct intent UTC hours.
One slot for actual PENGU short positions, no duplicate requests or simultaneous
positions, successful gross allocations ONLY 0.50 or 0.75.
Compare AST-only, BIN-only, AST AND BIN, AST OR BIN with P73 conditional half/
skip and fixed 0.75. 10/30bps and +100bps exit stress. Use fully independent
source native exit model after delayed ASTER M5 entry. Fully closed indicators
from same timestamp. Research-only; timing and venue stops unverified.
"""
from __future__ import annotations
from pathlib import Path
import json,hashlib,datetime,collections
from collections import Counter, defaultdict
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p66_native53_multitimeframe_score_size_20261122 import replay

P80=R/"PRISM7_P80_M5_DELAY_0_5_15_REPRICED_AST_BIN_NATIVE_STOP_20261122.json"
P81=R/"PRISM7_P81_BINANCE_SIGNAL_ASTER_M5_REPRICE_0_5_15_MIN_NATIVE_STOP_ECONOMIC_20261122.json"
P79=R/"PRISM7_P79_BINANCE_SIGNAL_ASTER_EXECUTION_VS_ASTER_ONLY_OR_BOTH_20261122.json"
OUT=R/"PRISM7_P83_OWNER_SELECTED_ASTER_OR_BINANCE_SINGLE_ORDER_ASTER_M5_ENTRY_20261122.json"
MD=R/"PRISM7_P83_OR_DUAL_TRIGGER_ONE_ASTER_ORDER_V20_M5_LATENCY_20261122.md"
TRACE=R/"PRISM7_P83_OR_SAME_HOUR_DEDUP_NAT83_SELECTED_ORDER_DECISIONS_20261122.jsonl"

AST="ASTER_NATIVE_SOURCE"
BIN="BINANCE_NATIVE_SOURCE_EXECUTE_ASTER"
SOURCES_MODES=("ASTER_ONLY","BINANCE_ONLY","BOTH_REQUIRED","EITHER_OR_SINGLE_ASTER_ORDER")
SIZES=("GROSS_075","P73_CONDITIONAL_HALF_OR_SKIP")
DELAYS=(0,5,15)
COSTS=((10,0),(30,0),(30,100))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def utc(ts):return datetime.datetime.fromtimestamp(ts/1000,datetime.timezone.utc).isoformat()
def expect(condition,msg):assert condition,msg
def event_as_order(x):
 expect(x["status"]=="PRICE_PROXY_CLOSED" and not x["ambiguousEntryAndExitWithinSameM5"],"INVALID_EXECUTION_PROXY")
 expect(x["observedEntryTs"]<x["observedExitTs"],"EXIT_NOT_AFTER_ENTRY")
 expect(x["gross"] in (.5,.75,1.),"GROSS25_FORBIDDEN")
 return {"key":x["sourceKey"],"entryTs":x["observedEntryTs"],"entryPrice":x["observedEntryPrice"],
  "exitTs":x["observedExitTs"],"exitPrice":x["observedExitPrice"],"grossAllocation":x["gross"],
  "sourceNativeNet30Pct":x["observedGrossProfitReturn30Pct"],
  "sourceNativeWin":x["observedGrossProfitReturn30Pct"]>0,
  "score":x["dualMarketSignedScore"],
  "originalNativeSignalTs":x["sourceNativeIntentTs"],
  "sourceVenue":"ASTER_SOURCE_PRICED_PIN_NATIVE_EXIT",
  "triggerVenue":"BINANCE" if x["source"]==BIN else "ASTER",
  "bothTriggeredAtSameUTC":x["bothMarketNativeOriginalEntrySignal"],
  "firstM5DelayMinutes":x["requestedMinimumDelayMinutes"],
  "originalM5nativeExitReason":x["observedExitReason"]}
def main():
 a=json.loads(P80.read_text(encoding="utf8"))
 p81=json.loads(P81.read_text(encoding="utf8"))
 p79=json.loads(P79.read_text(encoding="utf8"))
 assert a["noGross0p25"] and p81["excludedGross0p25"]
 assert p79["AsterBinanceBothNativeSignalSame27"] and p79["BinanceNativeButASTERNoNativeSignal30"]
 assert a["sourceOriginalASTER53AndBinanceASTExecution57"]
 assert len(a["allModeledGrossAndDelayM5Events"])==618
 events=a["allModeledGrossAndDelayM5Events"]
 originalEventsBySource={AST:set(),BIN:set()}
 for x in events:
  originalEventsBySource[x["source"]].add(x["sourceNativeIntentTs"])
 assert len(originalEventsBySource[AST])==53 and len(originalEventsBySource[BIN])==57
 ab=originalEventsBySource[AST]&originalEventsBySource[BIN]
 assert len(ab)==27
 ar=originalEventsBySource[AST]|originalEventsBySource[BIN]
 assert len(ar)==83
 assert len(ar-originalEventsBySource[AST])==30
 assert len(ar-originalEventsBySource[BIN])==26
 m5,m5sha=load_m5(SOURCES)
 scenario=[];decisionLedger=[];controls=[]
 for size in SIZES:
  for delay in DELAYS:
   current=[x for x in events if x["sizePolicy"]==size and x["requestedMinimumDelayMinutes"]==delay]
   # Each original signal has at most one M5 model event per native source.
   bySource={}
   for origin in (AST,BIN):
    rows={x["sourceNativeIntentTs"]:x for x in current if x["source"]==origin}
    expect(len(rows)==len([x for x in current if x["source"]==origin]),"DUPLICATE_SOURCE_SIGNAL_M5_EVENT")
    bySource[origin]=rows
   for ts in sorted(ab):
    first=bySource[AST].get(ts);second=bySource[BIN].get(ts)
    # Owner's conditional 0.5 policy scores must be identical for the same
    # UTC event, never 2 distinct lots or votes for two orders.
    if first is None or second is None:
     # both source signals rejected only if both are not in P80 events.
     expect(first is None and second is None,"INCONSISTENT_SHARED_CLOCK_GATE")
     continue
    for field in ("gross","status","observedEntryTs","observedEntryPrice",
      "observedExitTs","observedExitPrice","observedExitReason",
      "observedGrossProfitReturn30Pct","dualMarketSignedScore"):
     expect(first[field]==second[field],"OR_SAME_HOUR_NATIVE_RESULT_DIFFERENT:"+field+":"+str(ts))
   for mode in SOURCES_MODES:
    entryHours=(originalEventsBySource[AST] if mode=="ASTER_ONLY" else
                originalEventsBySource[BIN] if mode=="BINANCE_ONLY" else
                ab if mode=="BOTH_REQUIRED" else ar)
    chosen=[];noFill=[];skippedMarket=[];selectedByTrigger={"ASTER_ONLY":0,"BINANCE_ONLY":0,"BOTH_AGREE":0}
    for ts in sorted(entryHours):
     x=bySource[AST].get(ts) if ts in originalEventsBySource[AST] else bySource[BIN].get(ts)
     if x is None:
      skippedMarket.append(ts)
      continue
     category="BOTH_AGREE" if ts in ab else "ASTER_ONLY" if ts in originalEventsBySource[AST] else "BINANCE_ONLY"
     assert x["gross"] in (.5,.75,1.)
     if x["status"]!="PRICE_PROXY_CLOSED" or x["ambiguousEntryAndExitWithinSameM5"]:
      noFill.append({"ts":ts,"reason":x["status"],"category":category})
      continue
     order=event_as_order(x)
     order["key"]=category+"|"+str(ts)  # identical across venue modes, easy parity.
     order["triggerCategory"]=category
     chosen.append(order);selectedByTrigger[category]+=1
    expect(len(chosen)+len(noFill)+len(skippedMarket)==len(entryHours),"SOURCE_CANDIDATE_COLLISION")
    expect(len(chosen)==len({z["originalNativeSignalTs"] for z in chosen}),"DOUBLE_ORDER_SAME_SIGNAL")
    expect(all(z["grossAllocation"]>=.5 for z in chosen),"GROSS_BELOW_HALF")
    meta={"signalMode":mode,"riskSizing":size,"delayMin":delay,
       "originalDistinctNativeSignalHours":len(entryHours),
       "bothSourceSameHourIntents":len(ab),
       "duplicateIntentsRemovedForOR":27 if mode=="EITHER_OR_SINGLE_ASTER_ORDER" else 0,
       "marketScoreSkipped":len(skippedMarket),"noM5PrintOrCensored":len(noFill),
       "AsterSourceNativeM5EntryModels":len(chosen),"acceptedSignalBreakdown":selectedByTrigger,
       "sourceV20SignatureSHA":"1657e173d250ad58f53e62f7bb0a3428fb405496",
       "signedVENUEOrders":False,"noGross0p25":True}
    controls.append(meta)
    for fee,slip in COSTS:
     x=replay(chosen,m5,fee,slip)
     selected=x["capitalTradeLedger"]
     keys=set(x["singleSlotNativeSourceKeys"])
     selectedBreakdown=Counter(k.split("|")[0] for k in keys)
     assert sum(selectedBreakdown.values())==len(keys)==x["closed"]
     # A single-source candidate fires only once even if two providers independently signal.
     assert len(keys)==len(selected)
     scenario.append({**meta,"feeBps":fee,"extraCoverBps":slip,
       "economic":{k:v for k,v in x.items() if k!="capitalTradeLedger"},
       "singleSlotSelectedTriggerCategory":dict(selectedBreakdown),
       "singleSlotLedgerNormal30bps":selected if fee==30 and slip==0 else None})
    decisionLedger.append({"mode":mode,"risk":size,"delayMin":delay,
     "sourceIntents":len(entryHours),
     "originalHourDecisionTrace":[{"hourTs":ts,"entryUTC":utc(ts),
        "AsterNativeTriggered":ts in originalEventsBySource[AST],
        "BinanceNativeTriggered":ts in originalEventsBySource[BIN],
        "sourcePriority":"ASTER" if ts in originalEventsBySource[AST] else "BINANCE",
        "sourceStatus":bySource[AST].get(ts,bySource[BIN].get(ts,{})).get("status","RISK_VETO"),
        "gross":bySource[AST].get(ts,bySource[BIN].get(ts,{})).get("gross",0)}
       for ts in sorted(entryHours)]})
 assert len(scenario)==len(SIZES)*len(DELAYS)*len(SOURCES_MODES)*len(COSTS)==72
 # Independent source P81 parity with the exact same Aster/Bin single-stream
 for mode,source in (("ASTER_ONLY",AST),("BINANCE_ONLY",BIN)):
  for size in SIZES:
   for delay in DELAYS:
    for fee,slip in COSTS:
     s=next(z for z in scenario if z["signalMode"]==mode and z["riskSizing"]==size and
      z["delayMin"]==delay and z["feeBps"]==fee and z["extraCoverBps"]==slip)
     o=next(z for z in p81["all36PriceScenarioAndPositionResults"] if
       z["source"]==source and z["riskSize"]==size and z["requestDelayMinutes"]==delay and
       z["feeBps"]==fee and z["extraBuyCoverBps"]==slip)
     for k in ("closed","wins","finalNAVYen","M5HighStressDDPct"):
      expect(abs(s["economic"][k]-o["economic"][k])<.001,
       "P83_OR_PARITY_CONTROL_P81_FAILED:"+mode+":"+size+":"+str(delay)+":"+k)
     expect(s["economic"]["singleSlotNativeSourceKeys"]==[
       ("BOTH_AGREE" if x["entryTs"]-x["entryTs"]==0 and
         int(x["key"].split("|")[-1]) in ab else
        "ASTER_ONLY" if mode=="ASTER_ONLY" else "BINANCE_ONLY")+"|"+str(int(x["key"].split("|")[-1]))
       for x in o["selectedTradeLedger30bps"]]
       if fee==30 and slip==0 else True,"SIGNAL_SELECTION_SOURCE_PARITY_BAD")
 # Summaries in same M5 STOP model
 normal=[z for z in scenario if z["feeBps"]==30 and z["extraCoverBps"]==0]
 compact=[]
 for z in normal:
  stress=next(u for u in scenario if u["signalMode"]==z["signalMode"] and
    u["riskSizing"]==z["riskSizing"] and u["delayMin"]==z["delayMin"] and
    u["feeBps"]==30 and u["extraCoverBps"]==100)
  ee=z["economic"];ss=stress["economic"]
  compact.append({"signalMode":z["signalMode"],"riskSizing":z["riskSizing"],
   "delayMin":z["delayMin"],"naturalDistinctSourceSignalHours":z["originalDistinctNativeSignalHours"],
   "grossVetoes":z["marketScoreSkipped"],"m5Unfilled":z["noM5PrintOrCensored"],
   "m5Eligible":z["AsterSourceNativeM5EntryModels"],
   "selected":ee["closed"],"wins":ee["wins"],"winPct":ee["winPct"],
   "M5HighDDPct":ee["M5HighStressDDPct"],"NAVJPY":ee["finalNAVYen"],
   "M5HighDDExtra100bpsPct":ss["M5HighStressDDPct"],
   "NAVExtra100bpsJPY":ss["finalNAVYen"],
   "selectedByTrigger":z["singleSlotSelectedTriggerCategory"],
   "selectedKeys":ee["singleSlotNativeSourceKeys"]})
 assert len(compact)==4*2*3
 selectedComparison={}
 for delay in DELAYS:
  same=[z for z in compact if z["delayMin"]==delay and z["riskSizing"]=="P73_CONDITIONAL_HALF_OR_SKIP"]
  m={z["signalMode"]:z for z in same}
  for base in ("ASTER_ONLY","BINANCE_ONLY"):
   selectedComparison[str(delay)+"min_OR_minus_"+base]={
    "netNAVDeltaYen":round(m["EITHER_OR_SINGLE_ASTER_ORDER"]["NAVJPY"]-m[base]["NAVJPY"],2),
    "NAVExtra100DeltaYen":round(m["EITHER_OR_SINGLE_ASTER_ORDER"]["NAVExtra100bpsJPY"]-m[base]["NAVExtra100bpsJPY"],2),
    "M5HighDDDeltaPct":round(m["EITHER_OR_SINGLE_ASTER_ORDER"]["M5HighDDPct"]-m[base]["M5HighDDPct"],6),
    "M5HighDDExtra100DeltaPct":round(m["EITHER_OR_SINGLE_ASTER_ORDER"]["M5HighDDExtra100bpsPct"]-m[base]["M5HighDDExtra100bpsPct"],6),
    "tradeCountDelta":m["EITHER_OR_SINGLE_ASTER_ORDER"]["selected"]-m[base]["selected"]}
 out={
  "schema":"prism7-p83-owner-selected-either-aster-or-binance-native-signal-one-aster-order-with-M5-native-stops/v1",
  "researchStatus":"OWNER_CHOSE_OR_ENTRY__M5_DELAY_NATIVE_SOURCE_ACCOUNT_BT_DONE_NOT_LIVE",
  "riskSizingOwnerPreference":"0.75 normal / 0.5 if macro strong bull but PENGU weak confirmed on both / skip otherwise. Never 0.25.",
  "sameHourDoubleSignalOneOrderAlways":True,
  "ASTERNative53PlusBinanceNative57Minus27DuplicatesIs83UniqueHours":True,
  "ASTEROriginalNativeSource53ParityPassedInP78":True,
  "P81IndependentAsterOnlyBinanceOnlyEconomyParityAll36":True,
  "M5NativeExitRepricedGrossAndTransportDelay":[0,5,15],
  "P73Gross0p25NotPermitted":True,
  "actualSignedOrdersCreated":False,
  "sourcePinnedV20SHA":"1657e173d250ad58f53e62f7bb0a3428fb405496",
  "sourceSignalSets":{"ASTER":53,"BinanceWithinAsterWindow":57,"bothExactHour":27,
    "distinctOR":83,"AST_only":26,"Binance_only":30},
  "all72EconPriceFeeAndCoverStressScenarios":scenario,
  "all24Normal30bpsAnd100CoverStress":compact,
  "ownerPolicyORRelativeVsAsterBinAlone":selectedComparison,
  "allInputSignalSingleGrossAudit":controls,
  "sourceSHA256":{"P80":sha(P80),"P81":sha(P81),"P79":sha(P79),"AsterM5":m5sha},
  "limitations":[
    "AST and Binance H1 native original signal source distinct, 27 same UTC hours deduplicated, not two orders; entry overlap within +/- hours that is not exact same event still handled by one-slot capital simulator.",
    "ASTER M5 first positive-volume entry after 0/5/15m is NOT signed venue bid/ask fill, does not model orderbook, same-bar intrabar priority, network jitter, partial fills or 2 order cancel-replace atomicity.",
    "P80 source P14 native STOP and V20 exit recomputed after each M5 entry price and gross tier. STOP exact execution not verified at venue; additional +100bps applied to buy cover.",
    "Original Aster period 2025Aug–2026Nov repeatedly studied, no genuinely unseen out-of-sample; candidate OR hypothesis result may be selection-biased.",
    "Includes original source signal vetoed without 0.5 permission; 0.25 forbidden; uses only one PENGU short 1-slot at once; cross-runner Shared Risk and Gross not modeled.",
    "P73 one time-frame score same UTC and multi-venue trend features precomputed from closed candles. No real same-second Binance trigger to Aster order transmission proven.",
    "Fundings, spread, borrow, actual PENGU exchange fees, STOP signed fill and other active Runner risk absent.",
    "No LIVE, Runner, Gross, STOP, orders, account, positions, GitHub master changes."
  ]}
 OUT.write_text(json.dumps(out,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 TRACE.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in decisionLedger),encoding="utf8")
 lines=["# P83 — ASTER OR Binance: どちらかのNative V20発火でASTERに1件だけ注文（研究BT）",
  "",
  "**Owner-selected**: ② OR方式。ASTER自身のV20 53候補とBinance V20発火→ASTER注文57候補を統合、同時刻両市場発火27件は必ず1件へ名寄せし、ユニーク候補83件。ASTER同一銘柄で建玉枠1。実注文は0件。",
  "",
  "P78のASTER元Native入口と出口53件完全一致を前提。P80/P81の元STOP/出口をM5正の出来高時点で再計算し、入口0/5/15分遅延、10/30bps＋出口100bps不利ストレスも同一方式で対照。0.25倍を使用しない。原則0.75倍、BTC/ETH強い上昇相場中はPENGU相対的弱さを双方確認できれば0.5倍、無ければ見送り。",
  "",
  "| V20発火条件（ASTER執行） | ロット | 遅延 | 最終選択／勝ち | 最大M5 DD | 1万円最終 | +100bps DD | +100bps 最終 |",
  "|---|---|---:|---:|---:|---:|---:|---:|"]
 for z in compact:
  lines.append("| "+z["signalMode"]+" | "+z["riskSizing"]+" | "+str(z["delayMin"])+
   "分 | "+str(z["selected"])+"/"+str(z["wins"])+
   " | "+str(z["M5HighDDPct"])+"% | "+str(z["NAVJPY"])+
   " | "+str(z["M5HighDDExtra100bpsPct"])+"% | "+str(z["NAVExtra100bpsJPY"])+" |")
 lines+=["","OR対ASTER単独／Binance単独の条件付き0.5倍方式の差分："+json.dumps(selectedComparison,ensure_ascii=False),
  "",
  "**条件変更の注意**：ASTERが先に発火した取引を保有している間、後のBinance発火は増し玉しない（同一建玉枠により拒否）。逆も同じ。両市場で同時発火しても単一注文。STOPはASTERのNative出口。",
  "",
  "本番採用不可：元研究期間の再使用、板・通信遅延・成行スプレッド・Funding・署名付きSTOP履歴・他Runnerと共有するGross/口座DDが不足。研究ブランチだけに証跡保管。",
  ""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P83_OWNER_OR_AST_OR_BIN_NATIVE_SOURCE_ONE_ASTER_ORDER_M5_0_5_15M_DEDUP_PASS",
  json.dumps({"owner":"OR","distinctOriginalIntents":83,"dedupedSameHour":27,
   "costScenarios":len(scenario),"normal": [z for z in compact if z["riskSizing"]=="P73_CONDITIONAL_HALF_OR_SKIP"],
   "ownerORRelative":selectedComparison},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD,TRACE)
if __name__=="__main__":main()
