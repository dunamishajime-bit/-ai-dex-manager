"""Research-only marginal route study for V12 rescue architecture.
Base is RESCUE_300 at 0.10x rescue cap. Add one route family at a time.
No LIVE/Production changes.
"""
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
    import analyze_v12_failed_break_sensitivity as sens
import run_v12_logic_dissection as s
import v12_entry_state_logic as m
import run_v12_multiroute_rescue as mr

ROOT=s.ROOT; OUT=ROOT/'docs/research/results/v12-marginal-route-study-20261008'; MID=s.MID
DIAG=mr.DIAG; key=mr.key
BASE=mr.rescue_keys('RESCUE_300')
SHORT_CREEP={key(x) for x in DIAG if x['side']=='SHORT' and .0025<=x['signed_ret6']<.005}
ALL_ACCEL={key(x) for x in DIAG if x['momentum_condition_age_h']<=24 and .015<=x['signed_ret6']<.03 and x['distance_ema12_atr']>=1}
SHORT_MID={key(x) for x in DIAG if x['side']=='SHORT' and x['momentum_condition_age_h']<=72 and .005<=x['signed_ret6']<.015 and x['distance_ema12_atr']>=1}
CASES={
 'BASE300':BASE,
 'BASE300_PLUS_CREEP':BASE|SHORT_CREEP,
 'BASE300_PLUS_ACCEL':BASE|ALL_ACCEL,
 'BASE300_PLUS_SHORT_MID':BASE|SHORT_MID,
 'BASE300_PLUS_MID_CREEP':BASE|SHORT_MID|SHORT_CREEP,
}
FAILED_SELECTED=sens.select(sens.events['WINDOW_6H']); FAILED=None; CAP=.10

def read_table(strategy,variant='BASELINE'): return s.w.frozen_read(strategy,variant)

def failed_candidates():
    out=[]
    for c in FAILED_SELECTED:
        x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
        if not x: continue
        d=s.w.base.candidate(x,'V12')
        d.update(route='FAILED_BREAK_REV_SHORT_6H',entryQualityClass='ONSET_FAILED_BREAK_SHORT_6H',
                 setup_ts_ms=c['setup_ts_ms'],decision_ts_ms=c['decision_ts_ms'],state_age_h=c['state_age_h'])
        out.append(d)
    return out

def classify(k):
    if k in SHORT_MID and k not in BASE: return 'SHORT_MID'
    if k in SHORT_CREEP and k not in BASE: return 'SHORT_CREEP'
    if k in ALL_ACCEL and k not in BASE: return 'ALL_ACCEL_EARLY'
    return 'BASE300_RESCUE'

def filt(candidates,name):
    keep=CASES[name];out=[];seen=set()
    for c in candidates:
        if c['strategy_id']!='V12': out.append(c);continue
        k=key(c)
        if k not in keep: continue
        d=dict(c);d['route']='CONT_'+classify(k);d['entryQualityClass']='CONTINUATION_RESCUE_CAPPED'
        d['requested_gross']=min(float(d.get('requested_gross',CAP)),CAP)
        token=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
        if token not in seen: seen.add(token);out.append(d)
    for d0 in FAILED:
        d=dict(d0);token=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
        if token not in seen: seen.add(token);out.append(d)
    return out

def detail(a):
    d=s.w.stats(a);vals=[t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a if t.get('original_quantity') and t.get('entry_price')]
    d['unit_returns']=s.stat(vals);return d

def main():
    global FAILED
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'protocol.json').write_text(json.dumps({
      'research_only':True,'live_changes':False,'production_changes':False,
      'base':'RESCUE_300_CAP10','cap':CAP,
      'cases':{k:len(v) for k,v in CASES.items()},
      'incremental_raw_counts':{
        'SHORT_CREEP':len(SHORT_CREEP-BASE),'ALL_ACCEL_EARLY':len(ALL_ACCEL-BASE),
        'SHORT_MID':len(SHORT_MID-BASE),'SHORT_MID_PLUS_CREEP':len((SHORT_MID|SHORT_CREEP)-BASE)},
      'costs_bps':[10,20,30]
    },indent=2),encoding='utf-8')
    s.w.OUT=OUT;s.w.setup();FAILED=failed_candidates();s.w.base.read_table=read_table;s.w.base._study_filter=filt
    res=[]
    for name in CASES:
        print('START',name,flush=True)
        r=s.w.base.run_study(name,'10,20,30');r['research_only']=True;r['raw_keep_keys']=len(CASES[name])
        for sc in r['scenarios']:
            ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');v=[x for x in ts if x['strategy_id']=='V12']
            sc['v12_details']={'all':detail(v),'first':detail([x for x in v if x['exit_ts_ms']<MID]),'second':detail([x for x in v if x['entry_ts_ms']>=MID]),
             'LONG':detail([x for x in v if x['side']=='LONG']),'SHORT':detail([x for x in v if x['side']=='SHORT']),
             'routes':{rt:detail([x for x in v if x.get('route')==rt]) for rt in sorted({x.get('route') for x in v if x.get('route')})}}
        (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8');res.append(r)
        (OUT/'comparison-summary.json').write_text(json.dumps(res,indent=2),encoding='utf-8');print('DONE',name,flush=True)
if __name__=='__main__':main()
