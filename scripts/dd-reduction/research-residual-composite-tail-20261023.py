#!/usr/bin/env python3
"""Post-study tail for composite adaptive SHORT BREAK + regime-filtered AVAX fallback.
Not truly untouched OOS. Research-only, no production or orders."""
from __future__ import annotations
import bisect,datetime,importlib.util,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
spec=importlib.util.spec_from_file_location("comp_adaptive_tail",HERE/"research-residual-composite-adaptive-exit-20261023.py")
adaptive=importlib.util.module_from_spec(spec);spec.loader.exec_module(adaptive)
c=adaptive.c;m=c.m;high=c.high
UTC=datetime.timezone.utc
START=int(datetime.datetime(2026,8,10,tzinfo=UTC).timestamp()*1000)
END=int(datetime.datetime(2026,9,1,tzinfo=UTC).timestamp()*1000)
OUT=REPO/"docs/research/results/residual-composite-20261023"
CASES=("BASE_DOGE2P5_AVAX1P5","BASE_DOGE_TIME_AVAXTIME","MIX_V_BTC24_HALF","MIX_V_HALF","MIX_V_QTR")
def run(datasets,conf,cost):
 dogeExit,avaxExit,fallback,size,gate=adaptive.CONFIG[conf]
 proposals=[]
 for sym,(bars,times,routes,count) in datasets.items():
  for ts,i,f in routes["B"]:proposals.append((ts,0,0 if sym=="AVAXUSDT" else 1,sym,i,"B","SHORT"))
  for rank,route in enumerate(fallback,start=1):
   side=high.RULES[c.P[route][0]][0]
   flt=c.FALLBACK_GATES[gate]
   for t,i,f in routes[route]:
    if flt and not flt(f,side):continue
    proposals.append((t,rank,0 if sym=="AVAXUSDT" else 1,sym,i,route,side))
 proposals.sort();busy=-1;trades=[]
 for t,rank,symrank,sym,idx,route,side in proposals:
  if t<=busy:continue
  bars,times,*_=datasets[sym]
  rule=(dogeExit if sym=="DOGEUSDT" else avaxExit) if rank==0 else c.P[route][1]
  row=m.simulate(bars,times,idx,side,high.EXIT_RULES[rule],cost)
  if not row:continue
  f=1 if rank==0 else size
  trades.append({**row,"symbol":sym,"route":route,"primary":rank==0,"size":f,
    "sizedNetPct":row["netPct"]*f,"sizedGrossPct":row["grossPct"]*f})
  busy=row["exitTsMs"]
 return {"all":c.stats(trades),
  "byRoute":c.breakdown(trades),
  "primary":c.stats([x for x in trades if x["primary"]]),
  "fallback":c.stats([x for x in trades if not x["primary"]])}
def main():
 m.base.native.m.acquire_verified_h1()
 src,_=m.base.native.m.m.core.task8.legacy.bootstrap()
 old=m.END;m.END=END
 try:
  data={sym:c.build_symbol_events(src,sym,START,END) for sym in m.SYMS}
  assert all(z[-1]>=400 for z in data.values())
  result={"status":"RESEARCH_ONLY_22DAY_POST_STUDY_TAIL_NOT_PRISTINE_OOS",
    "dates":"2026-08-10 to 2026-09-01 (12-hour reservation at end)",
    "warnings":["22-day period is too short for high-confidence statistical decisions",
      "Source interval could have informed earlier research; not an untouched validation set",
      "No full8 capital reallocation/venue/basis/funding model, no LIVE changes"],
    "coverage":{sym:data[sym][-1] for sym in m.SYMS},"cases":{}}
  for conf in CASES:
   for cost in (10,30):
    res=run(data,conf,cost)
    result["cases"].setdefault(conf,{})[str(cost)]=res
   print("TAIL",conf, result["cases"][conf]["10"]["all"],result["cases"][conf]["30"]["all"],flush=True)
  OUT.mkdir(parents=True,exist_ok=True)
  p=OUT/"RESIDUAL_COMPOSITE_ADAPTIVE_TAIL_20261023.json"
  p.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf-8",newline="\n")
  print("TAIL_DONE",p,flush=True)
 finally:m.END=old
if __name__=="__main__":main()
