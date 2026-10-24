#!/usr/bin/env python3
"""Dual new causal SHORT signal experts and frozen native B coexistence audit.

Two independent new H1 entry families: 2024-style BTC rally failure SHORT,
2026-weak-regime bear rebound SHORT with declining 3h OI. These two are
reselected dynamically with same-symbol 12h cooldown (no fabricated fills).
The third route is the established native-8 B side, PRESERVED unchanged:
24 already-selected native trades are only compared for temporal collisions;
they are NOT re-simulated as a fabricated integrated venue wallet.

10/30bps, M5 next-open stop-first, same exit contract TP4% SL3% H24.
"""
from __future__ import annotations
import collections,datetime as dt,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
IN=OUT/'RENDER_2024_FRESH_LONG_SHORT_12_ENTRY_7_EXIT_SCREENER_20261024.json'
NATIVE=ROOT/'docs/research/results/render-orderflow-20261024/RENDER_NATIVE_SELECTED24_OI_FLOW_ATTRIBUTION_20261024.json'
H=3600000
TRAP='SHORT_2024_BTC_RALLY_FAILURE'
FADE='SHORT_BEAR_REBOUND_2H_FADE'
PERIODS=[
 ('2024_RNDR_JAN_MAY','2024-01-01','2024-06-01'),
 ('2024_RNDR_JUN_JUL16','2024-06-01','2024-07-16'),
 ('2024_RENDER_JUL_DEC','2024-07-26','2025-01-01'),
 ('2025_RENDER_JAN_MAR','2025-01-01','2025-04-01'),
 ('2025_RENDER_APR_JUL','2025-04-01','2025-08-01'),
 ('2025_RENDER_AUG_DEC','2025-08-01','2026-01-01'),
 ('2026_RENDER_JAN_MAR','2026-01-01','2026-04-01'),
 ('2026_RENDER_APR_AUG','2026-04-01','2026-08-10'),
 ('2024','2024-01-01','2025-01-01'),
 ('2025','2025-01-01','2026-01-01'),
 ('2026','2026-01-01','2026-08-10')]
def ms(day):return int(dt.datetime.fromisoformat(day).replace(tzinfo=dt.timezone.utc).timestamp()*1000)
CONFIGS={
 'A_2024_BTC_TRAP_ONLY':(None,None,'trap'),
 'B_BEARFADE_OI3_LE_M0P2_ONLY':(-.2,None,'fade'),
 'B_BEARFADE_OI3_LE_M0P6_ONLY':(-.6,None,'fade'),
 'AB_TRAP_PLUS_FADE_OI3_LE_M0P2':(-.2,None,'dual'),
 'AB_TRAP_PLUS_FADE_OI3_LE_M0P4':(-.4,None,'dual'),
 'AB_TRAP_PLUS_FADE_OI3_LE_M0P6':(-.6,None,'dual'),
 'AB_TRAP_PLUS_FADE_OI3_LE_M0P8':(-.8,None,'dual'),
 'AB_TRAP_PLUS_FADE_OI3_LE_M0P2_NO_BTC7_DEEP5':(-.2,-5.,'dual'),
 'AB_TRAP_PLUS_FADE_OI3_LE_M0P6_NO_BTC7_DEEP5':(-.6,-5.,'dual'),
 'AB_TRAP_PLUS_FADE_OI3_LE_M0P2_NO_BTC7_DEEP3':(-.2,-3.,'dual'),
 'AB_TRAP_PLUS_FADE_OI3_LE_M0P6_NO_BTC7_DEEP3':(-.6,-3.,'dual'),
}
def source_match(e,config):
 oi,btc7,mode=config
 f=e['causalFeatures']
 if TRAP in e['signals'] and mode!='fade' and (btc7 is None or f['btc7']>btc7):
  # Existing 2024 market expert triggers only after confirmed failed BTC rally.
  return 'A_2024_BTC_RALLY_FAILURE'
 if FADE in e['signals'] and mode!='trap' and (oi is None or f['oi3Pct']<=oi):
  # New 2024/2026 OI-contraction expert: no future within exit.
  return 'B_OI3_CONFIRMED_REBOUND_FADE'
 return None
def choose(events,config):
 out=[]
 for sym in ('RNDRUSDT','RENDERUSDT'):
  relevant=[e for e in events if e['symbol']==sym]
  nextfree=-1
  for e in relevant:
   if e['t']<nextfree:continue
   route=source_match(e,config)
   if route is None:continue
   enriched=dict(e,expertRoute=route)
   out.append(enriched)
   nextfree=int(e['exitModel30']['exitTs'])+12*H
 return sorted(out,key=lambda e:e['t'])
