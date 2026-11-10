#!/usr/bin/env python3
"""Audit correction wrapper for production-pin economic parity.
Research only: no LIVE/Production writes.
"""
from pathlib import Path
import os,hashlib,json,re
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
source=R/"dd_strict_v2_plus_v4q102_pengu_recovery_reversal_20261109.py"
orig=source.read_text(encoding="utf8")
OUT="VPS_PRODUCTION_PIN_PARITY_AUDIT_20261110"
# Output and current native lifecycle sources.
repls=[
('O=R/"VPS_DD_STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_20261109";O.mkdir(exist_ok=True)',f'O=R/"{OUT}";O.mkdir(exist_ok=True)'),
('R/"V4_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"v4-exits.jsonl"','R/"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109"/"v4-native-lifecycle-modeled-exits.jsonl"'),
('R/"PENGU_RECOVERY_EARLY_REVERSAL_20261109"/"pengu-exits.jsonl"','R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl"'),
('R/"Q102_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"q102-exits.jsonl"','R/"Q102_S34_SELECTED_NATIVE_EXIT_M5COMPLETE_20261109"/"q102-s34-selected-native-exits.jsonl"'),
]
for old,new in repls:
    assert orig.count(old)==1,(old,orig.count(old));orig=orig.replace(old,new)
# Production-pin gross contract.
orig=orig.replace('CRYPTO_CAP=3.0;TOTAL_CAP=3.5;STOCK_CAP=4.0;V4_POS_CAP=1.30;V4_AGG_CAP=2.0',
                  'CRYPTO_CAP=3.0;TOTAL_CAP=4.25;STOCK_CAP=4.0;V4_POS_CAP=1.0;V4_AGG_CAP=2.0')
orig=orig.replace('CRYPTO_CAP=3.0;TOTAL_CAP=3.5;STOCK_CAP=4.0;V4_AGG_CAP=2.0;V4_POS_CAP=1.35',
                  'CRYPTO_CAP=3.0;TOTAL_CAP=4.25;STOCK_CAP=4.0;V4_AGG_CAP=2.0;V4_POS_CAP=1.0')
# Add Q102 HIGH_VOL exact production-pin base exits.
anchor='assert len(raw)==2715,(len(raw),2715)'
assert orig.count(anchor)==1
add=r'''hv_path=R/"Q102_CURRENT_PRODUCTION_REPLAY_AUDIT_20261110"/"q102-high-vol-base-exits.jsonl"
hv_rows=list(jlines(hv_path));hv_added=0;hv_censored=0
for z in hv_rows:
 if not Number_isfinite(z.get("grossReturn")):
  hv_censored+=1;continue
 t=int(z["entryTs"]);e=int(z["exitTs"])
 if not START<=t<e<=END:continue
 side="LONG" if int(z["side"])>0 else "SHORT"
 hv_added+=1
 raw.append(dict(id="Q102HV_"+str(hv_added).zfill(5),s="Q102",t=t,symbol=z["symbol"],
   side=side,route="HIGH_VOL",gross=float(z["requestedGross"]),v=z,
   model=dict(entryTs=t,entryPrice=float(z["entryPrice"]),exitTs=e,exitPrice=float(z["exitPrice"]),
              exitReason="Q102_HIGH_VOL_BASE_"+str(z["exitReason"])),src=str(hv_path)))
print("Q102_HIGH_VOL_ADDED",hv_added,"RIGHT_CENSORED",hv_censored,flush=True)
assert hv_added==18 and hv_censored==1,(hv_added,hv_censored)
assert len(raw)==2733,(len(raw),2733)'''
# Python source needs finite helper expression, not JS.
add=add.replace('Number_isfinite(z.get("grossReturn"))','isinstance(z.get("grossReturn"),(int,float)) and math.isfinite(float(z.get("grossReturn")))')
orig=orig.replace(anchor,add)
# Split daily-risk accounting. Initialize state.
old='peak=10000.;mdd=0.;mddt=START;day=None;dayeq=10000.;latched=False;j=0'
new='peak=10000.;mdd=0.;mddt=START;day=None;crypto_latched=False;v52_latched=False;crypto_daily_settled=0.;v52_daily_settled=0.;j=0'
assert orig.count(old)==1;orig=orig.replace(old,new)
# close_modelled daily realized accounting.
old=''' def close_modeled(pid,exitt,exit_price,reason):
  nonlocal cash
  q=opened.pop(pid)
  gm=q["notional"]*(1 if q["side"]=="LONG" else -1)*(exit_price/q["entry"]-1)
  xf=q["notional"]*fee
  cash+=gm-xf'''
