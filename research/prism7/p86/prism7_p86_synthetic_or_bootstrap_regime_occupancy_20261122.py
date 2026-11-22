#!/usr/bin/env python3
"""P86 — source-independent stability check for P85 synthetic OR.
Do not retune gross or latency from synthetic outcomes.
Paired path, stratified by regime, cluster-by-regime bootstrap.
Report 192 dummy scenarios incl83 no-signal, 24 per eight regimes.
No signed exchange fills and no authentic market transfer inference.
"""
from __future__ import annotations
import json,hashlib,statistics,random,math
from pathlib import Path
from collections import defaultdict,Counter
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R
P85=R/"PRISM7_P85_SYNTHETIC_ASTER_BINANCE_OR_PAIRED_STRESS_ECONOMIC_20261122.json"
PATHS=R/"PRISM7_P85_SYNTHETIC_192_MARKET_PATHS_72_ECONOMICS_20261122.jsonl"
OUT=R/"PRISM7_P86_SYNTHETIC_OR_STABILITY_BOOTSTRAP_REGIME_RISK_20261122.json"
MD=R/"PRISM7_P86_SYNTHETIC_OR_STABILITY_BOOTSTRAP_REGIME_RISK_20261122.md"
SEED=2026112286
BOOT=10000
MAIN_SIZING="P73_CONDITIONAL_HALF_OR_SKIP"
MAIN_LAG=5
MODES=("ASTER_ONLY","BINANCE_TO_ASTER","BOTH_REQUIRED","EITHER_OR_ASTER_ONCE")
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def pct(data,p):
 x=sorted(data);a=(len(x)-1)*p/100;j=int(a)
 return round(x[j]+(x[min(j+1,len(x)-1)]-x[j])*(a-j),3)
def chosen(row,mode,sizing=MAIN_SIZING,lag=MAIN_LAG,cover=0):
 return next(x for x in row["perModeSizeDelayFeeEconomy"]
  if x["mode"]==mode and x["sizing"]==sizing and
  x["delayMin"]==lag and x["costBps"]==30 and x["extraCoverBps"]==cover)
