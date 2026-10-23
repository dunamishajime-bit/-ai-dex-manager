#!/usr/bin/env python3
"""High-win-rate candidate discovery after residual-entry-exit-deep-20261023.
Full historical M5 causal opportunities, fixed-direction entrance first, then exit.
Research only: known historical periods, no new pristine OOS, funding or full-8 wallet."""
from __future__ import annotations
import collections,datetime,importlib.util,json,math,statistics,bisect,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
OUT=REPO/"docs/research/results/residual-highwin-20261023"
MODULE=HERE/"research-residual-stateful-entry-exit-20261023.py"
ss=importlib.util.spec_from_file_location("residual_highwin_source",MODULE)
m=importlib.util.module_from_spec(ss);ss.loader.exec_module(m)
M5=m.M5;H=m.H
END=m.END;START=m.START; SPLIT=m.SPLIT
RULES={
"LONG_BTC_RISE_RECLAIM":("LONG",lambda f,s:f["btc6h"]>0.5 and f["ret6h"]>0 and f["rel3h"]>0 and f["longEMA"] and f["reclaimEMA"] and 1.5<f["pullback_depth"]<7),
"LONG_BTC_UP_RETEST":("LONG",lambda f,s:f["btc6h"]>0.5 and f["ret3h"]>0 and f["rel3h"]>0 and f["longEMA"] and f["ret15"]>.2 and .5<f["back6"]<3 and f["ret1h"]<1),
"LONG_BTC_STABLE_PULLBACK":("LONG",lambda f,s:f["btc3h"]>.2 and f["btc6h"]>0 and f["ret6h"]>0 and f["rel6h"]>0 and 2<f["pullback_depth"]<7 and f["ret30"]>.1 and f["bounce1"]>.8),
"LONG_BREAKOUT_VOL":("LONG",lambda f,s:f["btc6h"]>0 and f["ret3h"]>1 and f["longEMA"] and f["volratio"]>1.4 and f["break30"] and 0<f["ret1h"]<2),
"LONG_BREAKOUT_QUIET":("LONG",lambda f,s:f["btc6h"]>.3 and f["ret6h"]>1.5 and f["rel6h"]>.5 and f["longEMA"] and f["volratio"]<1.5 and f["break30"] and f["ret1h"]<2),
"LONG_CAPITULATION_RECOVER":("LONG",lambda f,s:f["btc6h"]>-1 and f["ret6h"]<-3 and f["ret15"]>.2 and f["bounce1"]>.8 and f["back6"]>2 and f["volratio"]>1),
"LONG_CAPITULATION_RECLAIM":("LONG",lambda f,s:f["btc3h"]>=0 and f["ret3h"]<-1.5 and f["ret15"]>.15 and f["reclaimEMA"] and f["bounce1"]>.6),
"LONG_RELATIVE_REVERSAL":("LONG",lambda f,s:f["btc6h"]>0 and f["ret6h"]<0 and f["rel3h"]>.8 and f["ret30"]>.15 and f["reclaimEMA"]),
"LONG_RANGEBOTTOM_BTC_UP":("LONG",lambda f,s:f["btc6h"]>.5 and f["ret3h"]<0 and f["rangepos3h"]<.3 and f["ret15"]>.1 and f["bounce1"]>.5),
"LONG_RANGEBOTTOM_FLAT":("LONG",lambda f,s:abs(f["btc6h"])<.7 and f["ret3h"]<-2 and f["rangepos3h"]<.35 and f["ret15"]>.1 and f["bounce1"]>.3),
"LONG_RS_BURST_COOL":("LONG",lambda f,s:f["btc6h"]>0 and f["rel6h"]>2 and f["ret6h"]>1 and f["volratio"]<1.1 and f["longEMA"] and f["ret15"]>0 and .5<f["back6"]<4),
"LONG_VOL_CLIMAX_HOLD":("LONG",lambda f,s:f["btc6h"]>0 and f["ret6h"]>0 and f["volumeClimax"]>2.5 and f["volumeRelax"]<.7 and f["longEMA"] and f["ret30"]>.1),
"LONG_AVAX_BTC_STRONG":("LONG",lambda f,s:s=="AVAXUSDT" and f["btc6h"]>1 and f["ret6h"]>1 and f["rel6h"]>0 and f["ret1h"]<1 and f["ret15"]>.15 and f["longEMA"]),
"LONG_DOGE_DIP_BULL":("LONG",lambda f,s:s=="DOGEUSDT" and f["btc3h"]>.3 and f["ret6h"]>1 and f["rel3h"]>0 and f["pullback_depth"]>3 and f["bounce1"]>1 and f["ret15"]>.1),
"LONG_MEANREVERT_SHOCK":("LONG",lambda f,s:f["ret3h"]<-3 and f["ret15"]>.3 and f["bounce1"]>1.2 and f["btc6h"]>-2 and f["volratio"]>=1.1),
"LONG_REGIME_RECOVER":("LONG",lambda f,s:f["btc24h"]>1 and f["btc6h"]>0 and f["ret3h"]<0 and f["ret15"]>.2 and f["rel24h"]>0 and f["bounce1"]>.5),
"SHORT_BEAR_RETEST":("SHORT",lambda f,s:f["btc6h"]<-.5 and f["ret6h"]<-1 and f["rel6h"]<-.3 and f["shortEMA"] and f["ret30"]<0 and f["shortbounce"]>1),
"SHORT_BEAR_BREAK":("SHORT",lambda f,s:f["btc6h"]<-.5 and f["ret6h"]<-1 and f["rel3h"]<0 and f["shortEMA"] and f["shortbreak30"] and f["volratio"]>1),
"SHORT_BEAR_VOLUME":("SHORT",lambda f,s:f["btc6h"]<0 and f["ret6h"]<-1 and f["volratio"]>2 and f["shortEMA"] and f["ret15"]<0),
"SHORT_BEAR_REJECT":("SHORT",lambda f,s:f["btc3h"]<-.3 and f["ret3h"]<0 and f["rel3h"]<0 and f["shortEMA"] and f["ret15"]<-.2 and f["short_high_distance"]>.7),
"SHORT_RALLY_FADE":("SHORT",lambda f,s:f["btc6h"]<-1 and f["ret3h"]>0 and f["rel3h"]<0 and f["ret15"]<-.1 and f["shortEMA"]),
"SHORT_BOUNCE_FAILURE":("SHORT",lambda f,s:f["btc6h"]<-.5 and f["ret6h"]<-2 and f["ret30"]<-.2 and f["shortbounce"]>2 and f["short_high_distance"]>1 and f["shortEMA"]),
"SHORT_RELATIVE_ACCEL":("SHORT",lambda f,s:f["btc6h"]<0 and f["rel3h"]<-1.5 and f["ret3h"]<-1 and f["shortEMA"] and f["ret15"]<-.1),
"SHORT_RANGETOP_FLAT":("SHORT",lambda f,s:abs(f["btc6h"])<.7 and f["ret3h"]>2 and f["rangepos3h"]>.65 and f["ret15"]<-.15),
"SHORT_AVAX_WEAK":("SHORT",lambda f,s:s=="AVAXUSDT" and f["btc6h"]<-.5 and f["rel6h"]<-1 and f["ret6h"]<-2 and f["shortEMA"] and f["ret15"]<0),
"SHORT_DOGE_VOL_FADE":("SHORT",lambda f,s:s=="DOGEUSDT" and f["btc6h"]<0 and f["ret6h"]<0 and f["volumeClimax"]>2 and f["volumeRelax"]<.8 and f["shortEMA"] and f["ret15"]<0),
"SHORT_BTC_LOSS_RETEST":("SHORT",lambda f,s:f["btc24h"]<-1 and f["btc6h"]<0 and f["ret6h"]<-1 and f["ret30"]<0 and f["shortbounce"]>1 and f["short_high_distance"]>.5),
}
# Prespecified, examined only after entries. RR and reward/cost consistency are evaluated.
EXIT_RULES={
 "TIME3H":{"hold":3,"stop":10,"take":25},
 "TIME6H":{"hold":6,"stop":10,"take":25},
 "TIME12H":{"hold":12,"stop":10,"take":25},
 "TP1P0_SL2P5_3H":{"hold":3,"stop":2.5,"take":1},
 "TP1P5_SL2P5_4H":{"hold":4,"stop":2.5,"take":1.5},
 "TP1P5_SL3P0_6H":{"hold":6,"stop":3,"take":1.5},
 "TP2P0_SL3P0_6H":{"hold":6,"stop":3,"take":2},
 "TP2P0_SL4P0_12H":{"hold":12,"stop":4,"take":2},
 "TP2P5_SL3P0_6H":{"hold":6,"stop":3,"take":2.5},
 "TP3P0_SL4P0_12H":{"hold":12,"stop":4,"take":3},
 "TP3P5_SL4P0_12H":{"hold":12,"stop":4,"take":3.5},
 "TP1P5_SL2P0_3H":{"hold":3,"stop":2,"take":1.5},
}
def simple_stat(rows):
 a=m.stats(rows)
 return a
