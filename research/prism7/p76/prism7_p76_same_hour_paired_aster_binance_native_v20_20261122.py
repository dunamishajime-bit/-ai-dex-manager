#!/usr/bin/env python3
"""P76 exact-hour paired original Native V20 ASTER53 vs Binance62 signal audit.

Compare only source Native V20 signal fired at EXACT same UTC hourly timestamp,
with own venue price/entry/Native EXIT, fee30bps, not M5 orderbook fills.
The shared market-information signed score must be IDENTICAL at equal UTC.
Score/veto comparisons on matched pairs are signal-level, NOT a simulation of
two parallel one-slot strategies or actual positions. Unmatched native entry
signals also counted. No gross 0.25, accepted gross min0.5.
"""
from __future__ import annotations
from pathlib import Path
import json,hashlib,statistics,datetime,collections
from collections import Counter,defaultdict
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE
from prism7_p73_no025_dualmarket_score_veto_half_full_20261122 import allocation
P71=R/"PRISM7_P71_DUAL_MARKET_SIGNED_TF_POINTS_NATIVE53_20261122.json"
P74=R/"PRISM7_P74_SAME_CALENDAR_BINANCE_NATIVE_V20_FULL_SOURCE_20261122.json"
P75=R/"PRISM7_P75_BINANCE_NATIVE62_SAME_UTC_DUAL_POINTS_NO025_TRANSFER_20261122.json"
OUT=R/"PRISM7_P76_EXACT_SAME_HOUR_AST_BIN_NATIVE_ENTRY_WIN_AND_SIGNED_SCORE_20261122.json"
MD=R/"PRISM7_P76_EXACT_SAME_HOUR_AST_BIN_NATIVE_ENTRY_WIN_AND_SIGNED_SCORE_20261122.md"
LEDGER=R/"PRISM7_P76_NATIVE53_NATIVE62_SAME_HOUR_27_PAIRED_SIGNAL_LEDGER_20261122.jsonl"
SOURCE_PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rd(x):return round(float(x),6)
def utc(t):return datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat()
POLICIES=("ORIGINAL_075","MACRO_BULL_VETO_075","MACRO_BULL_HALF_ELSE_075",
 "MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT",
 "SIGNED_LESS_MINUS6_VETO_ELSE_075","SIGNED_NEGATIVE_VETO_ELSE_075")
