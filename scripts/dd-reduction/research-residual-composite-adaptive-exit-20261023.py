#!/usr/bin/env python3
"""Composite alternative: asymmetric DOGE/AVAX exits and selective fallback half-risk.
2026-10-23 exploratory research, no live, no integrated full8."""
from __future__ import annotations
import importlib.util,collections,hashlib,json,bisect,datetime
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
s=importlib.util.spec_from_file_location("composite_instrument_exits",HERE/"research-residual-composite-frequency-20261023.py")
c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
m=c.m;h=c.high;OUT=REPO/"docs/research/results/residual-composite-20261023"
# Each scenario precommits entry primary plus at most two fallbacks; the main
# exit varies by symbol, preserving the best identified 30bps payout asymmetry.
CONFIG={
 "BASE_DOGE2P5_AVAX1P5":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",(),1.,"NONE"),
 "BASE_DOGE2P5_AVAX1P0":("TP2P5_SL3P0_6H","TP1P0_SL2P5_3H",(),1.,"NONE"),
 "BASE_DOGE_TIME_AVAX1P5":("TIME6H","TP1P5_SL3P0_6H",(),1.,"NONE"),
 "BASE_DOGE2P5_AVAXTIME":("TP2P5_SL3P0_6H","TIME6H",(),1.,"NONE"),
 "BASE_DOGE_TIME_AVAXTIME":("TIME6H","TIME6H",(),1.,"NONE"),
 "MIX_V_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("V",),.5,"NONE"),
 "MIX_V_QTR":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("V",),.25,"NONE"),
 "MIX_R_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("R",),.5,"NONE"),
 "MIX_R_QTR":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("R",),.25,"NONE"),
 "MIX_RV_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("V","R"),.5,"NONE"),
 "MIX_RV_QTR":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("V","R"),.25,"NONE"),
 "MIX_V_BTC24_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("V",),.5,"BTC24_NEG_1"),
 "MIX_R_BTC24_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("R",),.5,"BTC24_NEG_1"),
 "MIX_V_BTC6_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("V",),.5,"BTC6_NEG_0P5"),
 "MIX_R_BTC6_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("R",),.5,"BTC6_NEG_0P5"),
 "MIX_V_ASSET_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("V",),.5,"ASSET6_NEG_1"),
 "MIX_R_ASSET_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("R",),.5,"ASSET6_NEG_1"),
 "MIX_VR_ASSET_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("V","R"),.5,"ASSET6_NEG_1"),
 "MIX_R_F_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("R","F"),.5,"NONE"),
 "MIX_V_F_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("V","F"),.5,"NONE"),
 "MIX_V_L_HALF":("TP2P5_SL3P0_6H","TP1P5_SL3P0_6H",("V","L"),.5,"NONE"),
}
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 h.m.base.native.m.acquire_verified_h1()
 src,_=h.m.base.native.m.m.core.task8.legacy.bootstrap()
 datasets={}
 for sym in m.SYMS:
  datasets[sym]=c.build_symbol_events(src,sym,m.START,m.END)
 events={}
 for conf,args in CONFIG.items():
  dogeExit,avaxExit,fallback,size,gate=args
  out={}
  for cost in (10,30):
   proposals=[]
   for sym,(bars,times,routes,count) in datasets.items():
    for t,idx,feat in routes["B"]:
     proposals.append((t,0,0 if sym=="AVAXUSDT" else 1,sym,idx,"B","SHORT"))
    for rank,route in enumerate(fallback,start=1):
     side=h.RULES[c.P[route][0]][0]
     fn=c.FALLBACK_GATES[gate]
     for t,idx,feat in routes[route]:
      if fn is not None and not fn(feat,side):continue
      proposals.append((t,rank,0 if sym=="AVAXUSDT" else 1,sym,idx,route,side))
   proposals.sort()
   busy=-1;trades=[];suppressed=0
   for t,rank,symorder,sym,idx,route,side in proposals:
    if t<=busy:suppressed+=1;continue
    bars,times,*_=datasets[sym]
    key=(dogeExit if sym=="DOGEUSDT" else avaxExit) if rank==0 else c.P[route][1]
    row=m.simulate(bars,times,idx,side,h.EXIT_RULES[key],cost)
    if not row:continue
    scale=1 if rank==0 else size
    trades.append({**row,"symbol":sym,"route":route,"primary":rank==0,
      "size":scale,"sizedNetPct":row["netPct"]*scale,"sizedGrossPct":row["grossPct"]*scale})
    busy=row["exitTsMs"]
   out[str(cost)]={**c.partitions(trades),
     "primary":c.stats([x for x in trades if x["primary"]]),
     "fallback":c.stats([x for x in trades if not x["primary"]]),
     "bySymbol":{sym:c.stats([x for x in trades if x["symbol"]==sym]) for sym in m.SYMS},
     "suppressedByOccupancy":suppressed}
  assert out["10"]["all"]["n"]==out["30"]["all"]["n"]
  events[conf]=out
 result={"status":"RESEARCH_ONLY_ADAPTIVE_EXIT_COMPOSITE_NO_LIVE_NO_FULL8",
 "baseSHA":"8592a2d9394a6ac702d4c961e4231e14335a8b20",
 "details":"DOGE and AVAX bearish break preferred; symbol-specific exits; optional regime-filtered reduced-size fallback. One shared RESIDUAL slot and deterministic tie-break.",
 "period":"2025-08-10..2026-08-10 already researched, not untouched OOS",
 "costsBps":[10,30],"scenarioDefinition":CONFIG,"results":events,
 "warnings":["Win rate is not enough; tiny fallback lots artificially inflate trade count and can lower economic quality",
  "No integrated 8-logic capital admission, position sizing or portfolio MTM DD",
  "No venue funding/order book/L2/liquidation model; no truly unseen holdout"]}
 baseline=events["BASE_DOGE2P5_AVAX1P5"]
 accepted=[];ranks=[]
 for conf,r in events.items():
  a,b=r["10"],r["30"]
  x,y=a["all"],b["all"];later=b["later"]
  record={"case":conf,"n":x["n"],"nFallback":a["fallback"]["n"],
    "wr10":x["wr"],"wr30":y["wr"],"pf10":x["pf"],"pf30":y["pf"],
    "worstDD":min(x["closedDDPct"],y["closedDDPct"]),
    "30laterN":later["n"],"30laterWR":later["wr"],"30laterPF":later["pf"],
    "30fallbackPF":b["fallback"]["pf"]}
  ranks.append(record)
  # Balanced gate requires economically significant >=0.5x fallback and >=100 trades.
  if (x["n"]>=100 and a["fallback"]["n"]>=20 and
      all(q is not None and q>=1.2 for q in (x["pf"],y["pf"])) and
      record["worstDD"]>=-15 and later["n"]>=25 and
      (later["pf"] or 0)>=1.0 and
      (len(CONFIG[conf][2])==0 or CONFIG[conf][3]>=.5)):
   accepted.append(record)
 ranks.sort(key=lambda x:(x["pf30"] or 0,x["n"]),reverse=True)
 result["rankByCost30PF"]=ranks
 result["provisionalGatePasses"]=accepted
 lines=["# RESIDUAL composite with symbol-adaptive exits",
 "",
 "Research only, full8 NOT run. Composite uses bearish break first, then fallback routes when flat.",
 "No adding many tiny trades solely to boost trade count.",
 "",
 "|Case|Trades|Fallback trades|WR10|WR30|PF10|PF30|Worst Closed DD|Later PF30|",
 "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
 for z in ranks:
  fmt=lambda x:"—" if x is None else f"{x:.2f}"
  lines.append(f'|{z["case"]}|{z["n"]}|{z["nFallback"]}|{fmt(z["wr10"])}|{fmt(z["wr30"])}|{fmt(z["pf10"])}|{fmt(z["pf30"])}|{fmt(z["worstDD"])}|{fmt(z["30laterPF"])}|')
 lines+=["","Provisional balanced gate passes: "+str(accepted),
  "","These are standalone one-slot studies, not formal financial portfolio results.",
  "","DO NOT ADOPT OR DEPLOY TO LIVE.",""]
 p=OUT/"RESIDUAL_COMPOSITE_SYMBOL_ADAPTIVE_EXIT_20261023.json"
 p.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n","utf-8",newline="\n")
 (OUT/"RESIDUAL_COMPOSITE_SYMBOL_ADAPTIVE_EXIT_20261023.md").write_text("\n".join(lines),"utf-8",newline="\n")
 print("ADAPTIVE_BASELINE",baseline["10"]["all"],baseline["30"]["all"],flush=True)
 print("ADAPTIVE_RANK_TOP",ranks[:15],flush=True)
 print("ADAPTIVE_GATE_PASS",accepted,flush=True)
 print("DONE",p,flush=True)
if __name__=="__main__":main()
