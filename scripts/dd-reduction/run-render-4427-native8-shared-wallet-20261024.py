#!/usr/bin/env python3
"""True native eight-strategy 10/30bps portfolio test of nonadopted RENDER
2024-26 profitability-first candidate #4427. Existing native wallet sources,
caps, positions, conflicts, and risk logic are left unchanged.
Native Aster mark exists Jan6 2026 onward only: no spoofed 2025 RENDER marks.
New alpha fills are Binance M5 model, not actual signed Aster venue orders.
"""
from __future__ import annotations
import argparse,bisect,collections,hashlib,importlib.util,json,math,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
def load(n,p):
 s=importlib.util.spec_from_file_location(n,p);o=importlib.util.module_from_spec(s);s.loader.exec_module(o);return o
native=load('full8_4427_existing_wallet',HERE/'run-render-2024-triple-native-full8-20261024.py')
engine=load('full8_4427_single_short_engine',HERE/'render-six-short-entry-portfolio-priority-grid-20261024.py')
bank=json.loads((OUT/'RENDER_2024_2026_ALL_SIX_WITH_B_30_BRACKETS_M5_LEDGER_20261024.json').read_text('utf8'))
grid=json.loads((OUT/'RENDER_B_30_INITIAL_STOP_AND_ENTRY_PORTFOLIO_COHORT_GRID_20261024.json').read_text('utf8'))
candidate=next(c for c in grid['allCasesSummary'] if c['index']==4427)
assert candidate['priority']==[
 'SHORT_2024_BTC_RALLY_FAILURE','SHORT_DEEP_DROP_FAILED_RETEST','SHORT_BEAR_REBOUND_2H_FADE']
assert candidate['exits']['SHORT_DEEP_DROP_FAILED_RETEST']=='TAKE15_STOP20_H6'
assert candidate['exits']['SHORT_BEAR_REBOUND_2H_FADE']=='BST35_T50M25H24'
assert tuple(bank['BVariants']['BST35_T50M25H24'])==tuple(native.study.previous.CASE_RULES.get('NOT_A_ROUTE',{}).get('missing',[])) or bank['BVariants']['BST35_T50M25H24']==[.05,.035,24,.025,.01]
new_case='RENDER_4427_3ENTRY_INTEGRATED_NATIVE8'
previous=native.previous
previous.CASE_RULES[new_case]={k:list(v) for k,v in previous.CASE_RULES[native.BASE_CASE].items()}
previous.PROFIT_FLOOR[new_case]=.0035
native.NEW_CASES[new_case]={'oi3':-.2,'trap':True,'bear':True,'retrospectiveStudyCase':4427}
STAMP=native.START;END=native.END
REC=[r for r in bank['events'] if r['symbol']=='RENDERUSDT' and STAMP<=int(r['t'])<END]
REC.sort(key=lambda x:x['t'])
assert len(REC)>=50
source_counts=collections.defaultdict(collections.Counter)
candidate_ids=collections.defaultdict(set)
route_alias={
 'SHORT_2024_BTC_RALLY_FAILURE':'IDLE_RENDER_4427_BTC_TRAP_SHORT',
 'SHORT_BEAR_REBOUND_2H_FADE':'IDLE_RENDER_4427_BEAR_OI_SHORT',
 'SHORT_DEEP_DROP_FAILED_RETEST':'IDLE_RENDER_4427_FAILED_RETEST_SHORT'}
def generate_model_rows(source,cost_bps):
 b,native_times=source.getdata('RENDERUSDT')
 out=[]
 for ev in REC:
  chosen=None
  for family in candidate['priority']:
   if family not in ev['shortSignals']:continue
   if family=='SHORT_BEAR_REBOUND_2H_FADE' and ev['causalFeatures']['oi3Pct']>-.2:continue
   chosen=family;break
  if chosen is None:continue
  t=int(ev['t']);ex=ev['exitModels'][candidate['exits'][chosen]]
  idx=bisect.bisect_left(native_times,t)
  if idx<1 or idx>=len(native_times) or int(native_times[idx])!=t or int(native_times[idx-1])+300000!=t:
   raise RuntimeError(('RENDER_4427_NATIVE_SOURCE_H1_MARK_REQUIRED',t))
  entry=float(b[idx][1]);assert entry>0 and math.isfinite(entry)
  exit_ts=int(ex['exitTs']);assert t<exit_ts<=t+24*3600000+300000,(t,exit_ts)
  raw_pct=float(ex['net30'])+.30
  exit_px=entry*(1-raw_pct/100)
  assert exit_px>0 and math.isfinite(exit_px)
  route=route_alias[chosen]
  source_counts[cost_bps][chosen]+=1
  candidate_ids[cost_bps].add((t,route))
  out.append({
   'status':'MODELED_CLOSED_TRADE',
   'strategy_id':'IDLE','symbol':'RENDERUSDT','side':'SHORT',
   'route':route,'signal_ts_ms':t,'entry_ts_ms':t,'entry_price':entry,
   'exit_ts_ms':exit_ts,'exit_price':exit_px,
   'exit_reason':'RESEARCH_4427_'+str(ex['reason']),
   'unit_price_return':float(raw_pct)/100,
   'requested_gross':.25,'priority':0,
   'generic_accepted':True,'route_selected':True,'overlay_source_current':True,
   'research_causal_source':'BINANCE_VISION_2024_2026_4427_NONLIVE',
   'research_new_route_group':chosen,
   'funding_return_per_gross':0.,'ambiguous_bar':False,
   'source_runtime_sha':'RESEARCH_ONLY_RENDER_4427_20261024'
  })
 if len(out)<25:raise RuntimeError(('INSUFFICIENT_RENDER_4427_H1_CANDIDATES',len(out)))
 print('NATIVE8_4427_INJECT',cost_bps,'EVENTS',len(out),'BY_ENTRY',dict(source_counts[cost_bps]),flush=True)
 return out
native.research_new_rows=generate_model_rows
def main():
 p=argparse.ArgumentParser()
 p.add_argument('--output',type=Path,required=True)
 a=p.parse_args()
 assert a.output.resolve().as_posix().lower().startswith('c:/tmp/')
 a.output.mkdir(parents=True,exist_ok=True)
 native.STATE['case']=new_case
 native.study.STATE['cache'].clear()
 oldargv=list(sys.argv)
 try:
  sys.argv=[str(HERE/'run-idle-three-entry-native-full8-20261024.py'),
   '--output',str(a.output/new_case),'--case',new_case]
  previous.main()
 finally:sys.argv=oldargv
 audit={'status':'RESEARCH_ONLY_RENDER_4427_NATIVE8_SHADOW_10_30BPS',
  'source':'Aster H1 marks Jan 2026 plus Binance M5 model exits; no fabricated Aster history',
  'candidateID':4427,
  'modeledInputs':{str(cost):{
   'candidatesByEntry':dict(source_counts[cost]),
   'uniqueGeneratedCandidateKeys':len(candidate_ids[cost])}
   for cost in (10,30)},
  'requiredLimits':'Incumbent native eight-strategy capital, gross, route-owner, account lock, symbol cooldown and risk gates unchanged',
  'limitations':['No real Aster venue fills or signed stop order evidence',
   'Existing Aster RENDER H1 marks begin Jan6; 2025 newly studied routes not inserted',
   'Funding return for new entries 0 assumption, not actual',
   'No PROD/LIVE/VPS/HP changes']}
 (a.output/(new_case+'_evidence.json')).write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n','utf8')
 print('NATIVE8_RENDER_4427_ECONOMIC_REPLAY_FINISHED',audit['modeledInputs'],flush=True)
if __name__=='__main__':main()
