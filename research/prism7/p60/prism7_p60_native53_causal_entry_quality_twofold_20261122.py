#!/usr/bin/env python3
"""P60 original Native SHORT V20 53 source pre-entry H1 long/short quality scoring.
Two chronological non-overlapping test slices. Train source native 30bps labels
only if source exit +72h <= test start. All other H1 predictors taken solely
from fully completed bars before original native entry. Does NOT re-learn
production Native source thresholds or deploy any gates. All dates previously
viewed, no true unseen OOS. Includes P44 historic gate as cautionary comparator.
"""
from __future__ import annotations
import json,datetime,hashlib,math,numpy as np
from pathlib import Path
from collections import Counter
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import h1_source,moving_ema,H
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,PENGUH1,BTCH1,SOURCE
P44=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_0P75_SINGLE_SLOT_20261122.json"
OUT=R/"PRISM7_P60_NATIVE53_ENTRY_MARKET_STATE_2FOLD_CAUSAL_SCORE_20261122.json"
MD=R/"PRISM7_P60_NATIVE53_ENTRY_MARKET_STATE_2FOLD_CAUSAL_SCORE_20261122.md"
LEDGER=R/"PRISM7_P60_NATIVE53_PRIOR_H1_ASOF_NO_FUTURE_FEATURES_20261122.jsonl"
FEATURES=("btc6","penguRelative6","pengu24","btc24","penguVsEMA72","penguH1Range24")
FOLDS=(("2026_JAN_TO_AUG","2026-01-01T00:00:00Z","2026-09-01T00:00:00Z"),
 ("2026_SEP_TO_NOV","2026-09-01T00:00:00Z","2026-11-18T00:00:00Z"))
L2=8.
EMBARGO_H=72
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rd(x,n=5):return round(float(x),n)
def ts(s):return int(datetime.datetime.fromisoformat(s.replace("Z","+00:00")).timestamp()*1000)
def sigmoid(v):return 1/(1+np.exp(-np.clip(v,-25,25)))
def fit(X,y):
 X=np.asarray(X,dtype=float); y=np.asarray(y,dtype=float)
 mean=X.mean(axis=0);std=np.maximum(X.std(axis=0),.0001)
 U=np.clip((X-mean)/std,-7,7)
 base=float(np.clip(y.mean(),.03,.97))
 w=np.zeros(U.shape[1]);a=math.log(base/(1-base))
 for _ in range(1800):
  pr=sigmoid(a+U@w)
  w-=.1*((U.T@(pr-y))/len(y)+(L2/len(y))*w)
  a-=.1*(pr-y).mean()
 return {"mean":mean,"std":std,"w":w,"a":a,"trainingBaseWin":base}
def predict(model,X):
 U=np.clip((np.asarray(X,dtype=float)-model["mean"])/model["std"],-7,7)
 return sigmoid(model["a"]+U@model["w"])
def wilson(w,n):
 if n==0:return [None,None]
 z=1.95996398454;p=w/n;d=1+z*z/n
 c=(p+z*z/(2*n))/d
 h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
 return [rd(100*(c-h)),rd(100*(c+h))]
