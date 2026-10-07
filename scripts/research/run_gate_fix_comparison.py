"""Research comparison: corrected source exits and lot-floor admission; no LIVE calls."""
from pathlib import Path
import os,sys,json,gzip,math,copy,shutil,hashlib,collections,datetime
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/research/results/gate-fixes-bt-20261008'
PRIOR=Path(os.environ.get('DISDEX_REFERENCE_BT_ROOT',r'C:\tmp\current-vps-no-dca-bt-20261007\docs\research\results\current-vps-no-dca-20261007'))
SUPPORT=OUT/'support'
H=3600000
def rows(p):
 with (gzip.open(p,'rt',encoding='utf-8') if str(p).endswith('.gz') else open(p,encoding='utf-8')) as f:return [json.loads(l) for l in f if l.strip()]
def key(x):return x['symbol'],x['side'],int(x['entry_ts_ms'])
def read_table(strategy,variant='BASELINE'):
 p=OUT/'exit-tables'/f'{strategy}_{variant}.jsonl'
 return rows(p if p.exists() else Path(str(p)+'.gz'))
def initialize():
 OUT.mkdir(parents=True,exist_ok=True);SUPPORT.mkdir(exist_ok=True)
 if not (SUPPORT/'engine').exists():shutil.copytree(PRIOR/'engine',SUPPORT/'engine')
 for f in ['run-current-vps-no-dca.py','venue_constraints.py','venue-filters-observed-20261007.json']:
  if not (SUPPORT/f).exists():shutil.copy2(PRIOR/f,SUPPORT/f)
 (OUT/'inputs').mkdir(exist_ok=True)
 if not (OUT/'inputs/core-reference-candidates.jsonl.gz').exists():shutil.copy2(PRIOR/'inputs/current-source-checked-candidates.jsonl.gz',OUT/'inputs/core-reference-candidates.jsonl.gz')
sys.path.insert(0,str(SUPPORT))
def candidate(t,sid,old=None):
 c=copy.deepcopy(old) if old else {'strategy_id':sid,'source_runtime_sha':'ce1edeead8d0f9e5d88e829d415057117502a335','requested_gross':1.,'signal_ts_ms':t['entry_ts_ms'],'status':'MODELED_CLOSED_TRADE'}
 c.update(symbol=t['symbol'],side=t['side'],entry_ts_ms=t['entry_ts_ms'],entry_price=t['entry_price'],exit_ts_ms=t['exit_ts_ms'],exit_price=t['exit_price'],exit_reason=t['reason'],unit_price_return=t['unit_gross_return'])
 if sid=='V12':c.update(requested_gross=t['requested_gross'],rank=t['rank'])
 if sid=='HYPE_LONG':c['requested_gross']=min(1.5,.05*t['entry_price']/t['stopDistance'])
 if sid in {'IDLE','RESIDUAL'}:c.update(overlay_source_current=True,generic_accepted=True,route_selected=True,route=t['route'],priority=t.get('priority',0))
 if 'family' in t:c['family']=t['family']
 return c
def source_batch(rs,active,completed,ts,market,equity,gross,finalize,lifecycle):
 core={'V12','PENGU','Q102','FET','V52'}
 core_signal=any(r['strategy_id'] in core for r in rs)
 idle_signal=any(r['strategy_id']=='IDLE' and ts>=lifecycle.get(r['symbol'],0) for r in rs)
 for pid,p in list(active.items()):
  if p['strategy_id']=='RESIDUAL' and (core_signal or idle_signal):
   price=market(p['symbol'],ts)
   if price is None:raise ValueError('RESIDUAL_PREEMPT_MARK_MISSING')
   finalize(pid,ts,price,'FORMAL_PRIORITY' if core_signal else 'IDLE_SHORT_PRIORITY')
 core_busy=core_signal or any(p['strategy_id'] in core for p in active.values())
 sidecar_busy=any(p['strategy_id']=='HYPE_LONG' for p in active.values())
 for r in rs:
  if r['strategy_id'] not in {'IDLE','RESIDUAL'}:continue
  reason=None
  if core_busy:reason='CORE_SIGNAL_OR_POSITION'
  elif sidecar_busy:reason='HYPE_SIDECAR_ACTIVE'
  elif r['strategy_id']=='IDLE' and ts<lifecycle.get(r['symbol'],0):reason='FILLED_SYMBOL_COOLDOWN'
  elif r['strategy_id']=='RESIDUAL':
   if idle_signal or any(p['strategy_id']=='IDLE' for p in active.values()):reason='IDLE_PRIORITY'
   elif any(p['strategy_id']=='RESIDUAL' for p in active.values()):reason='RESIDUAL_SLOT_OCCUPIED'
  r['_overlay_block']=reason
 idle=[r for r in rs if r['strategy_id']=='IDLE' and not r['_overlay_block']]
 if idle:
  e=equity();crypto=sum(gross(p,e) for p in active.values() if p['strategy_id']!='V52');total=sum(gross(p,e) for p in active.values())
  if min(3.-crypto,4.25-total)+1e-9<len(idle):
   for r in idle:r['_overlay_block']='MULTI_SIGNAL_CAPACITY_AMBIGUOUS'
