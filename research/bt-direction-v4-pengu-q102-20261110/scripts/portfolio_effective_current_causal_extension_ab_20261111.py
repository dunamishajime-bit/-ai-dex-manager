# -*- coding: utf-8 -*-
"""Causal extension A/B (TAO / HYPE) on the locked corrected canonical simulator.

Only candidate admission is changed. All exits, risk timing, Shared Risk,
V4 runtime semantics, V52 5m semantics and portfolio scheduling remain inherited
from the canonical parity simulator.

Research-only; no Production mutation.
"""
from pathlib import Path
import os, json, hashlib, bisect

HERE=Path(__file__).resolve().parent
CANON=HERE/"portfolio_effective_current_canonical_parity_20261111.py"

mode=os.environ["DISDEX_Q102_ADOPTED_MODE"].strip().upper()
assert mode=="ON",mode
case=os.environ["DISDEX_RESEARCH_GATE_CASE"].strip().upper()
CASES=("TAO_ROBUST","HYPE_CAUSAL","TAO_HYPE")
assert case in CASES,case

IDLE_REL=-0.04089204262472046
IDLE_VOL=1.2568362211142174
PENGU_BTC=0.011611625094354983
Q102_RET14=0.048722800378429465
TAO_RET24=-0.046643734023416594
TAO_REL24=-0.03844602822485388
HYPE_A_R24_MIN=0.08567321148250018

# Build the exact locked canonical generated simulator, but stop before execution.
src=CANON.read_text(encoding="utf-8")
cut=src.index('print("CURRENT_PARITY_WRAPPER"')
ns={"__name__":"__canonical_research_prelude__","__file__":str(CANON)}
exec(compile(src[:cut],str(CANON)+"::RESEARCH_PRELUDE","exec"),ns)
orig=ns["orig"]; R=ns["R"]; SRC=ns["SRC"]
canonical_out=ns["out_name"]
out_name=f"VPS_EFFECTIVE_CURRENT_CANONICAL_CAUSAL_EXTENSION_{case}_Q102_ADOPTED_{mode}_20261111"

assert canonical_out in orig
orig=orig.replace(canonical_out,out_name)
orig=orig.replace(
 'case="EFFECTIVE_CURRENT_CANONICAL_PARITY_Q102_ADOPTED_"+'+repr(mode),
 'case="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_EXTENSION_"+'+repr(case)+'+"_Q102_ADOPTED_"+'+repr(mode),
)
_status_old='status="EFFECTIVE_CURRENT_CANONICAL_PARITY_V52_V50_PROXY_V11_MISSING"'
assert orig.count(_status_old)==1,orig.count(_status_old)
orig=orig.replace(
 _status_old,
 'status="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_EXTENSION_V52_V50_PROXY_V11_MISSING"',
 1,
)

active={
 "TAO_ROBUST": ("IDLE_JUP_ROBUST","PENGU_V8","Q102_FET","IDLE_TAO_ROBUST"),
 "HYPE_CAUSAL": ("IDLE_JUP_ROBUST","PENGU_V8","Q102_FET","HYPE_CAUSAL"),
 "TAO_HYPE": ("IDLE_JUP_ROBUST","PENGU_V8","Q102_FET","IDLE_TAO_ROBUST","HYPE_CAUSAL"),
}[case]

# Rebuild the saved HYPE causal 24h-return feature exactly from the public H1 tape.
_hype_rows=json.loads((R/"hype-aster-historical"/"HYPEUSDT-1h-from-aster-public.json").read_text(encoding="utf-8"))["rows"]
_hype_times=[int(r[0]) for r in _hype_rows]
_hype_close={int(r[0]):float(r[4]) for r in _hype_rows}
_hype_candidates=json.loads((R/"hype-aster-historical"/"hype-trend-pinned-candidates.json").read_text(encoding="utf-8"))
HYPE_A_R24={}
for _i,_v in enumerate(_hype_candidates,1):
 _st=int(_v["signal_ts_ms"])
 _j=bisect.bisect_right(_hype_times,_st)-1
 _k=bisect.bisect_right(_hype_times,_st-24*3600_000)-1
 if _j<0 or _k<0: raise RuntimeError("HYPE_A_R24_SOURCE_MISSING")
 HYPE_A_R24[f"HYPE_{_i:05d}"]=_hype_close[_hype_times[_j]]/_hype_close[_hype_times[_k]]-1.0
