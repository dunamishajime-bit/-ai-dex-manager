"""Research-only multi-route V12 rescue replay.

Goal: preserve more valid V12 opportunities instead of collapsing 1,123 accepted trades
to a 55-trade failed-break-only route.

Cases combine:
A) high-precision FAILED_BREAK_REV_SHORT_6H route
B) baseline continuation candidates from robust feature bands that were positive in both
   temporal halves at candidate level.

No LIVE/Production changes.
"""
import contextlib, io, json
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
    import analyze_v12_failed_break_sensitivity as sens
import run_v12_logic_dissection as s
import v12_entry_state_logic as m

ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-multiroute-rescue-20261008'
MID=s.MID
DIAG_PATH=ROOT/'docs/research/results/v12-entry-phase-20261008/entry-phase-diagnostic.jsonl'
FAILED_POOL=sens.events['WINDOW_6H']
FAILED_SELECTED=sens.select(FAILED_POOL)

def key(c):
    return (c['symbol'],c['side'],int(c['entry_ts_ms']))

DIAG=[json.loads(x) for x in DIAG_PATH.read_text(encoding='utf-8').splitlines() if x.strip()]

def rule_sets():
    out={}
    out['SHORT_BURST']={key(x) for x in DIAG if x['side']=='SHORT' and x['momentum_condition_age_h']<=96 and x['signed_ret6']>=.03}
    out['SHORT_FAST']={key(x) for x in DIAG if x['side']=='SHORT' and x['momentum_condition_age_h']<=12 and 0<=x['signed_ret6']<.015}
    out['LONG_CREEP']={key(x) for x in DIAG if x['side']=='LONG' and 0<=x['signed_ret6']<.0025}
    out['SHORT_CREEP']={key(x) for x in DIAG if x['side']=='SHORT' and .0025<=x['signed_ret6']<.005}
    out['ALL_ACCEL_EARLY']={key(x) for x in DIAG if x['momentum_condition_age_h']<=24 and .015<=x['signed_ret6']<.03 and x['distance_ema12_atr']>=1}
    out['NEG_PULLBACK']={key(x) for x in DIAG if x['momentum_condition_age_h']<=72 and x['signed_ret6']<0 and .5<=x['distance_ema12_atr']<1}
    out['ALL_BURST_EARLY']={key(x) for x in DIAG if x['momentum_condition_age_h']<=24 and x['signed_ret6']>=.03}
    return out

RULES=rule_sets()
PLANS={
    'CORE55':[],
    'RESCUE_300':['SHORT_BURST','SHORT_FAST','LONG_CREEP'],
    'RESCUE_500':['SHORT_BURST','SHORT_FAST','LONG_CREEP','SHORT_CREEP','ALL_ACCEL_EARLY'],
    'RESCUE_700':['SHORT_BURST','SHORT_FAST','LONG_CREEP','SHORT_CREEP','ALL_ACCEL_EARLY','NEG_PULLBACK','ALL_BURST_EARLY'],
}

def read_table(strategy,variant='BASELINE'):
    return s.w.frozen_read(strategy,variant)

def rescue_keys(plan):
    names=PLANS[plan]
    return set().union(*(RULES[n] for n in names)) if names else set()

def classify(k, plan):
    for name in PLANS[plan]:
        if k in RULES[name]:
            return name
    return None

def failed_candidates():
    out=[]
    for c in FAILED_SELECTED:
        x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
        if not x:
            continue
        d=s.w.base.candidate(x,'V12')
        d.update(route='FAILED_BREAK_REV_SHORT_6H',
                 entryQualityClass='ONSET_FAILED_BREAK_SHORT_6H',
                 setup_ts_ms=c['setup_ts_ms'],decision_ts_ms=c['decision_ts_ms'],
                 state_age_h=c['state_age_h'])
        out.append(d)
    return out

FAILED_CANDIDATES=None

