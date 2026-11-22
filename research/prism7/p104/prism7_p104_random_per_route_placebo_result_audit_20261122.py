#!/usr/bin/env python3
"""P104: assess whether P100 combined as-of Aster/Binance directional points
beat 32 NONTRADABLE placebo masks with same number of vetoes PER
(strategy,route,symbol,side). Full all-Runner same P92 older 5-minute risk,
PENGU native Bin->Aster5m source unchanged, V52 not scored.
This is a falsification, NOT statistical proof of superiority or live safety.
"""
from pathlib import Path
import json,hashlib,statistics,math,datetime,collections
ROOT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
P102=ROOT/"P102_BINANCE_TF_RANDOM_VETO_PLACEBO"
SRC=P102/"P102_PLACEBO_FROZEN_SHA_RUN_MANIFEST_20261122.json"
P100=ROOT/"P100_SELECTED_FAMILY_COMBINATION_SHADOW_RISK"/"IDLE_Q102BRKPB_RESIDUAL"
P101=ROOT/"results"/"PRISM7_P101_NONV52_ASTER_BINANCE_5TF_SCORE_6_UNIFORM_9_FAMILY_4_COMBO_FULLBT_AUDIT_20261122.json"
BASE=ROOT/"P92_PAIRED_PORTFOLIO_REPLAY"/"BIN5M_CAPS"
JSON=ROOT/"results"/"PRISM7_P104_THIRTYTWO_MARCHED_PER_ROUTE_RANDOM_VETO_PLACEBO_FALSIFICATION_20261122.json"
MD=ROOT/"results"/"PRISM7_P104_ALLRUNNER_DIRECTIONAL_POINT_SCORE_32_PLACEBOS_OUTCOME_20261122.md"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def result(folder,fee):
 p=folder/"RUN_MANIFEST.json"
 assert p.exists(),p
 d=json.loads(p.read_text(encoding="utf8"))
 vals=[z for z in d["results"] if z["cost_bps_roundtrip"]==fee]
 assert len(vals)==1
 z=vals[0]
 return {"feeBps":fee,"finalNAVJPY":round(z["final_compounded_jpy"],2),
   "maxDDPct":round(abs(z["max_hourly_dd_pct"]),6),
   "winRatePct":round(z["win_rate_pct"],6),
   "modeledFills":z["modeled_fills"],
   "grossCryptoCap":z["crypto_cap"],"grossStockCap":z["stock_cap"],
   "grossTotalCap":z["total_cap"],
   "sourceManifestSHA256":sha(p)}
