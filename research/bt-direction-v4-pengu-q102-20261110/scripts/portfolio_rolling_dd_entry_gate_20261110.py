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
mode=os.environ.get("DISDEX_V4_SORT_MODE","")
assert mode in ("SYMBOL","PINNED","ASOF"),mode
risk_hours=int(os.environ["DISDEX_RESEARCH_RISK_WINDOW_HOURS"])
risk_fraction=float(os.environ["DISDEX_RESEARCH_RISK_FRACTION"])
assert risk_hours in (168,336,720) and risk_fraction in (0.04,0.06,0.08,0.10,0.12,0.15,0.18)
assert mode=="PINNED"
out_name=f"VPS_DD_V4_PINNED_RISKROLL_{risk_hours}H_{round(risk_fraction*100):02d}PCT_20261110"
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

# Research-only causal peak-to-current-MTM entry freeze. Does not liquidate/alter protective STOP.
_init='peak=10000.;mdd=0.;mddt=START;day=None;dayeq=10000.;latched=False;j=0'
assert orig.count(_init)==1
orig=orig.replace(_init,_init+'\n _risk_window_queue=collections.deque()\n _risk_last_peak=10000.\n _risk_guard=False')
_gate='  daily=latched\n  gs=mtm_gross_state(t,eq)'
assert orig.count(_gate)==1
riskcode=('  if eq is not None and eq>0:\n'
          '   _risk_window_queue.append((t,eq))\n'
          '   while _risk_window_queue and _risk_window_queue[0][0]<t-'+str(risk_hours)+'*H:\n'
          '    _risk_window_queue.popleft()\n'
          '   _risk_last_peak=max(v for _,v in _risk_window_queue)\n'
          '   _risk_guard=(eq<_risk_last_peak*(1-'+repr(risk_fraction)+'))\n'
          '  else:\n'
          '   _risk_guard=True\n'
          '  daily=latched or _risk_guard\n'
          '  gs=mtm_gross_state(t,eq)')
orig=orig.replace(_gate,riskcode)
_gate2='    daily=latched\n    if v4_mtm_overcap'
# Secondary preemption branch writes daily=latched, so never overwrite the research guard.
if _gate2 in orig:
 orig=orig.replace(_gate2,'    _risk_guard=(eq is None or eq<=_risk_last_peak*(1-'+repr(risk_fraction)+'))\n    daily=latched or _risk_guard\n    if v4_mtm_overcap')
else:
 assert orig.count('    daily=latched')==1
 orig=orig.replace('    daily=latched','    _risk_guard=(eq is None or eq<=_risk_last_peak*(1-'+repr(risk_fraction)+'))\n    daily=latched or _risk_guard')
old_reason='elif daily:reason="DAILY_LOSS_7P5_GATE"'
assert orig.count(old_reason)==1
orig=orig.replace(old_reason,'elif daily:reason="RESEARCH_ROLLING_PEAK_DD_ENTRY_GATE" if _risk_guard else "DAILY_LOSS_7P5_GATE"')

print("WRAPPER_MODE",mode,"SOURCE_SHA256",hashlib.sha256(source.read_bytes()).hexdigest(),"TARGET",out_name,flush=True)
exec(compile(orig,str(source)+"::Y06_AB_"+mode,"exec"),{"__name__":"__main__"})
# Attest output and assumptions, explicitly distinguish this from full production parity.
folder=R/out_name
m={"status":"RESEARCH_ONLY_NOT_FULL_PRODUCTION_PARITY",
   "mode":mode,"source_sha256":hashlib.sha256(source.read_bytes()).hexdigest(),
   "native_tapes":{"V4":"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109",
                   "PENGU":"PENGU_NATIVE_LIFECYCLE_EXIT_20261109",
                   "Q102":"Q102_S34_SELECTED_NATIVE_EXIT_M5COMPLETE_20261109"},
   "V4_sorting_rule":mode, "Y06_rule":"Native unchanged, no H60", "risk_window_hours":risk_hours,"risk_peak_fraction":risk_fraction,
   "entry_decisions_unchanged":False,"mechanism":"entry-only rolling peak equity gate, existing positions untouched",
   "fees_bps_roundtrip":[10,30],
   "omissions":["V52 missing historical executable book","shared risk and auxiliary logic approximations inherit original engine","H1 next-open is a modeled fill, not real venue order"],
   "source_native_Y06_count":352}
(folder/"RESEARCH_ROLLING_DD_GATE_ATTESTATION.json").write_text(json.dumps(m,indent=2)+"\n",encoding="utf8")
print("WRAPPER_COMPLETE",mode,flush=True)
