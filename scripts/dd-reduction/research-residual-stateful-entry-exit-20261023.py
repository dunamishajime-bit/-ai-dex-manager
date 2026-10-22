#!/usr/bin/env python3
"""2026-10-23 independent, causal RESIDUAL entry->exit research.
Research-only: no LIVE orders, production changes, funding, venue quotes, or 8-way capital admission.
Historical windows are previously studied; these are NOT untouched out-of-sample tests.
"""
from __future__ import annotations
import bisect,csv,datetime,hashlib,importlib.util,json,math,statistics,collections
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
OUT=REPO/"docs/research/results/residual-entry-exit-deep-20261023"
SOURCE=HERE/"simulate-residual-new-multifactor-hourly-long-20261023.py"
sp=importlib.util.spec_from_file_location("residual_deep_reuse_source",SOURCE)
base=importlib.util.module_from_spec(sp)
sp.loader.exec_module(base)
M5=300000
H=3600000
START=base.START
END=base.END
SPLIT=base.SPLIT
Q=[START,int(datetime.datetime(2025,11,10,tzinfo=datetime.timezone.utc).timestamp()*1000),
   SPLIT,int(datetime.datetime(2026,5,10,tzinfo=datetime.timezone.utc).timestamp()*1000),END]
SYMS=("DOGEUSDT","AVAXUSDT")

ENTRY_NAMES=(
    "ORIGINAL_REL_VOL","PB_RECOVER_BTC","PB_REL_LEAD","PB_EMA_RECLAIM",
    "PB_CLIMAX_RECOVERY","PB_RANGE_REVERSAL","PB_BREAK_RETEST",
    "AVAX_TREND_RECOVER","AVAX_VOL_REBOUND","AVAX_LEADER_RESET",
    "SHORT_BOUNCE_REJECT","SHORT_RETEST_FAIL","SHORT_DOWN_RESUME",
)
SHORT_NAMES=frozenset(("SHORT_BOUNCE_REJECT","SHORT_RETEST_FAIL","SHORT_DOWN_RESUME"))
EXIT_CASES={
 "ORIGINAL_12H":{"hold":12,"stop":10,"take":25},
 "HARD_STOP_5":{"hold":12,"stop":5,"take":25},
 "HARD_STOP_7":{"hold":12,"stop":7,"take":25},
 "TIME_6H":{"hold":6,"stop":10,"take":25},
 "TIME_18H":{"hold":18,"stop":10,"take":25},
 "EARLY_1H_NEG2":{"hold":12,"stop":10,"take":25,"earlyH":1,"earlyPct":2,"maxMfe":1},
 "EARLY_2H_NEG2":{"hold":12,"stop":10,"take":25,"earlyH":2,"earlyPct":2,"maxMfe":1},
 "EARLY_2H_NEG3":{"hold":12,"stop":10,"take":25,"earlyH":2,"earlyPct":3,"maxMfe":1},
 "PROFIT_ARM2_FLOOR05":{"hold":12,"stop":10,"take":25,"arm":2,"floor":.5},
 "PROFIT_ARM3_FLOOR1":{"hold":12,"stop":10,"take":25,"arm":3,"floor":1},
 "TRAIL_ARM3_GIVE15":{"hold":12,"stop":10,"take":25,"trailArm":3,"give":1.5},
 "COMBO_1H2_P3_F1":{"hold":12,"stop":10,"take":25,"earlyH":1,"earlyPct":2,"maxMfe":1,"arm":3,"floor":1},
 "COMBO_2H3_P3_F1":{"hold":12,"stop":10,"take":25,"earlyH":2,"earlyPct":3,"maxMfe":1,"arm":3,"floor":1},
}
def valid(x):
 try:return math.isfinite(float(x))
 except (TypeError,ValueError):return False
def ema(cs,period):
 alpha=2/(period+1);a=float(cs[0])
 for x in cs[1:]:a+=alpha*(float(x)-a)
 return a
