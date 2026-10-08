"""Independent accounting/provenance checks; simulator consistency is not independent fill certification."""
import json,gzip,inspect,math
import run_v12_entry_phase as p
import verify_gate_fix_comparison as audit
def blob(x):return x.read_bytes() if x.exists() else gzip.open(str(x)+'.gz','rb').read()
def main():
 root=p.OUT;results=json.loads((root/'comparison-summary.json').read_text());assert {c['case'] for c in results}==set(p.CASES)
 audit.ROOT=root
 code=inspect.getsource(audit.main).replace('assert len(results)==16','assert len(results)==10').replace('assert len(checks)==48','assert len(checks)==30').replace("'scenario_count':48","'scenario_count':30")
 exec(compile(code,'<entry-phase-ledger-audit>','exec'),audit.__dict__);audit.main()
 for cost in [10,20,30]:
  rel=f'runs/PRICE_MODEL_{cost}BPS/portfolio-trades.jsonl'
  assert blob(root/'cases/BASELINE_Q_RET14'/rel)==blob(p.s.w.PRIOR/'cases/Q_RET14_DELTA'/rel),cost
 p.s.w.load_bars();pools={False:p.s.rows(root/'state-pool.jsonl'),True:p.s.rows(root/'state-pool-no-btc.jsonl')}
 for no_btc,cs in pools.items():
  for c in cs:
   t=c['entry_ts_ms'];sym=c['symbol'];b=p.s.w.bars[sym];btc=p.s.w.bars['BTCUSDT'];f=c['features']
   assert c['decision_ts_ms']==t and c['setup_ts_ms']<=t and f['now']==t
   if c['route'] in ['RETEST','FAILED_BREAK']:assert 0<t-c['setup_ts_ms']<=8*p.H
   assert c['entry_price']==b[t]['open'] and f['close']==b[t-p.H]['close']
   cp=lambda a,h:a[t-(h+1)*p.H]['close']
   assert math.isclose(f['ret6'],cp(b,0)/cp(b,6)-1,abs_tol=1e-12)
   assert math.isclose(f['btc6'],cp(btc,0)/cp(btc,6)-1,abs_tol=1e-12)
   assert math.isclose(f['rel6'],cp(b,0)/cp(b,6)-cp(btc,0)/cp(btc,6),abs_tol=1e-12)
   if not no_btc:assert c['sg']*f['btc6']>=-.005
   rawdist=c['sg']*(c['entry_price']-c['structural_stop']);assert 0<rawdist<=2.5*c['atr']
 base=p.s.rows(root/'cases/BASELINE_Q_RET14/candidates/crypto-price-model-candidates.jsonl')
 def non(a):return sorted([c for c in a if c['strategy_id']!='V12'],key=lambda c:(c['strategy_id'],c['symbol'],c['side'],c['entry_ts_ms']))
 unchanged=non(base);checked=0;verdict=[]
 for result in results:
  name=result['case'];cs=p.s.rows(root/'cases'/name/'candidates/crypto-price-model-candidates.jsonl');assert non(cs)==unchanged,name
  if name!='BASELINE_Q_RET14':
   parms=p.CASES[name];expected={}
   for c in p.select(pools[parms.get('no_btc',False)],parms):
    x=p.m.exit_trade(c,p.s.w.bars[c['symbol']],parms.get('structured',True))
    if x:expected[(c['symbol'],c['side'],c['entry_ts_ms'],c['route'])]=(c,x)
   vs=[c for c in cs if c['strategy_id']=='V12'];keys=[(c['symbol'],c['side'],c['entry_ts_ms'],c['route']) for c in vs]
   assert len(keys)==len(set(keys)) and set(keys)==set(expected),name
   for c,k in zip(vs,keys):
    orig,x=expected[k]
    for field in ['entry_ts_ms','entry_price','exit_ts_ms','exit_price']:assert c[field]==x[field],(name,field)
    assert c['exit_reason']==x['reason'] and c['unit_price_return']==x['unit_gross_return']
    dist=max(orig['sg']*(orig['entry_price']-orig['structural_stop']) if parms.get('structured',True) else 2.477*orig['atr'],orig['entry_price']*.005)
    gross=min(1.,.0319/(dist/orig['entry_price']));gross=min(.1,gross) if orig['rank']==3 else gross
    assert math.isclose(c['requested_gross'],gross,rel_tol=1e-12);checked+=1
  passes=[]
  for sc in result['scenarios']:
   d=sc['v12_details'];passes.append(all(d[h]['trades']>=50 and d[h]['net_pnl_usd']>0 and d[h]['unit_returns']['mean']>0 and (d[h]['pf_usd'] or 0)>=1.1 for h in ['all','first','second']) and d['all']['net_without_best_usd']>0)
  verdict.append({'case':name,'robust_positive_all_costs_and_halves':all(passes)})
 (root/'profit-verdict.json').write_text(json.dumps({'cases':verdict,'adoptable':[v for v in verdict if v['robust_positive_all_costs_and_halves']],'live_changes':False,'prior_explored_period':True},indent=2))
 q=root/'independent-verification.json';d=json.loads(q.read_text());d.update(baseline_exact_all_costs=True,non_v12_streams_unchanged_all_cases=True,closed_feature_and_entry_quote_provenance=sum(map(len,pools.values())),simulation_and_sizing_consistency_checked=checked);q.write_text(json.dumps(d,indent=2))
 print('ENTRY_PHASE_AUDIT_PASS',checked,json.dumps(verdict))
if __name__=='__main__':main()
