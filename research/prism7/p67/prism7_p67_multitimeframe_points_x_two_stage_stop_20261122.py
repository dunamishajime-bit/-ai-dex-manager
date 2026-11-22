#!/usr/bin/env python3
"""PRISM7 P67: Multitimeframe source-entry score crossed with exit modes.

Entry feature cache from P66 (UTC completed weekly/D/12H/4H/1H, original V20 53).
EXIT variants SOURCE native8, standing STOP5, two-stage STOP5 with BTC6 up
and PENGU relative24 weak => hold up to emergency M5 8 source max.
Directly use original P64 & P65 functions for exact source risk-price parity,
not reconstruct counterfactual prices from rounded output.
Gross per entry computed before changed exit. Use P66 replay exact one-slot
0-1.0 per trade dynamic weights, costs and M5 high DD. Research only.
"""
from __future__ import annotations
import json,hashlib,collections
from pathlib import Path
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE,SOURCES,PENGUH1,BTCH1
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import h1_source,moving_ema
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p64_hardstop5_vs8_gross1_m5_20261122 import source_rows,simulate_earlier_stop
from prism7_p65_dual_stop5_to8_asof_20261122 import causal_feature_at_trigger,stop8_after_hold,hold_decision
from prism7_p66_native53_multitimeframe_score_size_20261122 import tier_score,replay
H=3600000;M5=300000
COSTS=((10,0),(30,0),(30,100))
SCORE_POLICIES=("NATIVE_UNCHANGED_075","NATIVE_UNCHANGED_100","POINTS_LAX",
  "POINTS_LAX_WEEKLY_FAIL_CLOSED","POINTS_NO_REJECT","POINTS_STRICT")
