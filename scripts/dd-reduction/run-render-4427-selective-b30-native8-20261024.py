#!/usr/bin/env python3
"""True research Native8 wallet compare: #4427 B selective 30min confirmed breakout.
RESEARCH ONLY. No actual Aster M5 mark, new 5m delayed entries are Binance M5
relative-ratio anchored to observed Aster H1 at SIGNAL TIME. Not venue certified.
Preserves all eight existing native wallet risk, locks, margin and other routes.
"""
from __future__ import annotations
import argparse,bisect,collections,importlib.util,json,math,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=Path('C:/tmp/render-multiregime-study-20261024')
DD=REPO/'scripts/dd-reduction'
OUT=HERE
def load(n,p):
 spec=importlib.util.spec_from_file_location(n,p)
 v=importlib.util.module_from_spec(spec);sys.modules[spec.name]=v
 spec.loader.exec_module(v);return v
base=load('render4427_native_base_vs_delayed_30m',DD/'run-render-4427-native8-shared-wallet-20261024.py')
delay=load('render4427_model_selective_causal_5m',HERE/'render-4427-causal-m5-confirmed-delayed-entry-20261024.py')
native=base.native
previous=native.previous
CASE='RENDER_4427_SELECTIVE_B_30MIN_ASOF_RANGE_NATIVE8'
previous.CASE_RULES[CASE]={k:list(v) for k,v in previous.CASE_RULES[base.new_case].items()}
previous.PROFIT_FLOOR[CASE]=previous.PROFIT_FLOOR[base.new_case]
native.NEW_CASES[CASE]=dict(native.NEW_CASES[base.new_case])
bars=[r for r in delay.prices()['RENDERUSDT']]
bar_index={r[0]:i for i,r in enumerate(bars)}
assert len(bars)>100000
stats=collections.defaultdict(collections.Counter)
unique=collections.defaultdict(set)
A='SHORT_2024_BTC_RALLY_FAILURE'
B='SHORT_BEAR_REBOUND_2H_FADE'
X='SHORT_DEEP_DROP_FAILED_RETEST'
def emit(source,cost_bps):
 observed,native_times=source.getdata('RENDERUSDT')
 output=[]
 for e in base.REC:
  t=int(e['t'])
  fam=None
  for name in base.candidate['priority']:
   if name not in e['shortSignals']:continue
   if name==B and e['causalFeatures']['oi3Pct']>-.2:continue
   fam=name;break
  if fam is None:continue
  j=bisect.bisect_left(native_times,t)
  if j<1 or j>=len(native_times) or int(native_times[j])!=t or int(native_times[j-1])+300000!=t:
   raise RuntimeError(('REQUIRES_OBSERVED_ASTER_H1_REFERENCE_NO_FABRICATION',t))
  aster_signal=float(observed[j][1])
  assert aster_signal>0 and math.isfinite(aster_signal)
  k=bar_index.get(t)
  if k is None:raise RuntimeError(('BINANCE_M5_EVENT_MISSING',t))
  signal_binance=float(bars[k][1])
  if fam==B and e['causalFeatures']['rangePos1']>=.35:
   at=delay.detect(bars,k,'break_prev30',6,1,.001)
   if at is None:at=k+6
   assert at < len(bars) and bars[at][0]-t<=30*60*1000
   sim=delay.simulate(bars,at,'B')
   if sim is None:raise RuntimeError(('NO_DELAYED_FULL_HORIZON',t))
   entry_ts=int(sim['entryTs'])
   # Aster M5 marks unavailable: model relative Binance move anchored to *observed* Aster H1.
   entry_price=aster_signal*float(sim['entryPrice'])/signal_binance
   raw_pct=sim['net30']+.30
   exit_ts=int(sim['exitTs'])
   reason=str(sim['reason'])
   stats[cost_bps]['b_delay_applied']+=1
  else:
   ex=e['exitModels'][base.candidate['exits'][fam]]
   entry_ts=t;entry_price=aster_signal
   raw_pct=float(ex['net30'])+.30
   exit_ts=int(ex['exitTs']);reason=str(ex['reason'])
   stats[cost_bps]['original_price_route']+=1
  exit_price=entry_price*(1-raw_pct/100)
  assert entry_price>0 and math.isfinite(entry_price) and exit_price>0 and math.isfinite(exit_price)
  assert t<=entry_ts<exit_ts<=entry_ts+24*3600000+300000
  route=base.route_alias[fam]
  stats[cost_bps][fam]+=1
  unique[cost_bps].add((entry_ts,route))
  output.append({
   'status':'MODELED_CLOSED_TRADE',
   'strategy_id':'IDLE','symbol':'RENDERUSDT','side':'SHORT',
   'route':route,'signal_ts_ms':t,'entry_ts_ms':entry_ts,
   'entry_price':entry_price,'exit_ts_ms':exit_ts,'exit_price':exit_price,
   'exit_reason':'RESEARCH_ASOF_SELECTIVE_B30_'+reason,
   'unit_price_return':raw_pct/100,
   'requested_gross':.25,'priority':0,
   'generic_accepted':True,'route_selected':True,
   'overlay_source_current':True,
   'research_causal_source':'BINANCE_VISION_M5_RELATIVE_ANCHORED_OBSERVED_ASTER_H1',
   'research_new_route_group':fam,
   'funding_return_per_gross':0.,
   'ambiguous_bar':False,
   'source_runtime_sha':'RESEARCH_ONLY_RENDER_4427_SELECTIVE_B30_20261024'
  })
 print('SELECTIVE_B_NATIVE_CANDIDATES',cost_bps,len(output),dict(stats[cost_bps]),flush=True)
 assert len(output)>=25
 return output
native.research_new_rows=emit
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True)
 args=p.parse_args()
 assert args.output.resolve().as_posix().lower().startswith('c:/tmp/')
 args.output.mkdir(exist_ok=True,parents=True)
 native.STATE['case']=CASE
 native.study.STATE['cache'].clear()
 old=list(sys.argv)
 try:
  sys.argv=[str(DD/'run-idle-three-entry-native-full8-20261024.py'),'--output',str(args.output/CASE),'--case',CASE]
  previous.main()
 finally:sys.argv=old
 evidence={'status':'RESEARCH_ONLY_SELECTIVE_B30_TRUE_NATIVE_EIGHT_SHADOW',
  'case':CASE,'preSignalCondition':'asof 1H rangePos1>=0.35 and OI3Pct<=-0.2',
  'entry':'Wait at most 30min; completed M5 close below pre-signal 30min low by 0.1%, next M5 open; otherwise 30min fallback',
  'allOtherEntries':'Original #4427 immediate A/X/B below regime threshold; 0.25x new B IDLE shared wallet unchanged',
  'modelledPricing':'Aster signal-time H1 quote x Binance M5 delayed-return ratio; NOT actual Aster delayed M5 quote or signed fills',
  'costRoutes':{str(k):dict(v) for k,v in stats.items()},
  'uniqueCandidates':{str(k):len(v) for k,v in unique.items()},
  'limits':['Native 2025 RENDER mark absent; only native 2026 JanAug new candidates',
   'M5 relative entry/exit not venue certified, no funding actual expenses',
   'historical windows already inspected, no pristine OOS',
   'No VPS LIVE Production HP changes or orders']}
 (args.output/(CASE+'_evidence.json')).write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n','utf8')
 print('NATIVE8_SELECTIVE_B30_DONE',json.dumps(evidence,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
