#!/usr/bin/env python3
"""Research-only cumulative all-8 strategy LONG/SHORT exit sweeps. No LIVE writes."""
from __future__ import annotations
import json,sys,math,time,traceback,hashlib
from pathlib import Path
P=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(P/'research'))
import long_short_sequential_full8_bt_20261019 as seq
import sequential_full8_side_loss_metrics_20261019 as side
REPORT=P/'docs/research/results/long-loss-research-20261019'
OUTFILE=REPORT/'SEQUENTIAL_STEP05_TO_12_CUMULATIVE_20261019.json'
SUITES=[
 ('S05','Q102','LONG'),
 ('S06','V12','LONG'),
 ('S07','IDLE','LONG'),
 ('S08','RESIDUAL','SHORT'),
 ('S09','IDLE','SHORT'),
 ('S10','FET','LONG'),
 ('S11','V52','LONG'),
 ('S12','V52','SHORT'),
]
def metrics(name,cost,scope):
 x=seq.portfolio_run(name,scope,cost)
 assert x['accounting']=='PASS'
 return x
def getside(name,cost,strategydir):
 return side.losses(side.ledger(name,cost)).get(strategydir, {'n':0,'losses':0,'sum_negative_wallet_contributions_pp':0,
      'worst_trade_wallet_pct':0,'positive_realized_sum_pnl_units':0})
