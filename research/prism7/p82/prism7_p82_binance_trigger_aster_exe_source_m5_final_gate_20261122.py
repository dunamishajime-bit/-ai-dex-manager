#!/usr/bin/env python3
"""P82 final verify Binance Native V20 H1 trigger -> ASTER execution,
including pure H1 source exit parity and ASTER M5 positivity / delay proxy,
then risk and concentration. Research-only; never promote LIVE from prior
inspected 2025-2026 data.
"""
from __future__ import annotations
from pathlib import Path
import json,hashlib,datetime,math,collections
from collections import Counter,defaultdict
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R
P78=R/"PRISM7_P78_BINANCE_NATIVE_ENTRY_EXECUTE_ASTER_PINNED_NATIVE_EXIT_20261122.json"
P79=R/"PRISM7_P79_BINANCE_SIGNAL_ASTER_EXECUTION_VS_ASTER_ONLY_OR_BOTH_20261122.json"
P80=R/"PRISM7_P80_M5_DELAY_0_5_15_REPRICED_AST_BIN_NATIVE_STOP_20261122.json"
P81=R/"PRISM7_P81_BINANCE_SIGNAL_ASTER_M5_REPRICE_0_5_15_MIN_NATIVE_STOP_ECONOMIC_20261122.json"
P73=R/"PRISM7_P73_NO_GROSS025_V20_SIGNED_AST_BIN_RISK_REJECT_VS_HALF_20261122.json"
OUT=R/"PRISM7_P82_BINANCE_SIGNAL_EXEC_ASTER_PIN_NATIVE_M5_STRESS_FINAL_GATE_20261122.json"
MD=R/"PRISM7_P82_BINANCE_SIGNAL_EXEC_ASTER_PIN_NATIVE_M5_STRESS_FINAL_GATE_20261122.md"
PEN="ASTER_NATIVE_SOURCE";BIN="BINANCE_NATIVE_SOURCE_EXECUTE_ASTER"
SIZING="P73_CONDITIONAL_HALF_OR_SKIP"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def metric(seq,field,value):return next(z for z in seq if z[field]==value)
def factor(rows):
 v=1.
 for z in rows:v*=1+z["equityRetPct"]/100
 return v
def season(t):
 dt=datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc)
 return "PRE_2025_AUG_SEP" if dt.year==2025 and dt.month<=9 else "POST_2026_OCT_NOV" if dt.year==2026 and dt.month>=10 else "BASE_2025_2026"
