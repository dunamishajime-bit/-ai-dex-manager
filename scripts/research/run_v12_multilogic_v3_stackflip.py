"""Research-only V12 V3 same-side stacking + recovery signal-flip.

Rules:
- same-symbol same-side V12 recovery lots may coexist virtually;
- if a new V12 recovery signal is opposite to active V12 recovery lots on the same symbol,
  close only those recovery lots at the current mark, then admit the new signal;
- core positions and other strategies are never flipped by recovery;
- shared portfolio caps stay unchanged;
- no LIVE/Production changes.
"""
import contextlib,io,json,sys
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_recovery as ml
s=v3.s;ROOT=s.ROOT;OUT=ROOT/'docs/research/results/v12-multilogic-v3-stackflip-20261009';MID=s.MID
CASES={
 'V3_STACKFLIP_F125_G0075':{'family_cap':1.25,'gross':.075,'slots':16},
 'V3_STACKFLIP_F150_G0075':{'family_cap':1.50,'gross':.075,'slots':16},
}

REC_EXPR='(str(candidate.get("route") or "").startswith("REC_") or str(candidate.get("route") or "")=="CONT_SHORT_MID_AGE24_48")'
POS_REC='(str(p.get("route") or "").startswith("REC_") or str(p.get("route") or "")=="CONT_SHORT_MID_AGE24_48")'

def patch_factory(limit):
 def patch(source,strict):
  q=ind.independent_patch(source,strict)
  # Same-side virtual stacking; opposite side remains prohibited unless recovery flip below closes it first.
  old='if any(p["symbol"] == candidate["symbol"] for p in active_same_strategy):'
  new='if any(p["symbol"] == candidate["symbol"] and p["side"] != candidate["side"] for p in active_same_strategy):'
  assert q.count(old)==1
  q=q.replace(old,new,1)
  old2='if active_same_route:'
  assert q.count(old2)==1
  q=q.replace(old2,f'if len(active_same_route) >= {int(limit)}:',1)

  marker=f'''                candidate_is_recovery = strategy=="V12" and {REC_EXPR}
                if strategy in {{"V12","PENGU","Q102","FET","V52"}} and not candidate_is_recovery:
'''
  assert q.count(marker)==1
  replacement=f'''                candidate_is_recovery = strategy=="V12" and {REC_EXPR}
                if candidate_is_recovery:
                    opposite_recovery_same_symbol=[(vp,p) for vp,p in list(active.items())
                        if p["strategy_id"]=="V12"
                        and {POS_REC}
                        and p["symbol"]==candidate["symbol"]
                        and p["side"]!=candidate["side"]]
                    for vp,p in opposite_recovery_same_symbol:
                        mark=_mark(market,p["symbol"],ts)
                        if mark is None: raise ValueError(f"RECOVERY_FLIP_MARK_MISSING:{{p['symbol']}}:{{ts}}")
                        finalize_position(vp,ts,mark,f"RECOVERY_SIGNAL_FLIP:{{candidate.get('route')}}")
                if strategy in {{"V12","PENGU","Q102","FET","V52"}} and not candidate_is_recovery:
'''
  q=q.replace(marker,replacement,1)
  return q
 return patch

def filt(candidates,name):
 cfg=CASES[name];v3.CASE[name]=cfg
 return v3.filt(candidates,name)

def detail(a):
 d=s.w.stats(a);d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/3600000 for t in a);return d

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({
  'research_only':True,'live_changes':False,'production_changes':False,
  'execution_model':'same-side virtual stacking + recovery-to-recovery signal flip',
  'core_flip':False,'other_strategy_flip':False,
  'shared_caps_unchanged':{'V12':2.0,'crypto':3.0,'total':4.25},
  'cases':CASES,'cost_bps':[10],
  'warning':'Development-period research only.'
 },indent=2),encoding='utf-8')
 s.w.OUT=OUT;s.w.setup()
 # Audit allows only same-side V12 virtual-lot overlap. Opposite-side overlap must remain zero.
 support=ROOT/'docs/research/results/gate-fixes-bt-20261008/support/engine'
 if str(support) not in sys.path:sys.path.insert(0,str(support))
 from scripts.research import formal_core_ownership_audit as audit
 orig_conf=audit.find_ownership_conflicts
 def virtual_conflicts(trades):
  cs=orig_conf(trades)
  return [c for c in cs if not (
   not c['opposite_sides'] and not c['cross_strategy']
   and c['earlier_owner'].get('strategy_id')=='V12'
   and c['later_owner'].get('strategy_id')=='V12')]
 audit.find_ownership_conflicts=virtual_conflicts

 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
 s.w.base.read_table=v3.v2.read_table;s.w.base._study_filter=filt
 original=s.w.base.patch_admission;res=[]
 for name,cfg in CASES.items():
  ind.ORIG_PATCH=original;ind.ACTIVE_RECOVERY_CAP=cfg['family_cap']
  s.w.base.patch_admission=patch_factory(cfg['slots']);s.w.base.source_batch=ind.custom_source_batch
  print('START',name,flush=True)
  r=s.w.base.run_study(name,'10');r['research_only']=True;r['case_config']=cfg
  for sc in r['scenarios']:
   ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');vv=[x for x in ts if x['strategy_id']=='V12']
   sc['v12_details']={'all':detail(vv),'first':detail([x for x in vv if x['exit_ts_ms']<MID]),'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}}
  (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8');res.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(res,indent=2),encoding='utf-8')
  print('DONE',name,flush=True)
if __name__=='__main__':main()
