"""Research-only V12 V4: same-direction virtual-leg stacking.

Extends V3 by allowing multiple V12 recovery legs on the same symbol only when all
active V12 legs for that symbol have the same side as the new candidate.
Opposite-direction overlap remains rejected. Shared risk caps remain unchanged.
No LIVE/Production changes.
"""
import contextlib,io,json
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_recovery as ml

s=v3.s
ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-v4-stacking-20261009'
MID=s.MID

def stacking_patch(source,strict):
 q=ind.independent_patch(source,strict)
 # Independent patch has this explicit same-symbol rejection.
 old='''                    if any(p["symbol"] == candidate["symbol"] for p in active_same_strategy):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SAME_SYMBOL_ACTIVE", ts)
                        rejected["V12:SAME_SYMBOL_ACTIVE"] += 1
                        continue
'''
 new='''                    same_symbol_active=[p for p in active_same_strategy if p["symbol"] == candidate["symbol"]]
                    if any(str(p.get("side")) != str(candidate.get("side")) for p in same_symbol_active):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:OPPOSITE_SYMBOL_ACTIVE", ts)
                        rejected["V12:OPPOSITE_SYMBOL_ACTIVE"] += 1
                        continue
'''
 assert q.count(old)==1, q.count(old)
 q=q.replace(old,new,1)
 # Route-local slot sensitivity: allow up to 8 concurrent virtual legs per recovery route.
 old2='if active_same_route:'
 assert q.count(old2)==1
 q=q.replace(old2,'if len(active_same_route) >= 8:',1)
 return q

def detail(a):
 d=s.w.stats(a)
 d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/3600000 for t in a)
 return d

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({
  'research_only':True,'live_changes':False,'production_changes':False,
  'base':'V3 1051-candidate architecture',
  'change':'allow same-symbol same-direction V12 virtual legs; opposite side still rejected',
  'max_recovery_route_virtual_legs':8,
  'recovery_family_gross_cap':0.75,
  'V12_total_gross_cap':2.0,
  'crypto_gross_cap':3.0,
  'total_gross_cap':4.25,
  'same_symbol_opposite_direction':'REJECT',
  'costs_bps':[10]
 },indent=2),encoding='utf-8')
 s.w.OUT=OUT;s.w.setup()
 # Research audit override: same-symbol, same-side V12 legs are treated as virtual
 # sub-ledgers of one venue net position. Opposite-side and cross-strategy overlaps
 # remain ownership conflicts. Patch the exact audit module imported by the adapter.
 import sys,importlib
 engine_path=str(s.w.base.SUPPORT/'engine')
 if engine_path not in sys.path: sys.path.insert(0,engine_path)
 _audit=importlib.import_module('scripts.research.formal_core_ownership_audit')
 _orig_conflicts=_audit.find_ownership_conflicts
 def _virtual_leg_conflicts(trades):
  conflicts=_orig_conflicts(trades)
  kept=[]
  for c in conflicts:
   a=c.get('earlier_owner',{});b=c.get('later_owner',{})
   allowed=(a.get('strategy_id')=='V12' and b.get('strategy_id')=='V12' and a.get('side')==b.get('side'))
   if not allowed: kept.append(c)
  return kept
 _audit.find_ownership_conflicts=_virtual_leg_conflicts
 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
 # Use stronger V3 sizing case.
 v3.CASE['V4_STACK_G0075_RCAP075']={'family_cap':.75,'gross':.075,'slots':8}
 s.w.base.read_table=v3.v2.read_table
 s.w.base._study_filter=v3.filt
 ind.ORIG_PATCH=s.w.base.patch_admission
 ind.ACTIVE_RECOVERY_CAP=.75
 s.w.base.patch_admission=stacking_patch
 s.w.base.source_batch=ind.custom_source_batch
 name='V4_STACK_G0075_RCAP075'
 print('START',name,flush=True)
 r=s.w.base.run_study(name,'10');r['research_only']=True
 for sc in r['scenarios']:
  ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
  vv=[x for x in ts if x['strategy_id']=='V12']
  sc['v12_details']={'all':detail(vv),'first':detail([x for x in vv if x['exit_ts_ms']<MID]),'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}}
 (OUT/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
 print('DONE',name,flush=True)

if __name__=='__main__':main()