def eval_case(bars,times,signals,side,policy,cost):
 events=m.allocate(signals,bars,times,side,policy,cost)
 return {"all":simple_stat(events),
   "first":simple_stat([x for x in events if x["entryTsMs"]<SPLIT]),
   "later":simple_stat([x for x in events if x["entryTsMs"]>=SPLIT]),
   "q":[simple_stat([x for x in events if m.quarter(x["entryTsMs"])=="Q"+str(i)]) for i in (1,2,3,4)]}
def rank(cohort):
 # Predeclared entry quality ordering emphasizing first-half win rate and RR discipline.
 s=cohort["10"]["first"];t=cohort["30"]["first"]
 if s["n"]<24:return -1e8
 return (min(s["wr"] or 0,t["wr"] or 0)
       +min(s["pf"] or 0,3)*4 + min(s["wilson95LowerWR"] or 0,80)*.15
       +min(s["n"],100)*.02)
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 m.base.native.m.acquire_verified_h1()
 src,_=m.base.native.m.m.core.task8.legacy.bootstrap()
 out={"status":"RESEARCH_ONLY_NO_LIVE_NO_FULL8","startingCommit":"df4fec184cf33de5a38acf3e50e044e08ea96fe8",
     "sample":"2025-08-10..2026-08-10; historical previously explored, later half NOT untouched OOS",
     "costsBps":[10,30],"maxDrawdownType":"closed-trade independent one-symbol equity only",
     "note":"Selection on earlier-half summary only. No retroactive changes to entry rules after reading later-half results.",
     "limitations":["No live venue orderbook, margin, funding, 8-way capital ownership or shared risk",
        "Multiple candidate and exit comparisons in historical data cause selection bias",
        "Small-sample 70% does not imply a well-calibrated stable 70% trade probability"],
     "entryRules":{k:v[0] for k,v in RULES.items()},"exitRules":EXIT_RULES,
     "coverage":{},"fixedEntryResearch":{},"separateExitStudy":{}}
 ranking={}
 for sym in m.SYMS:
  bars,times=src.getdata(sym)
  assert len(bars)==114048 and all(times[i+1]-times[i]==M5 for i in range(len(times)-1))
  a=bisect.bisect_left(times,START);b=bisect.bisect_left(times,END)
  signals={name:[] for name in RULES}
  decisions=0
  for j in range(max(290,a),b-146):
   decision=times[j]+M5
   if decision%H or times[j+1]!=decision:continue
   f=m.features_for(sym,bars,times,j,src)
   if f is None:continue
   decisions+=1
   for name,(side,pred) in RULES.items():
    if pred(f,sym):signals[name].append((j+1,decision))
  out["coverage"][sym]={"hourly":decisions,"candidateSignals":{k:len(s) for k,s in signals.items()}}
  print("RULES_SCREENED",sym,decisions,flush=True)
  for name,(side,pred) in RULES.items():
   result={}
   for cost in (10,30):
    result[str(cost)]=eval_case(bars,times,signals[name],side,EXIT_RULES["TIME6H"],cost)
   q=result
   assert q["10"]["all"]["n"]==q["30"]["all"]["n"]
   out["fixedEntryResearch"].setdefault(sym,{})[name]={
       "side":side,"rawSignals":len(signals[name]),"basis":"6h time exit 10% emergency stop",
       "costs":q}
  ranking[sym]=sorted(RULES,key=lambda n:rank(out["fixedEntryResearch"][sym][n]["costs"]),reverse=True)
  chosen=[]
  # Precedent: strongest by 1st half win rate if n>=24; two per side.
  for side in ("LONG","SHORT"):
   sel=[name for name in ranking[sym] if RULES[name][0]==side and
        out["fixedEntryResearch"][sym][name]["costs"]["10"]["first"]["n"]>=24][:2]
   chosen.extend(sel)
  out["exitSelectionFirstHalfOnly"]=out.get("exitSelectionFirstHalfOnly",{})
  out["exitSelectionFirstHalfOnly"][sym]=chosen
  print("TOP_ENTRY_BY_FIRST_HALF",sym,chosen,[(n,round(rank(out["fixedEntryResearch"][sym][n]["costs"]),2)) for n in chosen],flush=True)
  for name in chosen:
   res={}
   side=RULES[name][0]
   for label,rule in EXIT_RULES.items():
    c={}
    for cost in (10,30):
     c[str(cost)]=eval_case(bars,times,signals[name],side,rule,cost)
    res[label]=c
   out["separateExitStudy"].setdefault(sym,{})[name]=res
   print("EXITS_DONE",sym,name,flush=True)
  print("FULL_ENTRY_DONE",sym,flush=True)
 # Evaluate jointly without searching manually until after all runs.
 joint=[]
 for sym,symbolCases in out["separateExitStudy"].items():
  for name,cases in symbolCases.items():
   for label,c in cases.items():
    a=c["10"]["all"];b=c["30"]["all"];ta=c["10"]["later"];tb=c["30"]["later"]
    if a["n"]<40 or ta["n"]<20 or tb["n"]<20:continue
    if all(r["wr"] is not None and r["wr"]>=70 and r["pf"] is not None and r["pf"]>=1.2
           for r in (a,b,ta,tb)) and a["closedDDPct"]>=-15 and b["closedDDPct"]>=-15:
     joint.append({"symbol":sym,"entry":name,"exit":label})
 out["exploratoryQualificationOnly"]=joint
 textlines=["# RESIDUAL high-win-rate study 2026-10-23",
 "",
 "This study deliberately evaluates entry with identical 6h hold, then compares exit policies on first-half-selected entry cohorts.",
 "Historical data already informed prior research; the later half is NOT a pristine OOS.",
 "All results are independent one-symbol studies, NOT integrated full-8 performance or a LIVE authorization.",
 "",
 "## Entry-only comparison: fixed 6h exit and 10% emergency stop",
 "|Symbol|Rule|Side|Proposals|Trades|First WR|Later WR|10bps WR|10bps PF|30bps WR|30bps PF|10bps Closed DD|",
 "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
 def pct(x):return "-" if x is None else f"{x:.1f}%"
 def pf(x):return "-" if x is None else f"{x:.3f}"
 for sym in m.SYMS:
  for name in ranking[sym]:
   c=out["fixedEntryResearch"][sym][name];t=c["costs"]
   a=t["10"]["all"];b=t["30"]["all"];f=t["10"]["first"];l=t["10"]["later"]
   textlines.append(f'|{sym}|{name}|{c["side"]}|{c["rawSignals"]}|{a["n"]}|{pct(f["wr"])}|{pct(l["wr"])}|{pct(a["wr"])}|{pf(a["pf"])}|{pct(b["wr"])}|{pf(b["pf"])}|{pct(a["closedDDPct"])}|')
 textlines+=["","## Entry then exit: first-half-ranked cohort only",
 "|Symbol|Entry|Exit|10bps Trades|10bps WR|10bps PF|30bps WR|30bps PF|Later WR (10bps)|Later PF (10bps)|10bps Closed DD|",
 "|---|---|---|---:|---:|---:|---:|---:|---:|---:|"]
 for sym,cases in out["separateExitStudy"].items():
  for name,sub in cases.items():
   for label,c in sorted(sub.items(),key=lambda x:x[1]["10"]["all"]["wr"] or 0,reverse=True):
    a=c["10"]["all"];b=c["30"]["all"];late=c["10"]["later"]
    textlines.append(f'|{sym}|{name}|{label}|{a["n"]}|{pct(a["wr"])}|{pf(a["pf"])}|{pct(b["wr"])}|{pf(b["pf"])}|{pct(late["wr"])}|{pf(late["pf"])}|{pct(a["closedDDPct"])}|')
 textlines+=["",f"## Exploratory qualification: {joint}","",
 "A pass here is not an adoption decision: independent candidate generation, lookahead-safe replay and true untouched OOS/forward samples are required.",
 "NO LIVE CHANGES.",""]
 p=OUT/"RESIDUAL_HIGHWIN_ENTRY_EXIT_RESEARCH_20261023.json"
 p.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8",newline="\n")
 (OUT/"RESIDUAL_HIGHWIN_ENTRY_EXIT_RESEARCH_20261023.md").write_text("\n".join(textlines),encoding="utf-8",newline="\n")
 for sym in m.SYMS:
  print("ENTRY_RANKING",sym,[(name, out["fixedEntryResearch"][sym][name]["costs"]["10"]["all"]["n"],round(out["fixedEntryResearch"][sym][name]["costs"]["10"]["all"]["wr"] or 0,1),round(out["fixedEntryResearch"][sym][name]["costs"]["10"]["later"]["wr"] or 0,1),round(out["fixedEntryResearch"][sym][name]["costs"]["30"]["all"]["pf"] or 0,2)) for name in ranking[sym][:10]],flush=True)
 for sym,cc in out["separateExitStudy"].items():
  for en,rs in cc.items():
   print("WINRATE_EXIT",sym,en,sorted([(name,a["10"]["all"]["n"],round(a["10"]["all"]["wr"] or 0,2),round(a["10"]["all"]["pf"] or 0,3),round(a["30"]["all"]["wr"] or 0,2),round(a["30"]["all"]["pf"] or 0,3),round(a["10"]["later"]["wr"] or 0,2)) for name,a in rs.items()],key=lambda x:x[2],reverse=True)[:5],flush=True)
 print("HIGHWIN_COMPLETED",str(p),"QUALIFY",joint,flush=True)
if __name__=="__main__": main()