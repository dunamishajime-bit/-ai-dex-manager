#!/usr/bin/env python3
"""Exploratory train/validation/later diagnostics for a causal entry probability model.

This does not certify trading economics or LIVE. Features only from completed M5
bars, labels are *future 12h exit after next M5 open*, training purged across
time windows. Diagnostic later window was already indirectly inspected by
prior rule sweeps and must NOT be called independent untouched OOS.
Simple regularized logistic, calibrated threshold from training scores only.
"""
from __future__ import annotations
import bisect,csv,datetime,importlib.util,json
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
OUT=REPO/"docs/research/results/residual-entry-after-amzn-20261023"
def load(n,p):
 s=importlib.util.spec_from_file_location(n,p);assert s and s.loader
 mod=importlib.util.module_from_spec(s);s.loader.exec_module(mod);return mod
base=load("residual_predictive_causal_source",HERE/"simulate-residual-new-multifactor-hourly-long-20261023.py")
F=base.features
M5=300000;H=3600000
FEATS=("ret1h","ret3h","ret6h","ret12h","ret24h",
 "btc1h","btc3h","btc6h","btc12h","btc24h",
 "rel1h","rel3h","rel6h","rel12h","rel24h",
 "volratio","atr3h","rangepos3h")
def ts(day):
 return int(datetime.datetime.fromisoformat(day).replace(tzinfo=datetime.timezone.utc).timestamp()*1000)
TRAIN_END=ts("2025-12-01");VAL_START=ts("2025-12-02")
VAL_END=ts("2026-02-10");TEST_START=ts("2026-02-11")
def samples(sym,src):
 bars,times=src.getdata(sym)
 start=bisect.bisect_left(times,base.START)
 end=bisect.bisect_left(times,base.END)
 samples=[]
 for k in range(max(start,290),end-146):
  decision=times[k]+M5
  if decision%H or times[k+1]!=decision or times[k+145]!=decision+144*M5:continue
  feat=F.get_feat(src,sym,decision)
  if feat is None:continue
  if any(feat.get(x) is None or not np.isfinite(float(feat[x])) for x in FEATS):continue
  opening=float(bars[k+1][1]);outprice=float(bars[k+145][1])
  if opening<=0 or outprice<=0:continue
  samples.append({"ts":decision,"idx":k+1,"features":[float(feat[x]) for x in FEATS],
   "labelLong":int(outprice/opening-1>.003),
   "labelShort":int((opening-outprice)/opening>.003)})
 return bars,times,samples
def fit(rows,target):
 A=np.asarray([r["features"] for r in rows])
 y=np.asarray([r[target] for r in rows],dtype=float)
 mu=A.mean(axis=0);sd=np.maximum(A.std(axis=0),1e-6)
 X=np.clip((A-mu)/sd,-5,5)
 X=np.column_stack([np.ones(len(X)),X])
 beta=np.zeros(X.shape[1])
 penal=np.eye(len(beta))*.05;penal[0,0]=1e-7
 for it in range(28):
  prob=1/(1+np.exp(-np.clip(X@beta,-20,20)))
  g=X.T@(prob-y)/len(y)+penal@beta
  w=prob*(1-prob)
  h=(X.T*w)@X/len(y)+penal
  step=np.linalg.solve(h,g)
  beta-=step
  if np.max(np.abs(step))<1e-7:break
 assert np.all(np.isfinite(beta))
 return {"mu":mu,"sd":sd,"beta":beta,"labelRate":float(y.mean())}
def predict(m,rows):
 X=np.asarray([r["features"] for r in rows])
 X=np.clip((X-m["mu"])/m["sd"],-5,5)
 X=np.column_stack([np.ones(len(X)),X])
 return 1/(1+np.exp(-np.clip(X@m["beta"],-20,20)))
def trade_outcome(bars,times,idx,side,cost):
 ep=float(bars[idx][1]);last=min(len(bars)-1,idx+144)
 price=None;exit_ts=times[last];why="TIME12H"
 for j in range(idx,last):
  t,op,hi,lo,cl,vol=bars[j]
  if j>idx and t!=times[j-1]+M5:raise RuntimeError("M5_PRICE_WINDOW_GAP")
  if side=="LONG":
   if float(lo)<=ep*.9:
    price=min(float(op),ep*.9);exit_ts=t+M5;why="STOP10";break
   if float(hi)>=ep*1.25:
    price=ep*1.25;exit_ts=t+M5;why="TAKE25";break
  else:
   if float(hi)>=ep*1.1:
    price=max(float(op),ep*1.1);exit_ts=t+M5;why="STOP10";break
   if float(lo)<=ep*.75:
    price=ep*.75;exit_ts=t+M5;why="TAKE25";break
 if price is None:price=float(bars[last][1])
 pnl=100*(((price-ep)/ep) if side=="LONG" else ((ep-price)/ep))-cost/100
 return float(pnl),int(exit_ts),why
