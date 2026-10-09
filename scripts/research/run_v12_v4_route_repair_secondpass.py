"""Integrated second-pass V12 V4 route repairs + prior first-pass repairs.

Adds broad causal fixes for Core, Robust, G1, X03, X07, X13. X14 and G5 are not
overfit further: X14 remains low-tier; G5 remains fixed48. Research only.
"""
import contextlib,io,json,statistics
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_route_repair_integrated as r1
 import run_v12_multilogic_v4_final1000 as final
 import run_v12_multilogic_v4_flip as flip
 import run_v12_multilogic_v4_minlift as mlift
 import run_v12_multilogic_v4_stacking as v4
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_recovery as ml
s=v4.s;ROOT=s.ROOT;OUT=ROOT/'docs/research/results/v12-v4-route-repair-secondpass-integrated-20261009';H=3600000
MARKET=r1.s3.MARKET if hasattr(r1,'s3') else ROOT
# Use already-loaded H1 bars in v3.s.w after setup.

SECOND={
 'FAILED_BREAK_REV_SHORT_6H':{'filters':['REL24_NEG','BODY_FAVOR'],'time_h':9},
 'CONT_SHORT_MID_AGE24_48':{'filters':['EMA_GE1'],'time_h':3},
 'REC_G1_MID_REL_LOWVOL':{'filters':['RANGE_NOT_TOP'],'time_h':12},
 'REC_X03_TIME_12H':{'filters':['EMA_GE1']},
 'REC_X07_TIME_6H':{'filters':['BTC24_ALIGNED','NOT_COMPRESS']},
 'REC_X13_TP1.5_SL1_H24':{'filters':['NOT_COMPRESS']},
}

def ret(sym,t,n):
 a=s.w.bars.get(sym,{}).get(t-H);z=s.w.bars.get(sym,{}).get(t-H-n*H)
 return None if not a or not z else float(a['close'])/float(z['close'])-1
def ema(vals,n):
 if not vals:return None
 alpha=2/(n+1);e=vals[0]
 for x in vals[1:]:e=alpha*x+(1-alpha)*e
 return e
def atr(sym,t,n=14):
 seq=[];prev=None
 for i in range(n+1,0,-1):
  x=s.w.bars.get(sym,{}).get(t-i*H)
  if not x:return None
  if prev is not None:
   hi=float(x['high']);lo=float(x['low']);pc=float(prev['close']);seq.append(max(hi-lo,abs(hi-pc),abs(lo-pc)))
  prev=x
 return sum(seq[-n:])/n if len(seq)>=n else None
def feat(c):
 sym=c['symbol'];t=int(c['entry_ts_ms']);sg=1 if c['side']=='LONG' else -1;prev=s.w.bars.get(sym,{}).get(t-H)
 if not prev:return {}
 px=float(prev['close']);A=atr(sym,t)
 if not A:return {}
 br24=ret('BTCUSDT',t,24);sr24=ret(sym,t,24)
 cs=[]
 for i in range(48,0,-1):
  x=s.w.bars.get(sym,{}).get(t-i*H)
  if not x:cs=[];break
  cs.append(float(x['close']))
 prior=[s.w.bars.get(sym,{}).get(t-i*H) for i in range(25,1,-1)]
 f={'btc24':None if br24 is None else sg*br24,'rel24':None if sr24 is None or br24 is None else sg*(sr24-br24)}
 f['ema12']=None if not cs else sg*(px-ema(cs[-24:],12))/A
 if all(prior):
  hi=max(float(x['high']) for x in prior);lo=min(float(x['low']) for x in prior);loc=(px-lo)/(hi-lo) if hi>lo else .5;f['range24']=1-loc if sg==-1 else loc
 else:f['range24']=None
 a6=atr(sym,t,6);a24=atr(sym,t,24);f['compression']=a6/a24 if a6 and a24 else None
 o=float(prev['open']);f['body']=sg*(float(prev['close'])-o)/A
 return f
def pred(k,f):
 if k=='REL24_NEG':return f.get('rel24') is not None and f['rel24']<=0
 if k=='BODY_FAVOR':return f.get('body') is not None and f['body']>0
 if k=='EMA_GE1':return f.get('ema12') is not None and f['ema12']>=1
 if k=='RANGE_NOT_TOP':return f.get('range24') is not None and f['range24']<.75
 if k=='BTC24_ALIGNED':return f.get('btc24') is not None and f['btc24']>=0
 if k=='NOT_COMPRESS':return f.get('compression') is not None and f['compression']>.8
 raise ValueError(k)
def settime(d,h,label):
 t=int(d['entry_ts_ms'])+h*H;b=s.w.bars.get(d['symbol'],{}).get(t)
 if not b:return None
 px=float(b['open']);sg=1 if d['side']=='LONG' else -1;x=dict(d);x.update(exit_ts_ms=t,exit_price=px,exit_reason=label,unit_price_return=sg*(px/float(d['entry_price'])-1));return x
def patch16(source,strict):
 q=flip.flip_patch(source,strict);old='if len(active_same_route) >= 8:';assert q.count(old)==1;return q.replace(old,'if len(active_same_route) >= 16:',1)
def make_filter(second):
 base=r1.make_filter(True)
 def filt(candidates,case):
  out=base(candidates,case)
  if not second:return out
  z=[]
  for d0 in out:
   d=dict(d0);spec=SECOND.get(d.get('route'))
   if spec:
    f=feat(d)
    if not all(pred(k,f) for k in spec['filters']):continue
    if spec.get('time_h'):
     x=settime(d,spec['time_h'],'SECOND_REPAIR_'+d['route']+'_TIME'+str(spec['time_h']))
     if x is None:continue
     d=x
   z.append(d)
  return z
 return filt
def detail(rows):return s.w.stats(rows)
CASES={'FIRSTPASS':False,'SECONDPASS':True}
def main():
 OUT.mkdir(parents=True,exist_ok=True);s.w.OUT=OUT;s.w.setup();v4.install_virtual_leg_study_adapter();final.install_final_routes();v3.stage3_transform=final.stage3_candidate_all
 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED;s.w.base.source_batch=ind.custom_source_batch;s.w.base.read_table=v3.v2.read_table
 basepatch=s.w.base.patch_admission;results=[]
 for name,second in CASES.items():
  v3.CASE[name]={'family_cap':1.0,'gross':.10,'slots':16};ind.ACTIVE_RECOVERY_CAP=1.0;mlift.MAX_LIFT_GROSS=.30;ind.ORIG_PATCH=basepatch;s.w.base.patch_admission=patch16;s.w.base._study_filter=make_filter(second)
  print('START',name,flush=True);r=s.w.base.run_study(name,'10,20,30')
  for sc in r['scenarios']:
   ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');vv=[x for x in ts if x['strategy_id']=='V12'];sc['v12_details']={'all':detail(vv),'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}}
  results.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8');print('DONE',name,flush=True)
 (OUT/'protocol.json').write_text(json.dumps({'second_repairs':SECOND},indent=2),encoding='utf-8')
if __name__=='__main__':main()
