"""Research-only V12 multi-logic V2 integrated replay.
Keeps profitable legacy-exit recovery routes and adds stage-2 incremental ENTRY+EXIT
routes, each as an independent preemptible recovery sleeve.
No LIVE/Production changes.
"""
import contextlib,io,json,re
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_independent_sleeves as ind
    import run_v12_multilogic_recovery as ml

s=ml.s
ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-v2-20261008'
FP=ROOT/'docs/research/results/v12-missed-route-decomposition-20261008/feature-table.jsonl'
STAGE2=ROOT/'docs/research/results/v12-recovery-stage2-search-20261008/selected-stage2-routes.json'
H=3600000
MID=s.MID
FEATURES=[json.loads(x) for x in FP.read_text(encoding='utf-8').splitlines() if x.strip()]
K=lambda x:(x['symbol'],x['side'],int(x['entry_ts_ms']))
P={
 'SIDE_SHORT':lambda x:x['side']=='SHORT','SIDE_LONG':lambda x:x['side']=='LONG',
 'AGE_0_24':lambda x:isinstance(x.get('age'),(int,float)) and 0<=x['age']<24,
 'AGE_24_48':lambda x:isinstance(x.get('age'),(int,float)) and 24<=x['age']<48,
 'AGE_48_72':lambda x:isinstance(x.get('age'),(int,float)) and 48<=x['age']<72,
 'AGE_72_97':lambda x:isinstance(x.get('age'),(int,float)) and 72<=x['age']<97,
 'RET6_0_05':lambda x:isinstance(x.get('sret6'),(int,float)) and 0<=x['sret6']<.005,
 'RET6_05_15':lambda x:isinstance(x.get('sret6'),(int,float)) and .005<=x['sret6']<.015,
 'BTC6_ALIGNED':lambda x:isinstance(x.get('btc6'),(int,float)) and x['btc6']>=0,
 'BTC6_OPPOSE':lambda x:isinstance(x.get('btc6'),(int,float)) and x['btc6']<0,
 'REL12_POS':lambda x:isinstance(x.get('rel12'),(int,float)) and x['rel12']>0,
 'REL24_POS':lambda x:isinstance(x.get('rel24'),(int,float)) and x['rel24']>0,
 'VOL_GE1':lambda x:isinstance(x.get('vol_ratio'),(int,float)) and x['vol_ratio']>=1,
 'VOL_LT1':lambda x:isinstance(x.get('vol_ratio'),(int,float)) and x['vol_ratio']<1,
 'ER24_LT30':lambda x:isinstance(x.get('er24'),(int,float)) and x['er24']<.3,
 'RANGE_NOT_TOP25':lambda x:isinstance(x.get('range_loc24'),(int,float)) and x['range_loc24']<.75,
}
GOOD=[
 ('REC_G1_MID_REL_LOWVOL',['SIDE_SHORT','RET6_05_15','REL12_POS','VOL_LT1']),
 ('REC_G2_EARLY_BTC_OPPOSE_VOL',['SIDE_SHORT','AGE_0_24','BTC6_OPPOSE','VOL_GE1']),
 ('REC_G3_LATE_BTC_REL',['SIDE_SHORT','AGE_72_97','BTC6_ALIGNED','REL12_POS']),
 ('REC_G4_MATURE_REL_RANGE',['SIDE_SHORT','AGE_48_72','REL24_POS','RANGE_NOT_TOP25']),
 ('REC_G5_SLOW_TREND',['SIDE_SHORT','RET6_0_05','BTC6_ALIGNED','ER24_LT30']),
]
GOOD_ASSIGN={};used=set()
for name,conds in GOOD:
 for x in FEATURES:
  k=K(x)
  if k not in used and all(P[c](x) for c in conds):
   used.add(k);GOOD_ASSIGN[k]=name

raw_stage2=json.load(open(STAGE2,encoding='utf-8'))
# Drop route 15 because its tiny second-half incremental subset was not positive.
raw_stage2=raw_stage2[:14]
STAGE2_ASSIGN={}
STAGE2_META={}
for i,r in enumerate(raw_stage2,1):
 name=f'REC_X{i:02d}_{r["exit"]}'
 STAGE2_META[name]=r
 for k in r['inc_keys']:
  STAGE2_ASSIGN[(k[0],k[1],int(k[2]))]=name
print('GOOD5',len(GOOD_ASSIGN),'STAGE2',len(STAGE2_ASSIGN),'TOTAL_RECOVERY_RAW',len(GOOD_ASSIGN)+len(STAGE2_ASSIGN),flush=True)

FAILED=None
CASE={
 'V2_RCAP050_G010':{'family_cap':.50,'gross':.10},
 'V2_RCAP050_G0125':{'family_cap':.50,'gross':.125},
}

def read_table(strategy,variant='BASELINE'):return s.w.frozen_read(strategy,variant)

def parse_exit(name):
 return STAGE2_META[name]['exit']

def atr_at(sym,t,n=14):
 seq=[];prev=None
 for i in range(n+1,0,-1):
  b=s.w.bars.get(sym,{}).get(int(t)-i*H)
  if b is None:return None
  if prev is not None:
   hi=float(b['high']);lo=float(b['low']);pc=float(prev['close']);seq.append(max(hi-lo,abs(hi-pc),abs(lo-pc)))
  prev=b
 return sum(seq[-n:])/n if len(seq)>=n else None

