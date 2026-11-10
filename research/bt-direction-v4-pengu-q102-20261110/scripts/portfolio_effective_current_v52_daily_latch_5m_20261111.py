#!/usr/bin/env python3
"""
Effective-current Production core parity replay wrapper (V11 still unavailable historically).
Research/read-only only. It intentionally does NOT apply the three research gates
or remove the current V4 V2 body. It repairs Q102/IDLE/FET portfolio semantics
found during the 2026-11-10 deep audit.

Irreducible caveats remain:
- V52 V50 is a historical price proxy, not executable-book/signature parity.
- V52 V11 is not yet reconstructed because the 10:00 signal requires finer causal reference data than the full-year Yahoo H1 archive.
- Effective VPS env was read-only verified: Q102 adopted exits ON exact ACK; FET trailing ON; HYPE preemption OFF.
- Current V4 V2 historical candidate population is retrospectively selected.
"""
from pathlib import Path
import os,re,json,hashlib

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
SRC=R/"dd_strict_v2_plus_v4q102_pengu_recovery_reversal_20261109.py"
mode=os.environ["DISDEX_Q102_ADOPTED_MODE"].strip().upper()
assert mode=="ON",("EFFECTIVE_CURRENT_BASELINE_REQUIRES_Q102_ADOPTED_ON",mode)
out_name=f"VPS_EFFECTIVE_CURRENT_V52_DAILY_LATCH_5M_Q102_ADOPTED_{mode}_20261111"

orig=SRC.read_text(encoding="utf8")

# Output and current formal activation caps.
old='O=R/"VPS_DD_STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_20261109";O.mkdir(exist_ok=True)'
assert orig.count(old)==1
orig=orig.replace(old,f'O=R/"{out_name}";O.mkdir(exist_ok=True)')
orig=orig.replace("CRYPTO_CAP=3.0;TOTAL_CAP=3.5;STOCK_CAP=4.0;V4_POS_CAP=1.30;V4_AGG_CAP=2.0",
                  "CRYPTO_CAP=3.0;TOTAL_CAP=4.25;STOCK_CAP=4.0;V4_POS_CAP=1.0;V4_AGG_CAP=2.0")
orig=orig.replace("CRYPTO_CAP=3.0;TOTAL_CAP=3.5;STOCK_CAP=4.0;V4_AGG_CAP=2.0;V4_POS_CAP=1.35",
                  "CRYPTO_CAP=3.0;TOTAL_CAP=4.25;STOCK_CAP=4.0;V4_AGG_CAP=2.0;V4_POS_CAP=1.0")

# Report current runner pins. Economic V4/PENGU blobs were audited equivalent.
pin_repl={
'"V4":"3ad65403013b701db5d9e53e8814e6ab827a28e8"':'"V4":"53a0be396719f0284af4e11b35c66a4ac7d58f79"',
'"HYPE":"d6bcc94512a6416189cd92d7203b9ac3b2c98e70"':'"HYPE":"7688ed7c93a1918d8b44837339b7da5584a868f5"'}
for a,b in pin_repl.items():
    assert orig.count(a)==1,(a,orig.count(a))
    orig=orig.replace(a,b)

