"""Research-only PENGU exit comparison. Reads frozen local market data; no venue/network calls."""
import pathlib,sys,os,json,gzip,copy,hashlib,collections,datetime
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/research/results/pengu-profit-giveback-20261009'
REF=pathlib.Path(os.environ.get('PENGU_BT_REFERENCE','C:/tmp/current-vps-no-dca-bt-20261007/docs/research/results/current-vps-no-dca-20261007'))
GATE=pathlib.Path(os.environ.get('PENGU_BT_GATE_REFERENCE','C:/Users/dis/DisDex-five-improvements-20261008/docs/research/results/gate-fixes-bt-20261008'))
H=3600000
def rows(p):
 with (gzip.open(p,'rt',encoding='utf-8') if str(p).endswith('.gz') else open(p,encoding='utf-8')) as f:return [json.loads(l) for l in f if l.strip()]
def stat(tr):
 p=[x['total_pnl_jpy'] for x in tr]
 return {'trades':len(p),'wins':sum(x>0 for x in p),'win_rate':sum(x>0 for x in p)/len(p) if p else None,'pf':sum(max(0,x) for x in p)/-sum(min(0,x) for x in p) if any(x<0 for x in p) else None,'net_pnl_usd':sum(p),'mean_pnl_usd':sum(p)/len(p) if p else None}
def patch_partial_order(source):
 old='if partial and ts < int(partial["ts"]) < position["planned_exit_ts_ms"]:'
 new='if partial and ts < int(partial["ts"]) <= position["planned_exit_ts_ms"] and (int(partial["ts"]) < position["planned_exit_ts_ms"] or strategy == "PENGU"):'
 assert source.count(old)==1
 # Existing event priorities: resident partial 1, final exit 2. No timestamp backdating.
 return source.replace(old,new)