def main():
 s=json.loads(P85.read_text(encoding="utf8"))
 paths=[json.loads(x) for x in PATHS.read_text(encoding="utf8").splitlines() if x.strip()]
 assert len(paths)==192 and s["marketCount"]==192 and all(z["noEntryGross0p25"] for z in paths)
 grouped=defaultdict(list)
 for z in paths:grouped[z["regime"]].append(z)
 assert len(grouped)==8 and all(len(v)==24 for v in grouped.values())
 rng=random.Random(SEED)
 compared={}
 for alternate in ("ASTER_ONLY","BINANCE_TO_ASTER","BOTH_REQUIRED"):
  values=[]
  for z in paths:
   a=chosen(z,"EITHER_OR_ASTER_ONCE")
   b=chosen(z,alternate)
   values.append({"regime":z["regime"],"tag":z["tag"],
    "differenceJPY":round(a["oneSlotNAVJPY"]-b["oneSlotNAVJPY"],2),
    "ORtradeCount":a["selectedTrueClosed"],"otherTradeCount":b["selectedTrueClosed"],
    "ORnativeDD":a["oneSlotDDHighPct"],"otherDD":b["oneSlotDDHighPct"]})
  delta=[z["differenceJPY"] for z in values]
  assert len(delta)==192
  # 1) IID artificial paths resampling
  iid=[]
  for _ in range(BOOT):
   iid.append(sum(delta[rng.randrange(192)] for _ in range(192))/192)
  # 2) sample 24 outcomes within EACH predeclared regime
  strat=[]
  byreg={r:[x["differenceJPY"] for x in values if x["regime"]==r] for r in grouped}
  for _ in range(BOOT):
   strat.append(sum(byreg[r][rng.randrange(24)] for _ in range(24) for r in sorted(byreg))/192)
  # 3) cluster bootstrap resample eight whole 24-path regimes
  cluster=[]
  arr=list(byreg)
  for _ in range(BOOT):
   selected=[byreg[arr[rng.randrange(len(arr))]] for _ in arr]
   cluster.append(sum(sum(v) for v in selected)/192)
  looreg={}
  for r in sorted(byreg):
   survivor=[q["differenceJPY"] for q in values if q["regime"]!=r]
   looreg[r]=round(statistics.mean(survivor),2)
  compared[alternate]={
   "pairs":192,
   "sameNAV":sum(x==0 for x in delta),
   "ORDominated":sum(x>0 for x in delta),
   "ORWorse":sum(x<0 for x in delta),
   "meanORMinusOtherJPY":round(statistics.mean(delta),2),
   "nonzeroOnlyMeanORMinusOtherJPY":round(statistics.mean(x for x in delta if x!=0),2),
   "worstORDownsideJPY":round(min(delta),2),
   "largestORGainerJPY":round(max(delta),2),
   "bootstrapPathIidCI95JPY":[pct(iid,2.5),pct(iid,97.5)],
   "bootstrapStratified8RegimesCI95JPY":[pct(strat,2.5),pct(strat,97.5)],
   "bootstrapRegimeClusterCI95JPY":[pct(cluster,2.5),pct(cluster,97.5)],
   "stratifiedPosteriorFrequencyORPositive":round(sum(z>0 for z in strat)/BOOT,5),
   "clusterBootstrapFrequencyORPositive":round(sum(z>0 for z in cluster)/BOOT,5),
   "leaveOneRegimeOutMeanDeltaJPY":looreg,
   "regimeContributionTo192PathMeanJPY":{
      r:round(sum(byreg[r])/192,2) for r in sorted(byreg)}
  }
 # Link single-source one slot: source OR earlier ASTER blocked some Binance events?
 preempt={"ORvsBinance5min":Counter(),"ORvsAster5min":Counter()}
 for q in paths:
  for comparison,tag in (("BINANCE_TO_ASTER","ORvsBinance5min"),("ASTER_ONLY","ORvsAster5min")):
   a=chosen(q,"EITHER_OR_ASTER_ONCE")
   b=chosen(q,comparison)
   keysA=set(a["selectedKeys30bps"] or [])
   keysB=set(b["selectedKeys30bps"] or [])
   preempt[tag]["ORonly"]+=len(keysA-keysB)
   preempt[tag]["ComparatorOnlyBlockedByOR"]+=len(keysB-keysA)
   preempt[tag]["ExactSelectedOverlap"]+=len(keysA&keysB)
 # Did the conditional 0.5/skip improve across dummy all regimes over fixed075?
 alloc=[]
 for mode in MODES:
  d=[chosen(q,mode) for q in paths]
  c=[chosen(q,mode,sizing="GROSS_075") for q in paths]
  alloc.append({"mode":mode,
    "conditionalMeanNAVJPY":round(statistics.mean(x["oneSlotNAVJPY"] for x in d),2),
    "fixed075MeanNAVJPY":round(statistics.mean(x["oneSlotNAVJPY"] for x in c),2),
    "conditionalWins":sum(x["selectedTrueWins"] for x in d),
    "fixed075Wins":sum(x["selectedTrueWins"] for x in c),
    "conditionalWorstDDPct":round(max(x["oneSlotDDHighPct"] for x in d),3),
    "fixed075WorstDDPct":round(max(x["oneSlotDDHighPct"] for x in c),3),
    "conditionalSourceVetoCount":sum(x["sourceP73Vetoed"] for x in d),
    "conditionalGross0p25None":True})
 # terminal open and stop DD stress; no system wide DD is done.
 riskPaths=[]
 for q in paths:
  a=chosen(q,"EITHER_OR_ASTER_ONCE",cover=100)
  if a["oneSlotDDHighPct"]>20:
   riskPaths.append({"tag":q["tag"],"regime":q["regime"],"liquidity":q["liquidity"],
       "coupling":q["coupling"],"seed":q["seed"],"M5HighDDPct":a["oneSlotDDHighPct"],
       "selectedTrueClosed":a["selectedTrueClosed"],"wins":a["selectedTrueWins"]})
 assert len(riskPaths)==1
 report={
  "schema":"prism7-p86-synthetic-eight-regime-192-path-paired-or-entry-bootstrap-no025/v1",
  "researchOnly":True,
  "syntheticPathCount":192,"regimes":sorted(grouped),
  "sourceP84P85AllNativeV20PurityAndCausalAsOf":True,
  "ownerPolicy":"OR entry, conditional 0.5 if bullish macro and PENGU weak confirmed both, otherwise 0.75 or skip, never 0.25",
  "normalCostBps":30,"assumedNetworkDelayMinutes":5,
  "fixedBootstrapSeed":SEED,"bootstrapSamples":BOOT,
  "ORPairedAgainstAllThreeAlternatives":compared,
  "selectedNativeSlotPreemptionAcross192Paths":{
   key:dict(value) for key,value in preempt.items()},
  "conditionalRiskSizeVsFixed075OnSame192SyntheticPaths":alloc,
  "ORExtra100bpsWorstRiskPathOverDD20":riskPaths,
  "sourceSHA256":{"P85":sha(P85),"P85All192PathEconomics":sha(PATHS)},
  "limitations":[
    "Monte Carlo uncertainty is conditional on deliberately constructed 8 regimes and synthetic returns, not genuine out-of-sample real market uncertainty.",
    "Eight distinct high-level synthetic regimes are not independent exchange history years. Cluster-by-regime bootstrap uses eight resampled clusters and can have very wide or unstable uncertainty.",
    "Synthetic STOP/5m first printed volume models contain no executable orderbook fills, signed STOP or funding, and network delay 5min is a proxy.",
    "Censored entries and forced MTM are tracked in P85; no source terminalMTM selected in primary 5min normal results.",
    "Prior live DD20 cap may be violated with 100bps stress in one synthetic path; stop selection must be risk-first before deployment.",
    "No selected parameter optimization from synthetic 15min or market regime subsets; owner OR mode and frozen gross P73 intact.",
    "No production master/Runner STOP/position/order/Gross/kill switch changes."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 md=[
 "# P86｜人工相場192パターンのOR方式・再標本化耐性確認",
 "",
 "P85の192シナリオ、各種モデル30bps・エントリー5分遅延・条件付き0.5倍/見送りを元のまま固定した対応差の統計。勝てそうな新しい点数・待ち時間へ後出し変更していない。",
 "",
 "| 同一人工市場でのOR対照 | OR優勢 | 劣勢 | 同値 | 平均NAV差 | 8相場層別bootstrap95%区間 | 8相場クラスタbootstrap95%区間 |",
 "|---|---:|---:|---:|---:|---|---|"]
 for name,z in compared.items():
  md.append("| OR vs "+name+" | "+str(z["ORDominated"])+" | "+str(z["ORWorse"])+" | "+str(z["sameNAV"])+
   " | +"+str(z["meanORMinusOtherJPY"])+"円 | "+
   str(z["bootstrapStratified8RegimesCI95JPY"])+"円 | "+
   str(z["bootstrapRegimeClusterCI95JPY"])+"円 |")
 md+=["","**最大DD20%の問題**：＋100bps買戻しストレスではOR方式の人工相場"+str(len(riskPaths))+
 "件でDD20%超過。該当の人工市場："+str(riskPaths),
 "",
 "## 通常Gross0.75と条件付きGross0.5/見送りの同一人工経済比較"]
 for k in alloc:
  md.append("- "+k["mode"]+": 条件付き平均"+str(k["conditionalMeanNAVJPY"])+"円、固定0.75平均"+
    str(k["fixed075MeanNAVJPY"])+"円。最悪DD条件付き"+
    str(k["conditionalWorstDDPct"])+"%、固定0.75"+
    str(k["fixed075WorstDDPct"])+"%。")
 md+=["",
  "**運用判断：** 192の仮想ケースは実市場の将来勝率を示さない。勝率目標80%・最大DD20%の本番条件は未検証。実際のASTER/Binance同時刻スナップショット、署名付き注文とSTOP約定、未研究期間、共有GrossとFundingの監査までは研究だけ。",
  ""]
 MD.write_text("\n".join(md),encoding="utf8")
 print("P86_SYNTHETIC_OR_PAIRED_EIGHT_REGIME_BOOTSTRAP_AND_SLOT_REPLACEMENT_DONE",
  json.dumps({"paired":compared,"sizing":alloc,"stressDD20fail":riskPaths,
    "sourceOccupancy":report["selectedNativeSlotPreemptionAcross192Paths"]},
    ensure_ascii=False),flush=True)
 print("FILES",OUT,MD)
if __name__=="__main__":main()
