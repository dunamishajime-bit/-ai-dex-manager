"""Research-only independent-sleeve V12 multi-trade replay.

Purpose: test the user's intended architecture: several independent V12 logic sleeves,
not many routes forced through one shared V12 slot/cooldown pool.

Safety:
- No LIVE/Production mutation.
- Shared crypto gross cap 3.0x and total gross cap 4.25x stay unchanged.
- Same-symbol ownership remains exclusive.
- High-confidence FAILED_BREAK core keeps priority.
- Recovery sleeves are preemptible by true core strategies.
"""
import contextlib,io,json
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_multilogic_recovery as ml

s=ml.s
ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-independent-sleeves-20261008'
H=3600000
MID=s.MID
INDEP_PREFIX='REC_'
COMPLEMENT='CONT_SHORT_MID_AGE24_48'
RECOVERY_CAPS={
 'INDEP_RCAP050':.50,
 'INDEP_RCAP075':.75,
 'INDEP_RCAP100':1.00,
}
FAILED=None
ORIG_PATCH=None

def is_recovery_obj(x):
    r=str(x.get('route') or '')
    return r.startswith(INDEP_PREFIX) or r==COMPLEMENT

def custom_source_batch(rs,active,completed,ts,market,equity,gross,finalize,lifecycle):
    # Same overlay logic as reference, except low-priority V12 recovery sleeves do not
    # make the portfolio "core busy" by themselves.
    core={'V12','PENGU','Q102','FET','V52'}
    def true_core(x):
        return x['strategy_id'] in core and not (x['strategy_id']=='V12' and is_recovery_obj(x))
    core_signal=any(true_core(r) for r in rs)
    idle_signal=any(r['strategy_id']=='IDLE' and ts>=lifecycle.get(r['symbol'],0) for r in rs)
    for pid,p in list(active.items()):
        if p['strategy_id']=='RESIDUAL' and (core_signal or idle_signal):
            price=market(p['symbol'],ts)
            if price is None: raise ValueError('RESIDUAL_PREEMPT_MARK_MISSING')
            finalize(pid,ts,price,'FORMAL_PRIORITY' if core_signal else 'IDLE_SHORT_PRIORITY')
    core_busy=core_signal or any(true_core(p) for p in active.values())
    sidecar_busy=any(p['strategy_id']=='HYPE_LONG' for p in active.values())
    for r in rs:
        if r['strategy_id'] not in {'IDLE','RESIDUAL'}: continue
        reason=None
        if core_busy: reason='CORE_SIGNAL_OR_POSITION'
        elif sidecar_busy: reason='HYPE_SIDECAR_ACTIVE'
        elif r['strategy_id']=='IDLE' and ts<lifecycle.get(r['symbol'],0): reason='FILLED_SYMBOL_COOLDOWN'
        elif r['strategy_id']=='RESIDUAL':
            if idle_signal or any(p['strategy_id']=='IDLE' for p in active.values()): reason='IDLE_PRIORITY'
            elif any(p['strategy_id']=='RESIDUAL' for p in active.values()): reason='RESIDUAL_SLOT_OCCUPIED'
        r['_overlay_block']=reason
    idle=[r for r in rs if r['strategy_id']=='IDLE' and not r['_overlay_block']]
    if idle:
        e=equity();crypto=sum(gross(p,e) for p in active.values() if p['strategy_id']!='V52');total=sum(gross(p,e) for p in active.values())
        if min(3.-crypto,4.25-total)+1e-9<len(idle):
            for r in idle:r['_overlay_block']='MULTI_SIGNAL_CAPACITY_AMBIGUOUS'

