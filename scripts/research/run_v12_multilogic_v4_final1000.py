"""Research-only V4 final extension toward >1,000 V12 trades.

Adds only two previously validated extended routes:
- route 19: REV_D1_TP2_SL1_H36
- route 21: ORIG_D2_TP1_SL1_H24
Both had positive first/second-half evidence and strong 20bps candidate PF.
Routes 20/22 remain excluded due second-half failure.

Base configuration remains V4 best capacity:
slots16 / recovery family 1.00x / Min-Lift 0.30x / trade gross 0.10x.
No LIVE/Production changes.
"""
import contextlib,io,json,re
with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_multilogic_v4_extended as ext
    import run_v12_multilogic_v4_flip as flip
    import run_v12_multilogic_v4_minlift as mlift
    import run_v12_multilogic_v4_stacking as v4
    import run_v12_multilogic_v3 as v3
    import run_v12_independent_sleeves as ind
    import run_v12_multilogic_recovery as ml

s=v4.s
ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-v4-final1000-20261009'
MID=s.MID
H=3600000
EXT=ROOT/'docs/research/results/v12-recovery-stage3-extended-20261009/selected-stage3-routes-extended.json'

def install_final_routes():
    # Install already-approved extended routes 13-18.
    ext.install_extended_routes()
    rows=json.load(open(EXT,encoding='utf-8'))
    added=0
    for idx in (18,20):  # human route numbers 19 and 21
        meta=rows[idx]
        exit_name=meta['exit']
        prefix='REC_Y' if exit_name.startswith('REV_') else 'REC_Z'
        route=f'{prefix}{idx+1:02d}_{exit_name}'
        v3.STAGE3_META[route]=meta
        for k in meta['inc_keys']:
            v3.STAGE3_ASSIGN[(k[0],k[1],int(k[2]))]=route
            added+=1
    return added

def stage3_candidate_all(c,route,gross):
    spec=v3.STAGE3_META[route]['exit']
    # Time exits (existing routes 1-18).
    if re.fullmatch(r'(REV|ORIG)_D\d+_T\d+',spec):
        return ext.extended_stage3_candidate(c,route,gross)

    m=re.fullmatch(r'(REV|ORIG)_D(\d+)_TP([\d.]+)_SL([\d.]+)_H(\d+)',spec)
    if not m:
        raise ValueError('UNSUPPORTED_STAGE3_EXIT:'+spec)

    mode=m.group(1); delay=int(m.group(2))
    tp=float(m.group(3)); sl=float(m.group(4)); hold=int(m.group(5))
    x=dict(c)
    original_side=x['side']
    new_side=('SHORT' if original_side=='LONG' else 'LONG') if mode=='REV' else original_side
    orig_entry=int(x['entry_ts_ms'])
    entry_ts=orig_entry+delay*H
    eb=s.w.bars.get(x['symbol'],{}).get(entry_ts)
    if eb is None:return None
    entry_price=float(eb['open'])
    aa=v3.v2.atr_at(x['symbol'],entry_ts)
    if aa is None:return None
    sg=1 if new_side=='LONG' else -1
    tp_px=entry_price+sg*tp*aa
    sl_px=entry_price-sg*sl*aa
    exit_ts=None;exit_price=None;exit_reason=None
    for h in range(hold):
        t=entry_ts+h*H
        b=s.w.bars.get(x['symbol'],{}).get(t)
        if b is None:return None
        hi=float(b['high']);lo=float(b['low']);op=float(b['open'])
        hit_sl=(lo<=sl_px if sg==1 else hi>=sl_px)
        hit_tp=(hi>=tp_px if sg==1 else lo<=tp_px)
        if hit_sl:
            exit_price=min(sl_px,op) if sg==1 else max(sl_px,op)
            exit_ts=t+H;exit_reason=spec+'_STOP';break
        if hit_tp:
            exit_price=tp_px;exit_ts=t+H;exit_reason=spec+'_TP';break
    if exit_ts is None:
        exit_ts=entry_ts+hold*H
        b=s.w.bars.get(x['symbol'],{}).get(exit_ts)
        if b is None:return None
        exit_price=float(b['open']);exit_reason=spec+'_TIME'

    x.update(
        side=new_side,entry_ts_ms=entry_ts,entry_price=entry_price,
        exit_ts_ms=exit_ts,exit_price=exit_price,exit_reason=exit_reason,
        unit_price_return=sg*(exit_price/entry_price-1),
        route=route,
        entryQualityClass='MULTILOGIC_V4_FINAL_EXTENSION',
        rank=9,source_v12_side=original_side,source_v12_entry_ts_ms=orig_entry,
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
    added=install_final_routes()
    v3.stage3_transform=stage3_candidate_all

    (OUT/'protocol.json').write_text(json.dumps({
        'research_only':True,'live_changes':False,'production_changes':False,
        'base':'V4 extended 997-trade result',
        'new_routes':['19 REV_D1_TP2_SL1_H36','21 ORIG_D2_TP1_SL1_H24'],
        'new_raw_keys':added,
        'excluded':['20 second-half failed','22 second-half failed'],
        'config':{'slots':16,'family_cap':1.0,'lift_cap':.30,'gross':.10},
        'caps':{'V12':2.0,'crypto':3.0,'total':4.25},
        'costs_bps':[10,20,30],
    },indent=2),encoding='utf-8')

    s.w.OUT=OUT
    s.w.setup()
    v4.install_virtual_leg_study_adapter()
    v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED

    name='V4_FINAL1000_S16_F100_L030_G010'
    v3.CASE[name]={'family_cap':1.0,'gross':.10,'slots':16}
    ind.ACTIVE_RECOVERY_CAP=1.0
    mlift.MAX_LIFT_GROSS=.30
    s.w.base.read_table=v3.v2.read_table
    s.w.base._study_filter=v3.filt
    ind.ORIG_PATCH=s.w.base.patch_admission
    s.w.base.patch_admission=patch16
    s.w.base.source_batch=ind.custom_source_batch

    print('START',name,'newkeys',added,flush=True)
    r=s.w.base.run_study(name,'10,20,30');r['research_only']=True
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
