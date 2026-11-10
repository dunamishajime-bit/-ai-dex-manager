#!/usr/bin/env python3
"""Audit-only closest static source-pin replay.
Known repairs vs prior research:
- current V4 V2 candidate body retained (implementation parity track; hindsight-contaminated for inference)
- native V4 lifecycle
- production PENGU timed 3h/8h stops over native lifecycle
- V4 same-timestamp ordering by source rank
- V4 per-position MTM admission cap 1.0x, aggregate 2.0x, max 3
- crypto 3.0x, stock 4.0x, total 4.25x
- V52 2.0x price-model proxy
No research 3-gates.
Still NOT full Production parity because Q102 HIGH_VOL/adopted exits and dynamic governor/exact V52 book remain unresolved.
"""
import hashlib,json
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
source=R/"dd_strict_v2_plus_v4q102_pengu_recovery_reversal_20261109.py"
orig=source.read_text(encoding="utf8")
out_name="VPS_AUDIT_SOURCE_PIN_Q102PENGU_FIXED_20261110"
repls=[
('O=R/"VPS_DD_STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_20261109";O.mkdir(exist_ok=True)','O=R/'+repr(out_name)+';O.mkdir(exist_ok=True)'),
('R/"V4_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"v4-exits.jsonl"','R/"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109"/"v4-native-lifecycle-modeled-exits.jsonl"'),
('R/"PENGU_RECOVERY_EARLY_REVERSAL_20261109"/"pengu-exits.jsonl"','R/"DIRECTION_RESEARCH_20261109"/"PENGU_PRODUCTION_TIMED_STOPS_AUDIT_20261110"/"pengu-production-timed-stop-exits.jsonl"'),
('R/"Q102_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"q102-exits.jsonl"','R/"DIRECTION_RESEARCH_20261109"/"Q102_PRODUCTION_V4_COMBINED_AUDIT_20261110"/"q102-production-v4-combined-modeled-exits.jsonl"'),
]
for a,b in repls:
 assert orig.count(a)==1,(a,orig.count(a));orig=orig.replace(a,b)
# All source-pin static normal caps.
orig=orig.replace("TOTAL_CAP=3.5","TOTAL_CAP=4.25")
orig=orig.replace("assert len(q102life)==205","assert len(q102life)==223")
orig=orig.replace("assert len(raw)==2715,(len(raw),2715)","assert len(raw)==2733,(len(raw),2733)")
orig=orig.replace("V4_POS_CAP=1.30","V4_POS_CAP=1.0")
orig=orig.replace("V4_POS_CAP=1.35","V4_POS_CAP=1.0")
# Rank V4 candidates using the rank embedded in the pinned V2 source tape.
old='a=sorted(raw,key=lambda c:(c["t"],priority[c["s"]],c["symbol"],c["id"]))'
assert orig.count(old)==1,orig.count(old)
orig=orig.replace(old,'a=sorted(raw,key=lambda c:(c["t"],priority[c["s"]],(int(c["v"].get("rank",999)) if c["s"]=="V4" else 0),c["symbol"],c["id"]))')
orig=orig.replace("STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL","AUDIT_SOURCE_PIN_Q102PENGU_FIXED")
print("AUDIT_STATIC_SOURCE_PIN",hashlib.sha256(source.read_bytes()).hexdigest(),flush=True)
exec(compile(orig,str(source)+"::AUDIT_STATIC_SOURCE_PIN","exec"),{"__name__":"__main__"})
O=R/out_name
att={
 "status":"AUDIT_STATIC_SOURCE_PIN_REPLAY_NOT_FULL_PRODUCTION_PARITY",
 "sourceEngineSha256":hashlib.sha256(source.read_bytes()).hexdigest(),
 "repairs":["V4 native lifecycle","PENGU production 3h/8h timed stops","V4 rank ordering","V4 per-position 1.0","stock cap 4.0","total cap 4.25","V52 gross 2.0"],
 "knownUnresolved":["Q102 HIGH_VOL historical configured-symbol list is evidence-backed but runtime env was not directly readable","integrated dynamic gross governor not modeled","V52 historical executable order book unavailable","RESIDUAL historical exit gaps","modeled fills/funding rather than signed venue execution"],
 "inferenceWarning":"V4 V2 historical candidates are retrospective/hindsight-filtered, so this track is implementation replay only."
}
(O/"AUDIT_ATTESTATION.json").write_text(json.dumps(att,indent=2)+"\n",encoding="utf8")
