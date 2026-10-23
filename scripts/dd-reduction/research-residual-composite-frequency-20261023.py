#!/usr/bin/env python3
"""Research-only composite RESIDUAL: high-confidence priority plus fallback.
Inputs: frozen causal M5 entry rules / exit evaluator from previous pinned research.
No 8-logic replay, no actual leverage/margin/fees venue certification.
"""
from __future__ import annotations
import bisect,collections,datetime,hashlib,importlib.util,json,math,statistics
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
OUT=REPO/"docs/research/results/residual-composite-20261023"
sp=importlib.util.spec_from_file_location("residual_composite_source",HERE/"research-residual-highwin-entry-exit-20261023.py")
high=importlib.util.module_from_spec(sp);sp.loader.exec_module(high)
m=high.m;UTC=datetime.timezone.utc
START=m.START;END=m.END;SPLIT=m.SPLIT;M5=m.M5;H=m.H
Q=m.Q

# Label: fixed entry priority (first is strongest); each route has independent exit,
# fallback can be volume-restricted by a frozen causal BTC/asset regime rule.
P={
  "B":("SHORT_BEAR_BREAK","TP2P5_SL3P0_6H"),
  "B_TIGHT":("SHORT_BEAR_BREAK","TP1P0_SL2P5_3H"),
  "B_TIME":("SHORT_BEAR_BREAK","TIME6H"),
  "R":("SHORT_RELATIVE_ACCEL","TIME6H"),
  "R_2P5":("SHORT_RELATIVE_ACCEL","TP2P5_SL3P0_6H"),
  "F":("SHORT_BOUNCE_FAILURE","TIME6H"),
  "F_2P5":("SHORT_BOUNCE_FAILURE","TP2P5_SL3P0_6H"),
  "S":("SHORT_BEAR_RETEST","TIME6H"),
  "V":("SHORT_AVAX_WEAK","TIME6H"),
  "D":("SHORT_DOGE_VOL_FADE","TIME6H"),
  "L":("LONG_BTC_STABLE_PULLBACK","TIME6H"),
  "L_RR":("LONG_BTC_STABLE_PULLBACK","TP2P5_SL3P0_6H"),
  "A":("LONG_AVAX_BTC_STRONG","TIME6H"),
  "Q":("LONG_BREAKOUT_QUIET","TIME6H"),
}
ARCH={
 "BASE_B_ONLY":["B"],
 "BASE_B_TIME":["B_TIME"],
 "BASE_B_TIGHT":["B_TIGHT"],
 "B_PLUS_R":["B","R"],
 "B_PLUS_R25":["B","R_2P5"],
 "B_PLUS_F":["B","F"],
 "B_PLUS_F25":["B","F_2P5"],
 "B_PLUS_S":["B","S"],
 "B_PLUS_V":["B","V"],
 "B_PLUS_D":["B","D"],
 "B_PLUS_L":["B","L"],
 "B_PLUS_L_RR":["B","L_RR"],
 "B_PLUS_R_L":["B","R","L"],
 "B_PLUS_F_R":["B","F","R"],
 "B_PLUS_F_S":["B","F","S"],
 "B_PLUS_R_S":["B","R","S"],
 "B_PLUS_R_V_L":["B","R","V","L"],
 "B_PLUS_R_D_Q":["B","R","D","Q"],
 "B_PLUS_A":["B","A"],
 "B_PLUS_R_A":["B","R","A"],
 "B_TIGHT_PLUS_R":["B_TIGHT","R"],
 "B_TIGHT_PLUS_F":["B_TIGHT","F"],
 "B_TIME_PLUS_R":["B_TIME","R"],
 "B_TIME_PLUS_F":["B_TIME","F"],
}
# Ex ante fixed admission quality of fallback, not chosen on same observation outcome.
FALLBACK_GATES={
 "NONE":None,
 "BTC6_NEG_0P5":lambda f,side:f["btc6h"]<=-.5 if side=="SHORT" else f["btc6h"]>=.5,
 "BTC24_NEG_1":lambda f,side:f["btc24h"]<=-1 if side=="SHORT" else f["btc24h"]>=1,
 "ASSET6_NEG_1":lambda f,side:f["ret6h"]<=-1 if side=="SHORT" else f["ret6h"]>=1,
}
# Avoid explosion: combine only a selected wide and narrow subset with alternate gates.
GATED_ARCH=(
 "B_PLUS_R","B_PLUS_F","B_PLUS_S","B_PLUS_L","B_PLUS_R_L",
 "B_PLUS_F_R","B_PLUS_R_V_L","B_PLUS_R_D_Q")
