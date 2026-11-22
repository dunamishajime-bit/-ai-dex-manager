#!/usr/bin/env python3
"""P101 audit: all non-V52 5TF/dual-market score candidates, one-year full-fleet
paired model. Strictly label all outcomes in-sample OLD strict research and not
Production. Preserve signed native model source, decisions, equity, funding.
Inputs: P96 SHA315, P97 source score2715, P98 six uniform, P99 nine targeted,
P100 four exploratory combos, P92 owner-adopted PENGU Binance5min baseline.
"""
from __future__ import annotations
from pathlib import Path
import json,hashlib,csv,datetime,math,collections,statistics
R=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
BASE=R/"P92_PAIRED_PORTFOLIO_REPLAY"/"BIN5M_CAPS"
P98=R/"P98_NONV52_DUAL_MARKET_ALLRUNNER_PAIRED"
P99=R/"P99_NONV52_ROUTE_FAMILY_ABLATION_BTC_BINANCE_MARKET"
P100=R/"P100_SELECTED_FAMILY_COMBINATION_SHADOW_RISK"
P96=R/"results"/"PRISM7_P96_NONV52_ALL_SOURCES_BINANCE_USDM_H1_202507_202610_OFFICIAL_SHA_MANIFEST_20261122.json"
P97=R/"results"/"PRISM7_P97_ALLRUNNER_NONV52_WEEK_D_12H_4H_1H_AST_BIN_SIGNED_SCORE_SHADOW_20261122.json"
P97T=R/"results"/"PRISM7_P97_ALLRUNNER_2715_RAW_CANDIDATE_ASOF_BINANCE_AST_SIGNED_SCORE_20261122.jsonl"
P91=R/"results"/"PRISM7_P91_OWNER_ADOPTED_REAL_1Y_BINANCE_TRIGGER_ASTER_CONFIRMED_M5_SOURCE_TAPE_20261122.json"
OUT=R/"results"/"PRISM7_P101_NONV52_ASTER_BINANCE_5TF_SCORE_6_UNIFORM_9_FAMILY_4_COMBO_FULLBT_AUDIT_20261122.json"
MD=R/"results"/"PRISM7_P101_NONV52_ALLRUNNER_5TF_BINANCE_TREND_NEGATIVE_POINTS_RESEARCH_REPORT_20261122.md"
DIFF=R/"results"/"PRISM7_P101_30BPS_SELECTED_FLEET_GATE_ADMISSION_REOPENED_NEWLY_BLOCKED_IDS_20261122.csv"
PERIOD=("2025-10-01T00:00:00Z","2026-10-01T00:00:00Z_EXCLUSIVE")
POL98=("ASTER_NONNEGATIVE","BINANCE_NONNEGATIVE","DUAL_NONNEGATIVE","DUAL_SOFT_NEGATIVE_VETO","DUAL_RISK_AWARE","DUAL_STRICT")
POL99=("V4","Q102","IDLE","FET","HYPE","RESIDUAL","Q102_TREND_BRK_PB","Q102_REV_MR","V4_CONT_TREND")
POL100=("IDLE_RESIDUAL","IDLE_Q102BRKPB","Q102BRKPB_RESIDUAL","IDLE_Q102BRKPB_RESIDUAL")
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read_man(folder,fee):
 x=json.loads((folder/"RUN_MANIFEST.json").read_text(encoding="utf8"))
 vals=[v for v in x["results"] if v["cost_bps_roundtrip"]==fee]
 assert len(vals)==1
 return vals[0]
def choosefile(folder,fee,suffix):
 z=list(folder.glob(f"*_{fee}BPS_{suffix}.csv"))
 assert len(z)==1,(folder,fee,suffix)
 return z[0]
def read_decs(folder,fee):
 return {z["signal_id"]:z for z in csv.DictReader(choosefile(folder,fee,"DECISIONS").open(encoding="utf-8-sig",newline=""))}
def read_fills(folder,fee):
 return list(csv.DictReader(choosefile(folder,fee,"FILLS").open(encoding="utf-8-sig",newline="")))
def monthly(folder,fee=30):
 p=choosefile(folder,fee,"EQUITY_5MIN")
 last={};count=0
 with p.open(encoding="utf-8-sig",newline="") as f:
  for z in csv.DictReader(f):
   key=z["utc"][:7];last[key]=float(z["compounded_mtm_equity_jpy"]);count+=1
 assert count==105120,(folder,count)
 prev=10000.;o=[]
 for month,ending in sorted(last.items()):
  ret=(ending/prev-1)*100
  o.append({"month":month,"endJpy":round(ending,2),"monthReturnPct":round(ret,5)})
  prev=ending
 assert len(o)==12
 return o
