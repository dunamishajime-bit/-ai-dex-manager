#!/usr/bin/env python3
"""RESEARCH ONLY: 8-strategy native shared wallet with Causal Ranked #4427
plus independent BTC divergence/SELL/REBOUND/TREND 5m shadow gates.

Entry decisions are based on past closed 90/180d public shadow returns and
as-of market score; prefilter BTC diverging gate by sell pressure >=55%.
Do not append 2024/2025 shadow new routes to Aster wallet absent venue marks.
No live action, no order sending. Three independent deterministic replays per cost.
"""
from __future__ import annotations
import argparse,bisect,collections,importlib.util,json,math,sys
from pathlib import Path
ROOT=Path('C:/tmp')
REPO=ROOT/'render-multiregime-study-20261024'
DD=REPO/'scripts/dd-reduction'
HERE=ROOT/'render-mtf-study-20261024'
def load(n,p):
 spec=importlib.util.spec_from_file_location(n,p)
 v=importlib.util.module_from_spec(spec);sys.modules[n]=v
 spec.loader.exec_module(v);return v
base=load('render4427_original_native8_add_indep',DD/'run-render-4427-native8-shared-wallet-20261024.py')
brain=load('render4427_asof_profit_rank_indep',HERE/'render_4427_independent_rolling_profit_gate_20261024.py')
native=base.native;previous=native.previous
case='RENDER_4427_INDEPENDENT_ASOF_SELL55_NATIVE8_20261024'
previous.CASE_RULES[case]={k:list(v) for k,v in previous.CASE_RULES[base.new_case].items()}
previous.PROFIT_FLOOR[case]=previous.PROFIT_FLOOR[base.new_case]
native.NEW_CASES[case]=dict(native.NEW_CASES[base.new_case])
RULES={
 'BTC_RENDER_DIVERGE':{'exit':'S6','policy':'dual_90_180'},
 'SELL_IMBALANCE':{'exit':'S12','policy':'ninety_mid'},
 'TREND_BREAK':{'exit':'S6','policy':'recent30_180'},
 'REBOUND_FAIL':{'exit':'S12','policy':'recent30_180'},
}
cfg={'families':list(RULES),'exit':'S6','policy':'ninety_mid','routeRules':RULES,
 'oldBonus':8,'upgradeMargin':8,'structure':'any','newCooldownHours':12}
filtered=[]
n_btc_qualified=0
for row in brain.DATA:
 eligible=row['features']['sellPct']>=.55
 new=[c for c in row['candidates'] if c['family']!='BTC_RENDER_DIVERGE' or eligible]
 if eligible and any(c['family']=='BTC_RENDER_DIVERGE' for c in new):n_btc_qualified+=1
 if new:filtered.append({**row,'candidates':new})
result=brain.replay(cfg,events=filtered,save=True)
assert result['selectedTrades']==224 and result['addedIndependents']==38
NATIVE_START=base.STAMP;NATIVE_END=base.END
forward_new=[r for r in result['trades'] if r['kind']=='INDEPENDENT'
 and r['sym']=='RENDERUSDT' and NATIVE_START<=r['t']<NATIVE_END]
