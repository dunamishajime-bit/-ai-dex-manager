"""Research-only V12 V2 with three concurrent positions per recovery route.
All shared/family caps and core-preemption protections unchanged.
"""
import contextlib,io,json
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_multilogic_v2 as v2
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_recovery as ml
s=v2.s;ROOT=s.ROOT;OUT=ROOT/'docs/research/results/v12-multilogic-v2-threeslot-20261008';MID=s.MID
def three_slot_patch(source,strict):
 q=ind.independent_patch(source,strict);old='if active_same_route:';assert q.count(old)==1;return q.replace(old,'if len(active_same_route) >= 3:',1)
def detail(a):
 d=s.w.stats(a);d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/3600000 for t in a);return d
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({'research_only':True,'live_changes':False,'production_changes':False,'change':'3 concurrent positions per recovery route','unchanged':['recovery family cap 0.50x','per-trade gross 0.10x','same-symbol exclusivity','core preemption','crypto 3.0x','V12 2.0x','total 4.25x'],'costs_bps':[10,20,30]},indent=2),encoding='utf-8')
 s.w.OUT=OUT;s.w.setup();v2.FAILED=ml.failed_candidates();v2.CASE['V2_3SLOT_G010']={'family_cap':.50,'gross':.10}
 s.w.base.read_table=v2.read_table;s.w.base._study_filter=v2.filt;ind.ORIG_PATCH=s.w.base.patch_admission;ind.ACTIVE_RECOVERY_CAP=.50;s.w.base.patch_admission=three_slot_patch;s.w.base.source_batch=ind.custom_source_batch
 name='V2_3SLOT_G010';print('START',name,flush=True);r=s.w.base.run_study(name,'10,20,30');r['research_only']=True;r['max_recovery_route_slots']=3
 for sc in r['scenarios']:
  ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');vv=[x for x in ts if x['strategy_id']=='V12'];sc['v12_details']={'all':detail(vv),'first':detail([x for x in vv if x['exit_ts_ms']<MID]),'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}}
 (OUT/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8');print('DONE',name,flush=True)
if __name__=='__main__':main()