def main():
 meta=json.loads(SRC.read_text(encoding="utf8"))
 audit=json.loads(P101.read_text(encoding="utf8"))
 assert meta["replicates"]==32 and meta["blocks"]==218
 assert len(meta["placeboModels"])==32
 assert meta["perSourceRouteSideSymbolTotalNativeBlocksHeldFixed"]
 original={str(f):result(BASE,f) for f in (10,30)}
 approved={str(f):result(P100,f) for f in (10,30)}
 assert round(approved["30"]["finalNAVJPY"])==607456
 assert round(approved["30"]["maxDDPct"],2)==23.17
 rand=[]
 for i in range(1,33):
  row=meta["placeboModels"][str(i)]
  src=Path(row["scriptPath"]);mask=Path(row["maskPath"]);folder=Path(row["outputFolder"])
  assert sha(src)==row["sourceSHA256"] and sha(mask)==row["maskSHA256"]
  assert row["sourceTargetBlocks"]==218 and row["perRouteMaskCountExact"]
  gates=json.loads(mask.read_text(encoding="ascii"))
  assert len(gates)==966 and sum(not z for z in gates.values())==218
  r={str(f):result(folder,f) for f in (10,30)}
  for f in ("10","30"):
   assert r[f]["grossCryptoCap"]==approved[f]["grossCryptoCap"]==3.0
   assert r[f]["grossStockCap"]==approved[f]["grossStockCap"]==1.5
   assert r[f]["grossTotalCap"]==approved[f]["grossTotalCap"]==3.5
  rand.append({"replicate":i,"sourceMaskSHA256":sha(mask),
    "runSourceSHA256":sha(src),"10":r["10"],"30":r["30"]})
 summary={}
 for fee in ("10","30"):
  selected=approved[fee];base=original[fee]
  q=[x[fee] for x in rand]
  nn=[x["finalNAVJPY"] for x in q];dd=[x["maxDDPct"] for x in q];wr=[x["winRatePct"] for x in q]
  beats=[]
  for x in rand:
   v=x[fee]
   if v["finalNAVJPY"]>selected["finalNAVJPY"] and v["maxDDPct"]<selected["maxDDPct"]:
    beats.append(x["replicate"])
  summary[fee]={
   "baselineNAV":base["finalNAVJPY"],"scoreSelectedNAV":selected["finalNAVJPY"],
   "baselineDD":base["maxDDPct"],"scoreSelectedDD":selected["maxDDPct"],
   "scoreSelectedWinRate":selected["winRatePct"],
   "placeboCount":len(q),
   "placeboMedianNAV":round(statistics.median(nn),2),
   "placeboMeanNAV":round(statistics.mean(nn),2),
   "placeboBestNAV":round(max(nn),2),
   "placeboWorstNAV":round(min(nn),2),
   "placeboMedianDD":round(statistics.median(dd),6),
   "placeboBestLowestDD":round(min(dd),6),
   "placeboWorstHighestDD":round(max(dd),6),
   "placeboMedianWinPct":round(statistics.median(wr),6),
   "placeboExceedsScoreNAV":sum(y>=selected["finalNAVJPY"] for y in nn),
   "placeboLowerScoreDD":sum(y<=selected["maxDDPct"] for y in dd),
   "placeboBeatsScoreNAVAndDD":len(beats),
   "placeboBothMoreProfitableAndLowerDDReplicates":beats,
   "scoreSelectedBeatsMedianPlaceboInNAVAndDD":selected["finalNAVJPY"]>statistics.median(nn) and selected["maxDDPct"]<statistics.median(dd),
   "scoreSelectedDDOver20":selected["maxDDPct"]>20}
 monthly=audit["fiveMinuteCashEquityGrowthCurveMonthlyDiagnostic"]
 more=sum(x["monthlyReturnAdvantagePctPt"]>0 for x in monthly)
 less=sum(x["monthlyReturnAdvantagePctPt"]<0 for x in monthly)
 assert more==5 and less==6
 assert summary["30"]["placeboBeatsScoreNAVAndDD"]>=1
 record={
  "schema":"prism7-p104-nonV52-5TF-asof-aster-binance-signed-score-veto-versus-32-route-matched-random-placebos/v1",
  "status":"P100_CANDIDATE_SOURCE_PROMISING_BUT_RANDOM_PLACEBO_CAN_BEAT_BOTH_METRICS__NO_ADOPTION",
  "PENGUOwnerApprovedV20SourceUnchanged":True,
  "V52NeverFiltered":True,
  "sourceCausalTFClosedWeekDay12h4h1h":True,
  "officialSHAValidatedBinanceArchives315":True,
  "yearBTUTC":["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z_EXCLUSIVE"],
  "placeboN":32,
  "sourceAllNativeScoreCandidates":2715,
  "selectedFamilyForHardGate":["IDLE","Q102|BRK","Q102|PB","RESIDUAL"],
  "totalSourceGroupEligible966Rejected218BeforeOtherGates":True,
  "placeboByRouteAndSideMatchedRejectionCountsAll32":True,
  "referencePolicySelectedFromKnownTargetPeriod":True,
  "placeboVetoMasksNotValidRealtimeDecisionRules":True,
  "NoIndependentNewMarketOOS":True,
  "all32ReplayedSourceResults":rand,
  "benchmarksByFee":summary,
  "monthlySelectedScoreAdvantageVsBase":{"monthsBetter":more,"monthsWorse":less,"monthsTie":12-more-less},
  "sourceProvenanceSHA256":{
   "P102PlaceboGeneratorManifest":sha(SRC),
   "P10119ModelsAndCandidateScoreFullAudit":sha(P101),
   "sourceSelected30bps":approved["30"]["sourceManifestSHA256"],
   "sourceSelected10bps":approved["10"]["sourceManifestSHA256"]},
  "safetyAndLimits":[
   "Even though score-selected portfolio beat median random placebo on in-sample base, some matched random veto masks can equal/better both NAV/DD (30bps at least one). This does not substantiate predictive edge vs risk reduction alone.",
   "Placebo masks use hindsight to permute vetoes within an entire one-year series; impossible to trade causally; only a negative control, not an implementable replacement strategy.",
   "Only 32 structured randomizations, no formal significance test and no untouched independent real market; selection made after observing P99 native results; severe multiple-testing/overfitting risk.",
   "All included source code is older strict V2, lacks 2026-11-22 Stable4/H48 and V4 DD21% HOLD, cannot establish account DD below owner 20% or the earlier 673 V4 gate block recoveries.",
   "No actual signed exchange fills or STOP, funding is modeled; PENGU owner-approved independent Binance native source is unchanged, whereas other Runner Binance is only preentry directional confirmation, not independent original native signal generation.",
   "V52 gross1.5 research cap and older original strategy gross0.25 retained for parity only, no new 0.25 allocation, current production not changed.",
   "No deployment, order, STOP, Runner, Gross, Kill Switch, margin or position modification."
  ]
 }
 JSON.write_text(json.dumps(record,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
 lines=["# P104｜新たな相場判断ポイント制：32種類の取引数一致ランダム見送りとの検証",
  "",
  "**結論：非PENGU全系統への一律フィルターは逆効果。IDLE／Q102 BRK・PB／補助のみの選択は30bps資金＋10.2%、最大DD−6.78ptだが、**32ランダム対照の中に資金とDDの双方でさらに上回るケースが実在**。このため情報優位の確証・LIVE採用は不成立。**",
  "",
  "2025/10/01〜2026/10/01、既存P92のPENGU Binance→ASTER＋確定M5を固定、V52除外、同じ5m全Runner時系列／Crypto3.0・Stock1.5・Total3.5、初期1万円複利、10/30bps。",
  "",
  "各ロジックのWeekly ±5、Daily ±4、12H ±3、4H ±2、1H ±1（Binance別配点あり）を完成足から方向別に事前採点し、逆行は減点。比較ではIDLE42、Q102 BRK/PB20、補助156、計218候補を見送り。ランダム対照は**元ルート・銘柄・売買方向ごとに同じ拒否数**を保ち、どの候補を拒否するかだけ固定Seedで入れ替えた研究用非取引ルール。",
  "",
  "| bps | 基準資金 | 選択スコア資金 | ランダム中央値 | スコアのDD | ランダムDD中央値 | スコアよりNAV/DD両方優位の対照 |",
  "|---|---:|---:|---:|---:|---:|---:|"]
 for fee in ("10","30"):
  x=summary[fee]
  lines.append("| "+fee+" | "+str(round(x["baselineNAV"]))+"円 | "+str(round(x["scoreSelectedNAV"]))+
   "円 | "+str(round(x["placeboMedianNAV"]))+"円 | "+str(round(x["scoreSelectedDD"],2))+
   "% | "+str(round(x["placeboMedianDD"],2))+"% | "+
   str(x["placeboBeatsScoreNAVAndDD"])+" / 32 |")
 lines+=["","| 手数料 | ランダム最高資金 | 最小DD | ランダム双方優位のseed番号 |",
  "|---|---:|---:|---|"]
 for fee in ("10","30"):
  x=summary[fee]
  lines.append("| "+fee+"bps | "+str(round(x["placeboBestNAV"]))+
   "円 | "+str(round(x["placeboBestLowestDD"],2))+"% | "+
   str(x["placeboBothMoreProfitableAndLowerDDReplicates"])+" |")
 lines+=["","月別の新旧比較で改善5、悪化6、同率1か月。全16パターン以上のシナリオを過去1年の同じ結果で見たため、最良候補の後出し選択バイアスが強い。",
  "",
  "次回は実装SHA固定の現行STABLE4+H48+Q102+DD21%HOLDの旧シミュレーター再現を行い、独立の期間とショートスクイーズ・ギャップ・Binance/ASTER乖離の人工市場を確保。トレンド追随／逆張り／平均回帰を各ルートで区別し、正点・負点を主にShadow観測し、盲目的なHard Vetoにはしない。",
  "",
  "**重要：** Binance側の1Hトレンド確認を加えただけで、Q102/V4/IDLE/HYPE/FETの元戦略シグナルをBinanceの価格で独立再発火したわけではない。PENGUだけは別研究P91でBinance元Native V20発火→ASTER確定5m→ASTER注文候補を再現済み。",
  "",
  "Production/Runner/Order/STOP/Gross/Kill Switch/positionsは未変更。研究枝へPushのみ。"]
 MD.write_text("\n".join(lines)+"\n",encoding="utf8")
 print("P104_COMPLETED_32_RANDOM_VETO_PLACEBO_SIGNED_SCORE_FALSIFICATION",
  json.dumps({"summary":summary,"monthly":record["monthlySelectedScoreAdvantageVsBase"],
    "file":str(JSON),"md":str(MD)},ensure_ascii=False),flush=True)
if __name__=="__main__":main()
