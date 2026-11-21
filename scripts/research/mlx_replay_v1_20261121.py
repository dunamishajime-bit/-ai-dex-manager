#!/usr/bin/env python3
"""STABLE4 multi-layer causal exit / risk research ONLY. No trading actions.
A predeclared H1-close signal / next-H1-open execution counterfactual.
Not production-parity and not venue-executable order evidence.
"""
from pathlib import Path
import hashlib,os,time,sys
BASE=Path(r"C:\tmp\disdex-bt-20251001-20261001\DIRECTION_RESEARCH_20261109\STABLE3_REPRO_RECOVERED_20261113")
WRAPPER=BASE/"portfolio_stable4_gross425_v4_475_l3_q102_h48_20261116.py"
s=WRAPPER.read_text(encoding="utf-8-sig")
assert hashlib.sha256(WRAPPER.read_bytes()).hexdigest()=="595fcf25a164392d70f156738c595f2af2697817166255bed2a6aa85b2cbd7f7"
O='out_name="STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1"'
A='exec(compile(orig,str(SRC)+"::PRETARGET_STABLE_"+case,"exec"),{"__name__":"__main__"})'
assert s.count(A)==1 and s.count(O)==1
SRCROOT=BASE.parent.parent
os.environ["DISDEX_Q102_ADOPTED_MODE"]="ON"
os.environ["DISDEX_PRETARGET_STABLE_CASE"]="STABLE3"
EXIT_PATCH=r'''
# Research-only repair: exit processing independent from V52 new-entry loss latch
sneedle="if not v52_latched and v52_session_open(t):"
assert orig.count(sneedle)==1
orig=orig.replace(sneedle,"if v52_session_open(t):",1)
'''
ENGINE=r'''
# MLX-1 pre-registered multi-layer risk EXIT. H1-close-only observations.
# Each decision at hour t uses bar at t-H (completed) or older.
# The modeled close executes at H1 bar's OPEN at t, no intrabar hindsight price.
_LX_MODE="__MODE__"
_LX_VERBOSE=False
_LX_ELIGIBLE={"Q102","V4","IDLE","FET","PENGU","RESIDUAL"}
_LX_SIZEABLE={"Q102","V4","IDLE","FET"}
_LX_FEATURE_MISSING=0
_LX_ENDPATH_MISSING=0
_LX_ENTRY_MISSING=0
_LX_EXIT_REASONS=collections.Counter()
_LX_SIZE_DECISIONS=[]
_LX_EXEC_TRACE=[]
def _lx_sgn(side):
 assert side in ("LONG","SHORT")
 return 1 if side=="LONG" else -1
def _lx_clip(v,l,h):return min(h,max(l,v))
def _lx_closed(sym,now,k=1):
 # k=1 means bar closing precisely at 'now', safe as-of at time 'now'.
 return bar(sym,(now//H)*H-k*H)
def _lx_atr_pct(sym,now,length=14):
 rows=[]
 for k in range(1,length+1):
  z=_lx_closed(sym,now,k);p=_lx_closed(sym,now,k+1)
  if z is None or p is None:return None
  rows.append(max(z[2]-z[3],abs(z[2]-p[4]),abs(z[3]-p[4])) / p[4])
 return sum(rows)/length
def _lx_closes(sym,now,n=27):
 z=[_lx_closed(sym,now,k) for k in range(1,n+1)]
 return None if not all(z) else [v[4] for v in z]
def _lx_mean(z):
 return sum(z)/len(z)
def _lx_emalike(z,n):
 # z most recent first, backward exponentially decaying weights.
 a=2/(n+1)
 wt=1.;sm=0.;tot=0.
 for v in z[:min(len(z),3*n)]:
  sm+=wt*v;tot+=wt;wt*=1-a
 return sm/tot
def _lx_corr(sym,now,n=24):
 a=_lx_closes(sym,now,n+1);b=_lx_closes("BTCUSDT",now,n+1)
 if not a or not b:return None
 x=[a[k]/a[k+1]-1 for k in range(n)]
 y=[b[k]/b[k+1]-1 for k in range(n)]
 xm=_lx_mean(x);ym=_lx_mean(y)
 xx=sum((k-xm)**2 for k in x);yy=sum((k-ym)**2 for k in y)
 if xx<=1e-18 or yy<=1e-18:return 0.
 return sum((u-xm)*(v-ym) for u,v in zip(x,y))/(xx*yy)**0.5
def _lx_features(sym,t):
 cl=_lx_closes(sym,t,27)
 atr=_lx_atr_pct(sym,t,14)
 if cl is None or atr is None:return None
 fast=_lx_emalike(cl,8);slow=_lx_emalike(cl,21)
 btc=_lx_closes("BTCUSDT",t,27)
 batr=_lx_atr_pct("BTCUSDT",t,14)
 if btc is None or batr is None:return None
 # Market regime based on completed close, directional 6h BTC return, realized range shock.
 last_b=_lx_closed("BTCUSDT",t,1)
 shock=last_b[2]/last_b[3]-1 > 2.2*batr
 return dict(atr=max(atr,1e-6),ema8=fast,ema21=slow,close=cl[0],
             btc6=btc[0]/btc[6]-1,btc24=btc[0]/btc[24]-1,
             btcshock=shock,btc_atr=batr)
def _lx_direction_failure(sgn,fx):
 return (fx["close"] < fx["ema8"] and fx["ema8"] < fx["ema21"]) if sgn==1 else (fx["close"] > fx["ema8"] and fx["ema8"] > fx["ema21"])
def _lx_kind(route,family):
 v=(str(route)+"|"+str(family)).upper()
 if any(t in v for t in ("MR","RECOVERY","REVERS","MEAN")):return "MEAN_REV"
 if any(t in v for t in ("BRK","BREAK","HIGH_VOL","TREND","MOMENTUM")):return "TREND"
 return "MIXED"
def _lx_statedecision(mode,kind,age,side,ep,initialstop,entryatr,feat,
                      prev_stops,prev_mfe,consecutive_invalid,btc_corr):
 # This helper is pure except through its inputs: no future prices.
 sgn=_lx_sgn(side);pnl=sgn*(feat["close"]/ep-1)
 failed=_lx_direction_failure(sgn,feat)
 current_atr=max(feat["atr"],1e-6)
 adversewick = ((ep - prev_stops[0])/ep) if sgn==1 else ((prev_stops[1] - ep)/ep)
 adverse_close=pnl<=-initialstop
 if adversewick>=initialstop or adverse_close:
  return "ADAPTIVE_ATR_LOSS",pnl
 if mode=="ATR_ONLY":return None,pnl
 # Profit state with hysteresis, no immediate flip at first reversal.
 if prev_mfe>=1.7*initialstop:
  trailwidth=(1.6 if kind=="TREND" and not failed else 1.1)*current_atr
  locked=max(.35*initialstop,prev_mfe-trailwidth)
  if pnl<=locked and (failed or pnl<=prev_mfe-1.8*current_atr):
   return "CONDITIONAL_MFE_LOCK",pnl
 if consecutive_invalid>=2 and age>=3 and pnl<-.5*initialstop:
  if kind in ("TREND","MIXED") or (kind=="MEAN_REV" and age>=6):
   return "DIRECTION_INVALIDATED_2H",pnl
 if btc_corr is not None and btc_corr>=.45 and feat["btcshock"] and sgn*feat["btc6"]<0 and pnl<-current_atr:
  return "BTC_CORRELATED_SHOCK",pnl
 if age>=12 and prev_mfe<.55*initialstop and pnl<-.35*initialstop and failed:
  return "OPPORTUNITY_COST_TIME_DECAY",pnl
 return None,pnl
def _lx_prepare(c):
 global _LX_FEATURE_MISSING,_LX_ENDPATH_MISSING,_LX_ENTRY_MISSING
 if c["s"] not in _LX_ELIGIBLE or c.get("model") is None:return
 model=c["model"]
 if model.get("reversal") or model.get("partialEvents"):
  _LX_EXIT_REASONS["SKIP_NATIVE_PARTIAL_OR_REVERSAL"]+=1
  return
 t=int(c["t"]); end=int(model["exitTs"])
 feat=_lx_features(c["symbol"],t)
 if feat is None:
  _LX_ENTRY_MISSING+=1;return
 ep=float(model["entryPrice"]); kind=_lx_kind(c.get("route"),c.get("family"))
 startstop=_lx_clip((2.2 if kind=="MEAN_REV" else 2.6)*feat["atr"],.014,.085)
 c["_lx_initstop"]=startstop;c["_lx_atr"]=feat["atr"]
 c["_lx_kind"]=kind
 c["_lx_btc_corr"]=_lx_corr(c["symbol"],t)
 c["_lx_btc_stress"]=feat["btcshock"]
 c["_lx_entry_btc_alignment"]=_lx_sgn(c["side"])*feat["btc6"]>=0
 if end<=t+H:return
 mfe=0.;bad=0;prior_bad=False
 _begin=((t//H)+1)*H if t%H==0 else ((t//H)+2)*H
 for nt in range(_begin,end,H):
  z=_lx_closed(c["symbol"],nt,1)
  _candles=bars(c["symbol"])
  px=None
  if _candles is not None:
   _first,_vec=_candles
   _ix=(nt-_first)//H
   if (nt-_first)%H==0 and 0<=_ix<len(_vec):px=_vec[_ix][1]
  fx=_lx_features(c["symbol"],nt)
  if z is None or px is None or fx is None:
   _LX_ENDPATH_MISSING+=1;break
  sgn=_lx_sgn(c["side"])
  pnl=sgn*(z[4]/ep-1)
  mfe=max(mfe,pnl)
  is_bad=_lx_direction_failure(sgn,fx)
  bad=bad+1 if is_bad else 0
  reason, curr=_lx_statedecision(_LX_MODE,kind,((nt-t)//H),c["side"],
                    ep,startstop,feat["atr"],fx,(z[3],z[2]),mfe,bad,c["_lx_btc_corr"])
  if reason:
   assert t<nt<end
   model["exitTs"]=nt
   model["exitPrice"]=px  # only as-of next H1 OPEN, not full candle OHLC
   model["exitReason"]="MLX_"+reason+"_NEXT_H1_OPEN"
   _LX_EXIT_REASONS[reason]+=1
   _LX_EXEC_TRACE.append(dict(signal_id=c["id"],runner=c["s"],symbol=c["symbol"],side=c["side"],
      reason=reason,observed_candle_utc=iso(nt-H),exit_execution_utc=iso(nt),
      exit_price=px,original_exit_utc=iso(end),atr14_entry_pct=100*feat["atr"],
      initial_atr_stop_pct=100*startstop,btc24h_return_pct=100*feat["btc24"]))
   break
def _lx_force_close_native_if_invalid(c):
 global _LX_FEATURE_MISSING
 # Explicit debt tracking: incomplete data are NOT magically risk-free.
 if c["s"] in _LX_ELIGIBLE and c.get("model") is not None and "_lx_initstop" not in c:
  _LX_FEATURE_MISSING+=1
if _LX_MODE!="CONTROL":
 for _lx_c in raw:
  _lx_prepare(_lx_c)
  _lx_force_close_native_if_invalid(_lx_c)
print("MLX_LAYERS",_LX_MODE,"reason_counts",dict(_LX_EXIT_REASONS),"audit_rows",
      len(_LX_EXEC_TRACE),"missing_entry",_LX_ENTRY_MISSING,
      "missing_path",_LX_ENDPATH_MISSING,flush=True)
'''
SIZEPATCH=r'''
# Research-only L3: entry risk budget from causal ATR stop and open position
# reservations. Never change HYPE or V52 sizing or native STOP.
_anchor='   if (s in FORMAL_PRIORITY and any(v["s"]=="RESIDUAL" for v in opened.values())'
assert orig.count(_anchor)==1,("MLX_ENTRY_GROSS_ANCHOR",orig.count(_anchor))
_size=r"""   if _LX_MODE in ("RISK_SIZED","PORTFOLIO_SIZED") and s in _LX_SIZEABLE and c.get("_lx_initstop") is not None and eq is not None and eq>0:
    _dist=c["_lx_initstop"]
    _prev_g=g
    _riskbudget=.014 if _LX_MODE=="RISK_SIZED" else .012
    if _LX_MODE=="PORTFOLIO_SIZED" and c.get("_lx_btc_stress") and not c.get("_lx_entry_btc_alignment"): _riskbudget*=.5
    g=min(g,_riskbudget/_dist)
    if _LX_MODE=="PORTFOLIO_SIZED":
     _reserved=0.
     for _pos in opened.values():
      if _pos["s"]=="V52":continue
      _pd=float(_pos.get("_lx_initstop") or .05)
      _reserved+=float(_pos["gross"])*_pd
     _portlimit=.06
     g=min(g,max(0.,(_portlimit-_reserved)/_dist))
    _LX_SIZE_DECISIONS.append(dict(signal_id=c["id"],runner=s,at_utc=iso(t),
       gross_before=_prev_g,gross_after=g,initial_stop_pct=100*_dist,
       per_trade_risk_estimate_pct=100*g*_dist))
"""
orig=orig.replace(_anchor,_size+_anchor,1)
_anchor='   opened[pid]=q'
assert orig.count(_anchor)==1
orig=orig.replace(_anchor,'   q["_lx_initstop"]=c.get("_lx_initstop")\n'+_anchor,1)
'''
# Purity and no-lookahead tests for synthetic features, exact comparisons.
for mode in ["CONTROL","ATR_ONLY","FULL_LAYER","RISK_SIZED","PORTFOLIO_SIZED"]:
 name=f"DD_MLX_COHERENT_{mode}_20261121"
 path=SRCROOT/name
 if path.exists() and (path/"RUN_MANIFEST.json").exists():
  print("ALREADY_DONE",name,flush=True);continue
 ss=s.replace(O,f'out_name="{name}"',1)
 steps=[EXIT_PATCH]
 if mode!="CONTROL":
  steps.append("_LX_MODE="+repr(mode)+"\n")
  steps.append("lcode="+repr(ENGINE.replace("__MODE__",mode))+"\n")
  steps.append('a="def simulate(name,bps,priority,include_v4):"\nassert orig.count(a)==1\norig=orig.replace(a,lcode+"\\n"+a,1)\n')
  if mode in ("RISK_SIZED","PORTFOLIO_SIZED"):
   steps.append(SIZEPATCH)
 else:
  pass
 steps.append('compile(orig,str(SRC)+"::MLX_COMPILE_CHECK","exec")\nprint("MLX_GENERATED_SHA",hashlib.sha256(orig.encode("utf-8")).hexdigest(),flush=True)\n')
 ss=ss.replace(A,"\n".join(steps)+A,1)
 print("START_MLX",name,time.time(),flush=True)
 exec(compile(ss,str(WRAPPER)+"::MLX"+mode,"exec"),{"__name__":"__main__","__file__":str(WRAPPER)})
 print("END_MLX",name,time.time(),flush=True)