def main():
 a=json.loads(P71.read_text(encoding="utf8"))
 b=json.loads(P75.read_text(encoding="utf8"))
 assert a["sourcePinnedNativeV20SHA"]==b["originalPinnedSourceSHA"]==SOURCE_PIN
 A=a["crossVenueSourceCaseAsOfScoreLedger53"]
 B=b["independentSource62DualMarketAsOfFeatureLedger"]
 assert len(A)==53 and len(B)==62
 assert len({z["entryTs"] for z in A})==53 and len({z["entryTs"] for z in B})==62
 ma={z["entryTs"]:z for z in A};mb={z["entryTs"]:z for z in B}
 matched=sorted(set(ma)&set(mb))
 assert len(matched)==b["sameTimeOriginalNativeEntryOverlap"]["exactSameHourCandidateCount"]==27
 p=[];reason=Counter()
 for t in matched:
  x,y=ma[t],mb[t]
  assert x["entryTs"]==y["entryTs"]
  assert x["dualSigned"]["grossSignedScore"]==y["dualSigned"]["grossSignedScore"]
  for key in ("asterPENGUSignedPoints","binancePENGUSignedPoints","macroBTCEthereumSignedPoints",
      "macroBullBothBTCAndEthereum","bothPENGUWeeklyUp","marketBTCWeeklyDirectionConflict"):
   assert x["dualSigned"][key]==y["dualSigned"][key],(t,key)
  assert abs(x["sourceNativeNet30Pct"]-(100*(1-x["exitPrice"]/x["entryPrice"])-.3))<1e-7
  assert abs(y["sourceNativeNet30Pct"]-(100*(1-y["exitPrice"]/y["entryPrice"])-.3))<1e-7
  aWin=x["sourceNativeWin"];bWin=y["sourceNativeWin"]
  kind=("BOTH_WIN" if aWin and bWin else
        "BOTH_LOSS" if not aWin and not bWin else
        "ASTER_ONLY_WIN" if aWin else "BINANCE_ONLY_WIN")
  reason[kind]+=1
  controls={}
  for policy in POLICIES:
   aa=allocation(policy,x)
   bb=allocation(policy,y)
   assert aa==bb and aa in (0,.5,.75,1.)
   controls[policy]={"sameGrossAmountBothVenues":aa,
     "asterResearchHypotheticalPctGrossAdjusted":rd(aa*x["sourceNativeNet30Pct"]),
     "binanceResearchHypotheticalPctGrossAdjusted":rd(bb*y["sourceNativeNet30Pct"]),
     "sourceBothEntryVetoed":aa==0,
     "asterWinningSignalVetoed":aa==0 and aWin,
     "binanceWinningSignalVetoed":aa==0 and bWin}
  p.append({
   "entryHourUTC":utc(t),"entryTs":t,
   "AsterOriginalSourceKey":x["key"],
   "BinanceOriginalSourceKey":y["key"],
   "asterEntryPrice":x["entryPrice"],"binanceEntryPrice":y["entryPrice"],
   "asterToBinanceEntryPriceRatio":rd(x["entryPrice"]/y["entryPrice"]),
   "asterOriginalNativeExitTs":x["exitTs"],
   "binanceOriginalNativeExitTs":y["exitTs"],
   "asterOriginalExitPrice":x["exitPrice"],
   "binanceOriginalExitPrice":y["exitPrice"],
   "asterNative30bpsNetPct":rd(x["sourceNativeNet30Pct"]),
   "binanceNative30bpsNetPct":rd(y["sourceNativeNet30Pct"]),
   "asterWin":aWin,"binanceWin":bWin,"pairedNativeOutcome":kind,
   "jointSignedPointsIdenticalBeforeEntry":True,
   "jointSignedScore":x["dualSigned"]["grossSignedScore"],
   "macroBullSameAtEntry":x["dualSigned"]["macroBullBothBTCAndEthereum"],
   "asOfJointScore":x["dualSigned"],
   "policies":controls})
 scope={}
 for policy in POLICIES:
  z=[item for item in p if item["policies"][policy]["sameGrossAmountBothVenues"]>0]
  veto=[item for item in p if item["policies"][policy]["sameGrossAmountBothVenues"]==0]
  scope[policy]={"originalPairedSignals27":27,
     "pairedBothAdmitted":len(z),"pairedBothRejected":len(veto),
     "asterWinsRetained":sum(item["asterWin"] for item in z),
     "binanceWinsRetained":sum(item["binanceWin"] for item in z),
     "asterNativeSourceWinSignalsRejected":sum(item["asterWin"] for item in veto),
     "binanceNativeSourceWinSignalsRejected":sum(item["binanceWin"] for item in veto),
     "bothSourceProfitableMatchesKept":sum(item["asterWin"] and item["binanceWin"] for item in z),
     "bothSourceLossesRejected":sum((not item["asterWin"]) and (not item["binanceWin"]) for item in veto),
     "grossAmountUniverse":sorted(set(item["policies"][policy]["sameGrossAmountBothVenues"] for item in p))}
 report={
  "schema":"prism7-p76-exact-matched-hour-original-native-v20-aster53-binance62-source-signed-entry/v1",
  "status":"RESEARCH_PAIRWISE_NATIVE_SIGNAL_OUTCOME_NOT_EXECUTABLE_MULTI_VENUE_PORTFOLIO",
  "sourceOriginalNativePinnedSHA":SOURCE_PIN,
  "asterNativeOriginalNaturalIntents":53,
  "binanceOriginalNativeSameCalendarNaturalIntents":62,
  "pairedExactSameUTCNativeEntryCount":27,
  "pairedNativeOutcomeCount":dict(reason),
  "pairedNativeEntryBothWinCount":reason["BOTH_WIN"],
  "pairedNativeEntryBothLossCount":reason["BOTH_LOSS"],
  "pairedNativeEntryWinDisagreeCount":reason["ASTER_ONLY_WIN"]+reason["BINANCE_ONLY_WIN"],
  "sourceUnpairedASTERNativeCount":53-27,
  "sourceUnpairedBinanceNativeCount":62-27,
  "sourceAll27PreEntrySignedPointParityPass":True,
  "nativeEntryPriceRatios":{
     "min":rd(min(x["asterToBinanceEntryPriceRatio"] for x in p)),
     "median":rd(statistics.median(x["asterToBinanceEntryPriceRatio"] for x in p)),
     "max":rd(max(x["asterToBinanceEntryPriceRatio"] for x in p))},
  "sameUTCButNativeExitPriceAndTimeMayDifferByVenue":True,
  "sourceGrossAllowed0OrMin0p5":True,
  "oneSlotNative33Native38SelectionsNotInterpretedAs27SimultaneousFills":True,
  "pairedPoliciesSourceOutcomeRetention":scope,
  "originalSameHourPairLedger27":p,
  "sourceSHA256":{"P71":sha(P71),"P74":sha(P74),"P75":sha(P75)},
  "limitations":[
    "Native entry and exit timestamps/price from two different exchanges, same time 27 source pairs, no signed fills, no guarantee of identical position or STOP event.",
    "Aster and Binance market prices differ. Native same-hour signal can win on one venue and lose on the other, so pair classification is based on independent Native H1 source outcomes, not shared market price.",
    "Original single-slot Aster33 and Binance38 choose different subsets. Do not interpret full27 paired entry ledger as concurrent filled trades.",
    "All days inspected, cross-venue comparison not untouched independent Aster OOS.",
    "No production gross or stop or runner or orders changes."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(z,ensure_ascii=False,sort_keys=True)+"\n" for z in p),encoding="utf8")
 lines=["# P76 | Exact-hour match of ASTER Native53 and Binance Native62",
  "",
  "Only source Native V20 short signals which fire at EXACT same UTC hour; both use original pinned SHA. Market-regime signed score must be identical prior to same UTC time. Each venue's original native exit price/time evaluated INDEPENDENTLY, 30bps.",
  "",
  "| Exact hour original Native result | Matched source intents |",
  "|---|---:|",
  "| both markets win | "+str(reason["BOTH_WIN"])+" |",
  "| both markets lose | "+str(reason["BOTH_LOSS"])+" |",
  "| ASTER win Binance lose | "+str(reason["ASTER_ONLY_WIN"])+" |",
  "| ASTER lose Binance win | "+str(reason["BINANCE_ONLY_WIN"])+" |",
  "",
  "Exact simultaneous Native signal 27 of ASTER53 and Binance62 (unpaired ASTER26, Binance35). These are NOT 27 one-slot executed trades.",
  "",
  "| 0 or >=0.5 gross policy | retained paired signals | ASTER source wins retained | Binance source wins retained | win disagreement | original source winner pair rejected ASTER/Binance |",
  "|---|---:|---:|---:|---:|---:|"]
 for policy,z in scope.items():
  lines.append("| "+policy+" | "+str(z["pairedBothAdmitted"])+" | "+str(z["asterWinsRetained"])+" | "+
   str(z["binanceWinsRetained"])+" | "+str(reason["ASTER_ONLY_WIN"]+reason["BINANCE_ONLY_WIN"])+" | "+
   str(z["asterNativeSourceWinSignalsRejected"])+"/"+str(z["binanceNativeSourceWinSignalsRejected"])+" |")
 lines+=["","Signed asof score parity verified in every matched hour; differing Native exits/outcomes are real cross-venue source differences, not score timing misalignment. This is NOT a live executed simultaneous trade report.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P76_EXACT_SAME_HOUR_27_NATIVE_AST_BIN_SOURCE_SIGNED_SCORE_PARITY_PASS",
  json.dumps({"sourceASTER53":53,"sourceBinance62":62,"exactPaired":27,
   "wins":dict(reason),"sameScore":True,
   "pairedPolicy":scope},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
