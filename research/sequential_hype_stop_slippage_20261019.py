#!/usr/bin/env python3
"""Research-only 0%, 1%, 2% adverse stop-fill slippage stress for HYPE wallet cap."""
from pathlib import Path
import sys,json,math,hashlib
P=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(P/'research'))
import long_short_sequential_full8_bt_20261019 as seq
import sequential_full8_side_loss_metrics_20261019 as lm
R=P/'docs/research/results/long-loss-research-20261019'
OUT=R/'SEQUENTIAL_HYPE_LONG_1P5_STOP_SLIPPAGE_20261019.json'
def main():
 seq.setup_for_runs()
 baseline={}
 for c in [10,30]:
  baseline[str(c)]=json.loads((R/f'SEQUENTIAL_LATEST_20261017_BASELINE_{c}BPS.json').read_text('utf8'))
  assert baseline[str(c)]['accounting']=='PASS'
 out={'status':'RUNNING_RESEARCH_ONLY','baseline':[baseline['10'],baseline['30']],
      'studies':[],'no_live_change':True}
 for slip in [0,100,200]:
  spec={**seq.HYPE2,'id':f'HYPE_LONG_INITIAL_WALLET1P5_SLIP{slip}','stop_slip_bps':slip}
  data={'stop_slippage_pct':slip/100,'cases':[]}
  out['studies'].append(data)
  for cost in [10,30]:
   name=f'HYPE_WALLET1P5_SLIP{slip}'
   current=seq.portfolio_run(name,[spec],cost)
   target=lm.losses(lm.ledger(name,cost))['HYPE_LONG_LONG']
   org=lm.losses(lm.ledger('LATEST_20261017_BASELINE',cost))['HYPE_LONG_LONG']
   data['cases'].append({'cost_bps':cost,'dd_pct':current['full8_max_dd_pct'],
     'dd_delta_pctpoints':round(current['full8_max_dd_pct']-baseline[str(cost)]['full8_max_dd_pct'],5),
     'final_jpy':current['full8_final_jpy'],'pnl_pf':current['full8_pf'],'count':current['closed_trades'],
     'hype_loss_saved_wallet_pp':round(target['sum_negative_wallet_contributions_pp']-org['sum_negative_wallet_contributions_pp'],5),
     'worst_loss_improved_pp':round(target['worst_trade_wallet_pct']-org['worst_trade_wallet_pct'],5)})
   print('HYPE_SLIP',slip,cost,'DD',current['full8_max_dd_pct'],'asset',round(current['full8_final_jpy']),
      'saved',data['cases'][-1]['hype_loss_saved_wallet_pp'],flush=True)
  OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 out['status']='COMPLETE_STRESS_CASES_RESEARCH_ONLY'
 out['robust_to_2pct_slippage']=all(x['dd_delta_pctpoints']>=-0.0001 and x['hype_loss_saved_wallet_pp']>0
    for y in out['studies'] for x in y['cases'])
 OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('HYPE_STRESS_COMPLETE',out['robust_to_2pct_slippage'],str(OUT),flush=True)
if __name__=='__main__':main()
