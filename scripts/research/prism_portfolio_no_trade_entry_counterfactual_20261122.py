#!/usr/bin/env python3
"""PRISM III: A/B compound portfolio replay of unexecutable PENGU H1 entries.

Source-locked historical STABLE4 research wrapper, same V52 due-exit repair
as previous coherent CONTROL. Counterfactual excludes *all* PENGU entries
with ZERO traded M5 volume during the entry H1, winning and losing alike.

Not a production-parity replay: prior research gates and Gross4.25 model
remain. HYPE/FET/Q102/V4/V52 rules untouched. No venue actions.

Run in isolated Windows research user directory; no changes to pinned source.
"""
from __future__ import annotations
import hashlib,json,os,sys
from pathlib import Path
WORK=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
BASE=Path(r"C:\tmp\disdex-bt-20251001-20261001\DIRECTION_RESEARCH_20261109\STABLE3_REPRO_RECOVERED_20261113")
WRAPPER=BASE/"portfolio_stable4_gross425_v4_475_l3_q102_h48_20261116.py"
EXPECTED_WRAPPER_HASH="595fcf25a164392d70f156738c595f2af2697817166255bed2a6aa85b2cbd7f7"
if hashlib.sha256(WRAPPER.read_bytes()).hexdigest()!=EXPECTED_WRAPPER_HASH:
 raise ValueError("RESEARCH_WRAPPER_SOURCE_CHANGED_STOP")
os.environ["DISDEX_Q102_ADOPTED_MODE"]="ON"
os.environ["DISDEX_PRETARGET_STABLE_CASE"]="STABLE3"
TXT=WRAPPER.read_text(encoding="utf-8-sig")
output_name="DD_PRISM3_PENGU_TRADEABLE_H1_ENTRY_20261122"
output_reference='out_name="STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1"'
exec_anchor='exec(compile(orig,str(SRC)+"::PRETARGET_STABLE_"+case,"exec"),{"__name__":"__main__"})'
if TXT.count(exec_anchor)!=1 or TXT.count(output_reference)!=1:raise ValueError("REFERENCE_ANCHORS_CHANGED")
TXT=TXT.replace(output_reference,'out_name="'+output_name+'"',1)
PATCH=r'''
# V52 new-entry latch must not defer closing existing V52 positions, identical to
# published DD_MLX_COHERENT_CONTROL_20261121 scenario.
source="if not v52_latched and v52_session_open(t):"
assert orig.count(source)==1,("V52_RESEARCH_CONTROL_ANCHOR",orig.count(source))
orig=orig.replace(source,"if v52_session_open(t):",1)

# The four cases below are PREDEFINED by independently checking public Aster
# H1/M5 market volume, not selected by their win/loss outcome.
# The baseline already removes some candidates with unrelated research gates.
_NO_TRADE_IDS={
 "PENGU_00016":1763013600000,
 "PENGU_00071":1778716800000,
 "PENGU_00083":1783357200000,
 "PENGU_00093":1786532400000,
}
assert len(_NO_TRADE_IDS)==4
_NO_TRADE_GATE=r"""
# PRISM3 TRUE zero-trade H1 entry gate, as-of-only volume and no PnL label.
# Read-only historical model. Preserves candidate IDs; native model exits
# become invalid before portfolio admission. Winning 00071 also removed.
_RESEARCH_PENGU_NO_TRADE_IDS=__BAD_IDS__
_RESEARCH_ZERO_VOLUME_GATE_AUDIT=[]
for _cand in raw:
 if _cand["s"]!="PENGU" or _cand["id"] not in _RESEARCH_PENGU_NO_TRADE_IDS:continue
 _expected=_RESEARCH_PENGU_NO_TRADE_IDS[_cand["id"]]
 if int(_cand["t"])!=_expected:raise RuntimeError("PENGU_NO_TRADE_ID_TIMESTAMP_CHANGED")
 if _cand.get("model") is None:
  _RESEARCH_ZERO_VOLUME_GATE_AUDIT.append({"id":_cand["id"],"status":"ALREADY_REJECTED_UNRELATED_RULE"})
  continue
 _RESEARCH_ZERO_VOLUME_GATE_AUDIT.append({"id":_cand["id"],"status":"BLOCKED_ZERO_EXECUTABLE_H1_VOLUME"})
 _cand["model"]=None
 _cand["gate_reason"]="PENGU_ZERO_REAL_TRADE_VOLUME_ENTRY_HOUR"
print("PRISM3_ZERO_VOLUME_ENTRY_REJECTIONS",_RESEARCH_ZERO_VOLUME_GATE_AUDIT,flush=True)
"""
_NO_TRADE_GATE=_NO_TRADE_GATE.replace("__BAD_IDS__",repr(_NO_TRADE_IDS))
anchor="def simulate(name,bps,priority,include_v4):"
assert orig.count(anchor)==1,("PENGU_PORTFOLIO_SIM_ANCHOR",orig.count(anchor))
orig=orig.replace(anchor,_NO_TRADE_GATE+"\n"+anchor,1)
compile(orig,str(SRC)+"::PRISM3_NO_TRADE_COMPILE","exec")
print("PRISM3_GENERATED_SHA",hashlib.sha256(orig.encode("utf8")).hexdigest(),flush=True)
'''
TXT=TXT.replace(exec_anchor,PATCH+"\n"+exec_anchor,1)
print("START_PRISM3_GROSS425_PORTFOLIO",output_name,flush=True)
exec(compile(TXT,str(WRAPPER)+"::PRISM3_V3_RESEARCH","exec"),
    {"__name__":"__main__","__file__":str(WRAPPER)})
print("END_PRISM3_GROSS425_PORTFOLIO",output_name,flush=True)
