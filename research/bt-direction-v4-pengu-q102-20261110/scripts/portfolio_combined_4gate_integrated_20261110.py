#!/usr/bin/env python3
"""Read-only comparable portfolio A/B of native Y06 vs native Y06 60h overlay.
All non-Y06 modeled lifecycle tapes fixed to native M5-complete snapshots.
Uses saved existing DD engine (gross/reservation/fees/funding) without venue orders.
STATUS: RESEARCH ONLY; V52 historical executable-book absent and other approximations remain.
"""
import hashlib,json,os
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
source=R/"dd_strict_v2_plus_v4q102_pengu_recovery_reversal_20261109.py"
orig=source.read_text(encoding="utf-8")
mode="PINNED"
gate="REL_ONLY"
pengu_limit=0.011611625094354983
out_name="VPS_DD_COMBINED_4GATE_IDLETao_STOCK15_20261110"
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
 assert orig.count(old)==1,(old,orig.count(old))
 orig=orig.replace(old,new)
hook='assert len(v4life)==1394'
assert orig.count(hook)==1
inject=(
'\n'
'assert sum(z["route"]=="REC_Y06_REV_D0_T72" for z in v4life.values())==352\n'
'_research_overlaid=0\n'
'for z in v4life.values():\n'
' if z["route"]!="REC_Y06_REV_D0_T72":continue\n'
' assert z["side"]=="SHORT" and z.get("reversal") is None\n'
' t=int(z["entryTs"])+60*H\n'
' if '+repr(mode)+'=="H60" and t<int(z["exitTs"]):\n'
'  b=bar(z["symbol"],t)\n'
'  if b is None:raise RuntimeError("RESEARCH_H60_MISSING_NEXT_OPEN_FAIL_CLOSED:"+str(z["id"]))\n'
'  z["exitTs"]=t\n'
'  z["exitPrice"]=b[1]\n'
'  z["exitReason"]="RESEARCH_NATIVE_STOP_PRESERVED_H60"\n'
'  z["rawReturn"]=(z["entryPrice"]-z["exitPrice"])/z["entryPrice"]\n'
'  _research_overlaid+=1\n'
'print("Y06_AB_MODE",'+repr(mode)+',"Y06_CHANGED",_research_overlaid,flush=True)\n'
)
orig=orig.replace(hook,hook+inject)
orig=orig.replace("STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL","Y06_NATIVE_LIFECYCLE_M5_AB")
assert orig.count("STOCK_CAP=4.0")>=1
orig=orig.replace("STOCK_CAP=4.0","STOCK_CAP=1.5")
assert orig.count("gross=2.0,v=z,")==1
orig=orig.replace("gross=2.0,v=z,","gross=1.5,v=z,")
# Repair research-only integrated model's intra-V4 sort for A/B, never changing original Production source.
ranking_sort_original='a=sorted(raw,key=lambda c:(c["t"],priority[c["s"]],c["symbol"],c["id"]))'
assert orig.count(ranking_sort_original)==1
if mode=="PINNED":
 replacement='a=sorted(raw,key=lambda c:(c["t"],priority[c["s"]],(int(c["v"]["rank"]) if c["s"]=="V4" else 0),c["symbol"],c["id"]))'
 orig=orig.replace(ranking_sort_original,replacement)
elif mode=="ASOF":
 preflight='''V4_ASOF_RANK_MAP=jd(R/"DIRECTION_RESEARCH_20261109"/"v4_asof_1394_candidate_rank_map_20261110.json")["mapping"]
assert len(V4_ASOF_RANK_MAP)==1394
for v4c in raw:
 if v4c["s"]!="V4":continue
 a0=V4_ASOF_RANK_MAP[v4c["id"]]
 assert a0["entryTs"]==v4c["t"] and a0["route"]==v4c["route"] and a0["symbol"]==v4c["symbol"]
 assert int(a0["frozen_rank"])==int(v4c["v"]["rank"])
'''
 assert orig.count('P={"V52":0')==1
 orig=orig.replace('P={"V52":0',preflight+'P={"V52":0')
 replacement='a=sorted(raw,key=lambda c:(c["t"],priority[c["s"]],(int(V4_ASOF_RANK_MAP[c["id"]]["asof_rank"])+3 if c["s"]=="V4" else 0),c["symbol"],c["id"]))'
 orig=orig.replace(ranking_sort_original,replacement)
else:
 assert mode=="SYMBOL"


# Inject a research-only JUP gate into the generated integrated source immediately
# before the priority scheduler. Thresholds were selected on historical train-half.
_gate_anchor='FORMAL_PRIORITY={"V4","Q102","PENGU","FET","V52"}'
assert orig.count(_gate_anchor)==1,orig.count(_gate_anchor)
_gate_code='''_JUP_REL=-0.04089204262472046
_JUP_VOL=1.2568362211142174
_raw_before_jup=len(raw)
def _keep_idle_jup(c):
 if not (c["s"]=="IDLE" and c.get("route")=="IDLE_JUP_RELATIVE_SHORT"):return True
 f=c["v"].get("features") or {}
 if not all(k in f for k in ("rel24","volumeRatio")):raise RuntimeError("IDLE_JUP_FEATURE_MISSING")
 if __GATE__=="REL_ONLY":return float(f["rel24"])>=_JUP_REL
 return float(f["rel24"])>=_JUP_REL and float(f["volumeRatio"])>=_JUP_VOL
raw=[c for c in raw if _keep_idle_jup(c)]
print("IDLE_JUP_RESEARCH_GATE",__GATE__,"removed",_raw_before_jup-len(raw),flush=True)
'''
_gate_code=_gate_code.replace('__GATE__',repr(gate))
orig=orig.replace(_gate_anchor,_gate_code+_gate_anchor)


