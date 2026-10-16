#!/usr/bin/env python3
"""Research only: frozen-entry Idle SHORT causal H1 exit sweep. No venue orders."""
import contextlib,datetime,io,json,os,sys,collections
from pathlib import Path
H=3_600_000
SOURCE=Path(os.environ["DISDEX_V4_FROZEN_RESEARCH_ROOT"]).resolve()
OUT=Path(os.environ.get("DISDEX_EXIT_RESEARCH_OUTPUT","research-runs/idle-conditional-20261016")).resolve()
OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(SOURCE/"scripts/research"))
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_priority_gross_v2_sweep as sweep
s=sweep.s
s.w.setup()
ROOT=SOURCE/"docs/research/results/v12-v2-integrated-confirm-20261009/cases/V2_M150_D05_CORE_NATIVE/runs"
# Fixed, predeclared set of variants. Some are purposely negative controls.
TESTS={
"baseline":dict(which="all",kind="none"),
"universal_floor2_0p5":dict(which="all",kind="floor",arm=.02,floor=.005),
"dot_floor2_0p5":dict(which="dot",kind="floor",arm=.02,floor=.005),
"dot_floor3_1":dict(which="dot",kind="floor",arm=.03,floor=.01),
"dot_render_floor2_0p5":dict(which="dotrender",kind="floor",arm=.02,floor=.005),
"dot_render_floor1p5_0p5":dict(which="dotrender",kind="floor",arm=.015,floor=.005),
"relmom_floor2_0p5":dict(which="relative",kind="floor",arm=.02,floor=.005),
"dotrender_btc3_pos0p5_mfe1p5":dict(which="dotrender",kind="btc",min_mfe=.015,btc3=.005),
"dotrender_btc3_pos1_mfe2":dict(which="dotrender",kind="btc",min_mfe=.02,btc3=.01),
"relative_btc3_pos0p5_mfe1p5":dict(which="relative",kind="btc",min_mfe=.015,btc3=.005),
"relative_btc3_pos1_mfe2":dict(which="relative",kind="btc",min_mfe=.02,btc3=.01),
"dotrender_btc1_pos0p75_mfe1p5":dict(which="dotrender",kind="btc1",min_mfe=.015,btc1=.0075),
"dotrender_peak2_giveback1":dict(which="dotrender",kind="giveback",min_mfe=.02,gb=.01),
"dotrender_peak2_giveback1p5":dict(which="dotrender",kind="giveback",min_mfe=.02,gb=.015),
"relative_peak2_giveback1p5":dict(which="relative",kind="giveback",min_mfe=.02,gb=.015),
"dotrender_peak3_giveback1p5":dict(which="dotrender",kind="giveback",min_mfe=.03,gb=.015),
"relative_combined_btc_giveback":dict(which="relative",kind="btcgb",min_mfe=.015,btc3=.005,gb=.01),
"dotrender_combined_btc_giveback":dict(which="dotrender",kind="btcgb",min_mfe=.015,btc3=.005,gb=.01)
}
SHORTS=["DOTUSDT","RENDERUSDT","JUPUSDT"]
def eligible_route(r,which):
 if which=="all":return True
 if which=="dot":return r["symbol"]=="DOTUSDT"
 if which=="dotrender":return r["symbol"] in ("DOTUSDT","RENDERUSDT")
 if which=="relative":return r["symbol"] in SHORTS
 return False
def bucket(r):
 return "first" if r["entry_ts_ms"] < 1769904000000 else "second" # split at 2026-02-01 UTC

def price(row, ts):
 return s.w.bars.get(row,{}).get(ts)
def simulated(row,params):
 if params["kind"]=="none" or not eligible_route(row,params["which"]):return row,False,False,None
 entry=float(row["entry_price"]);sg=1 if row["side"]=="LONG" else -1
 if not (entry>0):return row,False,False,"ENTRY_INVALID"
 entry_ts=int(row["entry_ts_ms"]);original_exit=int(row["exit_ts_ms"])
 old_price=row["exit_price"]
 peak=0;armed=False;stopprice=None;newpx=None;newts=None;trigger=False;reason=None
 for t in range(entry_ts,original_exit,H):
  bar=price(row["symbol"],t)
  if bar is None:return row,False,False,"H1_GAP"
  op,hi,lo,cl=(float(bar[k]) for k in ("open","high","low","close"))
  if stopprice is not None and t+H<original_exit:
   if (lo<=stopprice or op<=stopprice) if sg==1 else (hi>=stopprice or op>=stopprice):
    newpx=min(stopprice,op) if sg==1 else max(stopprice,op)
    newts=t+H;reason="FLOOR_H1";trigger=True;break
  closegain=sg*(cl/entry-1)
  peak=max(peak,closegain)
  p=params
  if p["kind"]=="floor":
   if peak>=p["arm"] and stopprice is None:
    armed=True
    stopprice=entry*(1+sg*p["floor"])
  elif p["kind"] in ("btc","btc1","btcgb","giveback"):
   if peak>=p["min_mfe"]:armed=True
   if t+H>=original_exit:continue
   btc=s.w.bars.get("BTCUSDT",{})
   b=btc.get(t)
   b3=btc.get(t-3*H)
   b1=btc.get(t-H)
   if p["kind"] in ("btc","btcgb") and (not b or not b3):return row,False,False,"BTC_HISTORY_GAP"
   if p["kind"]=="btc1" and (not b or not b1):return row,False,False,"BTC_HISTORY_GAP"
   btc3=b["close"]/b3["close"]-1 if b and b3 else 0
   btc1=b["close"]/b1["close"]-1 if b and b1 else 0
   allow=(peak>=p["min_mfe"])
   if p["kind"]=="btc":allow=allow and btc3>=p["btc3"]
   if p["kind"]=="btc1":allow=allow and btc1>=p["btc1"]
   if p["kind"]=="giveback":allow=allow and (peak-closegain)>=p["gb"]
   if p["kind"]=="btcgb":allow=allow and btc3>=p["btc3"] and (peak-closegain)>=p["gb"]
   if allow:
    nextbar=price(row["symbol"],t+H)
    if nextbar is None:return row,False,False,"NEXT_OPEN_GAP"
    newpx=float(nextbar["open"])
    # Models a market exit on next H1 open after confirmed close, not on trigger H1
    newts=t+H;reason="CAUSAL_MARKET_SIGNAL";trigger=True;break
 if trigger:
  if newpx<=0:raise AssertionError("NONPOSITIVE_EXIT")
  return dict(row,exit_price=newpx,exit_ts_ms=newts,
              exit_reason_actual=reason,planned_exit_price=newpx,planned_exit_ts_ms=newts),True,armed,None
 return row,False,armed,None

