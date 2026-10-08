"""Research-only lower rescue sizing stress.

Tests 0.15x and 0.10x uniform caps on continuation-rescue entries while preserving
FAILED_BREAK_REV_SHORT_6H sizing. Purpose: keep hundreds of V12 entries and require
V12 profitability even at 30bps modeled round-trip cost.
"""
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
    import analyze_v12_failed_break_sensitivity as sens
import run_v12_logic_dissection as s
import v12_entry_state_logic as m
import run_v12_multiroute_rescue as mr

ROOT=s.ROOT; OUT=ROOT/'docs/research/results/v12-multiroute-lowcaps-20261008'; MID=s.MID
CASES=[(f'{p}_CAP{int(c*100):02d}',p,c) for p in ['RESCUE_300','RESCUE_500','RESCUE_700'] for c in [0.15,0.10]]
MAP={n:(p,c) for n,p,c in CASES}
FAILED_SELECTED=sens.select(sens.events['WINDOW_6H'])
FAILED=None

def read_table(strategy,variant='BASELINE'): return s.w.frozen_read(strategy,variant)

def failed_candidates():
    out=[]
    for c in FAILED_SELECTED:
        x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
        if not x:continue
        d=s.w.base.candidate(x,'V12')
        d.update(route='FAILED_BREAK_REV_SHORT_6H',entryQualityClass='ONSET_FAILED_BREAK_SHORT_6H',
                 setup_ts_ms=c['setup_ts_ms'],decision_ts_ms=c['decision_ts_ms'],state_age_h=c['state_age_h'])
        out.append(d)
    return out

def filt(candidates,name):
    plan,cap=MAP[name]; keep=mr.rescue_keys(plan); out=[];seen=set()
    for c in candidates:
        if c['strategy_id']!='V12': out.append(c);continue
        k=mr.key(c)
        if k not in keep:continue
        d=dict(c);d['route']='CONT_'+mr.classify(k,plan);d['entryQualityClass']='CONTINUATION_RESCUE_CAPPED'
        d['requested_gross']=min(float(d.get('requested_gross',cap)),cap)
        token=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
        if token not in seen:seen.add(token);out.append(d)
    for d0 in FAILED:
        d=dict(d0);token=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
        if token not in seen:seen.add(token);out.append(d)
    return out

def detail(a):
    d=s.w.stats(a);vals=[t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a if t.get('original_quantity') and t.get('entry_price')]
    d['unit_returns']=s.stat(vals);d['without_best_jpy']=sum(t['total_pnl_jpy'] for t in a)-max([t['total_pnl_jpy'] for t in a],default=0)
    return d

def main():
    global FAILED
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'protocol.json').write_text(json.dumps({
      'research_only':True,'live_changes':False,'production_changes':False,
      'core_route':'FAILED_BREAK_REV_SHORT_6H unchanged sizing',
      'continuation_rescue_caps':[0.15,0.10],
      'objective':'retain hundreds of V12 entries while V12 PF remains >1 under 30bps cost stress',
      'plans':mr.PLANS,'costs_bps':[10,20,30],
      'period':'2025-08-10 through 2026-08-10 UTC; previously explored'
    },indent=2),encoding='utf-8')
    s.w.OUT=OUT;s.w.setup();FAILED=failed_candidates();s.w.base.read_table=read_table;s.w.base._study_filter=filt
    results=[]
    for name,plan,cap in CASES:
        print('START',name,flush=True)
        r=s.w.base.run_study(name,'10,20,30');r['research_only']=True;r['plan']=plan;r['rescue_cap']=cap
        for sc in r['scenarios']:
            ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');v=[x for x in ts if x['strategy_id']=='V12']
            sc['v12_details']={'all':detail(v),'first':detail([x for x in v if x['exit_ts_ms']<MID]),'second':detail([x for x in v if x['entry_ts_ms']>=MID]),
                               'LONG':detail([x for x in v if x['side']=='LONG']),'SHORT':detail([x for x in v if x['side']=='SHORT'])}
        (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8');results.append(r)
        (OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8');print('DONE',name,flush=True)

if __name__=='__main__':main()
