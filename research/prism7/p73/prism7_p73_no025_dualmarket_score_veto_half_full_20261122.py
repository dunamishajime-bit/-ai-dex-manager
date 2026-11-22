#!/usr/bin/env python3
"""P73: PENGU Native V20 dual-venue signed-score entry gate, NO 0.25 gross.

Predeclared structural variants, not statistically optimized: reject at
unfavorable conditions, otherwise gross 0.50,0.75 or 1.00 only. Source Native
V20 ASTER entrance 53 immutable. Binance same UTC is macro indicator ONLY.
P71 53 pre-entry ASOF signed points reused without recomputing.
Double run 30bps and 30bps+100bps cover stress, plus 10bps reference.
Gross allocations 0, .5, .75, 1 (strictly no 0.25). Retain original pinned
exit priority; M5 high-stress equity DD from existing source P66 replay.
Source-only and original single-slot33 subgroup evidence, per cohort.
Research only, not deployable; reused in-sample periods and already visible
winner outcomes create overfit risk.
"""
from __future__ import annotations
from pathlib import Path
import json,hashlib,collections,datetime
from collections import Counter,defaultdict
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE,SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import source_slot
from prism7_p66_native53_multitimeframe_score_size_20261122 import replay
P71=R/"PRISM7_P71_DUAL_MARKET_SIGNED_TF_POINTS_NATIVE53_20261122.json"
P70=R/"PRISM7_P70_BINANCE_ASTER_COMMON_PERIOD_PUBLIC_ARCHIVE_MANIFEST_20261122.json"
OUT=R/"PRISM7_P73_NO_GROSS025_V20_SIGNED_AST_BIN_RISK_REJECT_VS_HALF_20261122.json"
MD=R/"PRISM7_P73_NO_GROSS025_V20_SIGNED_AST_BIN_RISK_REJECT_VS_HALF_20261122.md"
LEDGER=R/"PRISM7_P73_ALL53_NO025_POLICY_SCORE_SIGNAL_DECISIONS_20261122.jsonl"
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
COSTS=((10,0),(30,0),(30,100))
POLICIES=(
 "ORIGINAL_075",
 "ORIGINAL_100",
 "MACRO_BULL_VETO_075",
 "MACRO_BULL_HALF_ELSE_075",
 "MACRO_BULL_VETO_ELSE_100",
 "MACRO_BULL_HALF_ELSE_100",
 "SIGNED_NEGATIVE_VETO_ELSE_075",
 "SIGNED_NEGATIVE_HALF_ELSE_075",
 "SIGNED_LESS_MINUS6_VETO_ELSE_075",
 "SIGNED_LESS_MINUS6_HALF_ELSE_075",
 "MACRO_BULL_AND_NEGATIVE_VETO_ELSE_075",
 "MACRO_BULL_AND_NEGATIVE_HALF_ELSE_075",
 "MACRO_BULL_ELSE_HALF_IF_SCORE_NEG_ELSE_075",
 "MACRO_BULL_AND_PENGU_BOTH_W_UP_VETO_075",
 "MACRO_BULL_AND_PENGU_W_UP_VETO_075",
 "MACRO_BULL_UP_AND_PENGU_SIGNED_UP_VETO_ELSE_HALF",
 "MACRO_BULL_REJECT_UNLESS_PENGU_REL_WEAK",
 "MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT",
 "MACRO_BULL_VETO_ELSE_075_SCORE_GT12_ADD_TO_100",
)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def allocation(policy,x):
 s=x["dualSigned"];bull=s["macroBullBothBTCAndEthereum"]
 score=s["grossSignedScore"];ascore=s["asterPENGUSignedPoints"]
 bscore=s["binancePENGUSignedPoints"]
 twosidedWeekUp=s["bothPENGUWeeklyUp"]
 aWeekUp=x["featuresAtNativeEntry"]["penguTrend"]["W"]["trend"]=="UP"
 if policy=="ORIGINAL_075":return .75
 if policy=="ORIGINAL_100":return 1.
 if policy=="MACRO_BULL_VETO_075":return 0. if bull else .75
 if policy=="MACRO_BULL_HALF_ELSE_075":return .5 if bull else .75
 if policy=="MACRO_BULL_VETO_ELSE_100":return 0. if bull else 1.
 if policy=="MACRO_BULL_HALF_ELSE_100":return .5 if bull else 1.
 if policy=="SIGNED_NEGATIVE_VETO_ELSE_075":return 0. if score<0 else .75
 if policy=="SIGNED_NEGATIVE_HALF_ELSE_075":return .5 if score<0 else .75
 if policy=="SIGNED_LESS_MINUS6_VETO_ELSE_075":return 0. if score<=-6 else .75
 if policy=="SIGNED_LESS_MINUS6_HALF_ELSE_075":return .5 if score<=-6 else .75
 if policy=="MACRO_BULL_AND_NEGATIVE_VETO_ELSE_075":
  return 0. if (bull and score<0) else .75
 if policy=="MACRO_BULL_AND_NEGATIVE_HALF_ELSE_075":
  return .5 if (bull and score<0) else .75
 if policy=="MACRO_BULL_ELSE_HALF_IF_SCORE_NEG_ELSE_075":
  return 0. if bull else .5 if score<0 else .75
 if policy=="MACRO_BULL_AND_PENGU_BOTH_W_UP_VETO_075":
  return 0. if bull and twosidedWeekUp else .75
 if policy=="MACRO_BULL_AND_PENGU_W_UP_VETO_075":
  return 0. if bull and aWeekUp else .75
 if policy=="MACRO_BULL_UP_AND_PENGU_SIGNED_UP_VETO_ELSE_HALF":
  return 0. if (bull and ascore<0 and bscore<0) else .5 if bull else .75
 if policy=="MACRO_BULL_REJECT_UNLESS_PENGU_REL_WEAK":
  return 0. if bull and bscore>=ascore else .75
 if policy=="MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT":
  return .5 if bull and ascore>=5 and bscore>=3 else 0. if bull else .75
 if policy=="MACRO_BULL_VETO_ELSE_075_SCORE_GT12_ADD_TO_100":
  return 0. if bull else 1. if score>12 else .75
 raise ValueError("P73_UNKNOWN_POLICY "+policy)
