#!/usr/bin/env python3
"""PRISM7 P50: diagnostic falsification of six P49 as-of H1 features.
AUC univariate winner discrimination by period; month-block circular-shift
negative control and familywise maximum-statistic p-value.
NO new trading rules or threshold search, NO deployment.
"""
from __future__ import annotations
import json,hashlib,math,random,numpy as np,datetime
from collections import Counter,defaultdict
from pathlib import Path
R=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\results")
P49=R/"PRISM7_P49_STRICT_FIRST_DOWNLEG_CHRONOLOGICAL_CALIBRATION_20261122.json"
ROWS=R/"PRISM7_P49_STRICT_FIRST_DOWNLEG_H1_PREARM_OUTCOME_LEDGER_20261122.jsonl"
OUT=R/"PRISM7_P50_PREONSET_FEATURE_STABILITY_FAMILYWISE_NULL_20261122.json"
MD=R/"PRISM7_P50_PREONSET_FEATURE_STABILITY_FAMILYWISE_NULL_20261122.md"
FEATURES=("btc24","rel24","ema72_168","sellerShare6","lowerHighShare6","pCloseVsEMA72")
SEED=20261122
PERMUTATIONS=500
def rnd(x,n=5):return round(float(x),n)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def auc_one(values,labels):
    X=np.array(values,dtype=float);y=np.array(labels,dtype=int)
    pos=X[y==1];neg=X[y==0]
    if len(pos)==0 or len(neg)==0:return None
    return float(((pos[:,None]>neg[None,:]).sum()+
        .5*(pos[:,None]==neg[None,:]).sum())/(len(pos)*len(neg)))
