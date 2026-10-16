"""Entry-frozen independent diagnostics for Idle +3% arm -> loss -1% stop and alternate floors."""
from __future__ import annotations
import contextlib,io,sys,json,collections,datetime,statistics
from pathlib import Path
H=3_600_000
import os
ROOT=Path(os.environ["DISDEX_V4_FROZEN_RESEARCH_ROOT"]).resolve()
OUT=Path(os.environ.get("DISDEX_EXIT_RESEARCH_OUTPUT","research-runs/idle-peak3-frozen-20261016")).resolve()
OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT/"scripts/research"))
sys.path.insert(0,str(Path(__file__).parent))
from idle_peak3_floor_helper_20261016 import model_idle_peak_floor
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_priority_gross_v2_sweep as sweep
w=sweep.s.w
w.setup()
folder=ROOT/"docs/research/results/v12-v2-integrated-confirm-20261009/cases/V2_M150_D05_CORE_NATIVE/runs"
def metric(rows, cost):
    returns=[((r["entry_price"]-r["exit_price"])/r["entry_price"]-cost/10_000)*float(r["accepted_gross"]) for r in rows]
    wins=[v for v in returns if v>0];losses=[v for v in returns if v<0]
    return {"n":len(rows),"PF":sum(wins)/-sum(losses) if losses else None,"win":len(wins)/len(rows) if rows else None,
            "sum_pctpoints":sum(returns)*100,"wins":len(wins),"losses":len(losses)}
scenarios=[
("arm3_floor_m1_close",.03,-.01,"close",0),
("arm3_floor_0_close",.03,0.,"close",0),
("arm3_floor_p0p5_close",.03,.005,"close",0),
("arm3_floor_p1_close",.03,.01,"close",0),
("arm3_floor_p2_close",.03,.02,"close",0),
("arm3_floor_m1_wick",.03,-.01,"wick",0),
("arm3_floor_m1_close_slip50",.03,-.01,"close",50),
("arm3_floor_p0p5_close_slip50",.03,.005,"close",50)]
records=[]
for cost in (10,30):
 d=folder/f"PRICE_MODEL_{cost}BPS"
 all_rows=[json.loads(t) for t in (d/"portfolio-trades.jsonl").read_text(encoding="utf8").splitlines() if t]
 original=[r for r in all_rows if r["strategy_id"]=="IDLE"]
 ref=metric(original,cost)
 print("BASELINE",cost,ref,flush=True)
 for name,threshold,floor,activation,slip in scenarios:
    obs={};updated=[model_idle_peak_floor(r,w.bars,threshold=threshold,floor=floor,activation=activation,extra_stop_slip_bps=slip,observation=obs) for r in original]
    after=metric(updated,cost)
    b={}
    for k,label in [(True,"early"),(False,"late")]:
        idx=[i for i,r in enumerate(original) if (r["entry_ts_ms"]<1769904000000)==k]
        b[label]={"n":len(idx),"sum_delta_points":100*sum((original[i]["exit_price"]-updated[i]["exit_price"])/original[i]["entry_price"]*float(original[i]["accepted_gross"]) for i in idx)}
    differences=[{"symbol":o["symbol"],"route":o["route"],"entry_ts_ms":o["entry_ts_ms"],
                 "base_exit_price":o["exit_price"],"new_exit_price":u["exit_price"],
                 "deltaUSD":(o["exit_price"]-u["exit_price"])*o["quantity"],
                 "old_exit_ts":o["exit_ts_ms"],"new_exit_ts":u["exit_ts_ms"]} for o,u in zip(original,updated) if u["exit_ts_ms"]!=o["exit_ts_ms"]]
    row={"case":name,"bps":cost,"threshold":threshold,"floor":floor,"activation":activation,"extra_slip_bps":slip,
         "baseline":ref,"candidate":after,"delta_sum_pctpoints":after["sum_pctpoints"]-ref["sum_pctpoints"],
         "count_stops":obs.get("stopped",0),"count_armed":obs.get("armed",0),
         "bySymbol":obs.get("stopped_by_symbol",{}),"splits":b,"differences":differences}
    records.append(row)
    print("CASE",name,cost,"PF",round(after["PF"],4),"DELTA_PTS",round(row["delta_sum_pctpoints"],3),"ARMED",obs.get("armed",0),"STOPPED",obs.get("stopped",0),"EARLY",round(b["early"]["sum_delta_points"],3),"LATE",round(b["late"]["sum_delta_points"],3),flush=True)
path=OUT/"frozen-entry-peak3-floor-sweep.json";path.write_text(json.dumps({"results":records,"method":"H1 causal bar-next stop, candidate original entry preserved, no funding / capital re-allocation, research only"},indent=2),encoding="utf8")
print("SAVED",path,flush=True)
