#!/usr/bin/env python3
"""HYPE LONG optional exits after locking V4 four + Q102 THREE USER-ADOPTED rules.
All 8-logic native dynamic portfolio BT, 2025-08-10..2026-08-10, JPY 10k,
10/30bps. Historic model only; no trading or current production claims.
"""
from __future__ import annotations
import argparse,bisect,collections,importlib.util,json,math,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
def load(alias,filename):
 spec=importlib.util.spec_from_file_location(alias,HERE/filename)
 assert spec and spec.loader
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 return module
base=load('Q102_3_user_adopted_all8','run-q102-adopted2-plus-hvlong-h1-2h-20261022.py')
core=base.core
HOUR=core.HOUR;M5=core.M5
ROOT=Path(r'C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research')
PREVIOUS=ROOT/'2026-10-22_q102_adopted2_plus_hvlong_2h_bt/v4-locked-q102-cumulative-results.json'
OUT=ROOT/'2026-10-22_hype_conservative_profit3_after_v4_q102adopted3'
Q102_3=base.Q102_CASES['Q102_ADOPTED2_PLUS_HV_LONG_H1_2H_MINUS3']
assert Q102_3['preprofit_close_arm']==999. and Q102_3['arm_hours']==2
V4=base.V4
HYPE_CASES={
 'HYPE_PROFIT_ARM3_FLOOR1':{'id':'HYPE_PROFIT_ARM3_FLOOR1','strategy':'HYPE_LONG','sides':['LONG'],
  'kind':'profit','arm':.03,'floor':.01},
 'HYPE_EARLY_1H_MINUS1_MFE0P3':{'id':'HYPE_EARLY_1H_MINUS1_MFE0P3','strategy':'HYPE_LONG','sides':['LONG'],
  'kind':'initial','arm_hours':1,'stop_pct':.01,'mfe_gate_pct':.003,'reentry_hours':0},
 'HYPE_EARLY_0H_MINUS1P5_MFE0P3':{'id':'HYPE_EARLY_0H_MINUS1P5_MFE0P3','strategy':'HYPE_LONG','sides':['LONG'],
  'kind':'initial','arm_hours':0,'stop_pct':.015,'mfe_gate_pct':.003,'reentry_hours':0},
 'HYPE_PROFIT_ARM0P8_FLOOR0P3':{'id':'HYPE_PROFIT_ARM0P8_FLOOR0P3','strategy':'HYPE_LONG','sides':['LONG'],
  'kind':'profit','arm':.008,'floor':.003},
 'HYPE_PROFIT_ARM1P5_FLOOR0P5':{'id':'HYPE_PROFIT_ARM1P5_FLOOR0P5','strategy':'HYPE_LONG','sides':['LONG'],
  'kind':'profit','arm':.015,'floor':.005},
 'HYPE_BOTH_EARLY1H_PROFIT1P5':{'id':'HYPE_BOTH_EARLY1H_PROFIT1P5','strategy':'HYPE_LONG','sides':['LONG'],
  'kind':'combined','arm_hours':1,'stop_pct':.01,'mfe_gate_pct':.003,'reentry_hours':0,
  'arm':.015,'floor':.005},
}
def profit_after_confirmed_m5(row,rule,source,cost_bps,obs):
 if row.get('strategy_id')!='HYPE_LONG' or row.get('side')!='LONG':return row
 entry=float(row['entry_price']);entry_ts=int(row['entry_ts_ms']);old_exit=int(row['exit_ts_ms'])
 if entry<=0 or entry_ts+2*M5>=old_exit:return row
 bars,times=source.getdata(str(row['symbol']))
 start=bisect.bisect_left(times,entry_ts);end=bisect.bisect_left(times,old_exit)
 if start>=end or start>=len(bars) or times[start]>entry_ts+M5:
  obs['data_gap']+=1;return row
 anchor=float(bars[start][1])
 if abs(anchor/entry-1)>.025:
  obs['entry_mismatch']+=1;return row
 scale=entry/anchor;armed=False
 obs['eligible']+=1
 stop=entry*(1+float(rule['floor']))
 for i in range(start,end):
  ts,op,high,low,close,_v=bars[i]
  if i>start and ts-bars[i-1][0]!=M5:
   obs['internal_gap']+=1;return row
  o=float(op)*scale;l=float(low)*scale;c=float(close)*scale
  if armed and (o<=stop or l<=stop):
   raw=min(o,stop)
   fill=raw*(1-float(cost_bps)/10000)
   t_exit=int(ts+M5)
   if t_exit<old_exit and fill>0:
    obs['triggered']+=1
    obs['by_reason']['HYPE_PROFIT_AFTER_CONFIRMED_M5']+=1
    return dict(row,exit_ts_ms=t_exit,exit_price=fill,
       unit_price_return=fill/entry-1,
       exit_reason='RESEARCH_'+str(rule['id']))
  # Only completed M5 CLOSE can arm protection on the following bar.
  if c>=entry*(1+float(rule['arm'])):armed=True
 return row

def apply(row,rule,source,cost_bps,obs,original_row=None):
 if not base.ORIGINAL_MATCHES(row,rule):return row
 if row.get('strategy_id')!='HYPE_LONG':
  return base.apply(row,rule,source,cost_bps,obs,original_row=original_row)
 kind=rule.get('kind')
 if kind=='initial':
  return base.ORIGINAL_APPLY(row,rule,source,cost_bps,obs,original_row=original_row)
 if kind=='profit':return profit_after_confirmed_m5(row,rule,source,cost_bps,obs)
 if kind=='combined':
  initial=base.ORIGINAL_APPLY(row,rule,source,cost_bps,obs,original_row=original_row)
  profit=profit_after_confirmed_m5(row,rule,source,cost_bps,obs)
  return min((row,initial,profit),key=lambda x:int(x['exit_ts_ms']))
 raise RuntimeError('UNEXPECTED_HYPE_VARIANT')

