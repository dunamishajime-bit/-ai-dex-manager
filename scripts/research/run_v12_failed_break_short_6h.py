"""Integrated replay of the causally motivated 6h failed-break reversal SHORT variant.
Research-only; imports the locked sensitivity builder and uses WINDOW_6H events.
"""
import contextlib, io, json
with contextlib.redirect_stdout(io.StringIO()):
    import analyze_v12_failed_break_sensitivity as sens
import run_v12_logic_dissection as s
import v12_entry_state_logic as m

OUT=s.ROOT/'docs/research/results/v12-failed-break-short-6h-20261008'
MID=s.MID
POOL=sens.events['WINDOW_6H']
SELECTED=sens.select(POOL)

def read_table(strategy,variant='BASELINE'):
    return s.w.frozen_read(strategy,variant)

def filt(candidates,name):
    if name=='BASELINE_Q_RET14':
        return candidates
    out=[c for c in candidates if c['strategy_id']!='V12']
    for c in SELECTED:
        x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
        if not x: continue
        d=s.w.base.candidate(x,'V12')
        d.update(route='FAILED_BREAK_REV_SHORT_6H',entryQualityClass='ONSET_FAILED_BREAK_SHORT_6H',
                 setup_ts_ms=c['setup_ts_ms'],decision_ts_ms=c['decision_ts_ms'],
                 state_age_h=c['state_age_h'])
        out.append(d)
    return out

def detail(a):
    d=s.w.stats(a)
    vals=[t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a if t.get('original_quantity') and t.get('entry_price')]
    d['unit_returns']=s.stat(vals)
    d['without_best_jpy']=sum(t['total_pnl_jpy'] for t in a)-max([t['total_pnl_jpy'] for t in a],default=0)
    return d

OUT.mkdir(parents=True,exist_ok=True)
protocol={
 'research_only':True,'live_changes':False,
 'variant':'FAILED_BREAK_REV_SHORT with maximum state age 6h',
 'rationale':'Independent entry-age diagnosis found edge concentrated in <=6h; 8-12h collapsed. Threshold-neighborhood study showed 6h remained profitable in both time halves and at 30bps.',
 'entry':'Fresh upward 45-H2 +2.27% momentum onset + confirmation/breakout; within <=6h the breakout closes back below level by >=0.15ATR with opposite CLV>=0.65 and body>=0.20ATR; enter SHORT next H1 open.',
 'exit':'Legacy V12 46h exit retained to isolate entry.',
 'costs_bps':[10,20,30],
 'period':'2025-08-10 through 2026-08-10 UTC; previously explored, not untouched holdout'
}
(OUT/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
s.w.OUT=OUT;s.w.setup();s.w.base.read_table=read_table;s.w.base._study_filter=filt
results=[]
for name in ['BASELINE_Q_RET14','FAILED_BREAK_REV_SHORT_6H']:
    print('START',name,flush=True)
    r=s.w.base.run_study(name,'10,20,30');r['research_only']=True
    for sc in r['scenarios']:
        ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
        v=[x for x in ts if x['strategy_id']=='V12']
        sc['v12_details']={
          'all':detail(v),
          'first':detail([x for x in v if x['exit_ts_ms']<MID]),
          'second':detail([x for x in v if x['entry_ts_ms']>=MID])
        }
    (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
    results.append(r)
    (OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print('DONE',name,flush=True)
