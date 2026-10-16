"""Frozen-entry Idle peak-trailing research: NOT an integrated or venue-certified BT."""
import contextlib,io,sys,json,collections,os
from pathlib import Path
from idle_profit_trailing_helper_20261016 import trailing_exit
ROOT=Path(os.environ["DISDEX_V4_FROZEN_RESEARCH_ROOT"]).resolve()
OUT=Path(os.environ.get("DISDEX_EXIT_RESEARCH_OUTPUT","research-runs/idle-profit-trailing-20261016")).resolve()
OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT/"scripts/research"))
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_priority_gross_v2_sweep as sweep
w=sweep.s.w
w.setup()
base=ROOT/"docs/research/results/v12-v2-integrated-confirm-20261009/cases/V2_M150_D05_CORE_NATIVE/runs"
scope={"all":None,"dr":["DOTUSDT","RENDERUSDT"],"drj":["DOTUSDT","RENDERUSDT","JUPUSDT"],"dot":["DOTUSDT"],"render":["RENDERUSDT"],"taotia":["TAOUSDT","TIAUSDT"]}
spec=[]
for k in scope:
 for gap in (.005,.01,.015,.02):
  spec.append((f"a3_g{gap*100:.1f}_{k}",.03,gap,k,"close",0))
for k in ("all","dr","drj"):
 for arm in (.02,.04):
  for gap in (.01,.015):
   spec.append((f"a{arm*100:.1f}_g{gap*100:.1f}_{k}",arm,gap,k,"close",0))
for k in ("all","dr"):
 for gap in (.01,.015):
  spec.append((f"a3_g{gap*100:.1f}_{k}_wick",.03,gap,k,"wick",0))
  spec.append((f"a3_g{gap*100:.1f}_{k}_slip50",.03,gap,k,"close",50))
def metric(rows,cost):
 v=[((r["entry_price"]-r["exit_price"])/r["entry_price"]-cost/10000)*float(r["accepted_gross"]) for r in rows]
 plus=sum(max(x,0) for x in v);minus=-sum(min(x,0) for x in v)
 return {"n":len(rows),"pf":round(plus/minus,5) if minus else None,
     "win_pct":round(100*sum(x>0 for x in v)/len(v),3) if v else None,
     "totalWeightedPctPoints":round(100*sum(v),5)}
results={}
for cost in (10,30):
 a=[json.loads(x) for x in (base/f"PRICE_MODEL_{cost}BPS"/"portfolio-trades.jsonl").read_text(encoding="utf8").splitlines() if x]
 idle=[r for r in a if r["strategy_id"]=="IDLE"]
 orig=metric(idle,cost);cases={}
 for name,arm,gap,k,mode,slip in spec:
  obs={}
  changed=[trailing_exit(r,w.bars,arm=arm,gap=gap,symbols=scope[k],peak_mode=mode,slip_bps=slip,obs=obs) for r in idle]
  v=metric(changed,cost)
  periods={}
  for label in ("early","late"):
   idx=[i for i,r in enumerate(idle) if (r["entry_ts_ms"]<1769904000000)==(label=="early")]
   periods[label]={"n":len(idx),"sumChangePctPoints":round(sum(100*(idle[i]["exit_price"]-changed[i]["exit_price"])/idle[i]["entry_price"]*float(idle[i]["accepted_gross"]) for i in idx),5)}
  diffs=[{"symbol":r["symbol"],"route":r["route"],"entryTime":r["entry_ts_ms"],"deltaReturnPctPoints":round(100*(r["exit_price"]-n["exit_price"])/r["entry_price"],4)}
        for r,n in zip(idle,changed) if r["exit_ts_ms"]!=n["exit_ts_ms"]]
  cases[name]={"arm":arm,"gap":gap,"scope":k,"mode":mode,"slipBps":slip,"baseline":orig,"candidate":v,
       "deltaWeightedPctPoints":round(v["totalWeightedPctPoints"]-orig["totalWeightedPctPoints"],5),
       "armed":obs.get("armed",0),"stopped":obs.get("stopped",0),"missing":obs.get("missing",0),
       "bySymbol":obs.get("by_symbol",{}),"periods":periods,"changed":diffs}
 results[str(cost)]=cases
 print("BASE",cost,orig,flush=True)
 for name,d in sorted(cases.items(),key=lambda z:z[1]["deltaWeightedPctPoints"],reverse=True)[:28]:
  print("SWEEP",cost,name,"DELTA",d["deltaWeightedPctPoints"],"PF",d["candidate"]["pf"],
        "STOP",d["stopped"],"ARM",d["armed"],"EARLY",d["periods"]["early"]["sumChangePctPoints"],
        "LATE",d["periods"]["late"]["sumChangePctPoints"],flush=True)
out=OUT/"frozen-trailing-profit-results.json"
out.write_text(json.dumps({"note":"Entry-frozen accepted trade replay. NOT portfolio capital allocation or venue-certified. Splits are in-sample post-selection.","cases":results},indent=2),encoding="utf8")
print("RESULT_PATH",out,"BYTES",out.stat().st_size,flush=True)