def summary_econ(z):
 return {k:v for k,v in z.items() if k!="capitalTradeLedger"}
def main():
 prior=json.loads(P71.read_text(encoding="utf8"))
 manifest=json.loads(P70.read_text(encoding="utf8"))
 assert manifest["checksumsIndividuallyVerified"] and manifest["officialArchiveCount"]==165
 x=prior["crossVenueSourceCaseAsOfScoreLedger53"]
 assert len(x)==53 and sum(t["sourceNativeWin"] for t in x)==29
 for z in x:
  assert z["dualSigned"]["grossSignedScore"]==sum(z["dualSigned"][f] for f in (
   "asterPENGUSignedPoints","binancePENGUSignedPoints","macroBTCEthereumSignedPoints"))
  assert z["sourceAsterAndBinanceH1EndSameEntryUTC"]
 original,_=source_slot([{**z,"grossAllocation":.75} for z in x])
 assert len(original)==33 and sum(z["sourceNativeWin"] for z in original)==18
 originalKeys={z["key"] for z in original}
 m5,m5sha=load_m5(SOURCES)
 result=[];trace=[]
 for policy in POLICIES:
  new=[{**z,"grossAllocation":allocation(policy,z),
        "score":z["dualSigned"]["grossSignedScore"]} for z in x]
  assert all(z["grossAllocation"] in (0.,.5,.75,1.) for z in new)
  selectedK={z["key"] for z in new if z["grossAllocation"]!=0}
  rejected=[z for z in new if z["grossAllocation"]==0]
  sub={
   "policy":policy,"sourceAll53":53,"sourceNaturalVetoCount":len(rejected),
   "sourceNaturalOriginalWinVetoCount":sum(z["sourceNativeWin"] for z in rejected),
   "sourceNaturalOriginalLossVetoCount":sum(not z["sourceNativeWin"] for z in rejected),
   "original33PreSlotCandidateVetoCount":sum(z["key"] in originalKeys for z in rejected),
   "original33PreSlotOriginalWinnersVetoCount":sum(z["sourceNativeWin"] and z["key"] in originalKeys for z in rejected),
   "original33PreSlotOriginalLosersVetoCount":sum(not z["sourceNativeWin"] and z["key"] in originalKeys for z in rejected),
   "sourceNativeWinGrossAllocationPct":{str(g):sum(z["sourceNativeWin"] and z["grossAllocation"]==g for z in new)
      for g in (0.,.5,.75,1.)},
   "sourceNativeLossGrossAllocationPct":{str(g):sum((not z["sourceNativeWin"]) and z["grossAllocation"]==g for z in new)
      for g in (0.,.5,.75,1.)},
   "cohortDecisions":{cohort:{
       "totalNativeIntents":sum(z["cohort"]==cohort for z in new),
       "vetoed":sum(z["cohort"]==cohort and z["grossAllocation"]==0 for z in new),
       "vetoedOriginalWinners":sum(z["cohort"]==cohort and z["grossAllocation"]==0 and z["sourceNativeWin"] for z in new),
       "vetoedOriginalLosers":sum(z["cohort"]==cohort and z["grossAllocation"]==0 and not z["sourceNativeWin"] for z in new)}
     for cohort in ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV")}}
  trace.append({**sub,"all53EntryDecisions":[{"key":z["key"],"entryTs":z["entryTs"],
     "sourceNativeWin":z["sourceNativeWin"],"originalNet30Pct":z["sourceNativeNet30Pct"],
     "original33":z["key"] in originalKeys,"gross":z["grossAllocation"],
     "signedScore":z["score"],"macroBull":z["dualSigned"]["macroBullBothBTCAndEthereum"]}
     for z in new]})
  for fee,slip in COSTS:
   e=replay(new,m5,fee,slip)
   assert e["sourceRejectedBeforeSlot"]==len(rejected)
   assert e["sourceRejectedWinningSignals"]==sub["sourceNaturalOriginalWinVetoCount"]
   result.append({"policy":policy,"feeBps":fee,"extraCoverSlippageBps":slip,
     "sourceNat53Integrity":True,
     "sourceNoGrossBelow05ForAccepted":True,
     "positionNativeSourcePriceEntryExitUnmodified":True,
     "sourceRejectedBeforeSlot":e["sourceRejectedBeforeSlot"],
     "sourceOriginalWinningIntentsRejected":e["sourceRejectedWinningSignals"],
     "sourceOriginal33WinVetoCount":sub["original33PreSlotOriginalWinnersVetoCount"],
     "sourceOriginal33LossVetoCount":sub["original33PreSlotOriginalLosersVetoCount"],
     "econ":summary_econ(e),
     "positionLedgerNormalFee30":e["capitalTradeLedger"] if fee==30 and slip==0 else None})
 assert len(result)==len(POLICIES)*len(COSTS)
 # Independent historical P71 benchmark for veto and baseline
 p71_map={
  "ORIGINAL_075":"NATIVE_075",
  "ORIGINAL_100":"NATIVE_100",
  "MACRO_BULL_VETO_075":"P71_ONLY_BTC_ETH_BULL_VETO_075",
  "SIGNED_NEGATIVE_VETO_ELSE_075":"P71_SIGNED_DUAL_REJECT_LOWS"
 }
 for newpol,oldpol in p71_map.items():
  if newpol=="SIGNED_NEGATIVE_VETO_ELSE_075":continue # old P71 scaled non-veto gross by score
  for fee,slip in COSTS:
   newz=next(z for z in result if z["policy"]==newpol and z["feeBps"]==fee and z["extraCoverSlippageBps"]==slip)
   oldz=next(z for z in prior["policyGridScenarios"] if z["policy"]==oldpol and z["feeBps"]==fee and z["extraCoverSlipBps"]==slip)
   for k in ("closed","wins","M5HighStressDDPct","finalNAVYen"):
    assert abs(newz["econ"][k]-oldz["econ"][k])<1e-3,(newpol,fee,slip,k)
 normal=[z for z in result if z["feeBps"]==30 and z["extraCoverSlippageBps"]==0]
 stress=[z for z in result if z["feeBps"]==30 and z["extraCoverSlippageBps"]==100]
 # Gate: DD <=20%, preserve NAV >= 0.75 original, all source wins retained are favored, and 100bps coverage.
 reference=next(z for z in normal if z["policy"]=="ORIGINAL_075")["econ"]
 common=[]
 for z in normal:
  s=next(u for u in stress if u["policy"]==z["policy"])
  e=z["econ"];q=s["econ"]
  common.append({"policy":z["policy"],"native33NormalClosed":e["closed"],"normalWinPct":e["winPct"],
    "normalM5DDPct":e["M5HighStressDDPct"],"normalNAV":e["finalNAVYen"],
    "stress100M5DDPct":q["M5HighStressDDPct"],"stress100NAV":q["finalNAVYen"],
    "sourceWinningIntentsRejected":z["sourceOriginalWinningIntentsRejected"],
    "sourceOriginal33WinnersVetoed":z["sourceOriginal33WinVetoCount"],
    "normalDD20Pass":e["M5HighStressDDPct"]<=20,
    "stressDD20Pass":q["M5HighStressDDPct"]<=20,
    "normalNavNonInferiorGross075":e["finalNAVYen"]>=reference["finalNAVYen"],
    "zeroOrAtLeastHalfGrossVerified":True})
 out={
  "schema":"prism7-p73-no-gross025-aster-binance-macro-signed-score-native-source53/v1",
  "status":"RESEARCH_ONLY_ALL_TRADE_SIZES_0_OR_MIN_0P50",
  "sourceNativePinnedSHA":PIN,"original53NativeSignals29WinsUnchanged":True,
  "officialSameCalendarBinance165ZIPVerified":True,
  "sourceOriginalNativeExitStopsUnchanged":True,
  "allowedEntryGrossOptions":[0,.5,.75,1.],
  "gross025ExcludedByOwnerRequest":True,
  "sourceP71OriginalSameClockEntryScoreReusedWithoutRefit":True,
  "sourceCosts":COSTS,
  "predefinedExperimentalPolicies":POLICIES,"scenarios":len(result),
  "allCostScenarios":result,
  "outcomeNormalFee30VsCover100Stress":common,
  "all53DecisionsAndCohortTrace":trace,
  "sourceSHA256":{"P71":sha(P71),"P70":sha(P70),"ASTERPENGUM5":m5sha},
  "limitations":[
   "Original pinned ASTER native source entry/exit prices53 and historical 33 slot. Venue stops, fills, funding, cross-runner risk absent.",
   "Both markets same time but Binance context not native Binance entries; original ASTER results are previously inspected, no fresh unseen independent validation.",
   "Multiple exploratory models are NOT multiple independent opportunities to optimize by best NAV or DD; selected rule must pass external holdout.",
   "Gross1 may breach shared account risk; cannot deploy without owner approval and current SHA / STOP validation.",
   "A veto may reject original large winners: track original source win/loss and original fixed33 winners separately.",
   "Normal DD20 alone does not pass +100bps cover stress or 20% portfolio constraint.",
   "No live original Runner STOP, orders, positions, Gross, Kill Switch, master changed."
  ]}
 OUT.write_text(json.dumps(out,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(z,ensure_ascii=False,sort_keys=True)+"\n" for z in trace),encoding="utf8")
 lines=["# P73 | No gross 0.25: same UTC dual market score & macro market risk decisions",
  "",
  "**Owner change**: If proposed Gross is 0.25 then do not enter; minimum accepted gross 0.5. Test no-trade 0.5 / 0.75 / 1.0 with original ASTER Native V20 source unchanged and Binance verified as time aligned context.",
  "",
  "Gross 1.0 is only a research target; no live policy change. Original ASTER source 53, original single-slot33, 30bps and +100bps cover stress.",
  "",
  "| Variant | Normal: closed/win | DD M5 | NAV | +100 cover DD | +100 NAV | Original source wins vetoed | Meets baseline NAV AND DD20 stress? |",
  "|---|---:|---:|---:|---:|---:|---:|---|"]
 for z in common:
  lines.append("| "+z["policy"]+" | "+str(z["native33NormalClosed"])+"/"+str(next(x["econ"]["wins"] for x in normal if x["policy"]==z["policy"]))+
   " | "+str(z["normalM5DDPct"])+"% | "+str(z["normalNAV"])+" | "+
   str(z["stress100M5DDPct"])+"% | "+str(z["stress100NAV"])+" | "+
   str(z["sourceWinningIntentsRejected"])+" | "+str(z["normalNavNonInferiorGross075"] and z["stressDD20Pass"])+" |")
 lines+=["","No threshold tuning for deployment based on this inspected source53. Research original Native profit exits remain pinned; early STOP5/8 is a different experiment and not folded into this score study.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P73_NO025_MACRO_VETO_HALF_FULL_P71_PRICE_SOURCE_AND_FEE_STRESS_PARITY_PASS",
  json.dumps(common,ensure_ascii=False),flush=True)
 print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
