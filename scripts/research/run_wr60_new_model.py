"""Research only: win-rate decomposition and causal exit/entry alternatives. No LIVE mutations."""
from pathlib import Path
import os,sys,json,gzip,copy,inspect,collections,math,datetime,shutil,bisect
import run_gate_fix_comparison as base
ROOT=Path(__file__).resolve().parents[2]
PRIOR=ROOT/'docs/research/results/gate-fixes-bt-20261008'
OUT=ROOT/'docs/research/results/wr60-new-model-20261008'
MARKET=Path(os.environ.get('DISDEX_MARKET_KLINES',r'C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928\market-Aster-H1-funding-and-manifests\normalized\aster\klines'))
H=3600000
VARS={
 'BASELINE_Q_RET14':{},
 'TRAIL_050':{'trail':.5},
 'TRAIL_100':{'trail':1.},
 'ARM1_TRAIL050':{'arm':1.,'trail':.5},
 'ARM1_TRAIL100':{'arm':1.,'trail':1.},
 'ARM2_TRAIL100':{'arm':2.,'trail':1.},
 'TP1_ARM1_TRAIL100':{'arm':1.,'trail':1.,'tp':1.},
 'TP15_ARM1_TRAIL100':{'arm':1.,'trail':1.,'tp':1.5},
 'TP2_ARM1_TRAIL100':{'arm':1.,'trail':1.,'tp':2.},
 'REL6_POS':{'rel6':True},
 'Q_MR_OFF':{'mr_off':True},
 'TP15_Q_MR_OFF':{'arm':1.,'trail':1.,'tp':1.5,'mr_off':True},
 'V12_OFF_DIAGNOSTIC':{'v12_off':True},
 'TP1_STOP075':{'arm':1.,'trail':1.,'tp':1.,'stop':.75},
 'TP1_STOP100':{'arm':1.,'trail':1.,'tp':1.,'stop':1.},
 'TP1_STOP150':{'arm':1.,'trail':1.,'tp':1.,'stop':1.5},
 'TP05_STOP075':{'arm':1.,'trail':1.,'tp':.5,'stop':.75},
 'TP075_STOP100':{'arm':1.,'trail':1.,'tp':.75,'stop':1.},
 'ARM05_TRAIL025_STOP100':{'arm':.5,'trail':.25,'stop':1.},
 'TP1_STOP075_REL6':{'arm':1.,'trail':1.,'tp':1.,'stop':.75,'rel6':True},
 'TP05_STOP075_REL6':{'arm':1.,'trail':1.,'tp':.5,'stop':.75,'rel6':True},
 'TP075_STOP100_REL6':{'arm':1.,'trail':1.,'tp':.75,'stop':1.,'rel6':True},
 'TP05_STOP075_REL6_G075':{'arm':1.,'trail':1.,'tp':.5,'stop':.75,'rel6':True,'v12_gross_scale':.75},
 'TP05_STOP075_REL6_G050':{'arm':1.,'trail':1.,'tp':.5,'stop':.75,'rel6':True,'v12_gross_scale':.5},
}
bars={};ACTIVE={}
def frozen_read(strategy,variant='BASELINE'):
 return base.rows(PRIOR/'exit-tables'/f'{strategy}_{variant}.jsonl.gz')
def load_bars():
 for p in MARKET.glob('*.jsonl'):
  a=base.rows(p);bars[p.stem]={int(b['event_time_ms']):{k:float(b[k]) for k in ['open','high','low','close']} for b in a}
def simulate_v12(c,series,params):
 e=c['entry_price'];atr=c['atr'];sg=1 if c['side']=='LONG' else -1
 stop=e-sg*max(atr*params.get('stop',2.477),e*.005);peak=e;tp=e+sg*atr*params.get('tp',3.1995)
 arm=params.get('arm',0.);width=params.get('trail',.2)
 for t in range(c['entry_ts_ms'],c['entry_ts_ms']+c['maxHoldHours']*H,H):
  b=series.get(t)
  if b is None:raise ValueError(('missing bar',c['symbol'],t))
  px=None;reason=None
  if (sg==1 and b['low']<=stop) or (sg==-1 and b['high']>=stop):px=min(stop,b['open']) if sg==1 else max(stop,b['open']);reason='STOP'
  if px is None and ((sg==1 and b['high']>=tp) or (sg==-1 and b['low']<=tp)):px=tp;reason='TAKE_PROFIT'
  if px is None and (t+H)%(2*H)==0:
   prev=series.get(t-H,b)
   peak=max(peak,b['high'],prev['high']) if sg==1 else min(peak,b['low'],prev['low'])
   if sg*(peak-e)>=arm*atr:
    next_stop=max(stop,peak-atr*width) if sg==1 else min(stop,peak+atr*width)
    nxt=series.get(t+H)
    if nxt is not None and ((sg==1 and nxt['open']<=next_stop) or (sg==-1 and nxt['open']>=next_stop)):px=nxt['open'];reason='TRAILING_CROSSED_BEFORE_REPLACEMENT'
    stop=next_stop
  if px is not None:return dict(c,exit_ts_ms=t+H,exit_price=px,reason=reason,unit_gross_return=sg*(px/e-1))
 t=c['entry_ts_ms']+c['maxHoldHours']*H;b=series.get(t)
 if b is None:raise ValueError(('missing timeout',c['symbol'],t))
 return dict(c,exit_ts_ms=t,exit_price=b['open'],reason='TIME_EXIT',unit_gross_return=sg*(b['open']/e-1))
def read_table(strategy,variant='BASELINE'):
 a=frozen_read(strategy,variant)
 if strategy=='V12' and any(k in ACTIVE for k in ['arm','trail','tp','stop']):return [simulate_v12(c,bars[c['symbol']],ACTIVE) for c in a]
 return a