SCENARIOS={k:{"routes":v,"fallbackGate":"NONE","fallbackSize":1.} for k,v in ARCH.items()}
for k in GATED_ARCH:
 for gate in ("BTC6_NEG_0P5","BTC24_NEG_1","ASSET6_NEG_1"):
  SCENARIOS[k+"__"+gate]={"routes":ARCH[k],"fallbackGate":gate,"fallbackSize":1.}
# Partial lot fallback, the property of a real risk budget, not historical 8-logic sizing.
for k in ("B_PLUS_R","B_PLUS_F","B_PLUS_R_L","B_PLUS_F_R","B_PLUS_R_V_L","B_PLUS_R_D_Q"):
 SCENARIOS[k+"__HALF_FALLBACK"]={"routes":ARCH[k],"fallbackGate":"NONE","fallbackSize":.5}

ALL_ROUTES=sorted(set(sum((v["routes"] for v in SCENARIOS.values()),[])))
def getbars(src,sym,begin,end):
 bars,times=src.getdata(sym)
 a=bisect.bisect_left(times,begin)
 b=min(bisect.bisect_left(times,end-12*H),len(times)-145)
 if b<=a:raise RuntimeError("NO_SOURCE_DATA")
 return bars,times,a,b

def build_symbol_events(src,sym,begin,end):
 bars,times,a,b=getbars(src,sym,begin,end)
 events={r:[] for r in ALL_ROUTES}
 decision_count=0
 for j in range(max(a,290),b):
  t=times[j]+M5
  if t%H or times[j+1]!=t:continue
  feat=m.features_for(sym,bars,times,j,src)
  if feat is None:continue
  decision_count+=1
  for route,(rule,ex) in P.items():
   if route not in events:continue
   side,pred=high.RULES[rule]
   if pred(feat,sym):events[route].append((t,j+1,feat))
 return bars,times,events,decision_count

def select(bars,times,events,settings,cost,term=None):
 # Merge all candidate routes and choose exactly 1 route at each decision.
 # Compound exits free symbol slot for later alternative route(s), never overlap.
 # If dual triggers arrive at same t, higher-route priority wins; all inputs <=t.
 end_limit=END if term is None else term
 old_end=m.END;m.END=end_limit
 try:
  priority={r:i for i,r in enumerate(settings["routes"])}
  proposals=[]
  for route in settings["routes"]:
   side=high.RULES[P[route][0]][0]
   for t,idx,feat in events.get(route,[]):
    isfallback=priority[route]>0
    filt=FALLBACK_GATES[settings["fallbackGate"]]
    if isfallback and filt and not filt(feat,side):continue
    proposals.append((t,priority[route],idx,route,side))
  proposals.sort(key=lambda x:(x[0],x[1],x[3]))
  trades=[];blocked_by_hold=0;tie=0;busy=-1;lastdecision=None
  for t,pri,idx,route,side in proposals:
   if t<=busy:blocked_by_hold+=1;continue
   if t==lastdecision:tie+=1;continue
   lastdecision=t
   rules=high.EXIT_RULES[P[route][1]]
   out=m.simulate(bars,times,idx,side,rules,cost)
   if out is None:continue
   size=1. if pri==0 else float(settings["fallbackSize"])
   x={**out,"route":route,"side":side,"symbol":None,"primary":pri==0,
      "size":size,"sizedNetPct":out["netPct"]*size,
      "sizedGrossPct":out["grossPct"]*size}
   trades.append(x);busy=out["exitTsMs"]
  return trades,{"filteredProposals":len(proposals),"blockedDuringHolding":blocked_by_hold,
    "sameDecisionPrioritySuppressed":tie}
 finally:m.END=old_end
