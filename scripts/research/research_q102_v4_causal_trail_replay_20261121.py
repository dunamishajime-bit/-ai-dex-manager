#!/usr/bin/env python3
"""Research only. Causal Q102 next-M5-open protective exit, integrated STABLE4 replay.
No production writes, no orders. Preserves earlier original exits and HYPE unchanged.
"""
from pathlib import Path
import os,hashlib,time,json,sys

ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
BASE=ROOT/"DIRECTION_RESEARCH_20261109"/"STABLE3_REPRO_RECOVERED_20261113"
WRAPPER=BASE/"portfolio_stable4_gross425_v4_475_l3_q102_h48_20261116.py"
SRC=WRAPPER.read_text(encoding="utf-8-sig")
HASH=hashlib.sha256(WRAPPER.read_bytes()).hexdigest()
assert HASH=="595fcf25a164392d70f156738c595f2af2697817166255bed2a6aa85b2cbd7f7",("WRAPPER_SHA_DRIFT",HASH)
NAME='out_name="STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1"'
ANCHOR='exec(compile(orig,str(SRC)+"::PRETARGET_STABLE_"+case,"exec"),{"__name__":"__main__"})'
assert SRC.count(NAME)==1 and SRC.count(ANCHOR)==1
os.environ["DISDEX_Q102_ADOPTED_MODE"]="ON"
os.environ["DISDEX_PRETARGET_STABLE_CASE"]="STABLE3"