def closed_price(symbol,ts):
 b=bars.get(symbol,{}).get(ts-H)
 return b['close'] if b else None
def signed_relative6(c):
 t=c['entry_ts_ms'];now=closed_price(c['symbol'],t);old=closed_price(c['symbol'],t-6*H);bn=closed_price('BTCUSDT',t);bo=closed_price('BTCUSDT',t-6*H)
 if None in [now,old,bn,bo]:return None
 return (1 if c['side']=='LONG' else -1)*((now/old-1)-(bn/bo-1))
def filter_candidates(candidates,name):
 params=VARS[name];keep=[];counts=collections.Counter()
 for c in candidates:
  reason=None
  if c['strategy_id']=='V12':
   if params.get('v12_off'):reason='V12_OFF_DIAGNOSTIC'
   elif params.get('rel6'):
    v=signed_relative6(c)
    if v is None or v<0:reason='SIGNED_RELATIVE6_NOT_POSITIVE'
  if c['strategy_id']=='Q102' and c.get('family')=='MR' and params.get('mr_off'):reason='Q_MR_OFF'
  if reason:counts[reason]+=1
  else:
   if c['strategy_id']=='V12' and 'v12_gross_scale' in params:c=dict(c,requested_gross=c['requested_gross']*params['v12_gross_scale'])
   keep.append(c)
 (OUT/'candidate-filter-counts').mkdir(parents=True,exist_ok=True)
 (OUT/'candidate-filter-counts'/f'{name}.json').write_text(json.dumps(dict(counts),indent=2),encoding='utf-8')
 return keep
def stats(a):
 p=[t['total_pnl_jpy'] for t in a];w=sum(x>0 for x in p);n=len(p);z=1.96
 center=(w/n+z*z/(2*n))/(1+z*z/n) if n else None
 radius=z*math.sqrt((w/n)*(1-w/n)/n+z*z/(4*n*n))/(1+z*z/n) if n else None
 return {'trades':n,'wins':w,'losses':sum(x<0 for x in p),'win_rate':w/n if n else None,'wilson95_low':center-radius if n else None,'wilson95_high':center+radius if n else None,'pf_usd':sum(max(0,x) for x in p)/-sum(min(0,x) for x in p) if any(x<0 for x in p) else None,'net_pnl_usd':sum(p),'mean_net_pnl_usd':sum(p)/n if n else None}
def decompose():
 p=PRIOR/'cases/Q_RET14_DELTA/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl.gz';ts=base.rows(p);out={}
 for dims in [('strategy_id',),('strategy_id','side'),('strategy_id','family'),('strategy_id','route'),('strategy_id','symbol'),('strategy_id','exit_reason_actual')]:
  groups=collections.defaultdict(list)
  for t in ts:groups[tuple(str(t.get(d)) for d in dims)].append(t)
  out['/'.join(dims)]=[{'group':list(k),**stats(v)} for k,v in sorted(groups.items())]
 (OUT/'baseline-decomposition.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
def setup():
 OUT.mkdir(parents=True,exist_ok=True);(OUT/'inputs').mkdir(exist_ok=True)
 shutil.copy2(PRIOR/'inputs/core-reference-candidates.jsonl.gz',OUT/'inputs/core-reference-candidates.jsonl.gz')
 shutil.copy2(PRIOR/'quantity-production-vectors.json',OUT/'quantity-production-vectors.json')
 base.OUT=OUT;base.read_table=read_table;base._study_filter=filter_candidates
 source=inspect.getsource(base.run).replace('def run(name,costs):','def run_study(name,costs):')
 source=source.replace("if name in {'Q_REV20_DELTA','Q_RET14_DELTA'}:","if True:") # Same previously compared Q delta baseline in EVERY case.
 source=source.replace(' # Stable source symbol priority for simultaneous residual candidates.',' candidates=_study_filter(candidates,name)\n # Stable source symbol priority for simultaneous residual candidates.')
 assert '_study_filter(candidates,name)' in source
 exec(compile(source,'<wr60-study-adapter>','exec'),base.__dict__)
def parity():
 a=frozen_read('V12');changed=0
 for c in a:
  t=simulate_v12(c,bars[c['symbol']],{})
  assert t['exit_ts_ms']==c['exit_ts_ms'] and t['reason']==c['reason'] and math.isclose(t['exit_price'],c['exit_price'],abs_tol=1e-12),c
 (OUT/'exit-adapter-parity.json').write_text(json.dumps({'baseline_v12_candidates':len(a),'matching_exits':len(a),'status':'PASS','frozen_baseline_commit':'07744efb851a83200bffc2d0cb4b0be28d94190b'},indent=2),encoding='utf-8')
 print('V12_EXIT_ADAPTER_PARITY',len(a),flush=True)
def main():
 global ACTIVE
 setup();load_bars();parity();decompose()
 names=sys.argv[1:] or list(VARS)
 for name in names:
  assert name in VARS;ACTIVE=VARS[name];print('WR60_CASE_START',name,flush=True)
  result=base.run_study(name,os.environ.get('DISDEX_GATE_BT_COSTS','10,20,30'))
  result['study_parameters']=ACTIVE;result['baseline']='Q_RET14_DELTA';result['research_only']=True
  for sc in result['scenarios']:
   a=base.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
   sc['strategy_stats_usd']={sid:stats([t for t in a if t['strategy_id']==sid]) for sid in sorted({t['strategy_id'] for t in a})}
   sc['win_rate_wilson95']=stats(a)
  (OUT/'cases'/name/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
  summary=[json.loads(p.read_text(encoding='utf-8')) for p in sorted((OUT/'cases').glob('*/result.json'))]
  (OUT/'comparison-summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
if __name__=='__main__':main()