def features_for(sym,bars,times,j,src):
 decision=times[j]+M5
 f=base.features.get_feat(src,sym,decision)
 if not f or not all(valid(f.get(k)) for k in ("btc6h","btc3h","ret6h","ret3h","rel3h","rel6h","rel24h","atr3h","volratio")):return None
 close=float(bars[j][4])
 if close<=0:return None
 high6=max(float(b[2]) for b in bars[j-72:j+1])
 low6=min(float(b[3]) for b in bars[j-72:j+1])
 low1=min(float(b[3]) for b in bars[j-12:j+1])
 high1=max(float(b[2]) for b in bars[j-12:j+1])
 low3=min(float(b[3]) for b in bars[j-36:j+1])
 cs=[float(b[4]) for b in bars[j-48:j+1]]
 ema12=ema(cs,12);ema36=ema(cs,36)
 e12prev=ema(cs[:-6],12)
 ret15=100*(close/float(bars[j-3][4])-1)
 ret30=100*(close/float(bars[j-6][4])-1)
 if not all(valid(x) for x in (high6,low6,low1,high1,low3,ema12,ema36,ret15,ret30)):return None
 # Earlier completed 1h volume bursts (no future bars).
 last1=sum(float(b[5]) for b in bars[j-11:j+1])
 prev_hour_volumes=[sum(float(b[5]) for b in bars[k-11:k+1])
                    for k in range(j-72,j-12,12)]
 volnorm=statistics.median(prev_hour_volumes) if prev_hour_volumes else 0.
 volclimax=max(prev_hour_volumes)/volnorm if volnorm>0 else 0
 vrelax=last1/max(prev_hour_volumes) if prev_hour_volumes and max(prev_hour_volumes)>0 else 0
 ret1h=100*(close/float(bars[j-12][4])-1)
 recovered_high3=100*(close/low3-1)
 back6=100*(high6-close)/high6
 bounce1=100*(close/low1-1)
 pullback_depth=100*(high6-low1)/high6
 shortbounce=100*(high1/low6-1)
 short_high_distance=100*(high1-close)/high1
 return dict(f,ret15=ret15,ret30=ret30,ret1h=ret1h,
  price=close,ema12=ema12,ema36=ema36,ema12prev=e12prev,
  high6=high6,low6=low6,low1=low1,high1=high1,
  pullback_depth=pullback_depth,back6=back6,bounce1=bounce1,
  recovered_high3=recovered_high3,shortbounce=shortbounce,
  short_high_distance=short_high_distance,volumeClimax=volclimax,
  volumeRelax=vrelax,break30=(close>max(float(b[2]) for b in bars[j-6:j])),
  shortbreak30=(close<min(float(b[3]) for b in bars[j-6:j])),
  reclaimEMA=(float(bars[j-6][4])<=e12prev and close>ema12),
  belowEMA=(close<ema12),longEMA=(ema12>ema36),shortEMA=(ema12<ema36),
 )
