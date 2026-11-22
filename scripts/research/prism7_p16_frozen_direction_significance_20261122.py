#!/usr/bin/env python3
"""PRISM VII P16: within-calendar-cohort stratified null-test of frozen 2H score.

Results are descriptive since original 53 SOURCE labels were already observed.
No threshold optimization, no new strategy order or winrate claim.
"""
import json
import math
import random
from collections import Counter,defaultdict
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
P="PRISM7_P16_NATIVE53_FROZEN_2H_DIRECTION_SUMMARY_20261122"
R=ROOT/"results"
SEED=20261122
PERMUTATIONS=5000
def auc(scores,labels):
    a=[x for x,y in zip(scores,labels) if y]
    b=[x for x,y in zip(scores,labels) if not y]
    if not a or not b:return None
    total=0.0
    for x in a:
        for z in b:
            total+=1 if x>z else 0.5 if x==z else 0.0
    return total/(len(a)*len(b))
def main():
    rows=json.loads((R/(P+"_NATIVE53_DIAGNOSTIC_LEDGER.json")).read_text(encoding="utf-8"))
    j=json.loads((R/(P+".json")).read_text(encoding="utf-8"))
    if len(rows)!=53 or len(set((x["period"],x["id"],x["sourceSignalEntryTs"]) for x in rows))!=53:
        raise ValueError("SOURCE53_NOT_VERIFIED")
    if sum(x["sourceNativeWin30"] for x in rows)!=29:raise ValueError("ORIGINAL_WIN29_PARITY_FAIL")
    valid=[x for x in rows if x["status"]!="NO_POSTENTRY_PENGU_PRICE_PRINT_H1"]
    if len(valid)!=52:raise ValueError("P16_PRINT_COHORT_CHANGED")
    by_period=defaultdict(list)
    for x in valid:by_period[x["period"]].append(x)
    scores=[x["score"] for x in valid]
    labels=[not x["sourceNativeWin30"] for x in valid]
    observed=auc(scores,labels)
    rand=random.Random(SEED)
    extreme=0
    samples=[]
    for _ in range(PERMUTATIONS):
        shuffled={}
        for period,group in by_period.items():
            y=[not x["sourceNativeWin30"] for x in group]
            rand.shuffle(y)
            shuffled[period]=y
        y_by_group={(period,i):shuffled[period][i] for period in by_period
                  for i in range(len(by_period[period]))}
        counters=Counter()
        yy=[]
        for x in valid:
            idx=counters[x["period"]]
            yy.append(y_by_group[x["period"],idx])
            counters[x["period"]]+=1
        z=auc(scores,yy)
        samples.append(z)
        if abs(z-.5)>=abs(observed-.5)-1e-12:extreme+=1
    p=(extreme+1)/(PERMUTATIONS+1)
    cm={
      "trueLoseFlagged":sum(not x["sourceNativeWin30"] and x["status"]=="DIRECTION_RECHECK_REQUIRED" for x in valid),
      "sourceWinnerIncorrectlyFlagged":sum(x["sourceNativeWin30"] and x["status"]=="DIRECTION_RECHECK_REQUIRED" for x in valid),
      "sourceLoserNotFlagged":sum(not x["sourceNativeWin30"] and x["status"]!="DIRECTION_RECHECK_REQUIRED" for x in valid),
      "sourceWinnerUnflagged":sum(x["sourceNativeWin30"] and x["status"]!="DIRECTION_RECHECK_REQUIRED" for x in valid),
    }
    if cm!={"trueLoseFlagged":7,"sourceWinnerIncorrectlyFlagged":6,
            "sourceLoserNotFlagged":17,"sourceWinnerUnflagged":22}:
        raise ValueError("P16_SCORE_THRESHOLD_CONFUSION_COUNT_CHANGED")
    by_period_metrics={}
    for period,group in by_period.items():
      by_period_metrics[period]={
        "n":len(group),
        "sourceLosers":sum(not x["sourceNativeWin30"] for x in group),
        "sourceWinners":sum(x["sourceNativeWin30"] for x in group),
        "scoreLossAuc":auc([x["score"] for x in group],
          [not x["sourceNativeWin30"] for x in group]),
        "flaggedLosers":sum(not x["sourceNativeWin30"] and x["status"]=="DIRECTION_RECHECK_REQUIRED" for x in group),
        "flaggedWinners":sum(x["sourceNativeWin30"] and x["status"]=="DIRECTION_RECHECK_REQUIRED" for x in group),
      }
    report={
      "schema":"prism7-p16-frozen-score-stratified-label-permutation-v1",
      "sourceNative53":53,
      "observedAsOf2h":len(valid),
      "unobservedNoPriceH1":1,
      "originalSourceWinsTotal":29,
      "frozenScoreThreshold":3,
      "sourceLoserScoreAuc":observed,
      "permutationTestsWithinPeriod":PERMUTATIONS,
      "permutationSeed":SEED,
      "twoSidedPByCohortLabelPermutation":p,
      "confusion":cm,
      "flagPositivePredictiveLossFraction":7/13,
      "lossRecall":7/24,
      "falsePositiveRateAmongSourceWinners":6/28,
      "periodMetrics":by_period_metrics,
      "limitations":[
        "Original 53 labels, original new feature hypotheses and source data were already seen in research; this is not independent OOS.",
        "Permutation is conditional on fixed 53 scores and original cohort labels, not a posterior strategy profitability proof.",
        "Flagging an original winner is harmful if converted to a blocked/closed trade; no orders are changed.",
        "Loss recall 7/24 cannot support PENGU winrate >=80 without economic reentry and return modeling.",
      ]
    }
    out=R/"PRISM7_P16_NATIVE53_TWO_HOUR_DIRECTION_STATISTICS_20261122.json"
    out.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("PRISM7_P16_SOURCE53_ASOF2H_STAT_DIAGNOSTIC_PASS",
          json.dumps({k:report[k] for k in ("sourceLoserScoreAuc","twoSidedPByCohortLabelPermutation","confusion","periodMetrics")},ensure_ascii=False))
if __name__=="__main__":
    main()
