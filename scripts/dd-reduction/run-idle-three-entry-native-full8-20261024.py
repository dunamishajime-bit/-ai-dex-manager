#!/usr/bin/env python3
"""8-strategy causal Idle RENDER/DOT/JUP SHORT entry veto after latest AVAX/PENGU research.
Research only: fixed all8 native dynamic admission and 10bps/30bps MTM accounting.
"""
from __future__ import annotations
import argparse,importlib.util,collections,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
def load(n,p):
 sp=importlib.util.spec_from_file_location(n,p)
 x=importlib.util.module_from_spec(sp);sp.loader.exec_module(x);return x
screen=load('idle_entry_three_families',HERE/'screen-idle-entry-families-after-pengu-20261024.py')
parent=load('idle_combined_pengu_8h',HERE/'research-pengu-combined-normal8-recovery24-full8-20261024.py')
base=parent.base
native=base.native_wrapper.native
origin=native.m.m.entry_filter
CASE_RULES={
 'RENDER_BTC3GE_M1':{'RENDERUSDT':['btc3h_ge_-1']},
 'RENDER_BTC3GE_M1P5':{'RENDERUSDT':['btc3h_ge_-1.5']},
 'RENDER_BTC6GE_M1P5':{'RENDERUSDT':['btc6h_ge_-1.5']},
 'RENDER_ATR3LE_0P8':{'RENDERUSDT':['atr3h_le_0.8']},
 'RENDER_BULL_REGIME_VETO':{'RENDERUSDT':['not_btc6_positive_and_symbol_rel6_positive']},
 'DOT_RET1GE_M1':{'DOTUSDT':['ret1h_ge_-1']},
 'DOT_RET6GE_M4':{'DOTUSDT':['RET6H_GE_MINUS4']},
 'DOT_LOWVOL_OVERSOLD_VETO':{'DOTUSDT':['not_oversold_ret6_and_low_volume']},
 'JUP_RET12GE_M5':{'JUPUSDT':['RET12H_GE_MINUS5']},
 'COMBO_KEEP90':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5']},
 'COMBO_BEST_WR':{'RENDERUSDT':['btc3h_ge_-1'],'DOTUSDT':['RET6H_GE_MINUS4'],'JUPUSDT':['RET12H_GE_MINUS5']},
 'COMBO_ATR_DOT_JUP':{'RENDERUSDT':['atr3h_le_0.8'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5']},
 'COMBO_ATR_JUP_ONLY':{'RENDERUSDT':['atr3h_le_0.8'],'JUPUSDT':['RET12H_GE_MINUS5']},
 'COMBO_BTC_ATR_JUP_ONLY':{'RENDERUSDT':['btc3h_ge_-1.5','atr3h_le_0.8'],'JUPUSDT':['RET12H_GE_MINUS5']},
 'COMBO_BTC_DOT_JUP3_GE_M1P5':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'COMBO_BTC_DOT_JUP3_GE_M1':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1']}
}
for x in CASE_RULES.values():
 for filters in x.values():
  for rule in filters:assert rule in screen.RULES,(rule,'RULE_UNDEFINED')
ACTIVE={'case':None,'evaluated':collections.Counter(),'blocked':collections.Counter(),
        'baselineFeatureMissing':collections.Counter()}
def causal_entry_filter(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
 accepted=origin(rows,overlays,source,cost_bps,obs,baseline_lookup)
 pol=CASE_RULES[ACTIVE['case']]
 kept=[]
 for row in accepted:
  sym=row.get('symbol')
  if row.get('strategy_id')!='IDLE' or row.get('side')!='SHORT' or sym not in pol:
   kept.append(row);continue
  ts=row.get('entry_ts_ms')
  if ts is None:raise RuntimeError(('MISSING_IDLE_ENTRY_TS',row.get('candidate_id')))
  ACTIVE['evaluated'][sym]+=1
  features=screen.feat.get_feat(source,sym,int(ts))
  if features is None:
   ACTIVE['baselineFeatureMissing'][sym]+=1
   # Fail closed only for targeted candidate. Do not silently accept a missing causal feature.
   raise RuntimeError(('UNVERIFIED_M5_CAUSAL_FEATURES',sym,ts,row.get('candidate_id')))
  if all(screen.accept(features,screen.RULES[r]) for r in pol[sym]):
   kept.append(row)
  else:
   ACTIVE['blocked'][sym]+=1
   obs['idleEntryThreeBlocked']=obs.get('idleEntryThreeBlocked',0)+1
   obs.setdefault('idleEntryThreeVetoAudit',[]).append({'candidateId':row.get('candidate_id'),
     'ts':int(ts),'symbol':sym,'case':ACTIVE['case'],
     'ret1h':features['ret1h'],'btc3h':features['btc3h'],
     'ret6h':features['ret6h'],'rel6h':features['rel6h']})
 return kept
native.m.m.entry_filter=causal_entry_filter
def main():
 pa=argparse.ArgumentParser()
 pa.add_argument('--output',required=True,type=Path)
 pa.add_argument('--case',required=True,choices=list(CASE_RULES))
 args=pa.parse_args()
 assert base.REPO not in (args.output.resolve(),*args.output.resolve().parents)
 ACTIVE['case']=args.case
 base.CASES={args.case:{'longRules':[],'longScope':'BOTH'}}
 before=list(sys.argv)
 try:
  sys.argv=[str(HERE/'research-pengu-combined-normal8-recovery24-full8-20261024.py'),
   '--output',str(args.output),'--cases',args.case]
  print('IDLE_CAUSAL_ENTRY_NEW_CASE',args.case,CASE_RULES[args.case],flush=True)
  parent.main()
  print('IDLE_ENTRY_CAUSAL_FILTER_AUDIT',args.case,'EVALUATED',dict(ACTIVE['evaluated']),
     'BLOCKED',dict(ACTIVE['blocked']),'MISSING',dict(ACTIVE['baselineFeatureMissing']),flush=True)
 finally:sys.argv=before
if __name__=='__main__':main()