def patch_admission(source,strict):
 hook='                accepted_gross=notional/equity\n'
 assert source.count(hook)==1
 code=hook+'''                if strategy in {"IDLE","RESIDUAL"}:
                    if not _idle_quantity_ok(candidate["symbol"],equity,entry_price,quantity,STRICT):
                        reason=f"{strategy}:FULL_1X_QUANTITY_BLOCK"
                        record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts);rejected[reason]+=1;continue
'''.replace('STRICT',strict if isinstance(strict,str) else repr(strict))
 source=source.replace(hook,code)
 hook='                active[pid] = position\n'
 assert source.count(hook)==1
 source=source.replace(hook,hook+'                if strategy=="IDLE": overlay_lifecycle[candidate["symbol"]]=ts+12*HOUR\n')
 return source
def quantity_ok(symbol,equity,price,quantity,strict):
 from venue_constraints import FILTER_ROWS
 if strict:return quantity*price/equity>=1-1e-6
 row=FILTER_ROWS[symbol];fs={x['filterType']:x for x in row['filters']};lot=fs.get('MARKET_LOT_SIZE') or fs['LOT_SIZE'];step=float(lot['stepSize'])
 target=equity/price;expected=math.floor(target/step+1e-12)*step
 qt=min(step/1000,max(1.,target,quantity)*sys.float_info.epsilon*16);nt=max(1.,equity,quantity*price)*sys.float_info.epsilon*16
 return abs(quantity-expected)<=qt and quantity<=target+qt and quantity*price<=equity+nt