def custom_exit(c,exit_name):
 x=dict(c);e=float(x['entry_price']);sg=1 if x['side']=='LONG' else -1
 m=re.fullmatch(r'TIME_(\d+)H',exit_name)
 if m:
  t=int(x['entry_ts_ms'])+int(m.group(1))*H
  b=s.w.bars.get(x['symbol'],{}).get(t)
  if b is None:return None
  px=float(b['open']);x.update(exit_ts_ms=t,exit_price=px,exit_reason=exit_name,unit_price_return=sg*(px/e-1));return x
 m=re.fullmatch(r'TP([\d.]+)_SL([\d.]+)_H(\d+)',exit_name)
 if not m:raise ValueError('UNKNOWN_EXIT:'+exit_name)
 tp=float(m.group(1));sl=float(m.group(2));hold=int(m.group(3));aa=atr_at(x['symbol'],x['entry_ts_ms']);
 if aa is None:return None
 tp_px=e+sg*tp*aa;sl_px=e-sg*sl*aa
 for h in range(hold):
  t=int(x['entry_ts_ms'])+h*H;b=s.w.bars.get(x['symbol'],{}).get(t)
  if b is None:return None
  hi=float(b['high']);lo=float(b['low']);op=float(b['open'])
  hit_sl=(lo<=sl_px if sg==1 else hi>=sl_px);hit_tp=(hi>=tp_px if sg==1 else lo<=tp_px)
  if hit_sl:
   px=min(sl_px,op) if sg==1 else max(sl_px,op);x.update(exit_ts_ms=t+H,exit_price=px,exit_reason=exit_name+'_STOP',unit_price_return=sg*(px/e-1));return x
  if hit_tp:
   x.update(exit_ts_ms=t+H,exit_price=tp_px,exit_reason=exit_name+'_TP',unit_price_return=sg*(tp_px/e-1));return x
 t=int(x['entry_ts_ms'])+hold*H;b=s.w.bars.get(x['symbol'],{}).get(t)
 if b is None:return None
 px=float(b['open']);x.update(exit_ts_ms=t,exit_price=px,exit_reason=exit_name+'_TIME',unit_price_return=sg*(px/e-1));return x

def filt(candidates,name):
 cfg=CASE[name];out=[];seen=set()
 for c in candidates:
  if c['strategy_id']!='V12':
   out.append(c);continue
  k=(c['symbol'],c['side'],int(c['entry_ts_ms']));d=None
  if k in ml.rc.ROBUST:
   d=dict(c);d.update(route='CONT_SHORT_MID_AGE24_48',entryQualityClass='ROBUST_COMPLEMENT',rank=8)
   d['requested_gross']=min(float(d.get('requested_gross',.25)),.25)
  elif k in GOOD_ASSIGN:
   d=dict(c);d.update(route=GOOD_ASSIGN[k],entryQualityClass='MULTILOGIC_V2_GOOD',rank=9)
   d['requested_gross']=min(float(d.get('requested_gross',cfg['gross'])),cfg['gross'])
  elif k in STAGE2_ASSIGN:
   route=STAGE2_ASSIGN[k];d=custom_exit(c,parse_exit(route))
   if d is not None:
    d.update(route=route,entryQualityClass='MULTILOGIC_V2_STAGE2',rank=9)
    d['requested_gross']=min(float(d.get('requested_gross',cfg['gross'])),cfg['gross'])
  if d is not None:
   tok=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
   if tok not in seen:seen.add(tok);out.append(d)
 for d0 in FAILED:
  d=dict(d0);tok=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
  if tok not in seen:seen.add(tok);out.append(d)
 return out

def detail(a):
 d=s.w.stats(a);d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/H for t in a);return d

def main():
 global FAILED
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({
  'research_only':True,'live_changes':False,'production_changes':False,
  'architecture':'core + robust complement + 5 profitable legacy-exit sleeves + 14 incrementally profitable dedicated-exit sleeves',
  'good5_raw':len(GOOD_ASSIGN),'stage2_raw':len(STAGE2_ASSIGN),'candidate_total_with_core77':77+len(GOOD_ASSIGN)+len(STAGE2_ASSIGN),
  'stage2_routes':[{k:v for k,v in r.items() if k!='inc_keys'} for r in raw_stage2],
  'shared_caps_unchanged':{'crypto':3.0,'V12':2.0,'total':4.25},
  'cases':CASE,'initial_cost_test_bps':[10],
  'warning':'Studied development period. No LIVE promotion.'
 },indent=2),encoding='utf-8')
 s.w.OUT=OUT;s.w.setup();FAILED=ml.failed_candidates();s.w.base.read_table=read_table;s.w.base._study_filter=filt
 ind.ORIG_PATCH=s.w.base.patch_admission;s.w.base.patch_admission=ind.independent_patch;s.w.base.source_batch=ind.custom_source_batch
 res=[]
 for name,cfg in CASE.items():
  ind.ACTIVE_RECOVERY_CAP=cfg['family_cap']
  print('START',name,flush=True)
  r=s.w.base.run_study(name,'10');r['research_only']=True;r['case_config']=cfg
  for sc in r['scenarios']:
   ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');v=[x for x in ts if x['strategy_id']=='V12']
   sc['v12_details']={'all':detail(v),'first':detail([x for x in v if x['exit_ts_ms']<MID]),'second':detail([x for x in v if x['entry_ts_ms']>=MID]),'routes':{rt:detail([x for x in v if x.get('route')==rt]) for rt in sorted({x.get('route') for x in v if x.get('route')})}}
  (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8');res.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(res,indent=2),encoding='utf-8')
  print('DONE',name,flush=True)
if __name__=='__main__':main()
