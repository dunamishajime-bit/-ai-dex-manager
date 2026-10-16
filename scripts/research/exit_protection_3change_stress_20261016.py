"""Frozen-source full-eight modeled integrated exit experiments, never LIVE.
Uses the 2026-10-08 research engine and original frozen 41-route V4 selection.
PENGU exit/entry code is never altered.
"""
from __future__ import annotations
import argparse,contextlib,io,json,sys,time,math,traceback
from pathlib import Path
import os
_source_root=os.environ.get("DISDEX_V4_FROZEN_RESEARCH_ROOT")
if not _source_root: raise SystemExit("SET_DISDEX_V4_FROZEN_RESEARCH_ROOT_FOR_READONLY_RESEARCH")
SOURCE=Path(_source_root).expanduser().resolve()
OUTROOT=Path(os.environ.get("DISDEX_EXIT_RESEARCH_OUTPUT","research-runs/exit-protection-3change-stress-20261016")).expanduser().resolve()
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
H=3600_000
BASE_ADMISSION_PATCH=s.w.base.patch_admission
CASE_NAME="V2_M150_D05_CORE_NATIVE"
CASE=sweep.CASES[CASE_NAME]
def hbar(sym,t):
 return s.w.bars.get(sym,{}).get(t)
def atr14(sym,t):
 rows=[hbar(sym,t-i*H) for i in range(15,0,-1)]
 if any(x is None for x in rows):return None
 values=[]
 for i in range(1,15):
  r=rows[i]; previous=rows[i-1]['close']
  values.append(max(r["high"]-r["low"],abs(r["high"]-previous),abs(r["low"]-previous)))
 return sum(values)/14
def causal_exit(x,policy,obs):
 extra_delay={"three_delay1":1,"three_delay2":2,"three_slip50_delay1":1}.get(policy,0)
 slip_bps={"three_slip20":20,"three_slip50":50,"three_slip100":100,"three_slip50_delay1":50}.get(policy,0)
 entry=float(x["entry_price"]);ts=int(x["entry_ts_ms"]);oldexit=int(x["exit_ts_ms"])
 sg=1 if x["side"]=="LONG" else -1
 sym=x["symbol"];stype=x["strategy_id"];reason=None
 if policy in ("hype_trail2p5","hype_trail3") and stype=="HYPE_LONG":
  atr=atr14(sym,ts)
  if atr is None or atr<=0:
   obs["noATR"]+=1;return x
  trail=2.5 if policy=="hype_trail2p5" else 3.
  stop=entry-2.5*atr
  peak=entry
  newexit=None
  # After entry, simulate initial protected loss and trailing STOP.
  # Stop updated from each fully completed H1 close and only active next H1.
  for start in range(ts,ts+168*H,H):
   bar=hbar(sym,start)
   if bar is None:obs["h1gap"]+=1;return x
   op,hi,lo,cl=(float(bar[k]) for k in ("open","high","low","close"))
   if lo<=stop or op<=stop:
    newexit=(start+H,min(stop,op),"HYPE_TRAIL_"+str(trail)+"ATR")
    break
   peak=max(peak,cl)
   stop=max(stop,peak-trail*atr)
  if not newexit:
   future=hbar(sym,ts+168*H)
   if future is None:obs["h1gap"]+=1;return x
   newexit=(ts+168*H,float(future["open"]),"HYPE_MAX_168H")
  newts,newpx,reason=newexit
 elif policy in ("q102mr_floor3","v4g5_floor2","v4x05_floor2p5","residual_floor2","combined","v4_only","combined_no_mr","combined_no_residual","combined_no_x05","combined_no_g5","three_slip20","three_slip50","three_slip100","three_delay1","three_delay2","three_slip50_delay1"):
  applied=False
  arm=0;lock=0
  if policy in ("q102mr_floor3","combined","combined_no_residual","combined_no_x05","combined_no_g5","three_slip20","three_slip50","three_slip100","three_delay1","three_delay2","three_slip50_delay1") and stype=="Q102" and x.get("family")=="MR":
   arm,lock=.03,.01;applied=True
  if policy in ("v4g5_floor2","combined","v4_only","combined_no_mr","combined_no_residual","combined_no_x05","three_slip20","three_slip50","three_slip100","three_delay1","three_delay2","three_slip50_delay1") and stype=="V12" and x.get("route")=="REC_G5_SLOW_TREND":
   arm,lock=.02,.005;applied=True
  if policy in ("v4x05_floor2p5","combined","v4_only","combined_no_mr","combined_no_residual","combined_no_g5","three_slip20","three_slip50","three_slip100","three_delay1","three_delay2","three_slip50_delay1") and stype=="V12" and x.get("route")=="REC_X05_TIME_36H":
   arm,lock=.025,.01;applied=True
  if policy in ("residual_floor2","combined","combined_no_mr","combined_no_x05","combined_no_g5") and stype=="RESIDUAL":
   arm,lock=.02,.005;applied=True
  if not applied:return x
  stop=None;newexit=None;pending_stop=None;activate_at=None
  for start in range(ts,oldexit,H):
   bar=hbar(sym,start)
   if bar is None:
    obs["h1gap"]+=1;return x
   op,hi,lo,cl=(float(bar[k]) for k in ("open","high","low","close"))
   # Apply only already completed H1 floor decision, including modeled order lag.
   if pending_stop is not None and start >= activate_at:
    stop = max(stop,pending_stop) if sg==1 and stop is not None else (
       min(stop,pending_stop) if sg==-1 and stop is not None else pending_stop)
    pending_stop=None
   if stop is not None and ((lo<=stop or op<=stop) if sg==1 else (hi>=stop or op>=stop)):
    px=min(stop,op) if sg==1 else max(stop,op)
    px=px*(1 - sg*slip_bps/10000)
    newexit=(start+H,px,"FLOOR_"+policy)
    break
   gain=sg*(cl/entry-1)
   if gain>=arm and stop is None and pending_stop is None:
    proposal=entry*(1+sg*lock)
    pending_stop=proposal
    activate_at=start+(1+extra_delay)*H
  if newexit is None:return x
  newts,newpx,reason=newexit
 else:
  return x
 # Ensure the same transaction begins, only the EXIT is counterfactually changed.
 if newts==oldexit and abs(newpx-float(x["exit_price"]))<1e-12:return x
 if newts<=ts or newpx<=0:raise RuntimeError("INVALID_EXIT")
 obs["changed"]+=1
 obs["byStrategy"].setdefault(stype,0)
 obs["byStrategy"][stype]+=1
 obs["byReason"].setdefault(reason,0)
 obs["byReason"][reason]+=1
 return dict(x,exit_ts_ms=newts,exit_price=newpx,exit_reason=reason,
             unit_price_return=sg*(newpx/entry-1))
