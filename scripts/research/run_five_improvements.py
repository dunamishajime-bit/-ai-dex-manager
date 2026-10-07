"""Reproducible current-source reference comparisons; no LIVE changes."""
import pathlib,sys,json,gzip,copy,hashlib,subprocess,statistics,os
from five_improvement_policies import earlier_exit, governor_multiplier,excursions
ROOT=pathlib.Path(__file__).resolve().parents[2]
BASE=pathlib.Path(r'C:\tmp\current-vps-no-dca-bt-20261007\docs\research\results\current-vps-no-dca-20261007')
DATA=pathlib.Path(r'C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928\market-Aster-H1-funding-and-manifests')
OUT=ROOT/'docs/research/results/five-improvements-20261008'
OUT.mkdir(parents=True,exist_ok=True)
H=3600000
def readrows(path):
 with (gzip.open(path,'rt',encoding='utf-8') if str(path).endswith('.gz') else open(path,encoding='utf-8')) as f:return [json.loads(l) for l in f if l.strip()]
def bars(symbol):
 return {int(x['event_time_ms']):x for x in readrows(DATA/'normalized/aster/klines'/f'{symbol}.jsonl')}
def patch_governor(source,window,mult,lookback=6):
 if not window:return source
 hook='                strategy_room = max(0.0, research_cap - strategy_gross)\n'
 assert hook in source
 code="""                btc_now=_mark(market,"BTCUSDT",ts)
                btc3=_mark(market,"BTCUSDT",ts-3*HOUR)
                btc6=_mark(market,"BTCUSDT",ts-6*HOUR)
                bcurrent=None if btc_now is None or btc3 is None else btc_now/btc3-1
                bprevious=None if btc3 is None or btc6 is None else btc3/btc6-1
                samegross=sum(_gross(p,market,ts,equity) for p in active.values() if p["side"]==candidate["side"] and p["strategy_id"]!="V52")
                losses=[{"ts":int(p["exit_ts_ms"]),"side":p["side"],"strategy":p["strategy_id"],"pnl":p["total_pnl_jpy"]} for p in completed]
                factor=_research_governor(losses,ts,candidate["side"],samegross,bcurrent,bprevious,WINDOW,MULT) if strategy!="V52" else 1.
                if factor<1:
                    _governor_log.append({"ts":ts,"strategy":strategy,"side":candidate["side"],"requested_before":requested,"same_side_gross":samegross,"btc_current3":bcurrent,"btc_previous3":bprevious,"multiplier":factor})
                    requested*=factor
"""
 code=code.replace('ts-6*HOUR','ts-'+str(lookback)+'*HOUR').replace('WINDOW',str(window)).replace('MULT',repr(mult))
 return source.replace(hook,code+hook,1)