def allows(name,sym,f):
 if name=="ORIGINAL_REL_VOL":
  return (f["rel24h"]>=3 and f["volratio"] >= (1.2 if sym=="DOGEUSDT" else .8) and f["atr3h"]>=.7)
 if name=="PB_RECOVER_BTC":
  return f["btc6h"]>0 and f["ret30"]>0 and f["ret15"]>0 and 1.5<=f["pullback_depth"]<=7 and f["bounce1"]>=.6 and f["rel3h"]>-1 and f["back6"]>=.4 and f["longEMA"]
 if name=="PB_REL_LEAD":
  return f["btc6h"]>0 and f["rel3h"]>.5 and f["ret6h"]>0 and 2<=f["pullback_depth"]<=8 and f["bounce1"]>=.8 and f["ret30"]>.15 and f["back6"]>=.4
 if name=="PB_EMA_RECLAIM":
  return f["btc6h"]>0 and f["rel6h"]>=0 and 1.2<=f["pullback_depth"]<=7 and f["reclaimEMA"] and f["ret15"]>0 and f["bounce1"]>=.5
 if name=="PB_CLIMAX_RECOVERY":
  return f["btc6h"]>0 and f["ret6h"]>0 and f["volumeClimax"]>1.8 and f["volumeRelax"]<.8 and 2<=f["pullback_depth"]<=9 and f["ret30"]>0 and f["longEMA"] and f["back6"]>=.6
 if name=="PB_RANGE_REVERSAL":
  return f["btc6h"]>-.5 and f["ret3h"]>-1 and f["rel3h"]>0 and 2<=f["pullback_depth"]<=8 and f["bounce1"]>=1 and f["ret15"]>.2 and f["back6"]>=1
 if name=="PB_BREAK_RETEST":
  return f["btc6h"]>0 and f["rel3h"]>0 and 1.5<=f["pullback_depth"]<=8 and f["break30"] and f["ret1h"]<2.5 and f["back6"]>.25 and f["longEMA"]
 if name=="AVAX_TREND_RECOVER":
  return sym=="AVAXUSDT" and f["btc6h"]>0 and f["btc3h"]>0 and f["ret6h"]>0 and f["rel3h"]>=0 and 1<=f["pullback_depth"]<=6 and f["ret30"]>.1 and f["longEMA"] and f["back6"]>=.2
 if name=="AVAX_VOL_REBOUND":
  return sym=="AVAXUSDT" and f["btc6h"]>0 and f["ret3h"]>0 and f["volratio"]>=1.2 and 2<=f["pullback_depth"]<=8 and f["bounce1"]>=1 and f["ret15"]>.15 and f["back6"]>=.5
 if name=="AVAX_LEADER_RESET":
  return sym=="AVAXUSDT" and f["btc6h"]>0 and f["rel6h"]>1 and f["ret6h"]>1 and 1.5<=f["pullback_depth"]<=8 and f["bounce1"]>.5 and f["ret30"]>0 and f["reclaimEMA"]
 if name=="SHORT_BOUNCE_REJECT":
  return f["btc6h"]<0 and f["ret6h"]<-.5 and f["rel3h"]<0 and .8<=f["shortbounce"]<=7 and f["ret15"]<-.15 and f["short_high_distance"]>.35 and f["belowEMA"]
 if name=="SHORT_RETEST_FAIL":
  return f["btc6h"]<0 and f["ret6h"]<0 and f["rel6h"]<-.5 and f["shortEMA"] and .7<=f["shortbounce"]<=6 and f["ret30"]<0 and f["shortbreak30"]
 if name=="SHORT_DOWN_RESUME":
  return f["btc3h"]<0 and f["ret3h"]<0 and f["rel3h"]<0 and f["shortEMA"] and f["ret15"]<-.1 and f["shortbounce"]>=1.2 and f["short_high_distance"]>=.6 and f["volratio"]>=.8
 raise KeyError(name)