def wrapped_filter(base_filter,policy,obs):
 def filt(candidates,case):
  rows=base_filter(candidates,case)
  return [causal_exit(x,policy,obs) for x in rows]
 return filt
def run_one(policy,cost):
 assert cost in (10,30)
 out=OUTROOT/policy/f"{cost}bps"
 out.mkdir(parents=True,exist_ok=True)
 s.w.OUT=out
 s.w.setup()
 v4.install_virtual_leg_study_adapter()
 final.install_final_routes()
 v3.stage3_transform=final.stage3_candidate_all
 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
 s.w.base.source_batch=ind.custom_source_batch
 s.w.base.read_table=v3.v2.read_table
 ind.ORIG_PATCH=BASE_ADMISSION_PATCH
 s.w.base.patch_admission=sweep.patch
 v3.CASE[CASE_NAME]={"family_cap":2.5,"gross":.10,"slots":16}
 ind.ACTIVE_RECOVERY_CAP=2.5
 mlift.MAX_LIFT_GROSS=.30
 obs={"changed":0,"byStrategy":{},"byReason":{},"h1gap":0,"noATR":0}
 s.w.base._study_filter=wrapped_filter(sweep.make_filter(CASE_NAME,CASE),policy,obs)
 print("INTEGRATED_REPLAY_START",policy,cost,flush=True)
 at=time.monotonic()
 res=s.w.base.run_study(CASE_NAME,str(cost))
 ts=time.monotonic()-at
 paths=list((out/"cases"/CASE_NAME/"runs").glob("*/metrics.json"))
 assert len(paths)==1,(policy,cost,paths)
 m=json.loads(paths[0].read_text(encoding="utf-8"))
 original=SOURCE/"docs/research/results/v12-v2-integrated-confirm-20261009"/"cases"/CASE_NAME/"runs"/f"PRICE_MODEL_{cost}BPS"/"metrics.json"
 ref=json.loads(original.read_text(encoding="utf-8"))
 row={"policy":policy,"cost_bps":cost,"engine_seconds":round(ts,2),
      "base_original":{"final_equity_jpy":ref.get("final_equity_jpy"),
                       "maximum_mtm_drawdown":ref.get("maximum_mtm_drawdown"),
                       "profit_factor":ref.get("profit_factor"),
                       "win_rate":ref.get("win_rate"),
                       "closed_trades":ref.get("closed_trades")},
      "output":{"final_equity_jpy":m.get("final_equity_jpy"),
                "maximum_mtm_drawdown":m.get("maximum_mtm_drawdown"),
                "profit_factor":m.get("profit_factor"),
                "win_rate":m.get("win_rate"),
                "closed_trades":m.get("closed_trades"),
                "strategy_trades":m.get("strategy_trades"),
                "strategy_pnl_jpy":m.get("strategy_pnl_jpy"),
                "accounting":m.get("accounting_reconciliation",{}).get("status")},
      "observations":obs,
      "caveats":"In-sample full8 portfolio H1 modeled rerun. Candidate-time stop and trailing fills are H1 adverse-open modeling, not signed venue trades. HYPE replacement disables original take profit. PENGU unchanged. Untouched later holdout required."}
 (out/"integrated-summary.json").write_text(json.dumps(row,indent=2),encoding="utf-8")
 print("INTEGRATED_REPLAY_DONE",json.dumps(row),flush=True)
 return row
if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--policy",required=True)
 p.add_argument("--costs",default="10")
 a=p.parse_args()
 for c in (int(v) for v in a.costs.split(",")):
  run_one(a.policy,c)
