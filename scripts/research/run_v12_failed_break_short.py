"""Validate failed-break reversal SHORT branch across time halves/costs, then integrated replay."""
import json, sys
import run_v12_onset_state_machine as sm
import run_v12_logic_dissection as s
import run_v12_entry_phase as ep
import v12_entry_state_logic as m

OUT=s.ROOT/'docs/research/results/v12-failed-break-short-20261008'
MID=s.MID

def stat(xs,cost):
    vals=[x['unit_gross_return']-cost/10000 for x in xs]
    return s.stat(vals)

def prepare():
    _,ordered,maps=ep.prepare()
    pools=sm.build(ordered,maps)
    selected=[c for c in sm.select(pools['ALL'],['FAILED_BREAK_REV']) if c['side']=='SHORT']
    trades=[]
    for c in selected:
        x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
        if x: trades.append(x)
    return selected,trades

def screen():
    OUT.mkdir(parents=True,exist_ok=True)
    selected,trades=prepare()
    d={'selected':len(selected)}
    groups={
      'all':trades,
      'first':[x for x in trades if x['exit_ts_ms']<MID],
      'second':[x for x in trades if x['entry_ts_ms']>=MID],
    }
    d['groups']={k:{str(c):stat(v,c) for c in [10,20,30]} for k,v in groups.items()}
    (OUT/'screen.json').write_text(json.dumps(d,indent=2),encoding='utf-8')
    print(json.dumps(d,indent=2))

def integrated():
    OUT.mkdir(parents=True,exist_ok=True)
    selected,trades=prepare()
    keys={(c['symbol'],c['side'],c['entry_ts_ms']) for c in selected}
    def read_table(strategy,variant='BASELINE'): return s.w.frozen_read(strategy,variant)
    def filt(candidates,name):
        if name=='BASELINE_Q_RET14': return candidates
        out=[c for c in candidates if c['strategy_id']!='V12']
        for c in selected:
            x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
            if not x: continue
            d=s.w.base.candidate(x,'V12')
            d.update(route='FAILED_BREAK_REV_SHORT',entryQualityClass='ONSET_FAILED_BREAK_SHORT',
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
    protocol={
      'research_only':True,'live_changes':False,
      'branch':'FAILED_BREAK_REV entries whose output side is SHORT only',
      'economic_interpretation':'Fresh upward 90h momentum onset breaks prior structure, then fails back below the breakout level within 2-8h with opposite close-location confirmation; enter SHORT next H1 open.',
      'exit':'Legacy V12 46h exit retained to isolate entry.',
      'costs_bps':[10,20,30],
      'period':'2025-08-10 through 2026-08-10 UTC; previously explored, not untouched holdout'
    }
    (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
    s.w.OUT=OUT;s.w.setup();s.w.base.read_table=read_table;s.w.base._study_filter=filt
    results=[]
    for name in ['BASELINE_Q_RET14','FAILED_BREAK_REV_SHORT']:
        print('START',name,flush=True)
        r=s.w.base.run_study(name,'10,20,30');r['research_only']=True
        for sc in r['scenarios']:
            ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
            v=[x for x in ts if x['strategy_id']=='V12']
            sc['v12_details']={
              'all':detail(v),
              'first':detail([x for x in v if x['exit_ts_ms']<MID]),
              'second':detail([x for x in v if x['entry_ts_ms']>=MID]),
            }
        (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
        results.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print('DONE',name,flush=True)

if __name__=='__main__':
    {'screen':screen,'run':integrated}[sys.argv[1] if len(sys.argv)>1 else 'screen']()
