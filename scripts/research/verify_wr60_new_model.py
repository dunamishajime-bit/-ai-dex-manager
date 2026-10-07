"""Independent WR60 ledger checks, plus exact old/new baseline fidelity."""
from pathlib import Path
import inspect,json,gzip,hashlib,math
import verify_gate_fix_comparison as audit
import run_wr60_new_model as study
def main():
 root=study.OUT
 summaries=json.loads((root/'comparison-summary.json').read_text())
 assert {c['case'] for c in summaries}==set(study.VARS)
 audit.ROOT=root;audit.EXPECTED_CASES=set(study.VARS)
 source=inspect.getsource(audit.main)
 source=source.replace('assert len(results)==16','assert len(results)==len(EXPECTED_CASES)')
 source=source.replace('assert len(checks)==48','assert len(checks)==3*len(EXPECTED_CASES)')
 source=source.replace("'scenario_count':48","'scenario_count':3*len(EXPECTED_CASES)")
 exec(compile(source,'<independent-wr60-ledger-audit>','exec'),audit.__dict__)
 audit.main()
 prior=json.loads((study.PRIOR/'cases/Q_RET14_DELTA/result.json').read_text())
 baseline=next(c for c in summaries if c['case']=='BASELINE_Q_RET14')
 for old,new in zip(prior['scenarios'],baseline['scenarios']):
  for k in ['win_rate','closed_trades','profit_factor','final_equity_jpy','maximum_mtm_drawdown','entry_days_jst']:
   assert math.isclose(old[k],new[k],rel_tol=1e-12,abs_tol=1e-9),(k,old[k],new[k])
  a=gzip.open(study.PRIOR/'cases/Q_RET14_DELTA/runs'/old['scenario_id']/'portfolio-trades.jsonl.gz','rb').read()
  p=root/'cases/BASELINE_Q_RET14/runs'/new['scenario_id']/'portfolio-trades.jsonl'
  b=gzip.open(str(p)+'.gz','rb').read() if not p.exists() else p.read_bytes()
  assert a==b,('baseline ledger differs',old['scenario_id'])
 def candidate_rows(name):
  p=root/'cases'/name/'candidates/crypto-price-model-candidates.jsonl'
  return study.base.rows(p if p.exists() else Path(str(p)+'.gz'))
 def ck(c):return c['strategy_id'],c['symbol'],c['side'],c['entry_ts_ms'],c.get('family'),c.get('route')
 reference={ck(c):c for c in candidate_rows('BASELINE_Q_RET14')}
 for case in summaries:
  scale=case['study_parameters'].get('v12_gross_scale')
  if scale is None:continue
  for c in candidate_rows(case['case']):
   original=reference[ck(c)]
   if c['strategy_id']=='V12':assert math.isclose(c['requested_gross'],original['requested_gross']*scale,rel_tol=1e-12)
   else:assert c==original,('other sleeve modified',case['case'],ck(c))
 p=root/'independent-verification.json';out=json.loads(p.read_text())
 out['baseline_ledgers_byte_identical_all_3_costs']=True
 out['gross_scaling_and_other_candidate_streams_verified']=True
 out['win_rate_intervals']='Descriptive iid Wilson only; not cluster-adjusted, not multiple-comparison-adjusted, not independent holdout evidence.'
 out['limits'].append('Changes are research-only; original candidate source reuse and H1 proxy execution remain.')
 p.write_text(json.dumps(out,indent=2),encoding='utf-8')
 print('WR60_INDEPENDENT_AND_BASELINE_FIDELITY_PASS',len(study.VARS)*3)
if __name__=='__main__':main()
