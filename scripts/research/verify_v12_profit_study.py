"""Independent ledger audit, exact controls, causal candidate mapping, profit verdict."""
import json,gzip,inspect,math,hashlib
from pathlib import Path
import run_v12_profit_study as s
import verify_gate_fix_comparison as audit
def main():
 root=s.OUT;results=json.loads((root/'comparison-summary.json').read_text());params=json.loads((root/'case-parameters.json').read_text())
 assert {x['case'] for x in results}==set(params)
 audit.ROOT=root;audit.EXPECTED_CASES=set(params)
 src=inspect.getsource(audit.main).replace('assert len(results)==16','assert len(results)==len(EXPECTED_CASES)').replace('assert len(checks)==48','assert len(checks)==3*len(EXPECTED_CASES)').replace("'scenario_count':48","'scenario_count':3*len(EXPECTED_CASES)")
 exec(compile(src,'<v12-independent-ledger-audit>','exec'),audit.__dict__);audit.main()
 def bytes_at(p):return gzip.open(str(p)+'.gz','rb').read() if not p.exists() else p.read_bytes()
 controls={'BASELINE_Q_RET14':s.w.PRIOR/'cases/Q_RET14_DELTA','PRIOR_WR60':s.ROOT/'docs/research/results/wr60-new-model-20261008/cases/TP05_STOP075_REL6_G050'}
 for name,old in controls.items():
  for cost in [10,20,30]:
   sid=f'PRICE_MODEL_{cost}BPS'
   assert bytes_at(old/'runs'/sid/'portfolio-trades.jsonl')==bytes_at(root/'cases'/name/'runs'/sid/'portfolio-trades.jsonl'),(name,cost,'control differs')
 s.initialize()
 for name,p in params.items():
  path=root/'cases'/name/'candidates/crypto-price-model-candidates.jsonl'
  for c in s.w.base.rows(path if path.exists() else Path(str(path)+'.gz')):
   if c['strategy_id']!='V12':continue
   sig=c.get('signal_ts_ms',c['entry_ts_ms']);key=(c['symbol'],c['side'],sig)
   x=s.transform(s.RAW[key],p);assert x is not None
   for k in ['entry_ts_ms','entry_price','exit_ts_ms','exit_price']:assert c[k]==x[k],(name,k)
   assert c['unit_price_return']==x['unit_gross_return'] and c['exit_reason']==x['reason']
   assert math.isclose(c['requested_gross'],s.RAW[key]['requested_gross']*p.get('gross',1),rel_tol=1e-12)
 verdict=[]
 for case in results:
  passed=True
  for sc in case['scenarios']:
   d=sc['v12_details']
   ok=all(d[k]['trades']>=50 and d[k]['net_pnl_usd']>0 and d[k]['unit_mean']>0 and (d[k]['pf_usd'] or 0)>=1.1 for k in ['all','first','second']) and d['all']['net_without_best']>0
   passed=passed and ok
  verdict.append({'case':case['case'],'robust_positive_all_costs_halves':passed,'predeclared_screen_pass':case['case'] in [x['name'] for x in json.loads((root/'selection-lock.json').read_text())['selected']]})
 (root/'profit-verdict.json').write_text(json.dumps({'cases':verdict,'adoptable': [x for x in verdict if x['robust_positive_all_costs_halves'] and x['predeclared_screen_pass']],'limits':['H1 quote proxy, not live profit or future guarantee','Prior explored historical year; no untouched holdout','Original candidate signals and fixed non-V12 streams reused']},indent=2))
 print('V12_LEDGER_AND_CONTROL_AUDIT_PASS',len(results)*3);print(json.dumps(verdict,indent=2))
if __name__=='__main__':main()
