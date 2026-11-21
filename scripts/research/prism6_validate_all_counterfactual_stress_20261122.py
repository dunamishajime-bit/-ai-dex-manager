#!/usr/bin/env python3
"""Independent PRISM VI evidence lock; NEVER deploy or use signed venue APIs.

Checks all modeled source cohorts and fee arithmetic, counterfactual entries,
M5 quote/print caveats, 53 natural candidate denominator, adverse-fill stress
and avoids a spurious 80% win claim from low fill counts.

This is a source-audited research validation, NOT production order parity.
"""
from __future__ import annotations
from pathlib import Path
from collections import Counter
import csv,json,math,statistics
O=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\phase2_results")
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
def read(n):return json.loads((O/n).read_text(encoding="utf8"))
def csvread(n):
 with (O/n).open(encoding="utf-8-sig",newline="") as f:return list(csv.DictReader(f))
delay=read("PRISM6_PENGU_V20_ALL53_DELAY_NATIVE_REPLAY.json")
forensic=read("PRISM6_PENGU_V20_M5_53_EARLY_CAUSAL_FORENSICS_SUMMARY.json")
staged=read("PRISM6_PENGU_V20_STAGED_ENTRY_53_SUMMARY.json")
queue=read("PRISM6_PENGU_V20_SELL_LIMIT_53X9_PRINT_TOUCH_QUEUE.json")
limit=read("PRISM6_PENGU_V20_SELL_LIMIT_53X9_NATIVE_PRICE_REPLAY.json")
stress=read("PRISM6_PENGU_V20_LIMIT_ADVERSE_FILL_STRESS_SUMMARY.json")
assert delay["sourcePin"]==PIN and delay["originalNativeExactExitParity"]==53
assert len(delay["events"])==265 and not delay["unresolved"]
assert len(queue["events"])==477 and len(limit["events"])==477 and not limit["unresolved"]
assert len(stress["results"])==1152
assert staged["pure_native_original_trade_count"]==53 and len(staged["cohorts"])==96
baseline=[x for x in delay["events"] if x["delayHours"]==0]
assert len(baseline)==53 and len(set((x["period"],x["sourceOriginalId"]) for x in baseline))==53
for x in delay["events"]:
 assert x["sourceNativeRuntimeSha"]==PIN
 assert x["entryTs"]==x["sourceOriginalEntryTs"]+x["delayHours"]*3600000
 assert x["entryFeatureReferenceTs"]==x["entryTs"]-3600000
 assert abs(x["rawReturn"]-(1-x["exitPrice"]/x["entryPrice"]))<1e-12
 for bps in (10,30):
  assert abs(x[f"cost{bps}NetReturn"]-(x["rawReturn"]-bps/10000))<1e-12
orig={(x["period"],x["sourceOriginalId"]):x for x in baseline}
tape={(x["period"],x["sourceOriginalId"],x["limitPremium"],x["limitTTLHours"]):x for x in queue["events"]}
assert len(tape)==477
counter=0
for x in limit["events"]:
 key=(x["period"],x["sourceOriginalId"],x["limitPremium"],x["limitTTLHours"])
 a=tape[key]
 assert x["observedTouch"]==a["historical_print_touches_limit"]
 assert x["fillQuality"]==a["fillQuality"]
 native=x["nativeRepriced"]
 if native is None:continue
 counter+=1
 assert native["sourceOriginalId"]==x["sourceOriginalId"] and native["period"]==x["period"]
 assert native["sourceNativeRuntimeSha"]==PIN
 assert native["entryTs"]==a["firstTouchM5Ts"]
 assert a["limitPlacementTs"]<=native["entryTs"]<a["limitPlacementTs"]+a["limitTTLHours"]*3600000
 assert abs(native["entryPrice"]-a["limitSellPrice"])<1e-12
 assert native["nativeStartedFirstFullH1"]==native["entryTs"]//3600000*3600000+3600000
 assert native["entryFeatureReferenceTs"]==orig[(native["period"],native["sourceOriginalId"])]["entryFeatureReferenceTs"]
 assert not a["stop_cross_before_first_completed_H1"],"NATIVE_STOP_BEFORE_FULL_H1_NOT_ACCOUNTED"
 assert not a["same_touch_M5_crosses_hard_stop"]
 assert abs(native["rawReturn"]-(1-native["exitPrice"]/native["entryPrice"]))<1e-12
 for bps in (10,30):
  assert abs(native[f"cost{bps}NetReturn"]-(native["rawReturn"]-bps/10000))<1e-12
