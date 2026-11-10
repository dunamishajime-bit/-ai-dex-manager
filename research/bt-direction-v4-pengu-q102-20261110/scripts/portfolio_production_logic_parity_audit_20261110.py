from pathlib import Path
import os, json, hashlib
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
source=R/"dd_strict_v2_plus_v4q102_pengu_recovery_reversal_20261109.py"
orig=source.read_text(encoding="utf8")
out_name="VPS_PRODUCTION_LOGIC_PARITY_AUDIT_20261110"
# Use native lifecycle artifacts rather than research direction/reversal overlays.
pairs=[
 ('O=R/"VPS_DD_STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_20261109";O.mkdir(exist_ok=True)',
  'O=R/'+repr(out_name)+';O.mkdir(exist_ok=True)'),
 ('R/"V4_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"v4-exits.jsonl"',
  'R/"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109"/"v4-native-lifecycle-modeled-exits.jsonl"'),
 ('R/"PENGU_RECOVERY_EARLY_REVERSAL_20261109"/"pengu-exits.jsonl"',
  'R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl"'),
 ('R/"Q102_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"q102-exits.jsonl"',
  'R/"Q102_S34_SELECTED_NATIVE_EXIT_M5COMPLETE_20261109"/"q102-s34-selected-native-exits.jsonl"'),
]
for a,b in pairs:
 assert orig.count(a)==1,(a,orig.count(a));orig=orig.replace(a,b)
# Formal order-enable caps.
orig=orig.replace("STOCK_CAP=4.0","STOCK_CAP=1.5")
# V52 request is clipped to formal stock cap in this replay.
assert orig.count("gross=2.0,v=z,")==1
orig=orig.replace("gross=2.0,v=z,","gross=1.5,v=z,")
# Label artifacts with current formal runner pins where economic blob parity was established.
for a,b in [
 ('"V4":"3ad65403013b701db5d9e53e8814e6ab827a28e8"','"V4":"53a0be396719f0284af4e11b35c66a4ac7d58f79"'),
 ('"PENGU":"1657e173d250ad58f53e62f7bb0a3428fb405496"','"PENGU":"7688ed7c93a1918d8b44837339b7da5584a868f5"'),
 ('"V52":"8495daf24e53a6cf0dd5e38f022008fa8f78c688"','"V52":"4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"'),
 ('"HYPE":"d6bcc94512a6416189cd92d7203b9ac3b2c98e70"','"HYPE":"7688ed7c93a1918d8b44837339b7da5584a868f5"'),
]:
 assert orig.count(a)==1,(a,orig.count(a));orig=orig.replace(a,b)
# Add production HIGH_VOL candidates (19/19 direct V4-builder parity proven).
anchor='assert len(raw)==2715,(len(raw),2715)'
assert orig.count(anchor)==1
inject=r'''_hv_path=R/"Q102_CURRENT_PRODUCTION_REPLAY_AUDIT_20261110"/"q102-high-vol-production-exits.jsonl"
_hv=list(jlines(_hv_path));assert len(_hv)==19,len(_hv)
for i,z in enumerate(_hv,1):
 t=int(z["entryTs"]); e=int(z["exitTs"]); side="LONG" if int(z["side"])==1 else "SHORT"
 assert START<=t<END and e>t
 raw.append(dict(id="Q102HV_"+str(i).zfill(5),s="Q102",t=t,symbol=z["symbol"],side=side,
   route="HIGH_VOL",gross=float(z["requestedGross"]),v={**z,"side":side},
   model=dict(entryTs=t,entryPrice=float(z["entryPrice"]),exitTs=e,exitPrice=float(z["exitPrice"]),
              exitReason="Q102_HIGH_VOL_NATIVE_"+str(z["exitReason"])),
   src=str(_hv_path)))
assert len(raw)==2734,(len(raw),2734)
'''
orig=orig.replace(anchor,inject)
# Permit one HIGH_VOL position to remain open beyond period end. Funding is only accrued through END.
old1='assert m["entryTs"]==c["t"] and START<=c["t"]<m["exitTs"]<=END'
new1='assert m["entryTs"]==c["t"] and START<=c["t"]<m["exitTs"]<=END+72*H'
assert orig.count(old1)==1,orig.count(old1);orig=orig.replace(old1,new1)
old2='c["funding"]=funding(c["symbol"],c["t"],m["exitTs"],m["entryPrice"],c["side"])'
new2='c["funding"]=funding(c["symbol"],c["t"],min(m["exitTs"],END),m["entryPrice"],c["side"])'
assert orig.count(old2)==1,orig.count(old2);orig=orig.replace(old2,new2)
# Current replay label / metadata. Remove claims that HIGH_VOL is missing.
orig=orig.replace('case="STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL"','case="PRODUCTION_LOGIC_PARITY_AUDIT"')
orig=orig.replace('q102_high_vol_missing=True','q102_high_vol_missing=False')
orig=orig.replace('q102_selected_native_modeled=205','q102_selected_native_modeled=205,q102_high_vol_modeled=19')
# No research 3-gates and no causal V4 body removal are applied.
print("PRODUCTION_PARITY_AUDIT_SOURCE_SHA256",hashlib.sha256(source.read_bytes()).hexdigest(),flush=True)
exec(compile(orig,str(source)+"::PRODUCTION_LOGIC_PARITY_AUDIT","exec"),{"__name__":"__main__"})
O=R/out_name
att={
 "status":"PRODUCTION_LOGIC_PARITY_AUDIT_WITH_KNOWN_MODEL_LIMITATIONS",
 "researchGatesApplied":False,
 "v4BodyIncluded":1394,
 "q102S34Included":205,
 "q102HighVolIncluded":19,
 "q102HighVolBuilderParity":"19/19 PASS",
 "formalCaps":{"crypto":3.0,"stock":1.5,"total":3.5,"sharedCryptoDailyLossPct":7.5},
 "currentPins":{"V4":"53a0be396719f0284af4e11b35c66a4ac7d58f79","PENGU":"7688ed7c93a1918d8b44837339b7da5584a868f5","Q102":"ef1ab178e26a7bf5bddb6473467765edba242e1d","V52":"4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81","FET":"7688ed7c93a1918d8b44837339b7da5584a868f5","HYPE":"7688ed7c93a1918d8b44837339b7da5584a868f5","IDLE":"7688ed7c93a1918d8b44837339b7da5584a868f5"},
 "knownLimitations":[
   "V4 historical V2 candidate selection is retrospective/hindsight contaminated even though it matches current implementation shape.",
   "V52 remains historical price-model proxy, not exact executable-book reconstruction.",
   "RESIDUAL retains historical exit-model gaps from base engine.",
   "Q102 adopted three-exit overlay actual Production env enablement cannot be confirmed without VPS effective env; this replay uses base HIGH_VOL hard-stop/trail/72h exit plus the selected S34 lifecycle artifacts.",
   "Modeled fills are not signed venue fills."
 ]}
(O/"PRODUCTION_LOGIC_PARITY_AUDIT_ATTESTATION.json").write_text(json.dumps(att,indent=2)+"\n",encoding="utf8")
print("PRODUCTION_PARITY_AUDIT_COMPLETE",flush=True)
