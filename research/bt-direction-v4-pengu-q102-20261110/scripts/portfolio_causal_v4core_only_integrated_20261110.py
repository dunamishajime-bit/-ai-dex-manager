#!/usr/bin/env python3
"""Causal-conservative integrated portfolio:
- Remove all retrospective V4 V2 candidates.
- Add only frozen native FAILED_BREAK core events selected by source Top3 sizing.
- Keep PENGU/Q102/FET/HYPE/IDLE/RESIDUAL/V52 research-model components unchanged.
- Optional three gates were formed on historical train half and checked on validation+forward.
Research only. No venue action.
"""
import hashlib,json,os
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
source=R/"dd_strict_v2_plus_v4q102_pengu_recovery_reversal_20261109.py"
orig=source.read_text(encoding="utf8")
gates=os.environ["DISDEX_CAUSAL_3GATES"]
assert gates in ("OFF","ON"),gates
out_name="VPS_CAUSAL_V4CORE_"+gates+"_3GATE_STOCK15_20261110"
replaces=[
 ('O=R/"VPS_DD_STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_20261109";O.mkdir(exist_ok=True)',
  'O=R/'+repr(out_name)+';O.mkdir(exist_ok=True)'),
 ('R/"V4_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"v4-exits.jsonl"',
  'R/"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109"/"v4-native-lifecycle-modeled-exits.jsonl"'),
 ('R/"PENGU_RECOVERY_EARLY_REVERSAL_20261109"/"pengu-exits.jsonl"',
  'R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl"'),
 ('R/"Q102_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"q102-exits.jsonl"',
  'R/"Q102_S34_SELECTED_NATIVE_EXIT_M5COMPLETE_20261109"/"q102-s34-selected-native-exits.jsonl"'),
]
for old,new in replaces:
 assert orig.count(old)==1,(old,orig.count(old));orig=orig.replace(old,new)
assert orig.count("STOCK_CAP=4.0")>=1
orig=orig.replace("STOCK_CAP=4.0","STOCK_CAP=1.5")
assert orig.count("gross=2.0,v=z,")==1
orig=orig.replace("gross=2.0,v=z,","gross=1.5,v=z,")
# Drop all hindsight V4 candidate rows before lifecycle assignment.
anchor='assert len(raw)==2715,(len(raw),2715)'
assert orig.count(anchor)==1
drop='''assert len(raw)==2715,(len(raw),2715)
_legacy_v4_count=sum(c["s"]=="V4" for c in raw)
assert _legacy_v4_count==1394,_legacy_v4_count
raw=[c for c in raw if c["s"]!="V4"]
print("CAUSAL_V4_DROP_LEGACY",_legacy_v4_count,flush=True)
'''
orig=orig.replace(anchor,drop)
# Add selected causal core after all ordinary model/funding assignment and V52 insertion.
anchor='print("CANDIDATES",len(raw),"V52",v52n,"EXIT_MODELS",len(raw)-sum(missing.values()),"MISSING",dict(missing),flush=True)'
assert orig.count(anchor)==1
add='''_core_path=R/"DIRECTION_RESEARCH_20261109"/"NATIVE_CAUSAL_SOURCE_REPLAY_20261110"/"v4-core-selected-integrated-candidates-20261110.jsonl"
_core_rows=list(jlines(_core_path))
assert len(_core_rows)==49,len(_core_rows)
for z in _core_rows:
 t=int(z["entryTs"]);e=int(z["exitTs"]);ep=float(z["entryPrice"])
 v={"rank":int(z["rank"]),"atr":float(z["atr"]),"score":float(z["score"]),"nativeCore":True}
 c=dict(id=z["id"],s="V4",t=t,symbol=z["symbol"],side=z["side"],route=z["route"],gross=float(z["requestedGross"]),v=v,
        model=dict(entryTs=t,entryPrice=ep,exitTs=e,exitPrice=float(z["exitPrice"]),exitReason=z["exitReason"]),
        src=str(_core_path))
 c["funding"]=funding(c["symbol"],t,e,ep,c["side"])
 raw.append(c)
print("CAUSAL_V4_CORE_ADDED",len(_core_rows),flush=True)
print("CANDIDATES",len(raw),"V52",v52n,"EXIT_MODELS",len(raw)-sum(missing.values()),"MISSING",dict(missing),flush=True)'''
orig=orig.replace(anchor,add)
# Sort native core by its true source rank at same timestamp.
sort0='a=sorted(raw,key=lambda c:(c["t"],priority[c["s"]],c["symbol"],c["id"]))'
assert orig.count(sort0)==1
orig=orig.replace(sort0,'a=sorted(raw,key=lambda c:(c["t"],priority[c["s"]],(int(c["v"].get("rank",99)) if c["s"]=="V4" else 0),c["symbol"],c["id"]))')
# Optional three causal-ish gates.
if gates=="ON":
 anchor='FORMAL_PRIORITY={"V4","Q102","PENGU","FET","V52"}'
 assert orig.count(anchor)==1
 gatecode='''_JUP_REL=-0.04089204262472046
_PENGU_V8_BTC_LIMIT=0.011611625094354983
_Q102_FET_RET14_MAX=0.048722800378429465
_before3=len(raw)
def _causal3(c):
 if c["s"]=="IDLE" and c.get("route")=="IDLE_JUP_RELATIVE_SHORT":
  f=c["v"].get("features") or {}
  if "rel24" not in f:raise RuntimeError("IDLE_JUP_REL24_MISSING")
  return float(f["rel24"])>=_JUP_REL
 if c["s"]=="PENGU" and c.get("route")=="RECOVERY_V8":
  if "btc24h" not in c["v"]:raise RuntimeError("PENGU_V8_BTC24_MISSING")
  return float(c["v"]["btc24h"])<=_PENGU_V8_BTC_LIMIT
 if c["s"]=="Q102" and c.get("symbol")=="FETUSDT":
  if "ret14" not in c["v"]:raise RuntimeError("Q102_FET_RET14_MISSING")
  return float(c["v"]["ret14"])<=_Q102_FET_RET14_MAX
 return True
raw=[c for c in raw if _causal3(c)]
print("CAUSAL_3GATE_REMOVED",_before3-len(raw),flush=True)
'''
 orig=orig.replace(anchor,gatecode+anchor)