def main():
 p78=json.loads(P78.read_text(encoding="utf8"))
 p79=json.loads(P79.read_text(encoding="utf8"))
 p80=json.loads(P80.read_text(encoding="utf8"))
 p81=json.loads(P81.read_text(encoding="utf8"))
 p73=json.loads(P73.read_text(encoding="utf8"))
 assert p78["originalAsterNative53Parity"]=="PASS_53_OF_53" and p78["sourceBinancePriceIsNeverAsterEntryOrExitFill"]
 assert p79["originalASTER53NativeReplayParityAll"] and p79["BinanceNativeButASTERNoNativeSignal30"]
 assert p80["sourceOriginalASTER53AndBinanceASTExecution57"] and p80["noGross0p25"]
 assert p81["excludedGross0p25"] and p73["gross025ExcludedByOwnerRequest"]
 assert len(p80["allModeledGrossAndDelayM5Events"])==618
 assert len(p81["comparison30bpsNormalPlus100bpsStress"])==12
 modes=p81["comparison30bpsNormalPlus100bpsStress"]
 combos=[]
 for delay in (0,5,15):
  a=next(z for z in modes if z["source"]==PEN and z["riskSize"]==SIZING and z["requestDelayMinutes"]==delay)
  b=next(z for z in modes if z["source"]==BIN and z["riskSize"]==SIZING and z["requestDelayMinutes"]==delay)
  assert b["plus100CoverDDPct"]<20,delay
  assert b["finalNAVJPY"]>a["finalNAVJPY"],delay
  assert b["plus100CoverNAVJPY"]>a["plus100CoverNAVJPY"],delay
  combos.append({"sourceM5EntryDelayMin":delay,
   "ASTERnative":{"closed":a["singleSlotClosed"],"wins":a["wins"],"NAVJPY":a["finalNAVJPY"],
    "M5HighDDPct":a["maxM5HighDDPct"],"M5DDPlus100bps":a["plus100CoverDDPct"],
    "NAVPlus100bps":a["plus100CoverNAVJPY"],"noPositiveM5Print":a["m5NoPrint"]},
   "BINANCEtriggerASTERexecute":{"closed":b["singleSlotClosed"],"wins":b["wins"],
    "NAVJPY":b["finalNAVJPY"],"M5HighDDPct":b["maxM5HighDDPct"],
    "M5DDPlus100bps":b["plus100CoverDDPct"],"NAVPlus100bps":b["plus100CoverNAVJPY"],
    "noPositiveM5Print":b["m5NoPrint"]},
   "baseNAVImprovementJPY":round(b["finalNAVJPY"]-a["finalNAVJPY"],2),
   "with100bpsCoverImprovementJPY":round(b["plus100CoverNAVJPY"]-a["plus100CoverNAVJPY"],2)})
 # One slot trade ledger time season attribution, top winner stress same 5m model
 ledger={}
 for source in (PEN,BIN):
  result=next(z for z in p81["all36PriceScenarioAndPositionResults"] if
      z["source"]==source and z["riskSize"]==SIZING and
      z["requestDelayMinutes"]==5 and z["feeBps"]==30 and z["extraBuyCoverBps"]==0)
  selected=result["selectedTradeLedger30bps"]
  top=sorted((z for z in selected if z["equityRetPct"]>0),key=lambda z:z["equityRetPct"],reverse=True)
  assert top
  seasonStats={}
  for name in ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV"):
   subset=[z for z in selected if season(z["entryTs"])==name]
   seasonStats[name]={"closed":len(subset),"wins":sum(z["resultWin"] for z in subset),
     "grossFactor":round(factor(subset),6),
     "cumulative30bpsGrossWeightedEquityRetPct":round(100*(factor(subset)-1),6)}
  removeTop=[z for z in selected if z["key"]!=top[0]["key"]]
  removeTop2=[z for z in selected if z["key"] not in {top[0]["key"],top[1]["key"]}]
  ledger[source]={"selected":len(selected),"wins":sum(z["resultWin"] for z in selected),
   "actual30bpsNAV":round(10000*factor(selected),2),
   "highestWinnerSourceKey":top[0]["key"],
   "highestWinnerWeightedEquityRetPct":top[0]["equityRetPct"],
   "nonReAdmissionFixedSelectedNAVIfHighestWinnerRemoved":round(10000*factor(removeTop),2),
   "nonReAdmissionFixedSelectedNAVIfHighestTwoWinnersRemoved":round(10000*factor(removeTop2),2),
   "cohortCompoundedNAVFactors":seasonStats,
   "lossMagnitudeTop5":[{"key":z["key"],"equityRetPct":z["equityRetPct"]}
       for z in sorted((w for w in selected if w["equityRetPct"]<0),key=lambda w:w["equityRetPct"])[:5]],
   "largestWinners":[{"key":z["key"],"equityRetPct":z["equityRetPct"]} for z in top[:5]]}
 assert abs(ledger[PEN]["actual30bpsNAV"]-combos[1]["ASTERnative"]["NAVJPY"])<.05
 assert abs(ledger[BIN]["actual30bpsNAV"]-combos[1]["BINANCEtriggerASTERexecute"]["NAVJPY"])<.05
 # H1 original pure price model comparison
 h1=[]
 for label in ("ASTER_NATIVE_SOURCE_ONLY","BINANCE_TRIGGER_ASTER_EXECUTION","ASTER_AND_BINANCE_SIMULTANEOUS_SIGNAL"):
  z=next(x for x in p79["normal30bpsVs100bpsCoverStress"] if x["source"]==label and x["riskSize"]==SIZING)
  h1.append({"signalToAsterSourceModel":label,"oneSlot":z["selected"],"wins":z["wins"],
    "H1SourceNativeExitNAVJPY":z["finalNavJPY"],"M5DDPct":z["M5HighDD"],
    "DDPlus100bps":z["M5HighDDPlus100Cover"],"NAVPlus100bps":z["finalNavJPYPlus100Cover"]})
 scoped=p78["scopedSignalReplayedWinStats"]
 assert scoped["ALL"]["count"]==57 and scoped["SHARED_HOUR"]["count"]==27 and scoped["BINANCE_ONLY_TRIGGER"]["count"]==30
 assert scoped["BINANCE_ONLY_TRIGGER"]["asterPriceSourceWins"]==17
 report={
  "schema":"prism7-p82-owner-proposed-binance-native-signal-aster-exec-tested-source53-parity-M5-native0-5-15-latency-v1",
  "status":"PROMISING_RESEARCH_BUT_NO_ACTUAL_FILL_OR_FRESH_ASTER_OOS_DO_NOT_DEPLOY",
  "sourceOriginalNativeSHA":"1657e173d250ad58f53e62f7bb0a3428fb405496",
  "originalASTER53PinEntryAndExitParityPASS":True,
  "sourceAsterOriginalNative53TriggerCount":53,
  "sourceBinanceNativeTriggeredASTERcounterfactual57":True,
  "sourceSameOriginalHour27":True,
  "sourceBinanceOnly30WinsAsterNativeExit17":True,
  "BinanceOriginalNative_EXIT_PriceNotUsedToCloseAster":True,
  "riskPolicy":"V20 native entry either ASTER or Binance; 0.5 if only exceptional macro bull and both PENGU weaker, skip if bull without that validation; else 0.75. No 0.25.",
  "lowGross0p25Prohibited":True,
  "M5Delay0_5_15GoodUnderBothNormalAnd100bpsStress":True,
  "eventTimeGrossPolicySourceM5DelayComparisons":combos,
  "originalH1PurePinComparison30bps":h1,
  "fiveMinuteLatencyCompoundedCohortAndWinnerConcentration":ledger,
  "fullP81All36ScenariosConsistent":True,
  "normalFeeBps":30,"extraBuyCoverSlippageBps":100,
  "newAsterIndependentUnseenHoldout":False,"asterSignedVenueOrdersAndSTOPS":False,
  "productionMasterRunnerRiskGrossStopOrdersChanged":False,
  "sourceSHA256":{"P73":sha(P73),"P78":sha(P78),"P79":sha(P79),"P80":sha(P80),"P81":sha(P81)},
  "limitations":[
   "Input Aster Native53 and cross-market period 2025Aug-2026Nov are repeatedly inspected, so this is not untouched out-of-sample despite source parity and 5m positive M5 print.",
   "Native quote window PENGU/BTC from Aster and Binance has highly correlated price moves and H1 candle provider divergence, no independent PnL replication of actual signed orders.",
   "5m bar OPEN is not proved executable after Binance H1 close; intra-M5 latency, spread, maker/taker, market impact, funding, network jitter and real STOP orders remain unknown.",
   "Native H1 exit source P78 and repriced M5 exit source P80/P81 are different order-price models: their DD levels should be compared only within respective model; P80 recalculates stop and V20 state.",
   "Cross-runner portfolio gross and shared DD are not in isolated one-slot results; an isolated strategy DD under20 does not guarantee live account DD under20.",
   "Gross1 not approved by research. 0.25 explicitly prohibited; 0.5 accepted only for as-of high-confidence weakness, otherwise reject.",
   "Leave-one-or-two-winner-out does not re-admit new trades after removed entry; it illustrates concentration, not a new strategy backtest.",
   "No live implementation, owner authentication, production, Runner, STOP, order, position, kill switch or master changes."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 lines=["# P82 | BinanceでV20発火 → ASTERで注文・Native出口／STOPを再計算",
  "",
  "**研究結論：Binanceのエントリー信号をASTERで執行すると、この過去期間の仮想BTでは利益・DDを同時改善。0.25倍は採用しない。だが本番採用は未承認・未検証。**",
  "",
  "P78でASTER元V20の53件についてNative入口・出口パリティを全件確認。Binance元V20の信号を同期間に独立に生成すると57件がASTER元53件の最初〜最後の日時範囲に入り、同時刻に両方が発火したのは27件、Binanceのみが発火した30件ではASTERで元Native決済により17勝。",
  "",
  "ASTER PENGU現物（研究価格）H1始値による遅延なしの価格モデルでは、ASTER自身のシグナルから条件付き0.5倍/見送りは30件18勝・NAV15,684円・DD15.49%、BinanceシグナルをASTERで執行すると29件18勝・NAV17,986円・DD12.98%。",
  "",
  "## P80/P81 ASTER M5出来高始値 + 5m/15m遅延 + 元V20の住み付きSTOP再計算（別価格モデル）",
  "| 発火市場 | エントリー遅延 | 30bps勝ち/決済 | M5最大DD | 10,000円最終 | +100bpsカバーDD | +100bpsカバー最終 |",
  "|---|---:|---:|---:|---:|---:|---:|"]
 for pair in combos:
  for source,key in (("ASTER","ASTERnative"),("Binance","BINANCEtriggerASTERexecute")):
   e=pair[key]
   lines.append("| "+source+" → ASTER | "+str(pair["sourceM5EntryDelayMin"])+"分 | "+
    str(e["wins"])+"/"+str(e["closed"])+
    " | "+str(e["M5HighDDPct"])+"% | "+str(e["NAVJPY"])+
    " | "+str(e["M5DDPlus100bps"])+"% | "+str(e["NAVPlus100bps"])+" |")
 lines+=["","**5分遅延・同一価格モデル**でBinance発火ASTER注文はNAV16,941円（従来ASTER発火15,668円）、DD13.02%（従来17.47%）、さらに100bps追加でDD14.32%。現実の約定保証ではない。",
  "",
  "## 期間分解（5分遅延・30bps・Native STOP M5モデル）",
  "| 期間 | ASTER発火・複利係数 | Binance発火・複利係数 |",
  "|---|---:|---:|"]
 for period in ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV"):
  x=ledger[PEN]["cohortCompoundedNAVFactors"][period]
  y=ledger[BIN]["cohortCompoundedNAVFactors"][period]
  lines.append("| "+period+" | "+str(x["grossFactor"])+" ("+str(x["wins"])+"/"+str(x["closed"])+
   ") | "+str(y["grossFactor"])+" ("+str(y["wins"])+"/"+str(y["closed"])+") |")
 lines+=["",
  "5分遅延の最大勝ち1件を除外し、後続取引を再受入れしない感度分析では、ASTERのNAVは"+
   str(ledger[PEN]["nonReAdmissionFixedSelectedNAVIfHighestWinnerRemoved"])+"円、Binance発火は"+
   str(ledger[BIN]["nonReAdmissionFixedSelectedNAVIfHighestWinnerRemoved"])+"円。"
  "",
  "**残る重要な検証:** Binanceで1H確定からASTER注文までの秒単位遅延・板とスプレッド、Native STOPの真正なM5高値約定、実Funding、各Runner共有Grossと口座全体DD、独立の未研究ASTERデータ。真の本番承認ではなく次の研究候補として保留。",
  "","Production、LIVE、Runner、Gross、STOP、Kill Switch、注文、建玉は変更なし。",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P82_BINANCE_SIGNAL_ASTER_EXECUTION_SOURCE53_NATIVE_PARITY_M5_0_5_15_LATENCY_DD20_PASS_RESEARCH_ONLY",
  json.dumps({"normalM5DelayStress":combos,
   "source0DelayBaseAndCandidate":h1,
   "sourceTopWinPct":{k:v["highestWinnerWeightedEquityRetPct"] for k,v in ledger.items()},
   "sourceSeasonFactors":{k:v["cohortCompoundedNAVFactors"] for k,v in ledger.items()}},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD)
if __name__=="__main__":main()
