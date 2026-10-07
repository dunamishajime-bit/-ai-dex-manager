"""Factor V12 direction, timing, score, regime, execution and payoff. Research only."""
from pathlib import Path
import sys,json,inspect,collections,math,gzip,hashlib,shutil
import run_wr60_new_model as w
ROOT=w.ROOT;OUT=ROOT/'docs/research/results/v12-logic-dissection-20261008';H=w.H;MID=1754784000000+182*24*H
TABLES={};ACTIVE={};SIM={}
def rows(p):return w.base.rows(p if p.exists() else Path(str(p)+'.gz'))
def initialize():
 w.OUT=OUT;w.load_bars()
 for name in ['BASELINE','MOM12','MOM24','BTC24','BTC12','BREAKOUT36']:TABLES[name]=rows(OUT/'source-candidates'/f'{name}.jsonl')
 src=inspect.getsource(w.simulate_v12).replace('def simulate_v12(','def sim(')
 for name,patch in [('BASE',{}),('NO_TRAIL',{'arm':999}),('CLOSE_TRAIL',{})]:
  code=src
  if name=='CLOSE_TRAIL':code=code.replace("peak=max(peak,b['high'],prev['high']) if sg==1 else min(peak,b['low'],prev['low'])","peak=max(peak,b['close']) if sg==1 else min(peak,b['close'])")
  ns={'H':H};exec(code,ns);SIM[name]=(ns['sim'],patch)
 ref={w.base.key(c):c for c in w.frozen_read('V12')}
 a=TABLES['BASELINE'];assert set(map(w.base.key,a))==set(ref)
 for c in a:
  old=ref[w.base.key(c)];x=simulate(c,'BASE')
  for k in ['atr','rank','requested_gross']:assert math.isclose(c[k],old[k],rel_tol=1e-12)
  assert (x['exit_ts_ms'],x['exit_price'],x['reason'])==(old['exit_ts_ms'],old['exit_price'],old['reason'])
 (OUT/'source-exit-parity.json').write_text(json.dumps({'source_candidates':len(a),'exact_keys_and_exits':True,'atr_gross_rank_tolerance':1e-12},indent=2))
def simulate(c,mode):
 fn,p=SIM[mode];return fn(c,w.bars[c['symbol']],p)
def stat(values):
 n=len(values);loss=-sum(min(x,0) for x in values);win=sum(max(x,0) for x in values)
 return {'n':n,'win_rate':sum(x>0 for x in values)/n if n else None,'pf':win/loss if loss else None,'mean':sum(values)/n if n else None,'sum':sum(values),'without_best':sum(values)-max(values,default=0)}
