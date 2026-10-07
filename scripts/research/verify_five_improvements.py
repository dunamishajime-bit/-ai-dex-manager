"""Independent post-run verification, without importing model functions."""
import pathlib,json,gzip,hashlib,collections,math
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/research/results/five-improvements-20261008'
def rows(p):
 if not p.exists():p=pathlib.Path(str(p)+'.gz')
 with (gzip.open(p,'rt') if str(p).endswith('.gz') else open(p)) as f:return [json.loads(l) for l in f if l.strip()]
checks=[]
for case in sorted((OUT/'cases').iterdir()):
 resultfile=case/'result.json'
 if not resultfile.exists():continue
 result=json.loads(resultfile.read_text())
 for metric in result['scenarios']:
  folder=case/'runs'/metric['scenario_id']
  tr=rows(folder/'portfolio-trades.jsonl');events=rows(folder/'portfolio-events.jsonl');decisions=rows(folder/'candidate-decisions.jsonl')
  assert len(tr)==metric['closed_trades']
  assert len({r['position_id'] for r in tr})==len(tr)
  for t in tr:
   net=t['price_pnl']+t['funding_pnl']-t['entry_fee']-t['exit_fee']
   assert math.isclose(net,t['total_pnl_jpy'],rel_tol=1e-10,abs_tol=1e-8)
  gains=sum(t['total_pnl_jpy'] for t in tr if t['total_pnl_jpy']>0)
  losses=-sum(t['total_pnl_jpy'] for t in tr if t['total_pnl_jpy']<0)
  assert math.isclose(gains/losses,metric['profit_factor'],rel_tol=1e-10)
  assert abs(sum(t['total_pnl_jpy']>0 for t in tr)/len(tr)-metric['win_rate'])<1e-12
  deposits=[e for e in events if e['event_type']=='MONTHLY_CONTRIBUTION']
  assert len(deposits)==1 and deposits[0]['contribution_jpy']==10000
  assert metric['accounting_reconciliation']['status']=='PASS'
  assert metric['missing_active_position_mtm_hours']==0
  accepted=[d for d in decisions if d['decision']=='ACCEPTED_MODELED_ENTRY']
  assert len(accepted)==len(tr)
  assert {d['candidate_id'] for d in accepted}=={t['candidate_id'] for t in tr}
  active=collections.defaultdict(list);conflicts=[]
  for t in sorted(tr,key=lambda r:(r['entry_ts_ms'],r['exit_ts_ms'])):
   for a in active[t['symbol']]:
    if a['exit_ts_ms']>t['entry_ts_ms'] and a['strategy_id']!=t['strategy_id']:conflicts.append((a['candidate_id'],t['candidate_id']))
   active[t['symbol']].append(t)
  assert not conflicts,conflicts[:3]
  checks.append({'policy':result['policy'],'cost':metric['round_trip_cost_bps'],'trades':len(tr),'accounting':'PASS','ownership_conflicts':0,'pf_wr_recomputed':'PASS','decisions_trade_linkage':'PASS','missing_mtm_hours':0})
report={'status':'PASS','checked_cases':len(checks),'checks':checks,'scope':'Frozen candidate stream / H1 model; verification does not prove historical venue constraints, asynchronous pending, fill path or OOS robustness.'}
(OUT/'independent-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
