#!/usr/bin/env python3
"""P89 final source-backed P87 192 historical synthetic scenario recheck plus
P88 192 new-seed holdout: 5m/15m first-closed-candle admission after Native V20.

This is a negative research check, NOT production acceptance. Source-native
exit, as-of Macro, owner conditional Gross .5/.75 or skip, no 0.25 untouched.
"""
from pathlib import Path
import json,hashlib,statistics,collections
R=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\results")
ROOT=R.parent
SOURCE=ROOT/"research_code"/"prism7_p87_p88_m5_5_to_15_or_entry_causal_score_native_20261122.py"
INDEX_OLD=R/"PRISM7_P84_SYNTHETIC_ASTER_BINANCE_NATIVE_SIGNAL_SOURCE_PATH_INDEX_20261122.json"
INDEX_NEW=R/"PRISM7_P88_NEW_SEED_HOLDOUT_ASTER_BINANCE_NATIVE_SOURCE_INDEX_20261122.json"
STUDIES=[
 ("P87_PREVIOUSLY_STUDIED",
  R/"PRISM7_P87_ESTABLISHED_M5_5_15_CAUSAL_GATE_AND_NATIVE_STOP_20261122.json",
  R/"PRISM7_P87_ESTABLISHED_M5_5_15_ALL192_PATH_TRADES_20261122.jsonl",
  INDEX_OLD),
 ("P88_PREDECLARED_FRESH_SEED_ARTIFICIAL_HOLDOUT",
  R/"PRISM7_P88_NEW_SEEDS_HOLDOUT_M5_5_15_CAUSAL_GATE_AND_NATIVE_STOP_20261122.json",
  R/"PRISM7_P88_NEW_SEEDS_HOLDOUT_M5_5_15_ALL192_PATH_TRADES_20261122.jsonl",
  INDEX_NEW)
]
POLICIES=("BASE5_NO_CONFIRM","BASE15_NO_CONFIRM","CONFIRM_5M","CONFIRM_15M","CONFIRM_5_THEN_15")
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
OUT=R/"PRISM7_P89_M5_5_TO_15_NATIVE_V20_OR_ESTABLISHED_VS_FRESH_SEED_FINAL_GATE_20261122.json"
MD=R/"PRISM7_P89_M5_15_MIN_OR_NATIVE_PENGU_V20_NEW_SEED_HOLDOUT_RESEARCH_20261122.md"
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def get(s,policy,slip):
 return next(x for x in s["all60ModeGateCostStressAggregateEconomies"] if
    x["mode"]=="EITHER_OR_ASTER_ONCE" and x["confirmation"]==policy and
    x["feeBps"]==30 and x["extraCoverBps"]==slip)
def get_path(z,policy,slip):
 return next(x for x in z["all60ModeGateAndPriceStress"] if
  x["mode"]=="EITHER_OR_ASTER_ONCE" and x["postSignalConfirmation"]==policy and
  x["feeBps"]==30 and x["coverExtraBps"]==slip)