def filt(candidates,name):
    if name=='BASELINE_Q_RET14':
        return candidates
    keep=rescue_keys(name)
    out=[]
    seen=set()
    for c in candidates:
        if c['strategy_id']!='V12':
            out.append(c)
            continue
        k=key(c)
        if k in keep:
            d=dict(c)
            d['route']='CONT_'+classify(k,name)
            d['entryQualityClass']='CONTINUATION_RESCUE'
            token=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
            if token not in seen:
                seen.add(token);out.append(d)
    for d0 in FAILED_CANDIDATES:
        d=dict(d0)
        token=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
        if token not in seen:
            seen.add(token);out.append(d)
    return out

def detail(a):
    d=s.w.stats(a)
    vals=[t['total_pnl_jpy']/(t['original_quantity']*t['entry_price'])
          for t in a if t.get('original_quantity') and t.get('entry_price')]
    d['unit_returns']=s.stat(vals)
    d['without_best_jpy']=sum(t['total_pnl_jpy'] for t in a)-max([t['total_pnl_jpy'] for t in a],default=0)
    return d

def main():
    global FAILED_CANDIDATES
    OUT.mkdir(parents=True,exist_ok=True)
    protocol={
      'research_only':True,'live_changes':False,'production_changes':False,
      'period':'2025-08-10 through 2026-08-10 UTC; previously explored, not untouched holdout',
      'goal':'Recover hundreds of V12 opportunities while retaining the high-precision failed-break SHORT route.',
      'core_route':'FAILED_BREAK_REV_SHORT_6H; unchanged from prior research.',
      'continuation_routes':{
        'SHORT_BURST':'SHORT, age<=96h, signed6h return>=3.0%',
        'SHORT_FAST':'SHORT, age<=12h, signed6h return 0..1.5%',
        'LONG_CREEP':'LONG, signed6h return 0..0.25%',
        'SHORT_CREEP':'SHORT, signed6h return 0.25..0.50%',
        'ALL_ACCEL_EARLY':'age<=24h, signed6h 1.5..3.0%, EMA12 distance>=1 ATR',
        'NEG_PULLBACK':'age<=72h, signed6h<0, EMA12 distance 0.5..1 ATR',
        'ALL_BURST_EARLY':'age<=24h, signed6h>=3.0%',
      },
      'plan_membership':PLANS,
      'selection_rule':'Each included rescue band was required to have candidate-level PF>1 in both temporal halves before integrated replay.',
      'costs_bps':[10,20,30],
      'portfolio_engine':'same integrated ownership/gross/quantity/funding/exit replay as baseline',
      'important':'This is exploratory on a studied period; do not promote to LIVE from these results alone.'
    }
    (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')

    s.w.OUT=OUT
    s.w.setup()
    FAILED_CANDIDATES=failed_candidates()
    s.w.base.read_table=read_table
    s.w.base._study_filter=filt
    results=[]
    for name in ['BASELINE_Q_RET14','CORE55','RESCUE_300','RESCUE_500','RESCUE_700']:
        print('START',name,flush=True)
        r=s.w.base.run_study(name,'10,20,30')
        r['research_only']=True
        r['raw_rescue_keys']=len(rescue_keys(name)) if name!='BASELINE_Q_RET14' else None
        r['raw_failed_break_candidates']=len(FAILED_CANDIDATES) if name!='BASELINE_Q_RET14' else None
        for sc in r['scenarios']:
            ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
            v=[x for x in ts if x['strategy_id']=='V12']
            sc['v12_details']={
              'all':detail(v),
              'first':detail([x for x in v if x['exit_ts_ms']<MID]),
              'second':detail([x for x in v if x['entry_ts_ms']>=MID]),
              'LONG':detail([x for x in v if x['side']=='LONG']),
              'SHORT':detail([x for x in v if x['side']=='SHORT']),
              'routes':{route:detail([x for x in v if x.get('route')==route]) for route in sorted({x.get('route') for x in v if x.get('route')})},
            }
        (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
        results.append(r)
        (OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print('DONE',name,flush=True)

if __name__=='__main__':
    main()
