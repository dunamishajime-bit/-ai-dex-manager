#!/usr/bin/env python3
"""PRISM VII P66: causal multi-timeframe trend points + size / veto for PENGU V20.

SOURCE V20 pinned native53 entry/exit price unchanged; 29 original source wins.
5 closed TF PENGU trends (W UTC Monday, 1D, 12H, 4H, 1H) with descending
weights 5,4,3,2,1. Trend = TWO consecutive changes in CLOSED-period closes;
more conservative than single red candle; missing weekly warmup -> UNKNOWN, 0
points, fail-closed sensitivity.
BTC W & D uptrend only as separate macro uptrend veto, NEVER the PENGU trend.
Equity: one natural native position at a time, per-position tier gross 0..1,
next admitted signal after previous exit, M5 price DD high stress, 10/30bps and
100bps cover stress. No source signal or exit retroactive changes.
All original 2025Aug-2026Nov data repeatedly viewed: discovery-only.
"""
from __future__ import annotations
import bisect,hashlib,json,statistics,collections,math,datetime
from collections import Counter,defaultdict
from pathlib import Path
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import PENGUH1,BTCH1,SOURCES,SOURCE,R
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import h1_source
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import source_slot,economy
import prism7_p44_native53_pre_drop_context_source_exit_20261122 as ref
H=3600000;M5=300000
TF_HOURS={"W":168,"D":24,"12H":12,"4H":4,"1H":1}
WEIGHTS={"W":5,"D":4,"12H":3,"4H":2,"1H":1}
WEEK_MONDAY_EPOCH=4*24*H
GATE_POLICIES=[
  "NATIVE_UNCHANGED_075","NATIVE_UNCHANGED_100",
  "POINTS_LAX",
  "POINTS_STRICT",
  "POINTS_NO_REJECT",
  "POINTS_LAX_REJECT_BTC_WEEK_DAY_UP",
  "POINTS_LAX_REJECT_PENGU_WEEK_DAY_UP",
  "POINTS_LAX_REJECT_BOTH_BTC_AND_PENGU_WEEK_DAY_UP",
  "POINTS_LAX_WEEKLY_FAIL_CLOSED",
  "POINTS_LAX_BTC_MACRO_CAP_HALF",
  "NATIVE075_BTC_WEEK_DAY_UP_VETO",
  "NATIVE075_PENGU_WEEK_DAY_UP_VETO",
  "NATIVE075_BOTH_WEEK_DAY_UP_VETO"
]
COSTS=((10,0),(30,0),(30,100))
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
OUT=R/"PRISM7_P66_NATIVE53_MULTI_TF_TREND_POINT_SIZE_GROSS1_20261122.json"
LEDGER=R/"PRISM7_P66_ORIGINAL53_ASOF_WEEK_DAY_12H_4H_1H_POINTS_LEDGER_20261122.jsonl"
MD=R/"PRISM7_P66_NATIVE53_MULTI_TF_TREND_POINT_SIZE_GROSS1_20261122.md"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rnd(x):return round(float(x),6)
def tf_bucket_start(ts,name):
 width=TF_HOURS[name]*H
 if name=="W":return ((ts-WEEK_MONDAY_EPOCH)//width)*width+WEEK_MONDAY_EPOCH
 return (ts//width)*width
def aggregates(rows,name):
 width=TF_HOURS[name]*H
 chunks=defaultdict(list)
 for z in rows:
  start=tf_bucket_start(z["time"],name)
  chunks[start].append(z)
 out=[]
 for start,z in sorted(chunks.items()):
  # Do not use first partial week or incomplete final bucket.
  if len(z)!=TF_HOURS[name] or z[0]["time"]!=start or z[-1]["time"]+H!=start+width:
   continue
  if any(z[i]["time"]-z[i-1]["time"]!=H for i in range(1,len(z))):
   raise ValueError("P66_SOURCE_TIME_GAP")
  if not all(a["close"]>0 for a in z):raise ValueError("P66_INVALID_SOURCE_CLOSE")
  out.append({"start":start,"end":start+width,"close":z[-1]["close"],
   "high":max(q["high"] for q in z),"low":min(q["low"] for q in z),
   "volume":sum(q["volume"] for q in z),
   "printedH1":sum(q["volume"]>0 for q in z),
   "H1CandleCount":len(z)})
 return out
def state_at(bars,ends,ts):
 j=bisect.bisect_right(ends,ts)-1
 if j<2:return {"trend":"UNKNOWN","known":False,"completedBars":max(0,j+1),"lastClose":None,
   "lastFullyCompletedEndTs":None,"usingEntryBucket":False}
 c=bars[j];a=bars[j-1];b=bars[j-2]
 # Need THREE contiguous FULL closed TF candles, no holes.
 width=c["end"]-c["start"]
 assert c["end"]<=ts
 if not (c["start"]==a["end"] and a["start"]==b["end"]):
  return {"trend":"UNKNOWN","known":False,"completedBars":j+1,"lastClose":None,
   "lastFullyCompletedEndTs":c["end"],"usingEntryBucket":False}
 # Require historical positive-volume prints for each fully completed candle;
 # provider synthetic nonprinting closes not accepted as trend evidence.
 if min(c["printedH1"],a["printedH1"],b["printedH1"])==0:
  return {"trend":"UNKNOWN","known":False,"completedBars":j+1,"lastClose":None,
   "lastFullyCompletedEndTs":c["end"],"usingEntryBucket":False}
 values=(b["close"],a["close"],c["close"])
 trend=("DOWN" if values[2]<values[1]<values[0]
        else "UP" if values[2]>values[1]>values[0] else "SIDEWAYS")
 return {"trend":trend,"known":True,"completedBars":j+1,"lastClose":rnd(c["close"]),
  "lastFullyCompletedEndTs":c["end"],
  "prev2Closes":[rnd(q) for q in values[:2]],
  "latestTwoClosedBarReturnsPct":[rnd(100*(a["close"]/b["close"]-1)),
     rnd(100*(c["close"]/a["close"]-1))],
  "usingEntryBucket":False}
def trend_features(pcache,bcache,entry):
 p={tf:state_at(*pcache[tf],entry) for tf in TF_HOURS}
 b={tf:state_at(*bcache[tf],entry) for tf in TF_HOURS}
 score=sum(WEIGHTS[tf] for tf,s in p.items() if s["trend"]=="DOWN")
 up=sum(WEIGHTS[tf] for tf,s in p.items() if s["trend"]=="UP")
 assert 0<=score<=15 and score+up<=15
 bullBTC=b["W"]["trend"]=="UP" and b["D"]["trend"]=="UP"
 bullP=p["W"]["trend"]=="UP" and p["D"]["trend"]=="UP"
 return {"penguTrend":p,"btcTrend":b,"weightedDownPoints":score,
  "weightedUpPoints":up,"PENGUWDUp":bullP,"BTCWDUp":bullBTC,
  "PENGUWeeklyKnown":p["W"]["known"],"BTCWeeklyKnown":b["W"]["known"],
  "entryTs":entry,"allPublishedBarsEndAtOrBeforeEntry":True,
  "scoresUseOnlyOriginalH1Source":True}
def tier_score(policy,f):
 score=f["weightedDownPoints"]
 if policy=="NATIVE_UNCHANGED_075":return .75
 if policy=="NATIVE_UNCHANGED_100":return 1.
 if policy.startswith("NATIVE075_"):
  if policy=="NATIVE075_BTC_WEEK_DAY_UP_VETO" and f["BTCWDUp"]:return 0.
  if policy=="NATIVE075_PENGU_WEEK_DAY_UP_VETO" and f["PENGUWDUp"]:return 0.
  if policy=="NATIVE075_BOTH_WEEK_DAY_UP_VETO" and f["PENGUWDUp"] and f["BTCWDUp"]:return 0.
  return .75
 if policy=="POINTS_STRICT":
  amount=0. if score<=5 else (.50 if score<=9 else (.75 if score<=12 else 1.))
 elif policy=="POINTS_NO_REJECT":
  amount=.25 if score<=3 else (.50 if score<=7 else (.75 if score<=11 else 1.))
 else:
  amount=0. if score<=3 else (.5 if score<=6 else (.75 if score<=10 else 1.))
 if policy=="POINTS_LAX_REJECT_BTC_WEEK_DAY_UP" and f["BTCWDUp"]:return 0.
 if policy=="POINTS_LAX_REJECT_PENGU_WEEK_DAY_UP" and f["PENGUWDUp"]:return 0.
 if policy=="POINTS_LAX_REJECT_BOTH_BTC_AND_PENGU_WEEK_DAY_UP" and f["PENGUWDUp"] and f["BTCWDUp"]:return 0.
 if policy=="POINTS_LAX_WEEKLY_FAIL_CLOSED" and (not f["PENGUWeeklyKnown"] or not f["BTCWeeklyKnown"]):return 0.
 if policy=="POINTS_LAX_BTC_MACRO_CAP_HALF" and f["BTCWDUp"]:return min(amount,.5)
 return amount
def replay(original,m5,fee,slip):
 cash=10000.;peak=cash;realpeak=cash;maxCloseDD=0.;maxHighDD=0.;realDD=0.
 currentRows=[];busy=-1;blocked=0;vetoed=0;sourceAccepted=0
 vetoed_wins=0;admitted_wins=0
 for x in sorted(original,key=lambda x:(x["entryTs"],x["key"])):
  g=x["grossAllocation"]
  assert g in (0.,.25,.5,.75,1.)
  if g<=0:
   vetoed+=1;vetoed_wins+=int(x["sourceNativeNet30Pct"]>0)
   continue
  sourceAccepted+=1;admitted_wins+=int(x["sourceNativeNet30Pct"]>0)
  if x["entryTs"]<busy:
   blocked+=1;continue
  if x["entryTs"]>=x["exitTs"]:raise ValueError("P66_NATIVE_EXIT_INVALID")
  start=x["entryTs"];end=x["exitTs"];p=x["entryPrice"];origCash=cash;marked=p
  for t in range(start,end+1,M5):
   z=m5.get(t)
   if z is None:raise ValueError("P66_SOURCE_M5_GAP:"+str(t))
   if float(z[5])>0:marked=float(z[4])
   if t<end:
    if float(z[5])>0:
     highNav=origCash*(1+g*((p-float(z[2]))/p-fee/10000))
     maxHighDD=max(maxHighDD,100*(1-highNav/peak))
    nav=origCash*(1+g*((p-marked)/p-fee/10000))
   else:
    fill=x["exitPrice"]*(1+slip/10000)
    nav=origCash*(1+g*((p-fill)/p-fee/10000))
   peak=max(peak,nav)
   maxCloseDD=max(maxCloseDD,100*(1-nav/peak))
  cash=nav;realpeak=max(realpeak,cash)
  realDD=max(realDD,100*(1-cash/realpeak))
  netEquity=100*(cash/origCash-1)
  currentRows.append({"key":x["key"],"entryTs":start,"exitTs":end,"grossAllocation":g,
    "sourceOriginalWin":x["sourceNativeNet30Pct"]>0,
    "resultWin":netEquity>0,"equityRetPct":rnd(netEquity),"score":x["score"]})
  busy=end+M5
 closed=len(currentRows);wins=sum(x["resultWin"] for x in currentRows)
 gains=sum(x["equityRetPct"] for x in currentRows if x["equityRetPct"]>0)
 loss=-sum(x["equityRetPct"] for x in currentRows if x["equityRetPct"]<0)
 return {"sourceNatural53":len(original),"sourceRejectedBeforeSlot":vetoed,
  "sourceRejectedWinningSignals":vetoed_wins,"sourceAcceptedNatural":sourceAccepted,
  "sourceAcceptedNativeWinningSignals":admitted_wins,
  "chronologicalOccupiedSlot":blocked,"closed":closed,"wins":wins,
  "winPct":rnd(100*wins/closed) if closed else None,
  "finalNAVYen":round(cash,2),
  "M5HighStressDDPct":rnd(max(maxHighDD,maxCloseDD)),
  "M5CloseDDPct":rnd(maxCloseDD),"realizedOnlyDDPct":rnd(realDD),
  "PF":rnd(gains/loss) if loss else None,
  "singleSlotNativeSourceKeys":[x["key"] for x in currentRows],
  "capitalTradeLedger":currentRows}
def main():
 native=json.loads(SOURCE.read_text(encoding="utf8"))
 assert len(native)==53 and sum(x["net30pct"]>0 for x in native)==29
 pengu,ph=h1_source(PENGUH1);btc,bh=h1_source(BTCH1)
 assert len(pengu)==len(btc) and all(a["time"]==b["time"] for a,b in zip(pengu,btc))
 pcache={k:(agg,[b["end"] for b in agg]) for k in TF_HOURS for agg in [aggregates(pengu,k)]}
 bcache={k:(agg,[b["end"] for b in agg]) for k in TF_HOURS for agg in [aggregates(btc,k)]}
 m5,m5sha=load_m5(SOURCES)
 rows=[]
 for z in native:
  assert z["parity"]=="EXACT"
  assert abs(100*(1-z["exitPrice"]/z["entryPrice"])-.3-z["net30pct"])<1e-7
  f=trend_features(pcache,bcache,z["entryTs"])
  rows.append({"key":z["period"]+"|"+z["id"]+"|"+str(z["entryTs"]),
    "cohort":z["period"],"period":z["period"],"entryTs":z["entryTs"],"entryPrice":z["entryPrice"],
    "exitTs":z["exitTs"],"exitPrice":z["exitPrice"],
    "sourceNativeNet30Pct":z["net30pct"],"sourceNativeWin":z["net30pct"]>0,
    "nativeSourceExitReason":z["exitReason"],"score":f["weightedDownPoints"],
    "featuresAtNativeEntry":f})
 assert len(rows)==53
 source0=[{**x,"grossAllocation":.75} for x in rows]
 slot,_=source_slot(source0)
 assert len(slot)==33
 ref.GROSS=.75
 reference=economy(slot,m5,30,0)
 check=replay(source0,m5,30,0)
 for a,b in (("wins","wins"),("singleSlotPositions","closed"),
             ("finalNAVYen","finalNAVYen"),("M5HighStressMarkedDDPct","M5HighStressDDPct")):
  assert abs(reference[a]-check[b])<1e-3,(a,reference[a],check[b])
 # 1.0 reference can also be independently parity tested
 ref.GROSS=1.
 reference1=economy(slot,m5,30,0)
 check1=replay([{**x,"grossAllocation":1.} for x in rows],m5,30,0)
 for a,b in (("wins","wins"),("singleSlotPositions","closed"),
             ("finalNAVYen","finalNAVYen"),("M5HighStressMarkedDDPct","M5HighStressDDPct")):
  assert abs(reference1[a]-check1[b])<1e-3,(a,reference1[a],check1[b])
 # Immutable parity checks both capital curves against P44 and P63
 assert abs(check["M5HighStressDDPct"]-25.10029)<.001
 assert abs(check1["M5HighStressDDPct"]-32.11305)<.001
 candidateTable=Counter()
 byScore=defaultdict(list)
 for z in rows:byScore[z["score"]].append(z)
 for pt in sorted(byScore):
  group=byScore[pt]
  candidateTable[pt]={"n":len(group),"wins":sum(x["sourceNativeWin"] for x in group),
    "losers":sum(not x["sourceNativeWin"] for x in group),
    "cohorts":dict(Counter(x["cohort"] for x in group))}
 stats=[]
 for policy in GATE_POLICIES:
  scored=[]
  for z in rows:
   allocation=tier_score(policy,z["featuresAtNativeEntry"])
   scored.append({**z,"grossAllocation":allocation})
  for fee,slip in COSTS:
   results=replay(scored,m5,fee,slip)
   stats.append({"policy":policy,"feeBps":fee,"extraCoverSlipBps":slip,
     "originalNative53SourceParity":True,
     "sourceNativeEntryExitUnchanged":True,
     "minimumRequiredAvailableWeeklyHistoryForHighScore":3,
     "economic":{k:v for k,v in results.items() if k!="capitalTradeLedger"},
     "capitalTrace30bps":results["capitalTradeLedger"] if fee==30 and slip==0 else None})
 assert len(stats)==len(GATE_POLICIES)*len(COSTS)
 normal=[x for x in stats if x["feeBps"]==30 and x["extraCoverSlipBps"]==0]
 result={
  "schema":"prism7-p66-pengu-native53-weekly-daily-12h-4h-1h-causal-score-size-guard/v1",
  "status":"RESEARCH_ONLY_NO_DEPLOYABLE_ENTRY_SCORE",
  "originalPinnedSourceSHA":PIN,
  "sourceNative53Original29Winners":True,
  "nativeEntrySourceAndExitPriceUnchanged":True,
  "researchFiveTimeframeWeights":WEIGHTS,
  "timeframesClosedEndBeforeOrAtEntryUTC":True,
  "weekStartsMondayUTC":True,
  "trendRequiresTwoConsecutiveCompletedCloseChanges":True,
  "firstPartialH1CalendarBucketExcludedFromTrend":True,
  "missingWeeklyTrendNotManufactured":True,
  "macrobullBTCWeeklyAndDailyUpSeparateFromPenguDowntrendScore":True,
  "macrobullPenguWeeklyAndDailyUpSeparatelyRecorded":True,
  "grossAllocationPerTradeSupports0_025_050_075_100":True,
  "originalSingleSlotBaseline075ExactP44":True,
  "originalSingleSlotBaseline100ExactP63":True,
  "policiesPredeclared":GATE_POLICIES,
  "costStress":COSTS,
  "native53OriginalSignalEntryAsOfMarketTrendRows":rows,
  "sourceOriginal53ScoreConfusionTable":dict(candidateTable),
  "sourceEventsWithUnknownPenguWeekly":sum(not z["featuresAtNativeEntry"]["PENGUWeeklyKnown"] for z in rows),
  "sourceEventsWithUnknownBTCWeekly":sum(not z["featuresAtNativeEntry"]["BTCWeeklyKnown"] for z in rows),
  "sourceBTCAndPenguMacroBullFlags":{
    "btcWDUp":sum(z["featuresAtNativeEntry"]["BTCWDUp"] for z in rows),
    "penguWDUp":sum(z["featuresAtNativeEntry"]["PENGUWDUp"] for z in rows),
    "bothWDUp":sum(z["featuresAtNativeEntry"]["BTCWDUp"] and z["featuresAtNativeEntry"]["PENGUWDUp"] for z in rows)},
  "scenarioCount":len(stats),"allPolicyEconomicScenarios":stats,
  "normal30bpsNoExtraCover":normal,
  "fullCausalFeatureLedger":str(LEDGER),
  "sourceSHA256":{"Native53Original":sha(SOURCE),"PENGUH1":ph,"BTCH1":bh,"PENGUM5":m5sha},
  "limitations":[
   "Original source 53 natural overlapping entry signals, 33 one-slot at baseline; score may affect slot admissions, mixing per-signal skill with opportunity timing.",
   "All Aug2025-Nov2026 original source outcomes previously viewed repeatedly, historical trade scoring cannot be called untouched OOS.",
   "Weekly first fully observed W starts Monday Aug4 2025; requires three full weeks, so some early Native signals have UNKNOWN W trend; unknowable is not uptrend or downtrend.",
   "Trends from source H1 aggregated fully closed W/D/12H/4H/1H; source H1 price may not equal exchange venue plotted chart candles in live production.",
   "A short can succeed even if BTC macro bullish if PENGU is relatively weak; absolute macro veto may reject real winners. Both veto and risk cap are separate exploratory controls.",
   "No contemporaneous account BTC/ETH aggregate market dominance, cross-runner positions, true shared gross risk, real signed fills, bid/ask execution, funding or exact M5 native STOP order.",
   "Gross sizes >.75 can exceed research user's chosen existing PENGU 0.75; research target only with owner scope approval.",
   "Trade fee/slippage stress not measured venue real; unseen data and robust source parity still required. No production changes."
  ]}
 OUT.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in rows),encoding="utf8")
 lines=["# P66 — Original Native V20: Weekly/D/12H/4H/1H trend score plus gross & entry veto",
  "",
  "All 53 source native entries/exits unchanged (29 winners). Trend from THREE fully completed multi-hour/weekly closes (two consecutive close-to-close declines); weekly Monday UTC, no incomplete candle. PENGU bear score 5+4+3+2+1=15; BTC W+D rising flag independent.",
  "",
  "Gross tiers are exploratory, no LIVE change. Original 0.75 source single-slot 33, 18 wins, DD25.10%, NAV ¥14,193; 1.0 33, 18, DD32.11%, NAV ¥15,557. Score sizes shown not production validation.",
  "",
  "| Policy | Accepted source | Selected | Wins | Conditional win% | Max M5 DD% | NAV ¥ | Source winners rejected |",
  "|---|---:|---:|---:|---:|---:|---:|---:|"]
 for x in normal:
  e=x["economic"]
  lines.append("| "+x["policy"]+" | "+str(e["sourceAcceptedNatural"])+" | "+str(e["closed"])+" | "+str(e["wins"])+" | "+str(e["winPct"])+" | "+str(e["M5HighStressDDPct"])+" | "+str(e["finalNAVYen"])+" | "+str(e["sourceRejectedWinningSignals"])+" |")
 lines+=["","## Source score 0–15 by original outcome", "",
 "| Score | Natural signals | Winners | Losses |","|---:|---:|---:|---:|"]
 for score,x in sorted(candidateTable.items()):
  lines.append("| "+str(score)+" | "+str(x["n"])+" | "+str(x["wins"])+" | "+str(x["losers"])+" |")
 lines+=["","**Research-only conclusions, not adoption.** Source53 data revisited, no future candle in score. Unavailable W=UNKNOWN not silently bearish; 5-frame score alone does not prove regime exclusion. Scope missing true BTC multiasset, source STOP intrabar, funding and account DD.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P66_NATIVE53_CAUSAL_MULTI_TF_SCORE_ORIGINAL_075_AND1_PARITY_PASS",json.dumps({
  "scenarios":len(stats),
  "WUnknownPengu":result["sourceEventsWithUnknownPenguWeekly"],
  "BTCmacroBull":result["sourceBTCAndPenguMacroBullFlags"],
  "scoreConfusion":dict(candidateTable),
  "normal":[{"policy":x["policy"],
   "accepted":x["economic"]["sourceAcceptedNatural"],
   "closed":x["economic"]["closed"],"wins":x["economic"]["wins"],
   "winPct":x["economic"]["winPct"],"dd":x["economic"]["M5HighStressDDPct"],
   "nav":x["economic"]["finalNAVYen"],
   "rejectedSourceWinners":x["economic"]["sourceRejectedWinningSignals"]}
     for x in normal]
 },ensure_ascii=False),flush=True)
 print("FILES",OUT,LEDGER,MD)
if __name__=="__main__":main()