# Replace the entire old raw-candidate population.
start=orig.index("raw=[]\nfor s,file in FILES.items():")
end_marker='assert len(raw)==2715,(len(raw),2715)'
end=orig.index(end_marker,start)+len(end_marker)
new_raw=r'''raw=[]

# Current V4 V2 implementation candidate body. Historical selection is hindsight-contaminated,
# but it is retained here because this replay is implementation parity, not causal certification.
for i,v in enumerate(jlines(N/"native-V4-raw-intentions.jsonl"),1):
 t=int(v["entryTs"])
 if START<=t<END:
  raw.append(dict(id="V4_"+str(i).zfill(5),s="V4",t=t,symbol=v["symbol"],side=v["side"],
                  route=v["route"],gross=float(v["requestedGross"]),v=v,model=None,
                  src="native-V4-raw-intentions.jsonl"))

# Current PENGU candidate body.
for i,v in enumerate(jlines(N/"native-PENGU-raw-intentions.jsonl"),1):
 t=int(v["entryTs"])
 if START<=t<END:
  raw.append(dict(id="PENGU_"+str(i).zfill(5),s="PENGU",t=t,symbol=v["symbol"],side=v["side"],
                  route=v["route"],gross=float(v["requestedGross"]),v=v,model=None,
                  src="native-PENGU-raw-intentions.jsonl"))

# Current FET signal candidates. Gross is resolved dynamically at admission (0.05x..1.0x).
_fet_exit=jd(N/"native-FET-all-intent-modeled-5m-exit-audit.json")["trades"]
_fet_map=collections.defaultdict(list)
for _x in _fet_exit:_fet_map[(_x["entryTs"],_x["symbol"],_x["route"])].append(_x)
for i,v in enumerate(jlines(N/"native-FET-raw-intentions.jsonl"),1):
 t=int(v["entryTs"])
 if not START<=t<END:continue
 m=_fet_map[(t,v["symbol"],v["route"])].pop(0)
 raw.append(dict(id="FET_"+str(i).zfill(5),s="FET",t=t,symbol=v["symbol"],side=v["side"],
                 route=v["route"],gross=1.0,v=v,
                 model=dict(entryTs=t,entryPrice=float(m["entryPrice"]),exitTs=int(m["exitTs"]),
                            exitPrice=float(m["exitPrice"]),exitReason=str(m["exitReason"])),
                 src="native-FET-all-intent-modeled-5m-exit-audit.json"))

# Current HYPE trend candidates. requested_gross already equals Production 5% risk sizing
# with 30bps sizing buffer and the 1.5x ceiling (audited 78/78).
_hype=R/"hype-aster-historical"/"hype-trend-pinned-candidates.json"
for i,v in enumerate(jd(_hype),1):
 t=int(v["entry_ts_ms"])
 if not START<=t<END:continue
 raw.append(dict(id="HYPE_"+str(i).zfill(5),s="HYPE",t=t,symbol="HYPEUSDT",side="LONG",
                 route=v["route"],gross=float(v["requested_gross"]),v=v,
                 model=dict(entryTs=t,entryPrice=float(v["entry_price"]),exitTs=int(v["exit_ts_ms"]),
                            exitPrice=float(v["exit_price"]),exitReason=str(v["exit_reason"])),
                 src=str(_hype)))

# Current Q102 V4 builder candidate set = S34 + HIGH_VOL. HIGH_VOL 19/19 was
# audited against buildQuality102CausalV4Signal. Adopted exit policies are env-gated,
# so OFF and ON are evaluated separately.
_q102p=R/"DIRECTION_RESEARCH_20261109"/"Q102_PRODUCTION_PARITY_CORRECTED_20261110"/("q102-production-candidates-adopted-"+__QMODE__+".jsonl")
_q102rows=list(jlines(_q102p))
assert len(_q102rows)==224,len(_q102rows)
for i,z in enumerate(_q102rows,1):
 t=int(z["entryTs"])
 if not START<=t<END:continue
 raw.append(dict(id="Q102P_"+str(i).zfill(5),s="Q102",t=t,symbol=z["symbol"],side=z["side"],
                 route=z["route"],gross=float(z["requestedGross"]),v=z,
                 model=dict(entryTs=t,entryPrice=float(z["entryPrice"]),exitTs=int(z["exitTs"]),
                            exitPrice=float(z["exitPrice"]),exitReason="Q102_PROD_"+str(z["exitReason"])),
                 src=str(_q102p)))

# Current Production IDLE: use every pure route candidate. The per-symbol 12h lifecycle
# cooldown is consumed only by a FILLED entry, so it is applied inside simulate(), not here.
_idlep=R/"DIRECTION_RESEARCH_20261109"/"IDLE_CURRENT_PRODUCTION_REPLAY_20261110"/"idle-production-candidates-with-m5-exits.jsonl"
_idlerows=list(jlines(_idlep))
assert len(_idlerows)==849,len(_idlerows)
for i,z in enumerate(_idlerows,1):
 t=int(z["entryTs"])
 if not START<=t<END:continue
 raw.append(dict(id="IDLEP_"+str(i).zfill(5),s="IDLE",t=t,symbol=z["symbol"],side=z["side"],
                 route=z["route"],gross=float(z["requestedGross"]),v=z,
                 model=dict(entryTs=t,entryPrice=float(z["entryPrice"]),exitTs=int(z["exitTs"]),
                            exitPrice=float(z["exitPrice"]),exitReason="IDLE_PROD_"+str(z["exitReason"])),
                 src=str(_idlep)))

# IDLE_RESIDUAL_LONG is deliberately excluded: default disabled, absent from the current
# seven-runner activation manifest, and no current master systemd wiring was found.
print("PARITY_RAW",len(raw),"Q102_MODE",__QMODE__,"IDLE",len(_idlerows),"Q102",len(_q102rows),flush=True)'''
new_raw=new_raw.replace("__QMODE__",repr(mode))
orig=orig[:start]+new_raw+orig[end:]

# Native current lifecycle for V4/PENGU, not the old research-reversal tapes.
orig=orig.replace('R/"V4_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"v4-exits.jsonl"',
                  'R/"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109"/"v4-native-lifecycle-modeled-exits.jsonl"')
orig=orig.replace('R/"PENGU_RECOVERY_EARLY_REVERSAL_20261109"/"pengu-exits.jsonl"',
                  'R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl"')

# A valid final-period Q102 HIGH_VOL can close after END; it remains open/MTM at END.
old_assert='assert m["entryTs"]==c["t"] and START<=c["t"]<m["exitTs"]<=END'
assert orig.count(old_assert)==1
orig=orig.replace(old_assert,'assert m["entryTs"]==c["t"] and START<=c["t"]<m["exitTs"]')

# Effective active V52 (8495...) uses V11/V50 slot caps 2.0x, Stock 4.0x, Total 4.25x.
# Keep source V50 request at 2.0x; actual admitted gross is resolved dynamically below.
assert orig.count('route="V50_POST_OPEN_BASIS",gross=2.0,v=z,')==1

# Runtime lifecycle state.
anchor='preemption_audit=[];pq_gate_count=collections.Counter()'
assert orig.count(anchor)==1
orig=orig.replace(anchor,anchor+'\n fet_cooldown_until=0\n idle_cooldown_until={}')

