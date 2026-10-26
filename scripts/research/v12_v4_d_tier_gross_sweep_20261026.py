#!/usr/bin/env python
"""Research-only eight-sleeve D-tier Gross sensitivity, frozen same-wallet H1 model.
No LIVE, no venue writes, no dynamic reallocation.
"""
from __future__ import annotations
import argparse, sys, contextlib, io, json, time, hashlib, collections, os
from pathlib import Path
SRC=Path(os.environ.get("V12_V4_RESEARCH_SOURCE_ROOT",r"C:\Users\dis\DisDex-five-improvements-20261008"))
sys.path.insert(0,str(SRC/"scripts/research"))
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_priority_gross_v2_sweep as sweep
 import run_v12_multilogic_v4_final1000 as final
 import run_v12_multilogic_v4_stacking as v4
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_v4_minlift as mlift
 import run_v12_multilogic_recovery as ml
s=sweep.s
ROOT=Path(os.environ.get("V12_V4_D_GROSS_OUTPUT_ROOT",r"C:\tmp\v4-d-gross-20261026"))
ROOT.mkdir(parents=True,exist_ok=True)
RANKS=json.loads((Path(os.environ.get("V12_V4_GROSS_POLICY_REPO",str(Path.home()/"render-live-prep-20261025")))/"docs/implementation/v12-v4-v2-full-year-priority.json").read_text("utf8"))
D_ROUTES={r["route"] for r in RANKS if r["tier"]=="D"}
C_ROUTES={r["route"] for r in RANKS if r["tier"]=="C" and r["route"]!="FAILED_BREAK_REV_SHORT_6H"}
assert len(D_ROUTES)==7 and len(C_ROUTES)==9
CAP=sweep.CAP
CASE=sweep.CASES["V2_M150_D05_CORE_NATIVE"]
BASE_FILTER=sweep.make_filter("V2_M150_D05_CORE_NATIVE",CASE)
COUNTS=collections.Counter()
def make_filter(overrides):
 def wrapped(candidates,name):
  out=BASE_FILTER(candidates,name)
  for x in out:
   if x.get("strategy_id")!="V12":continue
   r=x.get("route")
   if r in C_ROUTES:
    assert abs(float(x["requested_gross"])-.18)<1e-10,(r,x["requested_gross"])
    x["requested_gross"]=.25
    COUNTS["c_routes_adopted_gross025"]+=1
   elif r in D_ROUTES:
    assert abs(float(x["requested_gross"])-.05)<1e-10,(r,x["requested_gross"])
    COUNTS["d_candidates_"+r]+=1
    if r in overrides:
     x["requested_gross"]=overrides[r]
     COUNTS["d_modified_"+r]+=1
  return out
 return wrapped
def plan():
 seq=[("BASE_C025",{})]
 for gross in [.10,.15,.20,.25]:
  for route in sorted(D_ROUTES):
   code={"REC_G3_LATE_BTC_REL":"G3","CONT_SHORT_MID_AGE24_48":"CONT",
   "REC_X13_TP1.5_SL1_H24":"X13","REC_X07_TIME_6H":"X07","REC_Y18_REV_D2_T18":"Y18",
   "REC_Y15_REV_D0_T3":"Y15","REC_X14_TIME_48H":"X14"}[route]
   seq.append(("D_"+code+"_"+str(gross).replace(".","P"),{route:gross}))
 # Portfolio combinations are completed after single-route economics are known.
 return seq
def rows(p):
 with p.open("r",encoding="utf8") as f:
  return [json.loads(l) for l in f if l.strip()]
def outcome(name,overrides,result,elapsed):
 out={"name":name,"overrides":overrides,"cGross":.25,"dOriginalGross":.05,
 "source":"frozen native8 V2_M150_D05_CORE_NATIVE 2025-08-10--2026-08-10",
 "status":"RESEARCH_ONLY_NOT_LIVE_L2_CERTIFIED","seconds":round(elapsed,2),"counters":dict(COUNTS),"cases":{}}
 for sc in result["scenarios"]:
  label="10bps" if sc["scenario_id"]=="PRICE_MODEL_10BPS" else "30bps"
  path=ROOT/"cases"/name/"runs"/sc["scenario_id"]
  records=rows(path/"portfolio-trades.jsonl")
  d=[x for x in records if x["strategy_id"]=="V12" and x["route"] in D_ROUTES]
  m={}
  for route in sorted(D_ROUTES):
   z=[x for x in d if x["route"]==route]
   if not z:continue
   gain=sum(max(0,x["total_pnl_jpy"]) for x in z)
   loss=-sum(min(0,x["total_pnl_jpy"]) for x in z)
   m[route]={"trades":len(z),"wins":sum(x["total_pnl_jpy"]>0 for x in z),
    "pf":gain/loss if loss else None,"netPnlJpy":round(gain-loss,3),
    "meanGross":sum(x["accepted_gross"] for x in z)/len(z)}
  v12=[x for x in records if x["strategy_id"]=="V12"]
  out["cases"][label]={
   "finalEquityJpy":sc["final_equity_jpy"],"maximumDrawdownPct":sc["maximum_mtm_drawdown"]*100,
   "winRate":sc["win_rate"],"profitFactor":sc["profit_factor"],
   "closedTrades":sc["closed_trades"],"V12Trades":len(v12),
   "modelReconciliation":sc["accounting_reconciliation"]["status"],
   "sleeveTradeCounts":dict(collections.Counter(x["strategy_id"] for x in records)),
   "dRoute":m,
   "tradeLedgerSHA256":hashlib.sha256((path/"portfolio-trades.jsonl").read_bytes()).hexdigest()}
  assert out["cases"][label]["modelReconciliation"]=="PASS"
 (ROOT/(name+".json")).write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 return out
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--start",type=int,default=0)
 ap.add_argument("--stop",type=int,default=29)
 a=ap.parse_args()
 cases=plan()
 assert 0<=a.start<a.stop<=len(cases)
 print("PLAN",len(cases),"SELECTED",a.start,a.stop,flush=True)
 s.w.OUT=ROOT;s.w.setup();v4.install_virtual_leg_study_adapter();final.install_final_routes()
 v3.stage3_transform=final.stage3_candidate_all
 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
 s.w.base.source_batch=ind.custom_source_batch;s.w.base.read_table=v3.v2.read_table
 original=s.w.base.patch_admission
 for ix in range(a.start,a.stop):
  name,overrides=cases[ix]
  v3.CASE[name]={"family_cap":CAP["family"],"gross":.10,"slots":16}
  ind.ACTIVE_RECOVERY_CAP=CAP["family"]
  mlift.MAX_LIFT_GROSS=.30
  ind.ORIG_PATCH=original;s.w.base.patch_admission=sweep.patch
  COUNTS.clear()
  s.w.base._study_filter=make_filter(overrides)
  start=time.monotonic()
  print("CASE_START",ix,name,flush=True)
  r=s.w.base.run_study(name,"10,30")
  o=outcome(name,overrides,r,time.monotonic()-start)
  print("CASE_DONE",ix,name,"ELAPSED",o["seconds"],"CAND",o["counters"].get("c_routes_adopted_gross025"),
   "ECON",[(k,round(v["finalEquityJpy"]),round(v["maximumDrawdownPct"],3),v["closedTrades"]) for k,v in o["cases"].items()],flush=True)
 print("FINISHED",a.start,a.stop,flush=True)
if __name__=="__main__":main()