new=''' def close_modeled(pid,exitt,exit_price,reason):
  nonlocal cash,crypto_daily_settled,v52_daily_settled
  q=opened.pop(pid)
  gm=q["notional"]*(1 if q["side"]=="LONG" else -1)*(exit_price/q["entry"]-1)
  xf=q["notional"]*fee
  cash+=gm-xf
  if q["s"]=="V52":v52_daily_settled+=gm-xf
  else:crypto_daily_settled+=gm-xf'''
assert orig.count(old)==1;orig=orig.replace(old,new)
# Add daily helpers after MTM gross state.
anchor='''  return dict(crypto=crypto,stock=stock,total=crypto+stock,v4=v4)
 for t in range(START,END+STEP,STEP):'''
helper='''  return dict(crypto=crypto,stock=stock,total=crypto+stock,v4=v4)
 def partition_unrealized(t,want_v52):
  total=0.0
  for q in opened.values():
   if (q["s"]=="V52")!=want_v52:continue
   z=completed_h1(q["symbol"],t)
   if z is None:return None
   mark=q["entry"] if z[0]+H<=q.get("active_ts",q["ts"]) else z[4]
   total+=q["notional"]*(1 if q["side"]=="LONG" else -1)*(mark/q["entry"]-1)
  return total
 def refresh_daily_latches(t,eq):
  nonlocal crypto_latched,v52_latched
  cu=partition_unrealized(t,False);su=partition_unrealized(t,True)
  if cu is None:
   crypto_latched=True
  else:
   reference=cash-crypto_daily_settled
   if reference<=0 or -(crypto_daily_settled+cu)/reference>=.075-1e-15:crypto_latched=True
  if su is None or eq is None or eq<=0:
   v52_latched=True
  else:
   strategy_capital=eq*(4.0/4.25)
   if strategy_capital<=0 or -(v52_daily_settled+su)/strategy_capital>=.035-1e-15:v52_latched=True
 for t in range(START,END+STEP,STEP):
  current_day=t//(24*H)
  if day!=current_day:
   day=current_day;crypto_latched=False;v52_latched=False;crypto_daily_settled=0.;v52_daily_settled=0.'''
assert orig.count(anchor)==1;orig=orig.replace(anchor,helper)
# Funding accounting.
old='''     cash+=amount;q["funded"]+=amount
     funds.append'''
new='''     cash+=amount;q["funded"]+=amount
     if q["s"]=="V52":v52_daily_settled+=amount
     else:crypto_daily_settled+=amount
     funds.append'''
assert orig.count(old)==1;orig=orig.replace(old,new)
# Partial accounting.
old='''     cash+=gm-xf
     q["realized_gross_pnl"]'''
new='''     cash+=gm-xf
     if q["s"]=="V52":v52_daily_settled+=gm-xf
     else:crypto_daily_settled+=gm-xf
     q["realized_gross_pnl"]'''
# occurs partial and reversal; replace all two occurrences.
assert orig.count(old)==2,orig.count(old);orig=orig.replace(old,new)
# Replace old daily gate calculation after mark_current.
old='''  eq=mark_current(t)
  if eq is not None:
   if day!=t//(24*H):day=t//(24*H);dayeq=eq;latched=False
   peak=max(peak,eq)
   if peak>0 and (eq/peak-1)*100<mdd:mdd=(eq/peak-1)*100;mddt=t
  if eq is None or dayeq<=0 or eq<=dayeq*.925:latched=True
  daily=latched'''