# FET post-exit cooldown.
old='def close_modeled(pid,exitt,exit_price,reason):\n  nonlocal cash'
assert orig.count(old)==1
orig=orig.replace(old,'def close_modeled(pid,exitt,exit_price,reason):\n  nonlocal cash,fet_cooldown_until')
anchor='net=total_gm-total_xf-q["fee"]+q["funded"]'
assert orig.count(anchor)==1
orig=orig.replace(anchor,anchor+'\n  if q["s"]=="FET":fet_cooldown_until=max(fet_cooldown_until,exitt+24*H)')

# Dynamic FET residual gross. HYPE capacity is conservatively checked at its full 1.5x
# runtime ceiling before actual risk-sized gross is admitted.
old='s=c["s"];g=c["gross"];reason=""'
assert orig.count(old)==1
new='''s=c["s"];g=c["gross"];reason=""
   if s=="FET" and eq is not None and math.isfinite(used_crypto) and math.isfinite(used_total):
    g=max(0.0,min(1.0,CRYPTO_CAP-used_crypto,TOTAL_CAP-used_total))
   if s=="V52" and eq is not None and math.isfinite(used_stock) and math.isfinite(used_total):
    g=max(0.0,min(2.0,(STOCK_CAP-used_stock)/1.002,(TOTAL_CAP-used_total)/1.002))'''
orig=orig.replace(old,new)

# Insert current runner-specific admission gates ahead of generic symbol/slot/cap checks.
old='elif daily:reason="DAILY_LOSS_7P5_GATE"'
assert orig.count(old)==1
new='''elif daily:reason="DAILY_LOSS_7P5_GATE"
   elif s=="FET" and t<fet_cooldown_until:reason="FET_POST_EXIT_COOLDOWN_24H"
   elif s=="FET" and g<0.05-1e-8:reason="FET_RESIDUAL_BELOW_MINIMUM"
   elif s=="HYPE" and used_crypto+1.5>CRYPTO_CAP+1e-8:reason="HYPE_FULL_1P5_CRYPTO_CAP_GATE"
   elif s=="HYPE" and used_total+1.5>TOTAL_CAP+1e-8:reason="HYPE_FULL_1P5_TOTAL_CAP_GATE"
   elif s=="IDLE" and t<idle_cooldown_until.get(c["symbol"],0):reason="IDLE_PER_SYMBOL_COOLDOWN_ACTIVE"
   elif s=="IDLE" and any(v["s"] in FORMAL_PRIORITY for v in opened.values()):reason="IDLE_BASELINE_OPEN_OR_PENDING"
   elif s=="IDLE" and any(v["s"]=="HYPE" for v in opened.values()):reason="IDLE_NON_BASELINE_SIDECAR_EXPOSURE"'''
orig=orig.replace(old,new)

# Cooldown is consumed only by a filled IDLE entry.
old='opened[pid]=q'
assert orig.count(old)==1
orig=orig.replace(old,old+'\n   if s=="IDLE":idle_cooldown_until[c["symbol"]]=t+12*H')

# Terminal accounting: carry valid open positions to END without synthetic close/exit fee.
old=''' assert j==len(a),(j,len(a))
 assert not opened,("positions_still_open",len(opened))
 assert len(entries)==len(a)
 assert math.isclose(cash,10000+sum(x["net_pnl_jpy"] for x in fills),rel_tol=1e-9,abs_tol=1e-6)
 pp=name+"_"+str(bps)+"BPS"'''
assert orig.count(old)==1
new=''' assert j==len(a),(j,len(a))
 assert len(entries)==len(a)
 terminal_eq=mark_current(END)
 if terminal_eq is None:raise RuntimeError("TERMINAL_MTM_UNAVAILABLE")
 peak=max(peak,terminal_eq)
 if peak>0 and (terminal_eq/peak-1)*100<mdd:mdd=(terminal_eq/peak-1)*100;mddt=END
 gs_end=mtm_gross_state(END,terminal_eq)
 hourly.append(dict(utc=iso(END),compounded_mtm_equity_jpy=terminal_eq,wallet_cash_jpy=cash,
                    open_count=len(opened),crypto_gross_x=(gs_end or {}).get("crypto"),
                    stock_gross_x=(gs_end or {}).get("stock"),total_gross_x=(gs_end or {}).get("total"),
                    v4_gross_x=(gs_end or {}).get("v4"),daily_gate_block=latched))
 expected_cash=10000+sum(x["net_pnl_jpy"] for x in fills)
 for q0 in opened.values():
  expected_cash+=q0.get("realized_gross_pnl",0.0)-q0.get("exit_fee_accum",0.0)-q0["fee"]+q0["funded"]
 assert math.isclose(cash,expected_cash,rel_tol=1e-9,abs_tol=1e-6),(cash,expected_cash)
 terminal_open=[dict(strategy=q0["s"],symbol=q0["symbol"],side=q0["side"],route=q0["route"],
                    entry_utc=iso(q0["ts"]),entry_price=q0["entry"],gross_x=q0["gross"],
                    modeled_future_exit_utc=iso(next((cc["model"]["exitTs"] for cc in raw if cc["id"]==q0["sid"]),END)))
               for q0 in opened.values()]
 pp=name+"_"+str(bps)+"BPS"'''
orig=orig.replace(old,new)