# patch prelude is injected into generated research simulator before simulate();
# inputs remain model candidate tapes, historical M5 OHLC data and exit models.
PATCH=r'''
# RESEARCH ONLY: earliest additional adverse stop, next bar OPEN, never candle's own open.
_Q5_CACHE={}
_Q5_PATH_SHA={}
_Q5_LOAD_MISSING=0
def _q5_series(sym):
 if sym in _Q5_CACHE:return _Q5_CACHE[sym]
 arr={}
 for _fd,_suffix in (("aster-public-v3-5m-prefix","20250924-20260803"),("aster-public-v3-5m-suffix","20260803-20261001")):
  _p=R/_fd/(sym+"-5m-"+_suffix+".jsonl.gz")
  if not _p.exists():continue
  _hh=hashlib.sha256()
  with _p.open("rb") as _fh:
   for _chunk in iter(lambda:_fh.read(262144),b""):_hh.update(_chunk)
  _Q5_PATH_SHA[str(_p)]=_hh.hexdigest()
  with gzip.open(_p,"rt",encoding="utf8") as _f:
   for _line in _f:
    if not _line.strip():continue
    _r=json.loads(_line)
    _ts=int(_r[0]);_op,_hi,_lo,_cl=map(float,_r[1:5])
    if _ts in arr:raise RuntimeError("Q102_DUPLICATE_M5:"+sym)
    if not (math.isfinite(_op) and _op>0 and math.isfinite(_hi) and _hi>=_op and math.isfinite(_lo) and _lo<=_op and _lo>0 and math.isfinite(_cl) and _lo<=_cl<=_hi):
     raise RuntimeError("Q102_INVALID_M5:"+sym)
    arr[_ts]=(_op,_hi,_lo,_cl)
 _Q5_CACHE[sym]=arr
 return arr
_Q102_PROTECTIVE_AUDIT=[]
_Q102_PROTECTIVE_EXITS=0
_Q102_PROTECTIVE_GAP=0
_Q102_PROTECTIVE_SOURCE_MISSING=0
_Q102_PROTECTIVE_NO_HIT=0
_Q102_STOP_PCT=__QSTOP__
for _c in raw:
 if _c["s"]!="Q102" or _c["model"] is None:continue
 _md=_c["model"];_t=int(_c["t"]);_end=int(_md["exitTs"]);_ep=float(_md["entryPrice"])
 if _end<=_t+FM:continue
 _data=_q5_series(_c["symbol"])
 if not _data or _t not in _data:
  _Q102_PROTECTIVE_SOURCE_MISSING+=1
  continue
 _stop=_ep*(1-_Q102_STOP_PCT if _c["side"]=="LONG" else 1+_Q102_STOP_PCT)
 _exit=None;_gap=False
 for _tm in range(_t+FM,_end,FM):
  _prev=_data.get(_tm-FM);_next=_data.get(_tm)
  if _prev is None or _next is None:
   _gap=True;break
  _breach=(_prev[2]<=_stop) if _c["side"]=="LONG" else (_prev[1]>=_stop)
  if _breach:
   _exit=(_tm,_next[0]);break
 if _gap:
  _Q102_PROTECTIVE_GAP+=1
 elif _exit is None:_Q102_PROTECTIVE_NO_HIT+=1
 else:
  _old=(int(_md["exitTs"]),float(_md["exitPrice"]),str(_md["exitReason"]))
  _md["exitTs"]=_exit[0]
  _md["exitPrice"]=_exit[1]
  _md["exitReason"]="Q102_EXTRA_CAUSAL_STOP_NEXT_M5_OPEN_"+str(int(100*_Q102_STOP_PCT))
  _Q102_PROTECTIVE_EXITS+=1
  _Q102_PROTECTIVE_AUDIT.append(dict(signal_id=_c["id"],symbol=_c["symbol"],side=_c["side"],entry_utc=iso(_t),new_exit_utc=iso(_exit[0]),new_exit_price=_exit[1],old_exit_utc=iso(_old[0]),old_exit_price=_old[1],old_exit_reason=_old[2],stop_pct=100*_Q102_STOP_PCT))
print("Q102_ADDITIONAL_STOP",_Q102_STOP_PCT,"early_exits",_Q102_PROTECTIVE_EXITS,"missing_source",_Q102_PROTECTIVE_SOURCE_MISSING,"missing_or_gap_M5",_Q102_PROTECTIVE_GAP,"covered_unhit",_Q102_PROTECTIVE_NO_HIT,flush=True)
'''
IDLE_PATCH='\n# Research only: additional IDLE early hard stop using *previous completed* M5 candle,\n# actual next M5 OPEN with gap/slippage risk; preserve older original exits and HYPE.\n_IDLE_STOP_PCT=__ISTOP__\n_IDLE_STOP_EARLY=0\n_IDLE_STOP_MISSING=0\n_IDLE_STOP_GAP=0\n_IDLE_STOP_UNHIT=0\n_IDLE_STOP_AUDIT=[]\nfor _c in raw:\n if _c["s"]!="IDLE" or _c["model"] is None:continue\n _md=_c["model"];_entry=int(_c["t"]);_end=int(_md["exitTs"]);_ep=float(_md["entryPrice"])\n if _end<=_entry+FM:continue\n _data=_q5_series(_c["symbol"])\n if not _data or _entry not in _data:_IDLE_STOP_MISSING+=1;continue\n _limit=_ep*(1-_IDLE_STOP_PCT if _c["side"]=="LONG" else 1+_IDLE_STOP_PCT)\n _hit=None;_gap=False\n for _tm in range(_entry+FM,_end,FM):\n  _previous=_data.get(_tm-FM);_current=_data.get(_tm)\n  if _previous is None or _current is None:\n   _gap=True;break\n  _breach=(_previous[2]<=_limit) if _c["side"]=="LONG" else (_previous[1]>=_limit)\n  if _breach:_hit=(_tm,_current[0]);break\n if _gap:_IDLE_STOP_GAP+=1\n elif not _hit:_IDLE_STOP_UNHIT+=1\n else:\n  _old=(int(_md["exitTs"]),float(_md["exitPrice"]),str(_md["exitReason"]))\n  _md["exitTs"]=_hit[0];_md["exitPrice"]=_hit[1]\n  _md["exitReason"]="IDLE_EXTRA_CAUSAL_STOP_NEXT_M5_OPEN_"+str(int(100*_IDLE_STOP_PCT))\n  _IDLE_STOP_EARLY+=1\n  _IDLE_STOP_AUDIT.append(dict(signal_id=_c["id"],symbol=_c["symbol"],side=_c["side"],entry_utc=iso(_entry),new_exit_utc=iso(_hit[0]),old_exit_utc=iso(_old[0]),old_exit_reason=_old[2]))\nprint("IDLE_ADDITIONAL_STOP",_IDLE_STOP_PCT,"early_exits",_IDLE_STOP_EARLY,"missing",_IDLE_STOP_MISSING,"gap",_IDLE_STOP_GAP,"unhit",_IDLE_STOP_UNHIT,flush=True)\n'
V4_PATCH='\n# Research only V4 peak-profit-protection: completed M5 close to measured MFE,\n# next bar open to exit; no access to current incomplete or future bars.\n_V4_ARM=__ARM__\n_V4_BACK=__BACK__\n_V4_TRAIL_CLOSED=0\n_V4_TRAIL_MISSING=0\n_V4_TRAIL_GAPS=0\n_V4_TRAIL_EXCLUDED_SPECIAL=0\n_V4_TRAIL_NO_HIT=0\nfor _c in raw:\n if _c["s"]!="V4" or _c["model"] is None:continue\n _md=_c["model"];_ent=int(_c["t"]);_end=int(_md["exitTs"]);_ep=float(_md["entryPrice"])\n if _md.get("reversal") or _md.get("partialEvents"):\n  _V4_TRAIL_EXCLUDED_SPECIAL+=1\n  continue\n if _end<=_ent+FM:continue\n _d=_q5_series(_c["symbol"])\n if not _d or _ent not in _d:_V4_TRAIL_MISSING+=1;continue\n _best=0.;_out=None;_gap=False\n for _tm in range(_ent+FM,_end,FM):\n  _a=_d.get(_tm-FM);_b=_d.get(_tm)\n  if _a is None or _b is None:_gap=True;break\n  _r=(_a[3]/_ep-1) if _c["side"]=="LONG" else (1-_a[3]/_ep)\n  _best=max(_best,_r)\n  if _best>=_V4_ARM and (_best-_r)>=_V4_BACK:\n   _out=(_tm,_b[0]);break\n if _gap:_V4_TRAIL_GAPS+=1\n elif not _out:_V4_TRAIL_NO_HIT+=1\n else:\n  _oldts=int(_md["exitTs"])\n  assert _ent<_out[0]<_oldts\n  _md["exitTs"]=_out[0];_md["exitPrice"]=_out[1]\n  _md["exitReason"]="V4_CAUSAL_M5_CLOSE_PROFIT_TRAIL_NEXT_OPEN"\n  _V4_TRAIL_CLOSED+=1\nprint("V4_PROFIT_TRAIL",_V4_ARM,_V4_BACK,"early",_V4_TRAIL_CLOSED,"missing",_V4_TRAIL_MISSING,"gaps",_V4_TRAIL_GAPS,"special_skipped",_V4_TRAIL_EXCLUDED_SPECIAL,flush=True)\n'
# Exit management from daily loss gate remains independent to prevent missed checkpoints.
EXIT_PATCH=r'''
_a="if not v52_latched and v52_session_open(t):"
assert orig.count(_a)==1,("V52_EXIT_GATE_ANCHOR",orig.count(_a))
orig=orig.replace(_a,"if v52_session_open(t):",1)
'''
REARM_PATCH=r'''
_a="v4_max_dd=0.0"
assert orig.count(_a)==1
orig=orig.replace(_a,_a+"\n v4_dd_resume_blocked=False",1)
_a="v4_max_dd=max(v4_max_dd,1-eq/v4_equity_peak)"
assert orig.count(_a)==1
_b="v4_current_dd=max(0.0,1-eq/v4_equity_peak)\n   v4_max_dd=max(v4_max_dd,v4_current_dd)\n   if v4_current_dd >= 0.20: v4_dd_resume_blocked=True\n   elif v4_current_dd <= 0.15: v4_dd_resume_blocked=False"
orig=orig.replace(_a,_b,1)
assert orig.count("v4_max_dd<=0.21+1e-12")==2
orig=orig.replace("v4_max_dd<=0.21+1e-12","(not v4_dd_resume_blocked)",2)
assert orig.count("v4_max_dd>0.21+1e-12")==1
orig=orig.replace("v4_max_dd>0.21+1e-12","v4_dd_resume_blocked",1)
'''
for pct,idle_pct,rearm,arm,back in ((0.03,0.03,False,0.04,0.02),(0.03,0.03,False,0.05,0.03),(1.0,0.03,False,0.04,0.02)):
 case=f"DD_STUDY_Q102_STOP{int(pct*100)}_V4_TRAIL{int(arm*100)}_{int(back*1000)}_V52_EXIT_{'REARM20_15' if rearm else 'LATCH21'}_20261121"
 out=ROOT/case
 if out.exists() and (out/"RUN_MANIFEST.json").exists():
  print("ALREADY_EXISTS_SKIP",case,flush=True);continue
 src=SRC.replace(NAME,f'out_name="{case}"',1)
 inj=f"""
assert orig.count("def simulate(name,bps,priority,include_v4):")==1
orig=orig.replace("def simulate(name,bps,priority,include_v4):",_QPATCH+"\\ndef simulate(name,bps,priority,include_v4):",1)
print("Q102_CASE_ORIG_SHA",hashlib.sha256(orig.encode()).hexdigest(),flush=True)
"""
 patch="_QPATCH="+repr(PATCH.replace("__QSTOP__",repr(pct))+V4_PATCH.replace("__ARM__",repr(arm)).replace("__BACK__",repr(back)))+"\n"+EXIT_PATCH+(REARM_PATCH if rearm else "")+"\n"+inj
 assert src.count(ANCHOR)==1
 src=src.replace(ANCHOR,patch+"\n"+ANCHOR,1)
 print("RUN",case,time.time(),flush=True)
 exec(compile(src,str(WRAPPER)+"::Q102STOP"+str(pct),"exec"),{"__name__":"__main__","__file__":str(WRAPPER)})
 print("COMPLETE",case,time.time(),flush=True)
