"""Research-only V12 profit-accretion study.

Starts from the 55-trade FAILED_BREAK_REV_SHORT_6H core and adds only complementary
routes that previously showed positive standalone candidate evidence:
- SHORT_MID
- LONG_CREEP
- their union
Each addition is tested at 0.10x / 0.25x / 0.50x max gross.

Decision criterion: added trades must increase absolute V12 profit versus CORE55,
not merely keep aggregate PF > 1. No LIVE/Production changes.
"""
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
    import analyze_v12_failed_break_sensitivity as sens
import run_v12_logic_dissection as s
import v12_entry_state_logic as m
import run_v12_multiroute_rescue as mr

ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-profit-accretion-20261008'
MID=s.MID
DIAG=mr.DIAG
KEY=mr.key
SHORT_MID={KEY(x) for x in DIAG if x['side']=='SHORT' and x['momentum_condition_age_h']<=72 and .005<=x['signed_ret6']<.015 and x['distance_ema12_atr']>=1}
LONG_CREEP={KEY(x) for x in DIAG if x['side']=='LONG' and 0<=x['signed_ret6']<.0025}
SETS={'SHORT_MID':SHORT_MID,'LONG_CREEP':LONG_CREEP,'MID_PLUS_LONG':SHORT_MID|LONG_CREEP}
CAPS=[.10,.25,.50]
CASES=[('CORE55',None,None)]+[(f'{name}_CAP{int(cap*100):02d}',name,cap) for name in SETS for cap in CAPS]
MAP={n:(route,cap) for n,route,cap in CASES}
FAILED_SELECTED=sens.select(sens.events['WINDOW_6H'])
FAILED=None

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

def classify(k,name):
    if name=='SHORT_MID': return 'SHORT_MID'
    if name=='LONG_CREEP': return 'LONG_CREEP'
    if k in SHORT_MID: return 'SHORT_MID'
    if k in LONG_CREEP: return 'LONG_CREEP'
    return 'UNKNOWN'

def filt(candidates,name):
    route,cap=MAP[name]
    out=[];seen=set()
    # Keep non-V12 unchanged; remove all baseline V12 unless selected as complementary.
    for c in candidates:
        if c['strategy_id']!='V12':
            out.append(c);continue
        if route is None: continue
        k=KEY(c)
        if k not in SETS[route]: continue
        d=dict(c)
        d['route']='CONT_'+classify(k,route)
        d['entryQualityClass']='PROFIT_ACCRETIVE_COMPLEMENT'
        d['requested_gross']=min(float(d.get('requested_gross',cap)),cap)
        tok=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
        if tok not in seen:
            seen.add(tok);out.append(d)
    for d0 in FAILED:
        d=dict(d0);tok=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
        if tok not in seen:
            seen.add(tok);out.append(d)
    return out

def detail(a):
    d=s.w.stats(a)
    vals=[t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a if t.get('original_quantity') and t.get('entry_price')]
    d['unit_returns']=s.stat(vals)
    d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/3600000 for t in a)
    return d

def main():
    global FAILED
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'protocol.json').write_text(json.dumps({
      'research_only':True,'live_changes':False,'production_changes':False,
      'core':'FAILED_BREAK_REV_SHORT_6H',
      'complements':{'SHORT_MID':len(SHORT_MID),'LONG_CREEP':len(LONG_CREEP),'union':len(SHORT_MID|LONG_CREEP)},
      'caps':CAPS,'costs_bps':[10,20,30],
      'decision_rule':'A complement is useful only if it increases absolute V12 net profit versus CORE55 and remains robust enough across costs/temporal halves.',
      'period':'2025-08-10 through 2026-08-10 UTC; studied development period'
    },indent=2),encoding='utf-8')
    s.w.OUT=OUT;s.w.setup();FAILED=failed_candidates();s.w.base.read_table=read_table;s.w.base._study_filter=filt
    results=[]
    for name,route,cap in CASES:
        print('START',name,flush=True)
        r=s.w.base.run_study(name,'10,20,30');r['research_only']=True;r['complement']=route;r['cap']=cap
        for sc in r['scenarios']:
            ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');v=[x for x in ts if x['strategy_id']=='V12']
            sc['v12_details']={
              'all':detail(v),'first':detail([x for x in v if x['exit_ts_ms']<MID]),
              'second':detail([x for x in v if x['entry_ts_ms']>=MID]),
              'LONG':detail([x for x in v if x['side']=='LONG']),'SHORT':detail([x for x in v if x['side']=='SHORT']),
              'routes':{rt:detail([x for x in v if x.get('route')==rt]) for rt in sorted({x.get('route') for x in v if x.get('route')})}
            }
        (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8');results.append(r)
        (OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print('DONE',name,flush=True)

if __name__=='__main__':main()
