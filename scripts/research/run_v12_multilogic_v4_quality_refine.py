"""Research-only V4 quality refinement after >1,000-trade recovery.

Tests:
A) Replace REC_G5_SLOW_TREND legacy exit with fixed 48h time exit.
B) Same G5 refinement + reduce REC_X10/REC_X14 requested gross to 0.05x.

All V4 Final1000 architecture/caps remain unchanged.
No LIVE/Production changes.
"""
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_multilogic_v4_final1000 as final
    import run_v12_multilogic_v4_flip as flip
    import run_v12_multilogic_v4_minlift as mlift
    import run_v12_multilogic_v4_stacking as v4
    import run_v12_multilogic_v3 as v3
    import run_v12_independent_sleeves as ind
    import run_v12_multilogic_recovery as ml

s=v4.s
ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-v4-quality-refine-20261009'
MID=s.MID
H=3600000

CASES={
 'REF_G5_TIME48':{'bad_gross':.10},
 'REF_G5_TIME48_X10X14_HALF':{'bad_gross':.05},
}

def patch16(source,strict):
    q=flip.flip_patch(source,strict)
    old='if len(active_same_route) >= 8:'
    assert q.count(old)==1,q.count(old)
    return q.replace(old,'if len(active_same_route) >= 16:',1)

def make_filter(name):
    cfg=CASES[name]
    def filt(candidates,case_name):
        rows=v3.filt(candidates,case_name)
        out=[]
        for c in rows:
            d=dict(c)
            if d.get('strategy_id')=='V12' and d.get('route')=='REC_G5_SLOW_TREND':
                t=int(d['entry_ts_ms'])+48*H
                b=s.w.bars.get(d['symbol'],{}).get(t)
                if b is None:
                    continue
                px=float(b['open']);sg=1 if d['side']=='LONG' else -1
                d.update(exit_ts_ms=t,exit_price=px,exit_reason='REC_G5_TIME48_REFINED',
                         unit_price_return=sg*(px/float(d['entry_price'])-1))
            if d.get('strategy_id')=='V12' and d.get('route') in {'REC_X10_TIME_48H','REC_X14_TIME_48H'}:
                d['requested_gross']=min(float(d.get('requested_gross',cfg['bad_gross'])),cfg['bad_gross'])
            out.append(d)
        return out
    return filt

def detail(rows):
    d=s.w.stats(rows)
    d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/H for t in rows)
    return d

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'protocol.json').write_text(json.dumps({
        'research_only':True,'live_changes':False,'production_changes':False,
        'base':'V4 Final1000',
        'cases':CASES,
        'G5_change':'legacy/trailing exit -> fixed 48h',
        'X10_X14_half_case':'requested gross max 0.05x',
        'caps':{'route_slots':16,'recovery_family':1.0,'minlift':.30,'V12':2.0,'crypto':3.0,'total':4.25},
        'costs_bps':[10,20,30]
    },indent=2),encoding='utf-8')

    s.w.OUT=OUT
    s.w.setup()
    v4.install_virtual_leg_study_adapter()
    final.install_final_routes()
    v3.stage3_transform=final.stage3_candidate_all
    v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED

    ind.ACTIVE_RECOVERY_CAP=1.0
    mlift.MAX_LIFT_GROSS=.30
    ind.ORIG_PATCH=s.w.base.patch_admission
    s.w.base.patch_admission=patch16
    s.w.base.source_batch=ind.custom_source_batch
    s.w.base.read_table=v3.v2.read_table

    results=[]
    for name,cfg in CASES.items():
        v3.CASE[name]={'family_cap':1.0,'gross':.10,'slots':16}
        s.w.base._study_filter=make_filter(name)
        print('START',name,flush=True)
        r=s.w.base.run_study(name,'10,20,30');r['research_only']=True;r['case_config']=cfg
        for sc in r['scenarios']:
            ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
            vv=[x for x in ts if x['strategy_id']=='V12']
            sc['v12_details']={
                'all':detail(vv),
                'first':detail([x for x in vv if x['exit_ts_ms']<MID]),
                'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),
                'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}
            }
        (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
        results.append(r)
        (OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print('DONE',name,flush=True)

if __name__=='__main__':
    main()