def independent_patch(source,strict):
    source=ORIG_PATCH(source,strict)
    # Route-local symbol and side-loss cooldown keys.
    source=source.replace('last=v12_last_stop_ts_by_symbol[symbol]',
                          'last=v12_last_stop_ts_by_symbol[(str(position.get("route") or "CORE"),symbol)]')
    source=source.replace('v12_last_stop_ts_by_symbol[symbol]=ts',
                          'v12_last_stop_ts_by_symbol[(str(position.get("route") or "CORE"),symbol)]=ts')
    source=source.replace('v12_cooldown_by_symbol[symbol] = ts + hours * HOUR',
                          'v12_cooldown_by_symbol[(str(position.get("route") or "CORE"),symbol)] = ts + hours * HOUR')
    source=source.replace('side_key = str(position["side"])',
                          'side_key = (str(position.get("route") or "CORE"),str(position["side"]))')
    source=source.replace('v12_cooldown_by_symbol[candidate["symbol"]]',
                          'v12_cooldown_by_symbol[(str(candidate.get("route") or "CORE"),candidate["symbol"])]')
    source=source.replace('v12_side_loss_until[str(candidate["side"])]',
                          'v12_side_loss_until[(str(candidate.get("route") or "CORE"),str(candidate["side"]))]')

    indep_expr='(str(candidate.get("route") or "").startswith("REC_") or str(candidate.get("route") or "")=="CONT_SHORT_MID_AGE24_48")'
    pos_indep='(str(p.get("route") or "").startswith("REC_") or str(p.get("route") or "")=="CONT_SHORT_MID_AGE24_48")'

    # Recovery signals must never preempt the reference Rank3 sleeve.
    old='if strategy in {"V12","PENGU","Q102","FET","V52"} and not (strategy == "V12" and int(candidate.get("rank") or 0) == 3):'
    new=f'if strategy in {{"V12","PENGU","Q102","FET","V52"}} and not (strategy == "V12" and (int(candidate.get("rank") or 0) == 3 or {indep_expr})):'
    assert source.count(old)==1
    source=source.replace(old,new,1)

    # True core signals preempt a same-symbol recovery sleeve before ownership checks.
    hook='''                owners = [p for p in active.values() if p["symbol"] == candidate["symbol"]
                          and (p["strategy_id"] != strategy or strategy in {"IDLE","RESIDUAL"})]
'''
    assert source.count(hook)==1
    pre=f'''                candidate_is_recovery = strategy=="V12" and {indep_expr}
                if strategy in {{"V12","PENGU","Q102","FET","V52"}} and not candidate_is_recovery:
                    recovery_same_symbol=[(vp,p) for vp,p in list(active.items())
                        if p["strategy_id"]=="V12"
                        and (str(p.get("route") or "").startswith("REC_") or str(p.get("route") or "")=="CONT_SHORT_MID_AGE24_48")
                        and p["symbol"]==candidate["symbol"]]
                    for vp,p in recovery_same_symbol:
                        mark=_mark(market,p["symbol"],ts)
                        if mark is None: raise ValueError(f"RECOVERY_SYMBOL_PREEMPT_MARK_MISSING:{{p['symbol']}}:{{ts}}")
                        finalize_position(vp,ts,mark,f"RECOVERY_SYMBOL_PREEMPT:{{strategy}}")
'''+hook
    source=source.replace(hook,pre,1)

    # Replace shared V12 2+1 slots with core slots + one slot per independent route.
    oldblock='''                if strategy == "V12":
                    if any(p["symbol"] == candidate["symbol"] for p in active_same_strategy):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SAME_SYMBOL_ACTIVE", ts)
                        rejected["V12:SAME_SYMBOL_ACTIVE"] += 1
                        continue
                    rank3 = int(candidate.get("rank") or 0) == 3
                    if rank3 and any(int(p.get("rank") or 0) == 3 for p in active_same_strategy):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:RANK3_SLOT_OCCUPIED", ts)
                        rejected["V12:RANK3_SLOT_OCCUPIED"] += 1
                        continue
                    if not rank3 and sum(int(p.get("rank") or 0) != 3 for p in active_same_strategy) >= 2:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:BASE_SLOTS_FULL", ts)
                        rejected["V12:BASE_SLOTS_FULL"] += 1
                        continue
                    if len(active_same_strategy) >= 3:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:MAX_POSITIONS", ts)
                        rejected["V12:MAX_POSITIONS"] += 1
                        continue
'''
    assert source.count(oldblock)==1
    newblock=f'''                if strategy == "V12":
                    if any(p["symbol"] == candidate["symbol"] for p in active_same_strategy):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SAME_SYMBOL_ACTIVE", ts)
                        rejected["V12:SAME_SYMBOL_ACTIVE"] += 1
                        continue
                    independent_route={indep_expr}
                    if independent_route:
                        route_name=str(candidate.get("route") or "")
                        active_same_route=[p for p in active_same_strategy if str(p.get("route") or "")==route_name]
                        if active_same_route:
                            record_decision(candidate,"REJECTED_PORTFOLIO","V12:RECOVERY_ROUTE_SLOT_OCCUPIED",ts)
                            rejected["V12:RECOVERY_ROUTE_SLOT_OCCUPIED"] += 1
                            continue
                    else:
                        core_active=[p for p in active_same_strategy if not {pos_indep}]
                        rank3 = int(candidate.get("rank") or 0) == 3
                        if rank3 and any(int(p.get("rank") or 0) == 3 for p in core_active):
                            record_decision(candidate, "REJECTED_PORTFOLIO", "V12:RANK3_SLOT_OCCUPIED", ts)
                            rejected["V12:RANK3_SLOT_OCCUPIED"] += 1
                            continue
                        if not rank3 and sum(int(p.get("rank") or 0) != 3 for p in core_active) >= 2:
                            record_decision(candidate, "REJECTED_PORTFOLIO", "V12:BASE_SLOTS_FULL", ts)
                            rejected["V12:BASE_SLOTS_FULL"] += 1
                            continue
                        if len(core_active) >= 3:
                            record_decision(candidate, "REJECTED_PORTFOLIO", "V12:MAX_POSITIONS", ts)
                            rejected["V12:MAX_POSITIONS"] += 1
                            continue
'''
    source=source.replace(oldblock,newblock,1)

    # Recovery family gross cap, while the original V12 2.0x cap and portfolio caps remain.
    hook='                room = min(strategy_room, sleeve_room, total_room)\n'
    assert source.count(hook)>=1
    cap=float(ACTIVE_RECOVERY_CAP)
    insert=f'''                room = min(strategy_room, sleeve_room, total_room)
                candidate_is_recovery = strategy=="V12" and {indep_expr}
                if candidate_is_recovery:
                    recovery_gross=sum(_gross(p,market,ts,equity) for p in active_same_strategy
                        if (str(p.get("route") or "").startswith("REC_") or str(p.get("route") or "")=="CONT_SHORT_MID_AGE24_48"))
                    room=min(room,max(0.0,{cap!r}-recovery_gross))

                # Recovery sleeve is lower priority than every true core strategy.
                if strategy in {{"V12","PENGU","Q102","FET"}} and not candidate_is_recovery and room + 1e-12 < requested:
                    recovery_victims=sorted(
                        [(vp,p) for vp,p in active.items()
                         if p["strategy_id"]=="V12"
                         and (str(p.get("route") or "").startswith("REC_") or str(p.get("route") or "")=="CONT_SHORT_MID_AGE24_48")],
                        key=lambda z:(z[1].get("entry_ts_ms",0),z[1].get("symbol","")))
                    for vp,p in recovery_victims:
                        mark=_mark(market,p["symbol"],ts)
                        if mark is None: raise ValueError(f"RECOVERY_CORE_PREEMPT_MARK_MISSING:{{p['symbol']}}:{{ts}}")
                        finalize_position(vp,ts,mark,f"RECOVERY_CORE_PREEMPT:{{strategy}}")
                        equity=_equity(wallet,active,market,ts)
                        active_same_strategy=[p for p in active.values() if p["strategy_id"]==strategy]
                        strategy_gross=sum(_gross(p,market,ts,equity) for p in active_same_strategy)
                        total_gross=sum(_gross(p,market,ts,equity) for p in active.values())
                        crypto_gross=sum(_gross(p,market,ts,equity) for p in active.values() if p["strategy_id"]!="V52")
                        stock_gross=sum(_gross(p,market,ts,equity) for p in active.values() if p["strategy_id"]=="V52")
                        strategy_room=max(0.0,research_cap-strategy_gross)
                        sleeve_room=max(0.0,(STOCK_CAP-stock_gross) if strategy=="V52" else (CRYPTO_CAP-crypto_gross))
                        total_room=max(0.0,TOTAL_CAP-total_gross)
                        room=min(strategy_room,sleeve_room,total_room)
                        if room + 1e-12 >= requested: break

                # FET is the residual sleeve and is preemptible by core crypto.
'''
    source=source.replace(hook,insert,1)

    # Recovery itself must not preempt FET to obtain Gross.
    old='if strategy in {"PENGU", "V12", "Q102"} and room + 1e-12 < requested:'
    new=f'if (strategy in {{"PENGU","Q102"}} or (strategy=="V12" and not {indep_expr})) and room + 1e-12 < requested:'
    assert source.count(old)==1
    source=source.replace(old,new,1)
    return source