# Final summary should use END MTM equity, not wallet cash, and report open positions.
orig=orig.replace('final_compounded_jpy=cash,net_return_pct=(cash/10000-1)*100,max_hourly_dd_pct=mdd,',
                  'final_compounded_jpy=terminal_eq,net_return_pct=(terminal_eq/10000-1)*100,max_hourly_dd_pct=mdd,')
orig=orig.replace('print("COMPOUND_RESULT",name,bps,round(cash,2),round(mdd,2),',
                  'print("COMPOUND_RESULT",name,bps,round(result["final_compounded_jpy"],2),round(mdd,2),')
orig=orig.replace('pengu_final_realized_index=pengu_overlay["realized_equity"],',
                  'pengu_final_realized_index=pengu_overlay["realized_equity"],terminal_open_count=len(opened),terminal_open_positions=terminal_open,')

# Do not claim residual/preemption model parity in status.
orig=orig.replace('status="RESEARCH_ONLY_V52_MISSING_V4_SHADOW_Q102_PARTIAL_EXIT_MODEL_APPROX"',
                  'status="EFFECTIVE_CURRENT_CORE_PARITY_V52_V50_PROXY_V11_MISSING"')

# Bottom research case label and stale manifest fields.
orig=orig.replace('case="STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL"',
                  'case="EFFECTIVE_CURRENT_CORE_PARITY_Q102_ADOPTED_"+'+repr(mode))
orig=orig.replace('q102_selected_native_modeled=205,','q102_selected_native_modeled=224,')
orig=orig.replace('q102_selected_native_unresolved_failclosed=66,q102_high_vol_missing=True,',
                  'q102_selected_native_unresolved_failclosed=0,q102_high_vol_missing=False,')
orig=orig.replace('v4_direction_override_candidates=43,q102_direction_override_candidates=9,',
                  'v4_direction_override_candidates=0,q102_direction_override_candidates=0,')


# Shared Risk parity repair. Production writer uses crypto-only settled PnL
# plus crypto unrealized PnL over walletBalance - cryptoSettledToday.
# The 7.5% latch is sticky for the UTC day. DAILY_LOSS_TRIPPED flattens
# PENGU/Q102 positions, while V4/FET/HYPE/IDLE/V52 only block new entries.
old='fee=bps/20000;cash=10000.;opened={};heap=[];entries=[];fills=[];funds=[];partial_audit=[];hourly=[];rej=collections.Counter()'
assert orig.count(old)==1
orig=orig.replace(old,old+';crypto_settled_events=[];shared_risk_audit=[]')

old='peak=10000.;mdd=0.;mddt=START;day=None;dayeq=10000.;latched=False;j=0'
assert orig.count(old)==1
orig=orig.replace(old,'peak=10000.;mdd=0.;mddt=START;day=None;latched=False;j=0')

old='cash+=gm-xf\n  total_gm='
assert orig.count(old)==1
orig=orig.replace(old,'cash+=gm-xf\n  if q["s"]!="V52":crypto_settled_events.append((exitt,gm-xf,"CLOSE",q["s"],q["symbol"]))\n  total_gm=',1)

old='cash+=amount;q["funded"]+=amount'
assert orig.count(old)==1
orig=orig.replace(old,'cash+=amount;q["funded"]+=amount\n    if q["s"]!="V52":crypto_settled_events.append((tm,amount,"FUNDING",q["s"],q["symbol"]))',1)

old='cash+=gm-xf\n    q["realized_gross_pnl"]=q.get("realized_gross_pnl",0.0)+gm'
assert orig.count(old)==2
orig=orig.replace(old,'cash+=gm-xf\n    if q["s"]!="V52":crypto_settled_events.append((t0,gm-xf,"PARTIAL_OR_REVERSAL",q["s"],q["symbol"]))\n    q["realized_gross_pnl"]=q.get("realized_gross_pnl",0.0)+gm')

old='cost=notional*fee;cash-=cost'
assert orig.count(old)==1
orig=orig.replace(old,'cost=notional*fee;cash-=cost\n   if s!="V52":crypto_settled_events.append((t,-cost,"ENTRY_FEE",s,c["symbol"]))',1)

mark_anchor=' def mtm_gross_state(t,eq,vals=None):'
assert orig.count(mark_anchor)==1
risk_helpers=r''' def shared_crypto_unrealized(t):
  u=0.0
  for q in opened.values():
   if q["s"]=="V52":continue
   z5=five(q["symbol"],t-5*60_000)
   if z5 is not None:
    mark=z5[4]
   else:
    z=completed_h1(q["symbol"],t)
    if z is None:return None
    mark=q["entry"] if z[0]+H<=q.get("active_ts",q["ts"]) else z[4]
   u+=q["notional"]*(1 if q["side"]=="LONG" else -1)*(mark/q["entry"]-1)
  return u
 def shared_crypto_risk_snapshot(t):
  start=(t//(24*H))*(24*H)
  settled=sum(x[1] for x in crypto_settled_events if start<=x[0]<=t)
  unreal=shared_crypto_unrealized(t)
  if unreal is None:return None
  ref=cash-settled
  if not (ref>0 and math.isfinite(ref)):return None
  loss=max(0.0,-(settled+unreal)/ref)
  return dict(settled=settled,unrealized=unreal,reference=ref,loss=loss)
 def flatten_shared_risk_positions(t,snap):
  ids=[pid for pid,q in opened.items() if q["s"] in ("PENGU","Q102")]
  for pid in ids:
   if pid not in opened:continue
   q=opened[pid];z5=five(q["symbol"],t-5*60_000)
   if z5 is not None:px=z5[4]
   else:
    z=completed_h1(q["symbol"],t);px=(z[4] if z is not None else None)
   if px is None:raise RuntimeError("SHARED_RISK_FLATTEN_QUOTE_UNAVAILABLE:"+q["symbol"]+":"+iso(t))
   shared_risk_audit.append(dict(utc=iso(t),event="FLATTEN",loss_pct=100*snap["loss"],
      reference_equity_jpy=snap["reference"],settled_crypto_pnl_jpy=snap["settled"],
      unrealized_crypto_pnl_jpy=snap["unrealized"],strategy=q["s"],symbol=q["symbol"],exit_price_proxy=px))
   close_modeled(pid,t,px,"SHARED_RISK_FLATTEN")
'''
orig=orig.replace(mark_anchor,risk_helpers+mark_anchor,1)

