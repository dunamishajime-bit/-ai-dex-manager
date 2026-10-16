#!/usr/bin/env python3
"""Idle fixed-hold exit research, shortened exit horizon without resident STOP replacements. Frozen-entry scope."""
import contextlib,io,runpy,json,os,collections
from pathlib import Path
H=3_600_000
P=Path(__file__).resolve().with_name("idle_conditional_exit_sweep_20261016.py")
with contextlib.redirect_stdout(io.StringIO()):m=runpy.run_path(str(P),run_name="idle_time_source")
bars=m["s"].w.bars;ROOT=m["ROOT"];OUT=m["OUT"];metrics=m["metrics"];bucket=m["bucket"]
SPEC={
 "baseline":{},
 "DOT_8":{"DOTUSDT":8},
 "DOT_12":{"DOTUSDT":12},
 "DOT_16":{"DOTUSDT":16},
 "DOT_18":{"DOTUSDT":18},
 "RENDER_4":{"RENDERUSDT":4},
 "RENDER_6":{"RENDERUSDT":6},
 "RENDER_8":{"RENDERUSDT":8},
 "JUP_6":{"JUPUSDT":6},
 "JUP_8":{"JUPUSDT":8},
 "DOT12_RENDER6":{"DOTUSDT":12,"RENDERUSDT":6},
 "DOT16_RENDER8":{"DOTUSDT":16,"RENDERUSDT":8},
 "DOT12_RENDER8":{"DOTUSDT":12,"RENDERUSDT":8},
 "DOT12_JUP8":{"DOTUSDT":12,"JUPUSDT":8},
}
def sim(row,plan):
 sym=row["symbol"]
 if sym not in plan:return row,None
 t=row["entry_ts_ms"]+plan[sym]*H
 if t>=row["exit_ts_ms"]:return row,None
 bar=bars.get(sym,{}).get(t)
 if not bar:return row,"MISSING_H1"
 px=float(bar["open"])
 if not (px>0):raise AssertionError("BAD_BAR_OPEN")
 return dict(row,exit_ts_ms=t,exit_price=px,exit_reason_actual="IDLE_SHORTER_TIME_HOLD"),"CHANGED"
report={}
for cost in (10,30):
 rows=[json.loads(x) for x in (ROOT/f"PRICE_MODEL_{cost}BPS"/"portfolio-trades.jsonl").read_text(encoding="utf8").splitlines() if x]
 old=[x for x in rows if x.get("strategy_id")=="IDLE"]
 current=metrics(old,cost)
 out={}
 for name,plan in SPEC.items():
  new=[];changed=[];miss=0
  for x in old:
   n,e=sim(x,plan);new.append(n)
   if e=="CHANGED":changed.append((x["symbol"],x["entry_ts_ms"],x["exit_price"],n["exit_price"]))
   elif e:miss+=1
  dst=metrics(new,cost)
  splits={}
  for part in ("first","second"):
   idx=[i for i,x in enumerate(old) if bucket(x)==part]
   splits[part]={"n":len(idx),"deltaPct":round(metrics([new[i] for i in idx],cost)["sum_percentpoints"]-metrics([old[i] for i in idx],cost)["sum_percentpoints"],5)}
  out[name]={"PF":dst["pf"],"WR":dst["wr"],"deltaPct":round(dst["sum_percentpoints"]-current["sum_percentpoints"],5),
   "changed":len(changed),"missing":miss,"splits":splits,"changeDetails":changed}
 report[str(cost)]=out
 print("IDLE_FIXED_HOLD",cost,"baseline",current,flush=True)
 for k,v in sorted(out.items(),key=lambda kv:-kv[1]["deltaPct"]):
  print("HOLD_CASE",cost,k,"DELTA_PCT",v["deltaPct"],"PF",v["PF"],"WR",v["WR"],"CHANGED",v["changed"],"SPLIT",v["splits"],flush=True)
p=OUT/"idle_fixed_hold_shorter_horizon_sweep.json"
p.write_text(json.dumps({"study":"research only frozen-entry fixed short","cases":SPEC,"cost":report},indent=2),encoding="utf8")
print("SAVED",p,p.stat().st_size,flush=True)
