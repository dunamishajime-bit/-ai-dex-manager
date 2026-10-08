"""Research-only integrated V12 multi-logic recovery replay.
Architecture:
- failed-break core (existing sizing)
- robust 24-48h SHORT_MID complement (0.25x)
- seven incrementally profitable recovery routes on previously missed baseline trades
- one additional RANGE_TOP25 SHORT route with dedicated 12h time exit
No LIVE/Production changes.
"""
import contextlib,io,json
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
    import analyze_v12_failed_break_sensitivity as sens
import run_v12_logic_dissection as s
import v12_entry_state_logic as m
import run_v12_robust_complement as rc

ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-recovery-20261008'
FP=ROOT/'docs/research/results/v12-missed-route-decomposition-20261008/feature-table.jsonl'
H=3600000
MID=s.MID
F=[json.loads(x) for x in FP.read_text(encoding='utf-8').splitlines() if x.strip()]
def keyx(x):return (x['symbol'],x['side'],int(x['entry_ts_ms']))
P={
 'SIDE_SHORT':lambda x:x['side']=='SHORT','SIDE_LONG':lambda x:x['side']=='LONG',
 'AGE_0_24':lambda x:isinstance(x.get('age'),(int,float)) and 0<=x['age']<24,
 'AGE_24_48':lambda x:isinstance(x.get('age'),(int,float)) and 24<=x['age']<48,
 'AGE_48_72':lambda x:isinstance(x.get('age'),(int,float)) and 48<=x['age']<72,
 'AGE_72_97':lambda x:isinstance(x.get('age'),(int,float)) and 72<=x['age']<97,
 'RET6_NEG':lambda x:isinstance(x.get('sret6'),(int,float)) and x['sret6']<0,
 'RET6_0_05':lambda x:isinstance(x.get('sret6'),(int,float)) and 0<=x['sret6']<.005,
 'RET6_05_15':lambda x:isinstance(x.get('sret6'),(int,float)) and .005<=x['sret6']<.015,
 'BTC6_ALIGNED':lambda x:isinstance(x.get('btc6'),(int,float)) and x['btc6']>=0,
 'BTC6_OPPOSE':lambda x:isinstance(x.get('btc6'),(int,float)) and x['btc6']<0,
 'BTC24_ALIGNED':lambda x:isinstance(x.get('btc24'),(int,float)) and x['btc24']>=0,
 'REL12_POS':lambda x:isinstance(x.get('rel12'),(int,float)) and x['rel12']>0,
 'REL12_NEG':lambda x:isinstance(x.get('rel12'),(int,float)) and x['rel12']<=0,
 'REL24_POS':lambda x:isinstance(x.get('rel24'),(int,float)) and x['rel24']>0,
 'VOL_GE1':lambda x:isinstance(x.get('vol_ratio'),(int,float)) and x['vol_ratio']>=1,
 'VOL_LT1':lambda x:isinstance(x.get('vol_ratio'),(int,float)) and x['vol_ratio']<1,
 'ER24_LT30':lambda x:isinstance(x.get('er24'),(int,float)) and x['er24']<.3,
 'RANGE_TOP25':lambda x:isinstance(x.get('range_loc24'),(int,float)) and x['range_loc24']>=.75,
 'RANGE_NOT_TOP25':lambda x:isinstance(x.get('range_loc24'),(int,float)) and x['range_loc24']<.75,
}
ROUTES=[
 ('REC_S1_MID_REL_LOWVOL',['SIDE_SHORT','RET6_05_15','REL12_POS','VOL_LT1']),
 ('REC_S2_EARLY_BTC_OPPOSE_VOL',['SIDE_SHORT','AGE_0_24','BTC6_OPPOSE','VOL_GE1']),
 ('REC_S3_LATE_BTC_REL',['SIDE_SHORT','AGE_72_97','BTC6_ALIGNED','REL12_POS']),
 ('REC_S4_MATURE_REL_RANGE',['SIDE_SHORT','AGE_48_72','REL24_POS','RANGE_NOT_TOP25']),
 ('REC_L1_EARLY_TREND',['SIDE_LONG','AGE_0_24','BTC24_ALIGNED','RANGE_TOP25']),
 ('REC_S5_SLOW_TREND',['SIDE_SHORT','RET6_0_05','BTC6_ALIGNED','ER24_LT30']),
 ('REC_S6_REL_FLIP',['SIDE_SHORT','AGE_24_48','REL12_NEG','REL24_POS']),
]
ASSIGN={};used=set()
for name,conds in ROUTES:
 for x in F:
  k=keyx(x)
  if k in used:continue
  if all(P[c](x) for c in conds):
   used.add(k);ASSIGN[k]=name
ALT=set()
for x in F:
 k=keyx(x)
 if k not in used and P['SIDE_SHORT'](x) and P['RANGE_TOP25'](x):
  ALT.add(k)
print('RECOVERY_RAW',len(ASSIGN),'ALT_RAW',len(ALT),flush=True)