old='''  eq=mark_current(t)
  if eq is not None:
   if day!=t//(24*H):day=t//(24*H);dayeq=eq;latched=False
   peak=max(peak,eq)
   if peak>0 and (eq/peak-1)*100<mdd:mdd=(eq/peak-1)*100;mddt=t
  if eq is None or dayeq<=0 or eq<=dayeq*.925:latched=True
  daily=latched
  gs=mtm_gross_state(t,eq)'''
assert orig.count(old)==1
new='''  eq=mark_current(t)
  curday=t//(24*H)
  if day!=curday:day=curday;latched=False
  snap=shared_crypto_risk_snapshot(t)
  if snap is not None and not latched and snap["loss"]>=.075:
   latched=True
   shared_risk_audit.append(dict(utc=iso(t),event="TRIP",loss_pct=100*snap["loss"],
      reference_equity_jpy=snap["reference"],settled_crypto_pnl_jpy=snap["settled"],
      unrealized_crypto_pnl_jpy=snap["unrealized"],strategy="",symbol="",exit_price_proxy=""))
  if latched and snap is not None:
   flatten_shared_risk_positions(t,snap)
   eq=mark_current(t)
  daily=(snap is None) or latched
  if eq is not None:
   peak=max(peak,eq)
   if peak>0 and (eq/peak-1)*100<mdd:mdd=(eq/peak-1)*100;mddt=t
  gs=mtm_gross_state(t,eq)'''
orig=orig.replace(old,new,1)

old='''     if eq is None or eq<=dayeq*.925:latched=True
     daily=latched'''
assert orig.count(old)==1
new='''     snap=shared_crypto_risk_snapshot(t)
     if snap is not None and not latched and snap["loss"]>=.075:
      latched=True
      shared_risk_audit.append(dict(utc=iso(t),event="TRIP",loss_pct=100*snap["loss"],
       reference_equity_jpy=snap["reference"],settled_crypto_pnl_jpy=snap["settled"],
       unrealized_crypto_pnl_jpy=snap["unrealized"],strategy="",symbol="",exit_price_proxy=""))
     if latched and snap is not None:
      flatten_shared_risk_positions(t,snap);eq=mark_current(t)
     daily=(snap is None) or latched'''
orig=orig.replace(old,new,1)

anchor=' wr(pp+"_PENGU_PARTIAL_EVENTS.csv",partial_audit,["trade_id","strategy","symbol","route","utc","price",'
assert orig.count(anchor)==1
orig=orig.replace(anchor,' wr(pp+"_SHARED_RISK_EVENTS.csv",shared_risk_audit,["utc","event","loss_pct","reference_equity_jpy","settled_crypto_pnl_jpy","unrealized_crypto_pnl_jpy","strategy","symbol","exit_price_proxy"])\n'+anchor,1)

old='pengu_final_realized_index=pengu_overlay["realized_equity"],terminal_open_count=len(opened),terminal_open_positions=terminal_open,'
assert orig.count(old)==1
orig=orig.replace(old,old+'shared_risk_trip_count=sum(x["event"]=="TRIP" for x in shared_risk_audit),shared_risk_flatten_count=sum(x["event"]=="FLATTEN" for x in shared_risk_audit),',1)

orig=orig.replace('case="EFFECTIVE_CURRENT_CORE_PARITY_Q102_ADOPTED_"+'+repr(mode),
                  'case="EFFECTIVE_CURRENT_SHARED_RISK_PARITY_Q102_ADOPTED_"+'+repr(mode),1)
orig=orig.replace('status="EFFECTIVE_CURRENT_CORE_PARITY_V52_V50_PROXY_V11_MISSING"',
                  'status="EFFECTIVE_CURRENT_SHARED_RISK_PARITY_V52_V50_PROXY_V11_MISSING"',1)



# V52 runtime owns independent V11 and V50 slots.
old='sum(v["s"]==s for v in others)<(3 if s=="V4" else 1)'
assert orig.count(old)==1
new='((not any(v["s"]=="V52" and v["route"]==c["route"] for v in others)) if s=="V52" else sum(v["s"]==s for v in others)<(3 if s=="V4" else 1))'
orig=orig.replace(old,new,1)

