"""Independent36-ledger and causal-candidate audit, plus honest profitability verdict."""
from pathlib import Path
import json,gzip,inspect,hashlib,math
import run_v12_logic_dissection as s
import run_v12_composite_study as comp
import verify_gate_fix_comparison as audit
def blob(p):return gzip.open(str(p)+'.gz','rb').read() if not p.exists() else p.read_bytes()
def main():
 root=s.OUT;a=json.loads((root/'comparison-summary.json').read_text());expected=set(json.loads((root/'study-lock.json').read_text())['selected_cases'])|set(comp.CASES)
 assert {c['case'] for c in a}==expected and len(a)==12
 audit.ROOT=root;audit.EXPECTED_CASES=expected
 src=inspect.getsource(audit.main).replace('assert len(results)==16','assert len(results)==len(EXPECTED_CASES)').replace('assert len(checks)==48','assert len(checks)==3*len(EXPECTED_CASES)').replace("'scenario_count':48","'scenario_count':3*len(EXPECTED_CASES)")
 exec(compile(src,'<independent-dissection-ledger-audit>','exec'),audit.__dict__);audit.main()
 for cost in [10,20,30]:
  sid=f'PRICE_MODEL_{cost}BPS';p=root/'cases/BASELINE_BASE/runs'/sid/'portfolio-trades.jsonl';old=s.w.PRIOR/'cases/Q_RET14_DELTA/runs'/sid/'portfolio-trades.jsonl'
  assert blob(p)==blob(old),('baseline mismatch',cost)
 baseline_non=[c for c in s.rows(root/'cases/BASELINE_BASE/candidates/crypto-price-model-candidates.jsonl') if c['strategy_id']!='V12']
 def identity(c):return c['strategy_id'],c['symbol'],c['side'],c['entry_ts_ms'],c.get('route',''),c.get('family','')
 baseline_non=sorted(baseline_non,key=identity)
 s.initialize();pool=s.rows(root/'composite-route-pool.jsonl');poolmap={(c['symbol'],c['side'],c['entry_ts_ms'],c['route']):c for c in pool}
 # Independently check feature provenance against closed H1 closes, without invoking feature builder.
 for c in pool:
  t=c['entry_ts_ms'];f=c['features'];sym=c['symbol'];bars=s.w.bars[sym];btc=s.w.bars['BTCUSDT']
  cp=lambda b,h:b[t-(h+1)*s.H]['close']
  assert f['close']==cp(bars,0)
  assert math.isclose(f['ret12'],cp(bars,0)/cp(bars,12)-1,abs_tol=1e-12)
  assert math.isclose(f['ret90'],cp(bars,0)/cp(bars,90)-1,abs_tol=1e-12)
  assert math.isclose(f['btc_ret6'],cp(btc,0)/cp(btc,6)-1,abs_tol=1e-12)
  assert math.isclose(f['rel24'],cp(bars,0)/cp(bars,24)-cp(btc,0)/cp(btc,24),abs_tol=1e-12)
  assert c['entry_price']==bars[t]['open']
 checked=0
 for case in a:
  name=case['case'];cand=s.rows(root/'cases'/name/'candidates/crypto-price-model-candidates.jsonl')
  assert sorted([c for c in cand if c['strategy_id']!='V12'],key=identity)==baseline_non,('nonV12streammodified',name)
  if name in comp.CASES:
   p=comp.CASES[name];vs=[c for c in cand if c['strategy_id']=='V12'];keys=[(c['symbol'],c['side'],c['entry_ts_ms'],c['route']) for c in vs]
   assert len(keys)==len(set(keys))
   selected=comp.select(pool,p);expected_rows={}
   for c in selected:
    x=comp.m.exit_trade(c,s.w.bars[c['symbol']],p.get('no_trail',False),p.get('no_momentum',False))
    if x is not None:expected_rows[(c['symbol'],c['side'],c['entry_ts_ms'],c['route'])]=(c,x)
   assert set(keys)==set(expected_rows)
   for c,k in zip(vs,keys):
    orig,x=expected_rows[k]
    for field in ['entry_ts_ms','entry_price','exit_ts_ms','exit_price']:assert c[field]==x[field],(name,k,field)
    assert c['exit_reason']==x['reason'] and c['unit_price_return']==x['unit_gross_return']
    risk_distance=max(orig['atr']*(1 if orig['route']=='REVERSAL' else 1.2),orig['entry_price']*.005)
    g=min(1.,.0319/(risk_distance/orig['entry_price']))
    if orig['rank']==3:g=min(.1,g)
    assert math.isclose(c['requested_gross'],g,rel_tol=1e-12)
    checked+=1
 verdict=[]
 for case in a:
  passes=[]
  for sc in case['scenarios']:
   d=sc['v12_details'];ok=all(d[h]['trades']>=50 and d[h]['net_pnl_usd']>0 and d[h]['unit_returns']['mean']>0 and (d[h]['pf_usd'] or 0)>=1.1 for h in ['all','first','second']) and d['all']['net_without_best_usd']>0
   passes.append(ok)
  verdict.append({'case':case['case'],'robust_positive_all_costs_and_halves':all(passes)})
 (root/'profit-verdict.json').write_text(json.dumps({'cases':verdict,'adoptable':[v for v in verdict if v['robust_positive_all_costs_and_halves']],'not_a_future_guarantee':True,'all_variants_reported':True,'live_changes':False},indent=2))
 p=root/'independent-verification.json';d=json.loads(p.read_text());d.update(baseline_ledgers_byte_identical_all3costs=True,unchanged_non_v12_candidates_all12cases=True,composite_entry_price_and_closed_feature_provenance=len(pool),composite_exit_and_sizing_checked=checked);p.write_text(json.dumps(d,indent=2))
 print('INDEPENDENT_V12_DISSECTION_PASS',len(a)*3,'POOL',len(pool),'CANDIDATES',checked);print(json.dumps(verdict))
if __name__=='__main__':main()