forward_new.sort(key=lambda r:r['t'])
assert len(forward_new)==3,('NATIVE_RESEARCH_SIGNAL_3_PARITY',len(forward_new))
assert len({r['t'] for r in forward_new})==3
assert all(r['family']=='BTC_RENDER_DIVERGE' and r['exit']=='S6' for r in forward_new)
seen=collections.defaultdict(set)
counters=collections.defaultdict(collections.Counter)
def inject(source,cost_bps):
 original=base.generate_model_rows(source,cost_bps)
 obs,native_t=source.getdata('RENDERUSDT')
 origkeys={(int(x['entry_ts_ms']),str(x['route'])) for x in original}
 added=[]
 for event in forward_new:
  t=int(event['t'])
  i=bisect.bisect_left(native_t,t)
  if i<1 or i>=len(native_t) or int(native_t[i])!=t or int(native_t[i-1])+300000!=t:
   raise RuntimeError(('ASTER_H1_MARK_MISSING_FAIL_CLOSED',t))
  price=float(obs[i][1]);assert math.isfinite(price) and price>0
  exit_ts=int(event['exitTs'])
  assert t<exit_ts<=t+6*3600000+300000,(t,exit_ts)
  raw=float(event['net30'])+.30
  exitpx=price*(1-raw/100)
  assert exitpx>0 and math.isfinite(exitpx)
  route='IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT'
  assert (t,route) not in origkeys
  seen[cost_bps].add((t,route))
  added.append({
   'status':'MODELED_CLOSED_TRADE',
   'strategy_id':'IDLE','symbol':'RENDERUSDT','side':'SHORT',
   'route':route,'signal_ts_ms':t,'entry_ts_ms':t,
   'entry_price':price,'exit_ts_ms':exit_ts,'exit_price':exitpx,
   'exit_reason':'RESEARCH_INDEP_S6_TP1P5_STOP2_H6',
   'unit_price_return':raw/100,
   'requested_gross':.25,'priority':0,
   'generic_accepted':True,'route_selected':True,'overlay_source_current':True,
   'research_causal_source':'OFFICIAL_BINANCE_M5_COMPLETED_H1_SELL55_AND_PAST_SHADOW_PROFIT_NOT_LIVE',
   'research_new_route_group':event['family'],'funding_return_per_gross':0.,
   'ambiguous_bar':False,
   'source_runtime_sha':'RESEARCH_ONLY_RENDER_4427_INDEPENDENT_CAUSAL_SCORE_20261024'
  })
  counters[cost_bps]['new_independent']+=1
 print('TRUE_NATIVE8_ADDITIVE_RESEARCH',cost_bps,'incumbent_4427',len(original),
       'independent_Gates',len(added),
       'historical_shadow_new',result['addedIndependents'],flush=True)
 return [*original,*added]
native.research_new_rows=inject
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True)
 args=p.parse_args()
 assert args.output.resolve().as_posix().lower().startswith('c:/tmp/')
 args.output.mkdir(parents=True,exist_ok=True)
 native.STATE['case']=case
 native.study.STATE['cache'].clear()
 old=list(sys.argv)
 try:
  sys.argv=[str(DD/'run-idle-three-entry-native-full8-20261024.py'),
   '--output',str(args.output/case),'--case',case]
  previous.main()
 finally:sys.argv=old
 report={'status':'RESEARCH_ONLY_NATIVE8_INDEPENDENT_GATE_DYNAMIC_RANK_NOT_LIVE',
  'source2025BtcManifest':'C:/tmp/render-mtf-study-20261024/RENDER_4427_BTC_5M_2025AUG_2026AUG_VERIFIED_SOURCE_MANIFEST_20261024.json',
  'case':case,'method':'Original #4427 42 candidates unchanged, plus independently gating owner-prioritized S6 BTC divergence candidates based on past shadow, SELL>=0.55',
  '2024To2026ResearchSelected':result['addedIndependents'],
  'researchWindowSelectedIndependent':len(forward_new),
  'nativeNewDates':[{k:r[k] for k in ('sym','t','family','net30','score')} for r in forward_new],
  'uniqueKeys':{str(k):len(v) for k,v in seen.items()},
  'candidateCounts':{str(k):dict(v) for k,v in counters.items()},
  'riskContract':'Unmodified full8 native wallet, account caps/gross/owner locks, 0.25x IDLE nominal only',
  'limitations':['Aster 2025 RENDER H1 marks unavailable. Native wallet only adds NEW 2026-Jan-Aug candidate dates.',
   'Binance futures M5 is venue proxy, Aster actual M5 slippage/L2/partial fill not independently authenticated',
   'Modeled funding zero for new route, no actual signed venue stop lifecycle evidence',
   'All years have been previously viewed; ex-post SELL55 regime filter selected after inspecting 2026 losing trade',
   'LIVE VPS Production HP and actual orders have not been changed']}
 f=args.output/(case+'_research_evidence.json')
 f.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
 print('FINISHED',f,flush=True)
if __name__=='__main__':main()