def metrics(items,cost):
 returns=[]
 for row in items:
  sg=1 if row["side"]=="LONG" else -1
  returns.append(((sg*(row["exit_price"]/row["entry_price"]-1))-cost/10000)*float(row["accepted_gross"]))
 g=sum(x for x in returns if x>0);l=-sum(x for x in returns if x<0)
 return dict(n=len(returns),pf=round(g/l,4) if l else None,
  wr=round(100*sum(x>0 for x in returns)/len(returns),3) if returns else None,
  sum_percentpoints=round(100*sum(returns),5),
  avg_bp=round(10000*sum(returns)/len(returns),3) if returns else None)
out={}
for cost in (10,30):
 rows=[json.loads(x) for x in (ROOT/f"PRICE_MODEL_{cost}BPS"/"portfolio-trades.jsonl").read_text(encoding="utf8").splitlines() if x.strip()]
 idle=[x for x in rows if x["strategy_id"]=="IDLE"]
 result={}
 for name,params in TESTS.items():
  cases=[];affected=[];missing=[];armed=0
  for r in idle:
   new,trigger,arm,err=simulated(r,params)
   cases.append(new)
   if trigger:affected.append({"symbol":r["symbol"],"entry_ts_ms":r["entry_ts_ms"],"original_exit_ts_ms":r["exit_ts_ms"],"new_exit_ts_ms":new["exit_ts_ms"],"entry":r["entry_price"],"old":r["exit_price"],"new":new["exit_price"],"sg":r["side"]})
   if err:missing.append(err)
   armed+=int(arm)
  b=metrics(idle,cost);c=metrics(cases,cost)
  splits={}
  for period in ("first","second"):
   ix=[i for i,r in enumerate(idle) if bucket(r)==period]
   splits[period]={"n":len(ix),"delta_pctpoints":round(metrics([cases[i] for i in ix],cost)["sum_percentpoints"]-metrics([idle[i] for i in ix],cost)["sum_percentpoints"],5)}
  # delta in frozen-quantity USD is NOT integrated compounding
  gross_delta=sum((1 if x["sg"]=="LONG" else -1)*(x["new"]-x["old"])*next(r["quantity"] for r in idle if r["symbol"]==x["symbol"] and r["entry_ts_ms"]==x["entry_ts_ms"]) for x in affected)
  result[name]=dict(base=b,candidate=c,
    delta_pctpoints=round(c["sum_percentpoints"]-b["sum_percentpoints"],5),
    delta_usd_frozen=round(gross_delta,5),
    activated=armed,changed=len(affected),missing=collections.Counter(missing),splits=splits,
    by_symbol=dict(collections.Counter(x["symbol"] for x in affected)),
    affected=affected)
 out[str(cost)]=result
 print("IDLE_SWEEP",cost,"n",len(idle),"BASE",b,flush=True)
 for name,item in sorted(result.items(),key=lambda kv:-kv[1]["delta_pctpoints"]):
  print("VAR",cost,name,"DELTA_PCTPOINTS",item["delta_pctpoints"],"DELTA_FROZEN_USD",item["delta_usd_frozen"],"PF",item["candidate"]["pf"],"CHANGED",item["changed"],"SPLIT",item["splits"],flush=True)
report=OUT/"idle_short_frozen_entry_conditional_exit_sweep.json"
report.write_text(json.dumps({"schema":"idle-short-research-frozen-exits-v1",
 "warning":"Not full integrated portfolio. Candidate exits are known ex-post across original accepted transactions; changes to gross, re-entry and competing admission NOT modeled. In-sample parameter comparisons (split still post-selection). No LIVE orders.",
 "cost":out,"scenarios":TESTS},indent=2,default=str),encoding="utf8")
print("SAVED",report,report.stat().st_size,flush=True)