assert len(HYPE_A_R24)==78
assert sum(v<=HYPE_A_R24_MIN for v in HYPE_A_R24.values())==58

anchor='FORMAL_PRIORITY={"V4","Q102","PENGU","FET","V52"}'
assert orig.count(anchor)==1,orig.count(anchor)

gate=r'''_RESEARCH_ACTIVE=__ACTIVE__
_JUP_REL=__IDLE_REL__
_JUP_VOL_MIN=__IDLE_VOL__
_PENGU_V8_BTC_LIMIT=__PENGU_BTC__
_Q102_FET_RET14_MAX=__Q102_RET14__
_TAO_RET24_MIN=__TAO_RET24__
_TAO_REL24_MIN=__TAO_REL24__
_HYPE_A_R24_MIN=__HYPE_A_R24_MIN__
_HYPE_A_R24=__HYPE_A_R24__
_research_removed=collections.Counter()
def _keep_research_gate(c):
 if "IDLE_JUP_ROBUST" in _RESEARCH_ACTIVE and c["s"]=="IDLE" and c.get("route")=="IDLE_JUP_RELATIVE_SHORT":
  f=c["v"].get("features") or {}
  if "rel24" not in f:raise RuntimeError("IDLE_JUP_REL24_MISSING")
  if "volumeRatio" not in f:raise RuntimeError("IDLE_JUP_VOLUME_RATIO_MISSING")
  if float(f["rel24"])<_JUP_REL or float(f["volumeRatio"])<_JUP_VOL_MIN:
   _research_removed["RESEARCH_GATE_IDLE_JUP_ROBUST_REL24_VOLUME"]+=1
   return False
 if "PENGU_V8" in _RESEARCH_ACTIVE and c["s"]=="PENGU" and c.get("route")=="RECOVERY_V8":
  if "btc24h" not in c["v"]:raise RuntimeError("PENGU_V8_BTC24_MISSING")
  if float(c["v"]["btc24h"])>_PENGU_V8_BTC_LIMIT:
   _research_removed["RESEARCH_GATE_PENGU_V8_BTC24"]+=1
   return False
 if "Q102_FET" in _RESEARCH_ACTIVE and c["s"]=="Q102" and c.get("symbol")=="FETUSDT":
  if "ret14" not in c["v"]:raise RuntimeError("Q102_FET_RET14_MISSING")
  if float(c["v"]["ret14"])>_Q102_FET_RET14_MAX:
   _research_removed["RESEARCH_GATE_Q102_FET_RET14"]+=1
   return False
 if "IDLE_TAO_ROBUST" in _RESEARCH_ACTIVE and c["s"]=="IDLE" and c.get("route")=="IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2":
  f=c["v"].get("features") or {}
  if "ret24" not in f or "rel24" not in f:raise RuntimeError("IDLE_TAO_CAUSAL_FEATURE_MISSING")
  if float(f["ret24"])<_TAO_RET24_MIN or float(f["rel24"])<_TAO_REL24_MIN:
   _research_removed["RESEARCH_GATE_IDLE_TAO_RET24_REL24"]+=1
   return False
 if "HYPE_CAUSAL" in _RESEARCH_ACTIVE and c["s"]=="HYPE":
  if c["id"] not in _HYPE_A_R24:raise RuntimeError("HYPE_A_R24_MISSING")
  if float(_HYPE_A_R24[c["id"]])<=_HYPE_A_R24_MIN:
   _research_removed["RESEARCH_GATE_HYPE_A_R24"]+=1
   return False
 return True
_raw_before_research_gate=len(raw)
raw=[c for c in raw if _keep_research_gate(c)]
print("CANONICAL_CAUSAL_EXTENSION_GATE",__CASE__,"REMOVED",dict(_research_removed),
      "TOTAL_REMOVED",_raw_before_research_gate-len(raw),flush=True)
'''
gate=gate.replace("__ACTIVE__",repr(active))
gate=gate.replace("__IDLE_REL__",repr(IDLE_REL))
gate=gate.replace("__IDLE_VOL__",repr(IDLE_VOL))
gate=gate.replace("__PENGU_BTC__",repr(PENGU_BTC))
gate=gate.replace("__Q102_RET14__",repr(Q102_RET14))
gate=gate.replace("__TAO_RET24__",repr(TAO_RET24))
gate=gate.replace("__TAO_REL24__",repr(TAO_REL24))
gate=gate.replace("__HYPE_A_R24_MIN__",repr(HYPE_A_R24_MIN))
gate=gate.replace("__HYPE_A_R24__",repr(HYPE_A_R24))
gate=gate.replace("__CASE__",repr(case))
orig=orig.replace(anchor,gate+anchor,1)

