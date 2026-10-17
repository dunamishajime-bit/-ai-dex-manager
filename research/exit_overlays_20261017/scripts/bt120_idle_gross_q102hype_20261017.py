"""Research only: Q102 + HYPE five-minute exits, Idle Gross sensitivity with exact admission & quantity filters.
Never changes source checkout or LIVE. Rigorous control-case parity and accepted Gross audit.
"""
from __future__ import annotations
import json,time,traceback,math
from pathlib import Path
import bt120_combined_and_slippage_stress_20261017 as combo
import idle_gross_fractional_isolated_full8_20261016 as gross
r=combo.r
base=combo.base
ROOT=r.ROOT
OUT=ROOT/"idle_gross_on_q102_hype"
OUT.mkdir(parents=True,exist_ok=True)
base.OUTROOT=OUT
IDLE_SYMBOLS=("DOTUSDT","JUPUSDT","RENDERUSDT","TAOUSDT","TIAUSDT")
Q102_HYPE={"Q102":"Q102_06_FLOOR_2_TO_0p5","HYPE_LONG":"HYPE_LONG_01_HARD_WALLET_2"}
POLICIES={
  "BASE_QH":{"sizes":{},"exit":None},
  "RENDER_0p5":{"sizes":{"RENDERUSDT":.5},"exit":None},
  "RENDER_0p25":{"sizes":{"RENDERUSDT":.25},"exit":None},
  "DOT_0p5":{"sizes":{"DOTUSDT":.5},"exit":None},
  "DOT_RENDER_0p5":{"sizes":{"DOTUSDT":.5,"RENDERUSDT":.5},"exit":None},
  "ALL_IDLE_0p5":{"sizes":dict.fromkeys(IDLE_SYMBOLS,.5),"exit":None},
  "ALL_IDLE_0p25":{"sizes":dict.fromkeys(IDLE_SYMBOLS,.25),"exit":None},
  "RENDER_0p5_FLOOR2":{"sizes":{"RENDERUSDT":.5},"exit":"IDLE_06_FLOOR_2_TO_0p5","symbols":{"RENDERUSDT"}},
  "RENDER_0p5_RISK2":{"sizes":{"RENDERUSDT":.5},"exit":"IDLE_01_HARD_WALLET_2","symbols":{"RENDERUSDT"}},
  "RENDER_0p5_VOLUME":{"sizes":{"RENDERUSDT":.5},"exit":"IDLE_22_VOLUME_SHOCK_2p5","symbols":{"RENDERUSDT"}},
  "IDLE_0p5_FLOOR2":{"sizes":dict.fromkeys(IDLE_SYMBOLS,.5),"exit":"IDLE_06_FLOOR_2_TO_0p5","symbols":set(IDLE_SYMBOLS)},
  "IDLE_0p5_RISK2":{"sizes":dict.fromkeys(IDLE_SYMBOLS,.5),"exit":"IDLE_01_HARD_WALLET_2","symbols":set(IDLE_SYMBOLS)},
}
assert len(POLICIES)==12

def experiment_filter(base_filter,policy,obs):
 def filt(candidates,case):
  raw=base_filter(candidates,case)
  out=[]
  spec=POLICIES[policy]
  for row in raw:
   if row["strategy_id"]=="IDLE":
    sym=row["symbol"]
    if sym in spec["sizes"]:
     requested=float(row["requested_gross"])
     factor=spec["sizes"][sym]
     row={**row,"requested_gross":requested*factor}
     obs["grossCandidateN"]=obs.get("grossCandidateN",0)+1
   # Baseline includes the earlier 3 research changes.
   x=combo.orig(row,"combined_no_residual",obs)
   if x["strategy_id"]=="Q102":
    x=r.m5_override(x,r.BY_ID[Q102_HYPE["Q102"]])
   elif x["strategy_id"]=="HYPE_LONG":
    x=r.m5_override(x,r.BY_ID[Q102_HYPE["HYPE_LONG"]])
   elif x["strategy_id"]=="IDLE":
    if spec.get("exit") and x["symbol"] in spec["symbols"]:
     x=r.m5_override(x,r.BY_ID[spec["exit"]])
   out.append(x)
  return out
 return filt