def summarize(folder,reference,fee):
 d=read_man(folder,fee)
 b=read_man(reference,fee)
 assert d["source_intents"]==b["source_intents"]==2769
 assert d["crypto_cap"]==b["crypto_cap"]==3.0
 assert d["stock_cap"]==b["stock_cap"]==1.5
 assert d["total_cap"]==b["total_cap"]==3.5
 v={
  "feeBps":fee,"sourceCandidatesAll":d["source_intents"],
  "modeledFilled":d["modeled_fills"],
  "winRatePct":round(d["win_rate_pct"],5),
  "finalNAVJPY":round(d["final_compounded_jpy"],2),
  "drawdownPct":round(abs(d["max_hourly_dd_pct"]),5),
  "profitFactor":round(d["profit_factor"],5),
  "maxDDDeltaPtVsAdoptedPENGUBase":round(abs(b["max_hourly_dd_pct"])-abs(d["max_hourly_dd_pct"]),5),
  "NAVPctChangeVsAdoptedPENGUBase":round(100*(d["final_compounded_jpy"]/b["final_compounded_jpy"]-1),5),
  "modelAdmittedByRunner":d["admitted_by_runner"],
  "reasonCountsRejected":d["blocked_by_reason"],
  "originalPENGUContractNotModified":True,
  "newFiveTFMacroPointGateOnlyNonPENGUAndNonV52":True,
  "baselineOldDD21HoldGateNotModeled":True,
  "sourceRunManifestSHA256":sha(folder/"RUN_MANIFEST.json"),
  "sourceFillsSHA256":sha(choosefile(folder,fee,"FILLS")),
  "sourceDecisionsSHA256":sha(choosefile(folder,fee,"DECISIONS")),
  "sourceFundingSHA256":sha(choosefile(folder,fee,"FUNDING")),
  "sourceEquity5mSHA256":sha(choosefile(folder,fee,"EQUITY_5MIN"))}
 return v
