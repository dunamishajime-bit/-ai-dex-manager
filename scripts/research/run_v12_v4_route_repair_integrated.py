"""Integrated V12 V4 route-quality improvement test.

Applies only simple weak-route repairs that survived candidate-level 30bps and both
temporal halves. Keeps gross/risk architecture unchanged so route-quality effect is isolated.
Research only; no LIVE/Production changes.
"""
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_multilogic_v4_quality_refine as qref
    import run_v12_multilogic_v4_final1000 as final
    import run_v12_multilogic_v4_flip as flip
    import run_v12_multilogic_v4_minlift as mlift
    import run_v12_multilogic_v4_stacking as v4
    import run_v12_multilogic_v3 as v3
    import run_v12_independent_sleeves as ind
    import run_v12_multilogic_recovery as ml

s=v4.s
ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-v4-route-repair-integrated-20261009'
MID=s.MID
H=3600000
FP=ROOT/'docs/research/results/v12-missed-route-decomposition-20261008/feature-table.jsonl'

def rows(p): return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
F=rows(FP)
FK={(x['symbol'],x['side'],int(x['entry_ts_ms'])):x for x in F}

REPAIRS={
 'REC_G2_EARLY_BTC_OPPOSE_VOL': {'filters':['BTC24_ALIGNED'],'time_h':6},
 'REC_G3_LATE_BTC_REL': {'filters':['CLV_FAVOR']},
 'REC_G4_MATURE_REL_RANGE': {'filters':['BTC6_OPPOSE'],'time_h':24},
 'REC_X06_TIME_12H': {'filters':['VOL_GE1'],'time_h':18},
 'REC_X07_TIME_6H': {'filters':['BODY_FAVOR']},
 'REC_X08_TIME_48H': {'filters':['CLV_OPPOSE']},
 'REC_X10_TIME_48H': {'filters':['AGE_12_24']},
 'REC_X14_TIME_48H': {'filters':['EMA_10_20','RANGE_TOP25']},
}

def pred(name,f):
 if not f:return False
 if name=='BTC24_ALIGNED':return isinstance(f.get('btc24'),(int,float)) and f['btc24']>=0
 if name=='CLV_FAVOR':return isinstance(f.get('clv'),(int,float)) and f['clv']>=.6
 if name=='BTC6_OPPOSE':return isinstance(f.get('btc6'),(int,float)) and f['btc6']<0
 if name=='VOL_GE1':return isinstance(f.get('vol_ratio'),(int,float)) and f['vol_ratio']>=1
 if name=='BODY_FAVOR':return isinstance(f.get('body_atr'),(int,float)) and f['body_atr']>0
 if name=='CLV_OPPOSE':return isinstance(f.get('clv'),(int,float)) and f['clv']<=.4
 if name=='AGE_12_24':return isinstance(f.get('age'),(int,float)) and 12<=f['age']<24
 if name=='EMA_10_20':return isinstance(f.get('ema12_dist'),(int,float)) and 1<=f['ema12_dist']<2
 if name=='RANGE_TOP25':return isinstance(f.get('range_loc24'),(int,float)) and f['range_loc24']>=.75
 raise ValueError(name)

def source_feature(d):
 side=d.get('source_v12_side') or d.get('side')
 ts=int(d.get('source_v12_entry_ts_ms') or d.get('entry_ts_ms'))
 return FK.get((d['symbol'],side,ts))

def set_time_exit(d,h,label):
 t=int(d['entry_ts_ms'])+h*H
 b=s.w.bars.get(d['symbol'],{}).get(t)
 if b is None:return None
 px=float(b['open']);sg=1 if d['side']=='LONG' else -1
 x=dict(d);x.update(exit_ts_ms=t,exit_price=px,exit_reason=label,
     unit_price_return=sg*(px/float(d['entry_price'])-1))
 return x

def patch16(source,strict):
 q=flip.flip_patch(source,strict)
 old='if len(active_same_route) >= 8:'
 assert q.count(old)==1,q.count(old)
 return q.replace(old,'if len(active_same_route) >= 16:',1)

def make_filter(repaired):
 def filt(candidates,case_name):
  # Start from Final1000 generation.
  base=v3.filt(candidates,case_name)
  out=[]
  for c in base:
   d=dict(c)
   # Preferred G5 fixed 48h from current frozen candidate.
   if d.get('strategy_id')=='V12' and d.get('route')=='REC_G5_SLOW_TREND':
    x=set_time_exit(d,48,'REC_G5_TIME48_REFINED')
    if x is None:continue
    d=x
   if repaired and d.get('strategy_id')=='V12' and d.get('route') in REPAIRS:
    spec=REPAIRS[d['route']];f=source_feature(d)
    if not all(pred(k,f) for k in spec.get('filters',[])):continue
    if spec.get('time_h'):
     x=set_time_exit(d,int(spec['time_h']),'REPAIRED_'+d['route']+'_TIME'+str(spec['time_h']))
     if x is None:continue
     d=x
   out.append(d)
  return out
 return filt

def detail(rows):
 d=s.w.stats(rows)
 d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/H for t in rows)
 return d

def util(rows):
 if not rows:return {}
 start=min(x['entry_ts_ms'] for x in rows)//H*H;end=max(x['exit_ts_ms'] for x in rows)//H*H
 hs=range(start,end+1,H);vals=[]
 for t in hs:vals.append(sum(float(x.get('accepted_gross',0)) for x in rows if x['entry_ts_ms']<=t<x['exit_ts_ms']))
 return {'avg_gross':sum(vals)/len(vals),'median_gross':sorted(vals)[len(vals)//2],
         'pct_lt_0_5':sum(v<.5 for v in vals)/len(vals),'pct_zero':sum(v==0 for v in vals)/len(vals),
         'avg_v12_cap_util':sum(vals)/len(vals)/2}

CASES={'V4_FROZEN_REFERENCE':False,'V4_ROUTE_REPAIRED':True}

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 s.w.OUT=OUT;s.w.setup();v4.install_virtual_leg_study_adapter()
 final.install_final_routes();v3.stage3_transform=final.stage3_candidate_all
 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
 ind.ACTIVE_RECOVERY_CAP=1.0;mlift.MAX_LIFT_GROSS=.30
 ind.ORIG_PATCH=s.w.base.patch_admission;s.w.base.patch_admission=patch16;s.w.base.source_batch=ind.custom_source_batch
 s.w.base.read_table=v3.v2.read_table
 results=[]
 for name,repaired in CASES.items():
  v3.CASE[name]={'family_cap':1.0,'gross':.10,'slots':16}
  s.w.base._study_filter=make_filter(repaired)
  print('START',name,flush=True)
  r=s.w.base.run_study(name,'10,20,30');r['repairs']=REPAIRS if repaired else {}
  for sc in r['scenarios']:
   ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
   vv=[x for x in ts if x['strategy_id']=='V12']
   sc['v12_details']={'all':detail(vv),'first':detail([x for x in vv if x['exit_ts_ms']<MID]),
    'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),
    'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})},
    'utilization':util(vv)}
  results.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
  print('DONE',name,flush=True)
 (OUT/'protocol.json').write_text(json.dumps({'research_only':True,'repairs':REPAIRS,'costs_bps':[10,20,30]},indent=2),encoding='utf-8')

if __name__=='__main__':main()