EXIT_POLICIES=("SOURCE_PINNED_NATIVE","STANDING_STOP5_ALL","TWO_STAGE_STOP5_OR_HOLD8_BTC6_REL24")
P66=R/"PRISM7_P66_NATIVE53_MULTI_TF_TREND_POINT_SIZE_GROSS1_20261122.json"
P65=R/"PRISM7_P65_TWO_STAGE_STOP5_EXCEPTION_TO8_SOURCE53_GROSS1_20261122.json"
OUT=R/"PRISM7_P67_NATIVE53_MULTI_TF_SCORE_X_TWO_STAGE_STOP5_8_GROSS1_20261122.json"
MD=R/"PRISM7_P67_NATIVE53_MULTI_TF_SCORE_X_TWO_STAGE_STOP5_8_GROSS1_20261122.md"
LEDGER=R/"PRISM7_P67_NATIVE53_ORIGINAL_ENTRY_SCORE_AND_EXIT_CROSS_LEDGER_20261122.jsonl"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
 native=json.loads(SOURCE.read_text(encoding="utf8"))
 assert len(native)==53 and sum(x["net30pct"]>0 for x in native)==29
 orig=source_rows(native)
 p66=json.loads(P66.read_text(encoding="utf8"))
 assert p66["originalSingleSlotBaseline075ExactP44"] and p66["originalSingleSlotBaseline100ExactP63"]
 score={x["key"]:x for x in p66["native53OriginalSignalEntryAsOfMarketTrendRows"]}
 assert len(score)==53
 m5,m5sha=load_m5(SOURCES)
 peng,ph=h1_source(PENGUH1);btc,bh=h1_source(BTCH1)
 em72=moving_ema(peng,72);em168=moving_ema(peng,168);imap={x["time"]:i for i,x in enumerate(peng)}
 baseline65=json.loads(P65.read_text(encoding="utf8"))
 assert baseline65["source5PctPriceStopParityWithP64AllScenarios"]
 guard=1
 stop5={}
 exception={}
 for z in orig:
  x=simulate_earlier_stop(z,m5,.05,guard)
  stop5[z["key"]]=x
  if x["researchNewStopTriggered"]:
   pre=causal_feature_at_trigger(z,m5,peng,btc,em72,em168,imap,x["researchNewStopTs"])
   hold=hold_decision("EXCEPTION_BTC6_RISE_AND_REL24_WEAK",pre)
  else:
   pre=None;hold=False
  if not hold:
   exception[z["key"]]=x
  else:
   s=stop8_after_hold(z,m5,x["researchNewStopTs"])
   exception[z["key"]]={**z,**s,"exceptionHold8":True,
     "stop5TriggeredAtTs":x["researchNewStopTs"],
     "preStop5":pre}
 assert len(exception)==53
 cases=[];trace=[]
 for exit_policy in EXIT_POLICIES:
  for policy in SCORE_POLICIES:
   selected=[]
   for z in orig:
    f=score[z["key"]]["featuresAtNativeEntry"]
    g=tier_score(policy,f)
    if exit_policy=="SOURCE_PINNED_NATIVE":candidate=z
    elif exit_policy=="STANDING_STOP5_ALL":candidate=stop5[z["key"]]
    elif exit_policy=="TWO_STAGE_STOP5_OR_HOLD8_BTC6_REL24":candidate=exception[z["key"]]
    else:raise ValueError("P67_INVALID_EXIT_POLICY")
    selected.append({**candidate,"grossAllocation":g,"score":f["weightedDownPoints"],
      "multiTfFeatureKnownBeforeOriginalNativeEntry":True,
      "exitPolicy":exit_policy,"sizePolicy":policy})
   for fee,slip in COSTS:
    calc=replay(selected,m5,fee,slip)
    cases.append({"entrySizePolicy":policy,"exitPolicy":exit_policy,
       "feeBps":fee,"extraBuyCoverSlipBps":slip,
       "grossDynamicByOriginalEntryScore":True,
       "originalV20SourceIntents53":53,
       "oneSlotAllocationRecomputedWhenOriginalNativeExitIsShortened":True,
       "economic":{k:v for k,v in calc.items() if k!="capitalTradeLedger"},
       "matchedPositionLedger":calc["capitalTradeLedger"] if fee==30 and slip==0 else None})
   trace.append({"entryPolicy":policy,"exitPolicy":exit_policy,
    "sourceAllowed":sum(z["grossAllocation"]>0 for z in selected),
    "sourceOriginalWinnersRejectedByScore":sum(z["grossAllocation"]==0 and z["sourceNativeNet30Pct"]>0 for z in selected),
    "sourceStop5Touches":sum(z["researchNewStopTriggered"] for z in selected if z.get("researchNewStopTriggered") is not None),
    "sourceExceptional8Holds":sum(bool(z.get("exceptionHold8",False)) for z in selected),
    "sourceOriginalWinnersLostDueToEarlierStop":sum(
     z["sourceNativeNet30Pct"]>0 and 100*(1-z["exitPrice"]/z["entryPrice"])-.3<=0 for z in selected),
    "originalEntryScoreAndExitTrace":[{"key":z["key"],"score":z["score"],"gross":z["grossAllocation"],
      "originalSourceWin":z["sourceNativeNet30Pct"]>0,
      "exitTs":z["exitTs"],"exitPrice":z["exitPrice"],
      "nativeExitTs":z["nativeExitTs"],"nativeExitPrice":z["nativeExitPrice"],
      "continuationTo8":bool(z.get("exceptionHold8",False))}
      for z in selected]})
 assert len(cases)==len(EXIT_POLICIES)*len(SCORE_POLICIES)*len(COSTS)
 # independently match P66 scored original exits for ALL fee+cost combos
 for case in cases:
  if case["exitPolicy"]!="SOURCE_PINNED_NATIVE":continue
  previous=next(x for x in p66["allPolicyEconomicScenarios"] if x["policy"]==case["entrySizePolicy"] and
     x["feeBps"]==case["feeBps"] and x["extraCoverSlipBps"]==case["extraBuyCoverSlipBps"])
  a=case["economic"];b=previous["economic"]
  for key in ("closed","wins","finalNAVYen","M5HighStressDDPct","sourceRejectedWinningSignals"):
   assert abs(a[key]-b[key])<1e-4,(case["entrySizePolicy"],key,a[key],b[key])
 # Independently compare original Gross1 P64 full STOP5 result and P65 full two-stage result
 for mode,p65mode in (("STANDING_STOP5_ALL","NORMAL_STOP5_ALWAYS"),("TWO_STAGE_STOP5_OR_HOLD8_BTC6_REL24","EXCEPTION_BTC6_RISE_AND_REL24_WEAK")):
  x=next(z for z in cases if z["entrySizePolicy"]=="NATIVE_UNCHANGED_100" and
    z["exitPolicy"]==mode and z["feeBps"]==30 and z["extraBuyCoverSlipBps"]==0)
  p=next(z for z in baseline65["allScenarios"] if z["rule"]==p65mode and
    z["sourceStop5PositiveM5HighGuardHours"]==1 and z["gross"]==1 and
    z["feeBps"]==30 and z["extraAllCoverSlipBps"]==0)
  assert abs(x["economic"]["finalNAVYen"]-p["chronologicalSingleSlotReAdmission"]["finalNAVYen"])<.01
  assert abs(x["economic"]["M5HighStressDDPct"]-p["chronologicalSingleSlotReAdmission"]["M5HighStressMarkedDDPct"])<.001
 normal=[x for x in cases if x["feeBps"]==30 and x["extraBuyCoverSlipBps"]==0]
 out={"schema":"prism7-p67-native53-causal-entry-multiTF-score-vs-two-stage-native-stop-five-eight-full-factorial/v1",
  "status":"RESEARCH_ONLY_NO_FRESH_OUT_OF_SAMPLE",
  "sourceOriginalV20Native53EntriesAndProfitExitsUntouched":True,
  "sourceNativePinnedSHA":"1657e173d250ad58f53e62f7bb0a3428fb405496",
  "P66OriginalEntranceScoreAndDDParitiesAll":True,
  "P65OriginalSTOP5AndTwoStagePriceParitiesGross1":True,
  "originalSource53NaturalWins29":True,
  "sourceNativeStop8PriceModelAlwaysActive":True,
  "sourceStop5HoldDecisionOnlyPriorCompletedH1M5":True,
  "sourceGrossMaximum1":True,
  "sourceSingleSlotM5HighDDAndCompoundNAV":True,
  "entryScorePolicies":SCORE_POLICIES,
  "exitPolicies":EXIT_POLICIES,
  "economicStress":COSTS,
  "allEconomicGrid":cases,"normal30bpsNoExtraSlip":normal,
  "all53PreEntryScoreAndExitPriceTraceByPolicy":trace,
  "scenarios":len(cases),
  "sourceSHA256":{"originalNative53":sha(SOURCE),"P66":sha(P66),
   "P65":sha(P65),"M5":m5sha},
  "limitations":[
    "All prior Aug2025-Nov2026 source Native53 outcomes are heavily inspected. Apparent optimal combination is in-sample, not deployable.",
    "Entry score only uses PENGU trend completed W D 12H 4H 1H and BTC W D macro, not a validated general market trend signal.",
    "Entry scoring and early exits may change chronological single-slot admissions; P65 and P66 matched separately and original source53 natural candidate records preserved.",
    "STOP5 and STOP8 price proxies use positive-volume source M5 high with source original H1 exit priority one-hour guard, not actual exchange signed STOP fills.",
    "Gross1 plus score veto does not guarantee daily Shared Risk, multi-runner Gross or drawdown cap 20% at account level.",
    "No separate unseen Aster source calendar, actual fees/funding or orderbook available. No LIVE Runner, STOP, orders, risk changes."
  ]}
 OUT.write_text(json.dumps(out,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in trace),encoding="utf8")
 lines=["# P67 — Multi-timeframe W/D/12H/4H/1H Native entry score × STOP exit as-of",
  "",
  "Factorial P66 causal score and P65 two-stage STOP5->8 source price replay, all original V20 natural source53 signal/entry preserved, max Gross1, 30bps, 0.75 original reference. No actual execution.",
  "",
  "| Original entry size rule | Exit variant | Closed | Wins | DD M5 | NAV ¥ | Source winners skipped |",
  "|---|---|---:|---:|---:|---:|---:|"]
 for x in normal:
  e=x["economic"]
  lines.append("| "+x["entrySizePolicy"]+" | "+x["exitPolicy"]+" | "+str(e["closed"])+" | "+str(e["wins"])+" | "+str(e["M5HighStressDDPct"])+"% | "+str(e["finalNAVYen"])+" | "+str(e["sourceRejectedWinningSignals"])+" |")
 lines+=["","Check +100bps buy-cover stress and 10bps costs in accompanying JSON. All results from previously inspected source53. Actual 5/8 STOP implementation can be unsafe without protecting venue STOP orders; do not deploy based on this research alone.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P67_MULTI_TF_SCORE_X_5_8_STOP_ORIGINAL53_P65_P66_PARITY_PASS",json.dumps({
  "scenarios":len(cases),
  "normal":[{"size":z["entrySizePolicy"],"exit":z["exitPolicy"],
    "closed":z["economic"]["closed"],"wins":z["economic"]["wins"],
    "winPct":z["economic"]["winPct"],
    "DD":z["economic"]["M5HighStressDDPct"],"NAV":z["economic"]["finalNAVYen"],
    "sourceWinsRejected":z["economic"]["sourceRejectedWinningSignals"]}
    for z in normal]},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
