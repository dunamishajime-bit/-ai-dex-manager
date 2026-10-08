"""Research-only causal freshness gate for V12 persistent 90h momentum entries.

Hypothesis locked from entry-phase diagnosis: the persistent 45xH2 momentum condition
loses edge quickly after first becoming true. This script does not alter LIVE code.
It only keeps existing baseline V12 candidates whose causal condition age is <= 6h,
then replays the same integrated portfolio engine at 10/20/30 bps.
"""
import json, pathlib
import run_v12_logic_dissection as s

ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-freshness-gate-20261008'
H=s.H
MID=s.MID
ACTIVE='BASELINE'
FRESH=set()
AGE_BY_KEY={}

def ckey(c):
    return (c['symbol'],c['side'],int(c['entry_ts_ms']))

def load_age():
    global FRESH,AGE_BY_KEY
    p=ROOT/'docs/research/results/v12-entry-phase-20261008/entry-phase-diagnostic.jsonl'
    rows=[json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
    AGE_BY_KEY={ckey(x):int(x['momentum_condition_age_h']) for x in rows}
    FRESH={k for k,v in AGE_BY_KEY.items() if v<=6}
    def stat(z):
        vals=[x['exit_net10'] for x in z]; n=len(vals)
        pos=sum(max(x,0) for x in vals); neg=-sum(min(x,0) for x in vals)
        return {'n':n,'win_rate':sum(x>0 for x in vals)/n if n else None,
                'pf':pos/neg if neg else None,'mean':sum(vals)/n if n else None,
                'sum':sum(vals),'without_best':sum(vals)-max(vals,default=0)}
    bins=[('AGE_0_6',0,6),('AGE_8_12',8,12),('AGE_14_24',14,24),
          ('AGE_26_48',26,48),('AGE_50_96',50,96)]
    d={}
    for name,lo,hi in bins:
        z=[x for x in rows if lo<=int(x['momentum_condition_age_h'])<=hi]
        d[name]={'all':stat(z),
                 'LONG':stat([x for x in z if x['side']=='LONG']),
                 'SHORT':stat([x for x in z if x['side']=='SHORT'])}
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'age-bucket-diagnostic.json').write_text(json.dumps(d,indent=2),encoding='utf-8')
    return rows

def read_table(strategy,variant='BASELINE'):
    return s.w.frozen_read(strategy,variant)

def filt(candidates,name):
    if name=='BASELINE_Q_RET14':
        return candidates
    assert name=='FRESH_LE6'
    out=[]
    for c in candidates:
        if c['strategy_id']!='V12' or ckey(c) in FRESH:
            out.append(c)
    return out

def stats(a):
    d=s.w.stats(a)
    vals=[t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a
          if t.get('original_quantity') and t.get('entry_price')]
    d['unit_returns']=s.stat(vals)
    d['net_without_best_jpy']=sum(t['total_pnl_jpy'] for t in a)-max([t['total_pnl_jpy'] for t in a],default=0)
    return d

def main():
    rows=load_age()
    protocol={
        'research_only':True,
        'live_changes':False,
        'period':'2025-08-10 through 2026-08-10 UTC; previously explored, not untouched holdout',
        'hypothesis':'Existing V12 persistent 90h momentum entries retain only candidates whose causal consecutive threshold age is <=6h.',
        'age_definition':'At each existing V12 entry, count consecutive completed H2 observations where side-adjusted 45-H2 return >=2.27%; current qualifying H2 contributes 2h; capped at 96h.',
        'locked_gate':'momentum_condition_age_h <= 6',
        'entry_exit_sizing':'No entry price shift. Existing V12 entry, exit, sizing, win-rate gates and all non-V12 streams unchanged. Only stale V12 candidates are removed.',
        'costs_bps':[10,20,30],
        'why_6h':'Prespecified from phase diagnosis: 0-6h bucket was positive while 8-12h sharply negative. This is exploratory and requires forward/holdout validation before adoption.'
    }
    (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
    s.w.OUT=OUT
    s.w.setup()
    s.w.base.read_table=read_table
    s.w.base._study_filter=filt
    results=[]
    for name in ['BASELINE_Q_RET14','FRESH_LE6']:
        print('START',name,flush=True)
        r=s.w.base.run_study(name,'10,20,30')
        r['research_only']=True
        r['fresh_keys']=len(FRESH) if name=='FRESH_LE6' else None
        for sc in r['scenarios']:
            p=OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl'
            ts=s.rows(p)
            v=[t for t in ts if t['strategy_id']=='V12']
            sc['v12_details']={
                'all':stats(v),
                'first':stats([t for t in v if t['exit_ts_ms']<MID]),
                'second':stats([t for t in v if t['entry_ts_ms']>=MID]),
                'LONG':stats([t for t in v if t['side']=='LONG']),
                'SHORT':stats([t for t in v if t['side']=='SHORT'])
            }
        (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
        results.append(r)
        (OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print('DONE',name,flush=True)
    print('FRESH_KEYS',len(FRESH),'DIAG_ROWS',len(rows),flush=True)

if __name__=='__main__':
    main()