CASE_CAPS={
 'CORE77':{},
 'MULTI_CAP010':{'default':.10,'alt':.10},
 'MULTI_CAP025':{'default':.25,'alt':.25},
 'MULTI_TIERED':{
  'REC_S1_MID_REL_LOWVOL':.50,
  'REC_S2_EARLY_BTC_OPPOSE_VOL':.50,
  'REC_S3_LATE_BTC_REL':.35,
  'REC_S4_MATURE_REL_RANGE':.50,
  'REC_L1_EARLY_TREND':.25,
  'REC_S5_SLOW_TREND':.25,
  'REC_S6_REL_FLIP':.25,
  'alt':.25,
 }
}
FAILED=None

def read_table(strategy,variant='BASELINE'):return s.w.frozen_read(strategy,variant)

def failed_candidates():
 out=[]
 for c in sens.select(sens.events['WINDOW_6H']):
  x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
  if not x:continue
  d=s.w.base.candidate(x,'V12')
  d.update(route='FAILED_BREAK_REV_SHORT_6H',entryQualityClass='ONSET_FAILED_BREAK_SHORT_6H',
           setup_ts_ms=c['setup_ts_ms'],decision_ts_ms=c['decision_ts_ms'],state_age_h=c['state_age_h'])
  out.append(d)
 return out

def cap_for(name,route):
 cfg=CASE_CAPS[name]
 if name=='CORE77':return None
 return cfg.get(route,cfg.get('default'))

def alt_exit(d):
 t=int(d['entry_ts_ms'])+12*H
 bar=s.w.bars.get(d['symbol'],{}).get(t)
 if not bar:return None
 x=dict(d);px=float(bar['open']);sg=1 if x['side']=='LONG' else -1
 x['exit_ts_ms']=t;x['exit_price']=px;x['exit_reason']='RECOVERY_TIME_EXIT_12H';x['unit_price_return']=sg*(px/float(x['entry_price'])-1)
 # funding is modeled by the integrated engine from market/funding inputs; preserve other candidate metadata.
 return x

def filt(candidates,name):
 out=[];seen=set()
 for c in candidates:
  if c['strategy_id']!='V12':
   out.append(c);continue
  k=(c['symbol'],c['side'],int(c['entry_ts_ms']))
  d=None
  if k in rc.ROBUST:
   d=dict(c);d['route']='CONT_SHORT_MID_AGE24_48';d['entryQualityClass']='ROBUST_COMPLEMENT';d['requested_gross']=min(float(d.get('requested_gross',.25)),.25)
  elif name!='CORE77' and k in ASSIGN:
   route=ASSIGN[k];d=dict(c);d['route']=route;d['entryQualityClass']='MULTILOGIC_RECOVERY';cap=cap_for(name,route);d['requested_gross']=min(float(d.get('requested_gross',cap)),cap)
  elif name!='CORE77' and k in ALT:
   d=alt_exit(c)
   if d is not None:
    d['route']='REC_S7_RANGE_TOP_TIME12';d['entryQualityClass']='MULTILOGIC_RECOVERY_ALT_EXIT';cap=CASE_CAPS[name].get('alt',CASE_CAPS[name].get('default'));d['requested_gross']=min(float(d.get('requested_gross',cap)),cap)
  if d is not None:
   tok=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
   if tok not in seen:seen.add(tok);out.append(d)
 for d0 in FAILED:
  d=dict(d0);tok=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
  if tok not in seen:seen.add(tok);out.append(d)
 return out

def detail(a):
 d=s.w.stats(a);d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/H for t in a)
 return d

def main():
 global FAILED
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({
  'research_only':True,'live_changes':False,'production_changes':False,
  'base_core':'FAILED_BREAK_REV_SHORT_6H + robust SHORT_MID age24-48 complement',
  'recovery_routes':[{'name':n,'conditions':c} for n,c in ROUTES]+[{'name':'REC_S7_RANGE_TOP_TIME12','conditions':['SIDE_SHORT','RANGE_TOP25','not already assigned'],'exit':'12h time exit'}],
  'raw_recovery_legacy_exit':len(ASSIGN),'raw_recovery_alt_exit':len(ALT),
  'cases':CASE_CAPS,'costs_bps':[10,20,30],
  'selection_guard':'First seven routes each had positive incremental PF at 10/20bps; alt route selected only from their remainder and robust in both temporal halves.',
  'warning':'Studied development period; independent validation required before LIVE.'
 },indent=2),encoding='utf-8')
 s.w.OUT=OUT;s.w.setup();FAILED=failed_candidates();s.w.base.read_table=read_table;s.w.base._study_filter=filt
 res=[]
 for name in CASE_CAPS:
  print('START',name,flush=True)
  r=s.w.base.run_study(name,'10,20,30');r['research_only']=True;r['caps']=CASE_CAPS[name]
  for sc in r['scenarios']:
   ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');v=[x for x in ts if x['strategy_id']=='V12']
   sc['v12_details']={'all':detail(v),'first':detail([x for x in v if x['exit_ts_ms']<MID]),'second':detail([x for x in v if x['entry_ts_ms']>=MID]),'routes':{rt:detail([x for x in v if x.get('route')==rt]) for rt in sorted({x.get('route') for x in v if x.get('route')})}}
  (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8');res.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(res,indent=2),encoding='utf-8')
  print('DONE',name,flush=True)
if __name__=='__main__':main()
