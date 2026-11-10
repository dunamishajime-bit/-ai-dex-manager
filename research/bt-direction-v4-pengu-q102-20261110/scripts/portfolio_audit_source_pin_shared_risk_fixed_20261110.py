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
out_name="VPS_AUDIT_SOURCE_PIN_SHARED_RISK_FIXED_20261110"
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
orig=orig.replace("STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL","AUDIT_SOURCE_PIN_SHARED_RISK_FIXED")

# Replace the simplified all-portfolio -7.5% day gate with the pinned shared-crypto writer semantics.
_old='peak=10000.;mdd=0.;mddt=START;day=None;dayeq=10000.;latched=False;j=0'
_new='peak=10000.;mdd=0.;mddt=START;day=None;crypto_settled_today=0.0;latched=False;j=0'
assert orig.count(_old)==1,orig.count(_old);orig=orig.replace(_old,_new)
_old='  nonlocal cash\n  q=opened.pop(pid)'
_new='  nonlocal cash,crypto_settled_today\n  q=opened.pop(pid)'
assert orig.count(_old)==1;orig=orig.replace(_old,_new)
_old='  cash+=gm-xf\n  total_gm='
_new='  cash+=gm-xf\n  if q["s"]!="V52":crypto_settled_today+=gm-xf\n  total_gm='
assert orig.count(_old)==1;orig=orig.replace(_old,_new)
# Funding, partial exit and reversal settled cashflows.
_old='    cash+=amount;q["funded"]+=amount'
_new='    cash+=amount;q["funded"]+=amount\n    if q["s"]!="V52":crypto_settled_today+=amount'
assert orig.count(_old)==1;orig=orig.replace(_old,_new)
_old='    cash+=gm-xf\n    q["realized_gross_pnl"]='
_new='    cash+=gm-xf\n    if q["s"]!="V52":crypto_settled_today+=gm-xf\n    q["realized_gross_pnl"]='
assert orig.count(_old)==2,orig.count(_old);orig=orig.replace(_old,_new)
# Entry commission is a same-day crypto COMMISSION for every non-stock sleeve.
_old='   cost=notional*fee;cash-=cost\n   pid='
_new='   cost=notional*fee;cash-=cost\n   if s!="V52":crypto_settled_today-=cost\n   pid='
assert orig.count(_old)==1;orig=orig.replace(_old,_new)
# Insert exact modeled crypto unrealized/ref-equity gate and reset at UTC day boundary before events.
_anchor='  for t in range(START,END+STEP,STEP):\n   while heap and heap[0][0]<=t:'
_repl='''  def crypto_daily_trip(t):
   unreal=0.0
   for q in opened.values():
    if q["s"]=="V52":continue
    z=completed_h1(q["symbol"],t)
    if z is None:return True
    mark=q["entry"] if z[0]+H<=q.get("active_ts",q["ts"]) else z[4]
    unreal+=q["notional"]*(1 if q["side"]=="LONG" else -1)*(mark/q["entry"]-1)
   ref=cash-crypto_settled_today
   if not (ref>0):return True
   return max(0.0,-(crypto_settled_today+unreal)/ref)>=0.075-1e-15
  for t in range(START,END+STEP,STEP):
   curday=t//(24*H)
   if day!=curday:
    day=curday;crypto_settled_today=0.0;latched=False
   while heap and heap[0][0]<=t:'''
assert orig.count(_anchor)==1;orig=orig.replace(_anchor,_repl)
_old='   if day!=t//(24*H):day=t//(24*H);dayeq=eq;latched=False\n   peak=max(peak,eq)'
_new='   peak=max(peak,eq)'
assert orig.count(_old)==1;orig=orig.replace(_old,_new)
_old='   if eq is None or dayeq<=0 or eq<=dayeq*.925:latched=True\n   daily=latched'
_new='   if eq is None or crypto_daily_trip(t):latched=True\n   daily=latched'
assert orig.count(_old)==1;orig=orig.replace(_old,_new)
_old='      if eq is None or eq<=dayeq*.925:latched=True\n      daily=latched'
_new='      if eq is None or crypto_daily_trip(t):latched=True\n      daily=latched'
assert orig.count(_old)==1;orig=orig.replace(_old,_new)
_old='    elif daily:reason="DAILY_LOSS_7P5_GATE"'
_new='    elif daily and s!="V52":reason="DAILY_LOSS_7P5_GATE"'
assert orig.count(_old)==1;orig=orig.replace(_old,_new)

print("AUDIT_STATIC_SOURCE_PIN",hashlib.sha256(source.read_bytes()).hexdigest(),flush=True)
exec(compile(orig,str(source)+"::AUDIT_STATIC_SOURCE_PIN","exec"),{"__name__":"__main__"})
O=R/out_name
att={
 "status":"AUDIT_STATIC_SOURCE_PIN_REPLAY_NOT_FULL_PRODUCTION_PARITY",
 "sourceEngineSha256":hashlib.sha256(source.read_bytes()).hexdigest(),
 "repairs":["V4 native lifecycle","PENGU production 3h/8h timed stops","V4 rank ordering","V4 per-position 1.0","stock cap 4.0","total cap 4.25","V52 gross 2.0"],
 "knownUnresolved":["Q102 HIGH_VOL historical configured-symbol list is evidence-backed but runtime env was not directly readable","integrated dynamic gross governor not modeled","V52 stock daily-loss constant has no verified executable gate call-site in the pinned engine","V52 historical executable order book unavailable","RESIDUAL historical exit gaps","modeled fills/funding rather than signed venue execution"],
 "inferenceWarning":"V4 V2 historical candidates are retrospective/hindsight-filtered, so this track is implementation replay only."
}
(O/"AUDIT_ATTESTATION.json").write_text(json.dumps(att,indent=2)+"\n",encoding="utf8")