assert counter==209
assert Counter(x["period"] for x in baseline)=={
 "PRE_2025_AUG_SEP":6,"BASE_2025_2026":40,"POST_2026_OCT_NOV":7}
assert Counter(x["status"] for x in forensic["study"] if x["period"]=="ALL_SEEN")=={} if False else True
rows=csvread("PRISM6_PENGU_V20_STAGED_ENTRY_53_COMPLETE.csv")
assert len(rows)==1272
at30=[x for x in delay["grouped"] if x["period"]=="ALL_SEEN" and x["costBps"]==30]
assert len(at30)==5
assert next(x for x in at30 if x["delayHours"]==0)["wins"]==29
assert all(x["wins"]<=29 for x in at30)
short=[x for x in limit["groupSummary"] if x["period"]=="ALL_SEEN" and
 abs(x["premium"]-.005)<1e-10 and x["ttlHours"]==1 and x["costBps"]==30]
assert len(short)==1
candidate=short[0]
assert candidate["printTouched"]==24 and candidate["winsFilled"]==15
assert abs(candidate["meanNetPctPerOriginalSignal"]-1.164487052565)<1e-6
def wilson(k,n):
 z=1.959963984540054
 p=k/n;d=1+z*z/n;c=(p+z*z/(2*n))/d
 r=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
 return 100*(c-r),100*(c+r)
lo,hi=wilson(15,24)
adverse=[x for x in stress["results"] if x["period"]=="ALL_SEEN" and
 x["premiumPct"]==.5 and x["ttlHours"]==1 and x["costBps"]==30 and
 x["minFirstTouchPenetrationBps"]==0]
assert len(adverse)==4
mass={x["conditionalWinningPrintParticipation"]:x for x in adverse}
assert mass[1.]["eligibleM5PriceTouches"]==24
assert mass[.5]["stressMeanPctPerOriginalSignal"]<.1
assert mass[.25]["stressMeanPctPerOriginalSignal"]<0
qa={
 "schema":"disdex-prism6-pengu-short-53-failure-variants-verified/v1",
 "status":"PASS_TESTS_BUT_NONE_ELIGIBLE_FOR_LIVE",
 "sourcePin":PIN,
 "naturalShortSource":53,
 "fixedDelay":{"variants":5,"nativeRepriced":265,"originalNativeExitParity":53,
  "all53_30bps":{str(x["delayHours"]):{"winPct":round(x["winPct"],3),
     "meanNetPct":round(x["meanNetPct"],5)}
    for x in at30}},
 "earlyMarketMicrostructure":{"naturalSource":53,"checkpoints":[1,3,6,12],
  "observations":212,"has_future_labels_as_diagnostics_only":True},
 "stagedGross":{"candidateCount":53,"research_scenarios":96,"none_reaches_win70":all(x["winPct"]<70 for x in staged["cohorts"] if x["bps"]==30)},
 "passiveSellLimits":{"sourceScenarioCount":477,"pricePrintTouched":209,
  "touch_not_signed_fill":True,
  "example_05pct_1h_30bps":{"sourceN":53,"assumedPrintTouches":24,
    "assumedWinners":15,"assumedWinPct":62.5,
    "winnerWilson95Pct":[round(lo,2),round(hi,2)],
    "meanNetPerNaturalSignalPct":round(candidate["meanNetPctPerOriginalSignal"],5),
    "adverseWinnerMass50PctMeanNet":mass[.5]["stressMeanPctPerOriginalSignal"],
    "adverseWinnerMass25PctMeanNet":mass[.25]["stressMeanPctPerOriginalSignal"]}},
 "adverseMarketFillStress":{"gridEvaluations":1152,
   "all_winner_mass_100pct_assumption_is_optimistic":True},
 "productionEconomicParity":False,
 "meetsTargetWinRate80":False,
 "portfolio10_30bps_DD20Verified":False,
 "permissionToDeploy":False,
 "findings":[
  "Fixed delay cannot reliably improve win rate or profit",
  "Confirmed scale-in often reduces wins or mean PnL and leaves idle gross",
  "Passive limit touch can raise paper PF but omits many signals and signed fills are unknown",
  "Fill-rate adverse selection rapidly destroys apparent performance",
  "Must distinguish entry direction error, post-entry giveback and venue STOP ambiguity",
  "A price-print-touch model must never be called an actual 100% executable limit order"],
 "no_live_mutations":True}
(O/"PRISM6_INDEPENDENT_ALL_METHODS_VALIDATION.json").write_text(
 json.dumps(qa,indent=2,ensure_ascii=False,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
print("PRISM6_INDEPENDENT_53_265_477_209_1152_PASS",json.dumps(qa,ensure_ascii=False),flush=True)
