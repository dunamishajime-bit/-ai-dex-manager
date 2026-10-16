#!/usr/bin/env python3
"""Idle short partial take-profit research: frozen entry, synthetic blended exit, no new margin freed, research-only."""
import io,contextlib,runpy,json,collections,os,datetime
from pathlib import Path
H=3_600_000
SRC=Path(__file__).resolve().with_name("idle_conditional_exit_sweep_20261016.py")
with contextlib.redirect_stdout(io.StringIO()):
 v=runpy.run_path(str(SRC),run_name="research_import")
w=v["s"].w
ROOT=v["ROOT"]
OUT=v["OUT"]
BUCKET=v["bucket"]
METRICS=v["metrics"]
spec=[
 ("dotrender_p1p5_half","DOT_RENDER",.015,.5),
 ("dotrender_p2_quarter","DOT_RENDER",.02,.25),
 ("dotrender_p2_half","DOT_RENDER",.02,.5),
 ("dotrender_p2_threequarter","DOT_RENDER",.02,.75),
 ("dotrender_p3_half","DOT_RENDER",.03,.5),
 ("relative_p2_half","DOT_RENDER_JUP",.02,.5),
 ("relative_p1p5_half","DOT_RENDER_JUP",.015,.5),
 ("dot_only_p2_half","DOT",.02,.5),
 ("jup_only_p1p5_half","JUP",.015,.5),
 ("all_short_p3_half","ALL",.03,.5)
]
def suitable(symbol,scope):
 if scope=="DOT_RENDER":return symbol in ("DOTUSDT","RENDERUSDT")
 if scope=="DOT_RENDER_JUP":return symbol in ("DOTUSDT","RENDERUSDT","JUPUSDT")
 if scope=="DOT":return symbol=="DOTUSDT"
 if scope=="JUP":return symbol=="JUPUSDT"
 return True
def sim(row,scope,arm,portion):
 if not suitable(row["symbol"],scope):return row,None
 if row["side"]!="SHORT":raise AssertionError("IDLE_SIDE")
 entry=float(row["entry_price"]);t0=int(row["entry_ts_ms"]);te=int(row["exit_ts_ms"])
 for t in range(t0,te,H):
  c=w.bars.get(row["symbol"],{}).get(t)
  if c is None:return row,"DATA_GAP"
  gain=(entry-float(c["close"]))/entry
  if gain<arm or t+H>=te:continue
  n=w.bars.get(row["symbol"],{}).get(t+H)
  if n is None:return row,"NEXT_OPEN_GAP"
  early=float(n["open"])
  new_price=portion*early+(1-portion)*float(row["exit_price"])
  if new_price<=0:raise AssertionError("BAD_BLEND")
  # Synthetic price blend represents partial early exit + original remaining.
  # Keeps original capital/slot horizon; not real partial fill / funding replay.
  return {**row,"exit_price":new_price}, {"fraction":portion,"early":early,"time":t+H,"old":row["exit_price"]}
 return row,None
report={}
for bp in (10,30):
 rows=[json.loads(x) for x in (ROOT/f"PRICE_MODEL_{bp}BPS"/"portfolio-trades.jsonl").read_text(encoding="utf8").splitlines() if x]
 subs=[x for x in rows if x.get("strategy_id")=="IDLE"]
 results={}
 for name,scope,arm,portion in spec:
  new=[];events=[];gaps=0
  for row in subs:
   o,e=sim(row,scope,arm,portion);new.append(o)
   if isinstance(e,dict):events.append({"sym":row["symbol"],"ts":row["entry_ts_ms"],"quantity":row["quantity"],
     "usdDelta":round((float(row["exit_price"])-float(o["exit_price"]))*float(row["quantity"]),5),
     "earlyExitPrice":e["early"],"portion":portion})
   elif e:gaps+=1
  base=METRICS(subs,bp);m=METRICS(new,bp)
  splits={}
  for part in ("first","second"):
   ix=[i for i,r in enumerate(subs) if BUCKET(r)==part]
   splits[part]={"n":len(ix),"deltaPct":round(METRICS([new[i] for i in ix],bp)["sum_percentpoints"]-METRICS([subs[i] for i in ix],bp)["sum_percentpoints"],5)}
  results[name]={"current":base,"candidate":m,"deltaPct":round(m["sum_percentpoints"]-base["sum_percentpoints"],5),
    "usdFrozenDelta":round(sum(e["usdDelta"] for e in events),5),
    "partialFills":len(events),"gap":gaps,"splits":splits,"events":events}
 report[str(bp)]=results
 print("IDLE_PARTIAL",bp,"BASE",base,flush=True)
 for name,x in sorted(results.items(),key=lambda kv:-kv[1]["deltaPct"]):
  print("CASE",bp,name,"DELTA_PCT",x["deltaPct"],"PF",x["candidate"]["pf"],
     "PARTIALS",x["partialFills"],"USD_DELTA",x["usdFrozenDelta"],"SPLIT",x["splits"],flush=True)
dest=OUT/"idle_short_partial_exit_blended_model.json"
dest.write_text(json.dumps({"summary":"Research-only frozen partial blended exit, no full integrated capital or funding/fee reassignment","cost":report,"cases":spec},indent=2),encoding="utf8")
print("SAVED",dest,dest.stat().st_size)
