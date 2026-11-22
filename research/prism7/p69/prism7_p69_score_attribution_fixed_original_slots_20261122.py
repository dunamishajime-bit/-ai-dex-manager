#!/usr/bin/env python3
"""P69 independently validates fixed-slot vs re-slot attribution and score monotonicity.

Aster original P66 Native53 and Binance original P68 native55 market sources
are distinct. No fitting, no retuning: fixed policy and thresholds from P66.
Calculate fee 30, 100bps stress and FIXED baseline source-slot: no new
Native opportunities admitted due to early veto. Dynamic market score
winner retention and prior original cost parity independently crosscheck.
"""
from __future__ import annotations
import json,hashlib,collections
from pathlib import Path
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE,SOURCES
from prism7_p38_causal_multihorizon_entry_20261122 import SOURCES as M5SRC
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p66_native53_multitimeframe_score_size_20261122 import tier_score,replay
from prism7_p68_frozen_points_external_binance_native55_20261122 import actual_natives_one_slot
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import source_slot
P66=R/"PRISM7_P66_NATIVE53_MULTI_TF_TREND_POINT_SIZE_GROSS1_20261122.json"
P67=R/"PRISM7_P67_NATIVE53_MULTI_TF_SCORE_X_TWO_STAGE_STOP5_8_GROSS1_20261122.json"
P68=R/"PRISM7_P68_P66_FROZEN_MULTI_TF_SCORE_EXTERNAL_BINANCE_NATIVE55_20261122.json"
P61=R/"PRISM7_P61_EARLY_BINANCE_CROSS_VENUE_NATIVE_V20_P44_FROZEN_20261122.json"
OUT=R/"PRISM7_P69_MULTI_TF_SCORE_VALIDATION_FIXED33_VS_EXTERNAL_FIXED23_20261122.json"
MD=R/"PRISM7_P69_MULTI_TF_SCORE_VALIDATION_FIXED33_VS_EXTERNAL_FIXED23_20261122.md"
TEST_RULES=("NATIVE_UNCHANGED_075","NATIVE_UNCHANGED_100","POINTS_LAX",
 "POINTS_NO_REJECT","POINTS_STRICT","POINTS_LAX_WEEKLY_FAIL_CLOSED")
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def base_group(row,key):
 lo,hi=key
 z=[x for x in row if lo<=x["score"]<=hi]
 return {"n":len(z),"win":sum(x["sourceNativeWin"] if "sourceNativeWin" in x else x["originalNativeWin"] for x in z),
 "sourceOriginalEventKeys":[x["key"] for x in z]}
def metrics_aster(z):
 return {"closed":z["closed"],"wins":z["wins"],
   "ddM5":z["M5HighStressDDPct"],"navJPY":z["finalNAVYen"],
   "winsRejected":z["sourceRejectedWinningSignals"]}
def metrics_bina(z):
 return {"closed":z["oneSlotClosed"],"wins":z["oneSlotWins"],
    "ddRealizedONLY":z["realizedOnlyDDPct"],"navJPY":z["finalNAVYen"],
    "winsRejected":z["sourceNaturalWinnersVetoed"]}