_pengu_anchor='FORMAL_PRIORITY={"V4","Q102","PENGU","FET","V52"}'
assert orig.count(_pengu_anchor)==1,orig.count(_pengu_anchor)
_pengu_code='''_PENGU_V8_BTC_LIMIT=__LIMIT__
_raw_before_pengu=len(raw)
def _keep_pengu_v8(c):
 if not (c["s"]=="PENGU" and c.get("route")=="RECOVERY_V8"):return True
 v=c["v"]
 if "btc24h" not in v:raise RuntimeError("PENGU_V8_BTC24_MISSING")
 return float(v["btc24h"])<=_PENGU_V8_BTC_LIMIT
raw=[c for c in raw if _keep_pengu_v8(c)]
print("PENGU_V8_RESEARCH_GATE_COMBINED","limit",_PENGU_V8_BTC_LIMIT,"removed",_raw_before_pengu-len(raw),flush=True)
'''
_pengu_code=_pengu_code.replace('__LIMIT__',repr(pengu_limit))
orig=orig.replace(_pengu_anchor,_pengu_code+_pengu_anchor)


_q_anchor='FORMAL_PRIORITY={"V4","Q102","PENGU","FET","V52"}'
assert orig.count(_q_anchor)==1,orig.count(_q_anchor)
_q_code='''_Q102_FET_RET14_MAX=0.048722800378429465
_raw_before_q102fet=len(raw)
def _keep_q102_fet(c):
 if not (c["s"]=="Q102" and c.get("symbol")=="FETUSDT"):return True
 v=c["v"]
 if "ret14" not in v:raise RuntimeError("Q102_FET_RET14_MISSING")
 return float(v["ret14"])<=_Q102_FET_RET14_MAX
raw=[c for c in raw if _keep_q102_fet(c)]
print("Q102_FET_RESEARCH_GATE","ret14_max",_Q102_FET_RET14_MAX,"removed",_raw_before_q102fet-len(raw),flush=True)
'''
orig=orig.replace(_q_anchor,_q_code+_q_anchor)


_tao_anchor='FORMAL_PRIORITY={"V4","Q102","PENGU","FET","V52"}'
assert orig.count(_tao_anchor)==1,orig.count(_tao_anchor)
_tao_code='''_IDLE_TAO_RET24_MIN=-0.046643734023416594
_IDLE_TAO_REL24_MIN=-0.03844602822485388
_raw_before_tao=len(raw)
def _keep_idle_tao(c):
 if not (c["s"]=="IDLE" and c.get("route")=="IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2"):return True
 f=c["v"].get("features") or {}
 if not all(k in f for k in ("ret24","rel24")):raise RuntimeError("IDLE_TAO_FEATURE_MISSING")
 return float(f["ret24"])>=_IDLE_TAO_RET24_MIN and float(f["rel24"])>=_IDLE_TAO_REL24_MIN
raw=[c for c in raw if _keep_idle_tao(c)]
print("IDLE_TAO_RESEARCH_GATE","removed",_raw_before_tao-len(raw),flush=True)
'''
orig=orig.replace(_tao_anchor,_tao_code+_tao_anchor)

print("WRAPPER_MODE",mode,"SOURCE_SHA256",hashlib.sha256(source.read_bytes()).hexdigest(),"TARGET",out_name,flush=True)
exec(compile(orig,str(source)+"::Y06_AB_"+mode,"exec"),{"__name__":"__main__"})
# Attest output and assumptions, explicitly distinguish this from full production parity.
folder=R/out_name
m={"status":"RESEARCH_ONLY_NOT_FULL_PRODUCTION_PARITY",
   "mode":mode,"idle_jup_gate":gate,"pengu_v8_btc24_limit":pengu_limit,"combined_gate":True,"q102_fet_ret14_max":0.048722800378429465,"idle_tao_ret24_min":-0.046643734023416594,"idle_tao_rel24_min":-0.03844602822485388,"source_sha256":hashlib.sha256(source.read_bytes()).hexdigest(),
   "native_tapes":{"V4":"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109",
                   "PENGU":"PENGU_NATIVE_LIFECYCLE_EXIT_20261109",
                   "Q102":"Q102_S34_SELECTED_NATIVE_EXIT_M5COMPLETE_20261109"},
   "V4_sorting_rule":mode, "Y06_rule":"Native unchanged, no H60",
   "entry_decisions_unchanged":False,"research_only_gate":True,
   "fees_bps_roundtrip":[10,30],
   "omissions":["V52 missing historical executable book","shared risk and auxiliary logic approximations inherit original engine","H1 next-open is a modeled fill, not real venue order"],
   "source_native_Y06_count":352}
(folder/"COMBINED_4GATE_RESEARCH_ATTESTATION.json").write_text(json.dumps(m,indent=2)+"\n",encoding="utf8")
print("WRAPPER_COMPLETE",mode,flush=True)