old='elif sum(v["s"]==s for v in opened.values())>=(3 if s=="V4" else 1):reason="RUNNER_SLOT_BUSY"'
assert orig.count(old)==1
new='''elif s=="V52" and any(v["s"]=="V52" and v["route"]==c["route"] for v in opened.values()):reason="RUNNER_SLOT_BUSY"
   elif s!="V52" and sum(v["s"]==s for v in opened.values())>=(3 if s=="V4" else 1):reason="RUNNER_SLOT_BUSY"'''
orig=orig.replace(old,new,1)

# Shared-risk timing sensitivity: evaluate the state on a 5-minute grid.
assert orig.count('STEP=1800000')==1
orig=orig.replace('STEP=1800000','STEP=300000',1)

# V52 own 3.5% strategy daily-loss latch parity.
# Use full-period public Aster 5m marks and Yahoo H1 session-open timestamps.
_global_anchor='P={"V52":0,"PENGU":1,"Q102":2,"V4":3,"FET":4,"HYPE":5,"IDLE":6,"RESIDUAL":7}\nPQ=dict(P)'
assert orig.count(_global_anchor)==1
_global_code=r'''
from zoneinfo import ZoneInfo
_V52_5M={}
_V52_5M_DIR=R/"V11_ASTER_5M_FULLPERIOD_20261111"
for _sym in ("AMZNUSDT","METAUSDT","MSFTUSDT","NVDAUSDT","TSLAUSDT"):
 _p=_V52_5M_DIR/f"{_sym}-5m-20251001-20261001.jsonl.gz"
 _d={}
 with gzip.open(_p,"rt",encoding="utf8") as _fh:
  for _line in _fh:
   _x=json.loads(_line);_d[int(_x[0])]=(float(_x[1]),float(_x[4]))
 _V52_5M[_sym]=_d
_NY=ZoneInfo("America/New_York")
_V52_SESSION_OPEN={}
for _r in jd(R/"yahoo-public-stock-h1"/"AMZN-Yahoo-H1-20251001-20261001.json"):
 _ts=int(_r["tsSeconds"])*1000
 _loc=datetime.datetime.fromtimestamp(_ts/1000,tz=datetime.timezone.utc).astimezone(_NY)
 _day=_loc.date().isoformat()
 if _day not in _V52_SESSION_OPEN or _ts<_V52_SESSION_OPEN[_day]:_V52_SESSION_OPEN[_day]=_ts
def v52_mark5(s,t):
 _x=_V52_5M.get(s,{}).get(t-5*60_000)
 return _x[1] if _x is not None else None
def v52_open5(s,t):
 _x=_V52_5M.get(s,{}).get(t)
 return _x[0] if _x is not None else None
def v52_session_open(t):
 _loc=datetime.datetime.fromtimestamp(t/1000,tz=datetime.timezone.utc).astimezone(_NY)
 _op=_V52_SESSION_OPEN.get(_loc.date().isoformat())
 return _op is not None and _op<=t<_op+int(6.5*H)
'''
orig=orig.replace(_global_anchor,_global_code+_global_anchor,1)

_oldinit='fee=bps/20000;cash=10000.;opened={};heap=[];entries=[];fills=[];funds=[];partial_audit=[];hourly=[];rej=collections.Counter();crypto_settled_events=[];shared_risk_audit=[]'
assert orig.count(_oldinit)==1
orig=orig.replace(_oldinit,_oldinit+';v52_day=None;v52_latched=False;v52_ledger=[];v52_daily_audit=[]',1)

# Live ledger stores realizedPnl net commission; helper subtracts commission again.
_oldnet='net=total_gm-total_xf-q["fee"]+q["funded"]'
assert orig.count(_oldnet)==1
orig=orig.replace(_oldnet,_oldnet+'\n  if q["s"]=="V52":\n   _comm=q["fee"]+total_xf\n   v52_ledger.append((exitt,total_gm-2*_comm,q["symbol"],reason))',1)

# Mark V52 with Aster 5m rather than the older H1 proxy for MTM/capacity/risk.
_oldmark='''  for q in opened.values():
   z=completed_h1(q["symbol"],t)
   if z is None:return None
   mark=q["entry"] if z[0]+H<=q.get("active_ts",q["ts"]) else z[4]
   v+=q["notional"]*(1 if q["side"]=="LONG" else -1)*(mark/q["entry"]-1)'''
assert orig.count(_oldmark)==1
_newmark='''  for q in opened.values():
   if q["s"]=="V52":
    mark=v52_mark5(q["symbol"],t)
    if mark is None:mark=q["entry"]
   else:
    z=completed_h1(q["symbol"],t)
    if z is None:return None
    mark=q["entry"] if z[0]+H<=q.get("active_ts",q["ts"]) else z[4]
   v+=q["notional"]*(1 if q["side"]=="LONG" else -1)*(mark/q["entry"]-1)'''
orig=orig.replace(_oldmark,_newmark,1)

_oldgross='''  for q in xs:
   z=completed_h1(q["symbol"],t)
   if z is None:return None
   mark=q["entry"] if z[0]+H<=q.get("active_ts",q["ts"]) else z[4]
   current_notional=float(q["notional"])*(float(mark)/float(q["entry"]))'''
