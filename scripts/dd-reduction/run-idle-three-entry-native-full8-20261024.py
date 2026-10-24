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
render_floor=load('idle_render_cost_floor',HERE/'idle-render-profit-floor-upgrade-20261024.py')
render_initial=load('idle_render_watch_entry_risk',HERE/'screen-idle-next-m5-after-pengu-20261024.py')
rebound=load('idle_render_rebound_feature',HERE/'research-idle-render-rebound-fade-20261024.py')
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
 'COMBO_BTC_DOT_JUP3_GE_M1':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1']},
 'RENDER_CO_DECLINE_AND_JUP_M1P5':{'RENDERUSDT':['btc3h_ge_-1.5','not_btc3lt_m1_and_ret3lt_m1p5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'RENDER_CO_DECLINE_STRONG_AND_JUP_M1P5':{'RENDERUSDT':['btc3h_ge_-1.5','not_btc3lt_m1_and_ret3lt_m1'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'RENDER_CO_M1P5_FLOOR0P5':{'RENDERUSDT':['btc3h_ge_-1.5','not_btc3lt_m1_and_ret3lt_m1p5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'RENDER_CO_M1P5_FLOOR0P75':{'RENDERUSDT':['btc3h_ge_-1.5','not_btc3lt_m1_and_ret3lt_m1p5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'RENDER_PROFIT_F05_JUP_M1P5':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'RENDER_PROFIT_F075_JUP_M1P5':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'RENDER_REBOUND_NO_LATE_DUMP':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'RENDER_REBOUND_NO_SHARP1H_DUMP':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'RENDER_PROFIT_F035_JUP_M1P5':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'RENDER_PROFIT_F040_JUP_M1P5':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'RENDER_PROFIT_F045_JUP_M1P5':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'RENDER_INITIAL_WATCH1_2H_JUP_M1P5':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']},
 'RENDER_INITIAL_WATCH1_2H_F035_JUP_M1P5':{'RENDERUSDT':['btc3h_ge_-1.5'],'DOTUSDT':['ret1h_ge_-1'],'JUPUSDT':['RET12H_GE_MINUS5','ret3h_ge_-1.5']}
}
for x in CASE_RULES.values():
 for filters in x.values():
  for rule in filters:assert rule in screen.RULES,(rule,'RULE_UNDEFINED')
REBOUND_POLICY={'RENDER_REBOUND_NO_LATE_DUMP':'VETO_WEAK_REBOUND_LATE_DUMP',
 'RENDER_REBOUND_NO_SHARP1H_DUMP':'VETO_LAST1H_SHARP_DUMP'}
RENDER_WATCH_CASES={'RENDER_INITIAL_WATCH1_2H_JUP_M1P5','RENDER_INITIAL_WATCH1_2H_F035_JUP_M1P5'}
PROFIT_FLOOR={'RENDER_INITIAL_WATCH1_2H_F035_JUP_M1P5':.0035,'RENDER_PROFIT_F035_JUP_M1P5':.0035,'RENDER_PROFIT_F040_JUP_M1P5':.004,'RENDER_PROFIT_F045_JUP_M1P5':.0045,'RENDER_PROFIT_F05_JUP_M1P5':.005,'RENDER_PROFIT_F075_JUP_M1P5':.0075,'RENDER_CO_M1P5_FLOOR0P5':.005,'RENDER_CO_M1P5_FLOOR0P75':.0075}
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
  valid=all(screen.accept(features,screen.RULES[r]) for r in pol[sym])
  if valid and sym=='RENDERUSDT' and ACTIVE['case'] in REBOUND_POLICY:
   feat=rebound.get(source,sym,int(ts))
   if feat is None:raise RuntimeError(('RENDER_M5_CAUSAL_DATA_MISSING',sym,ts))
   valid=rebound.rule_accept(feat,REBOUND_POLICY[ACTIVE['case']])
  if valid:kept.append(row)
  else:
   ACTIVE['blocked'][sym]+=1
   obs['idleEntryThreeBlocked']=obs.get('idleEntryThreeBlocked',0)+1
   obs.setdefault('idleEntryThreeVetoAudit',[]).append({'candidateId':row.get('candidate_id'),
     'ts':int(ts),'symbol':sym,'case':ACTIVE['case'],
     'ret1h':features['ret1h'],'btc3h':features['btc3h'],
     'ret6h':features['ret6h'],'rel6h':features['rel6h']})
 if ACTIVE['case'] in RENDER_WATCH_CASES:
  checked=[]
  for row in kept:
   if row.get('strategy_id')=='IDLE' and row.get('symbol')=='RENDERUSDT' and row.get('side')=='SHORT':
    ent=int(row['entry_ts_ms'])
    traj=render_initial.path_short(row,source)
    rule=render_initial.CASES['TOUCH1_WATCH2_MFE0.25']
    stop=render_initial.stop(traj,rule,ent)
    if stop is not None and ent<int(stop['ts'])<int(row['exit_ts_ms']):
     obs['renderInitialWatch1TwoHTriggers']=obs.get('renderInitialWatch1TwoHTriggers',0)+1
     obs.setdefault('renderInitialWatch1TwoHEvidence',[]).append({
        'candidateId':row.get('candidate_id'),'oldExitTs':row['exit_ts_ms'],
        'earlyExitTs':int(stop['ts']),'priceChangePct':stop['gainFillNext']})
     row=dict(row,exit_ts_ms=int(stop['ts']),exit_price=float(stop['fillPrice']),
       unit_price_return=1-float(stop['fillPrice'])/float(row['entry_price']),
       exit_reason='RESEARCH_RENDER_INIT_MINUS1_AFTER_TOUCH_TWO_HOURS_MFE025')
   checked.append(row)
  kept=checked
 if ACTIVE['case'] in PROFIT_FLOOR:
  upgraded=[]
  stat=obs.setdefault('renderProfitFloorUpgrade',collections.Counter())
  for row in kept:
   upgraded.append(render_floor.upgrade(row,source,cost_bps,PROFIT_FLOOR[ACTIVE['case']],stat))
  kept=upgraded
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