def run(name,scope,costs):
 cs=rows(OUT/'candidates'/f'{name}.jsonl.gz')
 case=OUT/scope/name;cr=case/'candidates';cr.mkdir(parents=True,exist_ok=True)
 if scope=='integrated':
  raw=rows(GATE/'inputs/core-reference-candidates.jsonl.gz')
  raw=[c for c in raw if c['strategy_id'] not in {'PENGU','V12'}]
  vt=rows(GATE/'exit-tables/V12_BASELINE.jsonl.gz')
  old={ (x['entry_ts_ms'],x['symbol'],x['side']):x for x in rows(GATE/'inputs/core-reference-candidates.jsonl.gz') if x['strategy_id']=='V12'}
  for t in vt:
   c=copy.deepcopy(old[(t['entry_ts_ms'],t['symbol'],t['side'])]);c.update(exit_ts_ms=t['exit_ts_ms'],exit_price=t['exit_price'],exit_reason=t['reason'],unit_price_return=t['unit_gross_return']);raw.append(c)
  for sid,table in [('IDLE','IDLE'),('RESIDUAL','RESIDUAL'),('HYPE_LONG','HYPE')]:
   for t in rows(GATE/'exit-tables'/f'{table}_BASELINE.jsonl.gz'):
    c={'strategy_id':sid,'status':'MODELED_CLOSED_TRADE','requested_gross':1.,'signal_ts_ms':t['entry_ts_ms'], 'symbol':t['symbol'],'side':t['side'],'entry_ts_ms':t['entry_ts_ms'],'entry_price':t['entry_price'],'exit_ts_ms':t['exit_ts_ms'],'exit_price':t['exit_price'],'exit_reason':t['reason'],'unit_price_return':t['unit_gross_return']}
    if sid=='HYPE_LONG':c['requested_gross']=min(1.5,.05*t['entry_price']/t['stopDistance'])
    else:c.update(overlay_source_current=True,generic_accepted=True,route_selected=True,route=t['route'],priority=t.get('priority',0))
    raw.append(c)
  cs=raw+cs
 cs.sort(key=lambda c:(c['entry_ts_ms'],0 if c['strategy_id']=='RESIDUAL' else 1,c.get('priority',0),c['symbol']))
 (cr/'crypto-price-model-candidates.jsonl').write_text(''.join(json.dumps(c,sort_keys=True)+'\n' for c in cs),encoding='utf-8')
 source=(REF/'run-current-vps-no-dca.py').read_text(encoding='utf-8')
 source=source.replace('hype,_=build_hype_candidates(data,hf,m.PERIOD_END_MS);extra,_=base.overlay_candidates(rows(features),data,True,True,m.PERIOD_END_MS)','hype=[];extra=[]')
 source=source.replace('out=pathlib.Path(__file__).resolve().parent/"runs"/variant','out=case/"runs"')
 if scope=='standalone':source=source.replace('v52_ledger_root=baseline/"v52-SHA-verified-original-ledger"','v52_ledger_root=None')
 if scope=='integrated':
  spec=__import__('importlib.util',fromlist=['spec_from_file_location'])
  modspec=spec.spec_from_file_location('gate_reference',ROOT.parent/'DisDex-five-improvements-20261008/scripts/research/run_gate_fix_comparison.py')
  gate=spec.module_from_spec(modspec);modspec.loader.exec_module(gate)
  # The source-backed portfolio/idle priority and quantity-floor correction; no relaxed entry gates.
  source=source.replace('    return source\n','    return patch_admission(patch_partial_order(source),False)\n')
  source=source.replace('m=load_ownership_engine(source_transform=patch)','m=load_ownership_engine(source_transform=patch)\nm._idle_quantity_ok=quantity_ok')
  source=source.replace('prepare_overlay_batch(rs,active,completed,ts,market,equity,gross,finalize,lifecycle)','source_batch(rs,active,completed,ts,market,equity,gross,finalize,lifecycle)')
 else:source=source.replace('    return source\n','    return patch_partial_order(source)\n')
 saved=list(sys.argv);sys.argv=['model','VPS_VENUE_PENGU_GIVEBACK','AVAX','-0.12','1.0','0.6','1.5','BOTH',str(cr),'0',costs,'strict365']
 sys.path.insert(0,str(REF))
 ns={'__file__':str(REF/'run-current-vps-no-dca.py'),'__name__':'__research__','case':case,'patch_partial_order':patch_partial_order}
 if scope=='integrated':ns.update(patch_admission=gate.patch_admission,quantity_ok=gate.quantity_ok,source_batch=gate.source_batch)
 try:exec(compile(source,str(REF/'run-current-vps-no-dca.py'),'exec'),ns)
 finally:sys.argv=saved
 summary=json.loads((case/'runs/summary.json').read_text())
 for sc in summary['scenarios']:
  tr=rows(case/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
  if scope=='standalone':assert all(x['strategy_id']=='PENGU' for x in tr)
  p=[x for x in tr if x['strategy_id']=='PENGU']
  sc['pengu']=stat(p);sc['pengu_short']=stat([x for x in p if x['side']=='SHORT']);sc['pengu_long']=stat([x for x in p if x['side']=='LONG'])
  sc['pengu_first_half']=stat([x for x in p if x['exit_ts_ms']<1754784000000+182*24*H])
  sc['pengu_second_half']=stat([x for x in p if x['entry_ts_ms']>=1754784000000+182*24*H])
  sc['route_metrics']={route:stat([x for x in p if x.get('route')==route]) for route in sorted({x.get('route','') for x in p})}
  # Quantity-based linear short P&L, actual funding and fee reconciliation are in the controlling engine.
  sc['description']='PENGU-only, fixed Gross 1, one slot, Q60/DD17/H72, 6h cooldown (24h hard-stop), actual funding, current venue lots, JPY converted via historical FX' if scope=='standalone' else 'All-logic H1 reference with source V12 exits/idle quantity correction; PENGU entries and exits regenerated; no Q102 entry relaxation'
 result={'name':name,'scope':scope,'scenarios':summary['scenarios'],'unresolved_counts':summary['unresolved_crypto_candidate_counts'],'v52_model_complete':summary['v52_model_complete'],'v52_funding_verified':summary['v52_funding_verified']}
 (case/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
 print('COMPARISON',json.dumps({'name':name,'scope':scope,'rows':[{'cost':s['scenario_id'],'final':s['final_equity_jpy'],'dd':s['maximum_mtm_drawdown'],'pf':s['profit_factor'],'wr':s['win_rate'],'n':s['closed_trades'],'short':s['pengu_short']} for s in result['scenarios']]}),flush=True)
 return result
def main():
 gen=json.loads((OUT/'candidates/source-generation.json').read_text())
 results=[]
 scopes=sys.argv[1:] or ['standalone']
 for scope in scopes:
  for name in gen['candidates']:
   if scope=='integrated' and not name.startswith('H1_NEXT_OPEN'):continue
   print('RUN_CASE',scope,name,flush=True)
   result=run(name,scope,'10,20,30')
   results.append(result)
   (OUT/'comparison.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
 print('BT_COMPLETED',len(results),flush=True)
if __name__=='__main__':main()