def main():
 native=json.loads(SOURCE.read_text(encoding="utf8"))
 assert len(native)==53 and sum(z["net30pct"]>0 for z in native)==29
 p,ph=h1_source(PENGUH1); b,bh=h1_source(BTCH1)
 assert len(p)==len(b) and all(x["time"]==y["time"] for x,y in zip(p,b))
 pidx={x["time"]:i for i,x in enumerate(p)}
 e72=moving_ema(p,72)
 p44=json.loads(P44.read_text(encoding="utf8"))
 flags={z["key"]:z["all3"] for z in p44["targetDetailed53"]["all53Matched"]}
 assert len(flags)==53
 events=[]
 for x in native:
  t=x["entryTs"];i=pidx.get(t-H)
  if i is None or i<200:raise ValueError("P60_SOURCE_EARLY_FEATURE_WARMUP")
  if p[i]["time"]+H!=t:raise ValueError("P60_ASOF_ENTRY_H1")
  peng6=p[i]["close"]/p[i-6]["close"]-1
  btc6=b[i]["close"]/b[i-6]["close"]-1
  peng24=p[i]["close"]/p[i-24]["close"]-1
  btc24=b[i]["close"]/b[i-24]["close"]-1
  dailyRange=sum((v["high"]-v["low"])/v["close"] for v in p[i-23:i+1])/24
  ft={"btc6":btc6,"penguRelative6":peng6-btc6,
    "pengu24":peng24,"btc24":btc24,
    "penguVsEMA72":p[i]["close"]/e72[i]-1,
    "penguH1Range24":dailyRange}
  if any(not math.isfinite(v) for v in ft.values()):raise ValueError("P60_NAN")
  key=x["period"]+"|"+x["id"]+"|"+str(t)
  events.append({"key":key,"period":x["period"],"entryTs":t,"exitTs":x["exitTs"],
   "entryH1FeatureKnownAtTs":p[i]["time"]+H,
   "allPreEntryH1Closed":True,
   "nativeNet30Pct":x["net30pct"],"win30bps":x["net30pct"]>0,
   "features":ft,"featuresVector":[ft[k] for k in FEATURES],
   "P44PreDropEarlierAll3HistoricalGate":flags[key]})
 events.sort(key=lambda z:z["entryTs"])
 assert len(events)==53 and len({z["key"] for z in events})==53
 folds=[];records=[]
 for name,start,end in FOLDS:
  left,right=ts(start),ts(end)
  train=[x for x in events if x["exitTs"]+EMBARGO_H*H<=left and x["entryTs"]<left]
  test=[x for x in events if left<=x["entryTs"]<right]
  if len(train)<18 or len(test)<10:raise ValueError("P60_SPARSE_TRAIN_OR_TEST:"+name)
  mdl=fit([x["featuresVector"] for x in train],[float(x["win30bps"]) for x in train])
  pscore=predict(mdl,[z["featuresVector"] for z in test])
  y=np.array([float(x["win30bps"]) for x in test])
  baseline=np.full(len(test),mdl["trainingBaseWin"])
  brier=rd(np.mean((pscore-y)**2));baselineBrier=rd(np.mean((baseline-y)**2))
  gates={}
  for tag,selected in [
    ("BASE_EVERY_NATIVE_SIGNAL",test),
    ("REGULARIZED_H1_SCORE_GE50",[z for z,q in zip(test,pscore) if q>=.50]),
    ("REGULARIZED_H1_SCORE_GE60",[z for z,q in zip(test,pscore) if q>=.60]),
    ("P44_OLD_ALL3_CONTEXT_DIAGNOSTIC",[z for z in test if z["P44PreDropEarlierAll3HistoricalGate"]])]:
    w=sum(z["win30bps"] for z in selected)
    gates[tag]={"cases":len(selected),"wins":w,"losses":len(selected)-w,
      "winrate":rd(100*w/len(selected)) if selected else None,
      "Wilson95":wilson(w,len(selected)),
      "sourceGross075Net30PctPointsNotPortfolio":rd(sum(z["nativeNet30Pct"]*.75 for z in selected)),
      "winnersRetainedFromAllTest":w,
      "sourceCohorts":dict(Counter(z["period"] for z in selected))}
  for z,q in zip(test,pscore):
    records.append({"id":z["key"],"fold":name,"scoreAsOfOriginalNativeEntry":rd(q),
     "originalNativeWinLabelONLYAfterExit":z["win30bps"],
     "scoreGe50":bool(q>=.5),"scoreGe60":bool(q>=.6),
     "historicalP44Selected":z["P44PreDropEarlierAll3HistoricalGate"],
     "entryTs":z["entryTs"],"exitTs":z["exitTs"],
     "noOutcomeUsedAtPredictionTime":True})
  folds.append({"fold":name,"trainN":len(train),"trainWins":sum(z["win30bps"] for z in train),
   "testN":len(test),"testWins":int(y.sum()),"brier":brier,
   "trainRateConstantBrier":baselineBrier,"modelBeatsConstantBrier":brier<baselineBrier,
   "fitL2Regularizer":L2,"trainLabelExitEmbargoH":EMBARGO_H,
   "gateOutcomes":gates,
   "trainingWeightsAtFoldStart":{"intercept":rd(mdl["a"]),
      "featureWeights":{k:rd(v) for k,v in zip(FEATURES,mdl["w"])}}})
 assert len(records)==sum(x["testN"] for x in folds)==27
 report={"schema":"prism7-p60-native53-pinned-source-H1-entry-quality-chronological-twofold-falsification/v1",
   "status":"RESEARCH_ONLY__ALREADY_VIEWED_DATES__NO_NEW_ENTRY_MODEL_ACCEPTED",
   "pinnedSource53Original29Winners":True,"sourceOriginalNative53Unmodified":True,
   "causalFeaturesUsedOnlyLastFullH1BeforeOriginalNativeEntry":True,
   "predeclaredSixSourceH1Predictors":FEATURES,"regularizerL2":L2,
   "trainingNativeExitLabelPurgeHours":EMBARGO_H,
   "sourceOriginal53":53,
   "foldWindows":FOLDS,"folds":folds,"foldOutOfSampleSourceTestPredictionLedger":records,
   "P44GatePriorHistoricallyTunedNotIndependent":True,
   "sampleSource53OverlapAndPriorInspectionCaveat":True,
   "sourceSHA256":{"native53":sha(SOURCE),"P44":sha(P44),"PENGUH1":ph,"BTCH1":bh},
   "limitations":[
      "Chronological test folds are not independently untouched: P8-P59 already inspected these exact historical data.",
      "Only 27 original source events are test predictions across 2 time windows, vulnerable to regime and winner count uncertainty.",
      "Original 53 native intents may overlap; per-signal net returns do not represent executable one-slot NAV or total-Runner DD.",
      "Source H1 values may require current LIVE pin exact technical indicators, beyond these simple predictive features.",
      "Training WIN labels available only after Native source exit +72h; no outcome of test interval read for train in the same fold.",
      "P44 earlier downcross 19/21 results from prior retrospective tuning and is shown solely as an already-viewed control.",
      "No API trade, STOP, Code, GitHub master, owner permissions, Risk, VPS changes."
   ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in events),encoding="utf8")
 lines=["# P60: native V20 entry-time quality classifier, frozen source53, causal H1 features",
    "",
    "Original Native source53 (29 wins,24 losses). Fixed 6 H1 pre-entry as-of features, L2 regularization and 72h after-EXIT train purge, 2 non-overlapping chronological test periods already previously inspected.",
    "",
    "| Test period | Train | Test | Brier model | Baseline Brier | 0.50 gate wins/cases | 0.60 gate wins/cases | Hist P44 gate |",
    "|---|---:|---:|---:|---:|---|---|---|"]
 for f in folds:
  g=f["gateOutcomes"]
  lines.append("| "+f["fold"]+" | "+str(f["trainN"])+" | "+str(f["testN"])+" | "+str(f["brier"])+" | "+str(f["trainRateConstantBrier"])+" | "+str(g["REGULARIZED_H1_SCORE_GE50"]["wins"])+"/"+str(g["REGULARIZED_H1_SCORE_GE50"]["cases"])+" | "+str(g["REGULARIZED_H1_SCORE_GE60"]["wins"])+"/"+str(g["REGULARIZED_H1_SCORE_GE60"]["cases"])+" | "+str(g["P44_OLD_ALL3_CONTEXT_DIAGNOSTIC"]["wins"])+"/"+str(g["P44_OLD_ALL3_CONTEXT_DIAGNOSTIC"]["cases"])+" |")
 lines+=["","Not independent untouched holdout; in-source source native entries not LIVE signed fills or full STOP parity. Use this to identify unstable early regime, not automatic new LIVE filter."]
 MD.write_text("\n".join(lines)+"\n",encoding="utf8")
 print("P60_SOURCE_NATIVE53_PREDROP_ASOF_H1_ENTRY_TWO_CHRONOLOGICAL_FOLD_EVIDENCE_PASS",
    json.dumps({"testedEvents":len(records),"folds":[{"period":x["fold"],"train":x["trainN"],"test":x["testN"],
        "brier":x["brier"],"baseBrier":x["trainRateConstantBrier"],
        "gates":{k:{"wins":v["wins"],"n":v["cases"]} for k,v in x["gateOutcomes"].items()}}
        for x in folds]},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
