#!/usr/bin/env python3
"""HYPE entry win-rate research: causal pre-allocation candidate veto ONLY for HYPE.
Retain all previously user-accepted V4 four and Q102 three exits.
No changes to other strategies' rules, no post-hoc accepted-trade pruning.
Native eight-strategy historical compound economic replay 10/30bps.
"""
from __future__ import annotations
import argparse,bisect,collections,hashlib,importlib.util,json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
def load(alias,filename):
 spec=importlib.util.spec_from_file_location(alias,HERE/filename)
 assert spec and spec.loader
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
base=load('hype_cumulative_baseline','run-q102-adopted2-plus-hvlong-h1-2h-20261022.py')
core=base.core
M5=core.M5;HOUR=core.HOUR
ROOT=Path(r'C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research')
OUT=ROOT/'2026-10-22_hype_entry_winrate_after_v4_q102adopted3_full8'
PREV=ROOT/'2026-10-22_q102_adopted2_plus_hvlong_2h_bt/v4-locked-q102-cumulative-results.json'
POLICIES={
 'HYPE_BTC3H_LE0P6':{'id':'HYPE_BTC3H_LE0P6','btc3hMaxPct':.6},
 'HYPE_REL3H_GE3P0':{'id':'HYPE_REL3H_GE3P0','hypeMinusBtc3hMinPct':3.0},
 'HYPE_BTC3H_LE0P8_REL3H_GE2P0':{'id':'HYPE_BTC3H_LE0P8_REL3H_GE2P0','btc3hMaxPct':.8,'hypeMinusBtc3hMinPct':2.0},
 'HYPE_BTC3H_LE0P6_REL3H_GE2P0':{'id':'HYPE_BTC3H_LE0P6_REL3H_GE2P0','btc3hMaxPct':.6,'hypeMinusBtc3hMinPct':2.0},
}
ACTIVE={'policy':None,'source':None,'lookups':{},'passed':set(),'blocked':set(),'missing':set()}
def pre_entry_features(source,entry_ts_ms):
 ts=int(entry_ts_ms)
 found=ACTIVE['lookups'].get(ts,'UNSET')
 if found!='UNSET':return found
 values={}
 for sym in ('BTCUSDT','HYPEUSDT'):
  bars,times=source.getdata(sym)
  i=bisect.bisect_left(times,ts)-1
  if i<36 or int(times[i])+M5>ts or int(times[i])-int(times[i-36])!=36*M5:
   ACTIVE['lookups'][ts]=None;return None
  now=float(bars[i][4]);old=float(bars[i-36][4])
  if now<=0 or old<=0:
   ACTIVE['lookups'][ts]=None;return None
  values[sym]=(now/old-1)*100
 btc=values['BTCUSDT'];hype=values['HYPEUSDT']
 data={'BTC3hPct':btc,'HYPE3hPct':hype,'REL3hPct':hype-btc}
 ACTIVE['lookups'][ts]=data
 return data

def gate_hype(row,policy,source):
 if row.get('strategy_id')!='HYPE_LONG':return True
 ts=row.get('entry_ts_ms')
 if ts is None:
  ACTIVE['missing'].add(('NO_TIMESTAMP',str(row.get('candidate_id'))));return False
 feat=pre_entry_features(source,ts)
 if feat is None:
  ACTIVE['missing'].add(('NO_CAUSAL_PRICE_WINDOW',str(row.get('candidate_id'))));return False
 if 'btc3hMaxPct' in policy and feat['BTC3hPct']>policy['btc3hMaxPct']:return False
 if 'hypeMinusBtc3hMinPct' in policy and feat['REL3hPct']<policy['hypeMinusBtc3hMinPct']:return False
 return True