assert orig.count(_oldgross)==1
_newgross='''  for q in xs:
   if q["s"]=="V52":
    mark=v52_mark5(q["symbol"],t)
    if mark is None:mark=q["entry"]
   else:
    z=completed_h1(q["symbol"],t)
    if z is None:return None
    mark=q["entry"] if z[0]+H<=q.get("active_ts",q["ts"]) else z[4]
   current_notional=float(q["notional"])*(float(mark)/float(q["entry"]))'''
orig=orig.replace(_oldgross,_newgross,1)

# Defer V52 modeled exit until own daily-loss check runs, matching live tick ordering.
_oldheap='''   else:
    close_modeled(pid,t0,q["exit"],q["reason"])'''
assert orig.count(_oldheap)==1
_newheap='''   else:
    if q["s"]=="V52":
     q["due_exit_ts"]=t0;q["due_exit_price"]=q["exit"];q["due_exit_reason"]=q["reason"]
    else:
     close_modeled(pid,t0,q["exit"],q["reason"])'''
orig=orig.replace(_oldheap,_newheap,1)

# Insert V52 daily latch before shared-crypto risk calculation.
_risk_anchor='''  eq=mark_current(t)
  curday=t//(24*H)
  if day!=curday:day=curday;latched=False'''
assert orig.count(_risk_anchor)==1
_v52risk=r'''  cur_v52_day=t//(24*H)
  if v52_day!=cur_v52_day:
   v52_day=cur_v52_day;v52_latched=False
  eq_v52=mark_current(t)
  if eq_v52 is None or eq_v52<=0:
   v52_latched=True
   v52_daily_audit.append(dict(utc=iso(t),event="FAIL_CLOSED",loss_pct="",strategy_capital_jpy="",
      realized_strategy_pnl_jpy="",unrealized_strategy_pnl_jpy="",symbol="",reason="MISSING_EQUITY"))
  else:
   _gscrypto=mtm_gross_state(t,eq_v52,[q for q in opened.values() if q["s"]!="V52"])
   if _gscrypto is None:
    v52_latched=True
    v52_daily_audit.append(dict(utc=iso(t),event="FAIL_CLOSED",loss_pct="",strategy_capital_jpy="",
       realized_strategy_pnl_jpy="",unrealized_strategy_pnl_jpy="",symbol="",reason="MISSING_CRYPTO_GROSS"))
   else:
    _start=(t//(24*H))*(24*H)
    _real=sum(x[1] for x in v52_ledger if _start<=x[0]<=t)
    _unreal=0.0
    for _q in opened.values():
     if _q["s"]!="V52":continue
     _mk=v52_mark5(_q["symbol"],t)
     if _mk is None:_mk=_q["entry"]
     _unreal+=_q["notional"]*(1 if _q["side"]=="LONG" else -1)*(_mk/_q["entry"]-1)
    _mincap=10000.0*5.0/62.50520405
    _crypto_notional=_gscrypto["crypto"]*eq_v52
    _reserve=max(_mincap,.10*eq_v52)
    _capital=max(_mincap,eq_v52-_crypto_notional-_reserve)
    _loss=max(0.0,-(_real+_unreal))
    _lpct=_loss/_capital if _capital>0 else float("inf")
    if (not v52_latched) and _lpct>=.035:
     v52_latched=True
     v52_daily_audit.append(dict(utc=iso(t),event="TRIP",loss_pct=100*_lpct,strategy_capital_jpy=_capital,
       realized_strategy_pnl_jpy=_real,unrealized_strategy_pnl_jpy=_unreal,symbol="",reason="V52_DAILY_LOSS_3P5"))
  # manage_positions runs only if own latch is clear and market is open.
  if not v52_latched and v52_session_open(t):
   for _pid in list(opened.keys()):
    if _pid not in opened:continue
    _q=opened[_pid]
    if _q["s"]!="V52" or not _q.get("due_exit_ts"):continue
    _due=int(_q["due_exit_ts"])
    if t<=_due+5*60_000:
     _px=float(_q["due_exit_price"]);_rs=str(_q["due_exit_reason"])
    else:
     _px=v52_open5(_q["symbol"],t)
     if _px is None:_px=v52_mark5(_q["symbol"],t)
     if _px is None:continue
     _rs="MISSED_CHECKPOINT_FAIL_CLOSED"
     v52_daily_audit.append(dict(utc=iso(t),event="DEFERRED_EXIT",loss_pct="",strategy_capital_jpy="",
       realized_strategy_pnl_jpy="",unrealized_strategy_pnl_jpy="",symbol=_q["symbol"],reason=_rs))
    close_modeled(_pid,t,_px,_rs)
'''
orig=orig.replace(_risk_anchor,_v52risk+_risk_anchor,1)

# Own V52 latch blocks new V52 entries before the current runner-specific gates.
_entry_anchor='elif daily:reason="DAILY_LOSS_7P5_GATE"'
assert orig.count(_entry_anchor)==1
orig=orig.replace(_entry_anchor,_entry_anchor+'\n   elif s=="V52" and v52_latched:reason="V52_STRATEGY_DAILY_LOSS_3P5_GATE"',1)

