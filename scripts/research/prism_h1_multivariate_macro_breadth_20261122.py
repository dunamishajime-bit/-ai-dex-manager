#!/usr/bin/env python3
"""PRISM II -- causal H1 macro breadth + multivariate route-context ensemble.

All training labels must have *exited* plus a 24h embargo before split.
No future OHLCV features, no portfolio orders. All model/policy variants
are predeclared and reported; no post-validation threshold tuning.
"""
from __future__ import annotations
import bisect,csv,datetime as dt,gzip,hashlib,json,math,statistics,sys
from collections import Counter,defaultdict
from pathlib import Path
import numpy as np

ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
CAND=ROOT/"DIRECTION_RESEARCH_20261109"/"three_layer_layer1_all_candidates_20261114.jsonl"
H1=ROOT/"aster-public-v3-h1"
OUTPUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path.cwd()/"PRISM_MULTIVARIATE"
OUTPUT.mkdir(parents=True,exist_ok=True)
BAR=3600000
END=int(dt.datetime(2026,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)
Q2=int(dt.datetime(2026,4,1,tzinfo=dt.timezone.utc).timestamp()*1000)
Q3=int(dt.datetime(2026,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
EMBARGO=24*BAR
ROUTES=("V4","Q102","PENGU","V52","IDLE","FET","HYPE")
BREADTH=("BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT",
         "LTCUSDT","ADAUSDT","AVAXUSDT","PENGUUSDT","LINKUSDT","FETUSDT")
POLICIES=("baseline","ridge_p60","ridge_p70","ridge_p80",
          "forest_p60","forest_p70","forest_p80",
          "blend_p60","blend_p70","blend_p80")
HALFLIFE_D=120
ALLOW_EMPTY=False

def hfile(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for chunk in iter(lambda:f.read(1<<17),b""):h.update(chunk)
 return h.hexdigest()
allh={}
missing_symbols=Counter()
def load(sym):
 if sym in allh:return allh[sym]
 fs=list(H1.glob(f"{sym}-1h-*.jsonl.gz"))
 if len(fs)!=1:
  missing_symbols[sym]+=1;allh[sym]=None;return None
 times=[];b=[]
 with gzip.open(fs[0],"rt",encoding="utf8") as f:
  for line in f:
   a=json.loads(line)
   times.append(int(a[0]))
   b.append([float(a[i]) for i in (1,2,3,4,5)])
 if len(set(times))!=len(times):raise ValueError("H1_DUPLICATE")
 allh[sym]={"ts":times,"bar":np.asarray(b,dtype=np.float64),"hash":hfile(fs[0])}
 return allh[sym]
def last_idx(h,t):
 if h is None:return None
 i=bisect.bisect_right(h["ts"],t-BAR)-1
 if i<72 or h["ts"][i]!=t-BAR:return None
 if h["ts"][i]-h["ts"][i-72]!=72*BAR:return None
 return i

def vector_of_symbol(sym,t):
 h=load(sym);i=last_idx(h,t)
 if i is None:return None
 bars=h["bar"];c=bars[:,3]
 returns={k:float(c[i]/c[i-k]-1) for k in (3,6,12,24,48,72)}
 hist=np.diff(np.log(np.maximum(c[i-72:i+1],1e-15)))
 eff24=abs(c[i]-c[i-24])/max(1e-15,float(np.abs(np.diff(c[i-24:i+1])).sum()))
 eff72=abs(c[i]-c[i-72])/max(1e-15,float(np.abs(np.diff(c[i-72:i+1])).sum()))
 high24=float(bars[i-23:i+1,1].max())
 low24=float(bars[i-23:i+1,2].min())
 high72=float(bars[i-71:i+1,1].max())
 low72=float(bars[i-71:i+1,2].min())
 cp24=(c[i]-low24)/max(1e-14,high24-low24)
 cp72=(c[i]-low72)/max(1e-14,high72-low72)
 changes=np.diff(c[i-24:i+1])
 voltrend=sum(bars[i-5:i+1,4])/max(1e-14,sum(bars[i-23:i+1,4])/4) if sum(bars[i-23:i+1,4])>0 else 0
 wick_h=(bars[i-23:i+1,1]-np.maximum(bars[i-23:i+1,0],bars[i-23:i+1,3])).sum()
 wick_l=(np.minimum(bars[i-23:i+1,0],bars[i-23:i+1,3])-bars[i-23:i+1,2]).sum()
 wick=(wick_l-wick_h)/max(1e-14,wick_l+wick_h)
 return {"r":returns,"eff24":float(eff24),"eff72":float(eff72),
         "vol24":float(hist[-24:].std()),"vol72":float(hist.std()),
         "cp24":float(cp24),"cp72":float(cp72),
         "voltrend":float(voltrend),"wick":float(wick),
         "accelerate":float(returns[6]-returns[24]/4),
         "slope12":float(c[i]/max(1e-14,np.mean(c[i-11:i+1]))-1),
         "c":float(c[i]),"changes72":hist}

macro_cache={}
def macro(t):
 if t in macro_cache:return macro_cache[t]
 m={};periods={24:[],72:[]}
 for sym in BREADTH:
  z=vector_of_symbol(sym,t)
  if z:
   m[sym]=z
   for k in (24,72):periods[k].append(z["r"][k]>0)
 if len(periods[24])<7:
  macro_cache[t]=None;return None
 out={"breadth24":float(np.mean(periods[24])),"breadth72":float(np.mean(periods[72]))}
 for sym in ("BTCUSDT","ETHUSDT","SOLUSDT"):
  z=m.get(sym)
  if z:
   out[sym]=z
  else:out[sym]=None
 macro_cache[t]=out
 return out

NUMERIC=[
 "aligned_sym3","aligned_sym6","aligned_sym12","aligned_sym24","aligned_sym48","aligned_sym72",
 "aligned_btc3","aligned_btc6","aligned_btc24","aligned_btc72",
 "rel6","rel24","rel72","btc_r24","btc_r72","btc_accel","sym_accel",
 "sym_eff24","sym_eff72","sym_vol24","sym_vol72","sym_range24",
 "sym_range72","sym_volume6","sym_wick24","sym_slope12",
 "btc_eff24","btc_vol24","btc_range24","eth_aligned24","sol_aligned24",
 "breadth24","breadth72","alignment_contradiction","vol_ratio_sym_btc",
 "coin_btc_corr72","trend_persistence","overheat_compression",
 "is_long","is_short"
]
# Route onehot within the same Runner; fully known at entry, not a target.
def features(signal):
 t=signal["entryTs"]
 o=vector_of_symbol(signal["symbol"],t)
 m=macro(t)
 if not o or not m or not m["BTCUSDT"]:return None
 b=m["BTCUSDT"];n=1 if signal["side"]=="LONG" else -1
 eth=m.get("ETHUSDT");sol=m.get("SOLUSDT")
 btc_std=max(1e-6,b["vol24"])
 corr=np.corrcoef(o["changes72"],b["changes72"])[0,1]
 if not np.isfinite(corr):corr=0
 rel24=o["r"][24]-b["r"][24]
 rel72=o["r"][72]-b["r"][72]
 sym_trend=o["r"][24]*o["r"][72]
 btc_trend=b["r"][24]*b["r"][72]
 feat={
  **{f"aligned_sym{k}":n*o["r"][k] for k in (3,6,12,24,48,72)},
  **{f"aligned_btc{k}":n*b["r"][k] for k in (3,6,24,72)},
  "rel6":n*(o["r"][6]-b["r"][6]),
  "rel24":n*rel24,"rel72":n*rel72,
  "btc_r24":b["r"][24],"btc_r72":b["r"][72],
  "btc_accel":b["accelerate"],"sym_accel":n*o["accelerate"],
  "sym_eff24":o["eff24"],"sym_eff72":o["eff72"],
  "sym_vol24":o["vol24"],"sym_vol72":o["vol72"],
  "sym_range24":o["cp24"],"sym_range72":o["cp72"],
  "sym_volume6":o["voltrend"],"sym_wick24":n*o["wick"],
  "sym_slope12":n*o["slope12"],"btc_eff24":b["eff24"],
  "btc_vol24":b["vol24"],"btc_range24":b["cp24"],
  "eth_aligned24":n*eth["r"][24] if eth else 0,
  "sol_aligned24":n*sol["r"][24] if sol else 0,
  "breadth24":m["breadth24"],"breadth72":m["breadth72"],
  "alignment_contradiction":float(n*o["r"][6]<0 and n*o["r"][24]<0 and n*b["r"][24]<0),
  "vol_ratio_sym_btc":min(6,o["vol24"]/btc_std),
  "coin_btc_corr72":float(corr),
  "trend_persistence":min(1.0,abs(o["r"][24])/(abs(o["r"][72])+1e-5)),
  "overheat_compression":n*o["r"][24]*o["cp24"],
  "is_long":float(n==1),"is_short":float(n==-1)}
 return feat

def wilson(w,n):
 if not n:return [None,None]
 z=1.9599639845;p=w/n;den=1+z*z/n
 half=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den
 mid=(p+z*z/(2*n))/den
 return [round(100*(mid-half),2),round(100*(mid+half),2)]
def sigmoid(x):return 1/(1+np.exp(-np.clip(x,-40,40)))

def ridge_model(X,y,w,theta=3.0):
 # Ridge logistics, IRLS with backtracking; weighted exposures, train-only
 # median/IQR preprocessing. Route indicators get stronger shrinkage.
 median=np.median(X[:,:len(NUMERIC)],axis=0)
 q1=np.percentile(X[:,:len(NUMERIC)],25,axis=0)
 q3=np.percentile(X[:,:len(NUMERIC)],75,axis=0)
 scale=np.maximum(q3-q1,1e-4)
 def scale_x(x):
  a=np.clip((x[:,:len(NUMERIC)]-median)/scale,-5,5)
  return np.column_stack([np.ones(len(x)),a,x[:,len(NUMERIC):]])
 M=scale_x(X);w=w/w.sum()*len(w)
 beta=np.zeros(M.shape[1]);beta[0]=math.log((y.sum()+4)/(len(y)-y.sum()+4))
 lam=np.ones(M.shape[1])*theta;lam[0]=0
 lam[len(NUMERIC)+1:]=theta*1.5
 reg=np.diag(lam)
 for _ in range(40):
  p=sigmoid(M@beta)
  v=w*p*(1-p)
  grad=M.T@(w*(y-p))-lam*beta
  H=(M.T*v)@M+reg
  try:move=np.linalg.solve(H+np.eye(len(beta))*1e-8,grad)
  except np.linalg.LinAlgError:break
  move=np.clip(move,-.7,.7)
  before=(-(w*(y*np.log(np.maximum(p,1e-10))+(1-y)*np.log(np.maximum(1-p,1e-10)))).sum()+(.5*lam*beta*beta).sum())
  rate=1
  while rate>1e-5:
   npred=sigmoid(M@(beta+rate*move))
   new=(-(w*(y*np.log(np.maximum(npred,1e-10))+(1-y)*np.log(np.maximum(1-npred,1e-10)))).sum()+(.5*lam*(beta+rate*move)**2).sum())
   if new<=before+1e-9:break
   rate*=.5
  beta=beta+rate*move
  if np.linalg.norm(rate*move)<1e-5:break
 return lambda xs:np.asarray(sigmoid(scale_x(xs)@beta),dtype=float)

def tree_predict(tree,v):
 while isinstance(tree,tuple):
  k,split,l,r=tree
  tree=l if v[k]<=split else r
 return tree
def forest_model(X,y,weights,seed,trees=90,max_depth=4):
 # Smoothing and wide minimum leaf to limit overly precise splits.
 rng=np.random.default_rng(seed)
 n,p=X.shape;mn=max(6,int(n*.055))
 ww=np.maximum(weights,1e-8);ww=ww/ww.sum()
 def grow(ix,depth):
  yy=y[ix];sz=len(ix);pos=float(yy.sum());prior=.5
  prob=(pos+10*prior)/(sz+10)
  if depth>=max_depth or sz<2*mn or pos<2 or sz-pos<2:return prob
  std=float(yy.mean()*(1-yy.mean()))
  cols=rng.choice(p,size=min(13,p),replace=False)
  best=None;gain=.005
  for k in cols:
   vals=X[ix,k]
   if vals.max()==vals.min():continue
   for quant in (.25,.50,.75):
    split=float(np.quantile(vals,quant))
    left=(vals<=split);l=int(left.sum());r=sz-l
    if l<mn or r<mn:continue
    lp=float(yy[left].mean());rp=float(yy[~left].mean())
    g=std-l/sz*lp*(1-lp)-r/sz*rp*(1-rp)
    if g>gain:gain=g;best=(k,split,ix[left],ix[~left])
  if not best:return prob
  k,split,l,r=best
  return (int(k),float(split),grow(l,depth+1),grow(r,depth+1))
 forest=[grow(rng.choice(n,size=n,replace=True,p=ww),0) for _ in range(trees)]
 def pred(rows):
  return np.array([sum(tree_predict(tr,row) for tr in forest)/len(forest) for row in rows],dtype=float)
 return pred

def phase(ts):
 return "development" if ts<Q2 else "validation" if ts<Q3 else "post_validation"
data=[];missing=Counter();allroutes=defaultdict(set)
for line in CAND.open(encoding="utf8"):
 s=json.loads(line)
 t=int(s["entryTs"]);exitdata=s.get("model") or {}
 if t>=END or int(exitdata.get("exitTs") or 0)>=END:
  missing["right_censored"]+=1;continue
 if (not exitdata.get("entryPrice") or not exitdata.get("exitPrice")
     or exitdata["entryPrice"]<=0 or exitdata["exitPrice"]<=0):
  missing["invalid_model_price"]+=1;continue
 v=features(s)
 if v is None:missing["missing_valid_h1_"+s["strategy"]]+=1;continue
 n=1 if s["side"]=="LONG" else -1
 ret=n*(exitdata["exitPrice"]/exitdata["entryPrice"]-1)
 obj={"id":s["id"],"strategy":s["strategy"],"route":s["route"],
      "symbol":s["symbol"],"side":s["side"],"entryTs":t,"exitTs":int(exitdata["exitTs"]),
      "gross":ret,"phase":phase(t),"features":v}
 data.append(obj);allroutes[s["strategy"]].add(s["route"])
data.sort(key=lambda z:(z["entryTs"],z["strategy"],z["id"]))
if len(data)<2600:raise ValueError("H1_COVERAGE_TOO_LOW:"+str(len(data)))
print("FEATURE_DATA",len(data),"EXCLUSIONS",dict(missing),"ROUTE_COUNTS",{s:len(v) for s,v in allroutes.items()},flush=True)

route_columns={s:sorted(v) for s,v in allroutes.items()}
def make_x(rows,s):
 rr=route_columns[s]
 return np.array([[float(row["features"][col]) for col in NUMERIC]+[float(row["route"]==r) for r in rr]
   for row in rows],dtype=float)

runs=[];scores=[];model_hashes={}
for s in ROUTES:
 for cost in (10,30):
  for phase_name,split in [("validation",Q2),("post_validation",Q3)]:
   train=[x for x in data if x["strategy"]==s and x["exitTs"]+EMBARGO<split and x["entryTs"]<split]
   test=[x for x in data if x["strategy"]==s and x["phase"]==phase_name]
   if len(test)==0:continue
   X=make_x(train,s);Y=np.array([int(x["gross"]>cost/10000) for x in train],dtype=float)
   T=make_x(test,s)
   if len(train)<16:
    p=float((Y.sum()+8)/(len(Y)+16))
    ridge=lambda q:np.full(len(q),p)
    forest=lambda q:np.full(len(q),p)
    setup="INSUFFICIENT_TRAINING_NO_FITTING"
   else:
    days=np.array([(split-x["entryTs"])/86400000 for x in train])
    decay=np.exp(-math.log(2)*days/HALFLIFE_D)
    ridge=ridge_model(X,Y,decay,theta=3.0)
    forest=forest_model(X,Y,decay,seed=740+ROUTES.index(s)+cost*3+(0 if phase_name=="validation" else 100))
    setup="H1_CAUSAL_CONTEXT_RIDGE_AND_BAGGED_SHALLOW_TREES"
   pr=ridge(T);pf=forest(T);pb=.5*pr+.5*pf
   if not all(np.all(np.isfinite(vec)) for vec in (pr,pf,pb)):
    raise ValueError("PREDICTION_NAN")
   z={"ridge":pr,"forest":pf,"blend":pb}
   info={"runner":s,"fee":cost,"period":phase_name,"train_n":len(train),
         "train_wins":int(Y.sum()),"test_n":len(test),"algorithm":setup}
   for name,pred in z.items():
    for threshold in (.6,.7,.8):
     accepted=[(d,float(p)) for d,p in zip(test,pred) if p>=threshold]
     n=len(accepted);w=sum(d["gross"]>cost/10000 for d,p in accepted)
     profit=sum(100*(d["gross"]-cost/10000) for d,p in accepted)
     runs.append({**info,"policy":f"{name}_p{int(threshold*100)}","kept":n,
     "win_pct":round(100*w/n,2) if n else None,"winners":w,
     "wilson95":wilson(w,n),"mean_pct":round(profit/n,4) if n else None,
     "sum_fixed_notional_price_pct":round(profit,4),"kept_fraction":round(n/len(test),4)})
    for d,p in zip(test,pred):
     scores.append({"id":d["id"],"runner":s,"route":d["route"],"symbol":d["symbol"],
      "phase":phase_name,"entryTs":d["entryTs"],"exitTs":d["exitTs"],"fee":cost,
      "algo":name,"p":round(float(p),6),"true_win":d["gross"]>cost/10000,
      "gross_return":round(d["gross"],6)})
   baseline_win=sum(d["gross"]>cost/10000 for d in test)
   base_net=sum(d["gross"]-cost/10000 for d in test)
   runs.append({**info,"policy":"baseline","kept":len(test),"win_pct":round(100*baseline_win/len(test),2),
    "winners":baseline_win,"wilson95":wilson(baseline_win,len(test)),
    "mean_pct":round(100*base_net/len(test),4),"sum_fixed_notional_price_pct":round(100*base_net,4),
    "kept_fraction":1.0})
   print("MODELED",s,cost,phase_name,"training",len(train),"holdout",len(test),
     "base_wr",round(100*baseline_win/len(test),2),"ridge>70",
     next((r["win_pct"],r["kept"]) for r in reversed(runs) if r["policy"]=="ridge_p70"),flush=True)

out={
 "schema":"disdex-prism-multivariate-regime-h1/v1","period":"2025-10-01/2026-10-01 UTC",
 "folds":{"train_until_2026_04_01":"only matured exits+24h","train_until_2026_07_01":"only matured exits+24h"},
 "source_files":{"candidates_sha256":hfile(CAND),
 "H1_files_sha256":{s:a["hash"] for s,a in allh.items() if a is not None}},
 "validated_input":len(data),"excluded":dict(missing),
 "feature_names":NUMERIC,"route_columns":route_columns,
 "algorithms":{"ridge":"weighted IRLS + L2 on standardized numeric H1, route one-hot",
 "forest":"recency-weighted 90 bagged depth4 trees, pseudo-count 10 minleaf 5.5%",
 "blend":"0.5ridge+0.5forest", "half_life_days":HALFLIFE_D,
 "costs_bps":[10,30],"thresholds":[0.6,0.7,0.8]},
 "assumptions":["Labels are candidate-only modeled price returns net of 10/30 bps, NOT native STOP-verified fills",
 "Every market feature uses H1 bars closed at or before entryTs; no current unclosed bar",
 "Training excludes every label with exitTs+24h >= evaluation period start",
 "No use of held-out target outcome to choose model features, weights, thresholds or evaluation metric",
 "Source candidate pool has previous research contamination; chronological tests are not pristine blind external OOS",
 "Correlated candidate outcomes and multiple test variants undermine naive statistical confidence",
 "No portfolio replay, full native runner parity, or market order slippage, so cannot claim 70/80 performance in production",
 "HYPE unchanged; no deployable order/STOP code produced"],"results":runs}
(OUTPUT/"prism_h1_multivariate_holdout_summary.json").write_text(json.dumps(out,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n",encoding="utf8")
with (OUTPUT/"prism_h1_multivariate_holdout_results.csv").open("w",encoding="utf-8-sig",newline="") as f:
 writer=csv.DictWriter(f,list(runs[0]));writer.writeheader()
 for r in runs:
  y=r.copy();y["wilson95"]=json.dumps(y["wilson95"]);writer.writerow(y)
with (OUTPUT/"prism_h1_multivariate_holdout_scores.csv").open("w",encoding="utf-8-sig",newline="") as f:
 writer=csv.DictWriter(f,list(scores[0]));writer.writeheader();writer.writerows(scores)
print("RUN_COMPLETE",json.dumps({"data":len(data),"runs":len(runs),"score_rows":len(scores),
 "min_train":min((r["train_n"] for r in runs),default=None)},ensure_ascii=False),flush=True)
for r in runs:
 if r["fee"]==30 and r["period"]=="post_validation":
  if r["policy"] in ("baseline","ridge_p60","ridge_p70","forest_p60","forest_p70","blend_p60","blend_p70"):
   print("POST_VAL_30",r["runner"],r["policy"],"N",r["kept"],"WR",r["win_pct"],
    "MEAN",r["mean_pct"],flush=True)
