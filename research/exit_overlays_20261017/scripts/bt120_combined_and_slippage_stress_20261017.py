"""Extra confirmatory portfolio combinations after 120-profile integrated grid.
Research-only; uses same causal five-minute source and formal eight-strategy engine.
"""
import argparse,json,time,traceback
from pathlib import Path
import bt120_integrated_5minute_full8_20261017 as r
ROOT=r.ROOT
RESULTS=r.OUT
COMBOS=ROOT/"combined_full8"
COMBOS.mkdir(exist_ok=True)
base=r.base
orig=r._base_causal_exit
# Only evaluate combos after all corresponding component single-arm runs exist.
ALL_COUNTS={"IDLE":24,"Q102":20,"PENGU":16,"HYPE_LONG":12,"V12":20,"RESIDUAL":12,"V52":8,"FET":8}
REGISTRY=r.BY_ID
def best_both_costs(group):
 good=[]
 for p in [k for k,v in REGISTRY.items() if v["strategy"]==group and v["name"]!="BASELINE"]:
  try:
   a=json.loads((RESULTS/p/"10bps"/"bt120_integrated_result.json").read_text("utf8"))
   b=json.loads((RESULTS/p/"30bps"/"bt120_integrated_result.json").read_text("utf8"))
  except FileNotFoundError:continue
  if a["total_trades"]<1226 or b["total_trades"]<1222:continue
  gain10=a["max_dd_pct"]-(-20.2376)
  gain30=b["max_dd_pct"]-(-18.341)
  if gain10>0 and gain30>0:good.append((gain10+gain30,p,gain10,gain30))
 return sorted(good,reverse=True)
choice={}
for st in ALL_COUNTS:
 z=best_both_costs(st)
 if z:choice[st]=z[0][1]
print("BOTH_COST_GAINS",choice,flush=True)
q="Q102_06_FLOOR_2_TO_0p5"
q50="Q102_FLOOR2_SLIP50";REGISTRY[q50]={**REGISTRY[q],"id":q50,"slip":50}
q100="Q102_FLOOR2_SLIP100";REGISTRY[q100]={**REGISTRY[q],"id":q100,"slip":100}
scenarios=[
 ("Q102_ONLY",{ "Q102":q }),
 ("Q102_SLIP50",{ "Q102":q50 }),
 ("Q102_SLIP100",{ "Q102":q100 }),
 ("Q102_IDLE_VOLUME",{ "Q102":q,"IDLE":"IDLE_22_VOLUME_SHOCK_2p5"}),
 ("Q102_PENGU_FLOOR",{ "Q102":q,"PENGU":"PENGU_06_FLOOR_2_TO_0p5"}),
 ("Q102_HYPE_FLOOR",{ "Q102":q,"HYPE_LONG":"HYPE_LONG_06_FLOOR_2_TO_0p5"}),
 ("Q102_HYPE_STOP2",{"Q102":q,"HYPE_LONG":"HYPE_LONG_01_HARD_WALLET_2"}),
 ("Q102_HYPE_STOP2_SLIP50",{"Q102":q,"HYPE_LONG":"HYPE_LONG_04_HARD_WALLET_2_SLIP50"}),
 ("Q102_HYPE_FLOOR1P5",{"Q102":q,"HYPE_LONG":"HYPE_LONG_08_FLOOR_1p5_TO_0p5"}),
 ("Q102_PENGU_STOP2",{"Q102":q,"PENGU":"PENGU_01_HARD_WALLET_2"}),
 ("Q102_IDLE_FLOOR",{ "Q102":q,"IDLE":"IDLE_06_FLOOR_2_TO_0p5"}),
 ("Q102_RESIDUAL_FLOOR",{ "Q102":q,"RESIDUAL":"RESIDUAL_06_FLOOR_2_TO_0p5"}),
]
for st in ["PENGU","HYPE_LONG","V12","RESIDUAL","IDLE","FET","V52"]:
 if st in choice:
  scenarios.append((f"Q102_{st}_BEST",{"Q102":q,st:choice[st]}))
# Progressive rollout of only BOTH-COST lower DD arms (least-overfit heuristic).
progress={"Q102":q}
for st in ["HYPE_LONG","PENGU","RESIDUAL","V12","IDLE","FET","V52"]:
 if st in choice:
  progress={**progress,st:choice[st]}
  scenarios.append((f"Q102_PROGRESS_{len(progress)}",dict(progress)))
priority=["Q102_V12_BEST","Q102_HYPE_LONG_BEST","Q102_PROGRESS_3","Q102_HYPE_STOP2","Q102_SLIP50","Q102_SLIP100","Q102_ONLY"]
scenarios.sort(key=lambda pair: priority.index(pair[0]) if pair[0] in priority else len(priority))
lookup=dict(scenarios)
if len(lookup)!=len(scenarios):raise RuntimeError("DUPLICATE_COMBO")
def combo_exit(x,policy,obs):
 row=orig(x,"combined_no_residual",obs)
 sub=lookup[policy].get(row["strategy_id"])
 if sub:
  return r.m5_override(row,REGISTRY[sub])
 return row
base.causal_exit=combo_exit
base.OUTROOT=COMBOS

def run(name,cost):
 r.COUNTS={"changed":0,"byStrategy":{},"byReason":{},"warnings":{}}
 t=time.monotonic()
 row=base.run_one(name,cost)
 o=row["output"]
 res={
  "scenario":name,"target_arms":lookup[name],"cost_bps":cost,
  "final_jpy":o["final_equity_jpy"],
  "max_dd_pct":round(100*o["maximum_mtm_drawdown"],4),
  "pf":o["profit_factor"],"annual_trades":o["closed_trades"],
  "accounting":o["accounting"],"five_minute":r.COUNTS,"elapsed":round(time.monotonic()-t,2),
  "warning":"In-sample public Binance 5m, Aster cross-venue mismatch, 5m marks not full L2, V52 unavailable for older data."
 }
 path=COMBOS/name/f"{cost}bps"/"combined_result.json"
 path.write_text(json.dumps(res,ensure_ascii=False,indent=2),encoding="utf8")
 print("COMBINED_RESULT",json.dumps(res,ensure_ascii=False),flush=True)
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--costs",default="10,30");a=p.parse_args()
 (ROOT/"bt120_combo_pregistered.json").write_text(json.dumps(scenarios,indent=2),encoding="utf8")
 print("COMBO_COUNT",len(scenarios),flush=True)
 for name,_ in scenarios:
  for cost in map(int,a.costs.split(",")):
   if (COMBOS/name/f"{cost}bps"/"combined_result.json").exists():continue
   try:run(name,cost)
   except Exception as e:
    traceback.print_exc();print("FAILED_COMBO",name,cost,str(e),flush=True);raise
 print("COMBINATIONS_COMPLETE",len(scenarios),flush=True)