# Research gross patch is already injected by the gross helper's import.
base.wrapped_filter=experiment_filter

def run(policy,cost):
 assert policy in POLICIES and cost in (10,30)
 gross._allowed_fractional_symbols.clear()
 gross._allowed_fractional_symbols.update(POLICIES[policy]["sizes"])
 r.COUNTS={"changed":0,"byStrategy":{},"byReason":{},"warnings":{}}
 print("START_IDLEGROSS",policy,cost,flush=True)
 t=time.monotonic()
 try:run=base.run_one(policy,cost)
 except Exception:traceback.print_exc();raise
 output=run["output"]
 ledgers=list((OUT/policy/f"{cost}bps"/"cases"/base.CASE_NAME/"runs").glob("*/portfolio-trades.jsonl"))
 assert len(ledgers)==1,(policy,cost,"NO_LEDGER")
 rows=[json.loads(line) for line in ledgers[0].read_text("utf8").splitlines() if line.strip()]
 idle=[x for x in rows if x["strategy_id"]=="IDLE"]
 bysymbol={}
 for sym in sorted({x["symbol"] for x in idle}):
  z=[x for x in idle if x["symbol"]==sym]
  gains=[((1 if x["side"]=="LONG" else -1)*(x["exit_price"]/x["entry_price"]-1)-cost/10000)*x["accepted_gross"] for x in z]
  bysymbol[sym]={"n":len(z),"max_gross":round(max(x["accepted_gross"] for x in z),5),
    "min_gross":round(min(x["accepted_gross"] for x in z),5),"gross_avg":round(sum(x["accepted_gross"] for x in z)/len(z),5),
    "loss_below2":sum(y<-.02 for y in gains),"loss_below3":sum(y<-.03 for y in gains),
    "loss_below5":sum(y<-.05 for y in gains),"worst_pct":round(100*min(gains),3),
    "win_pct":round(100*sum(y>0 for y in gains)/len(z),2)}
  if sym in POLICIES[policy]["sizes"]:
   expected=POLICIES[policy]["sizes"][sym]
   assert bysymbol[sym]["max_gross"]<=expected+1e-6,(policy,sym,bysymbol[sym])
  else:
   # leave normal original sizes
   pass
 res={"policy":policy,"cost_bps":cost,"final_jpy":output["final_equity_jpy"],
 "max_dd_pct":round(100*output["maximum_mtm_drawdown"],4),
 "pf":output["profit_factor"],"win_pct":round(100*output["win_rate"],3),
 "annual_trades":output["closed_trades"],"all_trades_by_strategy":output["strategy_trades"],
 "accounting":output["accounting"],"idle_by_symbol":bysymbol,
 "sizing_candidate_N":run["observations"].get("grossCandidateN",0),
 "five_minute_exit_changes":r.COUNTS,"elapsed":round(time.monotonic()-t,2)}
 f=OUT/policy/f"{cost}bps"/"idle_gross_result.json"
 f.write_text(json.dumps(res,ensure_ascii=False,indent=2),encoding="utf8")
 print("IDLE_GROSS_RESULT",json.dumps(res,ensure_ascii=False),flush=True)
 return res
if __name__=="__main__":
 for policy in POLICIES:
  for cost in (10,30):
   f=OUT/policy/f"{cost}bps"/"idle_gross_result.json"
   if f.exists(): print("SKIP",policy,cost,flush=True);continue
   try:run(policy,cost)
   except Exception as e:
    print("FAILED_IDLEGROSS",policy,cost,repr(e),flush=True)
    raise
 print("FINISH_IDLEGROSS",len(POLICIES)*2,flush=True)