def readjsonl(file):
 return [json.loads(t) for t in Path(file).read_text('utf8').splitlines() if t.strip()]

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--cases',nargs='+',default=['HYPE_BASELINE_3ACCEPTED',*HYPE_CASES])
 parser.add_argument('--output',type=Path,default=OUT)
 parser.add_argument('--cooldown',action='store_true')
 args=parser.parse_args()
 assert len(args.cases)==len(set(args.cases))
 assert all(x=='HYPE_BASELINE_3ACCEPTED' or x in HYPE_CASES for x in args.cases)
 assert args.output.resolve()!=ROOT.resolve()
 args.output.mkdir(parents=True,exist_ok=True)
 orig=json.loads(PREVIOUS.read_text('utf8'))
 assert orig['sourceArchiveSha256'] and orig['results']['Q102_ADOPTED2_PLUS_HV_LONG_H1_2H_MINUS3']['all4Locked']
 fixed=orig['results']['Q102_ADOPTED2_PLUS_HV_LONG_H1_2H_MINUS3']['costs']
 core.OUTPUT=args.output
 core.BOOTSTRAP_REDIRECT=args.output/'_legacy-bootstrap-cache'
 core._transform_rows=base.filtered_transform
 core._apply_initial_stop=apply
 core._matches=base.ORIGINAL_MATCHES
 source,helper=core.task8.legacy.bootstrap()
 base.install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 out={}
 for name in args.cases:
  overlays=[V4,Q102_3]+([] if name=='HYPE_BASELINE_3ACCEPTED' else [HYPE_CASES[name]])
  rows={}
  for cost in (10,30):
   base.CURRENT.clear()
   prior_events=None
   iterations=[]
   last=None
   for ix in range(5 if args.cooldown else 1):
    if prior_events is not None:base.CURRENT['cooldown_events']=prior_events
    run=core._run_engine(f'HYPE3ACCEPTED_{name}_C{cost}_I{ix}',
       'V12_LONG_COMPOSITE',overlays,cost,source,helper,previous)
    assert run['accounting']=='PASS'
    events=base.actual_cooldown_events(run)
    iterations.append({'iteration':ix,'acceptedV4ShortInitialStopCount':len(events),
                       'enforcedPreviousCooldownCount':len(prior_events or [])})
    last=run
    if not args.cooldown or events==prior_events:break
    if ix==4:raise RuntimeError('ACCEPTED_FILL_COOLDOWN_DID_NOT_CONVERGE')
    prior_events=events
   assert last is not None
   sm=base.summary(last,None,None) if False else None
   trades=readjsonl(last['ledger'])
   exits=collections.Counter(str(x.get('exit_reason_actual')) for x in trades if x.get('strategy_id')=='HYPE_LONG')
   baseline=fixed[str(cost)]
   rows[str(cost)]={
    'finalEquityJpy':last['final_equity_jpy'],
    'maxMtmDdPct':last['maximum_mtm_drawdown_pct'],
    'profitFactor':last['profit_factor'],
    'closedTrades':last['closed_trades'],
    'hypeAcceptedTrades':sum(x.get('strategy_id')=='HYPE_LONG' for x in trades),
    'hypeExitReasons':dict(exits),
    'deltaEquityAgainstQ102ThreeAdoptedJpy':last['final_equity_jpy']-baseline['finalEquityJpy'],
    'ddImprovementAgainstQ102ThreeAdoptedPp':last['maximum_mtm_drawdown_pct']-baseline['maxMtmDdPct'],
    'cooldownIterations':iterations,
    'acceptedShortStopsFromRealAdmittedModelExits':len(base.actual_cooldown_events(last)),
    'accounting':'PASS',
   }
   print('CASE',name,cost,'EQUITY',round(last['final_equity_jpy']),
     'DD',round(last['maximum_mtm_drawdown_pct'],5),
     'HYPE_TRADES',rows[str(cost)]['hypeAcceptedTrades'],
     'NEW_HYPE_EXIT_COUNT',sum(v for k,v in exits.items() if k.startswith('RESEARCH_HYPE')),
     'REPLAY_PASSES',len(iterations),flush=True)
  out[name]={'allV4FourAndQ102ThreeAdoptedRulesFixed':True,
    'hypeNewResearchPolicy':HYPE_CASES.get(name),
    'costs':rows}
  report={
   'status':'HYPE_PROFIT_INITIAL_AFTER_V4_Q102_THREE_ADOPTED_RESEARCH_ONLY',
   'period':'2025-08-10..2026-08-10','initialCapitalJpy':10000,'costBps':[10,30],
   'sourceArchiveSha256':orig['sourceArchiveSha256'],
   'V4FourAndQ102ThreeAlreadyAdoptedLocked':True,
   'hypeEntryHype75RulesUnchanged':True,'otherStrategiesUnmodified':True,
   'researchModelOnly':True,'currentProductionAndVenueCertification':False,
   'baselineQ102ThreeAdopted':{
    c:{k:fixed[c][k] for k in ('finalEquityJpy','maxMtmDdPct','profitFactor','closedTrades')} for c in ('10','30')},
   'results':out}
  (args.output/'HYPE_CUMULATIVE_EXIT_COMPARISON_20261022.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
 print('COMPLETE',len(out),flush=True)
if __name__=='__main__':main()