def simulate(bars,times,idx,side,rules,cost):
 entry=float(bars[idx][1]);t0=times[idx]
 assert entry>0 and t0<END
 nmax=int(rules["hold"]*12)
 if idx+nmax>=len(bars):return None
 side_n=1 if side=="LONG" else -1
 stop=float(rules["stop"]);take=float(rules["take"])
 # Raw favorable/adverse excursions and relative high watermark are price-based, not wallet returns.
 maxf=0.;maxa=0.;maxf_before=0.
 armed=False; trail_armed=False
 limit=idx+nmax
 why="TIME"+str(rules["hold"])+"H"
 exitpx=float(bars[limit][1]);exitts=times[limit]
 for j in range(idx,limit):
  ts,op,hi,lo,cl,_=bars[j]
  if j>idx and ts!=times[j-1]+M5:raise AssertionError("CANDLE_GAP")
  highR=(float(hi)/entry-1)*100;lowR=(float(lo)/entry-1)*100
  favorable=max(highR,0) if side_n==1 else max(-lowR,0)
  adverse=min(lowR,0) if side_n==1 else min(-highR,0)
  maxf=max(maxf,favorable);maxa=min(maxa,adverse)
  # Intrabar protective STOP takes precedence over TP if both hit the same candle.
  if side_n==1:
   stopprice=entry*(1-stop/100)
   takeprice=entry*(1+take/100)
   if float(lo)<=stopprice:
    exitpx=min(float(op),stopprice);exitts=ts+M5;why="HARD_STOP";break
   if float(hi)>=takeprice:
    exitpx=takeprice;exitts=ts+M5;why="TAKE_PROFIT";break
  else:
   stopprice=entry*(1+stop/100)
   takeprice=entry*(1-take/100)
   if float(hi)>=stopprice:
    exitpx=max(float(op),stopprice);exitts=ts+M5;why="HARD_STOP";break
   if float(lo)<=takeprice:
    exitpx=takeprice;exitts=ts+M5;why="TAKE_PROFIT";break
  if j+1>=len(bars) or times[j+1]!=ts+M5:raise AssertionError("NEXT_OPEN_NOT_AVAILABLE")
  nextpx=float(bars[j+1][1])
  closeR=side_n*100*(float(cl)/entry-1)
  adverseLow=lowR if side_n==1 else -highR
  # Prior-bar arming ensures no high-then-low assumption inside one unresolved candle.
  if armed and adverseLow<=rules.get("floor",-100000):
   exitpx=nextpx;exitts=ts+M5;why="PROFIT_FLOOR_NEXT_OPEN";break
  if trail_armed and maxf_before>=rules["trailArm"] and maxf_before-adverseLow>=rules["give"]:
   exitpx=nextpx;exitts=ts+M5;why="TRAIL_NEXT_OPEN";break
  if ("earlyH" in rules and ts+M5>=t0+rules["earlyH"]*H
      and closeR <= -rules["earlyPct"] and maxf<rules.get("maxMfe",100)):
   exitpx=nextpx;exitts=ts+M5;why="EARLY_LOSS_NEXT_OPEN";break
  if "arm" in rules and closeR>=rules["arm"]:
   armed=True
  if "trailArm" in rules and closeR>=rules["trailArm"]:
   trail_armed=True
  maxf_before=maxf
 grosspct=side_n*100*(exitpx/entry-1)
 net=grosspct-cost/100
 return {"entryTsMs":t0,"exitTsMs":int(exitts),"grossPct":grosspct,"netPct":net,
  "entry":entry,"exit":exitpx,"reason":why,"mfePct":maxf,"maePct":maxa}
def allocate(signals,bars,times,side,rule,cost):
 accepted=[];busy=-1
 for idx,t in signals:
  if t<=busy:continue
  r=simulate(bars,times,idx,side,rule,cost)
  if r is None:continue
  accepted.append(r);busy=r["exitTsMs"]
 return accepted
def quarter(ts):
 for i in range(4):
  if Q[i]<=ts<Q[i+1]:return "Q"+str(i+1)
 return None
def stats(events):
 events=sorted(events,key=lambda x:(x["exitTsMs"],x["entryTsMs"]))
 n=len(events);wins=sum(x["netPct"]>0 for x in events)
 profit=sum(x["netPct"] for x in events if x["netPct"]>0)
 loss=sum(x["netPct"] for x in events if x["netPct"]<=0)
 equity=10000.;peak=equity;dd=0.
 for e in events:
  equity*=1+e["netPct"]/100
  peak=max(peak,equity);dd=min(dd,100*(equity/peak-1))
 # Wilson confidence interval lower bound, informative for small N.
 z=1.96
 p=wins/n if n else 0
 wilson=(p+z*z/(2*n)-z*math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n) if n else None
 return {"n":n,"wins":wins,"wr":100*wins/n if n else None,
  "pf":profit/(-loss) if loss<0 else None,"sumNetPctPts":profit+loss,
  "compound10k":equity,"closedDDPct":dd,"wilson95LowerWR":100*wilson if wilson is not None else None,
  "avgMfePct":statistics.mean(e["mfePct"] for e in events) if n else None,
  "avgMaePct":statistics.mean(e["maePct"] for e in events) if n else None}
