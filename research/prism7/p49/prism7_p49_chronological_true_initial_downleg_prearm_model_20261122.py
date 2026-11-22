#!/usr/bin/env python3
"""PRISM VII P49: true first-downleg pre-event Layer A causal ranking.

INDEPENDENT CHRONOLOGICAL SPLITS WITH 72H LABEL PURGE, not untouched data:
P8-P48 already inspected same source chronology.
Do not use post-trigger/exit features to train or decide entry.
Tests plain stable logistic model (6 features from pre-event H1 i-6) vs:
 - take all clean B initial short breaks;
 - already-frozen 3-bearish-flags at six H1 before B.
Uses original P20 research STOP72 overlay (not native V20), 0.75x.
Score cutoff 0.50/0.60 predeclared, L2=4, no outcome-tuned thresholds.

The purpose is to falsify a predictive precondition, NOT optimize sample PnL.
"""
from __future__ import annotations
import json,datetime,hashlib,math,numpy as np
from collections import Counter,defaultdict
from pathlib import Path
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import (
    h1_source,moving_ema,stop72,execution_proxy,H,M5,DATA_END
)
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import (
    R,SOURCES,PENGUH1,BTCH1,SOURCE,single_slot,economic,GROSS
)
P48=R/"PRISM7_P48_TRUE_FIRST_DOWNLEG_ALL_CANDIDATES_LEDGER_20261122.jsonl"
OUT=R/"PRISM7_P49_STRICT_FIRST_DOWNLEG_CHRONOLOGICAL_CALIBRATION_20261122.json"
MD=R/"PRISM7_P49_STRICT_FIRST_DOWNLEG_CHRONOLOGICAL_CALIBRATION_20261122.md"
LEDGER=R/"PRISM7_P49_STRICT_FIRST_DOWNLEG_H1_PREARM_OUTCOME_LEDGER_20261122.jsonl"
MODELS=("BASE_ALL_CLEAN","FIXED_PREARM6_BEAR_ALL3","LOGIT_L2_THRESHOLD_0P50","LOGIT_L2_THRESHOLD_0P60")
FEATURES=("btc24","rel24","ema72_168","sellerShare6","lowerHighShare6","pCloseVsEMA72")
FOLDS=(
 ("2026_MAR_TO_MAY","2026-03-01T00:00:00Z","2026-06-01T00:00:00Z"),
 ("2026_JUN_TO_AUG","2026-06-01T00:00:00Z","2026-09-01T00:00:00Z"),
 ("2026_SEP_TO_NOV","2026-09-01T00:00:00Z","2026-11-18T00:00:00Z"),
)
L2=4.
EMBARGO_H=72
def ts(s):return int(datetime.datetime.fromisoformat(s.replace("Z","+00:00")).timestamp()*1000)
def sha(f):return hashlib.sha256(Path(f).read_bytes()).hexdigest()
def rnd(x,n=5):return round(float(x),n)
def batch_sigmoid(z):return 1/(1+np.exp(-np.clip(z,-20,20)))
def logistic_fit(raw_x,y):
    X=np.asarray(raw_x,dtype=float)
    y=np.asarray(y,dtype=float)
    mu=X.mean(axis=0)
    std=X.std(axis=0)
    std=np.maximum(std,np.array([.001,.001,.001,.02,.03,.001]))
    U=(X-mu)/std
    U=np.clip(U,-8,8)
    rate=np.clip(y.mean(),.04,.96)
    intercept=float(np.log(rate/(1-rate)))
    w=np.zeros(U.shape[1])
    # Fixed positive L2 penalty: stronger when training sample is small.
    for epoch in range(1500):
      probs=batch_sigmoid(intercept+U@w)
      grad=(U.T@(probs-y))/len(y)+L2/len(y)*w
      grad0=float((probs-y).mean())
      w-=.1*grad
      intercept-=.1*grad0
    return {"mu":mu,"std":std,"w":w,"intercept":intercept}
def probs_for(fit,x):
    X=np.asarray(x,dtype=float)
    Z=np.clip((X-fit["mu"])/fit["std"],-8,8)
    return batch_sigmoid(fit["intercept"]+Z@fit["w"])