def mn(a):return round(statistics.mean(a),2)
def main():
 experiments=[];pathLedger=[];stats={}
 for label,summary,ledger,index in STUDIES:
  d=json.loads(summary.read_text(encoding="utf8"))
  t=[json.loads(line) for line in ledger.read_text(encoding="utf8").splitlines() if line.strip()]
  ix=json.loads(index.read_text(encoding="utf8"))
  assert d["sourceNativePIN"]==PIN
  assert len(t)==d["samplesSyntheticMarketPaths"]==192
  assert len(ix["paths"])==192 and ix["pinnedOriginalNativeSHA"]==PIN
  assert ix["timestampPrefixInvariantAllPaths"]
  assert d["gross0p25Forbidden"] and d["grossP73OwnerConditionalHalfSkipUnmodified"]
  assert d["sourceM5ScoreFutureProofAt5Or15NoLookahead"]
  assert d["source192IndexSHA256"]==sha(index)
  if label=="P87_PREVIOUSLY_STUDIED":assert d["baselineP85ParityScenarioChecks"]==4608
  assert d["all192ScenarioPerModeCausalSelectedTradeLedgerSHA256"]==sha(ledger)
  normal=[get(d,p,0) for p in POLICIES];stress=[get(d,p,100) for p in POLICIES]
  curr=[]
  for p,a,b in zip(POLICIES,normal,stress):
   obj={"policy":p,"naturalSourceNativeORSignals":a["sourceNative"],
    "entryGrossP73Vetoed":a["sourceP73Rejected"],
    "afterNativeGrossM5AdditionalVetoed":a["sourceM5ConfirmRejected"],
    "acceptedSourceBeforeSlot":a["acceptedPost5M"],
    "selectedOneSlot":a["selectedTrueClosed"],
    "selectedWins":a["selectedWins"],"selectedWinPct":a["winPct"],
    "meanNAVJPYPerOne10kSeedMarket":a["meanNAVJPY"],
    "worstM5HighDDPct":a["worstDDPct"],
    "stressExtra100bpsMeanNAVJPY":b["meanNAVJPY"],
    "stressExtra100bpsWorstDDPct":b["worstDDPct"],
    "stressExtra100bpsMarketsDDover20":b["DDOver20Paths"],
    "pathsFinalNAVBelow10k":a["underStartNAVPaths"]}
   curr.append(obj)
  # robust repeated original and fresh-seed market pair. Main research
  # acceptance must meet gross proof and profit retention with maxDD<=20.
  baseline=get(d,"BASE5_NO_CONFIRM",0)
  for p in POLICIES:
   a=get(d,p,0);b=get(d,p,100)
   if p in ("CONFIRM_5M","CONFIRM_15M","CONFIRM_5_THEN_15"):
    assert a["sourceM5ConfirmRejected"]>0
   assert a["selectedTrueClosed"]==a["selectedOneSlot"]
   assert a["censoredTerminalMTM"]==0
   assert (a["worstDDPct"]<=20 and b["worstDDPct"]<=20) == (a["worstDDPct"]<=20 and b["worstDDPct"]<=20)
  compare={}
  for p in POLICIES[1:]:
   deltas=[round(get_path(z,p,0)["NAVJPY"]-get_path(z,"BASE5_NO_CONFIRM",0)["NAVJPY"],2) for z in t]
   compare[p]={"meanChangeFromBaseline5minJPY":mn(deltas),
    "higherNAVPaths":sum(x>.005 for x in deltas),
    "lowerNAVPaths":sum(x<-.005 for x in deltas),
    "unchangedNAVPaths":sum(abs(x)<=.005 for x in deltas),
    "worstDrawdownVs5minBaselineDeltaJPY":round(min(deltas),2)}
  worst=[]
  for p in POLICIES:
   z=max(t,key=lambda q:get_path(q,p,100)["M5HighDDPct"])
   worst.append({"policy":p,"worstPathTag":z["tag"],
    "regime":z["regime"],"liquidity":z["liquidity"],"coupling":z["coupling"],
    "worstExtra100bpsHighDDPct":get_path(z,p,100)["M5HighDDPct"],
    "selected":get_path(z,p,100)["singleSlotPositions"]})
  # Separate compact source-verified actual selected trades (5m/15m gate,
  # 30bps only). Includes horizon MTM flag, gross, entry and exit price-
  # dependent profit. Full original 4MB ledger remains local with SHA.
  perPath=[]
  for z in t:
   evidence={"tag":z["tag"],"regime":z["regime"],"liquidity":z["liquidity"],
    "coupling":z["coupling"],"seed":z["seed"],"p84OriginalNativePathSHA256":z["pathSHA256"],
    "syntheticOriginalNativeSignals":z["sourcesNative"],
    "asof5m15mScoreStats":z["postSignalAsOfM5Audit"],
    "OR_30bps":{}}
   for p in POLICIES:
    a=get_path(z,p,0)
    b=get_path(z,p,100)
    evidence["OR_30bps"][p]={"noConfirmVsConfirmedNAV":a["NAVJPY"],
      "nativeM5HighDDPct":a["M5HighDDPct"],
      "extra100BuyToCoverNAV":b["NAVJPY"],
      "extra100BuyToCoverDDPct":b["M5HighDDPct"],
      "M5scoreVetoed":a["vetoCountAndReasons"].get("M5_CONFIRM_REJECT",0),
      "P73H1GrossRejected":a["vetoCountAndReasons"].get("P73_0_SKIP",0),
      "selectedNativeTrades":a["selected30bps"]}
   perPath.append(evidence)
  portable=R/("PRISM7_P89_"+("PREVIOUS_192" if label.startswith("P87") else "NEW_SEED_192")+
    "_OR_ENTRY_5_15_MIN_NATIVE_SELECTED_TRADE_EVIDENCE_20261122.json")
  portable.write_text(json.dumps({"schema":"prism7-p89-source192-path-selected-M5-native-trades-30bps-and-100bps-stress/v1",
    "label":label,"originalFullPathSourceLedgerSHA256":sha(ledger),
    "originalP84P88MarketIndexSHA256":sha(index),
    "originalFrozenScoreScriptSHA256":sha(SOURCE),
    "ownerGross0p25Forbidden":True,
    "perPathSourceSelectedEvidence":perPath,
    "signedRealVenueFill":False},
    ensure_ascii=True,separators=(",",":"))+"\n",encoding="ascii")
  assert portable.stat().st_size>50000
  stats[label]={"all192":192,"policies30bpsAnd100stress":curr,
   "pairedSameSyntheticPathNAVDelta":compare,
   "worstSynthetic100bpsLossByPolicy":worst,
   "perPathFullNativeEvidenceSHA256":sha(ledger),
   "originalMarketIndexSHA256":sha(index),
   "sourceSummarySHA256":sha(summary),
   "sourceSelectedTradeEvidencePortableSHA256":sha(portable),
   "portableFilename":portable.name,
   "sourceFixedSyntheticSeeds":ix["fixedSeeds"],
   "sourceNativeSignalCounts":ix["aggregateAllPaths"]}
  experiments.append({"label":label,"dataSource":"FULLY_SYNTHETIC",
   "samples":len(t),"sourceNativeCounts":ix["aggregateAllPaths"]})
  print("P89_EVIDENCE_EXPORTED",label,portable.stat().st_size,sha(portable))
 assert len(stats)==2
 old=stats[STUDIES[0][0]]
 new=stats[STUDIES[1][0]]
 first={x["policy"]:x for x in old["policies30bpsAnd100stress"]}
 fresh={x["policy"]:x for x in new["policies30bpsAnd100stress"]}
 assert first["CONFIRM_5M"]["stressExtra100bpsWorstDDPct"]<20
 assert fresh["CONFIRM_5M"]["stressExtra100bpsWorstDDPct"]<20
 assert fresh["CONFIRM_15M"]["stressExtra100bpsWorstDDPct"]>20
 assert fresh["CONFIRM_5_THEN_15"]["stressExtra100bpsWorstDDPct"]>20
 assert fresh["CONFIRM_5M"]["selectedWinPct"]<fresh["BASE5_NO_CONFIRM"]["selectedWinPct"]
 assert all(fresh[k]["meanNAVJPYPerOne10kSeedMarket"]<fresh["BASE5_NO_CONFIRM"]["meanNAVJPYPerOne10kSeedMarket"]
  for k in ("CONFIRM_5M","CONFIRM_15M","CONFIRM_5_THEN_15"))
 final={
  "schema":"prism7-p89-source-native-OR-added-post-trigger-M5-M15-entry-score-new-seed-robustness-final/v1",
  "researchOnlyTrue":True,"pinnedOriginalV20SHA":PIN,
  "ownerSelectedNativeORFromASTERorBinanceSingleASTEROrder":True,
  "oldSynthetic192PlusNewSeed192Total384":True,
  "gross0p25Prohibited":True,
  "ownerP73GrossSizing0p5Or0p75OrVetoUnchanged":True,
  "nativeM5StopOriginalPinnedRepricedPer5and15MinEntryClock":True,
  "nativeH1AsterBaselineParityP87exact4608ComparedScenarioMetrics":True,
  "frozenScoreBeforeP88IndependentSeedGeneration":True,
  "scoreDefinition":"ASTER post-trigger first COMPLETED 5min or first three COMPLETED 5min candles; no formed current M5 or future source; price-action sign +1 down candle/+1 prior H1 relative weakness/+1 wick rejection and -negative points for bullish rebound or overextension, cutoff>=2. 15min needs >=2 printed M5 bars. Stage first accept 5 else 15, no hindsight selection.",
  "headlinesEstablishedVsFreshSeedSynthetic192Each":stats,
  "researchDecision":"Strict 5m filtering reduced worst DD in both artificial samples but worsened fresh-seed win rate and mean equity; 15m and 5-then-15 lose <=20% high-stress DD on new-seed holdout; NO production adoption. Need source blind real data and true fills before promotion.",
  "sourceEventHistoriesNotPastDataFuture":True,
  "ProductionMasterGrossRunStopOrdersModified":False,
  "limitations":[
   "No new actual market out-of-sample: P88 is a deterministic synthetic NEW-SEED holdout with the same model generator, not independent exchange environment.",
   "Native source and five-minute candle asof gating are causal only for synthetic OHLC; Aster actual quote timestamps and exchange M5 close confirmation lag may differ.",
   "No real signed stops or venue orderbook or funding or multi-Runner account DD, therefore cannot guarantee future real DD20 target.",
   "Historical P84 data had been inspected; P87 results are backtest of newly chosen conceptual filter on known generated paths, not unseen real market.",
   "Fresh-seed 192 cases are also 7d artificial regimes, not full-year compounding or stress against actual sudden 10-20% gaps.",
   "5m price-action gate losses vs baseline may reflect over-rejection of profitable shorts in sustained decline; must audit lost winners before fitting thresholds.",
   "No new production orders/runner/gross/master/pengushort V20 source changes."
  ]}
 OUT.write_text(json.dumps(final,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
 lines=["# P87–P89：OR発火＋5分/15分の確定足判定を192人工相場＋新乱数192市場で検証",
  "",
  "**研究結果：5分判定はDD抑制が再現したが、新乱数では勝率・平均資金が低下。15分だけ／5分→15分再判定は新乱数でDD25%以上となり本番不採用。**",
  "",
  "ASTERかBinanceの元Pinned PENGU SHORT V20で1Hエントリー候補が出たら、同時発火は1件へ名寄せしてASTERでのみ執行。手数料30bps、追加買い戻し+100bpsリスク負担、単一建玉、複利、Native M5 STOP再計算。通常Gross0.75、強い上昇マクロで両市場PENGUの弱さがある時のみ0.5、そうでなければ見送り。Gross0.25禁止。",
  "",
  "5分の判定は[t,t+5分)の確定済ASTER M5一本、15分の判定は[t,t+15分)の確定済M5三本のうち2本以上に出来高があることが必要。下降足・既確定H1終値より下・上ヒゲの売り拒否を正点、反発急伸と追い売り過剰を負点として合計2点以上なら承認。いずれも未来足は参照しておらず、確認後のM5始値からエントリーする。",
  "",
  "| 人工データ | 追加確認 | 決済/勝ち | 勝率 | 1万円平均資金 | 最悪DD | +100bps最悪DD | +100bpsDD20%超パス |",
  "|---|---|---:|---:|---:|---:|---:|---:|"]
 for label,study in stats.items():
  for x in study["policies30bpsAnd100stress"]:
   lines.append("| "+("P87既存192" if label.startswith("P87") else "P88新192")+" | "+
    x["policy"]+" | "+str(x["selectedOneSlot"])+" / "+str(x["selectedWins"])+" | "+
    str(x["selectedWinPct"])+"% | "+str(x["meanNAVJPYPerOne10kSeedMarket"])+"円 | "+
    str(x["worstM5HighDDPct"])+"% | "+
    str(x["stressExtra100bpsWorstDDPct"])+"% | "+
    str(x["stressExtra100bpsMarketsDDover20"])+" /192 |")
 lines+=["",
  "**最重要検証：** P87の確認なし5/15分比較は先行P85の4,608シナリオ値と完全一致。P88は一切の配点変更を行わない新シード同型人工192ケース。OR+5分判定は両データで+100bps最大DD20%未満だが新192市場の勝率51.5%で目標80%未達、平均残高10,096円対元10,225円で利益が減る。二段階判定も新市場でストレスDD26.53%へ悪化。",
  "",
  "**改善課題：** 全通貨の勝率80%を無理に実現できる証拠ではない。単純なM5陰線や上ヒゲだけでは良いショートも切り落とす。時間帯5分〜15分を選ぶだけでなく、売り枯れと反発終息の分離を、取引所の真の板データ／約定出来高と事前登録した別期間で検証する。今回の192+192に配点を合わせて後出し修正しない。",
  "",
  "**原本台帳:** 既存192、別乱数192、それぞれ4MB超の全60シナリオ×192件明細を所有PCに維持し、ソースSHAをレポートへ固定。GitHubにはコード・総合結果・384人工市場におけるOR方式の採用取引台帳と原本SHAを保存する。",
  "",
  "本番RUNNER / LIVE / Gross / STOP / Kill Switch / 注文・建玉 / master変更なし。"]
 MD.write_text("\n".join(lines)+"\n",encoding="utf8")
 print("P89_RESEARCH_M5_5_TO_15_SCORE_FROZEN_NEW_SEED_REPLAY_COMPLETED",json.dumps({
 "old":first,"new":fresh,"pass25":["NO_0.25"],"P87Parities":4608,
 "final":"NO_DEPLOY"},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD)
if __name__=="__main__":main()