ACTIVE_RECOVERY_CAP=.5

def read_table(strategy,variant='BASELINE'): return s.w.frozen_read(strategy,variant)

def alt_exit(d):
    t=int(d['entry_ts_ms'])+12*H
    bar=s.w.bars.get(d['symbol'],{}).get(t)
    if not bar:return None
    x=dict(d);px=float(bar['open']);sg=1 if x['side']=='LONG' else -1
    x.update(exit_ts_ms=t,exit_price=px,exit_reason='RECOVERY_TIME_EXIT_12H',
             unit_price_return=sg*(px/float(x['entry_price'])-1))
    return x

def filt(candidates,name):
    out=[];seen=set()
    recovery_gross=.10 if name.endswith('050') else .125 if name.endswith('075') else .15
    for c in candidates:
        if c['strategy_id']!='V12':
            out.append(c);continue
        k=(c['symbol'],c['side'],int(c['entry_ts_ms']));d=None
        if k in ml.rc.ROBUST:
            d=dict(c);d.update(route=COMPLEMENT,entryQualityClass='ROBUST_COMPLEMENT',rank=8)
            d['requested_gross']=min(float(d.get('requested_gross',.25)),.25)
        elif k in ml.ASSIGN:
            route=ml.ASSIGN[k];d=dict(c);d.update(route=route,entryQualityClass='INDEPENDENT_RECOVERY',rank=9)
            d['requested_gross']=min(float(d.get('requested_gross',recovery_gross)),recovery_gross)
        elif k in ml.ALT:
            d=alt_exit(c)
            if d is not None:
                d.update(route='REC_S7_RANGE_TOP_TIME12',entryQualityClass='INDEPENDENT_RECOVERY_ALT_EXIT',rank=9)
                d['requested_gross']=min(float(d.get('requested_gross',recovery_gross)),recovery_gross)
        if d is not None:
            tok=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
            if tok not in seen:seen.add(tok);out.append(d)
    for d0 in FAILED:
        d=dict(d0)
        tok=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
        if tok not in seen:seen.add(tok);out.append(d)
    return out

