#!/usr/bin/env python3
"""Risk budget and provisional A/B market scores for 2024-origin triple regime.

A and B are new independent H1 SHORT candidates. Existing third native RENDER
expert is held unchanged; no synthetic shared8 orders are created.
Scores measure observable regime-fit only; they are not calibrated expected PnL.
Capital sizing below is stand-alone closed-trade research (NOT native MTM DD).
"""
from __future__ import annotations
import bisect,collections,datetime as dt,importlib.util,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
BANK=OUT/'RENDER_2024_FRESH_LONG_SHORT_12_ENTRY_7_EXIT_SCREENER_20261024.json'
SUMMARY=OUT/'RENDER_THREE_EXPERT_AB_PLUS_NATIVE_B_PREALLOCATION_SCREEN_20261024.json'
NATIVE=ROOT/'docs/research/results/render-orderflow-20261024/RENDER_NATIVE_SELECTED24_OI_FLOW_ATTRIBUTION_20261024.json'
def load():
 f=ROOT/'scripts/dd-reduction/render-three-regime-preallocation-short-experts-20261024.py'
 s=importlib.util.spec_from_file_location('regime_preallocation',f)
 mod=importlib.util.module_from_spec(s);s.loader.exec_module(mod);return mod
stage=load()
PERIODS=[('2024','2024-01-01','2025-01-01'),('2025','2025-01-01','2026-01-01'),
 ('2026','2026-01-01','2026-08-10'),('2025_H1','2025-01-01','2025-07-01'),
 ('2025_H2','2025-07-01','2026-01-01'),
 ('2026_JANMAR','2026-01-01','2026-04-01'),
 ('2026_APRAUG','2026-04-01','2026-08-10')]
def clamp(x):return max(0.0,min(1.0,x))
def scores(z):
 f=z['causalFeatures']
 score={}
 if stage.TRAP in z['signals']:
  score['A_2024_BTC_RALLY_FAILURE']=60+25*clamp((f['btc1']-.28)/.75)+15*clamp((f['hourWick']-.4)/1.5)+10*clamp((f['seller1']-.03)/.2)
 if stage.FADE in z['signals'] and f['oi3Pct']<=-.6:
  score['B_OI3_CONFIRMED_REBOUND_FADE']=60+30*clamp((-f['oi3Pct']-.6)/1.0)+15*clamp(f['priorRebound']/4.)+10*clamp((f['seller1']-.03)/.2)
 return score
def risk_at_cost(rows,cost,multiplier):
 equity=1.;peak=1.;DD=0
 totalpos=0;totalneg=0; net=[]
 for ev in rows:
  r=(float(ev['exitModel30']['net30'])+(.30-cost/100))*multiplier
  assert r>-100
  equity*=1+r/100
  peak=max(peak,equity)
  DD=min(DD,(equity/peak-1)*100)
  net.append(r)
  if r>0:totalpos+=r
  else:totalneg-=r
 return {'trades':len(net),
   'wins':sum(x>0 for x in net),
   'pf':round(totalpos/totalneg,5) if totalneg else None,
   'closeDDPct':round(DD,5),
   'compoundPct':round((equity-1)*100,5),
   'largestSingleLossPctAllocatedCapital':round(min(net),4) if net else None}
def main():
 src=json.loads(BANK.read_text('utf8'))
 study=json.loads(SUMMARY.read_text('utf8'))
 official=json.loads(NATIVE.read_text('utf8'))
 assert len(official['selectedTrades'])==24
 events=sorted(src['dualShortResearchSignalEvents'],key=lambda z:z['t'])
 configuration='AB_TRAP_PLUS_FADE_OI3_LE_M0P6'
 original=stage.choose(events,stage.CONFIGS[configuration])
 # Filter & score contemporaneously; strategy priority labels don't change
 # the economic exit since both experts use exactly one TP4/SL3/24h contract.
 rescored=[]
 ties=0;changed=0
 for z in original:
  ss=scores(z)
  assert ss
  preferred=max(ss,key=ss.get)
  ties+=int(len(ss)>1)
  changed+=int(preferred!=z['expertRoute'])
  rescored.append(dict(z,scoredExpert=preferred,causalScores={k:round(v,3) for k,v in ss.items()}))
 assert [x['t'] for x in original]==[x['t'] for x in rescored]
 native_times=sorted(int(x['ts']) for x in official['selectedTrades'])
 nearby=[]
 for z in rescored:
  if z['symbol']!='RENDERUSDT':continue
  low=bisect.bisect_left(native_times,z['t']-24*3600000)
  high=bisect.bisect_right(native_times,z['t']+24*3600000)
  if high>low:
   nearby.append({'t':z['t'],'expert':z['scoredExpert'],
    'nearestNativeEntryTs':min(native_times[low:high],key=lambda t:abs(t-z['t'])),
    'deltaHours':round(min(abs(t-z['t']) for t in native_times[low:high])/3600000,2)})
 out={'status':'RESEARCH_ONLY_THREE_EXPERT_PROVISIONAL_SCORE_AND_ALLOCATED_SLEEVE_RISK',
  'candidate':configuration,'n':len(rescored),
  'nativePortfolioB':'Existing RENDER share-wallet entry remains UNCHANGED. Native competitor priority not calibrated or replayed.',
  'data':{'selectedProfileChangedWithoutEconomicEffect':changed,
     'sameHourTwoCandidateExpertMatches':ties,
     'newEntryTimesNearNative24h':len(nearby),
     'nativeCollisionsFirst15':nearby[:15]},
  'sizing':{},
  'warnings':['Funding cashflows not included; M5 modeling stop-first and 10/30bps fixed modeled fee',
    'Risk calculations are *closed-trade only*, not intratrade MTM drawdown or native wallet',
    '0.25x or 0.5x scales independent allocated research capital not account production gross',
    'Third native route is not scored against models A/B, needs source-compatible common priority calibration',
    '2024-2026 windows repeatedly studied; study-only, not independent OOS',
    'Live exchange constraints, other assets, account risk locks and pending exposure have not been replayed'] }
 for cost in (10,30):
  for size in (.25,.5,1.):
   k=f'{cost}bps__{size}x'
   rows={}
   for period,a,b in PERIODS:
    sub=[z for z in rescored if stage.ms(a)<=z['t']<stage.ms(b)]
    rows[period]=risk_at_cost(sub,cost,size)
   out['sizing'][k]=rows
   print('RISK',k,'2024',rows['2024'],'2025',rows['2025'],
    '2026',rows['2026'],flush=True)
 for year in ('2024','2025','2026'):
  group=[z for z in rescored if stage.ms(year+'-01-01')<=z['t']<
   stage.ms(str(int(year)+1)+'-01-01')]
  out['data'][year+'RouteLabels']=dict(collections.Counter(z['scoredExpert'] for z in group))
 output=OUT/'RENDER_THREE_EXPERT_2024_AB_PROVISIONAL_RISK_AND_NATIVE_CONFLICT_20261024.json'
 output.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
 print('SCORE_RECLASSIFICATION',changed,'OVERLAP_N',len(nearby),'FILE',output,flush=True)
if __name__=='__main__':main()
