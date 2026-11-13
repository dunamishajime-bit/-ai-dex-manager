import gzip,json,math,statistics,zipfile,csv,io,datetime as dt
from pathlib import Path
import numpy as np

ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
PRE=ROOT/"PREPERIOD_TRAIN_20250301_20251001"/"IDLE_ALL_BINANCE_PROXY"
GAP=ROOT/"binance-um-1h-aster-early-gap-proxy"
D=ROOT/"DIRECTION_RESEARCH_20261109"
OUT=D/"idle_vnext_core_tia_side_specific_v3_exactrows_20261113.json"
H=3600000;DAY=24*H

COMP={
 "RENDERUSDT":{"kind":"fixed","h":24,"side":"SHORT","rule":[["er24","<=",0.08185479635959514],["volratio",">=",1.0722661293006654]],"preScore":0.01603913215208192},
 "DOTUSDT":{"kind":"fixed","h":12,"side":"LONG","rule":[["r12","<=",-0.035821633171092715],["r72","<=",-0.02304156238552022]],"preScore":0.006894882606329711},
 "JUPUSDT":{"kind":"online","h":12,"params":{"windowDays":60,"k":12,"predThreshold":0.016,"agree":0.55,"weighted":True},"preScore":0.001559214685756635},
 "TIAUSDT":{"kind":"online","h":24,"params":{"windowDays":60,"k":12,"predThreshold":0.026,"agree":0.60,"weighted":True},"preScore":0.0016840703130899623},
}

def gz_series(p):
 d={}
 with gzip.open(p,"rt",encoding="utf-8") as f:
  for l in f:
   if not l.strip():continue
   z=json.loads(l);t=int(z[0]);d[t]=(t,float(z[1]),float(z[2]),float(z[3]),float(z[4]),float(z[5]))
 return [d[t] for t in sorted(d)]
def zip_series(sym):
 d={}
 for p in sorted(GAP.glob(f"{sym}-1h-*.zip")):
  with zipfile.ZipFile(p) as z:
   for name in z.namelist():
    with z.open(name) as fh:
     rd=csv.reader(io.TextIOWrapper(fh,encoding="utf-8")); first=True
     for row in rd:
      if not row:continue
      if first and row[0]=="open_time": first=False;continue
      first=False;t=int(row[0]);d[t]=(t,float(row[1]),float(row[2]),float(row[3]),float(row[4]),float(row[5]))
 return [d[t] for t in sorted(d)]
def aster(sym):
 d={}
 for p in [ROOT/"aster-public-v3-h1"/f"{sym}-1h-20250924-20261001.jsonl.gz",
           ROOT/"FORWARD_HOLDOUT_20261001_20261108"/"aster-h1"/f"{sym}-1h-20261001-20261108T20.jsonl.gz"]:
  if p.exists():
   for x in gz_series(p):d[x[0]]=x
 return [d[t] for t in sorted(d)]

def ret(a,i,n):return a[i]/a[i-n]-1
def rows(a,b,horizon,source):
 bm={x[0]:x for x in b};t=[x[0] for x in a];c=[x[4] for x in a];hi=[x[2] for x in a];lo=[x[3] for x in a];v=[x[5] for x in a]
 bc=[bm.get(x,(0,0,0,0,float("nan"),0))[4] for x in t];out=[]
 for i in range(168,len(a)-horizon-2):
  if t[i]%(6*H)!=0:continue
  if any(t[j]-t[j-1]!=H for j in range(i-168,i+horizon+2)):continue
  if not all(math.isfinite(bc[j]) and bc[j]>0 for j in range(i-72,i+1)):continue
  rr=[c[j]/c[j-1]-1 for j in range(i-23,i+1)]
  tr=[max(hi[j]-lo[j],abs(hi[j]-c[j-1]),abs(lo[j]-c[j-1]))/c[j] for j in range(i-23,i+1)]
  net=abs(c[i]/c[i-24]-1);path=sum(abs(c[j]/c[j-1]-1) for j in range(i-23,i+1))
  ll=min(lo[i-23:i+1]);hh=max(hi[i-23:i+1]);v6=sum(v[i-5:i+1]);v36=sum(v[i-41:i-5])
  f={"r6":ret(c,i,6),"r12":ret(c,i,12),"r24":ret(c,i,24),"r72":ret(c,i,72),
     "b24":ret(bc,i,24),"rel24":ret(c,i,24)-ret(bc,i,24),"rel72":ret(c,i,72)-ret(bc,i,72),
     "rv24":statistics.pstdev(rr),"er24":net/path if path else 0,"pos24":(c[i]-ll)/(hh-ll) if hh>ll else .5,
     "atr24":sum(tr)/24,"volratio":v6/v36*6 if v36>0 else 1.0}
  ent=t[i]+H; exi=i+1+horizon
  if exi>=len(a) or a[exi][0]!=ent+horizon*H:continue
  entry=a[i+1][1];ex=a[exi][1]
  if entry<=0 or ex<=0:continue
  out.append({"entryTs":ent,"exitTs":a[exi][0],"entry":entry,"exit":ex,"rawLong":ex/entry-1,"f":f,"source":source,"bars":a[i+1:exi+1]})
 return out