def main():
 a=json.loads(P66.read_text(encoding="utf8"))
 b=json.loads(P67.read_text(encoding="utf8"))
 c=json.loads(P68.read_text(encoding="utf8"))
 p61=json.loads(P61.read_text(encoding="utf8"))
 assert len(a["native53OriginalSignalEntryAsOfMarketTrendRows"])==53
 assert len(c["sourceOriginal55NativeEntryFeatureLedger"])==55
 assert a["originalSingleSlotBaseline075ExactP44"] and c["sourceOneSlot23Win13NAVParityP61"]
 m5,_=load_m5(M5SRC)
 orig53=a["native53OriginalSignalEntryAsOfMarketTrendRows"]
 fixed33,_=source_slot(orig53)
 assert len(fixed33)==33
 orig55=c["sourceOriginal55NativeEntryFeatureLedger"]
 native23=set(next(z for z in p61["comparison"] if z["gate"]=="ORIGINAL_PINNED_NATIVE_SOURCE_ALL")["sourceSelectedIDs"])
 fixed23=[z for z in orig55 if z["key"].split("|")[0] in native23]
 assert len(fixed23)==23
 groupCuts={"0to3":(0,3),"4to6":(4,6),"7to10":(7,10),"11to15":(11,15)}
 aGrp={k:base_group(orig53,limits) for k,limits in groupCuts.items()}
 bGrp={k:base_group(orig55,limits) for k,limits in groupCuts.items()}
 assert sum(v["n"] for v in aGrp.values())==53 and sum(v["n"] for v in bGrp.values())==55
 comparisons=[]
 for rule in TEST_RULES:
  asize=[{**z,"grossAllocation":tier_score(rule,z["featuresAtNativeEntry"])} for z in fixed33]
  bsize=[{**z,"grossAllocation":tier_score(rule,z["featuresAtNativeEntry"])} for z in fixed23]
  for fee,cover in ((30,0),(30,100)):
   adyn=next(x["economic"] for x in a["allPolicyEconomicScenarios"] if x["policy"]==rule and x["feeBps"]==fee and x["extraCoverSlipBps"]==cover)
   bdyn=next(x["econ"] for x in c["allScenarios"] if x["policy"]==rule and x["feeBps"]==fee and x["extraCoverBps"]==cover)
   afixed=replay(asize,m5,fee,cover)
   bfixed=actual_natives_one_slot(bsize,fee,cover)
   if rule in ("NATIVE_UNCHANGED_075","NATIVE_UNCHANGED_100"):
    assert afixed["closed"]==adyn["closed"]==33
    assert bfixed["oneSlotClosed"]==bdyn["oneSlotClosed"]==23
    assert abs(afixed["finalNAVYen"]-adyn["finalNAVYen"])<.01
    assert abs(bfixed["finalNAVYen"]-bdyn["finalNAVYen"])<.01
   comparisons.append({"policy":rule,"feeBps":fee,"extraCoverSlipBps":cover,
     "AsterOriginal33Fixed_noAdditionalReAdmission":metrics_aster(afixed),
     "AsterNative53OpportunityReSlot":metrics_aster(adyn),
     "BinanceOriginal23Fixed_noAdditionalReAdmission":metrics_bina(bfixed),
     "BinanceNative55OpportunityReSlot":metrics_bina(bdyn),
     "marketSourcesNotPooled":True})
 # score is not monotonic when highest group 2/4 original native wins
 assert (aGrp["0to3"]["n"],aGrp["0to3"]["win"])==(8,2)
 assert (aGrp["11to15"]["n"],aGrp["11to15"]["win"])==(4,2)
 scope={"Aster":"P66 original Native53 Aster source H1+M5 marks 2025Aug-2026Nov; 33 originally selected position proxies",
   "Binance":"P68 official Binance Futures USD-M H1 original Native55 Jan-Jul2025;23 source one-slot, realized-only DD"}
 report={"schema":"prism7-p69-p66-p67-p68-score-transfer-fixed-source-slot-and-score-monotonic-audit/v1",
   "status":"RESEARCH_VALIDATION_FAILED_CROSS_VENUE__DO_NOT_DEPLOY_TIER_SIZING",
   "originalNativeSourcePIN":"1657e173d250ad58f53e62f7bb0a3428fb405496",
   "marketScope":scope,
   "preRegisteredWeightsW5D4H12_3H4_2H1_1":True,
   "originalAster53RawSourceScoreBin":aGrp,
   "externalBinance55RawSourceScoreBin":bGrp,
   "sameOriginalFixedSource33VsNewReAdmittedSingleSlot":True,
   "sameExternalFixedSource23VsNewReAdmittedSingleSlot":True,
   "frozenPredeclaredPolicyTests":TEST_RULES,
   "fixedVSDynamicEntryAndCostStress":comparisons,
   "AsterBTCWeeklyDailyStrictBullNativeSourceCount":a["sourceBTCAndPenguMacroBullFlags"]["btcWDUp"],
   "BinanceBTCWeeklyDailyStrictBullNativeSourceCount":c["sourceBTCMacroWeeklyDailyUpN"],
   "scoreHigh11To15AsterOnly4Sources2Wins":True,
   "P66AsterLaxApparentGainNotConfirmedByExternalBinance":True,
   "P67TwoStageStopLaxDoesNotImproveAsterLaxExitBaseline":True,
   "noUnseenFreshOriginalAsterSource":True,
   "conclusion":[
    "Concept of directional multi-timeframe trend classification is credible but first W5 D4 12H3 4H2 1H1 tier and rejection policy not robustly transferable.",
    "When BTC is strong weekly but daily has pulled back, requiring both W+D 2-consecutive closes UP underdetects bull market; 0 Aster and 1 Binance source signals classified macro bull, so global uptrend veto effect UNTESTED.",
    "Trend is two consecutive closed-period close-to-close declines, not validated full higher-high/lower-low chart structure, moving EMA slope, or broad cross-asset market regime.",
    "A better next design separates Macro BTC/ETH weekly/daily trend regime, PENGU relative weakness, and 12H/4H/1H rejection of rebound as independent layers, before optimizing lots.",
    "V20 profits from shorting in overall BTC bull regime remain possible for underperforming PENGU: avoid automatic veto without evidence.",
    "Do not use in-sample 13 strategies + P67 variants to select a lucky threshold. Prespecify mechanism and validate on fresh untouched original venue data.",
    "Continue existing Native V20 signal/exits/STOP/Gross unchanged until signed fills, fees, funding, risk and owner-approved evidence gates."
   ],
   "sha256Inputs":{"P66":sha(P66),"P67":sha(P67),"P68":sha(P68),"P61":sha(P61)},
   "ProductionMasterRunnerSTOPGrossOrdersTouched":False}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 lines=["# P69 | fixed-entry slot audit of 15-point W/D/12H/4H/1H trend score",
  "",
  "Original Aster pinned Native53 and different Binance Native55. Both date ranges already inspected in research; not independent true blind OOS. No LIVE changes.",
  "",
  "## Aster 53 natural source score distribution",
  "",
  "| PENGU 15-point range | Source count | Source winners |",
  "|---|---:|---:|"]
 for key,v in aGrp.items():
  lines.append("| "+key+" | "+str(v["n"])+" | "+str(v["win"])+" |")
 lines+=["","## Fixed original 33/23 trades versus newly reslotted signal set",
 "| Size rule | Market | Fixed closed/won | Fixed NAV | Fixed DD | Re-slot NAV | Re-slot DD |",
 "|---|---|---|---:|---:|---:|---:|"]
 for x in comparisons:
  if x["extraCoverSlipBps"]!=0:continue
  f=x["AsterOriginal33Fixed_noAdditionalReAdmission"];d=x["AsterNative53OpportunityReSlot"]
  lines.append("| "+x["policy"]+" | Aster | "+str(f["closed"])+"/"+str(f["wins"])+" | "+str(f["navJPY"])+" | "+str(f["ddM5"])+"% M5 | "+str(d["navJPY"])+" | "+str(d["ddM5"])+"% M5 |")
  f=x["BinanceOriginal23Fixed_noAdditionalReAdmission"];d=x["BinanceNative55OpportunityReSlot"]
  lines.append("| "+x["policy"]+" | Binance | "+str(f["closed"])+"/"+str(f["wins"])+" | "+str(f["navJPY"])+" | "+str(f["ddRealizedONLY"])+"% realized | "+str(d["navJPY"])+" | "+str(d["ddRealizedONLY"])+"% realized |")
 lines+=["","**Finding:** Score >=11 only original 4 sources/2 winners; not monotonic. Macro BTC both W&D up barely occurred, so asserted bull-market veto unproven. Aster LAX historical gains did not carry to Binance. Week/day measured with 3 complete bars and two changes, which misses many established uptrends in pullbacks. Next research should separate market regime from rebound entry timing and use new untouched original Aster source. No score or Gross deployment.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P69_NATIVE53_P66_ORIGINAL33_FIXED_VS_BINANCE_NATIVE55_ORIGINAL23_SCORE_STRESS_PASS",json.dumps({
  "AsterScoreBins":{k:{"n":v["n"],"wins":v["win"]} for k,v in aGrp.items()},
  "BinanceScoreBins":{k:{"n":v["n"],"wins":v["win"]} for k,v in bGrp.items()},
  "stress30":[{"policy":z["policy"],"asterFixedNAV":z["AsterOriginal33Fixed_noAdditionalReAdmission"]["navJPY"],
   "asterDynNAV":z["AsterNative53OpportunityReSlot"]["navJPY"],
   "binanceFixedNAV":z["BinanceOriginal23Fixed_noAdditionalReAdmission"]["navJPY"],
   "binanceDynNAV":z["BinanceNative55OpportunityReSlot"]["navJPY"]}
   for z in comparisons if z["extraCoverSlipBps"]==0]},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD)
if __name__=="__main__":main()
