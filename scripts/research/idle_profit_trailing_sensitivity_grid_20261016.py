import pathlib,json,collections
import os
ROOT=pathlib.Path(os.environ.get("DISDEX_EXIT_RESEARCH_OUTPUT","research-runs/idle-profit-trailing-5m-20261016")).resolve()
CACHE=json.loads((ROOT/"aster_5m_cached_accepted_trades.json").read_text(encoding="utf8"))
BASE=pathlib.Path(os.environ["DISDEX_V4_FROZEN_RESEARCH_ROOT"]).resolve()/"docs/research/results/v12-v2-integrated-confirm-20261009/cases/V2_M150_D05_CORE_NATIVE/runs"
T=300000
results=[]
for cost in (10,30):
 rows=[json.loads(x) for x in (BASE/f"PRICE_MODEL_{cost}BPS"/"portfolio-trades.jsonl").read_text(encoding="utf8").splitlines() if x]
 rows=[r for r in rows if r["strategy_id"]=="IDLE"]
 for arm in (.03,.0325,.035,.0375,.04,.0425):
  for gap in (.0025,.005,.0075,.01,.0125,.015):
   gains=[0.,0.];stops=0;improved=0;worse=0
   for r in rows:
    if r["symbol"] not in ("DOTUSDT","RENDERUSDT"):continue
    k=r["symbol"]+":"+str(r["entry_ts_ms"])
    ledger={x[0]:x for x in CACHE[k]};entry=r["entry_price"];stop=None;peak=0;fill=None
    for t in range(((r["entry_ts_ms"]+T-1)//T)*T,r["exit_ts_ms"],T):
     x=ledger[t];op,hi,lo,cl=x[1:]
     if stop is not None and t+T<r["exit_ts_ms"] and (op>=stop or hi>=stop):
      fill=max(op,stop);break
     peak=max(peak,(entry-cl)/entry)
     if peak>=arm:
      level=entry*(1-peak+gap)
      stop=level if stop is None else min(stop,level)
    if fill is not None:
     delta=(r["exit_price"]-fill)/entry*float(r["accepted_gross"])*100
     gains[0 if r["entry_ts_ms"]<1769904000000 else 1]+=delta
     improved+=int(delta>0);worse+=int(delta<0);stops+=1
   row=dict(cost=cost,arm=round(arm,4),gap=round(gap,4),
    earlyDelta=round(gains[0],4),lateDelta=round(gains[1],4),
    total=round(sum(gains),4),stops=stops,improved=improved,worse=worse)
   results.append(row)
   if gap in (.005,.01):
    print("GRID",cost,arm,gap,"EARLY",row["earlyDelta"],"LATE",row["lateDelta"],"SUM",row["total"],"N",stops,flush=True)
p=ROOT/"5m_sensitivity_grid_36x2.json"
p.write_text(json.dumps({"note":"56 unique historical accepted positions; in-sample post-selection and no portfolio capacity replay","data":results},indent=2),encoding="utf8")
print("TOP_SIMULTANEOUS_BOTH_HALVES_AND_BOTH_COSTS")
from collections import defaultdict
group=defaultdict(dict)
for v in results:group[(v["arm"],v["gap"])][v["cost"]]=v
a=[]
for (arm,gap),z in group.items():
 if len(z)<2:continue
 metric=min(z[10]["earlyDelta"],z[10]["lateDelta"],z[30]["earlyDelta"],z[30]["lateDelta"])
 a.append((metric,arm,gap,z[10]["total"],z[30]["total"],z[10]["stops"],z[30]["stops"]))
for v in sorted(a,reverse=True)[:16]:print("RANK",v)
print("SAVED",p)
