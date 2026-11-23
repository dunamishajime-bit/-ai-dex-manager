"""Full integrated 41-route V4 rerun with TIME-family resident emergency STOP.
Uses immutable 2026-10-08 original research engine. Research only; never trading.
"""
from __future__ import annotations
import argparse,contextlib,copy,hashlib,io,json,math,os,sys,time
from pathlib import Path
THIS=Path(__file__).resolve().parents[2]
SOURCE=Path(os.environ.get("V12_V4_RESEARCH_SOURCE_ROOT",r"C:\Users\dis\DisDex-five-improvements-20261008"))
sys.path.insert(0,str(SOURCE/"scripts/research"))
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_priority_gross_v2_sweep as sweep
 import run_v12_v4_route_repair_secondpass as r2
 import run_v12_multilogic_v4_final1000 as final
 import run_v12_multilogic_v4_flip as flip
 import run_v12_multilogic_v4_minlift as mlift
 import run_v12_multilogic_v4_stacking as v4
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_recovery as ml
s=sweep.s
BASE_ADMISSION_PATCH=s.w.base.patch_admission
H=3600000
CATALOG=THIS/"docs/research/results/v4-production-cert-20261009/exact-production-exit-catalog.json"
KIND={x["route"]:x["spec"]["kind"] for x in json.loads(CATALOG.read_text(encoding="utf-8"))}
ROOTOUT=THIS/"docs/research/results/v4-time-stop-integrated-20261010"
POLICIES={"none":None,"fixed_4pct":.04,"fixed_6pct":.06,"fixed_8pct":.08,
 "fixed_10pct":.10,"fixed_12pct":.12,
 "fixed_15pct":.15,"fixed_20pct":.20,
 "atr_4x":"atr4", "max_8pct_4atr":"max8atr4"}
CASE=sweep.CASES["V2_M150_D05_CORE_NATIVE"]
def bar_at(symbol,ts):return s.w.bars.get(symbol,{}).get(ts)
def atr14(symbol,entry):
 bs=[bar_at(symbol,entry-i*H) for i in range(15,0,-1)]
 if any(x is None for x in bs):return None
 r=[]
 for i in range(1,15):
  b=bs[i];prior=bs[i-1]["close"]
  r.append(max(b["high"]-b["low"],abs(b["high"]-prior),abs(b["low"]-prior)))
 return sum(r)/14
def distance(policy,entry,atr):
 p=POLICIES[policy]
 if p is None:return None
 if isinstance(p,float):return p*entry
 if p=="atr4":return 4*atr
 if p=="max8atr4":return max(entry*.08,4*atr)
 raise AssertionError(policy)
def patch_exits(base_filter,policy,observations):
 def wrapped(candidates,case):
  chosen=base_filter(candidates,case);out=[]
  for x in chosen:
   if x.get("strategy_id")!="V12" or KIND.get(x.get("route"))!="TIME":
    out.append(x);continue
   entry=float(x["entry_price"]);ts=int(x["entry_ts_ms"]);oldexit=int(x["exit_ts_ms"])
   atr=atr14(x["symbol"],ts);assert atr is not None,(x["symbol"],ts,"ATR_INCOMPLETE")
   dist=distance(policy,entry,atr)
   if dist is None:out.append(x);continue
   side=x["side"];sg=1 if side=="LONG" else -1;stop=entry-sg*dist
   if stop<=0:out.append(x);continue
   updated=None
   for start in range(ts,oldexit,H):
    bar=bar_at(x["symbol"],start)
    if bar is None:raise RuntimeError("H1_GAP_"+x["symbol"]+"_"+str(start))
    if (float(bar["low"])<=stop if sg==1 else float(bar["high"])>=stop):
     stopfill=(min(stop,float(bar["open"])) if sg==1 else max(stop,float(bar["open"])))
     updated=dict(x,exit_ts_ms=start+H,exit_price=stopfill,
      exit_reason="EMERGENCY_STOP_"+policy,unit_price_return=sg*(stopfill/entry-1))
     observations["changed"]+=1
     observations["route_changed"].setdefault(x["route"],0)
     observations["route_changed"][x["route"]]+=1
     break
   out.append(updated if updated else x)
  return out
 return wrapped
def run(policy,cost):
 assert policy in POLICIES
 assert cost in (10,20,30)
 OUT=ROOTOUT/policy/f"{cost}bps"
 OUT.mkdir(parents=True,exist_ok=True)
 s.w.OUT=OUT
 s.w.setup()
 v4.install_virtual_leg_study_adapter()
 final.install_final_routes()
 v3.stage3_transform=final.stage3_candidate_all
 v3.FAILED=ml.failed_candidates()
 v3.v2.FAILED=v3.FAILED
 s.w.base.source_batch=ind.custom_source_batch
 s.w.base.read_table=v3.v2.read_table
 ind.ORIG_PATCH=BASE_ADMISSION_PATCH
 s.w.base.patch_admission=sweep.patch
 v3.CASE["V2_M150_D05_CORE_NATIVE"]={"family_cap":2.5,"gross":.10,"slots":16}
 ind.ACTIVE_RECOVERY_CAP=2.5
 mlift.MAX_LIFT_GROSS=.30
 obs={"changed":0,"route_changed":{}}
 s.w.base._study_filter=patch_exits(sweep.make_filter("V2_M150_D05_CORE_NATIVE",CASE),policy,obs)
 start=time.monotonic()
 result=s.w.base.run_study("V2_M150_D05_CORE_NATIVE",str(cost))
 elapsed=time.monotonic()-start
 runs=OUT/"cases/V2_M150_D05_CORE_NATIVE/runs"
 selected=list(runs.glob("*/metrics.json"))
 assert len(selected)==1,selected
 metrics=json.loads(selected[0].read_text(encoding="utf-8"))
 report={"policy":policy,"cost_bps":cost,"elapsed_seconds":elapsed,
  "research_engine":str(SOURCE),"status":"INTEGRATED_PRICE_MODEL_ONLY",
  "modeled_emergency_candidate_exits":obs["changed"],
  "affected_routes":obs["route_changed"],
  "final_equity_jpy":metrics.get("final_equity_jpy"),
  "maximum_mtm_drawdown":metrics.get("maximum_mtm_drawdown"),
  "profit_factor":metrics.get("profit_factor"),
  "closed_trades":metrics.get("closed_trades"),
  "strategy_trades":metrics.get("strategy_trades"),
  "win_rate":metrics.get("win_rate"),
  "warning":"Model H1 intrabar stop with adverse-open gap, no real execution or stop fee/funding parity; venue stop may trigger before EOD candidate decisions."}
 (OUT/"integrated-report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
 print("CASE",policy,cost,json.dumps(report),flush=True)
 return report
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--policies",default="none,fixed_4pct,fixed_6pct,fixed_8pct,fixed_10pct,fixed_12pct,atr_4x,max_8pct_4atr")
 parser.add_argument("--costs",default="10")
 args=parser.parse_args()
 ROOTOUT.mkdir(parents=True,exist_ok=True)
 reports=[]
 for policy in args.policies.split(","):
  for cost in [int(x) for x in args.costs.split(",")]:
   reports.append(run(policy,cost))
   (ROOTOUT/"summary.json").write_text(json.dumps(reports,indent=2),encoding="utf-8")
 print("INTEGRATED_COMPLETE",len(reports),flush=True)
if __name__=="__main__":main()