def online_preds(rs,p):
 X=np.asarray([[x["f"][k] for k in ("r6","r12","r24","r72","b24","rel24","rel72","rv24","er24","pos24","atr24","volratio")] for x in rs],float)
 y=np.asarray([x["rawLong"] for x in rs],float); ent=np.asarray([x["entryTs"] for x in rs],np.int64);ext=np.asarray([x["exitTs"] for x in rs],np.int64)
 out=[None]*len(rs);window=p["windowDays"];k=p["k"]
 for i in range(len(rs)):
  mask=(ext<=ent[i]) & (ent>=ent[i]-window*DAY);idx=np.flatnonzero(mask)
  if len(idx)<max(k,20):continue
  hist=X[idx];sd=np.nanstd(hist,axis=0);sd=np.where(sd<1e-8,1,sd)
  dist=np.sqrt(np.nanmean(((hist-X[i])/sd)**2,axis=1));kk=min(k,len(idx));loc=np.argpartition(dist,kk-1)[:kk];near=idx[loc]
  vals=y[near];ds=dist[loc];w=1/(ds+.05);pred=float(np.sum(vals*w)/np.sum(w))
  sign=1 if pred>0 else -1;agree=float(np.mean(vals*sign>0))
  out[i]={"pred":pred,"agree":agree}
 return out


def tia_stop10(x,side):
 entry=x["entry"]; stop=(.10 if side=="LONG" else .08); stoppx=entry*(1-stop) if side=="LONG" else entry*(1+stop)
 for bar in x["bars"]:
  o,h,l,c=bar[1],bar[2],bar[3],bar[4]
  if side=="LONG" and l<=stoppx:
   fill=min(o,stoppx) if o<stoppx else stoppx
   return fill/entry-1,bar[0],"TIA_SIDE_STOP"
  if side=="SHORT" and h>=stoppx:
   fill=max(o,stoppx) if o>stoppx else stoppx
   return 1-fill/entry,bar[0],"TIA_SIDE_STOP"
 return (x["exit"]/entry-1 if side=="LONG" else 1-x["exit"]/entry),x["exitTs"],"TIME"

T=lambda y,m,d:int(dt.datetime(y,m,d,tzinfo=dt.timezone.utc).timestamp()*1000)
TARGET=T(2025,10,1);SWITCH=T(2026,2,1);FORWARD=T(2026,10,1);FEND=T(2026,11,8)+20*H
prebtc=gz_series(PRE/"BTCUSDT-1h-20250301-20251001.jsonl.gz"); astbtc=aster("BTCUSDT")
allcand=[]
componentStats={}
for sym,cfg in COMP.items():
 h=cfg["h"]; pre=gz_series(PRE/f"{sym}-1h-20250301-20251001.jsonl.gz"); ast=aster(sym)
 rs=rows(pre,prebtc,h,"PRE")
 if sym!="DOTUSDT":
  gap=zip_series(sym);rs += [x for x in rows(gap,astbtc,h,"GAP") if TARGET<=x["entryTs"]<SWITCH]
 rs += [x for x in rows(ast,astbtc,h,"ASTER") if SWITCH<=x["entryTs"]<FEND] if sym!="DOTUSDT" else [x for x in rows(ast,astbtc,h,"ASTER") if TARGET<=x["entryTs"]<FEND]
 # dedupe
 pri={"PRE":0,"GAP":1,"ASTER":2};dd={}
 for x in rs:
  if x["entryTs"] not in dd or pri[x["source"]]>pri[dd[x["entryTs"]]["source"]]:dd[x["entryTs"]]=x
 rs=[dd[t] for t in sorted(dd)]
 sig=[]
 if cfg["kind"]=="fixed":
  sign=1 if cfg["side"]=="LONG" else -1
  for x in rs:
   if x["entryTs"]<TARGET:continue
   ok=True
   for f,op,v in cfg["rule"]:
    z=x["f"][f]
    if op=="<=" and z>v:ok=False
    if op==">=" and z<v:ok=False
   if ok:
    q=dict(x);q.update({"symbol":sym,"side":cfg["side"],"signedRaw":sign*x["rawLong"],"priority":cfg["preScore"],"modelScore":cfg["preScore"]});sig.append(q)
 else:
  pr=online_preds(rs,cfg["params"])
  for x,p in zip(rs,pr):
   if x["entryTs"]<TARGET or p is None:continue
   if abs(p["pred"])<cfg["params"]["predThreshold"] or p["agree"]<cfg["params"]["agree"]:continue
   sign=1 if p["pred"]>0 else -1
   q=dict(x); side=("LONG" if sign>0 else "SHORT"); q.update({"symbol":sym,"side":side,"signedRaw":sign*x["rawLong"],"priority":cfg["preScore"],"modelScore":abs(p["pred"]),"agree":p["agree"],"exitReason":"TIME"})
   if sym=="TIAUSDT":
    rr,xt,rsn=tia_stop10(x,side); q["signedRaw"]=rr; q["exitTs"]=xt; q["exitReason"]=rsn
   sig.append(q)
 componentStats[sym]={"signalsTarget":sum(TARGET<=x["entryTs"]<FORWARD for x in sig),"signalsForward":sum(FORWARD<=x["entryTs"]<FEND for x in sig)}
 allcand.extend(sig)

