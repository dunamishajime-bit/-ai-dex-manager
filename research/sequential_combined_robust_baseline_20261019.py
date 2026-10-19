#!/usr/bin/env python3
"""Research-only combined exit gates and HIGH_VOL-specific profit stop, 8-logic integration."""
from pathlib import Path
import sys,json,math,time,hashlib,traceback
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))
import long_short_sequential_full8_bt_20261019 as seq
import sequential_full8_side_loss_metrics_20261019 as loss
R=ROOT/'docs/research/results/long-loss-research-20261019'
PREV=R/'SEQUENTIAL_ROBUST_BASELINE_9SIDES_20261019.json'
FILE=R/'SEQUENTIAL_COMBINED_ROBUST_TWO_AXIS_AND_HV_20261019.json'
COSTS=(10,30)
SCOPE=[
 ('C01','HYPE_LONG','LONG'),('C02','RESIDUAL','LONG'),('C03','Q102','LONG'),
 ('C04','V12','LONG'),('C05','Q102','SHORT'),('C06','V12','SHORT'),
 ('C07','IDLE','SHORT'),('C08','FET','LONG')
]
# V52 unavailable for 5m full-year coverage (16/35 LONG and 32/52 SHORT valid). No pretend certification.
M5COVERAGE=json.loads((R/'LATEST_8LOGIC_SIDE_LOSS_M5_CLASSIFICATION_20261019.json').read_text('utf8'))['groups']
def write(o):
 f=FILE.with_suffix('.tmp')
 f.write_text(json.dumps(o,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 f.replace(FILE)
def output(name,specs,c):
 out=seq.portfolio_run(name,specs,c)
 assert out['accounting']=='PASS'
 return out
def entry(name,c,target,side):
 return loss.losses(loss.ledger(name,c)).get(target+'_'+side)
def better(t):
 return (all(x['dd_delta_pp']>=-0.0001 for x in t) and
  (all(x['dd_delta_pp']>=0.005 for x in t) or all(x['negative_loss_saved_pp']>=0.5 and x['worst_trade_saved_pp']>=-0.001 for x in t)) and
  all(x['pf']>1 for x in t))
def run():
 if not PREV.is_file():raise AssertionError('MISSING_PRIMARY_SWEEP')
 prior=json.loads(PREV.read_text('utf8'))
 if prior['status']!='COMPLETED_EIGHT_SCOPES_RESEARCH_ONLY':raise AssertionError('PRIMARY_SWEEP_NOT_COMPLETE')
 seq.setup_for_runs()
 base=[dict(q) for q in prior['cumulative_spec']]
 curid='AFTER_INDIVIDUAL_SIDE_SWEEP'
 cur=[output(curid,base,c) for c in COSTS]
 doc={'status':'RUNNING_RESEARCH_ONLY','prior_status':prior['status'],
 'prior_sha256':hashlib.sha256(PREV.read_bytes()).hexdigest(),
 'initial_specs':base,'stages':[],'current_specs':base,'controls_before':[{'dd':x['full8_max_dd_pct'],'equity':x['full8_final_jpy']} for x in cur],
 'not_live':True, 'data_coverage':{x:{'valid':v['valid'],'trades':v['trades']} for x,v in M5COVERAGE.items()},
 'blocked':['V52_LONG: 5m coverage 16/35','V52_SHORT: 5m coverage 32/52']}
 write(doc)
 for id_,target,side in SCOPE:
  tkey=target+'_'+side
  if M5COVERAGE[tkey]['valid']<M5COVERAGE[tkey]['trades']*0.95:
   doc['stages'].append({'id':id_,'scope':tkey,'status':'SKIPPED_COVERAGE'});write(doc);continue
  baseline=[entry(curid,c,target,side) for c in COSTS]
  stage={'id':id_,'scope':tkey,'controls':[{'dd':x['full8_max_dd_pct'],'asset':x['full8_final_jpy']} for x in cur],
    'case_results':[],'selected':None,'status':'RUNNING'}
  doc['stages'].append(stage);write(doc)
  possibilities=[]
  # Each combination tests both independent categories, stop-first and next-confirmed-bar floor.
  for arm,floor in [(.02,.005),(.03,.01)]:
   for maxwallet in [.015,.025]:
    tag=f'{id_}_{target}_{side}_P{int(arm*1000)}_F{int(floor*1000)}_I{int(maxwallet*1000)}'
    specs=[
      {'id':tag+'_PROFIT','target':target,'side':side,'axis':'profit_reversal','arm_close_pct':arm,
       'locked_profit_pct':floor,'stop_slip_bps':10},
      {'id':tag+'_INITIAL','target':target,'side':side,'axis':'initial_adverse','max_initial_wallet_loss_pct':maxwallet,
       'stop_slip_bps':10}
    ]
    q={'policy':tag,'specs':specs,'two_costs':[],'status':'RUNNING'}
    stage['case_results'].append(q);write(doc)
    try:
     for j,c in enumerate(COSTS):
      x=output(tag,base+specs,c)
      a=entry(tag,c,target,side);b=baseline[j]
      q['two_costs'].append({
        'cost':c,'dd':x['full8_max_dd_pct'],'dd_delta_pp':round(x['full8_max_dd_pct']-cur[j]['full8_max_dd_pct'],6),
        'asset':x['full8_final_jpy'],'pf':x['full8_pf'],'trades':x['closed_trades'],
        'negative_loss_saved_pp':round(a['sum_negative_wallet_contributions_pp']-b['sum_negative_wallet_contributions_pp'],5),
        'worst_trade_saved_pp':round(a['worst_trade_wallet_pct']-b['worst_trade_wallet_pct'],5),
        'win_change':a['wins']-b['wins']})
     q['passes']=better(q['two_costs']);q['status']='DONE'
     if q['passes']:possibilities.append(q)
     print('COMBO_CASE',tag,'10DD',round(q['two_costs'][0]['dd'],4),'30DD',round(q['two_costs'][1]['dd'],4),
      '10saved',q['two_costs'][0]['negative_loss_saved_pp'],'pass',q['passes'],flush=True)
    except Exception as e:
     q['status']='ERROR';q['error']=type(e).__name__+': '+str(e)[:400]
     print('COMBO_ERROR',tag,q['error'],flush=True)
    write(doc)
  if possibilities:
   possibilities.sort(key=lambda q:(min(x['dd_delta_pp'] for x in q['two_costs']),
    min(x['negative_loss_saved_pp'] for x in q['two_costs']),q['two_costs'][0]['asset']),reverse=True)
   pick=None
   for proposal in possibilities[:2]:
    stress=[]
    for slip in (0,100,200):
     specs=[dict(x,id=x['id']+f'_SLIP{slip}',stop_slip_bps=slip) for x in proposal['specs']]
     z={'slippage_percent':slip/100,'cases':[],'status':'RUNNING'}
     stress.append(z);proposal.setdefault('slippage_stress_0_1_2',[]).append(z)
     write(doc)
     try:
      for j,c in enumerate(COSTS):
       name=proposal['policy']+f'_SLIP{slip}'
       x=output(name,base+specs,c)
       a=entry(name,c,target,side);b=baseline[j]
       z['cases'].append({'cost_bps':c,'DD_improvement_pp':round(x['full8_max_dd_pct']-cur[j]['full8_max_dd_pct'],6),
       'loss_saved_pp':round(a['sum_negative_wallet_contributions_pp']-b['sum_negative_wallet_contributions_pp'],6)})
      z['status']='DONE'
     except Exception as exc:z['status']='ERROR';z['error']=str(exc)[:300]
     write(doc)
    if all(z['status']=='DONE' and all(y['DD_improvement_pp']>=-0.0001 and y['loss_saved_pp']>=-0.001
     for y in z['cases']) for z in stress):
     pick=proposal;break
   if pick:
    stage['selected']=pick['policy']
    base+=pick['specs']
    curid=pick['policy']
    cur=[output(curid+'_RECHECK',base,c) for c in COSTS]
    stage['status']='RESEARCH_CARRY_ROBUST_0_1_2_STRESS'
   else:stage['status']='NOMINAL_IMPROVEMENT_BUT_STRESS_FAILED'
  else:stage['status']='NO_COMBINATION_IMPROVED_BOTH_COST_CASES'
  stage['final_specs']=[x['id'] for x in base]
  doc['current_specs']=base
  write(doc)
 # Targeted family candidate motivated by prior H1 research, now tested on latest M5+full8.
 original_elig=seq.eligibility
 def family_eligibility(tr,pl):
  return original_elig(tr,pl) and ('family' not in pl or str(tr.get('family'))==pl['family'])
 seq.eligibility=family_eligibility
 target='Q102';side='LONG'
 high={'id':'TARGET_Q102_HIGH_VOL_LONG_P5_F3','target':target,'side':side,'family':'HIGH_VOL',
 'axis':'profit_reversal','arm_close_pct':.05,'locked_profit_pct':.03,'stop_slip_bps':10}
 stage={'id':'C09','scope':'Q102_HIGH_VOL_LONG','status':'RUNNING','cases':[],'selected':None}
 doc['stages'].append(stage);write(doc)
 baseline=[entry(curid,c,target,side) for c in COSTS]
 for sl in [0,100,200]:
  proposal=dict(high,id=high['id']+f'_SLIP_{sl}',stop_slip_bps=sl)
  name=f'TARGET_Q102_HIGHVOL_LONG_PROFIT5F3_SLIP{sl}'
  z={'stop_slip_bps':sl,'policy':name,'metrics':[],'status':'RUNNING'}
  stage['cases'].append(z);write(doc)
  try:
   for j,c in enumerate(COSTS):
    x=output(name,base+[proposal],c)
    a=entry(name,c,target,side);b=baseline[j]
    z['metrics'].append({'cost':c,'dd':x['full8_max_dd_pct'],
     'dd_delta_pp':round(x['full8_max_dd_pct']-cur[j]['full8_max_dd_pct'],5),'asset':x['full8_final_jpy'],
     'pf':x['full8_pf'],'negative_loss_saved_pp':round(a['sum_negative_wallet_contributions_pp']-b['sum_negative_wallet_contributions_pp'],5),
     'worst_trade_saved_pp':round(a['worst_trade_wallet_pct']-b['worst_trade_wallet_pct'],5)})
   z['status']='DONE'
  except Exception as e:z['status']='ERROR';z['error']=str(e)[:400]
  print('HIGHVOL_TEST',sl,z['status'],[v.get('dd') for v in z['metrics']],flush=True);write(doc)
 if all(z['status']=='DONE' and all(x['dd_delta_pp']>=0 for x in z['metrics']) for z in stage['cases']):
  z=stage['cases'][0]
  if all(x['negative_loss_saved_pp']>=0.5 or x['dd_delta_pp']>=0.005 for x in z['metrics']):
   stage['status']='PROVISIONAL_RESEARCH_CARRY_0_1_2_STOP_SLIPPAGE_PASS'
   stage['selected']=high['id'];base.append(high)
  else:stage['status']='NO_MATERIAL_IMPROVEMENT'
 else:stage['status']='NO_BOTH_COST_SLIPPAGE_ROBUST_ADOPTION'
 doc['current_specs']=base
 # Mandatory reprice the ENTIRE eight-strategy portfolio after each selected policy,
 # including all crossover fills, margin, time priority and available account capital.
 integrated=[]
 for c in COSTS:
  full=output('FINAL_FULL8_ROBUST_CUMULATIVE_20261019',base,c)
  integrated.append({'cost_bps':c,'final_jpy':full['full8_final_jpy'],
   'max_dd_pct':full['full8_max_dd_pct'],'pf':full['full8_pf'],
   'trade_count':full['closed_trades'],'win_pct':full['win_pct'],
   'accounting':full['accounting']})
 doc['final_integrated_replay']=integrated
 doc['status']='COMPLETED_COMBINED_EXPERIMENTS_WITH_MARKET_DATA_GAPS'
 doc['finished_utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
 write(doc)
 print('ALL_COMBINED_FINISHED',str(FILE),flush=True)
if __name__=='__main__':run()