def run(sym,bars,times,rows,pl,ps,plcut,pscut,cost):
 selected=[];occupied=-1
 for i,r in enumerate(rows):
  if r["ts"]<=occupied:continue
  if pl[i]>=plcut and pl[i]>ps[i]+.05:side="LONG"
  elif ps[i]>=pscut and ps[i]>pl[i]+.05:side="SHORT"
  else:continue
  pnl,until,reason=trade_outcome(bars,times,r["idx"],side,cost)
  selected.append({"symbol":sym,"entryTsMs":r["ts"],"side":side,"pnlPct":pnl,
    "exitTsMs":until,"reason":reason,"probLong":float(pl[i]),"probShort":float(ps[i])})
  occupied=until
 return selected
def quality(events):
 e=10000;peak=e;dd=0;won=0;pos=0;neg=0
 for item in events:
  pnl=item["pnlPct"]
  won+=(pnl>0)
  if pnl>0:pos+=pnl
  else:neg+=pnl
  e*=1+pnl/100;peak=max(e,peak);dd=min(dd,100*(e/peak-1))
 return {"n":len(events),"wins":int(won),"winRatePct":100*won/len(events) if events else None,
 "pf":pos/-neg if neg<0 else None,"closedDDPct":dd,"endJpy":e}
def main():
 base.native.m.acquire_verified_h1()
 source,_=base.native.m.m.core.task8.legacy.bootstrap()
 out={"status":"RESEARCH_DIAGNOSTIC_TRAIN_VALIDATION_LATER_NOT_INDEPENDENT_OOS_NOT_LIVE",
  "features":FEATS,"fitType":"train standardized ridge logistic lambda0.05",
  "train":"2025-08-10..2025-12-01",
  "validate":"2025-12-02..2026-02-10",
  "later":"2026-02-11..2026-08-10",
  "caveats":["Previously studied whole period and reused feature ideas, not independent untouched OOS",
   "Cross-hour 12h horizon samples overlap; effective sample size smaller than raw rows",
   "No 8logic portfolio/margin/venue L2/funding/execution verification"],
  "results":{}}
 ledger=[]
 for symbol in ("DOGEUSDT","AVAXUSDT"):
  bars,times,allrows=samples(symbol,source)
  train=[r for r in allrows if r["ts"]+12*H<TRAIN_END]
  val=[r for r in allrows if VAL_START<=r["ts"] and r["ts"]+12*H<VAL_END]
  later=[r for r in allrows if TEST_START<=r["ts"] and r["ts"]+12*H<base.END]
  assert len(train)>500 and len(val)>400 and len(later)>1200
  long=fit(train,"labelLong");short=fit(train,"labelShort")
  ql=predict(long,train);qs=predict(short,train)
  out["results"][symbol]={"train":{"rows":len(train),"labelRateLong":long["labelRate"],
     "labelRateShort":short["labelRate"],"coefLong":long["beta"].tolist(),
     "coefShort":short["beta"].tolist(),"means":long["mu"].tolist(),"stddev":long["sd"].tolist()}}
  for split,ss in (("validation",val),("later",later)):
   pl=predict(long,ss);ps=predict(short,ss)
   yL=np.asarray([r["labelLong"] for r in ss]);yS=np.asarray([r["labelShort"] for r in ss])
   result={"rawHourlyLabels":len(ss),"rawLongWin30Rate":float(yL.mean()),
      "rawShortWin30Rate":float(yS.mean()),
      "brierLong":float(((pl-yL)**2).mean()),"brierShort":float(((ps-yS)**2).mean()),"cases":{}}
   for q in (.70,.80,.90,.95):
    cl=float(np.quantile(ql,q));cs=float(np.quantile(qs,q))
    for cost in (10,30):
     events=run(symbol,bars,times,ss,pl,ps,cl,cs,cost)
     label="q"+str(int(q*100))
     result["cases"].setdefault(label,{})[str(cost)]={**quality(events),
       "trainScoreQuantile":q,"cutLong":cl,"cutShort":cs,"minScoreMargin":.05}
     if cost==10:
      ledger.extend([{**x,"case":label,"split":split} for x in events])
     z=result["cases"][label][str(cost)]
     print("PREDICTIVE",symbol,split,label,cost,"N",z["n"],"WIN",z["wins"],
       "WR",round(z["winRatePct"] or 0,2),"PF",round(z["pf"] or 0,3),
       "DD",round(z["closedDDPct"],2),"END",round(z["endJpy"]),flush=True)
   out["results"][symbol][split]=result
  print("MODEL_DONE",symbol,"FIT_N",len(train),"VAL_N",len(val),"LATER_N",len(later),flush=True)
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/"RESIDUAL_ENTRY_PROBABILITY_TIME_SPLIT_20261023.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 with (OUT/"RESIDUAL_ENTRY_PROBABILITY_SELECTED_10BPS_20261023.csv").open("w",encoding="utf-8",newline="") as f:
  w=csv.DictWriter(f,fieldnames=list(ledger[0]),lineterminator="\n");w.writeheader();w.writerows(ledger)
 print("PREDICTIVE_CAUSAL_ENTRY_EXPERIMENT_COMPLETE",len(ledger))
if __name__=="__main__":main()