def savestate(obj):
 tmp=OUTFILE.with_suffix('.json.tmp')
 tmp.write_text(json.dumps(obj,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
 tmp.replace(OUTFILE)
def campaign():
 REPORT.mkdir(parents=True,exist_ok=True)
 seq.setup_for_runs()
 base=[]
 for c in [10,30]:
  old=json.loads((REPORT/f'SEQUENTIAL_S02_HYPE_LONG_INITIAL_WALLET_1P5_{c}BPS.json').read_text('utf8'))
  name='RECHECK_HYPE_LONG_INITIAL_WALLET_1P5'
  x=metrics(name,c,[seq.HYPE2])
  assert math.isclose(x['full8_final_jpy'],old['full8_final_jpy'],rel_tol=1e-10)
  assert math.isclose(x['full8_max_dd_pct'],old['full8_max_dd_pct'],abs_tol=1e-8)
  base.append(x)
 print('CONTROL_S02_FULL8_REPLAY_10_30_EXACT_PASS',flush=True)
 original={'sha256_engine':hashlib.sha256((P/'research/long_short_sequential_full8_bt_20261019.py').read_bytes()).hexdigest(),
 'reference_10':base[0],'reference_30':base[1]}
 docs={'status':'RUNNING_RESEARCH_ONLY','source_control':original,
   'cumulative_spec': [seq.HYPE2], 'stages':[], 'live_modified':False, 'started_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
   'limitations':['In-sample only','Public M5 scaled to Aster H1; venue fill not certified','Market OHLC not tick path','No LIVE'] }
 cumulative=[seq.HYPE2]
 controls=base
 savestate(docs)
 for idx,(stag,target,direction) in enumerate(SUITES):
  ident=f'{target}_{direction}' if target!='HYPE_LONG' else 'HYPE_LONG_LONG'
  ref=[getside('RECHECK_HYPE_LONG_INITIAL_WALLET_1P5',c,ident) if idx==0 else getside(docs['stages'][-1]['cumulative_policy'],c,ident) for c in (10,30)]
  # Probe target availability and count, not signal count.
  stage={'stage':stag,'target':target,'direction':direction,'baseline_loss':ref,
         'preexisting_cumulative_ids':[z['id'] for z in cumulative],'candidates':[],
         'status':'RUNNING', 'started':time.time()}
  docs['stages'].append(stage)
  if not any(z['n']>0 for z in ref):
   stage['status']='NO_ACCEPTED_TRADES_IN_THIS_SIDE'
   stage['cumulative_policy']=docs['stages'][-2]['cumulative_policy'] if len(docs['stages'])>1 else 'RECHECK_HYPE_LONG_INITIAL_WALLET_1P5'
   savestate(docs)
   print('STAGE_NOT_TRADING',stag,ident,flush=True);continue
  # Separate favorable profit giveback and immediate adverse price/wallet exit.
  cases=[
    {'id':'PROFIT_ARM2_FLOOR0P5','axis':'profit_reversal','arm_close_pct':.02,'locked_profit_pct':.005},
    {'id':'PROFIT_ARM3_FLOOR1','axis':'profit_reversal','arm_close_pct':.03,'locked_profit_pct':.01},
    {'id':'INITIAL_WALLET1P5','axis':'initial_adverse','max_initial_wallet_loss_pct':.015},
    {'id':'INITIAL_WALLET2P5','axis':'initial_adverse','max_initial_wallet_loss_pct':.025},
  ]
  eligible=[]
  for zz,simple in enumerate(cases):
   spec={'id':f'{stag}_{target}_{direction}_{simple["id"]}','target':target,'side':direction,
         'stop_slip_bps':10,**{a:b for a,b in simple.items() if a!='id'}}
   policy=f'CUM_{stag}_{target}_{direction}_{simple["id"]}_TEST'
   trial={'id':spec['id'],'spec':spec,'policy':policy,'comparisons':[],'status':'RUNNING'}
   stage['candidates'].append(trial);savestate(docs)
   try:
    for j,c in enumerate([10,30]):
     out=metrics(policy,c,cumulative+[spec])
     after=getside(policy,c,ident);before=ref[j]
     change=round(out['full8_max_dd_pct']-controls[j]['full8_max_dd_pct'],7)
     saved=round(after['sum_negative_wallet_contributions_pp']-before['sum_negative_wallet_contributions_pp'],5)
     tr={'cost_bps':c,'max_dd_pct':out['full8_max_dd_pct'],'final_jpy':out['full8_final_jpy'],
      'pf':out['full8_pf'],'trades':out['closed_trades'],'DD_improvement_pp':change,
      'negative_loss_reduction_pp':saved,
      'worst_trade_improvement_pp':round(after['worst_trade_wallet_pct']-before['worst_trade_wallet_pct'],5),
      'after_side':after,'before_side':before,'new_stop_events':out['exit_audit'].get(spec['id'],{})}
     trial['comparisons'].append(tr)
    ddgood=all(z['DD_improvement_pp']>=-0.0001 for z in trial['comparisons'])
    ddmaterial=all(z['DD_improvement_pp']>=0.005 for z in trial['comparisons'])
    loss_material=all(z['negative_loss_reduction_pp']>=0.5 and z['worst_trade_improvement_pp']>=-0.001 for z in trial['comparisons'])
    change_trades=all(z['trades']>=int(0.95*controls[i]['closed_trades']) for i,z in enumerate(trial['comparisons']))
    positive_pf=all(z['pf']>1 for z in trial['comparisons'])
    good=ddgood and (ddmaterial or loss_material) and change_trades and positive_pf
    trial['base_qualified']=good;trial['status']='COMPLETED'
    if good:eligible.append(trial)
    print('CASE',stag,spec['id'],'10DD',round(trial['comparisons'][0]['max_dd_pct'],4),
       '30DD',round(trial['comparisons'][1]['max_dd_pct'],4),
       'loss_saved_10',round(trial['comparisons'][0]['negative_loss_reduction_pp'],3),
       'qualified',good,flush=True)
   except Exception as e:
    trial['status']='BLOCKED_BY_DATA_OR_EXECUTION'
    trial['error']=type(e).__name__+': '+str(e)[:350]
    print('CASE_ERROR',stag,spec['id'],trial['error'],flush=True)
   savestate(docs)
  # If no two-cost pass, reject all and preserve previous cumulative 8-logic policy.
  rank=lambda t:(min(z['DD_improvement_pp'] for z in t['comparisons']),
                 min(z['negative_loss_reduction_pp'] for z in t['comparisons']),
                 t['comparisons'][0]['final_jpy'])
  eligible.sort(key=rank,reverse=True)
  promoted=None
  for trial in eligible[:2]:
   # Test real 0%,1%,2% stop slippage before deciding carry.
   stresses=[]
   for slip in [0,100,200]:
    spec=dict(trial['spec'],stop_slip_bps=slip,id=trial['spec']['id']+f'_S{slip}')
    q={'stop_slip_bps':slip,'metrics':[],'status':'RUNNING'}
    stresses.append(q)
    try:
     for j,c in enumerate([10,30]):
      policy=f'CUM_{stag}_{target}_{direction}_{trial["id"]}_SLIP_{slip}'
      result=metrics(policy,c,cumulative+[spec])
      after=getside(policy,c,ident)
      q['metrics'].append({'cost_bps':c,'max_dd_pct':result['full8_max_dd_pct'],
       'DD_improvement_pp':round(result['full8_max_dd_pct']-controls[j]['full8_max_dd_pct'],6),
       'final_jpy':result['full8_final_jpy'],'trades':result['closed_trades'],
       'negative_loss_reduction_pp':round(after['sum_negative_wallet_contributions_pp']-ref[j]['sum_negative_wallet_contributions_pp'],4)})
     q['status']='DONE'
    except Exception as e:q['status']='ERROR';q['error']=str(e)[:350]
    savestate(docs)
   trial['stop_slippage_0_1_2_pct']=stresses
   # Stress is disclosed; only base research selection requires 10bps modeled STOP slip.
   if all(x['status']=='DONE' for x in stresses):
    promoted=trial
    break
  if promoted:
   cumulative.append(promoted['spec'])
   chosen=promoted['comparisons']
   controls=[{'full8_max_dd_pct':q['max_dd_pct'],'full8_final_jpy':q['final_jpy'],
     'closed_trades':q['trades'],'full8_pf':q['pf']} for q in chosen]
   stage['status']='PROVISIONAL_CARRY_RESEARCH_ONLY'
   stage['selected']=promoted['id']
   stage['cumulative_policy']=promoted['policy']
  else:
   stage['status']='NO_CANDIDATE_ADOPTED' if all(x['status']=='COMPLETED' for x in stage['candidates']) else 'BLOCKED_CANDIDATE_DATA'
   stage['selected']=None
   stage['cumulative_policy']=docs['stages'][-2]['cumulative_policy'] if len(docs['stages'])>1 else 'RECHECK_HYPE_LONG_INITIAL_WALLET_1P5'
  stage['finished']=time.time()
  docs['cumulative_spec']=cumulative
  savestate(docs)
  print('STAGE_FINISH',stag,ident,stage['status'],'CUMULATIVE',[x['id'] for x in cumulative],flush=True)
 docs['status']='COMPLETED_EIGHT_SCOPES_RESEARCH_ONLY'
 docs['finished_utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
 savestate(docs)
 print('CAMPAIGN_COMPLETE',str(OUTFILE),flush=True)
if __name__=='__main__':
 try:campaign()
 except Exception:
  traceback.print_exc();raise
