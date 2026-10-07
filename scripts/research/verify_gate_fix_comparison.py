"""Independent ledger/accounting checks; does not certify historical fills or MTM path."""
from pathlib import Path
import json,gzip,math,collections
ROOT=Path(__file__).resolve().parents[2]/'docs/research/results/gate-fixes-bt-20261008'
def rows(p):
 if not p.exists():p=Path(str(p)+'.gz')
 with (gzip.open(p,'rt',encoding='utf-8') if p.suffix=='.gz' else p.open(encoding='utf-8')) as f:return [json.loads(x) for x in f if x.strip()]
def close(a,b):assert math.isclose(a,b,rel_tol=1e-9,abs_tol=1e-6),(a,b)
def main():
 results=json.loads((ROOT/'comparison-summary.json').read_text());assert len(results)==16
 checks=[]
 for case in results:
  for sc in case['scenarios']:
   d=ROOT/'cases'/case['case']/'runs'/sc['scenario_id'];ts=rows(d/'portfolio-trades.jsonl');es=rows(d/'portfolio-events.jsonl')
   assert len(ts)==sc['closed_trades'];close(sum(t['total_pnl_jpy']>0 for t in ts)/len(ts),sc['win_rate'])
   pnls=[t['total_pnl_jpy'] for t in ts]
   close(sum(max(0,p) for p in pnls)/-sum(min(0,p) for p in pnls),sc['profit_factor'])
   for t in ts:
    assert t['settlement_currency']=='USD'
    close(t['price_pnl']+t['funding_pnl']-t['entry_fee']-t['exit_fee'],t['total_pnl_jpy'])
    close(t['total_pnl_jpy']*t['reference_fx_exit_jpy_per_usd'],t['modeled_realized_pnl_jpy_at_exit_fx'])
   wallet=0.;active={};deposits=0;contributed=0.
   for e in es:
    kind=e['event_type']
    if kind=='MONTHLY_CONTRIBUTION':wallet+=e['settlement_cashflow'];deposits+=1;contributed+=e['contribution_jpy']
    elif kind=='MODELED_ENTRY':
     assert e['symbol'] not in active.values(),('ownership',case['case'],e)
     active[e['position_id']]=e['symbol'];wallet-=e['fee_settlement']
    elif kind=='MODELED_EXIT':
     assert active.pop(e['position_id'])==e['symbol'];wallet+=e['net_cashflow_settlement']
    elif kind in {'HYPE_PRIORITY_PARTIAL_EXIT','MODELED_PARTIAL_EXIT'}:
     assert active[e['position_id']]==e['symbol'];wallet+=e['net_cashflow_settlement']
    elif kind=='FUNDING':wallet+=e['cashflow_settlement']
    else:raise AssertionError(kind)
    close(wallet,e['wallet_after_event'])
   assert not active;assert deposits==1 and contributed==10000
   close(wallet,sc['accounting_reconciliation']['wallet_settlement_units'])
   close(wallet*sc['accounting_reconciliation']['final_fx_jpy_per_usd'],sc['final_equity_jpy'])
   mid=sc['period_start_ms']+182*24*3600000
   excluded=sum(t['entry_ts_ms']<mid<=t['exit_ts_ms'] for t in ts)
   assert sc['first_half']['trades']+sc['second_half']['trades']+excluded==len(ts)
   sc['split_excluded_crossing_trades']=excluded
   checks.append({'case':case['case'],'cost_bps':sc['round_trip_cost_bps'],'trades':len(ts),'ledger_accounting':'PASS','win_rate_and_settlement_usd_pf':'PASS','ownership':'PASS','split_excluded_crossing_trades':excluded})
  (ROOT/'cases'/case['case']/'result.json').write_text(json.dumps(case,indent=2),encoding='utf-8')
 assert len(checks)==48
 vectors=json.loads((ROOT/'quantity-production-vectors.json').read_text())
 assert len(vectors)==280
 for v in vectors:
  n=v['normalized'];assert float(n['quantityText'])==n['quantity'];assert v['result']['accepted']
  target=v['equity']/v['referencePrice'];expected=math.floor(target/n['stepSize']+1e-12)*n['stepSize']
  close(n['quantity'],expected);close(n['quantity']*v['referencePrice'],v['result']['notionalUsd'])
 (ROOT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
 out={'status':'PASS','scenario_count':48,'quantity_vectors':280,'checks':checks,'limits':['MTM drawdown is engine-reported, not independently reconstructed here','H1 quote proxy and observed current filters do not certify historical LIVE execution','Temporal halves exclude reported boundary-crossing trades and are not unseen holdout']}
 (ROOT/'independent-verification.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
 print(json.dumps({k:v for k,v in out.items() if k!='checks'}))
if __name__=='__main__':main()