def run(policy,window=0,mult=1,costs='10'):
 variant='VPS_VENUE_'+policy
 case=OUT/'cases'/policy;case.mkdir(parents=True,exist_ok=True)
 raw=readrows(BASE/'inputs/current-source-checked-candidates.jsonl.gz')
 market={s:bars(s) for s in {x['symbol'] for x in raw if x['strategy_id'] in {'FET','Q102'}}|{'BTCUSDT'}}
 candidates=[earlier_exit(c,market.get(c['symbol'],{}),market['BTCUSDT'],policy) for c in raw]
 changes=[{'strategy':a['strategy_id'],'symbol':a['symbol'],'side':a['side'],'family':a.get('family'),'entry_ts_ms':a['entry_ts_ms'],'old_exit_ts_ms':a['exit_ts_ms'],'new_exit_ts_ms':b['exit_ts_ms'],'old_price':a['exit_price'],'new_price':b['exit_price']} for a,b in zip(raw,candidates) if a!=b]
 (case/'candidate-changes.json').write_text(json.dumps(changes,indent=2))
 cr=case/'candidates';cr.mkdir(exist_ok=True)
 (cr/'crypto-price-model-candidates.jsonl').write_text(''.join(json.dumps(c,sort_keys=True)+'\n' for c in candidates),encoding='utf-8')
 s=(BASE/'run-current-vps-no-dca.py').read_text(encoding='utf-8')
 assert s.count('    return source\n')==1
 s=s.replace('    return source\n','    return patch_governor(source,WINDOW,MULT)\n'.replace('WINDOW',str(window)).replace('MULT',repr(mult)))
 s=s.replace('m=load_ownership_engine(source_transform=patch)','m=load_ownership_engine(source_transform=patch)\nm._research_governor=logged_governor\nm._governor_log=[]')
 s=s.replace('out=pathlib.Path(__file__).resolve().parent/"runs"/variant','out=case/"runs"')
 saved=list(sys.argv);sys.argv=['model',variant,'AVAX','-0.12','1.0','0.6','1.5','BOTH',str(cr),'0',costs,'strict365']
 sys.path.insert(0,str(BASE))
 diagnostics={'evaluated':0,'cross_strategy_losses':0,'cross_losses_and_gross':0,'cross_losses_and_gross_and_adverse_btc':0,'all_three':0}
 def logged_governor(losses,ts,side,gross,bc,bp,win,mul):
  sg=1 if side=='LONG' else -1
  distinct={x['strategy'] for x in losses if ts-win*H<=x['ts']<=ts and x['side']==side and x['pnl']<0 and x['strategy']!='V52'}
  flags=[len(distinct)>=2,gross>=1,bc is not None and sg*bc<=-.01,bp is not None and sg*bp>=0]
  diagnostics['evaluated']+=1
  if flags[0]:diagnostics['cross_strategy_losses']+=1
  if all(flags[:2]):diagnostics['cross_losses_and_gross']+=1
  if all(flags[:3]):diagnostics['cross_losses_and_gross_and_adverse_btc']+=1
  if all(flags):diagnostics['all_three']+=1
  return governor_multiplier(losses,ts,side,gross,bc,bp,win,mul)
 ns={'__file__':str(BASE/'run-current-vps-no-dca.py'),'__name__':'__research__','patch_governor':lambda src,w,m:patch_governor(src,w,m,24 if policy.startswith('GOV24') else 6),'governor_multiplier':governor_multiplier,'logged_governor':logged_governor,'case':case}
 try:exec(compile(s,str(BASE/'run-current-vps-no-dca.py'),'exec'),ns)
 finally:sys.argv=saved
 summary=json.loads((case/'runs/summary.json').read_text())
 (case/'governor-observations.json').write_text(json.dumps(ns['m']._governor_log,indent=2))
 result={'governor_stage_diagnostics':diagnostics,'policy':policy,'candidate_changes':len(changes),'governor_evaluations':len(ns['m']._governor_log),'scenarios':summary['scenarios']}
 (case/'result.json').write_text(json.dumps(result,indent=2))
 if policy=='BASELINE':
  a=result['scenarios'][0]
  ref=json.loads((BASE/'ledgers/VPS_VERIFIED_VENUE_365D/PRICE_MODEL_10BPS/metrics.json').read_text())
  assert abs(a['final_equity_jpy']-ref['final_equity_jpy'])<1e-6,'BASELINE_FINAL_MISMATCH'
  assert a['closed_trades']==1362
 return result
if __name__=='__main__':
 policies=[('BASELINE',0,1),('FET_TRAIL_5_2',0,1),('FET_TRAIL_5_3',0,1),('FET_TRAIL_7_2',0,1),('FET_TRAIL_8_2',0,1),('FET_TRAIL_5_3_TIGHT7_2',0,1),('FET_TRAIL_5_3_TIGHT8_2',0,1),('FET_MOM_12',0,1),('FET_MOM_18',0,1),('Q_HV_1',0,1),('Q_HV_2',0,1),('Q_REV_2',0,1),('Q_REV_4',0,1),('Q_PB_1',0,1),('Q_PB_2',0,1),('GOV24_6_60',6,.6),('GOV24_6_75',6,.75),('GOV24_12_60',12,.6),('GOV24_12_75',12,.75),('GOV_6_60',6,.6),('GOV_6_75',6,.75),('GOV_12_60',12,.6),('GOV_12_75',12,.75)]
 chosen=sys.argv[1:] or [x[0] for x in policies];results=[]
 for p,w,m in policies:
  if p not in chosen:continue
  print('CASE_START',p,flush=True)
  result=run(p,w,m,costs=os.environ.get("FIVE_RESEARCH_COSTS","10"))
  results.append(result)
  (OUT/'research-summary.json').write_text(json.dumps([json.loads(f.read_text()) for f in sorted((OUT/"cases").glob("*/result.json"))],indent=2))
  a=result['scenarios'][0]
  print('CASE_RESULT',json.dumps({'policy':p,'final':a['final_equity_jpy'],'pf':a['profit_factor'],'dd':a['maximum_mtm_drawdown'],'trades':a['closed_trades'],'changes':result['candidate_changes'],'governor':result['governor_evaluations']}),flush=True)