def candidate_transform(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
 # Retains accepted exact V4/Q102 7-rule transformed candidate economic positions,
 # THEN veto HYPE BEFORE the native allocator/competition for slots and pending gross.
 after=base.filtered_transform(rows,overlays,source,cost_bps,obs,baseline_lookup)
 policy=ACTIVE['policy']
 if not policy:return after
 kept=[]
 for row in after:
  if row.get('strategy_id')!='HYPE_LONG':
   kept.append(row);continue
  ident=str(row.get('candidate_id'))
  if gate_hype(row,policy,source):
   kept.append(row);ACTIVE['passed'].add(ident)
  else:ACTIVE['blocked'].add(ident)
 return kept

def readjsonl(path):
 return [json.loads(l) for l in Path(path).read_text('utf8').splitlines() if l.strip()]
def cooldown_run(name,cost,source,helper,previous,policy,iterations_max=5):
 prior_events=None;iterations=[];last=None
 for i in range(iterations_max):
  base.CURRENT.clear()
  if prior_events is not None:base.CURRENT['cooldown_events']=prior_events
  ACTIVE['policy']=policy
  ACTIVE['lookups'].clear();ACTIVE['passed'].clear();ACTIVE['blocked'].clear();ACTIVE['missing'].clear()
  run=core._run_engine(f'HYPE_WINRATE_{name}_C{cost}_I{i}','V12_LONG_COMPOSITE',
      [base.V4,base.Q102_CASES['Q102_ADOPTED2_PLUS_HV_LONG_H1_2H_MINUS3']],
      cost,source,helper,previous)
  if run['accounting']!='PASS':raise RuntimeError('ACCOUNTING_FAIL')
  events=base.actual_cooldown_events(run)
  iterations.append({'iteration':i,'candidateHypePasses':len(ACTIVE['passed']),
    'candidateHypeBlocked':len(ACTIVE['blocked']),'sourceMissing':len(ACTIVE['missing']),
    'priorAdmittedCooldowns':len(prior_events or []),
    'observedAdmittedStops':len(events)})
  last=run
  if events==prior_events:break
  if i==iterations_max-1:raise RuntimeError('ACCEPTED_SHORT_COOLDOWN_NOT_CONVERGED')
  prior_events=events
 assert last is not None
 assert all(x['sourceMissing']==0 for x in iterations),('SOURCE_MISSING',iterations)
 return last,iterations

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--cases',nargs='+',default=list(POLICIES))
 parser.add_argument('--output',type=Path,default=OUT)
 args=parser.parse_args()
 if len(args.cases)!=len(set(args.cases)) or not set(args.cases).issubset(POLICIES):raise ValueError('INVALID_CASE_IDS')
 if args.output.resolve()==PREV.parent.resolve():raise ValueError('REFUSE_BASELINE_OVERWRITE')
 args.output.mkdir(parents=True,exist_ok=True)
 anchor=json.loads(PREV.read_text('utf8'))
 assert anchor['sourceArchiveSha256'] and anchor['results']['Q102_ADOPTED2_PLUS_HV_LONG_H1_2H_MINUS3']['all4Locked']
 prior=anchor['results']['Q102_ADOPTED2_PLUS_HV_LONG_H1_2H_MINUS3']['costs']
 core.OUTPUT=args.output;core.BOOTSTRAP_REDIRECT=args.output/'_legacy-bootstrap-cache'
 core._transform_rows=candidate_transform
 core._apply_initial_stop=base.apply;core._matches=base.ORIGINAL_MATCHES
 source,helper=core.task8.legacy.bootstrap()
 base.install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 prev_factory=helper.experiment_filter
 results={}
 for name in args.cases:
  policy=POLICIES[name];out={}
  for cost in (10,30):
   latest,iters=cooldown_run(name,cost,source,helper,prev_factory,policy)
   trades=readjsonl(latest['ledger'])
   hype=[t for t in trades if t['strategy_id']=='HYPE_LONG']
   hype_wins=sum(float(r['modeled_realized_pnl_jpy_at_exit_fx'])>0 for r in hype)
   hype_losses=len(hype)-hype_wins
   ref=prior[str(cost)]
   out[str(cost)]={
    'finalEquityJpy':latest['final_equity_jpy'],
    'maxMtmDdPct':latest['maximum_mtm_drawdown_pct'],
    'profitFactor':latest['profit_factor'],'closedTrades':latest['closed_trades'],
    'hypeAcceptedTrades':len(hype),'hypeWins':hype_wins,'hypeLosses':hype_losses,
    'hypeWinRatePct':100*hype_wins/len(hype) if hype else 0,
    'hypeRealizedPnlJpy':sum(float(r['modeled_realized_pnl_jpy_at_exit_fx']) for r in hype),
    'equityVsSevenAdoptedJpy':latest['final_equity_jpy']-ref['finalEquityJpy'],
    'ddVsSevenAdoptedPp':latest['maximum_mtm_drawdown_pct']-ref['maxMtmDdPct'],
    'cooldownPasses':iters,'V12AdmittedShortStopCount':len(base.actual_cooldown_events(latest)),
    'accounting':'PASS'
   }
   print('CASE',name,'COST',cost,'HYPE',len(hype),'WR',round(out[str(cost)]['hypeWinRatePct'],3),
     'EQUITY',round(latest['final_equity_jpy']),'DD',round(latest['maximum_mtm_drawdown_pct'],5),
     'PENDING_GATE',iters[-1]['candidateHypeBlocked'],'ITER',len(iters),flush=True)
  results[name]={'policy':policy,'costs':out,'V4FourAndQ102ThreeExitsLocked':True,'HypeEntryGateResearchOnly':True}
  (args.output/'HYPE_WINRATE_FULL8_INTEGRATED_20261022.json').write_text(json.dumps({
   'status':'HYPE_ENTRY_CAUSAL_PREALLOCATION_WINRATE_RESEARCH_NOT_LIVE',
   'period':'2025-08-10 to 2026-08-10','initialJpy':10000,'costBps':[10,30],
   'sourceArchiveSha256':anchor['sourceArchiveSha256'],
   'acceptedV4FourAndQ102ThreeLocked':True,'hypeExistingHype75ExitUnchanged':True,
   'latestIndependentTask9TSEconomicParityNotCertified':True,
   'productionOrOrdersChanged':False,'priorAcceptedBaseline':{
    c:{k:prior[c][k] for k in ('finalEquityJpy','maxMtmDdPct','profitFactor','closedTrades')}
    for c in ('10','30')},'results':results},ensure_ascii=False,indent=2)+'\n','utf8')
 print('COMPLETE',len(results),flush=True)
if __name__=='__main__':main()