def feature(x,p,b,idx,e72,e168):
    i=idx[x["signalReferenceTs"]]
    j=i-6
    if j<182:raise ValueError("P49_PREARM_WARMUP")
    ap=x["P48preOnsetProvenance"]
    if p[j]["time"]!=ap["prearm6Time"]:
        raise ValueError("P49_SIX_H1_PREARM_REF_MISMATCH")
    if p[j]["time"]+H>=x["intentTs"]:
        raise ValueError("P49_FEATURE_FUTURE")
    seg=p[j-5:j+1]
    vol=sum(z["volume"] for z in seg)
    seller=sum(z["volume"] for z in seg if z["close"]<z["open"])/vol if vol>0 else .5
    lower=sum(p[k]["high"]<p[k-1]["high"] for k in range(j-4,j+1))/5
    p24=p[j]["close"]/p[j-24]["close"]-1
    b24=b[j]["close"]/b[j-24]["close"]-1
    # All source values use H1 bars ending before Layer B.
    out={
      "btc24":b24,
      "rel24":p24-b24,
      "ema72_168":e72[j]/e168[j]-1,
      "sellerShare6":seller,
      "lowerHighShare6":lower,
      "pCloseVsEMA72":p[j]["close"]/e72[j]-1,
    }
    if not all(math.isfinite(v) for v in out.values()):
      raise ValueError("P49_NONFINITE_PREARM_FEATURE")
    return out