def main():
    p49=json.loads(P49.read_text(encoding="utf8"))
    data=[json.loads(x) for x in ROWS.read_text(encoding="utf8").splitlines() if x.strip()]
    assert len(data)==107 and len({x["id"] for x in data})==107
    assert p49["sixPrearmOnlyFeaturesFixed"]==list(FEATURES)
    assert len(p49["foldReports"])==3
    sample=[z for z in data if z["label"]["winAt30bps"] is not None]
    sample.sort(key=lambda x:x["intentTs"])
    X=np.asarray([[z["feats"][k] for k in FEATURES] for z in sample],dtype=float)
    y=np.asarray([int(z["label"]["winAt30bps"]) for z in sample],dtype=int)
    assert X.shape[1]==6 and len(sample)>=95 and np.isfinite(X).all()
    assert y.sum()>20 and y.sum()<len(y)-20
    co=[z["cohort"] for z in sample]
    month=[datetime.datetime.fromtimestamp(z["intentTs"]/1000,datetime.timezone.utc).strftime("%Y-%m")
           for z in sample]
    months=defaultdict(list)
    for i,m in enumerate(month):months[m].append(i)
    base={k:auc_one(X[:,j],y) for j,k in enumerate(FEATURES)}
    nullmax=[]
    nullsingle={k:[] for k in FEATURES}
    rng=random.Random(SEED)
    for _ in range(PERMUTATIONS):
       tmp=y.copy()
       for k,ids in months.items():
          if len(ids)<2:continue
          shift=rng.randrange(1,len(ids))
          a=[int(y[t]) for t in ids]
          for pos,t in enumerate(ids):tmp[t]=a[(pos+shift)%len(ids)]
       each={k:auc_one(X[:,j],tmp) for j,k in enumerate(FEATURES)}
       vals=[abs(v-.5) for v in each.values() if v is not None]
       if not vals:raise ValueError("P50_NO_NULL_STATS")
       nullmax.append(max(vals))
       for k,v in each.items():nullsingle[k].append(abs(v-.5) if v is not None else 0)
    periods=[
      ("PRE_2025_AUG_SEP",lambda z:z["cohort"]=="PRE_2025_AUG_SEP"),
      ("BASE_2025_2026",lambda z:z["cohort"]=="BASE_2025_2026"),
      ("POST_2026_OCT_NOV",lambda z:z["cohort"]=="POST_2026_OCT_NOV"),
      ("FOLD1_MAR_MAY",lambda z:179==0 or 1772323200000<=z["intentTs"]<1780272000000),
      ("FOLD2_JUN_AUG",lambda z:1780272000000<=z["intentTs"]<1788220800000),
      ("FOLD3_SEP_NOV",lambda z:1788220800000<=z["intentTs"]<1794960000000),
    ]
    out_features=[]
    for j,k in enumerate(FEATURES):
       o=base[k]
       ref=(1+sum(v>=abs(o-.5)-1e-12 for v in nullmax))/(1+PERMUTATIONS)
       local={}
       for name,fn in periods:
          subset=[q for q,z in enumerate(sample) if fn(z)]
          local[name]={"cases":len(subset),"wins":int(y[subset].sum()) if subset else 0,
             "auc":rnd(auc_one(X[subset,j],y[subset])) if subset and auc_one(X[subset,j],y[subset]) is not None else None}
       coef=[fold["featureWeightsAsOfEarliestPriorH1"]["weights"][k] for fold in p49["foldReports"]]
       out_features.append({"asOfFeature":k,
          "allRawCandidatesKnownWins":int(y.sum()),"allRawCandidatesKnownLosses":int(len(y)-y.sum()),
          "originalAUC":rnd(o),
          "FWER_monthwiseCircularShiftMaxNullP":rnd(ref),
          "signAcrossThreeModelTrainingFolds":[1 if w>0 else (-1 if w<0 else 0) for w in coef],
          "aucByCohortAndChronologicalFold":local,
          "notCausalEffectOrDeployableEntryRule":True
       })
    report={"schema":"prism7-p50-multi-comparison-feature-stability-negative-control/v1",
      "status":"OBSERVATIONAL_HINDSIGHT_RESEARCH_NOT_UNSEEN_OOS",
      "sourceOriginalNative53Preserved":True,
      "parentP49LabelPurgingPreserved":True,
      "allStrictCleanH1OnsetCandidates":len(data),
      "allWithKnownRef72Exit":len(sample),
      "reference30bpsWinLabels":int(y.sum()),
      "reference30bpsLossLabels":int(len(y)-y.sum()),
      "featuresFirstObservedSixCompletedH1BeforeOnset":list(FEATURES),
      "familywiseNegativeControl":{"method":"within-month nonzero circular shift of labels (preserves per-month class mix and serial block, but not full risk autocorrelation)",
        "seed":SEED,"permutations":PERMUTATIONS,
        "maxAbsoluteAUCDepartureFrom0p5Null95":rnd(float(np.quantile(np.array(nullmax),.95))),
        "notIndependentBlindedExperiment":True},
      "features":out_features,
      "passingFamilywiseP0p05":[x["asOfFeature"] for x in out_features if x["FWER_monthwiseCircularShiftMaxNullP"]<=.05],
      "sourceHash":{"P49Report":sha(P49),"P49PerCandidate":sha(ROWS)},
      "limits":[
        "All candidate periods previously seen in P8-P49. Even low p after correction would be discovery, not independent confirmation.",
        "Within-month circular shifts are limited null controls, and H1 first-break episodes are serially dependent.",
        "Feature values are known at pre-arm6 but labels depend on post-entry P20 reference Stop72 outcomes, not Native V20 exact exit.",
        "AUC can be inverted and wins selected, but we explicitly DO NOT choose directions/thresholds from this study.",
        "Effective sample 107 small, especially pre and post cohorts, and event labels can overlap source M5 paths.",
        "None of the feature statistics certifies LIVE execution, real fill, funding, actual portfolio DD or a future 80% win rate.",
        "Do not promote failed Layer A prediction or replace source PENGU Native V20 on these correlations."
      ]}
    OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    lines=["# P50: Which strict-before-first-drop H1 characteristics survive multiple-comparison controls?",
      "",
      "Pre-event 6 features, 107 strict first-break signals, P20 research stop72 wins/losses. All dates previously inspected; no true unseen OOS.",
      "",
      "| Feature | All-sample AUC | Familywise month-shift null p | PRE AUC | BASE AUC | POST AUC | Training coefficient signs |",
      "|---|---:|---:|---:|---:|---:|---|"]
    for v in out_features:
      d=v["aucByCohortAndChronologicalFold"]
      lines.append("| "+v["asOfFeature"]+" | "+str(v["originalAUC"])+" | "+
          str(v["FWER_monthwiseCircularShiftMaxNullP"])+" | "+
          str(d["PRE_2025_AUG_SEP"]["auc"])+" | "+
          str(d["BASE_2025_2026"]["auc"])+" | "+
          str(d["POST_2026_OCT_NOV"]["auc"])+" | "+
          ",".join(str(k) for k in v["signAcrossThreeModelTrainingFolds"])+" |")
    lines.extend(["","**Familywise passing features**: "+str(report["passingFamilywiseP0p05"])+". No new trading rule inferred. Recheck on untouched future data.", ""])
    MD.write_text("\n".join(lines),encoding="utf8")
    print("P50_FEATURE_AUC_WITH_MONTH_BLOCK_NULL_AND_FAMILYWISE_TEST_PASS",json.dumps({
       "sample":len(sample),"wins":int(y.sum()),
       "features":[{"k":x["asOfFeature"],"AUC":x["originalAUC"],
           "FWER":x["FWER_monthwiseCircularShiftMaxNullP"],
           "PRE":x["aucByCohortAndChronologicalFold"]["PRE_2025_AUG_SEP"],
           "BASE":x["aucByCohortAndChronologicalFold"]["BASE_2025_2026"],
           "POST":x["aucByCohortAndChronologicalFold"]["POST_2026_OCT_NOV"],
           "wSigns":x["signAcrossThreeModelTrainingFolds"]} for x in out_features],
       "familywisePassing":report["passingFamilywiseP0p05"],
       "null95":report["familywiseNegativeControl"]["maxAbsoluteAUCDepartureFrom0p5Null95"]
     },ensure_ascii=False),flush=True)
    print("FILES",OUT,MD)
if __name__=="__main__":main()