def main():
 data96=json.loads(P96.read_text(encoding="utf8"))
 data97=json.loads(P97.read_text(encoding="utf8"))
 pengu=json.loads(P91.read_text(encoding="utf8"))
 assert data96["officialArchiveVerified"]==315 and not data96["errors"]
 assert data97["totalNativeSourceCandidatesExcludingV52"]==2715
 assert data97["v52NotScored"] and data97["userPENGUPreviouslyAdoptedV20NotOverridden"]
 assert data97["fullCandidateSourceScoreAuditTapeSHA256"]==sha(P97T)
 assert pengu["acceptedBinance5mCausalNativeResearchCandidateCount"]==4
 assert len(data97["AsterTFWeights"])==5 and len(data97["BinanceTFWeights"])==5
 p98meta=json.loads((P98/"P98_SOURCE_COMPETITION_MODELS_SHA_MANIFEST_20261122.json").read_text(encoding="utf8"))
 p99meta=json.loads((P99/"P99_SOURCE_FAMILY_ABLATION_SHA_MANIFEST_20261122.json").read_text(encoding="utf8"))
 p100meta=json.loads((P100/"P100_FAMILY_COMBO_SOURCE_SHA_MANIFEST_20261122.json").read_text(encoding="utf8"))
 assert p98meta["allSourceScoreSHA256"]==sha(P97T)
 output={}
 sourceMeta={}
 for family,items,parent,sourcemap in (
  ("uniform",POL98,P98,p98meta["allModes"]),
  ("individual",POL99,P99,p99meta["allModes"]),
  ("combination",POL100,P100,p100meta["combos"])):
  output[family]={}
  for name in items:
   model=sourcemap[name]
   d=Path(model.get("outputFolder",model.get("output")))
   assert d.exists(),d
   src=Path(model.get("script",model.get("scriptPath")))
   assert sha(src)==model["sourceSHA256"],("MODEL_SOURCE_SHA_MISMATCH",src)
   out={str(fee):summarize(d,BASE,fee) for fee in (10,30)}
   output[family][name]=out
   sourceMeta[family+"|"+name]={"script":str(src),"sha":sha(src)}
 # max DD under 20 is a strict objective. No cherry-picking after observing target
 # can constitute formal adoption regardless of model metrics.
 baseline={str(f):summarize(BASE,BASE,f) for f in (10,30)}
 assert round(baseline["30"]["drawdownPct"],2)==29.95
 assert round(baseline["30"]["finalNAVJPY"])==551075
 favorite=output["combination"]["IDLE_Q102BRKPB_RESIDUAL"]
 assert favorite["30"]["drawdownPct"]<baseline["30"]["drawdownPct"]
 assert favorite["30"]["finalNAVJPY"]>baseline["30"]["finalNAVJPY"]
 assert favorite["30"]["drawdownPct"]>20 and favorite["10"]["drawdownPct"]>20
 # Full per-signal acceptance vs decline on selective three-group condition.
 baseD=read_decs(BASE,30)
 selD=read_decs(P100/"IDLE_Q102BRKPB_RESIDUAL",30)
 assert set(baseD)==set(selD) and len(baseD)==2769
 changed=[]
 for key in sorted(baseD):
  a=baseD[key];b=selD[key]
  if a["decision"]==b["decision"]:continue
  kind=("NEWLY_ADMITTED" if a["decision"]=="BLOCK" else "NEWLY_REJECTED")
  changed.append({"id":key,"strategy":a["strategy"],"utc":a["utc"],"kind":kind,
    "oldDecision":a["decision"],"oldReason":a["reason"],
    "newDecision":b["decision"],"newReason":b["reason"],
    "oldGross":a["requested_gross"],"newGross":b["requested_gross"]})
 with DIFF.open("w",encoding="utf-8",newline="") as f:
  fieldnames=["id","strategy","utc","kind","oldDecision","oldReason","newDecision","newReason","oldGross","newGross"]
  w=csv.DictWriter(f,fieldnames=fieldnames);w.writeheader();w.writerows(changed)
 bykind=collections.Counter(x["kind"] for x in changed)
 byrunner=collections.defaultdict(collections.Counter)
 for z in changed:byrunner[z["strategy"]][z["kind"]]+=1
 # Monthly stability is within the already used 2025-10~2026-09 year,
 # not untouched unseen out-of-sample.
 basemonth=monthly(BASE)
 selmonth=monthly(P100/"IDLE_Q102BRKPB_RESIDUAL")
 permonth=[]
 for a,b in zip(basemonth,selmonth):
  assert a["month"]==b["month"]
  permonth.append({"month":a["month"],"baseNAVJPY":a["endJpy"],"selectedNAVJPY":b["endJpy"],
     "baseReturnPct":a["monthReturnPct"],"selectedReturnPct":b["monthReturnPct"],
     "monthlyReturnAdvantagePctPt":round(b["monthReturnPct"]-a["monthReturnPct"],5)})
 wins=sum(z["monthlyReturnAdvantagePctPt"]>0 for z in permonth)
 losses=sum(z["monthlyReturnAdvantagePctPt"]<0 for z in permonth)
 decisive={
  "allUniformSixSameTimeGridReplayed":len(output["uniform"])==6,
  "allIndividualNineSameTimeGridReplayed":len(output["individual"])==9,
  "allFourCombinationsReplayed":len(output["combination"])==4,
  "combinedSelectedStrategy":"IDLE_Q102BRKPB_RESIDUAL",
  "selectiveMonthlyOutperformed":wins,
  "selectiveMonthlyUnderperformed":losses,
  "selectiveNewlyAdmitted":bykind["NEWLY_ADMITTED"],
  "selectiveNewlyRejected":bykind["NEWLY_REJECTED"],
  "selectiveChangedByRunner":{k:dict(v) for k,v in byrunner.items()},
  "tripleAt30bpsNAVRelativePct":favorite["30"]["NAVPctChangeVsAdoptedPENGUBase"],
  "tripleAt30bpsMaxDDImprovementPt":favorite["30"]["maxDDDeltaPtVsAdoptedPENGUBase"],
  "not20DDGatePassed":favorite["30"]["drawdownPct"]>20 or favorite["10"]["drawdownPct"]>20,
  "hasIndependentOutOfSampleValidation":False,
  "nativeOriginalExitAndCandidateSourceSameExceptBinaryPreEntryGate":True
 }
 report={
  "schema":"prism7-p101-DisDex-ALL-nonV52-multitf-signed-binance-Aster-causal-score-allrunner-19-models-paired/v1",
  "status":"RESEARCH_ONLY__NO_PRODUCTION_CHANGE__IN_SAMPLE_COMBINATION_EXPLORATORY",
  "createdDate":"2026-11-22",
  "periodUTC":PERIOD,"initialJPY":10000,
  "shaVerifiedBinanceOfficialArchives315":True,
  "coveredTimeframes":["W","D","12H","4H","1H"],
  "signedPositiveOrNegativePointsByDirection":True,
  "binanceIndependentNativeEntryGeneratorReplayedForNonPENGU":False,
  "binanceUsedAsIndependentDirectionScoreNotAsterOrderFill":True,
  "sourceNativePositionExitAndGrossSameForAllNonPENGU":True,
  "PENGUUserAdoptedBinance5mNativeSourceRetained":True,
  "V52NeverScoreGated":True,
  "originalCandidateScoreUniverse2715":2715,
  "sourceV4Q102OlderPinnedResearchNot20261122Stable4":True,
  "officialDateArchive2025JulyTo2026Sep":True,
  "sourceAndManifestSha256":{
   "P96OfficialChecksums":sha(P96),"P97NativeCausalScoreSummary":sha(P97),
   "P97OriginalFullNativeSignalLedger":sha(P97T),
   "P91PENGUAdoptedNativeInput":sha(P91),
   "P98Modes":sha(P98/"P98_SOURCE_COMPETITION_MODELS_SHA_MANIFEST_20261122.json"),
   "P99Modes":sha(P99/"P99_SOURCE_FAMILY_ABLATION_SHA_MANIFEST_20261122.json"),
   "P100Modes":sha(P100/"P100_FAMILY_COMBO_SOURCE_SHA_MANIFEST_20261122.json"),
   "selectedDifferenceIDs":sha(DIFF)},
  "sourceSHA256EachResearchMode":sourceMeta,
  "basePENGUAdoptedNoOtherScore":baseline,
  "allUniformSix":output["uniform"],
  "allNineFamilyAblations":output["individual"],
  "allFourExploratoryCombinations":output["combination"],
  "fiveMinuteCashEquityGrowthCurveMonthlyDiagnostic":permonth,
  "nativeSourceUnleveredOutcomeByFamilyAndPolicy":data97["familiesAndPoliciesSourceSignalScoreOutcome"],
  "routeLevelUnleveredSourceOutcomeByGroup":data97["nativeRoutesByPolicySourceSignalScoreOutcome"],
  "selectedCombosRealtimeGateDecisionDiff":decisive,
  "majorCaveats":[
   "The P92 strict V2 chronology is OLDER research and excludes latest Stable4, H48, current Q102/FET, V4 DD21 HOLD gate; no verified LIVE Production parity.",
   "Unlike individual nonPENGU native source entry fired on Binance, this stage only scores Binance directional OHLCV W/D/12H/4H/1H as a confirming/veto signal before Aster source-native entry; independent Binance original V4/Q102/HYPE/IDLE/FET native strategy generation needs separate replay.",
   "All examined target-year data are previously studied. The 3-family selection was made AFTER seeing P99 results; no untouched OOS or causal improvement assurance.",
   "P92 reference equity uses last completed Aster H1 price marked each 5m rather than intrabar M5 high for total account DD, so true signed STOP/high drawdowns can exceed values.",
   "Funding in portfolio is modeled, not signed venue. HYPE/IDLE assumed active; Q102 unresolved native events not modeled; V52 quote model only; old source gross0.25 not newly created by policy.",
   "Even best 30bps result DD23.17% > desired 20%; no rollout or formal owner deployment until actual parity and all risk gates verified.",
   "Separately selected original PENGU V20 entry source/Binance->Aster confirmed5 is unchanged in these candidate score replays. Cross-runner interactions may alter PENGU admission.",
   "No live Runner/STOP/Exchange order/account/Gross/Kill Switch/marge or Prod change."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
 lines=["# P101｜全Runner（V52除外）のWeekly/Daily/12H/4H/1H＋Binance方向スコア検証",
  "",
  "PENGUのOwner正式採用『Binance Native V20→ASTER確定M5→ASTER注文モデル』は据え置き。追加21銘柄に対しBinance USD-M公式315 ZIP＋SHA256検証済。P97で既存2,715原発火候補（PENGUもshadow）へ完成足のみで負点を許容する方向スコアを付与。V52は対象外。",
  "",
  "## 5つの時間足と減点方法",
  "",
  "- ASTER：Weekly=±5 / Daily=±4 / 12H=±3 / 4H=±2 / 1H=±1。",
  "- Binance：Weekly=±3 / Daily=±2 / 12H=±2 / 4H=±1 / 1H=±1。",
  "- LONGは上昇が加点・下降が減点、SHORTは逆。トレンドには終値が2回連続で増減した3つの確定済足のみ使い、横ばい/未知は0点。週足は月曜開始UTC。",
  "- 同一銘柄の週足ASTER/Binance反対は−3、日足反対は−2。BTC両市場の4週方向とBinance ETH方向がエントリー側に逆行した場合−3。未確定足・未来足参照なし。",
  "",
  "## 全Runner統合BT（旧研究環境、基準はPENGU採用済み）",
  "",
  "期間2025-10-01〜2026-10-01（終端除外）、初期資金1万円、複利、10/30bps、5分刻み同時刻のShared Risk・Gross・建玉判定。旧研究シミュレーターのV4 DD21% Holdは含まれず、Production完全一致ではない。",
  "",
  "| 適用方式 | 30bps最終資金 | 最大DD | 全体勝率 | ベース比利益 |",
  "|---|---:|---:|---:|---:|"]
 modes=[("PENGU採用済み・追加なし",baseline["30"])]
 modes+= [("一律 "+n,output["uniform"][n]["30"]) for n in POL98]
 modes+= [("個別 "+n,output["individual"][n]["30"]) for n in POL99]
 modes+= [("複合 "+n,output["combination"][n]["30"]) for n in POL100]
 for label,s in modes:
  lines.append("| "+label+" | "+str(round(s["finalNAVJPY"]))+"円 | "+str(round(s["drawdownPct"],2))+
   "% | "+str(round(s["winRatePct"],2))+"% | "+
   ("基準" if label.startswith("PENGU") else str(s["NAVPctChangeVsAdoptedPENGUBase"])+"%")+" |")
 lines+=["",
  "## 有望だが未採用：IDLE／Q102 BRK・PB／補助ロジックのみ",
  "",
  "30bps：基準551,075円/最大DD29.95% → 複合607,456円/DD23.17%（＋10.2%資金、DD−6.78pt）。10bps：基準1,807,111円/DD24.62% → 複合1,893,662円/DD21.12%。**どちらもDD20%を超えるため正式反映不可**。",
  "",
  "同じSourceでは『IDLE+補助ロジック』は30bps 607,642円／DD26.22%であり、3系統版は利益がほぼ同じでDDをさらに下げた。しかし後出しの対象選別なので、他期間・別市場で崩れる可能性がある。",
  "",
  "### 月別の判定と新規注文の入れ替わり",
  "",
  "同期間の月次リターン改善は"+str(wins)+"か月／12、悪化は"+str(losses)+"か月。旧BLOCK→新ENTERは"+str(bykind["NEWLY_ADMITTED"])+
  "件、旧ENTER→新BLOCKは"+str(bykind["NEWLY_REJECTED"])+"件。元候補ID別台帳を別添している。月別改善は独立OOSではない。",
  "",
  "| 月 | 元の月次リターン | 複合月次リターン | 改善差 |",
  "|---|---:|---:|---:|"]
 for x in permonth:lines.append("| "+x["month"]+" | "+str(x["baseReturnPct"])+"% | "+str(x["selectedReturnPct"])+"% | "+str(x["monthlyReturnAdvantagePctPt"])+"pt |")
 lines+=["",
  "## 次の本採用判定へ必須",
  "",
  "1. 現行Stable4+H48+各Runtime SHA／DD21%HOLDをまず旧BTと完全一致再現してから、新旧5分刻みの全Runnerシミュレーションを実施。以前の673件のDD21%拒否復帰はこの旧研究では未検証。",
  "2. 未使用・独立の市場と人工相場で検証し、厳しいトレンド逆行・ギャップ・ショートスクイーズ、スリッページ+100bps、ソース時刻不一致などへ耐えるか確認。母数の少ないFETは判断保留。",
  "3. 逆張りV4・Q102 MR/REVとトレンド追随系を分離。P97のポイントは影の判定台帳として持つが、全候補一律ブロックは不採用。",
  "4. Binanceで各ロジック独自の発火条件を実際に再計算する場合、今回の『Binanceトレンド確認』とは別実験としてSource Native＋ASTERの出口を再現する。Binance価格をASTERの約定価格へ流用しない。",
  "5. 実装は候補PR・CI・シミュレーションから進め、本番発注はOwner HP認証と正式Github Actionsルートのみ。生体Runner/STOP/Gross/注文/建玉は一切変更しない。",
  "",
  "**結論：均一ゲート6方式は全滅。全体で最も検証価値があるのは方向スコアを各Runner/ルートで選別するP100組み合わせ。ただし研究モデルで未検証DD20%、未使用市場検証なし、LIVE切替不可。**"]
 MD.write_text("\n".join(lines)+"\n",encoding="utf8")
 print("P101_ALL_6_UNIFORM_9_SEPARATE_4_SELECTIVE_SOURCE_NATIVE_SCORE_BT_AUDIT_COMPLETE",
  json.dumps({"baseline":baseline,"bestTriple":favorite,
    "monthlyOutperformed":wins,"monthlyUnderperformed":losses,
    "changed":decisive,"output":str(OUT),"md":str(MD)},ensure_ascii=False)[:9900],flush=True)
if __name__=="__main__":main()