# IDLE one slot: candidates at same timestamp choose highest PRETARGET priority; any signal while busy is blocked.
byts={}
for x in allcand:
 if not(TARGET<=x["entryTs"]<FEND):continue
 byts.setdefault(x["entryTs"],[]).append(x)
accepted=[];blocked=[];free=-1
for t in sorted(byts):
 cand=sorted(byts[t],key=lambda x:(x["priority"],x["modelScore"]),reverse=True)
 if t<free:
  for x in cand: blocked.append({**x,"blockReason":"IDLE_SLOT_BUSY"})
  continue
 win=cand[0];accepted.append(win);free=win["exitTs"]
 for x in cand[1:]:blocked.append({**x,"blockReason":"SAME_TS_LOWER_PRETARGET_PRIORITY"})

def summary(st,en,cost):
 tr=[x for x in accepted if st<=x["entryTs"]<en]
 equity=1.0;peak=1.0;mdd=0.0;wins=0;gp=gl=0.0
 curve=[]
 for x in tr:
  r=x["signedRaw"]-cost
  if r>0:wins+=1;gp+=r
  else:gl-=r
  equity*=max(1e-9,1+r);peak=max(peak,equity);mdd=min(mdd,equity/peak-1);curve.append(equity)
 return {"n":len(tr),"winRate":wins/len(tr) if tr else None,"sumReturn":sum(x["signedRaw"]-cost for x in tr),
         "meanReturn":sum(x["signedRaw"]-cost for x in tr)/len(tr) if tr else None,
         "profitFactor":gp/gl if gl else 999.0,"compoundMultiple":equity,"tradeCloseMaxDD":mdd,
         "bySymbol":{s:sum(x["symbol"]==s for x in tr) for s in COMP},
         "bySide":{"LONG":sum(x["side"]=="LONG" for x in tr),"SHORT":sum(x["side"]=="SHORT" for x in tr)}}

report={"status":"RESEARCH_ONLY_IDLE_VNEXT_CORE_1X_ONE_SLOT","selectionUsesTarget":False,
        "components":COMP,"componentSignalCounts":componentStats,"priorityRule":"descending worst/pretarget validation mean only; never target metrics",
        "target10":summary(TARGET,FORWARD,.001),"target30":summary(TARGET,FORWARD,.003),
        "forward10":summary(FORWARD,FEND,.001),"forward30":summary(FORWARD,FEND,.003),
        "acceptedN":len(accepted),"blockedN":len(blocked),
        "accepted":[{"entryTs":x["entryTs"],"exitTs":x["exitTs"],"symbol":x["symbol"],"side":x["side"],"signedRaw":x["signedRaw"],"entryPrice":x["entry"],"exitPrice":(x["entry"]*(1+x["signedRaw"]) if x["side"]=="LONG" else x["entry"]*(1-x["signedRaw"])),"priority":x["priority"],"modelScore":x["modelScore"],"source":x["source"],"exitReason":x.get("exitReason","TIME")} for x in accepted],
        "taoStatus":"WAIT_NO_PRETARGET_RANK1_OR_ONLINE_RULE_SURVIVED_TARGET"}
json.dump(report,open(OUT,"w",encoding="utf-8"),ensure_ascii=False,indent=2)
print(json.dumps({k:report[k] for k in ("status","target10","target30","forward10","forward30","acceptedN","blockedN","taoStatus")},ensure_ascii=False,indent=2))
print("SAVED",OUT)