# Audit output + summary counts.
_out_anchor=' wr(pp+"_SHARED_RISK_EVENTS.csv",shared_risk_audit,["utc","event","loss_pct","reference_equity_jpy","settled_crypto_pnl_jpy","unrealized_crypto_pnl_jpy","strategy","symbol","exit_price_proxy"])'
assert orig.count(_out_anchor)==1
orig=orig.replace(_out_anchor,_out_anchor+'\n wr(pp+"_V52_DAILY_RISK_EVENTS.csv",v52_daily_audit,["utc","event","loss_pct","strategy_capital_jpy","realized_strategy_pnl_jpy","unrealized_strategy_pnl_jpy","symbol","reason"])',1)

_sum_anchor='shared_risk_trip_count=sum(x["event"]=="TRIP" for x in shared_risk_audit),shared_risk_flatten_count=sum(x["event"]=="FLATTEN" for x in shared_risk_audit),'
assert orig.count(_sum_anchor)==1
orig=orig.replace(_sum_anchor,_sum_anchor+'v52_daily_trip_count=sum(x["event"]=="TRIP" for x in v52_daily_audit),v52_deferred_exit_count=sum(x["event"]=="DEFERRED_EXIT" for x in v52_daily_audit),',1)

orig=orig.replace('case="EFFECTIVE_CURRENT_SHARED_RISK_PARITY_Q102_ADOPTED_"+'+repr(mode),
                  'case="EFFECTIVE_CURRENT_V52_DAILY_LATCH_5M_Q102_ADOPTED_"+'+repr(mode),1)
orig=orig.replace('status="EFFECTIVE_CURRENT_SHARED_RISK_PARITY_V52_V50_PROXY_V11_MISSING"',
                  'status="EFFECTIVE_CURRENT_V52_DAILY_LATCH_5M_V11_MISSING"',1)

print("CURRENT_PARITY_WRAPPER",mode,"SOURCE_SHA256",hashlib.sha256(SRC.read_bytes()).hexdigest(),flush=True)
exec(compile(orig,str(SRC)+"::CURRENT_PRODUCTION_PARITY_"+mode,"exec"),{"__name__":"__main__"})

O=R/out_name
att={
 "status":"EFFECTIVE_CURRENT_V52_DAILY_LATCH_5M_V11_MISSING_NOT_FULL_VENUE_PARITY",
 "q102AdoptedExitMode":mode,
 "effectiveRuntimeCaps":{"crypto":3.0,"stock":4.0,"total":4.25,"sharedDailyLossPct":7.5,"v52V11Slot":2.0,"v52V50Slot":2.0,"v52WorstCaseBufferBps":20},
 "formalManifestV52Pin":"4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81",
 "effectiveV52Source":"8495daf24e53a6cf0dd5e38f022008fa8f78c688",
 "effectiveSharedRiskSource":"2737c30e1f6d014d24a2c6d025e7f91332bf7962",
 "runnerPins":{"V4":"53a0be396719f0284af4e11b35c66a4ac7d58f79","PENGU":"1657e173d250ad58f53e62f7bb0a3428fb405496",
 "Q102":"ef1ab178e26a7bf5bddb6473467765edba242e1d","V52":"8495daf24e53a6cf0dd5e38f022008fa8f78c688",
 "FET":"7688ed7c93a1918d8b44837339b7da5584a868f5","HYPE":"7688ed7c93a1918d8b44837339b7da5584a868f5",
 "IDLE":"7688ed7c93a1918d8b44837339b7da5584a868f5"},
 "repairs":["Q102 HIGH_VOL 19 included with live V4-builder parity","IDLE 849 pure route candidates; cooldown consumed on actual fill",
            "IDLE blocked while core baseline or HYPE sidecar is open","FET dynamic residual gross 0.05..1.0 and 24h post-exit cooldown",
            "IDLE_RESIDUAL_LONG excluded absent current activation/systemd evidence","HYPE full-1.5x pre-cap gate plus risk-sized actual gross",
            "V4/PENGU current native lifecycle tapes","terminal open position carried MTM without artificial exit fee","shared crypto daily risk uses crypto-only settled+unrealized PnL and sticky 7.5% UTC-day latch","DAILY_LOSS_TRIPPED flattens PENGU/Q102 but only entry-blocks V4/FET/HYPE/IDLE/V52","V52 V11/V50 are independent route slots","shared-risk timing evaluated every 5 minutes","V52 own 3.5% strategy daily loss latch evaluated every 5 minutes using full-period Aster stock marks","V52 missed exits while latched close fail-closed at first later regular-session tick"],
 "unresolved":["V52 remains H1 basis price proxy; no historical executable book/reference/spread parity",
               "effective VPS env verified read-only: Q102 adopted exits ON exact ACK; FET trailing ON; HYPE preemption OFF",
               "V52 V11 conservative baseline is omitted; 34 causal cached candidates remain microstructure-uncertain, while later-period reconstruction/live decisions add zero candidates",
               "effective active runtime uses 3.0/4.0/4.25 while a separate formal activation manifest advertises 3.0/1.5/3.5; this replay follows effective active runtime",
               "V4 V2 historical candidate body is retrospectively selected and cannot serve as unbiased causal evidence",
               "modeled prices are not signed historical venue fills"]
}
(O/"CURRENT_PARITY_ATTESTATION.json").write_text(json.dumps(att,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("CURRENT_PARITY_COMPLETE",mode,flush=True)
