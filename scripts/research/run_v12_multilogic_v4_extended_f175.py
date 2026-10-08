"""Research-only V12 V4: extended Stage3 routes on the frozen F1.75 stack+flip architecture.

Keeps the already validated F1.75 sizing/caps and adds only the additional Stage3 routes
whose incremental uncovered subsets remained profitable in the extended search.
Excludes Stage3 extended routes 20 and 22 because their second-half evidence was weak.

No LIVE/Production changes.
"""
import contextlib,io,json,re,sys
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_multilogic_v3_targetsize_f175_stress as base
 import run_v12_multilogic_v3 as v3

ROOT=base.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-v4-extended-f175-20261009'
NAME='V4_EXTENDED_F175_STRESS'
H=3600000

rows=json.load(open(ROOT/'docs/research/results/v12-recovery-stage3-extended-20261009/selected-stage3-extended-routes.json',encoding='utf-8'))
# Keep original 1..19 plus route 21; exclude 20 and 22 due weak second-half evidence.
keep=[r for i,r in enumerate(rows,1) if i<=19 or i==21]
META={}
ASSIGN={}
for i,r in enumerate(keep,1):
 route=f'REC_Y{i:02d}_{r["exit"]}'
 META[route]=r
 for k in r['inc_keys']:
  ASSIGN[(k[0],k[1],int(k[2]))]=route

def generalized_stage3_candidate(c,route,gross):
 spec=META[route]['exit']
 m=re.fullmatch(r'(ORIG|REV)_D(\d+)_(T(\d+)|TP([\d.]+)_SL([\d.]+)_H(\d+))',spec)
 if not m: raise ValueError('UNSUPPORTED_EXTENDED_STAGE3_EXIT:'+spec)
 mode=m.group(1);delay=int(m.group(2))
 x=dict(c)
 orig_side=x['side']
 new_side=orig_side if mode=='ORIG' else ('SHORT' if orig_side=='LONG' else 'LONG')
 orig_entry=int(x['entry_ts_ms'])
 entry_ts=orig_entry+delay*H
 eb=v3.s.w.bars.get(x['symbol'],{}).get(entry_ts)
 if eb is None:return None
 entry_price=float(eb['open'])
 sg=1 if new_side=='LONG' else -1
 if m.group(4) is not None:
  hold=int(m.group(4));exit_ts=orig_entry+(delay+hold)*H
  xb=v3.s.w.bars.get(x['symbol'],{}).get(exit_ts)
  if xb is None:return None
  exit_price=float(xb['open']);reason=spec
 else:
  tp=float(m.group(5));sl=float(m.group(6));hold=int(m.group(7))
  aa=v3.v2.atr_at(x['symbol'],entry_ts)
  if aa is None:return None
  tp_px=entry_price+sg*tp*aa;sl_px=entry_price-sg*sl*aa
  exit_ts=None;exit_price=None;reason=None
  for h in range(hold):
   t=entry_ts+h*H
   b=v3.s.w.bars.get(x['symbol'],{}).get(t)
   if b is None:return None
   hi=float(b['high']);lo=float(b['low']);op=float(b['open'])
   hit_sl=(lo<=sl_px if sg==1 else hi>=sl_px)
   hit_tp=(hi>=tp_px if sg==1 else lo<=tp_px)
   if hit_sl:
    exit_price=min(sl_px,op) if sg==1 else max(sl_px,op)
    exit_ts=t+H;reason=spec+'_STOP';break
   if hit_tp:
    exit_price=tp_px;exit_ts=t+H;reason=spec+'_TP';break
  if exit_ts is None:
   exit_ts=entry_ts+hold*H
   xb=v3.s.w.bars.get(x['symbol'],{}).get(exit_ts)
   if xb is None:return None
   exit_price=float(xb['open']);reason=spec+'_TIME'
 x.update(
  side=new_side,
  entry_ts_ms=entry_ts,
  entry_price=entry_price,
  exit_ts_ms=exit_ts,
  exit_price=exit_price,
  exit_reason=reason,
  unit_price_return=sg*(exit_price/entry_price-1),
  route=route,
  entryQualityClass='MULTILOGIC_V4_EXTENDED',
  rank=9,
  source_v12_side=orig_side,
  source_v12_entry_ts_ms=orig_entry,
 )
 x['requested_gross']=min(float(x.get('requested_gross',gross)),gross)
 return x

# Replace only Stage3 membership/execution. V2/core/complement logic is unchanged.
v3.STAGE3_META=META
v3.STAGE3_ASSIGN=ASSIGN
v3.stage3_transform=generalized_stage3_candidate

# Reuse the frozen F1.75 stack+flip/target-sizing configuration.
base.OUT=OUT
base.NAME=NAME

if __name__=='__main__':
 OUT.mkdir(parents=True,exist_ok=True)
 # Let the frozen runner write its normal protocol/results, then add exact V4 route selection metadata.
 base.main()
 protocol=json.load(open(OUT/'protocol.json',encoding='utf-8'))
 protocol.update({
  'v4_extended_stage3':True,
  'extended_stage3_route_count':len(keep),
  'extended_stage3_unique_keys':len(ASSIGN),
  'excluded_extended_stage3_original_indices':[20,22],
  'extended_selection_reason':'only additional routes with acceptable second-half evidence retained; original F1.75 caps/sizing otherwise frozen',
  'live_changes':False,'production_changes':False,
 })
 (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
