#!/usr/bin/env python3
"""PRISM VII: exploratory as-of fingerprints of 11 WRONG-SHORT vs 29 winners.

AUC is used for attribution only. Hypotheses selected after observing earlier
PRISM cases are not preregistered, the 53 cases are known; even a low p-value
cannot establish OOS directional edge. All candidates retained.
"""
from __future__ import annotations
import argparse
import csv
import json
import math
import random
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median
from prism7_native53_event_attribution_20261122 import load_csv,qtl

SEED=20261122
N_PERM=5000
FEATURES=[
    ("flow_buy_share3",+1),
    ("flow_buy_share6",+1),
    ("p_return_3h",+1),
    ("p_return_6h",+1),
    ("btc_return_6h",+1),
    ("prior_low6_distance_atr",+1),
    ("efficiency6",-1),
    ("atr24_ratio",+1),
]


def auc_pos(x):
    """Pairs of failures vs wins for high-feature predicts failure."""
    losses=[v for v,label in x if label]
    wins=[v for v,label in x if not label]
    n=len(losses)*len(wins)
    if n<=0:return None
    return (sum(1.0 if a>b else .5 if a==b else 0.0 for a in losses for b in wins)/n)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--entries",type=Path,required=True)
    ap.add_argument("--anatomy",type=Path,required=True)
    ap.add_argument("--out",type=Path,required=True)
    a=ap.parse_args()
    entries=load_csv(a.entries)
    anatomy=load_csv(a.anatomy)
    mp={"PRE_AUG_SEP_2025":"PRE_2025_AUG_SEP","POST_OCT_NOV_2026":"POST_2026_OCT_NOV"}
    taxonomy={(mp.get(r["period"],r["period"]),r["id"]):r["diagnostic_category"]
              for r in anatomy if r["route"]=="SHORT_V20"}
    rows=[]
    for item in entries:
        key=(item["period"],item["original_signal_id"])
        if key not in taxonomy:raise ValueError(f"UNMATCHED_SOURCE:{key}")
        feat=json.loads(item["features"])
        category=taxonomy[key]
        if category not in ("WIN_NATIVE_EXIT_PRICE_MODEL","NO_FAVORABLE_ONE_PERCENT"):
            continue
        rows.append({"period":item["period"],"id":item["original_signal_id"],
           "failure":category=="NO_FAVORABLE_ONE_PERCENT","feat":feat})
    assert len(rows)==40 and sum(r["failure"] for r in rows)==11
    groups=defaultdict(list)
    for index,r in enumerate(rows):groups[r["period"]].append(index)
    perm_seed=random.Random(SEED)
    result=[]
    for feature,orientation in FEATURES:
        z=[orientation*float(r["feat"][feature]) for r in rows]
        if not all(math.isfinite(v) for v in z):raise ValueError(f"NONFINITE_FEATURE:{feature}")
        base=auc_pos(list(zip(z,[r["failure"] for r in rows])))
        # Permute outcomes ONLY within each period: exact period mix preserved.
        # NB: individual trades are not independent, so p is descriptive only.
        exceed=0
        for k in range(N_PERM):
            labels=[r["failure"] for r in rows]
            for indices in groups.values():
                perm=[labels[i] for i in indices]
                perm_seed.shuffle(perm)
                for i,v in zip(indices,perm):labels[i]=v
            ap=auc_pos(list(zip(z,labels)))
            if abs(ap-.5)>=abs(base-.5)-1e-12:exceed+=1
        pval=(exceed+1)/(N_PERM+1)
        v_bad=[r["feat"][feature] for r in rows if r["failure"]]
        v_good=[r["feat"][feature] for r in rows if not r["failure"]]
        result.append({"feature":feature,"orientation":"high_means_failure" if orientation>0 else "low_means_failure",
           "win_native29_median":round(median(v_good),7),
           "no_favorable11_median":round(median(v_bad),7),
           "auc":round(base,6),
           "stratified_period_permutation_p_descriptive":round(pval,6)})
    ordered=sorted(range(len(result)),key=lambda i:result[i]["stratified_period_permutation_p_descriptive"])
    prev=0.
    for rank,i in enumerate(ordered):
        pval=result[i]["stratified_period_permutation_p_descriptive"]
        adjusted=min(1.,pval*(len(result)-rank))
        prev=max(prev,adjusted)
        result[i]["holm_8_features_p_descriptive"]=round(prev,6)
    res={
        "schema":"prism7-native-short-v20-11failure-29winner-asof-exploratory-discriminability/v1",
        "n_total_native_intents":53,
        "sample_11_failure_vs_29_win":40,
        "native_no_favorable_1pct":11,"native_wins":29,
        "fixed_features_not_thresholds":len(FEATURES),
        "permutation_seed":SEED,"permutations_per_feature":N_PERM,
        "permuted_within_period":True,
        "results":result,
        "limitations":[
            "All three data periods and many feature statistics are previously observed; this is explicitly NOT preregistered/OOS.",
            "No entry gate, no dropped candidates, no alternative native entry/exit, no portfolio DD.",
            "Multiple candidate features and multiple losses make apparently favorable comparisons optimistic.",
            "Permutation is stratified by period but overlapping trade windows violate independence.",
            "AUC high for retrospective cases cannot be deployed without independent forward validation.",
            "11 no-favorable cases are negative *native outcome*; cannot infer true future market regime from signal alone.",
        ],
    }
    a.out.parent.mkdir(parents=True,exist_ok=True)
    a.out.write_text(json.dumps(res,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("P7_DIRECTION_ASOF_DIAG_PASS 11_LOSS_29_WIN 8_FEATURES")
    for x in sorted(result,key=lambda z:z["auc"],reverse=True):print(json.dumps(x))
    print("OUT",a.out)

if __name__=="__main__":main()
