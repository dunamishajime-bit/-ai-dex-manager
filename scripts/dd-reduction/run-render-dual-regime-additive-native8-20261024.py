#!/usr/bin/env python3
"""RESEARCH: Native shared-wallet add-only dual regime.
Never remove any existing RENDER B entry. Reopen previously BTC3<-1.5
rejected H1 candidates only if deep-bear regime A and causal seller/OI
confirmation is strong. All orders remain native IDLE signal family.
No new fabricated candidate, time-shift, order, or production write.
"""
from __future__ import annotations
import argparse,collections,importlib.util,json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
R=HERE.parents[1]
def load(n,p):
 spec=importlib.util.spec_from_file_location(n,p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
study=load('two_regime_base_for_additive_study',HERE/'run-render-two-regime-native-full8-20261024.py')
previous=study.previous
core_filter=study.core_native_filter
source_features=study.symbol_market_features
kernel=study.kernel
ROOTCASE='RENDER_PROFIT_F035_JUP_M1P5'
CASES={
 'RENDER_DUAL_A_ADD_SELLER_0P05_OI_UP':{'seller':.05,'minOI':0.,'regimeScore':70,'type':'a'},
 'RENDER_DUAL_A_ADD_SELLER_0P0_OI_UP':{'seller':0.,'minOI':0.,'regimeScore':70,'type':'a'},
 'RENDER_DUAL_A_ADD_SELLER_0P08_DEEP':{'seller':.08,'minOI':None,'regimeScore':100,'type':'a'},
 'RENDER_DUAL_A_ADD_BEAR_RECOVERY':{'seller':.03,'minOI':-.2,'regimeScore':70,'type':'recovery'}
}
for case in CASES:
 rules={k:list(v) for k,v in previous.CASE_RULES[ROOTCASE].items()}
 assert rules['RENDERUSDT']==['btc3h_ge_-1.5']
 rules['RENDERUSDT']=[]
 previous.CASE_RULES[case]=rules
 previous.PROFIT_FLOOR[case]=.0035
STATE={'case':None,'logs':collections.defaultdict(list),'cache':study.STATE['cache']}
def add_filter(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
 completed=core_filter(rows,overlays,source,cost_bps,obs,baseline_lookup)
 out=[]
 rule=CASES[STATE['case']]
 for row in completed:
  if row.get('strategy_id')!='IDLE' or row.get('symbol')!='RENDERUSDT' or row.get('side')!='SHORT':
   out.append(row);continue
  ts=int(row['entry_ts_ms'])
  feature=previous.screen.feat.get_feat(source,'RENDERUSDT',ts)
  if feature is None:raise RuntimeError(('RAW_CAUSAL_M5_MISSING',ts))
  # Exactly match the unmodified B contract for B candidates.
  if previous.screen.accept(feature,previous.screen.RULES['btc3h_ge_-1.5']):
   out.append(row)
   STATE['logs'][(STATE['case'],cost_bps)].append({'ts':ts,'mode':'B','decision':'PRESERVE',
     'btc3h':feature['btc3h']})
   continue
  # A receives only the B-rejected native H1 candidates, with no synthesized orders.
  f=source_features(source,ts)
  aa=(f['macroScore']>=rule['regimeScore'] and f['seller1']>=rule['seller'] and
      (rule['minOI'] is None or f['oi1Pct']>=rule['minOI']))
  if rule['type']=='recovery':
   aa=aa and (feature['ret1h']>=-.5) and (feature['ret3h']>=-2.5)
  STATE['logs'][(STATE['case'],cost_bps)].append({'ts':ts,'mode':'A','decision':'NEW' if aa else 'REJECT',
    'btc3h':round(feature['btc3h'],5),'render7Pct':round(f['render7Pct'],4),
    'btc7Pct':round(f['btc7Pct'],4),'vol7DailyPct':round(f['vol7DailyPct'],4),
    'seller1':round(f['seller1'],5),'oi1Pct':round(f['oi1Pct'],5),
    'macroScore':f['macroScore']})
  if aa:
   out.append(row)
   obs['newRegimeNativeCandidate']=obs.get('newRegimeNativeCandidate',0)+1
  else:
   obs['newRegimeRejectedAfterNative']=obs.get('newRegimeRejectedAfterNative',0)+1
 return out
kernel.entry_filter=add_filter
def main():
 pa=argparse.ArgumentParser()
 pa.add_argument('--output',type=Path,required=True)
 pa.add_argument('--case',choices=list(CASES),required=True)
 args=pa.parse_args()
 assert R not in (args.output.resolve(),*args.output.resolve().parents)
 STATE['case']=args.case
 study.STATE['cache'].clear()
 args.output.mkdir(parents=True,exist_ok=True)
 before=list(sys.argv)
 try:
  sys.argv=[str(HERE/'run-idle-three-entry-native-full8-20261024.py'),
   '--output',str(args.output/args.case),'--case',args.case]
  previous.main()
 finally:sys.argv=before
 logs={str(cost):STATE['logs'][(args.case,cost)] for cost in (10,30)}
 audit={'status':'RESEARCH_ONLY_ADD_ONLY_NATIVE8_PARALLEL_AB',
  'case':args.case,'rule':CASES[args.case],'baselineContract':ROOTCASE,
  'method':'B preserved by exact previous btc3 gate. A adds only previous B rejected H1 native rows with fully causal confirmation.',
  'logs':logs,'summary':{c:dict(collections.Counter(r['mode']+'_'+r['decision'] for r in z)) for c,z in logs.items()}}
 dst=args.output/(args.case+'_regime_evidence.json')
 dst.write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('NATIVE8_ADD_ONLY_FINISHED',args.case,'COUNTS',audit['summary'],flush=True)
if __name__=='__main__':main()
