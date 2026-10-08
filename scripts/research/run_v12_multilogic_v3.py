"""Research-only V12 V3: extend V2 with stage-3 reversal/recovery routes.
Target: approach the original >1,000 V12 opportunities while preserving profitability.
No LIVE/Production changes.
"""
import contextlib,io,json,re
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_multilogic_v2 as v2
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_recovery as ml
s=v2.s
ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-v3-20261008'
STAGE3=ROOT/'docs/research/results/v12-recovery-stage3-search-20261008/selected-stage3-routes.json'
H=3600000
MID=s.MID
raw3=json.load(open(STAGE3,encoding='utf-8'))
STAGE3_ASSIGN={}
STAGE3_META={}
for i,r in enumerate(raw3,1):
 name=f'REC_Y{i:02d}_{r["exit"]}'
 STAGE3_META[name]=r
 for k in r['inc_keys']:
  STAGE3_ASSIGN[(k[0],k[1],int(k[2]))]=name
print('STAGE3_RAW',len(STAGE3_ASSIGN),flush=True)

CASE={
 'V3_4SLOT_G005_RCAP050':{'family_cap':.50,'gross':.05,'slots':4},
 'V3_4SLOT_G0075_RCAP075':{'family_cap':.75,'gross':.075,'slots':4},
}
FAILED=None

def flip(side): return 'SHORT' if side=='LONG' else 'LONG'

def stage3_transform(c,route,gross):
 exit_name=STAGE3_META[route]['exit']
 m=re.fullmatch(r'(ORIG|REV)_D(\d+)_T(\d+)',exit_name)
 if not m: raise ValueError('unsupported stage3 exit '+exit_name)
 mode,delay_s,hold_s=m.groups();delay=int(delay_s);hold=int(hold_s)
 d=dict(c)
 entry_ts=int(c['entry_ts_ms'])+delay*H
 eb=s.w.bars.get(c['symbol'],{}).get(entry_ts)
 if delay==0:
  entry_px=float(c['entry_price'])
 else:
  if eb is None:return None
  entry_px=float(eb['open'])
 side=c['side'] if mode=='ORIG' else flip(c['side'])
 exit_ts=entry_ts+hold*H
 xb=s.w.bars.get(c['symbol'],{}).get(exit_ts)
 if xb is None:return None
 exit_px=float(xb['open'])
 sg=1 if side=='LONG' else -1
 d.update(
  side=side,entry_ts_ms=entry_ts,entry_price=entry_px,
  exit_ts_ms=exit_ts,exit_price=exit_px,
  exit_reason=exit_name,unit_price_return=sg*(exit_px/entry_px-1),
  route=route,entryQualityClass='MULTILOGIC_V3_STAGE3',rank=9,
  requested_gross=min(float(d.get('requested_gross',gross)),gross),
 )
 return d

def filt(candidates,name):
 cfg=CASE[name]
 # Reuse V2 core/complement/stage1/stage2 construction.
 v2.CASE[name]={'family_cap':cfg['family_cap'],'gross':.10}
 out=v2.filt(candidates,name)
 seen={('V12',x['symbol'],x['side'],int(x['entry_ts_ms'])) for x in out if x.get('strategy_id')=='V12'}
 for c in candidates:
  if c['strategy_id']!='V12': continue
  k=(c['symbol'],c['side'],int(c['entry_ts_ms']))
  route=STAGE3_ASSIGN.get(k)
  if not route: continue
  d=stage3_transform(c,route,cfg['gross'])
  if d is None: continue
  tok=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
  if tok not in seen:
   seen.add(tok);out.append(d)
 return out

def slot_patch(source,strict):
 q=ind.independent_patch(source,strict)
 old='if active_same_route:'
 assert q.count(old)==1
 # All V3 cases use 4 route-local slots for count recovery.
 return q.replace(old,'if len(active_same_route) >= 4:',1)

def detail(a):
 d=s.w.stats(a);d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/H for t in a);return d

def main():
 global FAILED
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({
  'research_only':True,'live_changes':False,'production_changes':False,
  'candidate_target':1051,
  'stage3_routes':[{k:v for k,v in r.items() if k!='inc_keys'} for r in raw3],
  'stage3_raw_count':len(STAGE3_ASSIGN),
  'architecture':'V2 + 12 stage3 reversal/recovery sleeves; 4 slots per recovery route',
  'shared_guards':['same-symbol ownership exclusive','core preemption','V12 gross 2.0x','crypto gross 3.0x','total gross 4.25x'],
  'cases':CASE,'initial_cost_bps':[10],
  'warning':'Studied development period; no LIVE promotion.'
 },indent=2),encoding='utf-8')
 s.w.OUT=OUT;s.w.setup();FAILED=ml.failed_candidates();v2.FAILED=FAILED
 s.w.base.read_table=v2.read_table;s.w.base._study_filter=filt
 ind.ORIG_PATCH=s.w.base.patch_admission;s.w.base.patch_admission=slot_patch;s.w.base.source_batch=ind.custom_source_batch
 res=[]
 for name,cfg in CASE.items():
  ind.ACTIVE_RECOVERY_CAP=cfg['family_cap']
  print('START',name,flush=True)
  r=s.w.base.run_study(name,'10');r['research_only']=True;r['case_config']=cfg
  for sc in r['scenarios']:
   ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');vv=[x for x in ts if x['strategy_id']=='V12']
   sc['v12_details']={'all':detail(vv),'first':detail([x for x in vv if x['exit_ts_ms']<MID]),'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}}
  (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8');res.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(res,indent=2),encoding='utf-8')
  print('DONE',name,flush=True)

if __name__=='__main__':main()