def main():
    native=json.loads(SOURCE.read_text(encoding="utf8"))
    assert len(native)==53 and sum(x["net30pct"]>0 for x in native)==29
    p,pH=h1_source(PENGUH1);b,bH=h1_source(BTCH1)
    assert len(p)==len(b) and all(u["time"]==v["time"] for u,v in zip(p,b))
    m5,msha=load_m5(SOURCES)
    idx={x["time"]:i for i,x in enumerate(p)}
    e72=moving_ema(p,72);e168=moving_ema(p,168)
    raw=[json.loads(x) for x in P48.read_text(encoding="utf8").splitlines() if x.strip()]
    assert len(raw)==149
    clean=[z for z in raw if z["P48preOnsetProvenance"]["prearm6NoPriorMinus3Pct"] and
       z["P48preOnsetProvenance"]["prearmToBeforeBreakNoDown3Pct"] and
       z["P48preOnsetProvenance"]["prearmToBeforeBreakPriorStructuralBreakCount"]==0]
    assert len(clean)==107
    # First M5 after intent and causal STOP72 labels; labelled samples may overlap,
    # so only trading book selection below is single-slot.
    sourced=[]
    for z in clean:
      feat=feature(z,p,b,idx,e72,e168)
      found=execution_proxy(m5,z["intentTs"])
      if found is None:
        label={"status":"NO_POSITIVE_M5_PRINT","exitTs":None,"winAt30bps":None,"nativeStop72":False}
      else:
        et,price,offset=found
        stop=stop72(m5,et,price)
        priceout=stop.get("exitPrice")
        pnl=100*(1-priceout/price)-.3 if priceout is not None else None
        label={"status":stop["status"],"entryTs":et,"entryPrice":price,"exitTs":stop.get("exitTs"),
          "exitPrice":priceout,"netShort30bpsNotionalPct":rnd(pnl) if pnl is not None else None,
          "winAt30bps":pnl>0 if pnl is not None else None,"sourceNativeV20ExitProven":False}
      sourced.append({"id":z["id"],"intentTs":z["intentTs"],"cohort":z["cohort"],
        "featureAsOfTs":z["P48preOnsetProvenance"]["prearm6Time"]+H,
        "prearm6H1AlreadyMinus3":False,
        "sourceRecordedBar":z,
        "feats":feat,"features":[feat[k] for k in FEATURES],
        "label":label})
    source_by_id={z["id"]:z for z in sourced}
    if len(source_by_id)!=len(sourced):raise ValueError("P49_SOURCE_DUPLICATE")
    if sum(z["label"]["winAt30bps"] is not None for z in sourced)<95:
        raise ValueError("P49_TOO_MANY_CENSORED_LABELS")
    # Baseline no-future per-event label may be measured on overlapped natural trades;
    # only single-slot economics count as a sequential research book.
    cache={}
    reports=[]
    scored_events=[]
    for name,start,end in FOLDS:
       begin,endTs=ts(start),ts(end)
       train=[z for z in sourced if z["intentTs"]<begin and
            z["label"]["winAt30bps"] is not None and
            z["label"]["exitTs"] is not None and
            z["label"]["exitTs"]+EMBARGO_H*H<=begin]
       test=[z for z in sourced if begin<=z["intentTs"]<endTs]
       if len(train)<18 or len(test)<4:raise ValueError("P49_FOLD_UNDERPOPULATED:"+name+":"+str(len(train))+":"+str(len(test)))
       X=[z["features"] for z in train]
       Y=[float(z["label"]["winAt30bps"]) for z in train]
       fit=logistic_fit(X,Y)
       testprob=probs_for(fit,[x["features"] for x in test])
       known=[(z,p) for z,p in zip(test,testprob) if z["label"]["winAt30bps"] is not None]
       if known:
          brier=rnd(sum((float(z["label"]["winAt30bps"])-float(q))**2 for z,q in known)/len(known))
          basewin=sum(Y)/len(Y)
          baselineBrier=rnd(sum((float(z["label"]["winAt30bps"])-basewin)**2 for z,q in known)/len(known))
       else:brier=baselineBrier=None
       fgroup={"fold":name,"firstTestIntentTs":begin,"lastExclusiveTestIntentTs":endTs,
          "trainAvailableAndEmbargoed":len(train),"trainSourceWins":int(sum(Y)),
          "testSourceCandidates":len(test),"testSourceWinsLabel":sum(z["label"]["winAt30bps"] is True for z in test),
          "testKnownLabels":len(known),"brierProbabilistic":brier,
          "brierTrainBaseRate":baselineBrier,"trainBaseWinFraction":rnd(sum(Y)/len(Y)),
          "featureWeightsAsOfEarliestPriorH1":{"intercept":rnd(fit["intercept"]),
            "weights":{k:rnd(v) for k,v in zip(FEATURES,fit["w"])}},
          "models":[]}
       for model in MODELS:
          if model=="BASE_ALL_CLEAN":
             subset=test
          elif model=="FIXED_PREARM6_BEAR_ALL3":
             subset=[z for z in test if z["sourceRecordedBar"]["layerA"]["prearmahead"][1]["all3"]]
          else:
             cutoff=.5 if model.endswith("0P50") else .6
             subset=[z for z,q in zip(test,testprob) if q>=cutoff]
          selected,block=single_slot([z["sourceRecordedBar"] for z in subset],cache,m5)
          regular=economic(selected,m5,30,0)
          stressed=economic(selected,m5,30,100)
          v={"model":model,"fold":name,"candidateCount":len(subset),
             "selectedCount":len(selected),"blocked":block["blocked"],
             "normal30bps":regular,"extra100bpsCoverStress":stressed}
          fgroup["models"].append(v)
       for z,prob in zip(test,testprob):
          scored_events.append({"id":z["id"],"fold":name,"cohort":z["cohort"],
             "featureAsOfTs":z["featureAsOfTs"],"onsetIntentTs":z["intentTs"],
             "prearm6Features":z["feats"],"scoreAtTime":rnd(prob),
             "threshold0p6Pass":bool(prob>=.6),
             "sourceM5Stop72OutcomesDoNotEnterModelFeatures":z["label"]})
       reports.append(fgroup)
    if len(reports)!=3:raise ValueError("P49_NOT_THREE_FOLDS")
    summary={"schema":"prism7-p49-strict-first-downleg-chronological-purged-6h-before-onset-layerA/v1",
       "status":"DO_NOT_PROMOTE__ALL_DATES_ALREADY_RESEARCH_VIEWED",
       "originalNative53Unchanged":True,"native53Winners":29,"originalNative53Losers":24,
       "allRawInitialB1Events":len(raw),"strictFirstDownlegCleanCandidates":len(sourced),
       "candidatePrearmH1Known6hPriorToEntry":True,
       "sixPrearmOnlyFeaturesFixed":list(FEATURES),
       "modelClass":"logistic_standardized_l2_4_fixed_threshold_50_60",
       "regularizationL2":L2,"foldTrainingLabelPurgeHours":EMBARGO_H,
       "foldsSplitChronologically":FOLDS,
       "independentUntouchedOOS":False,
       "trainingLabelsM5FirstPriceAndP20ReferenceStop72":True,
       "nativeV20SourceExitParityForAlternativeB":False,
       "sampleSource53NotUsedAsTrainingLabels":True,
       "foldReports":reports,"allFoldTestPredictions":scored_events,
       "gross":GROSS,"feeBps":30,"extraCoverSlippageStressBps":100,
       "sourceHashes":{"P48CandidateLedger":sha(P48),"H1PENGU":pH,"H1BTC":bH,"M5PENGU":msha,"Native53":sha(SOURCE)},
       "criticalLimitations":[
          "Chronological is not unseen OOS: same market intervals investigated extensively P8-P48; repeated use is research selection, not independent certification.",
          "Train labels from non-portfolio candidates can overlap and share correlated price paths, so effective sample is smaller than 107.",
          "A proposed logistic model fitted to historical losses even with fixed hyperparameters can overfit; need independent data and many negative controls.",
          "Training embargo uses strict source-exit+72h gap, not complete exchange data-freshness proof.",
          "Each fold's hypothetical single-slot book begins flat at the test boundary (not a continuous live book); no portfolio transfer state across fold edges.",
          "Source P20 reference STOP is not native phase V20 source exit and has intrabar M5 high/low ambiguity.",
          "P48 early preparation only rules out 24h end-to-end fall >=3 and prior five H1 big structural breaks, not every minor prior price tick decline.",
          "Fixed gross 0.75 30bps and 100bps worse cover not real signed fills; no funding, orderbook, shared risk, liquidation, other active runners.",
          "No production orders or source code changed; exploratory predictions must not be used as LIVE authorization."
       ]}
    OUT.write_text(json.dumps(summary,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    LEDGER.write_text("".join(json.dumps({k:v for k,v in z.items() if k!="sourceRecordedBar"},ensure_ascii=False,sort_keys=True)+"\n" for z in sourced),encoding="utf8")
    lines=["# P49 pre-onset causal prediction check, full strict-first H1 source (6h prior)",
      "",
      "107 strict clean first-onset candidates. Fixed 6 numerical predictors from six full H1 bars before Layer B. No post-entry price in eligibility. Train label embargo 72h and 3 chronological test windows.",
      "",
      "| Fold | Model | n candidate | n closed | n won | Win rate | DD high | NAV | 100bps stress win |",
      "|---|---|---:|---:|---:|---:|---:|---:|"]
    for fold in reports:
      for z in fold["models"]:
        e=z["normal30bps"];s=z["extra100bpsCoverStress"]
        lines.append("| "+fold["fold"]+" | "+z["model"]+" | "+str(z["candidateCount"])+
         " | "+str(e["closed"])+" | "+str(e["wins"])+" | "+str(e["conditionalWinPct"])+"% | "+str(e["M5HighStressDDPct"])+"% | "+str(e["finalProxyNavYen"])+" | "+str(s["conditionalWinPct"])+"% |")
    lines+=["","No untouched blind OOS. Model performance must be rejected for deployment regardless of good in-sample/chronological subsections without independently sourced future periods."]
    MD.write_text("\n".join(lines)+"\n",encoding="utf8")
    print("P49_STRICT_FIRST_DROP_PRE_ARM6_CHRONOLOGICAL_LABEL_PURGE_PASS",json.dumps({
      "strictFirst":len(sourced),"nTrainFolds":len(reports),
      "folds":[{"name":z["fold"],"train":z["trainAvailableAndEmbargoed"],
         "test":z["testSourceCandidates"],"brier":z["brierProbabilistic"],
         "baseBrier":z["brierTrainBaseRate"],
         "models":[{"model":q["model"],"candidate":q["candidateCount"],
           "closed":q["normal30bps"]["closed"],"wins":q["normal30bps"]["wins"],
           "win":q["normal30bps"]["conditionalWinPct"],
           "DD":q["normal30bps"]["M5HighStressDDPct"],
           "NAV":q["normal30bps"]["finalProxyNavYen"],
           "stressWin":q["extra100bpsCoverStress"]["conditionalWinPct"]} for q in z["models"]]} for z in reports]},ensure_ascii=False),flush=True)
    print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
