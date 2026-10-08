"""Research-only V4 Extended candidate integration.

Adds stage-3 extended routes 13-18 to the V4 best capacity configuration.
These were discovered only because the original stage-3 search stopped at ~1,050 raw
candidates. Routes with observed second-half failure in later extended steps are excluded.

Config:
- same-direction V12 virtual legs
- Min-Lift max 0.30x
- REC_Y reversal preemption only
- 16 route slots
- recovery family cap 1.00x
- recovery trade gross 0.10x
- V12/crypto/total caps unchanged
No LIVE/Production changes.
"""
import contextlib,io,json,re
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_multilogic_v4_flip as flip
    import run_v12_multilogic_v4_minlift as mlift
    import run_v12_multilogic_v4_stacking as v4
    import run_v12_multilogic_v3 as v3
    import run_v12_independent_sleeves as ind
    import run_v12_multilogic_recovery as ml

s=v4.s
ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-v4-extended-20261009'
MID=s.MID
H=3600000
EXT=ROOT/'docs/research/results/v12-recovery-stage3-extended-20261009/selected-stage3-routes-extended.json'

def install_extended_routes():
    rows=json.load(open(EXT,encoding='utf-8'))
    # Original V3 uses 1-12. Add 13-18 only.
    added=0
    for idx in range(12,18):
        meta=rows[idx]
        exit_name=meta['exit']
        prefix='REC_Y' if exit_name.startswith('REV_') else 'REC_Z'
        route=f'{prefix}{idx+1:02d}_{exit_name}'
        v3.STAGE3_META[route]=meta
        for k in meta['inc_keys']:
            v3.STAGE3_ASSIGN[(k[0],k[1],int(k[2]))]=route
            added+=1
    return added

def extended_stage3_candidate(c,route,gross):
    spec=v3.STAGE3_META[route]['exit']
    m=re.fullmatch(r'(REV|ORIG)_D(\d+)_T(\d+)',spec)
    if not m:
        raise ValueError('UNSUPPORTED_EXT_EXIT:'+spec)
    mode=m.group(1);delay=int(m.group(2));hold=int(m.group(3))
    x=dict(c);original_side=x['side']
    if mode=='REV':
        new_side='SHORT' if original_side=='LONG' else 'LONG'
        eq='MULTILOGIC_V3_REVERSAL'
    else:
        new_side=original_side
        eq='MULTILOGIC_V3_DELAYED_ORIGINAL'
    orig_entry=int(x['entry_ts_ms'])
    entry_ts=orig_entry+delay*H
    eb=s.w.bars.get(x['symbol'],{}).get(entry_ts)
    if eb is None:return None
    entry_price=float(eb['open'])
    exit_ts=entry_ts+hold*H
    xb=s.w.bars.get(x['symbol'],{}).get(exit_ts)
    if xb is None:return None
    exit_price=float(xb['open'])
    sg=1 if new_side=='LONG' else -1
    x.update(
        side=new_side,entry_ts_ms=entry_ts,entry_price=entry_price,
        exit_ts_ms=exit_ts,exit_price=exit_price,exit_reason=spec,
        unit_price_return=sg*(exit_price/entry_price-1),route=route,
        entryQualityClass=eq,rank=9,
        source_v12_side=original_side,source_v12_entry_ts_ms=orig_entry,
    )
    x['requested_gross']=min(float(x.get('requested_gross',gross)),gross)
    return x

def patch16(source,strict):
    q=flip.flip_patch(source,strict)
    old='if len(active_same_route) >= 8:'
    assert q.count(old)==1,q.count(old)
    return q.replace(old,'if len(active_same_route) >= 16:',1)

def detail(rows):
    d=s.w.stats(rows)
    d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/H for t in rows)
    return d

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    added=install_extended_routes()
    v3.stage3_candidate=extended_stage3_candidate
    (OUT/'protocol.json').write_text(json.dumps({
        'research_only':True,'live_changes':False,'production_changes':False,
        'base':'V4 best capacity',
        'extended_routes':'stage3 routes 13-18',
        'extended_raw_keys_added':added,
        'excluded_extended_routes':'20 and 22 failed second-half check; later routes not needed initially',
        'config':{'slots':16,'family_cap':1.0,'lift_cap':.30,'gross':.10},
        'unchanged_caps':{'V12':2.0,'crypto':3.0,'total':4.25},
        'costs_bps':[10]
    },indent=2),encoding='utf-8')

    s.w.OUT=OUT
    s.w.setup()
    v4.install_virtual_leg_study_adapter()
    v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED

    name='V4_EXT_S16_F100_L030_G010'
    v3.CASE[name]={'family_cap':1.0,'gross':.10,'slots':16}
    ind.ACTIVE_RECOVERY_CAP=1.0
    mlift.MAX_LIFT_GROSS=.30
    s.w.base.read_table=v3.v2.read_table
    s.w.base._study_filter=v3.filt
    ind.ORIG_PATCH=s.w.base.patch_admission
    s.w.base.patch_admission=patch16
    s.w.base.source_batch=ind.custom_source_batch

    print('START',name,'added',added,flush=True)
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
