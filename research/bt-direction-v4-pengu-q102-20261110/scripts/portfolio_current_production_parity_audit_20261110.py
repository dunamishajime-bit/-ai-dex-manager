#!/usr/bin/env python3
"""
Current-implementation parity audit replay wrapper.
Research/read-only only. It intentionally does NOT apply the three research gates
or remove the current V4 V2 body. It repairs Q102/IDLE/FET portfolio semantics
found during the 2026-11-10 deep audit.

Irreducible caveats remain:
- V52 is a historical price proxy, not executable-book/signature parity.
- Current effective VPS env is unavailable; Q102 adopted exits are run OFF/ON.
- FET/HYPE preemption is default-OFF absent an env proof.
- Current V4 V2 historical candidate population is retrospectively selected.
"""
from pathlib import Path
import os,re,json,hashlib

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
SRC=R/"dd_strict_v2_plus_v4q102_pengu_recovery_reversal_20261109.py"
mode=os.environ["DISDEX_Q102_ADOPTED_MODE"].strip().upper()
assert mode in {"OFF","ON"},mode
out_name=f"VPS_CURRENT_PRODUCTION_PARITY_Q102_ADOPTED_{mode}_20261110"

orig=SRC.read_text(encoding="utf8")

# Output and current formal activation caps.
old='O=R/"VPS_DD_STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_20261109";O.mkdir(exist_ok=True)'
assert orig.count(old)==1
orig=orig.replace(old,f'O=R/"{out_name}";O.mkdir(exist_ok=True)')
orig=orig.replace("CRYPTO_CAP=3.0;TOTAL_CAP=3.5;STOCK_CAP=4.0;V4_POS_CAP=1.30;V4_AGG_CAP=2.0",
                  "CRYPTO_CAP=3.0;TOTAL_CAP=3.5;STOCK_CAP=1.5;V4_POS_CAP=1.0;V4_AGG_CAP=2.0")
orig=orig.replace("CRYPTO_CAP=3.0;TOTAL_CAP=3.5;STOCK_CAP=4.0;V4_AGG_CAP=2.0;V4_POS_CAP=1.35",
                  "CRYPTO_CAP=3.0;TOTAL_CAP=3.5;STOCK_CAP=1.5;V4_AGG_CAP=2.0;V4_POS_CAP=1.0")

# Report current runner pins. Economic V4/PENGU blobs were audited equivalent.
pin_repl={
'"V4":"3ad65403013b701db5d9e53e8814e6ab827a28e8"':'"V4":"53a0be396719f0284af4e11b35c66a4ac7d58f79"',
'"PENGU":"1657e173d250ad58f53e62f7bb0a3428fb405496"':'"PENGU":"7688ed7c93a1918d8b44837339b7da5584a868f5"',
'"V52":"8495daf24e53a6cf0dd5e38f022008fa8f78c688"':'"V52":"4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"',
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

# V52 proxy: the current formal activation plan is stock gross 1.5x.
orig=orig.replace('route="V50_POST_OPEN_BASIS",gross=2.0,v=z,',
                  'route="V50_POST_OPEN_BASIS",gross=1.5,v=z,')

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
     g=max(0.0,min(1.0,CRYPTO_CAP-used_crypto,TOTAL_CAP-used_total))'''
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
orig=orig.replace(old,old+'\n    if s=="IDLE":idle_cooldown_until[c["symbol"]]=t+12*H')

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
orig=orig.replace('pengu_final_realized_index=pengu_overlay["realized_equity"],',
                  'pengu_final_realized_index=pengu_overlay["realized_equity"],terminal_open_count=len(opened),terminal_open_positions=terminal_open,')

# Do not claim residual/preemption model parity in status.
orig=orig.replace('status="RESEARCH_ONLY_V52_MISSING_V4_SHADOW_Q102_PARTIAL_EXIT_MODEL_APPROX"',
                  'status="CURRENT_IMPLEMENTATION_PARITY_AUDIT_V52_PROXY_ENV_UNVERIFIED"')

# Bottom research case label and stale manifest fields.
orig=orig.replace('case="STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL"',
                  'case="CURRENT_PRODUCTION_PARITY_Q102_ADOPTED_"+'+repr(mode))
orig=orig.replace('q102_selected_native_modeled=205,','q102_selected_native_modeled=224,')
orig=orig.replace('q102_selected_native_unresolved_failclosed=66,q102_high_vol_missing=True,',
                  'q102_selected_native_unresolved_failclosed=0,q102_high_vol_missing=False,')
orig=orig.replace('v4_direction_override_candidates=43,q102_direction_override_candidates=9,',
                  'v4_direction_override_candidates=0,q102_direction_override_candidates=0,')

print("CURRENT_PARITY_WRAPPER",mode,"SOURCE_SHA256",hashlib.sha256(SRC.read_bytes()).hexdigest(),flush=True)
exec(compile(orig,str(SRC)+"::CURRENT_PRODUCTION_PARITY_"+mode,"exec"),{"__name__":"__main__"})

O=R/out_name
att={
 "status":"CURRENT_IMPLEMENTATION_PARITY_AUDIT_NOT_FULL_VENUE_PARITY",
 "q102AdoptedExitMode":mode,
 "formalActivationCaps":{"crypto":3.0,"stock":1.5,"total":3.5,"sharedDailyLossPct":7.5},
 "runnerPins":{"V4":"53a0be396719f0284af4e11b35c66a4ac7d58f79","PENGU":"7688ed7c93a1918d8b44837339b7da5584a868f5",
 "Q102":"ef1ab178e26a7bf5bddb6473467765edba242e1d","V52":"4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81",
 "FET":"7688ed7c93a1918d8b44837339b7da5584a868f5","HYPE":"7688ed7c93a1918d8b44837339b7da5584a868f5",
 "IDLE":"7688ed7c93a1918d8b44837339b7da5584a868f5"},
 "repairs":["Q102 HIGH_VOL 19 included with live V4-builder parity","IDLE 849 pure route candidates; cooldown consumed on actual fill",
            "IDLE blocked while core baseline or HYPE sidecar is open","FET dynamic residual gross 0.05..1.0 and 24h post-exit cooldown",
            "IDLE_RESIDUAL_LONG excluded absent current activation/systemd evidence","HYPE full-1.5x pre-cap gate plus risk-sized actual gross",
            "V4/PENGU current native lifecycle tapes","terminal open position carried MTM without artificial exit fee"],
 "unresolved":["V52 remains H1 basis price proxy; no historical executable book/reference/spread parity",
               "effective VPS env unavailable: Q102 adopted exits and FET/HYPE preemption toggles are not directly observed",
               "old runner pins contain legacy gross contracts that conflict with latest formal 3.0/1.5/3.5 activation manifest",
               "V4 V2 historical candidate body is retrospectively selected and cannot serve as unbiased causal evidence",
               "modeled prices are not signed historical venue fills"]
}
(O/"CURRENT_PARITY_ATTESTATION.json").write_text(json.dumps(att,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("CURRENT_PARITY_COMPLETE",mode,flush=True)