def summary(rows,c):
 vals=[float(e['exitModel30']['net30'])+(.30-c/100) for e in rows]
 plus=sum(x for x in vals if x>0)
 minus=-sum(x for x in vals if x<=0)
 capital=1.;peak=1.;dd=0
 for ret in vals:
  capital*=1+ret/100
  peak=max(peak,capital)
  dd=min(dd,100*(capital/peak-1))
 return {'n':len(rows),'wins':sum(v>0 for v in vals),
  'wrPct':round(100*sum(v>0 for v in vals)/len(vals),2) if vals else None,
  'pf':round(plus/minus,4) if minus else None,
  'sumPct':round(sum(vals),3),'compoundPct':round(100*(capital-1),3),
  'closeDDPct':round(dd,3),'maxLossPct':round(min(vals),3) if vals else None,
  'byExpert':dict(collections.Counter(e['expertRoute'] for e in rows))}
def intervals(rows):
 return {key:{str(c):summary([e for e in rows if ms(start)<=e['t']<ms(end)],c)
  for c in (10,30)} for key,start,end in PERIODS}
def actual_native_2026_times():
 j=json.loads(NATIVE.read_text('utf8'))
 return [int(z['ts']) for z in j['selectedTrades']]
def main():
 j=json.loads(IN.read_text('utf8'))
 events=sorted(j['dualShortResearchSignalEvents'],key=lambda e:e['t'])
 assert len(events)>=130 and all(e['signals'] for e in events)
 assert len(set(e['t'] for e in events))==len(events)
 native_times=actual_native_2026_times()
 output={'status':'RESEARCH_ONLY_NATIVE_B_UNCHANGED_THREE_ENTRY_EXPERT_PREALLOCATION',
  'warnings':['2024/2025/2026 windows historically explored. Not pristine OOS.',
   'Third native B line is separate: do NOT sum standalone alpha with wallet native balances',
   'No changes to native gross/pending/ownership/cooldown; collision hours audit only.',
   'No live venue order fills; Binance M5 5m stop-first, 10 and 30bps priced'],
  'thirdExpertB':'Existing 24 native-shared8 RENDER entries; preserved unchanged, count=24. Temporal conflict comparison only.',
  'bankN':len(events),'configRules':{name:{
   'oi3Gate':gate[0],'btc7MinimumFor2024Trap':gate[1],'mode':gate[2]}
   for name,gate in CONFIGS.items()},'models':{}}
 for name,params in CONFIGS.items():
  chosen=choose(events,params)
  by=intervals(chosen)
  overlap=[e['t'] for e in chosen if e['symbol']=='RENDERUSDT'
   and any(abs(e['t']-nt)<24*H for nt in native_times)]
  # Calendar time proximity isn't true native capacity. It just determines
  # need for full owner/margin/cooldown replay before adoption.
  output['models'][name]={'periods':by,'chosen':len(chosen),
    'newResearchEntriesWithin24hExistingNative':len(overlap),
    'selectedExpertCounts':dict(collections.Counter(e['expertRoute'] for e in chosen))}
  v=[by[yr]['30'] for yr in ('2024','2025','2026')]
  print('THREEWAY_PREALLOCATION',name,'N30_PF2024',v[0]['n'],v[0]['pf'],
   '2025',v[1]['n'],v[1]['pf'],'2026',v[2]['n'],v[2]['pf'],
   'MAX_LOSS',min((x['maxLossPct'] for x in v if x['maxLossPct'] is not None),default=None),
   'NATIVE_TEMPORAL_CONFLICTS',len(overlap),flush=True)
 output['threeYearProfitableResearchOnly']=[
  name for name,z in output['models'].items() if
  all(z['periods'][yr]['30']['n']>=18 and (z['periods'][yr]['30']['pf'] or 0)>1
      and (z['periods'][yr]['10']['pf'] or 0)>1
      for yr in ('2024','2025','2026'))]
 target=OUT/'RENDER_THREE_EXPERT_AB_PLUS_NATIVE_B_PREALLOCATION_SCREEN_20261024.json'
 target.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('ALL_YEAR_SCREEN',output['threeYearProfitableResearchOnly'],'FILE',target)
if __name__=='__main__':main()
