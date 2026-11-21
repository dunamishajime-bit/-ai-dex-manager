#!/usr/bin/env python3
"""PRISM III full compound portfolio AB: PENGU + IDLE traded-M5 execution.

1. Replays the EXACT prior coherent STABLE3 GROSS425/V52-latch corrected case.
2. Removes PENGU entries in H1 with zero trades (all four IDs, no PnL sorting).
3. Substitutes 849 IDLE original native candidates with 790 trade-volume-aware
   modeled first-trade entry/stop/trail/expiration candidates. All 59 cases
   without a trade in the entry H1 are automatically omitted. IDs preserved.

Research only, not Production parity, not a LIVE activation/deployment or
order/STOP change. Historical model has prior research filters and Gross4.25.
"""
from __future__ import annotations
import hashlib,json,os
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
WORK=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
DIR=R/"DIRECTION_RESEARCH_20261109/STABLE3_REPRO_RECOVERED_20261113"
WRAPPER=DIR/"portfolio_stable4_gross425_v4_475_l3_q102_h48_20261116.py"
IDLE_REPLAY=WORK/"phase2_results/PRISM_IDLE_VOLUME_AWARE_849_LIFECYCLE.jsonl"
assert hashlib.sha256(WRAPPER.read_bytes()).hexdigest()=="595fcf25a164392d70f156738c595f2af2697817166255bed2a6aa85b2cbd7f7"
rows=[json.loads(x) for x in IDLE_REPLAY.open(encoding="utf8") if x.strip()]
assert len(rows)==849
assert all(x["id"]=="IDLEP_"+str(i+1).zfill(5) for i,x in enumerate(rows))
assert all(x["status"] in ("NO_TRADE_ENTRY_H1","VOLUME_TRADE_EXECUTION_PRICE_MODEL") for x in rows)
assert sum(x["status"]=="NO_TRADE_ENTRY_H1" for x in rows)==59
assert sum(x["status"]=="VOLUME_TRADE_EXECUTION_PRICE_MODEL" for x in rows)==790
assert all(x["side"]=="SHORT" for x in rows)
source_sha=hashlib.sha256(IDLE_REPLAY.read_bytes()).hexdigest()
print("PRISM3_IDLE_REPLAY_SOURCE_VALID",source_sha,"NO_TRADE",59,"VALID",790,flush=True)
os.environ["DISDEX_Q102_ADOPTED_MODE"]="ON"
os.environ["DISDEX_PRETARGET_STABLE_CASE"]="STABLE3"
TXT=WRAPPER.read_text(encoding="utf-8-sig")
old='out_name="STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1"'
new_name="DD_PRISM3_PENGU_IDLE_VOLUME_AWARE_20261122"
a='exec(compile(orig,str(SRC)+"::PRETARGET_STABLE_"+case,"exec"),{"__name__":"__main__"})'
if TXT.count(a)!=1 or TXT.count(old)!=1:raise ValueError("WRAPPER_CHANGE")
TXT=TXT.replace(old,'out_name="'+new_name+'"',1)
patch=r'''
source="if not v52_latched and v52_session_open(t):"
assert orig.count(source)==1
orig=orig.replace(source,"if v52_session_open(t):",1)

# Rewire IDLE to the independently verified 849->790 research source with
# same exact original candidate IDs; only trade execution price/time/STOPs
# are amended. The original 849 model price & exit references are stored
# separately for audit and are never silently overwritten.
idlep_old='_idlep=R/"DIRECTION_RESEARCH_20261109"/"IDLE_CURRENT_PRODUCTION_REPLAY_20261110"/"idle-production-candidates-with-m5-exits.jsonl"'
idlep_new='_idlep=pathlib.Path('+repr(r"__IDLE_PATH__")+')'
assert orig.count(idlep_old)==1
orig=orig.replace(idlep_old,idlep_new,1)
count_old='assert len(_idlerows)==849,len(_idlerows)'
count_new=r"""assert len(_idlerows)==849,len(_idlerows)
assert all(x.get("status") in ("NO_TRADE_ENTRY_H1","VOLUME_TRADE_EXECUTION_PRICE_MODEL") for x in _idlerows)
_idlep_missing=[x["id"] for x in _idlerows if x["status"]=="NO_TRADE_ENTRY_H1"]
_idlerows=[x for x in _idlerows if x["status"]=="VOLUME_TRADE_EXECUTION_PRICE_MODEL"]
assert len(_idlep_missing)==59 and len(_idlerows)==790
print("PRISM3_IDLE_TRADEABLE_INPUT",len(_idlerows),"OMITTED",len(_idlep_missing),flush=True)
"""
assert orig.count(count_old)==1
orig=orig.replace(count_old,count_new,1)
id_old='raw.append(dict(id="IDLEP_"+str(i).zfill(5),s="IDLE",t=t,symbol=z["symbol"],side=z["side"],'
id_new='raw.append(dict(id=z["id"],s="IDLE",t=t,symbol=z["symbol"],side=z["side"],'
assert orig.count(id_old)==1
orig=orig.replace(id_old,id_new,1)
# Legacy before-loop PENGU gating still admits 3 ghost entries; preserve both
# winning and losing 4 signal IDs as non-executable.
_NO_TRADE_IDS={
 "PENGU_00016":1763013600000,
 "PENGU_00071":1778716800000,
 "PENGU_00083":1783357200000,
 "PENGU_00093":1786532400000,
}
gate=r"""
_PENGU_NO_TRADE=__BAD_IDS__
_PENGU_NO_TRADE_GATE=[]
for c in raw:
 if c["s"]!="PENGU" or c["id"] not in _PENGU_NO_TRADE:continue
 assert int(c["t"])==_PENGU_NO_TRADE[c["id"]]
 _PENGU_NO_TRADE_GATE.append(c["id"])
 c["model"]=None
 c["gate_reason"]="PENGU_ZERO_REAL_TRADE_VOLUME_ENTRY_HOUR"
print("PRISM3_PENGU_ZERO_VOLUME_GATE",_PENGU_NO_TRADE_GATE,flush=True)
""".replace("__BAD_IDS__",repr(_NO_TRADE_IDS))
anchor="def simulate(name,bps,priority,include_v4):"
assert orig.count(anchor)==1
orig=orig.replace(anchor,gate+"\n"+anchor,1)
compile(orig,str(SRC)+"::PRISM3_DUAL_EXECUTION_COMPILE","exec")
print("PRISM3_DUAL_NATIVE_GENERATED_SHA",hashlib.sha256(orig.encode("utf8")).hexdigest(),flush=True)
'''
patch=patch.replace("__IDLE_PATH__",IDLE_REPLAY.as_posix())
TXT=TXT.replace(a,patch+"\n"+a,1)
print("START_PRISM3_FULL_DUAL_VOLUME_COMPOUND",new_name,flush=True)
exec(compile(TXT,str(WRAPPER)+"::PRISM3_FULL_DUAL","exec"),
    {"__name__":"__main__","__file__":str(WRAPPER)})
print("END_PRISM3_FULL_DUAL_VOLUME_COMPOUND",new_name,flush=True)