new='''  eq=mark_current(t)
  if eq is not None:
   peak=max(peak,eq)
   if peak>0 and (eq/peak-1)*100<mdd:mdd=(eq/peak-1)*100;mddt=t
  refresh_daily_latches(t,eq)
  daily=crypto_latched or v52_latched'''
assert orig.count(old)==1;orig=orig.replace(old,new)
# After residual preemption, refresh split risk instead of old latch.
old='''      if eq is None or eq<=dayeq*.925:latched=True
      daily=latched'''
new='''      refresh_daily_latches(t,eq)
      daily=crypto_latched or v52_latched'''
assert orig.count(old)==1;orig=orig.replace(old,new)
# Per-candidate daily gate is runner scoped.
old='''    s=c["s"];g=c["gross"];reason=""
    if (s in FORMAL_PRIORITY'''
new='''    s=c["s"];g=c["gross"];reason=""
    daily=v52_latched if s=="V52" else crypto_latched
    if (s in FORMAL_PRIORITY'''
assert orig.count(old)==1;orig=orig.replace(old,new)
# Entry fee accounting.
old='''    cost=notional*fee;cash-=cost
    pid=name+"_"+str(bps)+"_"+c["id"]'''
new='''    cost=notional*fee;cash-=cost
    if s=="V52":v52_daily_settled-=cost
    else:crypto_daily_settled-=cost
    pid=name+"_"+str(bps)+"_"+c["id"]'''
assert orig.count(old)==1;orig=orig.replace(old,new)
# Remove stale variables if any.
assert "dayeq" not in orig and "latched" not in orig.replace("crypto_latched","").replace("v52_latched",""),"STALE_DAILY_VARIABLE"
# Add attestations and unique name.
orig=orig.replace("STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL","PRODUCTION_PIN_PARITY_AUDIT")
print("PRODUCTION_PIN_PARITY_WRAPPER","SOURCE_SHA256",hashlib.sha256(source.read_bytes()).hexdigest(),flush=True)
g={"__name__":"__main__"}
exec(compile(orig,str(source)+"::PRODUCTION_PIN_PARITY_AUDIT","exec"),g)
O=R/OUT
att={
 "status":"RESEARCH_CLOSEST_PRODUCTION_PIN_ECONOMIC_PARITY_NOT_VENUE_CERTIFIED",
 "pins":{"V4":"53a0be396719f0284af4e11b35c66a4ac7d58f79","PENGU":"7688ed7c93a1918d8b44837339b7da5584a868f5",
 "Q102":"ef1ab178e26a7bf5bddb6473467765edba242e1d","V52":"4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81","SHARED":"7688ed7c93a1918d8b44837339b7da5584a868f5"},
 "gross":{"crypto":3.0,"stock":4.0,"total":4.25,"v52Slot":2.0,"v4Aggregate":2.0,"v4PerPosition":1.0},
 "dailyRisk":{"cryptoPct":7.5,"v52Pct":3.5,"utcDay":True,"separateLatches":True},
 "q102HighVol":{"signals":19,"completed":18,"rightCensored":1,"adoptedExitPoliciesEnabled":False},
 "knownNonParity":["V52 is supplemental H1/Yahoo price proxy, not executable venue book","Margin Guard historical account snapshots unavailable",
 "Q102 adopted3 env activation not readable; this case uses source default OFF","Exact pending-order/tick concurrency and preemption timing cannot be reconstructed","RESIDUAL M5 gaps remain fail-closed"]}
(O/"PRODUCTION_PIN_PARITY_AUDIT_ATTESTATION.json").write_text(json.dumps(att,indent=2)+"\n",encoding="utf8")
print("PRODUCTION_PIN_PARITY_AUDIT_COMPLETE",flush=True)
