"""Research-only V4 recovery gross sensitivity.
Compares 0.10x and 0.125x per recovery leg on top of V4 same-direction stacking.
No LIVE/Production changes.
"""
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_multilogic_v4_stacking as v4
    import run_v12_multilogic_v3 as v3
    import run_v12_independent_sleeves as ind
    import run_v12_multilogic_recovery as ml

s=v4.s
ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-v4-sizing-20261009'
MID=s.MID

CASES={
 'V4_STACK_G0100_RCAP075':{'family_cap':.75,'gross':.10,'slots':8},
 'V4_STACK_G0125_RCAP075':{'family_cap':.75,'gross':.125,'slots':8},
}

def detail(rows):
    d=s.w.stats(rows)
    d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/3600000 for t in rows)
    return d

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'protocol.json').write_text(json.dumps({
        'research_only':True,'live_changes':False,'production_changes':False,
        'base':'V4 same-direction stacking',
        'cases':CASES,'costs_bps':[10],
        'shared_caps':{'recovery_family':.75,'V12':2.0,'crypto':3.0,'total':4.25}
    },indent=2),encoding='utf-8')

    s.w.OUT=OUT
    s.w.setup()
    v4.install_virtual_leg_study_adapter()

    v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
    s.w.base.read_table=v3.v2.read_table
    s.w.base._study_filter=v3.filt
    ind.ORIG_PATCH=s.w.base.patch_admission
    ind.ACTIVE_RECOVERY_CAP=.75
    s.w.base.patch_admission=v4.stacking_patch
    s.w.base.source_batch=ind.custom_source_batch

    results=[]
    for name,cfg in CASES.items():
        v3.CASE[name]=cfg
        print('START',name,flush=True)
        r=s.w.base.run_study(name,'10');r['research_only']=True;r['case_config']=cfg
        for sc in r['scenarios']:
            ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
            vv=[x for x in ts if x['strategy_id']=='V12']
            sc['v12_details']={
              'all':detail(vv),
              'first':detail([x for x in vv if x['exit_ts_ms']<MID]),
              'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),
              'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})},
            }
        (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
        results.append(r)
        (OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print('DONE',name,flush=True)

if __name__=='__main__':
    main()
