#!/usr/bin/env python3
"""Dynamic 12h-cooldown rescreen of a frozen ORIGINAL H1 signal bank.
Each gate is applied before selecting, not applied after filling the baseline
cohort. The same symbol can enter on later candidate after a veto. 10/30bps,
stop-first M5 output from source; no position/portfolio collisions.
"""
from __future__ import annotations
import collections,json,datetime as dt
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
IN=OUT/'RENDER_2024_FRESH_LONG_SHORT_12_ENTRY_7_EXIT_SCREENER_20261024.json'
H=3600000
PERIODS={
 '2024_RNDR_JAN_MAY':('2024-01-01','2024-06-01'),
 '2024_RNDR_JUN_JUL16':('2024-06-01','2024-07-16'),
 '2024_RENDER_JUL_DEC':('2024-07-26','2025-01-01'),
 '2025_RENDER_JAN_MAR':('2025-01-01','2025-04-01'),
 '2025_RENDER_APR_JUL':('2025-04-01','2025-08-01'),
 '2025_RENDER_AUG_DEC':('2025-08-01','2026-01-01'),
 '2026_RENDER_JAN_MAR':('2026-01-01','2026-04-01'),
 '2026_RENDER_APR_AUG':('2026-04-01','2026-08-10'),
}
def ms(day):return int(dt.datetime.fromisoformat(day).replace(tzinfo=dt.timezone.utc).timestamp()*1000)
GATES={
 'UNFILTERED':lambda f:True,
 'OI3_CONTRACTION_MIN0P2':lambda f:f['oi3Pct']<=-.2,
 'OI3_CONTRACTION_MIN0P4':lambda f:f['oi3Pct']<=-.4,
 'OI3_CONTRACTION_MIN0P6':lambda f:f['oi3Pct']<=-.6,
 'OI3_CONTRACTION_MIN0P8':lambda f:f['oi3Pct']<=-.8,
 'OI3_CONTRACTION_MIN1P0':lambda f:f['oi3Pct']<=-1.0,
 'OI1_CONTRACTION_MIN0P25':lambda f:f['oi1Pct']<=-.25,
 'OI3_MIN0P4_SELLER3_MAX0P04':lambda f:f['oi3Pct']<=-.4 and f['seller3']<=.04,
 'OI3_MIN0P6_SELLER3_MAX0P04':lambda f:f['oi3Pct']<=-.6 and f['seller3']<=.04,
 'OI3_MIN0P4_SELLER3_MAX0P02':lambda f:f['oi3Pct']<=-.4 and f['seller3']<=.02,
 'OI3_MIN0P6_SELLER3_MAX0P02':lambda f:f['oi3Pct']<=-.6 and f['seller3']<=.02,
 'OI3_MIN0P4_SELLER1_MAX0P1':lambda f:f['oi3Pct']<=-.4 and f['seller1']<=.1,
 'OI3_MIN0P6_SELLER1_MAX0P1':lambda f:f['oi3Pct']<=-.6 and f['seller1']<=.1,
 'OI3_MIN0P4_WICK_MAX1P5':lambda f:f['oi3Pct']<=-.4 and f['hourWick']<=1.5,
 'OI3_MIN0P6_WICK_MAX1P5':lambda f:f['oi3Pct']<=-.6 and f['hourWick']<=1.5,
 'OI3_MIN0P4_REBOUND_MAX4':lambda f:f['oi3Pct']<=-.4 and f['priorRebound']<=4,
 'OI3_MIN0P6_REBOUND_MAX4':lambda f:f['oi3Pct']<=-.6 and f['priorRebound']<=4,
 'OI3_MIN0P6_BTC24_UP':lambda f:f['oi3Pct']<=-.6 and f['btc24']>=-1.5,
 'OI3_MIN0P6_R24_LE_NEG4':lambda f:f['oi3Pct']<=-.6 and f['ret24']<=-4,
}
def select(events,gate):
 out=[];limit=-1
 for z in events:
  if z['t']<limit or not gate(z['causalFeatures']):continue
  out.append(z)
  limit=int(z['exitModel30']['exitTs'])+12*H
 return out
def stats(rows,c):
 x=[float(z['exitModel30']['net30'])+(.30-c/100) for z in rows]
 gain=sum(v for v in x if v>0);loss=-sum(v for v in x if v<=0)
 return {'n':len(x),'wins':sum(v>0 for v in x),
   'winPct':round(100*sum(v>0 for v in x)/len(x),2) if x else None,
   'PF':round(gain/loss,4) if loss>0 else None,
   'netPctSum':round(sum(x),3),'maxLossPct':round(min(x),3) if x else None}
def main():
 j=json.loads(IN.read_text('utf8'))
 entries=sorted(j['allBenchSignalEvents'],key=lambda z:z['t'])
 assert len(entries)>=140 and len({z['t'] for z in entries})==len(entries)
 records={'status':'RESEARCH_ONLY_CAUSAL_DYNAMIC_SAME_SYMBOL_12H_COOLDOWN_NOT_NATIVE8',
 'sourceFilename':IN.name,'candidateN':len(entries),
 'periods':list(PERIODS),'researchState':'LOOKBACK_IN_SAMPLE_NOT_OOS',
 'warnings':['Thresholds explored after seeing historical returns; no untouched holdout',
             'Native shared wallet does not apply this independent signal family',
             'No material return quote or claim should be construed as LIVE or Aster fill'],
 'gates':{}}
 for key,gate in GATES.items():
  sel=[]
  for sym in ('RNDRUSDT','RENDERUSDT'):
   ev=[v for v in entries if v['symbol']==sym]
   sel.extend(select(ev,gate))
  sel.sort(key=lambda z:z['t'])
  byyear={year:{str(c):stats([x for x in sel if ms(a)<=x['t']<ms(b)],c)
           for c in (10,30)} for year,(a,b) in PERIODS.items()}
  # New sampling across the same contract but respecting changes in UTC year
  for yr,begin,end in [('2024','2024-01-01','2025-01-01'),('2025','2025-01-01','2026-01-01'),('2026','2026-01-01','2026-08-10')]:
   byyear[yr]={str(c):stats([x for x in sel if ms(begin)<=x['t']<ms(end)],c) for c in (10,30)}
  records['gates'][key]={'periods':byyear}
  x=[byyear[yr]['30'] for yr in ('2024','2025','2026')]
  print('DYNAMIC',key,'2024',x[0]['n'],x[0]['winPct'],x[0]['PF'],
   '2025',x[1]['n'],x[1]['winPct'],x[1]['PF'],
   '2026',x[2]['n'],x[2]['winPct'],x[2]['PF'],flush=True)
 records['researchThreeYearPositive']=[
  key for key,z in records['gates'].items()
  if all(z['periods'][yr]['30']['n']>=10 and
    (z['periods'][yr]['30']['PF'] or 0)>1 for yr in ('2024','2025','2026'))]
 path=OUT/'RENDER_2024_BEAR_REBOUND_NATIVE_COHORT_DYNAMIC_OI3_GATE_20261024.json'
 path.write_text(json.dumps(records,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
 print('PASS_THREE_YEAR',records['researchThreeYearPositive'],'OUTPUT',path)
if __name__=='__main__':main()
