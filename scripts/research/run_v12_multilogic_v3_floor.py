"""Research-only V12 V3 stack+flip+venue-minimum-floor.

Extends the stackflip model by rounding a recovery order UP only when needed to satisfy
the observed venue minQty / $5 minNotional. After rounding, the engine must still have
Gross room; no cap bypass is allowed.

No LIVE/Production changes.
"""
import contextlib,io,json,sys,math
from pathlib import Path
from decimal import Decimal
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_multilogic_v3_stackflip as sf
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_recovery as ml
s=v3.s;ROOT=s.ROOT;OUT=ROOT/'docs/research/results/v12-multilogic-v3-floor-20261009';MID=s.MID
NAME='V3_STACKFLIP_FLOOR_F125_G0075'
CFG={'family_cap':1.25,'gross':.075,'slots':16}

def floor_patch(source,strict):
 q=sf.patch_factory(CFG['slots'])(source,strict)
 # Venue wrapper has already recalculated accepted_gross after normalization.
 hook='                accepted_gross=notional/equity\n'
 assert q.count(hook)==1
 extra=hook+'''                if accepted_gross > room + 1e-12:
                    reason=f"{strategy}:VENUE_MIN_FLOOR_NO_GROSS_ROOM"
                    record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts);rejected[reason]+=1;continue
'''
 return q.replace(hook,extra,1)

def filt(candidates,name):
 v3.CASE[name]=CFG
 return v3.filt(candidates,name)

def detail(a):
 d=s.w.stats(a);d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/3600000 for t in a);return d

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({
  'research_only':True,'live_changes':False,'production_changes':False,
  'base':'V3 stackflip',
  'venue_floor':'ceil to observed MARKET_LOT_SIZE/LOT_SIZE step so quantity>=minQty and notional>=max($5, MIN_NOTIONAL)',
  'post_floor_guard':'accepted_gross must remain <= current room',
  'shared_caps_unchanged':{'V12':2.0,'crypto':3.0,'total':4.25,'recovery_family':1.25},
  'costs_bps':[10]
 },indent=2),encoding='utf-8')
 s.w.OUT=OUT;s.w.setup()

 support=ROOT/'docs/research/results/gate-fixes-bt-20261008/support'
 if str(support) not in sys.path:sys.path.insert(0,str(support))
 import venue_constraints
 rows=venue_constraints.FILTER_ROWS
 def floor_normalize(symbol,requested,price):
  row=rows.get(symbol)
  if not row:return 0.,'VENUE_FILTER_MISSING'
  filters={f['filterType']:f for f in row.get('filters',[])}
  lot=filters.get('MARKET_LOT_SIZE') or filters.get('LOT_SIZE')
  if not lot:return 0.,'VENUE_QUANTITY_FILTER_MISSING'
  step=float(lot['stepSize']);minimum=float(lot['minQty']);maximum=float(lot['maxQty'])
  min_notional=max(5.,float(filters.get('MIN_NOTIONAL',{}).get('notional',0)))
  required=max(float(requested),minimum,min_notional/float(price))
  scale=10**min(12,max(0,-Decimal(str(step)).as_tuple().exponent))
  integer_step=max(1,math.floor(step*scale+.5))
  integer_required=math.ceil(required*scale-1e-9)
  quantity=math.ceil(integer_required/integer_step)*integer_step/scale
  if quantity>maximum+1e-12:return 0.,'VENUE_MAX_QTY'
  return quantity,None
 venue_constraints.normalize_quantity=floor_normalize

 # Research audit: permit only same-side V12 virtual-lot overlap.
 engine=ROOT/'docs/research/results/gate-fixes-bt-20261008/support/engine'
 if str(engine) not in sys.path:sys.path.insert(0,str(engine))
 from scripts.research import formal_core_ownership_audit as audit
 orig_conf=audit.find_ownership_conflicts
 def virtual_conflicts(trades):
  return [c for c in orig_conf(trades) if not (
   not c['opposite_sides'] and not c['cross_strategy']
   and c['earlier_owner'].get('strategy_id')=='V12'
   and c['later_owner'].get('strategy_id')=='V12')]
 audit.find_ownership_conflicts=virtual_conflicts

 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
 s.w.base.read_table=v3.v2.read_table;s.w.base._study_filter=filt
 ind.ORIG_PATCH=s.w.base.patch_admission;ind.ACTIVE_RECOVERY_CAP=CFG['family_cap']
 s.w.base.patch_admission=floor_patch;s.w.base.source_batch=ind.custom_source_batch
 print('START',NAME,flush=True)
 r=s.w.base.run_study(NAME,'10');r['research_only']=True;r['case_config']=CFG
 for sc in r['scenarios']:
  ts=s.rows(OUT/'cases'/NAME/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');vv=[x for x in ts if x['strategy_id']=='V12']
  sc['v12_details']={'all':detail(vv),'first':detail([x for x in vv if x['exit_ts_ms']<MID]),'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}}
 (OUT/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
 print('DONE',NAME,flush=True)
if __name__=='__main__':main()
