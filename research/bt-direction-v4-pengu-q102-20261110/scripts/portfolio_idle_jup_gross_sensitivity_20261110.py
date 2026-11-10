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
jup_gross=float(os.environ["DISDEX_JUP_GROSS"])
assert jup_gross in (0.75,0.5,0.25),jup_gross
out_name="VPS_DD_V4_PINNED_JUP_GROSS_"+str(jup_gross).replace(".","P")+"_STOCK15_20261110"
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

orig=orig.replace("# VPS priority research proxy:","\n# Research-only JUP Gross sensitivity; signal, direction and exits unchanged.\n_jup_gross="+repr(jup_gross)+"\n_jup_changed=0\nfor c in raw:\n if c[\"s\"]==\"IDLE\" and c[\"route\"]==\"IDLE_JUP_RELATIVE_SHORT\":\n  assert abs(float(c[\"gross\"])-1.0)<1e-12\n  c[\"gross\"]=_jup_gross\n  c[\"v\"]=dict(c[\"v\"]);c[\"v\"][\"requestedGross\"]=_jup_gross\n  _jup_changed+=1\nassert _jup_changed==58,_jup_changed\nprint(\"JUP_GROSS_RESEARCH\",_jup_gross,\"signals\",_jup_changed,flush=True)\n# VPS priority research proxy:")
print("WRAPPER_MODE",mode,"SOURCE_SHA256",hashlib.sha256(source.read_bytes()).hexdigest(),"TARGET",out_name,flush=True)
exec(compile(orig,str(source)+"::Y06_AB_"+mode,"exec"),{"__name__":"__main__"})
# Attest output and assumptions, explicitly distinguish this from full production parity.
folder=R/out_name
m={"status":"RESEARCH_ONLY_NOT_FULL_PRODUCTION_PARITY",
   "mode":mode,"source_sha256":hashlib.sha256(source.read_bytes()).hexdigest(),
   "native_tapes":{"V4":"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109",
                   "PENGU":"PENGU_NATIVE_LIFECYCLE_EXIT_20261109",
                   "Q102":"Q102_S34_SELECTED_NATIVE_EXIT_M5COMPLETE_20261109"},
   "V4_sorting_rule":mode, "Y06_rule":"Native unchanged, no H60",
   "entry_decisions_unchanged":True,"isolated_change":"IDLE_JUP_GROSS_SENSITIVITY","jup_gross":jup_gross,"research_only":True,
   "fees_bps_roundtrip":[10,30],
   "omissions":["V52 missing historical executable book","shared risk and auxiliary logic approximations inherit original engine","H1 next-open is a modeled fill, not real venue order"],
   "source_native_Y06_count":352}
(folder/"V4_ASOF_SORT_RESEARCH_ATTESTATION.json").write_text(json.dumps(m,indent=2)+"\n",encoding="utf8")
print("WRAPPER_COMPLETE",mode,flush=True)