def stats(rows):
 # Closed-trade serial account = one unit risk budget per symbol, simplified sizing.
 n=len(rows);w=sum(x["sizedNetPct"]>0 for x in rows)
 profits=sum(x["sizedNetPct"] for x in rows if x["sizedNetPct"]>0)
 losses=sum(x["sizedNetPct"] for x in rows if x["sizedNetPct"]<=0)
 equity=10000.;peak=equity;dd=0.
 for x in sorted(rows,key=lambda x:(x["exitTsMs"],x["entryTsMs"],x.get("symbol") or "")):
  equity*=1+x["sizedNetPct"]/100
  peak=max(peak,equity);dd=min(dd,100*(equity/peak-1))
 return {"n":n,"wins":w,"wr":100*w/n if n else None,
     "pf":profits/-losses if losses<0 else None,
     "returnSumPctPoints":profits+losses,
     "closedDDPct":dd,"compound10k":equity}
def breakdown(rows):
 d={}
 for route in sorted(set(x["route"] for x in rows)):
  subset=[x for x in rows if x["route"]==route]
  d[route]=stats(subset)
 return d
def partitions(rows):
 out={"all":stats(rows),
  "first":stats([r for r in rows if r["entryTsMs"]<SPLIT]),
  "later":stats([r for r in rows if r["entryTsMs"]>=SPLIT]),
  "quarters":{str(k+1):stats([r for r in rows if Q[k]<=r["entryTsMs"]<Q[k+1]]) for k in range(4)},
  "byRoute":breakdown(rows),
  "byRouteLater":breakdown([r for r in rows if r["entryTsMs"]>=SPLIT])}
 return out
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 high.m.base.native.m.acquire_verified_h1()
 src,_=high.m.base.native.m.m.core.task8.legacy.bootstrap()
 datasets={};result={"status":"RESEARCH_ONLY_COMPOSITE_NO_LIVE_NO_8LOGIC",
  "base":"8592a2d9394a6ac702d4c961e4231e14335a8b20",
  "period":"2025-08-10..2026-08-10; historic prior exploration, NOT untouched OOS",
  "source":"hourly confirmed M5 -> next M5 open, full 114048 bars per BTC/DOGE/AVAX",
  "costsBps":[10,30],
  "closedDdNotPortfolioMtm":True,
  "limitations":["No eight-logic dynamic capital/candidate ownership, leverage, margin, funding, venue quotes or shared risk",
    "Standalone one-symbol dynamic selection; full 8-strategy result not computed",
    "Fallback half-size is simplified independent unit-risk notion, NOT actual account sizing",
    "Rules predeclared but historical source was previously studied; selection bias",
    "Out-of-time latter half already involved in previous research; not true untouched holdout"],
  "routes":P,"cases":SCENARIOS,"coverage":{},"symbols":{},"sharedOneSlot":{}}
 for sym in m.SYMS:
  bars,times,events,n=build_symbol_events(src,sym,START,END)
  datasets[sym]=(bars,times,events)
  result["coverage"][sym]={"decisions":n,"routeSignals":{r:len(v) for r,v in events.items()}}
  for name,cfg in SCENARIOS.items():
   for cost in (10,30):
    rows,obs=select(bars,times,events,cfg,cost)
    assert all(x["exitTsMs"]<=END for x in rows)
    result["symbols"].setdefault(sym,{}).setdefault(name,{})[str(cost)]={
      **partitions(rows),"obs":obs,"primary":stats([x for x in rows if x["primary"]]),
      "fallback":stats([x for x in rows if not x["primary"]]),
      "fallbackLater":stats([x for x in rows if not x["primary"] and x["entryTsMs"]>=SPLIT])}
  print("SINGLE_SYMBOL_RESEARCH",sym,"SCENARIOS",len(SCENARIOS),"ROUTE_SIGS",
    result["coverage"][sym]["routeSignals"],flush=True)
 # Dual symbol shared one-slot simulation: reconstruct candidate snapshots, then
 # process chronological events across DOGE and AVAX. Priority break > fallback.
 # Conservative unique global trade slot. No leverage or 8-strategy ownership.
 for name,cfg in SCENARIOS.items():
  for cost in (10,30):
   pairs=[]
   for sym,(bars,times,events) in datasets.items():
    routepriority={r:i for i,r in enumerate(cfg["routes"])}
    for route in cfg["routes"]:
     side=high.RULES[P[route][0]][0]
     flt=FALLBACK_GATES[cfg["fallbackGate"]]
     for t,idx,f in events.get(route,[]):
      if routepriority[route]>0 and flt and not flt(f,side):continue
      # AVAX favored over DOGE only for tie breaking, not as claim of edge.
      pairs.append((t,routepriority[route],0 if sym=="AVAXUSDT" else 1,
        sym,idx,route,side))
   pairs.sort()
   busy=-1;trades=[];blocked=0
   for t,priority,tie_sym,sym,idx,route,side in pairs:
    if t<=busy:blocked+=1;continue
    bars,times,_=datasets[sym]
    ex=high.EXIT_RULES[P[route][1]]
    y=m.simulate(bars,times,idx,side,ex,cost)
    if not y:continue
    size=1. if priority==0 else cfg["fallbackSize"]
    trades.append({**y,"symbol":sym,"route":route,"primary":priority==0,
       "size":size,"sizedNetPct":y["netPct"]*size,"sizedGrossPct":y["grossPct"]*size})
    busy=y["exitTsMs"]
   result["sharedOneSlot"].setdefault(name,{})[str(cost)]={
     **partitions(trades),"blockedOtherSymbolAndHolding":blocked,
     "primary":stats([x for x in trades if x["primary"]]),
     "fallback":stats([x for x in trades if not x["primary"]]),
     "bySymbol":{s:stats([x for x in trades if x["symbol"]==s]) for s in m.SYMS}}
  a,b=result["sharedOneSlot"][name]["10"],result["sharedOneSlot"][name]["30"]
  assert a["all"]["n"]==b["all"]["n"] or cfg["routes"][0]=="B_TIGHT",name
 # Balanced Pareto frontier: find those not dominated in count, both-cost PF, closed DD.
 # No win-rate floor; protect throughput. Later PF is a robustness constraint.
 candidate=[]
 for name,costs in result["sharedOneSlot"].items():
  a,b=costs["10"],costs["30"]
  m10,m30=a["all"],b["all"];late=b["later"]
  n=min(m10["n"],m30["n"])
  pfb=min(m10["pf"] or 0,m30["pf"] or 0)
  dd=min(m10["closedDDPct"],m30["closedDDPct"])
  candidate.append({"name":name,"n":n,"wr10":m10["wr"],"wr30":m30["wr"],
    "pf10":m10["pf"],"pf30":m30["pf"],"pfMin":pfb,
    "ddWorst":dd,"laterN":late["n"],"laterWr30":late["wr"],
    "laterPf30":late["pf"],"fallbackN":a["fallback"]["n"],
    "primaryN":a["primary"]["n"]})
 frontier=[]
 for item in candidate:
  if not any(other is not item and other["n"]>=item["n"] and
        other["pfMin"]>=item["pfMin"] and other["ddWorst"]>=item["ddWorst"] and
        (other["n"]>item["n"] or other["pfMin"]>item["pfMin"] or
         other["ddWorst"]>item["ddWorst"]) for other in candidate):
   frontier.append(item)
 # Enough trades + not negative expectancy + tolerable closed DD.
 qualified=[c for c in candidate if
   c["n"]>=65 and c["pfMin"]>=1.2 and c["ddWorst"]>=-15 and
   c["laterN"]>=25 and (c["laterPf30"] or 0)>=1.0]
 result["paretoFrontier"]=sorted(frontier,key=lambda c:(-c["n"],-c["pfMin"]))
 result["researchGatePasses"]=qualified
 result["ranking"]=sorted(candidate,key=lambda c:(
      c["laterN"]>=25 and (c["laterPf30"] or 0)>=1 and c["pfMin"]>=1.2 and c["ddWorst"]>=-15,
      c["n"]>=65,c["pfMin"],c["n"]),reverse=True)
 baseline=result["sharedOneSlot"]["BASE_B_ONLY"]["10"]["all"]["n"]
 result["baselineSharedOnly10bpsN"]=baseline
 lines=["# RESIDUAL Composite LONG/SHORT Entry — research only",
 "",
 "Multi-route priority B: bearish breakout first, then bearish acceleration/retest/bounce or bullish pullback fallback.",
 "Same-symbol occupancy and optional dual-symbol shared one-slot enforced; fallback can be half lot.",
 "No eight-strategy integrated re-selection, no venue certification, and historic periods are NOT untouched OOS.",
 "",
 "## Shared-slot Pareto candidates",
 "|Case|10bps trades|Primary trades|Fallback trades|10bps WR|30bps WR|10bps PF|30bps PF|Worst closed DD|30bps later PF|",
 "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
 def p2(x):return "-" if x is None else f"{x:.2f}"
 def pct(x):return "-" if x is None else f"{x:.1f}%"
 for c in result["ranking"]:
  lines.append(f'|{c["name"]}|{c["n"]}|{c["primaryN"]}|{c["fallbackN"]}|{pct(c["wr10"])}|{pct(c["wr30"])}|{p2(c["pf10"])}|{p2(c["pf30"])}|{pct(c["ddWorst"])}|{p2(c["laterPf30"])}|')
 lines+=["","## Pareto frontier",str(result["paretoFrontier"]),
  "","## Balanced provisional gate results",str(qualified),
  "","**No automated adoption.** Any pass requires genuine unseen forward data and full-8 engine and owner parity before production.",
  "","## Notes",
  "- 10bps/30bps means synthetic round-trip cost only; excludes funding, venue liquidity, concurrent account positions and margin.",
  "- Model DD is closed trade equity, NOT 8-logics MTM DD.",
  "- Raw signal count includes rejected and overlapping proposals but is not current production candidate ownership.",
  "- Fallback adds trade count only where permitted; never filters existing strong signals.",
  "- Comparative scores are heavily selection biased; do not rely solely on same-year Pareto ranking.",""]
 path=OUT/"RESIDUAL_COMPOSITE_ENTRY_FREQUENCY_BALANCE_20261023.json"
 path.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n","utf-8",newline="\n")
 (OUT/"RESIDUAL_COMPOSITE_ENTRY_FREQUENCY_BALANCE_20261023.md").write_text("\n".join(lines),"utf-8",newline="\n")
 print("SHARED_ONLY_N",baseline,flush=True)
 print("PARETO",result["paretoFrontier"],flush=True)
 print("GATE_PASS",qualified,flush=True)
 for sym in m.SYMS:
  print("SYMBOL_COMPOSITE",sym,
        [(c,result["symbols"][sym][c]["10"]["all"]["n"],
          round(result["symbols"][sym][c]["10"]["all"]["wr"] or 0,1),
          round(result["symbols"][sym][c]["10"]["all"]["pf"] or 0,2),
          round(result["symbols"][sym][c]["30"]["all"]["pf"] or 0,2))
         for c in ("BASE_B_ONLY","B_PLUS_R","B_PLUS_F","B_PLUS_L","B_PLUS_R_L","B_PLUS_F_R")],flush=True)
 print("COMPOSITE_FINISHED",path,"SCENARIOS",len(SCENARIOS),flush=True)
if __name__=="__main__":main()
