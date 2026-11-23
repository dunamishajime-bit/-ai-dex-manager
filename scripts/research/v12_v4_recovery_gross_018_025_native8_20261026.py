#!/usr/bin/env python3
"""Research-only: exact 8-sleeve V12 V4 gross sweep using frozen 2026-10-08 engine.

Compare recovered .18x route entries to .20/.25/.30 with no changes to peers,
route eligibility, exit timing, ownership gates or wallet gross caps.
"""
import sys,contextlib,io,json,time,hashlib,argparse,collections,os
from pathlib import Path
SOURCE=Path(os.environ.get("V12_V4_RESEARCH_SOURCE_ROOT",r"C:\Users\dis\DisDex-five-improvements-20261008"))
sys.path.insert(0,str(SOURCE/"scripts/research"))
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_priority_gross_v2_sweep as sweep
 import run_v12_multilogic_v4_final1000 as final
 import run_v12_multilogic_v4_stacking as v4
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_v4_minlift as mlift
 import run_v12_multilogic_recovery as ml
s=sweep.s
root=Path(os.environ.get("V12_V4_GROSS_OUTPUT_ROOT",r"C:\tmp\v4-gross-025-integrated-20261026"))
CASE=sweep.CASES["V2_M150_D05_CORE_NATIVE"]
CAP=sweep.CAP
stats=[]
counts=collections.Counter()
BASE_FILTER=sweep.make_filter("V2_M150_D05_CORE_NATIVE",CASE)
def make_filter(case_target):
 def wrapped(candidates,case):
  out=BASE_FILTER(candidates,case)
  for row in out:
   if row.get("strategy_id")!="V12":continue
   if row.get("family") not in ("RECOVERY_X","RECOVERY_G","RECOVERY_Y_REVERSAL","RECOVERY_Z"):
    if not str(row.get("route","")).startswith("REC_"):continue
   before=float(row.get("requested_gross",0))
   if abs(before-.18)<1e-8:
    counts["eligible_018"]+=1
    if case_target>0.18:
     row["requested_gross"]=case_target
     counts["changed_to_"+str(case_target)]+=1
  return out
 return wrapped
def manifest():
 path=SOURCE/"scripts/research/run_v12_v4_priority_gross_v2_sweep.py"
 return {"source_sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"source":str(path),
  "date":"2026-10-26","data":"frozen integrated Native8 2025-08-10 through 2026-08-10",
  "status":"RESEARCH_ONLY_NOT_LIVE_NOT_PRODUCTION_L2_PARITY",
  "case":"V2_M150_D05_CORE_NATIVE","caps":CAP,
  "change":"Only V12 recovery rows with original requested_gross=.18 modified to 0.20,0.25,0.30. Keep other route, ordering, strategy, DD/margin gates unchanged."}
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--cases",default="0.18,0.20,0.25,0.30")
 a=ap.parse_args()
 targets=[round(float(x),3) for x in a.cases.split(",")]
 assert all(t in (.18,.20,.225,.25,.275,.30) for t in targets)
 print("SETUP_BEGIN",flush=True)
 s.w.OUT=root;s.w.setup()
 v4.install_virtual_leg_study_adapter()
 final.install_final_routes();v3.stage3_transform=final.stage3_candidate_all
 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
 s.w.base.source_batch=ind.custom_source_batch;s.w.base.read_table=v3.v2.read_table
 basepatch=s.w.base.patch_admission
 print("SETUP_END",flush=True)
 for target in targets:
  cfg_name="GROSS_018_TO_"+str(target).replace(".","P")
  v3.CASE[cfg_name]={"family_cap":CAP["family"],"gross":.10,"slots":16}
  ind.ACTIVE_RECOVERY_CAP=CAP["family"]
  mlift.MAX_LIFT_GROSS=.30
  ind.ORIG_PATCH=basepatch
  s.w.base.patch_admission=sweep.patch
  counts.clear();s.w.base._study_filter=make_filter(target)
  print("DBG_FILTER",type(s.w.base._study_filter).__name__,type(s.w.base.run_study.__globals__.get("_study_filter")).__name__, "SAME_DICT",s.w.base.run_study.__globals__ is s.w.base.__dict__,flush=True)
  t=time.monotonic()
  print("CASE_START",cfg_name,flush=True)
  result=s.w.base.run_study(cfg_name,"10,30")
  cases=[]
  for scenario in result["scenarios"]:
   metric={k:scenario.get(k) for k in ["scenario_id","final_equity_jpy","maximum_mtm_drawdown","profit_factor","win_rate","closed_trades","accounting_reconciliation","strategy_trades","candidate_decision_counts"]}
   metric["scenario_id"]=str(scenario.get("scenario_id"))
   detail_path=root/"cases"/cfg_name/"runs"/metric["scenario_id"]/"portfolio-trades.jsonl"
   rows=s.rows(detail_path)
   v12=[x for x in rows if x.get("strategy_id")=="V12"]
   metric["V12_all"]=sweep.detail(v12)
   metric["V12_recovery_eligible_gross"]=sweep.detail([x for x in v12 if str(x.get("route","")).startswith("REC_")])
   metric["V12_gross_utilization"]=sweep.util(v12)
   metric["per_strategy_trade_count"]={strategy:sum(x.get("strategy_id")==strategy for x in rows) for strategy in sorted({x.get("strategy_id") for x in rows})}
   cases.append(metric)
  summary={"cfg_name":cfg_name,"targetGross":target,"counts":dict(counts),"cases":cases,
    "seconds":round(time.monotonic()-t,1),"source":manifest()}
  (root/(cfg_name+"-summary.json")).write_text(json.dumps(summary,ensure_ascii=False,indent=2,default=str)+"\n",encoding="utf-8")
  stats.append(summary)
  print("CASE_DONE",cfg_name,"SECONDS",summary["seconds"],"COUNTS",dict(counts),flush=True)
  for m in cases:
   print("RESULT",cfg_name,m["scenario_id"],"EQUITY",m["final_equity_jpy"],"DD",m["maximum_mtm_drawdown"],"PF",m["profit_factor"],"WR",m["win_rate"],"N",m["closed_trades"],"V12_TRADE_N",m["per_strategy_trade_count"].get("V12",0),flush=True)
  (root/"all-cases-summary.json").write_text(json.dumps(stats,ensure_ascii=False,indent=2,default=str)+"\n",encoding="utf-8")
 print("ALL_FINISHED",len(stats),flush=True)
if __name__=="__main__":main()
