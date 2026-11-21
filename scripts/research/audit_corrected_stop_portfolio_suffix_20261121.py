#!/usr/bin/env python3
"""Audit-only causal replay: force already-declared initial STOP to execute on M5.
Do NOT use as Production candidate. Does not change native runner or original files.
In this replay the original modeled STOP, TP, partial, time exit and admission
algorithm are unchanged unless a tighter hard STOP was touched earlier on M5.
"""
from pathlib import Path
import hashlib,os,sys,json,time
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
SRC=R/"DIRECTION_RESEARCH_20261109"/"STABLE3_REPRO_RECOVERED_20261113"/"portfolio_stable4_gross425_v4_475_l3_q102_h48_20261116.py"
assert hashlib.sha256(SRC.read_bytes()).hexdigest()=="595fcf25a164392d70f156738c595f2af2697817166255bed2a6aa85b2cbd7f7","WRAPPER_SHA_DRIFT"
content=SRC.read_text(encoding="utf-8-sig")
O='out_name="STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1"'
A='exec(compile(orig,str(SRC)+"::PRETARGET_STABLE_"+case,"exec"),{"__name__":"__main__"})'
assert content.count(O)==1 and content.count(A)==1
os.environ["DISDEX_Q102_ADOPTED_MODE"]="ON"
os.environ["DISDEX_PRETARGET_STABLE_CASE"]="STABLE3"
fix_code=r'''
# Already-declared initial stop must be modeled on the first M5 bar that
# crosses it, before other native modeled exits. This is NOT a new stop rule.
_STOP_COUNTS=collections.Counter()
_STOP_TRACE=[]
_STOP_ISSUES=[]
def _audit_stop_ratio(c):
 s=c["s"];v=c.get("v") or {}
 if c.get("v4_core"):return None
 if s=="V4":
  z=v4life.get(c["id"])
  if z and not z.get("reversal") and z.get("exitSpec",{}).get("kind")=="TIME":return .08
  return None
 if s=="PENGU":
  return None if c.get("model",{}).get("reversal") else (.06 if c["route"]=="RECOVERY_V8" else .08)
 if s=="Q102" and c["id"].startswith("Q102P_"):
  z=v
  return float(z["hardStop"]) if "hardStop" in z else None
 if s=="IDLE":return .10
 if s=="FET":return float(v["hardStopPct"]) if "hardStopPct" in v else None
 # Q102Q01365 stop5 and HYPE native price STOP are deliberately excluded:
 # their live trade execution parity is not established in current research.
 return None
def _audit_patch_native_initial_stops():
 for c in raw:
  m=c.get("model")
  if m is None or c["s"] not in ("V4","PENGU","Q102","IDLE","FET"):
   continue
  dist=_audit_stop_ratio(c)
  if dist is None:
   _STOP_COUNTS["NOT_AUDITED_"+c["s"]]+=1
   continue
  _STOP_COUNTS["ELIGIBLE_"+c["s"]]+=1
  if m.get("reversal"):
   _STOP_COUNTS["REVERSAL_SKIPPED_"+c["s"]]+=1;continue
  ep=float(m["entryPrice"]);orig_end=int(m["exitTs"]);ent=int(m["entryTs"]);sgn=1 if c["side"]=="LONG" else -1
  stop=ep*(1-sgn*dist)
  if ent%FM or orig_end<=ent:
   _STOP_COUNTS["MALFORMED_TS_"+c["s"]]+=1;continue
  earliest=None;missing=False
  for tm in range(ent,orig_end,FM):
   z=five(c["symbol"],tm)
   if z is None:
    missing=True;break
   _,op,hi,lo,cl=z
   hit=lo<=stop if sgn==1 else hi>=stop
   if hit:
    earliest=(tm+FM,min(op,stop) if sgn==1 else max(op,stop))
    break
  if missing:
   _STOP_COUNTS["MISSING_M5_"+c["s"]]+=1;continue
  if earliest is None:
   _STOP_COUNTS["NEVER_TOUCH_"+c["s"]]+=1;continue
  ts,px=earliest
  if ts>=orig_end:
   _STOP_COUNTS["NATIVE_STOP_SAME_OR_EARLIER_"+c["s"]]+=1;continue
  previous=dict(exitTs=orig_end,exitPrice=m["exitPrice"],exitReason=m["exitReason"])
  m["exitTs"]=ts;m["exitPrice"]=px;m["exitReason"]="AUDIT_M5_DECLARED_INITIAL_STOP"
  if m.get("partialEvents"):
   m["partialEvents"]=[x for x in m["partialEvents"] if int(x.get("eventTs",x.get("ts",0)))<ts]
  c["funding"]=funding(c["symbol"],int(m["entryTs"]),int(m["exitTs"]),ep,c["side"])
  _STOP_COUNTS["STOP_REPAIRED_"+c["s"]]+=1
  _STOP_TRACE.append(dict(id=c["id"],runner=c["s"],symbol=c["symbol"],side=c["side"],
      stop_pct=dist*100,old_exit_utc=iso(orig_end),stop_exit_utc=iso(ts),
      old_reason=previous["exitReason"],old_price=previous["exitPrice"],stop_price=px))
_audit_patch_native_initial_stops()
print("AUDIT_STOP_PATCH_COUNTS",dict(_STOP_COUNTS),flush=True)
print("AUDIT_STOP_PATCH_SAMPLE",json.dumps(_STOP_TRACE[:10],ensure_ascii=False),flush=True)
'''
fix_v52='''assert orig.count("if not v52_latched and v52_session_open(t):")==1
orig=orig.replace("if not v52_latched and v52_session_open(t):","if v52_session_open(t):",1)
'''
for variant,enable_v52 in [("STOP_M5_SUFFIX",False),("STOP_M5_SUFFIX_V52_EXIT_INDEPENDENT",True)]:
 name="DD_STOP_COHERENCE_"+variant+"_20261121"
 manifest=R/name/"RUN_MANIFEST.json"
 if manifest.exists():
  print("REPLAY_ALREADY_EXISTS",name,flush=True);continue
 s=content.replace(O,f'out_name="{name}"',1)
 inject=f"""
fixed_code={fix_code!r}
src_stop_anchor='def simulate(name,bps,priority,include_v4):'
assert orig.count(src_stop_anchor)==1
orig=orig.replace(src_stop_anchor,fixed_code+'\\n'+src_stop_anchor,1)
"""
 if enable_v52: inject+=fix_v52
 inject+='\nneedle="if not p.exists():M5[s]=None;return None"\nassert orig.count(needle)==1,"M5_LOADER_CHANGED"\nreplacement=\'if not p.exists():\\n     if s in ("ARBUSDT","ONDOUSDT","SUIUSDT") and folder=="aster-public-v3-5m-prefix":continue\\n     M5[s]=None;return None\'\norig=orig.replace(needle,replacement,1)\n'
 inject+='''compile(orig,str(SRC)+"::STOP_CORRECTED_COMPILE","exec")
print("AUDIT_STOP_GENERATED_SHA",hashlib.sha256(orig.encode("utf-8")).hexdigest(),flush=True)
'''
 assert s.count(A)==1
 s=s.replace(A,inject+"\n"+A,1)
 print("AUDIT_START",name,"time",time.time(),flush=True)
 exec(compile(s,str(SRC)+"::AUDIT_"+variant,"exec"),{"__name__":"__main__","__file__":str(SRC)})
 print("AUDIT_FINISHED",name,"time",time.time(),flush=True)