def by_period(events):
 out={"all":stats(events),"train":stats([e for e in events if e["entryTsMs"]<SPLIT]),
 "later":stats([e for e in events if e["entryTsMs"]>=SPLIT])}
 for i in range(4):out["Q"+str(i+1)]=stats([e for e in events if quarter(e["entryTsMs"])=="Q"+str(i+1)])
 return out

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 base.native.m.acquire_verified_h1()
 src,_=base.native.m.m.core.task8.legacy.bootstrap()
 bars_by={};times_by={};entries={};coverage={}
 for sym in SYMS:
  bars,times=src.getdata(sym)
  assert len(bars)==114048 and len(bars)==len(times)
  assert all(times[k+1]-times[k]==M5 for k in range(len(times)-1)),sym
  bars_by[sym]=bars;times_by[sym]=times
  begin=bisect.bisect_left(times,START)
  end=bisect.bisect_left(times,END)
  signals={name:[] for name in ENTRY_NAMES}
  feature_count=0
  for j in range(max(290,begin),end-145):
   decision=times[j]+M5
   if decision%H or times[j+1]!=decision:continue
   f=features_for(sym,bars,times,j,src)
   if f is None:continue
   feature_count+=1
   for name in ENTRY_NAMES:
    if allows(name,sym,f):signals[name].append((j+1,decision))
  entries[sym]=signals
  coverage[sym]={"priceRows":len(bars),"priceStartMs":times[0],"priceEndMs":times[-1],
                 "completeHourlyDecisions":feature_count,
                 "signalCounts":{name:len(s) for name,s in signals.items()}}
  print("ENTRIES_COMPUTED",sym,feature_count,coverage[sym]["signalCounts"],flush=True)

 result={"status":"RESEARCH_ONLY_INDEPENDENT_ENTRY_EXIT_NO_LIVE_NO_FULL8",
  "scope":"Same previously explored 2025-08-10..2026-08-10; NEVER untouched OOS",
  "sourceCommit":"ebf15dee8bde0df18b2ead5bc8883dd9118ebd79",
  "signalContract":"Completed M5 HH:55 -> next exact hourly M5 open; historical values <= signal",
  "costContract":"10/30bps estimated combined round-trip expense, no venue L2/funding",
  "drawdownContract":"Closed trade unit-equity DD, NOT real portfolio MTM DD",
  "limitations":["No 8-logic wallet ownership, margin, shared locks, suppressed V52 or dynamic capital reselection",
  "No exchange orderbook, funding, basis or route certified production parity",
  "All later windows of the studied year may be contaminated by prior exploration",
  "Independent one-position-per-symbol assumption, not account-level capital constraint",
  "Candidate screening is exploratory; selection bias grows with the number of candidates"],
  "coverage":coverage,"entryResults":{},"exitResults":{},
  "entryRules":ENTRY_NAMES,"exitRules":EXIT_CASES}
 entry_rows={}
 for sym in SYMS:
  bars=bars_by[sym];times=times_by[sym]
  for name in ENTRY_NAMES:
   side="SHORT" if name in SHORT_NAMES else "LONG"
   signals=entries[sym][name]
   trades10=allocate(signals,bars,times,side,EXIT_CASES["ORIGINAL_12H"],10)
   trades30=allocate(signals,bars,times,side,EXIT_CASES["ORIGINAL_12H"],30)
   assert [(a["entryTsMs"],a["exitTsMs"]) for a in trades10]==[(a["entryTsMs"],a["exitTsMs"]) for a in trades30]
   assert all(abs(a["netPct"]-b["netPct"]-.2)<1e-7 for a,b in zip(trades10,trades30))
   for cost,trades in [(10,trades10),(30,trades30)]:
    result["entryResults"].setdefault(name,{}).setdefault(sym,{})[str(cost)]=by_period(trades)
    for item in trades:
     entry_rows[(name,sym,cost,item["entryTsMs"])]=item
  print("ENTRY_STATS_COMPUTED",sym,flush=True)

 # Strict future validation is not available. Gate for exploratory prioritization only.
 candidates=[]
 for sym in SYMS:
  for name in ENTRY_NAMES:
   r=result["entryResults"][name][sym]
   t=r["10"]["train"];v=r["10"]["later"]
   if t["n"]>=12:
    candidates.append((sym,name,t["n"],v["n"],t["wr"] or 0,t["pf"] or 0,
      v["wr"] or 0,v["pf"] or 0))
 candidates.sort(key=lambda v:(v[0],-v[5],-v[4]))
 result["rankingTrainOnly"]=candidates
 qualifying=[]
 for sym in SYMS:
  for name in ENTRY_NAMES:
   r=result["entryResults"][name][sym]
   a,b=r["10"],r["30"]
   if (a["all"]["n"]>=40 and b["all"]["n"]>=40 and
       a["later"]["n"]>=20 and b["later"]["n"]>=20 and
       all((r1["wr"] or 0)>=70 and (r1["pf"] or 0)>=1.2
           for r1 in (a["all"],b["all"],a["later"],b["later"])) and
       a["all"]["closedDDPct"]>=-15 and b["all"]["closedDDPct"]>=-15):
    qualifying.append((sym,name))
 result["exploratoryQualificationOnly"]=qualifying

 # Predefine exit cohorts by TRAIN-half-only PF ranking; prior year still exploratory.
 # Compare with independent original baseline and strongest train-signal non-original long/short.
 chosen=[]
 for sym in SYMS:
  chosen.append((sym,"ORIGINAL_REL_VOL"))
  longnames=[n for n in ENTRY_NAMES if n!="ORIGINAL_REL_VOL" and n not in SHORT_NAMES and result["entryResults"][n][sym]["10"]["train"]["n"]>=15]
  shortnames=[n for n in SHORT_NAMES if result["entryResults"][n][sym]["10"]["train"]["n"]>=15]
  for group in (longnames,shortnames):
   if group:
    top=max(group,key=lambda n:(
      min(result["entryResults"][n][sym]["10"]["train"]["pf"] or 0,5),
      result["entryResults"][n][sym]["10"]["train"]["wr"] or 0))
    chosen.append((sym,top))
 result["exitCohortsSelectedUsingTrainOnly"]=chosen
 print("EXIT_COHORTS_SELECTED",chosen,flush=True)
 for sym,name in chosen:
  bars=bars_by[sym];times=times_by[sym];signals=entries[sym][name]
  side="SHORT" if name in SHORT_NAMES else "LONG"
  cohort=allocate(signals,bars,times,side,EXIT_CASES["ORIGINAL_12H"],10)
  fixedEntries=[(bisect.bisect_left(times,e["entryTsMs"]),e["entryTsMs"]) for e in cohort]
  assert all(times[i]==ts for i,ts in fixedEntries)
  for exname,exrule in EXIT_CASES.items():
   row={"cohortBaselineN":len(cohort),"side":side,"costs":{}}
   for cost in (10,30):
    # Fixed original entry-cohort: exposure is unchanged; pure exit-rule effect.
    fixed=[simulate(bars,times,idx,side,exrule,cost) for idx,ts in fixedEntries]
    assert all(fixed)
    # Dynamic reselection: release capital after exit, admit next later signal.
    dynamic=allocate(signals,bars,times,side,exrule,cost)
    row["costs"][str(cost)]={"fixed":by_period(fixed),"dynamic":by_period(dynamic),
      "changedOriginalExits":sum(a["exitTsMs"]!=b["exitTsMs"] for a,b in zip(cohort,fixed)),
      "changedOriginalExitReasons":dict(collections.Counter(e["reason"] for e in fixed))}
    if cost==10:
     row["fixedPositiveDeltaVsBaseNetPoints"]=sum(f["netPct"]-b["netPct"]
       for f,b in zip(fixed,cohort))
   result["exitResults"].setdefault(sym,{}).setdefault(name,{})[exname]=row
  print("EXIT_COHORT_COMPLETE",sym,name,len(cohort),flush=True)

 # Report a compact, inspectable candidate leaderboard and frozen-cohort exit deltas.
 lines=["# RESIDUAL entry -> exit M5 deep research (2026-10-23)",
 "",
 "Research only. This historically reused 1-year window is NOT untouched OOS. No new entry/exit has been adopted or deployed.",
 "",
 "## Input and test methods",
 f"- Pinned source commit: {result['sourceCommit']}",
 "- Causal M5 HH:55 close -> next hourly M5 open; 10/30bps round-trip cost.",
 "- Per-symbol independent non-overlapping admission; no 8-way portfolio, funding, venue orderbook, or live risk certification.",
 "- Closed-trade-only DD is NOT mark-to-market portfolio maximum DD.",
 "- Earlier/later cohorts: 2026-02-10 UTC. The later period was already involved in strategy search and is contaminated.",
 "",
 "## Entry leaderboard (10bps; same signals at 30bps)",
 "|Symbol|Entrance|Signals|Trades|Train WR|Later WR|All WR|PF 10bps|PF 30bps|Closed DD 10bps|",
 "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
 for sym in SYMS:
  for name in sorted(ENTRY_NAMES,key=lambda k:(result["entryResults"][k][sym]["10"]["all"]["pf"] or -1),reverse=True):
   a=result["entryResults"][name][sym];t=a["10"]["train"];v=a["10"]["later"];all_=a["10"]["all"]
   pct=lambda x:"—" if x is None else f"{x:.1f}%"
   pf=lambda x:"—" if x is None else f"{x:.2f}"
   lines.append(f'|{sym}|{name}|{coverage[sym]["signalCounts"][name]}|{all_["n"]}|{pct(t["wr"])}|{pct(v["wr"])}|{pct(all_["wr"])}|{pf(all_["pf"])}|{pf(a["30"]["all"]["pf"])}|{pct(all_["closedDDPct"])}|')
 lines+=["",f"Exploratory candidates passing joint entry thresholds (NOT LIVE): {qualifying}",
 "","## Exit fixed original-entry cohort (10bps)",
 "|Symbol|Entry case|Exit case|Baseline cohort|Changed exits|10bps fixed PnL pts delta|10bps fixed WR|30bps fixed WR|Dynamic trades|",
 "|---|---|---|---:|---:|---:|---:|---:|---:|"]
 for sym,name in chosen:
  for exname,v in result["exitResults"][sym][name].items():
   j=v["costs"]["10"];k=v["costs"]["30"]
   lines.append(f'|{sym}|{name}|{exname}|{v["cohortBaselineN"]}|{j["changedOriginalExits"]}|{v["fixedPositiveDeltaVsBaseNetPoints"]:.2f}|{j["fixed"]["all"]["wr"] or 0:.1f}%|{k["fixed"]["all"]["wr"] or 0:.1f}%|{j["dynamic"]["all"]["n"]}|')
 lines+=["","## Conclusions and blockers",
 "- Check the machine-readable JSON for quarterly n/WR/PF/DD, Wilson 95% lower confidence bounds, and exit reasons.",
 "- Changes to exit alone do not validate the entry; small selected samples can overfit.",
 "- A new 8-strategy integration with capital reallocation, live current SHA/venue parity and forward shadow is mandatory before formal adoption.",
 "- No production or trading order operations were executed by this experiment.",""]
 p=OUT/"RESIDUAL_ENTRY_EXIT_DEEP_RESEARCH_20261023.json"
 p.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 (OUT/"RESIDUAL_ENTRY_EXIT_DEEP_RESEARCH_20261023.md").write_text("\n".join(lines),encoding="utf-8",newline="\n")
 for sym in SYMS:
  print("ENTRY_SUMMARY",sym,[(n,result["entryResults"][n][sym]["10"]["all"]["n"],
   round(result["entryResults"][n][sym]["10"]["all"]["wr"] or 0,2),
   round(result["entryResults"][n][sym]["10"]["all"]["pf"] or 0,2),
   round(result["entryResults"][n][sym]["10"]["later"]["wr"] or 0,2),
   round(result["entryResults"][n][sym]["30"]["all"]["wr"] or 0,2)) for n in ENTRY_NAMES],flush=True)
 for sym,name in chosen:
  for ename,v in result["exitResults"][sym][name].items():
   if ename in ("ORIGINAL_12H","HARD_STOP_5","EARLY_1H_NEG2","PROFIT_ARM3_FLOOR1","COMBO_1H2_P3_F1","TIME_6H"):
    a=v["costs"]["10"]["dynamic"]["all"]
    print("EXIT_SUMMARY",sym,name,ename,a["n"],round(a["wr"] or 0,2),round(a["pf"] or 0,3),
          round(a["closedDDPct"],2),round(v["fixedPositiveDeltaVsBaseNetPoints"],2),flush=True)
 print("DEEP_RESEARCH_COMPLETED",p,"EXPLORATORY_QUALIFY",qualifying,flush=True)
if __name__=="__main__":
 main()