def run(name,costs):
 raw=rows(OUT/'inputs/core-reference-candidates.jsonl.gz');old_v={key(c):c for c in raw if c['strategy_id']=='V12'}
 vvariant={'V12_BTC15':'BTC_1P5','V12_BTC10':'BTC_1P0','V12_SCORE85':'SCORE_085','V12_VOLUME55':'VOLUME_055','V12_RELAXED_ATR10':'RELAXED_ATR10'}.get(name,'BASELINE')
 vt=read_table('V12',vvariant)
 if vvariant=='BASELINE':
  assert set(map(key,vt))==set(old_v)
  assert all(abs(t['requested_gross']-old_v[key(t)]['requested_gross'])<1e-9 for t in vt)
 candidates=copy.deepcopy(raw) if name=='LEGACY_EXIT_REFERENCE' else [c for c in raw if c['strategy_id']!='V12']+[candidate(t,'V12',old_v.get(key(t))) for t in vt]
 qdelta=[]
 if name in {'Q_REV20_DELTA','Q_RET14_DELTA'}:
  variant='REV_LONG_020' if name=='Q_REV20_DELTA' else 'RET14_WIDEN'
  basekeys={key(x) for x in read_table('Q102')}
  occupied={c['entry_ts_ms'] for c in candidates if c['strategy_id']=='Q102'}
  qdelta=[t for t in read_table('Q102',variant) if key(t) not in basekeys and t['entry_ts_ms'] not in occupied]
  for t in qdelta:
   c=candidate(t,'Q102')
   c['requested_gross']=1.5 if c.get('family')=='REV' and c['side']=='LONG' else .75 if c.get('family') in {'MR','BRK'} else 2.0 if c.get('family')=='PB' and c['side']=='LONG' else 1.
   candidates.append(c)
 iv={'IDLE_VOLUME80':'VOLUME_80PCT','IDLE_RELATIVE20':'RELATIVE_02'}.get(name,'BASELINE')
 rv='RELATIVE_02' if name=='RESIDUAL_RELATIVE20' else 'BASELINE'
 hv='SLOPE_50' if name=='HYPE_SLOPE50' else 'BASELINE'
 candidates += [candidate(t,'IDLE') for t in read_table('IDLE',iv)]
 candidates += [candidate(t,'RESIDUAL') for t in read_table('RESIDUAL',rv)]
 candidates += [candidate(t,'HYPE_LONG') for t in read_table('HYPE',hv)]
 # Stable source symbol priority for simultaneous residual candidates.
 candidates.sort(key=lambda c:(c['entry_ts_ms'],0 if c['strategy_id']=='RESIDUAL' else 1,c.get('priority',0),c['symbol']))
 case=OUT/'cases'/name;cr=case/'candidates';cr.mkdir(parents=True,exist_ok=True)
 (cr/'crypto-price-model-candidates.jsonl').write_text(''.join(json.dumps(c,sort_keys=True)+'\n' for c in candidates),encoding='utf-8')
 strict=("strategy=='RESIDUAL'" if name=='LOT_FLOOR_SHORT_ONLY' else "strategy=='IDLE'" if name=='LOT_FLOOR_RESIDUAL_ONLY' else name in {'CURRENT_H1_STRICT','LEGACY_EXIT_REFERENCE'})
 source=(SUPPORT/'run-current-vps-no-dca.py').read_text(encoding='utf-8')
 source=source.replace('    return source\n','    return patch_admission(source,STRICT)\n'.replace('STRICT',repr(strict)))
 source=source.replace('m=load_ownership_engine(source_transform=patch)','m=load_ownership_engine(source_transform=patch)\nm._idle_quantity_ok=quantity_ok')
 source=source.replace('prepare_overlay_batch(rs,active,completed,ts,market,equity,gross,finalize,lifecycle)','source_batch(rs,active,completed,ts,market,equity,gross,finalize,lifecycle)')
 source=source.replace('hype,_=build_hype_candidates(data,hf,m.PERIOD_END_MS);extra,_=base.overlay_candidates(rows(features),data,True,True,m.PERIOD_END_MS)','hype=[];extra=[]')
 source=source.replace('out=pathlib.Path(__file__).resolve().parent/"runs"/variant','out=case/"runs"')
 saved=list(sys.argv);sys.argv=['model','VPS_VENUE_'+name,'AVAX','-0.12','1.0','0.6','1.5','BOTH',str(cr),'0',costs,'strict365']
 ns={'__file__':str(SUPPORT/'run-current-vps-no-dca.py'),'__name__':'__research__','patch_admission':patch_admission,'quantity_ok':quantity_ok,'source_batch':source_batch,'case':case}
 try:exec(compile(source,str(SUPPORT/'run-current-vps-no-dca.py'),'exec'),ns)
 finally:sys.argv=saved
 summary=json.loads((case/'runs/summary.json').read_text());scenarios=summary['scenarios'];mid=1754784000000+182*24*H
 for sc in scenarios:
  trade=rows(case/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
  m=lambda xs:{'trades':len(xs),'win_rate':sum(x['total_pnl_jpy']>0 for x in xs)/len(xs) if xs else None,'pf_usd':sum(max(0,x['total_pnl_jpy']) for x in xs)/-sum(min(0,x['total_pnl_jpy']) for x in xs) if any(x['total_pnl_jpy']<0 for x in xs) else None}
  sc['first_half']=m([x for x in trade if x['exit_ts_ms']<mid]);sc['second_half']=m([x for x in trade if x['entry_ts_ms']>=mid])
  sc['split_excluded_crossing_trades']=sum(x['entry_ts_ms']<mid<=x['exit_ts_ms'] for x in trade)
  days=collections.Counter(datetime.datetime.fromtimestamp(x['entry_ts_ms']/1000,datetime.timezone(datetime.timedelta(hours=9))).date().isoformat() for x in trade)
  sc['entry_days_jst']=len(days);sc['zero_entry_days_out_of_365_jst_approx']=365-len(days)
  sc['counts_by_strategy']=dict(collections.Counter(x['strategy_id'] for x in trade))
  sc['idle_residual_net_pnl_usd']=sum(x['total_pnl_jpy'] for x in trade if x['strategy_id'] in {'IDLE','RESIDUAL'})
  sc['scope']='H1_REFERENCE_PORTFOLIO_WITH_SOURCE_V12_EXITS_AND_IDLE_SIGNALS_NOT_FULL_ASYNC_LIVE_REPLAY'
 result={'case':name,'strict_quantity':strict,'v12_variant':vvariant,'q_delta_candidates':len(qdelta),'q_scope':'FIXED_HIGH_VOL_STREAM_PLUS_NON_COLLIDING_S34_DELTA_NOT_FULL_SELECTOR_RETRAIN' if qdelta else 'REFERENCE_CORE_STREAM','candidates_by_strategy':dict(collections.Counter(c['strategy_id'] for c in candidates)),'scenarios':scenarios,'unresolved_counts':summary.get('unresolved_crypto_candidate_counts'),'v52_model_complete':summary.get('v52_model_complete'),'v52_funding_verified':summary.get('v52_funding_verified')}
 (case/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
 print('CASE_RESULT',json.dumps({'name':name,'results':[{'cost':s['scenario_id'],'final':s['final_equity_jpy'],'pf':s['profit_factor'],'dd':s['maximum_mtm_drawdown'],'wr':s['win_rate'],'trades':s['closed_trades'],'counts':s['counts_by_strategy'],'entry_days':s['entry_days_jst']} for s in scenarios]}),flush=True)
 return result
def main():
 initialize()
 cases=sys.argv[1:] or ['LEGACY_EXIT_REFERENCE','CURRENT_H1_STRICT','LOT_FLOOR_FIX','LOT_FLOOR_SHORT_ONLY','LOT_FLOOR_RESIDUAL_ONLY','V12_BTC15','V12_BTC10','V12_SCORE85','V12_VOLUME55','V12_RELAXED_ATR10','Q_REV20_DELTA','Q_RET14_DELTA','HYPE_SLOPE50','IDLE_VOLUME80','IDLE_RELATIVE20','RESIDUAL_RELATIVE20']
 for name in cases:
  print('CASE_START',name,flush=True);run(name,os.environ.get('DISDEX_GATE_BT_COSTS','10,20,30'))
  summary=[json.loads(p.read_text(encoding='utf-8')) for p in sorted((OUT/'cases').glob('*/result.json'))]
  (OUT/'comparison-summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
if __name__=='__main__':main()