assert "current-live-adapter-target-candidates-20261111.jsonl" in orig
assert "V4_RECOVERY_FAMILY_GROSS_CAP_2P5" in orig
assert "V52_STRATEGY_DAILY_LOSS_3P5_GATE" in orig
assert "STEP=300000" in orig
assert "CANONICAL_CAUSAL_EXTENSION_GATE" in orig
compile(orig,str(SRC)+"::CANONICAL_CAUSAL_EXTENSION_GENERATED_CHECK","exec")

print("CANONICAL_CAUSAL_EXTENSION_WRAPPER",case,mode,
      "CANON_SHA256",hashlib.sha256(CANON.read_bytes()).hexdigest(),
      "GENERATED_SHA256",hashlib.sha256(orig.encode("utf-8")).hexdigest(),flush=True)
exec(compile(orig,str(SRC)+"::CANONICAL_CAUSAL_EXTENSION_"+case,"exec"),{"__name__":"__main__"})

O=R/out_name
att={
 "status":"CANONICAL_CURRENT_IMPLEMENTATION_CAUSAL_EXTENSION_AB_NOT_PRODUCTION",
 "researchGateCase":case,
 "activeResearchGates":sorted(active),
 "researchRules":{
   "IDLE_JUP_ROBUST":{"all":[{"feature":"features.rel24","op":">=","threshold":IDLE_REL},{"feature":"features.volumeRatio","op":">=","threshold":IDLE_VOL}]},
   "PENGU_V8":{"feature":"btc24h","op":"<=","threshold":PENGU_BTC},
   "Q102_FET":{"feature":"ret14","op":"<=","threshold":Q102_RET14},
   "IDLE_TAO_ROBUST":{"all":[{"feature":"features.ret24","op":">=","threshold":TAO_RET24},{"feature":"features.rel24","op":">=","threshold":TAO_REL24}]},
   "HYPE_CAUSAL":{"feature":"reconstructed.a_r24","op":">","threshold":HYPE_A_R24_MIN,
                  "semantics":"HYPE completed-H1 24h return at signal timestamp",
                  "reconstructionVerifiedAgainstSavedFlaggedIds":"58/58"},
 },
 "canonicalScriptSha256":hashlib.sha256(CANON.read_bytes()).hexdigest(),
 "generatedSimulatorSha256":hashlib.sha256(orig.encode("utf-8")).hexdigest(),
 "baselineOutput":"VPS_EFFECTIVE_CURRENT_CANONICAL_PARITY_Q102_ADOPTED_ON_20261111",
 "classification":"RESEARCH_ONLY_CAUSAL_EXTENSION_AB_ON_LOCKED_CORRECTED_CANONICAL_BASELINE",
 "unchangedFromCanonical":[
   "exact V4 adapter/Core49 and private runtime gates",
   "V4 account max-DD 21% hold",
   "Shared Risk 7.5% sticky daily semantics",
   "V52 5m marks and own 3.5% daily latch",
   "Q102 exits","FET exits/trailing/cooldown","HYPE runtime gate","IDLE lifecycle",
   "fees/funding/cost model","gross/capacity scheduling",
 ],
}
(O/"RESEARCH_AB_ATTESTATION.json").write_text(json.dumps(att,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("CANONICAL_CAUSAL_EXTENSION_COMPLETE",case,flush=True)