def screen():
 initialize();a=TABLES['BASELINE'];features=[];errors=collections.Counter()
 for c in a:
  sg=1 if c['side']=='LONG' else -1;series=w.bars[c['symbol']];t=c['entry_ts_ms'];e=c['entry_price'];x=simulate(c,'BASE');f=dict(c)
  f['actual_exit']=x;f['horizons']={}
  for h in [1,2,4,6,12,24,46]:
   b=series.get(t+h*H);f['horizons'][str(h)]=sg*(b['open']/e-1) if b else None
  # Bounds over FULL H1 bars strictly before the exit hour. For intrabar exits these are upper/lower bounds, not tick-certified.
  bs=[series[u] for u in range(t,x['exit_ts_ms']-H,H) if u in series]
  f['mfe_pre_exit_hour']=max([0]+[sg*((b['high'] if sg==1 else b['low'])/e-1) for b in bs])
  f['mae_pre_exit_hour']=min([0]+[sg*((b['low'] if sg==1 else b['high'])/e-1) for b in bs])
  # Last H2 extreme versus fresh next-open: objectively measures unfillable replacement distance.
  xt=x['exit_ts_ms'];b1=series.get(xt-H);b2=series.get(xt-2*H)
  if x['reason']=='TRAILING_CROSSED_BEFORE_REPLACEMENT' and b1 and b2:
   extreme=max(b1['high'],b2['high']) if sg==1 else min(b1['low'],b2['low'])
   target=extreme-sg*.2*c['atr'];f['replacement_gap_atr']=max(0,sg*(target-x['exit_price'])/c['atr'])
  distance=None
  bc=[w.bars['BTCUSDT'].get(t-i*2*H-H) for i in range(53)]
  if all(bc):distance=bc[0]['close']/(sum(z['close'] for z in bc)/53)-1
  f['entry_route']='STANDARD_SCORE' if c['score']>=1 else 'STRONG_LOW_SCORE' if distance is not None and abs(distance)>=.0359 else 'RELAXED_MOMENTUM'
  f['btc_short_alignment']='ALIGNED' if c['entry_features']['btc12h']>=0 else 'OPPOSED'
  features.append(f)
 (OUT/'baseline-path-dissection.jsonl').write_text(''.join(json.dumps(f,sort_keys=True)+'\n' for f in features))
 diagnostic={}
 for dim in ['ALL','side','rank','entry_route','entryQualityClass','regime','btc_short_alignment','symbol']:
  groups=collections.defaultdict(list)
  for f in features:groups['ALL' if dim=='ALL' else str(f.get(dim))].append(f)
  diagnostic[dim]={}
  for k,fs in groups.items():
   diagnostic[dim][k]={'exit10':stat([f['actual_exit']['unit_gross_return']-.001 for f in fs]),'horizons10':{str(h):stat([f['horizons'][str(h)]-.001 for f in fs if f['horizons'][str(h)] is not None]) for h in [1,2,4,6,12,24,46]},'exit_reasons':dict(collections.Counter(f['actual_exit']['reason'] for f in fs)),'mfe1pct_then_loss':sum(f['mfe_pre_exit_hour']>=.01 and f['actual_exit']['unit_gross_return']-.001<0 for f in fs)}
 (OUT/'path-diagnostics.json').write_text(json.dumps(diagnostic,indent=2))
 matrix=[];simtables={}
 # One-factor source changes plus two execution changes. Same signals/size for exit factors.
 for source,cs in TABLES.items():
  for mode in SIM:
   arr=[simulate(c,mode) for c in cs];simtables[source+'_'+mode]=arr
   train=[c for c in arr if c['exit_ts_ms']<MID]
   matrix.append({'case':source+'_'+mode,'source':source,'exit_mode':mode,'train':{str(cost):stat([c['unit_gross_return']-cost/10000 for c in train]) for cost in [10,20,30]}})
 rank=sorted([x for x in matrix if x['train']['30']['n']>=80],key=lambda x:x['train']['30']['mean'],reverse=True)
 choices=['BASELINE_BASE','BASELINE_NO_TRAIL','BASELINE_CLOSE_TRAIL']
 # Lock best independently regenerated source and best source/exit combination before second-half validation.
 best_source=next(x for x in rank if x['source']!='BASELINE' and x['exit_mode']=='BASE')
 best_combo=next(x for x in rank if x['source']!='BASELINE')
 for x in [best_source,best_combo]:
  if x['case'] not in choices:choices.append(x['case'])
 lock={'selected_cases':choices,'chosen_train_only':[best_source,best_combo],'criteria':'Mandatory BASELINE exit-factor controls; top nonbaseline source BASE and top nonbaseline combo ranked first-half price-only mean at30bps, n>=80. Diagnostic selection does not certify positive edge.','candidates_tested':18,'split_ms':MID,'prior_period_explored':True}
 (OUT/'study-lock.json').write_text(json.dumps(lock,indent=2))
 for x in matrix:
  arr=simtables[x['case']]
  x['second']={str(cost):stat([c['unit_gross_return']-cost/10000 for c in arr if c['entry_ts_ms']>=MID]) for cost in [10,20,30]}
 (OUT/'factor-matrix.json').write_text(json.dumps(matrix,indent=2))
 print('PATH_ALL',json.dumps(diagnostic['ALL']['ALL']),flush=True);print('TRAIN_LOCK',json.dumps(lock),flush=True)
 print('MATRIX',json.dumps(matrix),flush=True)
def read_table(strategy,variant='BASELINE'):
 return w.frozen_read(strategy,variant)
def filt(candidates,name):
 source,mode=name.rsplit('_',1) if not name.endswith('NO_TRAIL') and not name.endswith('CLOSE_TRAIL') else (name.rsplit('_',2)[0], '_'.join(name.rsplit('_',2)[1:]))
 cs=TABLES[source];refs={w.base.key(c):c for c in candidates if c['strategy_id']=='V12'}
 out=[c for c in candidates if c['strategy_id']!='V12']
 for c in cs:
  x=simulate(c,mode);d=w.base.candidate(x,'V12',refs.get(w.base.key(c)))
  d.update(entryQualityClass=c['entryQualityClass'],source_variant=source,exit_variant=mode)
  out.append(d)
 return out
def run():
 initialize();w.setup();w.base.read_table=read_table;w.base._study_filter=filt
 for name in json.loads((OUT/'study-lock.json').read_text())['selected_cases']:
  print('CASE_START',name,flush=True);r=w.base.run_study(name,'10,20,30');r['research_only']=True
  for sc in r['scenarios']:
   ts=rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
   v=[t for t in ts if t['strategy_id']=='V12']
   def stats(a):
    d=w.stats(a);vals=[t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a];d['unit_returns']=stat(vals)
    d['price_pnl_usd']=sum(t['price_pnl'] for t in a);d['funding_pnl_usd']=sum(t['funding_pnl'] for t in a)
    d['net_without_best_usd']=sum(t['total_pnl_jpy'] for t in a)-max([t['total_pnl_jpy'] for t in a],default=0)
    return d
   sc['v12_details']={'all':stats(v),'first':stats([t for t in v if t['exit_ts_ms']<MID]),'second':stats([t for t in v if t['entry_ts_ms']>=MID]),'sides':{side:stats([t for t in v if t['side']==side]) for side in ['LONG','SHORT']}}
   sc['strategy_stats_usd']={sid:w.stats([t for t in ts if t['strategy_id']==sid]) for sid in sorted({t['strategy_id'] for t in ts})}
  (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2))
  (OUT/'comparison-summary.json').write_text(json.dumps([json.loads(p.read_text()) for p in sorted((OUT/'cases').glob('*/result.json'))],indent=2))
  print('CASE_DONE',name,flush=True)
if __name__=='__main__':{'screen':screen,'run':run}[sys.argv[1]]()
