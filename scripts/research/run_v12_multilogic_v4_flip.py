"""Research-only V4 Min-Lift + causal reversal preemption.

Base: V4 Min-Lift at 0.10x recovery gross.
Change: a new REC_Y reversal candidate may preempt opposite-side active V12 recovery
legs only when every opposing leg is REC_X* or REC_G*. Core failed-break and robust
SHORT_MID complement are never preempted. Old REC_Y also dominates new non-Y signals.

No LIVE/Production changes.
"""
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_multilogic_v4_minlift as mlift
    import run_v12_multilogic_v4_stacking as v4
    import run_v12_multilogic_v3 as v3
    import run_v12_independent_sleeves as ind
    import run_v12_multilogic_recovery as ml

s=v4.s
ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-v4-flip-20261009'
MID=s.MID

def flip_patch(source,strict):
    q=mlift.minlift_patch(source,strict)
    old='''                    same_symbol_active=[p for p in active_same_strategy if p["symbol"] == candidate["symbol"]]
                    if any(str(p.get("side")) != str(candidate.get("side")) for p in same_symbol_active):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:OPPOSITE_SYMBOL_ACTIVE", ts)
                        rejected["V12:OPPOSITE_SYMBOL_ACTIVE"] += 1
                        continue
'''
    new='''                    same_symbol_pairs=[(vp,p) for vp,p in list(active.items()) if p["strategy_id"]=="V12" and p["symbol"]==candidate["symbol"]]
                    opposite_pairs=[(vp,p) for vp,p in same_symbol_pairs if str(p.get("side")) != str(candidate.get("side"))]
                    if opposite_pairs:
                        new_route=str(candidate.get("route") or "")
                        preemptible=all(str(p.get("route") or "").startswith(("REC_X","REC_G")) for vp,p in opposite_pairs)
                        if new_route.startswith("REC_Y") and preemptible:
                            for vp,p in opposite_pairs:
                                mark=_mark(market,p["symbol"],ts)
                                if mark is None:
                                    raise ValueError(f"V12_REVERSAL_PREEMPT_MARK_MISSING:{p['symbol']}:{ts}")
                                finalize_position(vp,ts,mark,f"V12_REVERSAL_PREEMPT:{new_route}")
                            active_same_strategy=[p for p in active.values() if p["strategy_id"]==strategy]
                        else:
                            record_decision(candidate, "REJECTED_PORTFOLIO", "V12:OPPOSITE_SYMBOL_ACTIVE", ts)
                            rejected["V12:OPPOSITE_SYMBOL_ACTIVE"] += 1
                            continue
'''
    assert q.count(old)==1,q.count(old)
    return q.replace(old,new,1)

def detail(rows):
    d=s.w.stats(rows)
    d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/3600000 for t in rows)
    return d

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'protocol.json').write_text(json.dumps({
        'research_only':True,'live_changes':False,'production_changes':False,
        'base':'V4 Min-Lift 0.10x',
        'reversal_preemption':'new REC_Y may preempt opposite REC_X/REC_G only',
        'protected_routes':['FAILED_BREAK_REV_SHORT_6H','CONT_SHORT_MID_AGE24_48','REC_Y existing'],
        'recovery_family_cap':.75,'V12_cap':2.0,'crypto_cap':3.0,'total_cap':4.25,
        'costs_bps':[10]
    },indent=2),encoding='utf-8')

    s.w.OUT=OUT
    s.w.setup()
    v4.install_virtual_leg_study_adapter()

    v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
    name='V4_MINLIFT_FLIP_G0100_RCAP075'
    v3.CASE[name]={'family_cap':.75,'gross':.10,'slots':8}
    s.w.base.read_table=v3.v2.read_table
    s.w.base._study_filter=v3.filt
    ind.ORIG_PATCH=s.w.base.patch_admission
    ind.ACTIVE_RECOVERY_CAP=.75
    s.w.base.patch_admission=flip_patch
    s.w.base.source_batch=ind.custom_source_batch

    print('START',name,flush=True)
    r=s.w.base.run_study(name,'10');r['research_only']=True
    for sc in r['scenarios']:
        ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
        vv=[x for x in ts if x['strategy_id']=='V12']
        sc['v12_details']={
            'all':detail(vv),
            'first':detail([x for x in vv if x['exit_ts_ms']<MID]),
            'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),
            'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})},
        }
    (OUT/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
    print('DONE',name,flush=True)

if __name__=='__main__':
    main()