orig=orig.replace("STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL","CAUSAL_V4CORE_"+gates+"_3GATE")
orig=orig.replace("v4_native_lifecycle_modeled=1394","v4_native_lifecycle_modeled=49")
orig=orig.replace("v4_direction_override_candidates=43","v4_direction_override_candidates=0")
print("CAUSAL_INTEGRATED_WRAPPER",gates,"SOURCE_SHA256",hashlib.sha256(source.read_bytes()).hexdigest(),flush=True)
exec(compile(orig,str(source)+"::CAUSAL_V4CORE_"+gates,"exec"),{"__name__":"__main__"})
folder=R/out_name
att={"status":"RESEARCH_CAUSAL_CONSERVATIVE_V4_CORE_ONLY_NOT_FULL_PRODUCTION_PARITY",
 "gates":gates,"legacyV4Removed":1394,"nativeCoreAdded":49,
 "sourceSha256":hashlib.sha256(source.read_bytes()).hexdigest(),
 "coreSourceSha256":hashlib.sha256((R/"DIRECTION_RESEARCH_20261109"/"NATIVE_CAUSAL_SOURCE_REPLAY_20261110"/"v4-core-selected-integrated-candidates-20261110.jsonl").read_bytes()).hexdigest(),
 "feesBps":[10,30],"stockGrossCap":1.5,
 "caveats":["V4 V2 retrospective candidate population fully removed","V4 native source body excluded because clean forward audit is negative; only native FAILED_BREAK core retained",
 "V52 remains historical price-model proxy, not executable-book reconstruction","RESIDUAL still has historical model gaps inherited from base engine",
 "This is a causal-conservative research portfolio, not current Production implementation parity."]}
(folder/"CAUSAL_CORE_ATTESTATION.json").write_text(json.dumps(att,indent=2)+"\n",encoding="utf8")
print("CAUSAL_WRAPPER_COMPLETE",gates,flush=True)
