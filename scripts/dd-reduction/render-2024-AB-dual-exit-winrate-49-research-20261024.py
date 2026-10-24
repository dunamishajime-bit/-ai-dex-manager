#!/usr/bin/env python3
"""RESEARCH ONLY 2024 RENDER A/B dual entry: independently change A/B exits.
Replay 7x7 published exit policies on the original 263 causal H1 signal
events, using official Binance M5 and never splicing expired RNDR to RENDER.
Dynamic cooldown is recomputed for every option. 10/30 bps and annual OOS
proxies evaluated BEFORE any Native8 deployment; no live orders.
"""
from __future__ import annotations
import bisect,collections,datetime as dt,json
from pathlib import Path
from importlib import util
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
def load(name,path):
    spec=util.spec_from_file_location(name,path)
    mod=util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
orig=load('r24exit_source',HERE/'render-2024-directional-long-short-search-20261024.py')
CASE=OUT/'RENDER_2024_FRESH_LONG_SHORT_12_ENTRY_7_EXIT_SCREENER_20261024.json'
A='SHORT_2024_BTC_RALLY_FAILURE';B='SHORT_BEAR_REBOUND_2H_FADE'
start={'2024':orig.e.ms('2024-01-01'),'2025':orig.e.ms('2025-01-01'),'2026':orig.e.ms('2026-01-01')}
end={'2024':orig.e.ms('2025-01-01'),'2025':orig.e.ms('2026-01-01'),'2026':orig.e.ms('2026-08-10')}
subperiods={'24_RNDR_JAN_MAY':(orig.e.ms('2024-01-01'),orig.e.ms('2024-06-01')),
 '24_RNDR_JUN_JUL':(orig.e.ms('2024-06-01'),orig.b.OLD_EXPIRY),
 '24_RENDER_JUL_DEC':(orig.b.NEW_START,orig.e.ms('2025-01-01')),
 '25_JAN_MAR':(orig.e.ms('2025-01-01'),orig.e.ms('2025-04-01')),
 '25_APR_JUL':(orig.e.ms('2025-04-01'),orig.e.ms('2025-08-01')),
 '25_AUG_DEC':(orig.e.ms('2025-08-01'),orig.e.ms('2026-01-01')),
 '26_JAN_MAR':(orig.e.ms('2026-01-01'),orig.e.ms('2026-04-01')),
 '26_APR_AUG':(orig.e.ms('2026-04-01'),orig.e.ms('2026-08-10'))}
def make_bank():
    inp=json.loads(CASE.read_text('utf8'))
    sample=inp['dualShortResearchSignalEvents']
    ep=orig.source()
    base={}
    for bars,_btc,_oi,_fund,sym,_cut in ep:
        tim=[int(r[0]) for r in bars]
        base[sym]=(bars,tim)
        print('DATA',sym,'BARS',len(bars),tim[0],tim[-1],flush=True)
    out=[]
    for row in sample:
        sym=row['symbol'];t=int(row['t'])
        bars,tim=base[sym]
        i=bisect.bisect_left(tim,t)-1
        assert i>0 and int(tim[i])+orig.M5==t and int(tim[i+1])==t,(sym,t,i)
        outcomes={}
        for policy,contract in orig.EXITS.items():
            outcomes[policy]=orig.simulate(bars,i,'SHORT',contract)
        out.append({'t':t,'symbol':sym,'signals':row['signals'],
          'f':row['causalFeatures'],'outcomes':outcomes})
    assert len(out)==263
    return out
def pick(rows,aexit,bexit,oi=-.2):
    chosen=[]
    for sym in ('RNDRUSDT','RENDERUSDT'):
        elig=[x for x in rows if x['symbol']==sym]
        free=0
        for x in elig:
            if x['t']<free:continue
            if A in x['signals']:
                route='A';policy=aexit
            elif B in x['signals'] and x['f']['oi3Pct']<=oi:
                route='B';policy=bexit
            else:continue
            ex=x['outcomes'][policy]
            chosen.append({'t':x['t'],'symbol':sym,'route':route,
              'exit':ex,'f':x['f']})
            free=int(ex['exitTs'])+12*orig.HOUR
    chosen.sort(key=lambda x:x['t'])
    return chosen
def stat(rows,cost):
    r=[float(x['exit']['net30'])+(.30-cost/100) for x in rows]
    wins=sum(x>0 for x in r)
    gain=sum(x for x in r if x>0)
    loss=-sum(x for x in r if x<=0)
    return {'n':len(rows),'wins':wins,
      'wr':round(100*wins/len(rows),3) if rows else None,
      'pf':round(gain/loss,4) if loss else None,
      'sumNetPct':round(sum(r),3),
      'byExpert':dict(collections.Counter(x['route'] for x in rows))}
def main():
    rows=make_bank()
    cases={}
    for aa in orig.EXITS:
        for bb in orig.EXITS:
            sel=pick(rows,aa,bb)
            key=aa+'__'+bb
            cases[key]={'exitA':aa,'exitB':bb,
             'year':{year:{str(cost):stat(
               [x for x in sel if start[year]<=x['t']<end[year]],cost)
                   for cost in (10,30)} for year in start},
             'periods':{period:{str(cost):stat(
               [x for x in sel if s<=x['t']<e],cost)
                   for cost in (10,30)} for period,(s,e) in subperiods.items()}}
    base='TAKE40_STOP30_H24__TAKE40_STOP30_H24'
    assert cases[base]['year']['2024']['30']['n']==69
    assert abs(cases[base]['year']['2024']['30']['wr']-55.072)<.01
    shortlist=[]
    for key,cs in cases.items():
        records=[cs['year'][yr]['30'] for yr in ('2024','2025','2026')]
        if all(x['n']>=n and (x['pf'] or 0)>1 for x,n in zip(records,(60,38,22))):
            shortlist.append((key,records))
    shortlist.sort(key=lambda row:(
     -min(z['pf'] for z in row[1]),
     -row[1][0]['wr'],
     -row[1][0]['n']))
    qualified=[
     key for key,cs in cases.items()
     if cs['year']['2024']['30']['n']>=60
     and cs['year']['2024']['30']['wr']>=65
     and all(cs['year'][yr]['30']['n']>=num and (cs['year'][yr]['30']['pf'] or 0)>1
       for yr,num in [('2025',38),('2026',22)])]
    print('BASELINE',cases[base]['year'],flush=True)
    print('QUALIFIED_WR65',qualified,'N',len(qualified),flush=True)
    for key,records in shortlist[:15]:
        print('SHORTLIST',key,[(q['n'],q['wr'],q['pf']) for q in records],flush=True)
    output={'status':'RESEARCH_ONLY_2024_A_B_EXIT_SEPARATE_49_NATIVE_MARKET_M5',
      'contracts':['RNDR pre-expiry','RENDER post-listing'],
      'costsBps':[10,30],
      'searchCount':len(cases),
      'warnings':['Performance exploratory. No pristine holdout after search.',
        'No Native8 shared-wallet profit/DC/margin parity for changed exits',
        'Original A/B H1 signal bank; new 2024 entries must be separately validated',
        'No Aster signed venue execution, partial fills or LIVE change'],
      'baseKey':base,'qualifiedWr65Candidates':qualified,
      'cases':cases}
    dest=OUT/'RENDER_2024_A_B_EXITS_49_CAUSAL_WINRATE_RESCREEN_20261024.json'
    dest.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('DONE',dest,'CASES',len(cases),flush=True)
if __name__=='__main__':main()