def detail(a):
    d=s.w.stats(a)
    d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/H for t in a)
    return d

def main():
    global FAILED,ORIG_PATCH,ACTIVE_RECOVERY_CAP
    OUT.mkdir(parents=True,exist_ok=True)
    s.w.OUT=OUT;s.w.setup();FAILED=ml.failed_candidates()
    s.w.base.read_table=read_table
    s.w.base._study_filter=filt
    ORIG_PATCH=s.w.base.patch_admission
    s.w.base.patch_admission=independent_patch
    s.w.base.source_batch=custom_source_batch
    protocol={
      'research_only':True,'live_changes':False,'production_changes':False,
      'architecture':'FAILED_BREAK core + independent preemptible V12 recovery sleeves',
      'route_slots':'one concurrent position per recovery route; core retains original 2 base + rank3 structure',
      'cooldowns':'route-local symbol and side-loss cooldowns for V12',
      'same_symbol':'exclusive across portfolio; true core may preempt same-symbol recovery',
      'priority':'recovery does not make IDLE/RESIDUAL core-busy; true core can preempt recovery for symbol or gross',
      'shared_caps_unchanged':{'crypto':3.0,'V12':2.0,'total':4.25},
      'recovery_family_caps':RECOVERY_CAPS,
      'recovery_candidate_gross':{'INDEP_RCAP050':.10,'INDEP_RCAP075':.125,'INDEP_RCAP100':.15},
      'costs_bps':[10,20,30],
      'warning':'Studied development period; no LIVE promotion.'
    }
    (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
    res=[]
    for name,cap in RECOVERY_CAPS.items():
        ACTIVE_RECOVERY_CAP=cap
        print('START',name,'recovery_cap',cap,flush=True)
        r=s.w.base.run_study(name,'10,20,30');r['research_only']=True;r['recovery_family_cap']=cap
        for sc in r['scenarios']:
            ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
            v=[x for x in ts if x['strategy_id']=='V12']
            sc['v12_details']={
              'all':detail(v),
              'first':detail([x for x in v if x['exit_ts_ms']<MID]),
              'second':detail([x for x in v if x['entry_ts_ms']>=MID]),
              'routes':{rt:detail([x for x in v if x.get('route')==rt]) for rt in sorted({x.get('route') for x in v if x.get('route')})},
            }
        (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
        res.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(res,indent=2),encoding='utf-8')
        print('DONE',name,flush=True)

if __name__=='__main__':main()
