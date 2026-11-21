#!/usr/bin/env python3
"""Deterministic adversarial as-of unit tests for STABLE4 MLX research layer."""
from pathlib import Path
import ast,collections,datetime,math
SOURCE=Path(__file__).with_name("mlx_replay_v1.py")
tree=ast.parse(SOURCE.read_text(encoding="utf8"))
engine=None
for n in tree.body:
 if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name) and n.targets[0].id=="ENGINE":
  engine=ast.literal_eval(n.value)
assert isinstance(engine,str) and "def _lx_prepare" in engine
H=3600000
raw=[]
START=1759276800000
prices={}
def synthetic(sym):
 arr=[];p=100. if sym=="TEST" else 40000.
 for i in range(150):
  if sym=="TEST":
   drift=.0002 if i<82 else -.015 if i<94 else .001
   p=p*(1+drift)
  else:p=p*(1+.0001+0.0007*math.sin(i/5))
  op=p/(1+drift) if sym=="TEST" else p/1.0001
  hi=max(op,p)*1.002;lo=min(op,p)*.998
  arr.append((START+i*H,op,hi,lo,p))
 return arr
prices["TEST"]=synthetic("TEST")
prices["BTCUSDT"]=synthetic("BTCUSDT")
def bars(sym):
 z=prices.get(sym)
 return (START,z) if z is not None else None
def bar(sym,t):
 a=bars(sym)
 if a is None:return None
 first,arr=a
 if (t-first)%H:return None
 idx=(t-first)//H
 return arr[idx] if 0<=idx<len(arr) else None
def iso(t):return datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat()
scope=dict(H=H,bar=bar,bars=bars,iso=iso,collections=collections,math=math,raw=raw)
exec(compile(engine.replace("__MODE__","FULL_LAYER"),str(SOURCE)+"::TEST_ENGINE","exec"),scope)
t=START+80*H
fx=scope["_lx_features"]("TEST",t)
assert fx and fx["atr"]>0
corr=scope["_lx_corr"]("TEST",t)
assert corr is not None
future0=prices["TEST"][82]
prices["TEST"][82]=(future0[0],future0[1],future0[2]*10,future0[3]/10,future0[4]*2)
fx2=scope["_lx_features"]("TEST",t)
assert fx2==fx,("H1_LOOKAHEAD","future bar changed entry features")
assert scope["_lx_corr"]("TEST",t)==corr
prices["TEST"][82]=future0
# Capital-protective stop unit.
feat={"atr":.02,"close":96.,"ema8":99.,"ema21":101.,"btc6":-.03,
      "btcshock":True}
reason,_=scope["_lx_statedecision"]("FULL_LAYER","TREND",3,"LONG",100.,.03,.01,feat,(95.,100.),0.,2,.8)
assert reason=="ADAPTIVE_ATR_LOSS",reason
# Dynamic drawdown must not trigger by unrealized profit alone.
feat2={"atr":.01,"close":108.,"ema8":107.,"ema21":105.,"btc6":.01,
      "btcshock":False}
reason,_=scope["_lx_statedecision"]("FULL_LAYER","TREND",8,"LONG",100.,.03,.01,feat2,(106.,110.),.09,0,.8)
assert reason is None,reason
# Model must not allow exit after native prior exit, nor touch HYPE.
m={"entryPrice":prices["TEST"][80][1],"exitPrice":prices["TEST"][88][1],
   "entryTs":t,"exitTs":t+8*H,"exitReason":"NATIVE"}
c=dict(s="V4",t=t,symbol="TEST",side="LONG",route="TREND",family="TREND",
       model=m,id="unit-candidate")
scope["_lx_prepare"](c)
assert m["entryTs"]<m["exitTs"]<=t+8*H
native=dict(entryPrice=m["entryPrice"],entryTs=t,exitTs=t+H,exitPrice=100.,exitReason="NATIVE")
c2=dict(s="V4",t=t,symbol="TEST",side="LONG",route="TREND",family="TREND",model=native,id="native-earlier")
scope["_lx_prepare"](c2)
assert native["exitTs"]==t+H
hyper=dict(entryPrice=40.,entryTs=t,exitTs=t+8*H,exitPrice=42.,exitReason="HYPE_NATIVE")
c3=dict(s="HYPE",t=t,symbol="TEST",side="LONG",route="HYPE",family="HYPE",model=hyper,id="hype-untouched")
scope["_lx_prepare"](c3)
assert hyper["exitTs"]==t+8*H and hyper["exitPrice"]==42.
# Data missing => do not fabricate an advantageous exit.
c4=dict(s="Q102",t=t,symbol="MISSING",side="SHORT",route="HIGH_VOL",family="HIGH_VOL",
        model=dict(entryTs=t,entryPrice=5.0,exitTs=t+8*H,exitPrice=4.,exitReason="NATIVE"),id="missing")
scope["_lx_prepare"](c4)
assert c4["model"]["exitTs"]==t+8*H
print("PASS: causal-prefix-invariance, BTC-correlation-prefix, ATR-stop, trend-profit-preservation, native-exit-priority, HYPE-unchanged, missing-data-unresolved")
