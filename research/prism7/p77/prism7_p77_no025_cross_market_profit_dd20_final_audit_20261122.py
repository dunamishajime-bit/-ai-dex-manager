#!/usr/bin/env python3
"""P77: final validation of 0.25-excluded P73-P76 same-calendar market policies.

Cross-check 19 frozen gross policies in ASTER Native53 vs Binance Native62
subset selected to exact Aster earliest/latest Native ENTRY window.
Requirements: normal 30bps NAV >= respective original gross0.75 baseline,
stress 30bps plus 100bps buy cover M5 high DD <=20%, no 0.25.
Precompute price source similarity to assess cross-venue double-counting:
full hourly AS-OF ASTER source vs official Binance H1 PENGU and BTC, equal UTC.
Paired original native same hour 27 score equality and outcome cross checks.
This is a negative research adjudication, no owner operation or LIVE change.
"""
from __future__ import annotations
import json,hashlib,statistics,math,datetime
from pathlib import Path
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,PENGUH1,BTCH1
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import h1_source
from prism7_p71_aster_binance_signed_multitf_entry_points_20261122 import get_binance
P73=R/"PRISM7_P73_NO_GROSS025_V20_SIGNED_AST_BIN_RISK_REJECT_VS_HALF_20261122.json"
P74=R/"PRISM7_P74_SAME_CALENDAR_BINANCE_NATIVE_V20_FULL_SOURCE_20261122.json"
P75=R/"PRISM7_P75_BINANCE_NATIVE62_SAME_UTC_DUAL_POINTS_NO025_TRANSFER_20261122.json"
P76=R/"PRISM7_P76_EXACT_SAME_HOUR_AST_BIN_NATIVE_ENTRY_WIN_AND_SIGNED_SCORE_20261122.json"
P70=R/"PRISM7_P70_BINANCE_ASTER_COMMON_PERIOD_PUBLIC_ARCHIVE_MANIFEST_20261122.json"
OUT=R/"PRISM7_P77_NO025_CROSS_VENUE_DD20_AND_NAV_RETENTION_FINAL_GATE_20261122.json"
MD=R/"PRISM7_P77_NO025_CROSS_VENUE_DD20_AND_NAV_RETENTION_FINAL_GATE_20261122.md"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rd(x,n=6):return round(float(x),n)
def percentiles(seq,q):
 s=sorted(seq);i=int((len(s)-1)*q/100);return rd(s[i])
def main():
 a=json.loads(P73.read_text(encoding="utf8"))
 b=json.loads(P75.read_text(encoding="utf8"))
 c=json.loads(P76.read_text(encoding="utf8"))
 native=json.loads(P74.read_text(encoding="utf8"))
 manifest=json.loads(P70.read_text(encoding="utf8"))
 assert a["gross025ExcludedByOwnerRequest"] and a["scenarios"]==19*3
 assert b["sourceIndependentBinanceNative62FromUnmodifiedPINOriginal"] and b["sourceNative62ThirtyTwoWins"]
 assert c["pairedExactSameUTCNativeEntryCount"]==27 and c["sourceAll27PreEntrySignedPointParityPass"]
 assert manifest["checksumsIndividuallyVerified"] and manifest["officialArchiveCount"]==165
 assert a["sourceNativePinnedSHA"]==b["originalPinnedSourceSHA"]==c["sourceOriginalNativePinnedSHA"]
 policies=a["predefinedExperimentalPolicies"]
 assert len(policies)==19
 assert set(policies)==set(z["policy"] for z in b["normal30bpsVs100bpsStress"] if z["scope"]=="fullP74")
 aTab={z["policy"]:z for z in a["outcomeNormalFee30VsCover100Stress"]}
 bTab={z["policy"]:z for z in b["normal30bpsVs100bpsStress"] if z["scope"]=="withinAsterNativeFirstToLastEntry"}
 bFull={z["policy"]:z for z in b["normal30bpsVs100bpsStress"] if z["scope"]=="fullP74"}
 assert len(aTab)==len(bTab)==len(bFull)==19 and set(aTab)==set(bTab)==set(bFull)
 baseA=aTab["ORIGINAL_075"]["normalNAV"]
 baseB=bTab["ORIGINAL_075"]["NAVJPY"]
 audited=[]
 both=[]
 for policy in policies:
  x=aTab[policy];y=bTab[policy];full=bFull[policy]
  checkA=x["normalNAV"]>=baseA and x["stress100M5DDPct"]<=20
  checkB=y["NAVJPY"]>=baseB and y["M5HighDDPlus100bps"]<=20
  if checkA and checkB:both.append(policy)
  audited.append({"rule":policy,
    "GrossAllowed0OrMin0p5":True,
    "AsterNormalFee30":{"closed":x["native33NormalClosed"],"winPct":x["normalWinPct"],
       "DDM5HighPct":x["normalM5DDPct"],"NAVJPY":x["normalNAV"],
       "DDM5HighPlus100Cover":x["stress100M5DDPct"],
       "NAVplus100":x["stress100NAV"],
       "sourceWinsRejected":x["sourceWinningIntentsRejected"],
       "baselineNavNoninferior":x["normalNAV"]>=baseA,
       "slippageStressDD20":x["stress100M5DDPct"]<=20},
    "BinanceSameAsterEntryRange":{"closed":y["nativeOneSlotClosed"],"wins":y["wins"],
       "DDM5HighPct":y["M5HighDDPct"],"NAVJPY":y["NAVJPY"],
       "DDM5HighPlus100Cover":y["M5HighDDPlus100bps"],
       "NAVplus100":y["NAVPlus100bps"],
       "sourceWinsRejected":y["nativeNaturalWinnersVetoed"],
       "baselineNavNoninferior":y["NAVJPY"]>=baseB,
       "slippageStressDD20":y["M5HighDDPlus100bps"]<=20},
    "BinanceFullAugNov":{"closed":full["nativeOneSlotClosed"],"wins":full["wins"],
       "DDM5HighPct":full["M5HighDDPct"],"NAVJPY":full["NAVJPY"],
       "DDM5HighPlus100Cover":full["M5HighDDPlus100bps"],
       "sourceWinsRejected":full["nativeNaturalWinnersVetoed"]},
    "AsterGate":bool(checkA),"BinanceGate":bool(checkB),
    "BothPass":bool(checkA and checkB)})
 assert not both
 assert aTab["MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT"]["normalNAV"]==15683.87
 assert bTab["MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT"]["NAVJPY"]==15949.71
 assert bFull["MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT"]["M5HighDDPlus100bps"]>20
 astp,_=h1_source(PENGUH1);astb,_=h1_source(BTCH1)
 binp,_=get_binance("PENGUUSDT");binb,_=get_binance("BTCUSDT")
 assert len(astp)==11376 and len(binp)==12120
 matchedSeries={}
 for name,aarr,barr in (("PENGUUSDT",astp,binp),("BTCUSDT",astb,binb)):
  assert all(aarr[i]["time"]==barr[i+744]["time"] for i in range(len(aarr)))
  closeDiff=[abs(100*(aarr[i]["close"]/barr[i+744]["close"]-1)) for i in range(len(aarr))]
  ax=[aarr[i]["close"]/aarr[i-1]["close"]-1 for i in range(1,len(aarr))]
  bx=[barr[i+744]["close"]/barr[i+743]["close"]-1 for i in range(1,len(aarr))]
  matchedSeries[name]={"hourlyOverlapCount":11376,
   "medianAbsoluteH1CloseSpreadPct":rd(statistics.median(closeDiff)),
   "p95AbsH1CloseSpreadPct":percentiles(closeDiff,95),
   "p99AbsH1CloseSpreadPct":percentiles(closeDiff,99),
   "maxAbsH1CloseSpreadPct":rd(max(closeDiff)),
   "H1ReturnCorrelation":rd(statistics.correlation(ax,bx)),
   "hoursWithAbsH1CloseSpreadOver1pct":sum(d>1 for d in closeDiff)}
 paired=c["originalSameHourPairLedger27"]
 corr=statistics.correlation([z["asterNative30bpsNetPct"] for z in paired],
   [z["binanceNative30bpsNetPct"] for z in paired])
 results={
  "sourceNativeV20SameHour27":27,
  "sameHourBothWin":c["pairedNativeEntryBothWinCount"],
  "sameHourBothLoss":c["pairedNativeEntryBothLossCount"],
  "sameHourWinsDiffer":c["pairedNativeEntryWinDisagreeCount"],
  "exactSameHourSourceEntryPairExitSameH1":sum(z["asterOriginalNativeExitTs"]==z["binanceOriginalNativeExitTs"] for z in paired),
  "exactSameHourPairNativeNet30ReturnCorrelation":rd(corr),
  "exactSameHourNative30ReturnMeanAbsPctpointDiff":rd(statistics.mean(abs(z["asterNative30bpsNetPct"]-z["binanceNative30bpsNetPct"]) for z in paired)),
  "allPairedSignedScoreParityPass":True}
 report={
  "schema":"prism7-p77-no025-same-cal-2venue-19policy-profit-and-stress-dd20-eligibility/v1",
  "status":"NO_POLICY_PASSES_BOTH_MARKETS_WITH_NAV_RETENTION_AND_PLUS100BPS_DD20",
  "sourcePinnedNativeSHA":"1657e173d250ad58f53e62f7bb0a3428fb405496",
  "gross025NotPermitted":True,"perAcceptedTradeGrossMinimum":.5,
  "test0_0p5_0p75_1Only":True,
  "P70BinanceOfficial165ZIPsPublicSHA256Verified":True,
  "P73NativeAster53OriginalWins29":True,
  "P74BinanceNative62OriginalWins32":True,
  "P75SameCalendarCrossVenueMarketsNotSourcePairedFills":True,
  "source27ExactSourceParities":results,
  "sourceHourlyMarketSimilarity":matchedSeries,
  "originalAsterSource33Baseline30bpsNAVJPY":baseA,
  "binanceStrictSameAsterWindowSource35Baseline30bpsNAVJPY":baseB,
  "crossMarketTestPoliciesCount":19,
  "criteria":"each market 30bps normal compounding NAV>=respective Gross0.75 original baseline, and 30bps + extra 100bps cover mark high DD<=20%; no gross0.25",
  "crossMarketPoliciesPassingCount":len(both),
  "crossMarketPoliciesPassing":both,
  "all19FrozenPolicyComparison":audited,
  "researchDecision":"NO_DEPLOY. Stop searching post-hoc threshold splits among these already viewed Native53/Native62. Additional truly new ASTER source and source orderbook fills for independent validation; consider paired confidence point signs rather than double weight highly-correlated ASTER+Binance BTC.",
  "sourceSHA256":{"P73":sha(P73),"P74":sha(P74),"P75":sha(P75),"P76":sha(P76),"P70":sha(P70)},
  "limitations":[
   "Gross 0.25 excluded by user, zero entry (veto) allowed; gross .5, .75,1.0 unapproved production test candidates.",
   "Aster source H1+M5 high DD is research not actual account portfolio risk; Binance Native V20 own H1 exits with M5 mark, not signed STOP fills.",
   "Original Aster/Binance prices close at shared source times, highly correlated, do not treat as two independent datasets for statistical OOS. Verify original Aster provider provenance.",
   "Tested 19 fixed P73 model families after seeing all original Native53 price outcomes; strict performance comparison is an in-sample stress test not future alpha proof.",
   "Binance strict source window uses Aster first and last Native entry clock boundaries, so it is a same-time calendar cohort not identical positions.",
   "Account-level shared gross, funding, stop triggers, orderbook liquidity and production risk gate unmodeled.",
   "No code/runner/position/STOP/Gross/master changed on production."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 lines=["# P77 — Gross0.25 excluded; same-calendar Aster+Binance signed points / DD20 & profit final decision",
  "",
  "**Conclusion: 19 entry-risk policies use only veto, gross0.5,0.75,1.0. NONE met both venue source models simultaneously with no lower NAV and 30bps+extra100bps buy-cover DD <=20%. No live adoption.**",
  "",
  "Aster Native53 original baseline 33 one-slot 18 wins NAV ¥"+str(baseA)+
  "; Binance Native62 same Aster first-last entry window baseline 35 one-slot20 wins NAV ¥"+str(baseB)+". In the full Aug1-Nov14 Binance source baseline 38/21.",
  "",
  "| Entry policy | Aster closed / NAV | Aster DD+100bps | Binance exact Aster window closed / NAV | Binance DD+100bps | Both pass? |",
  "|---|---:|---:|---:|---:|---:|"]
 for x in audited:
  a=x["AsterNormalFee30"];b=x["BinanceSameAsterEntryRange"]
  lines.append("| "+x["rule"]+" | "+str(a["closed"])+"/"+str(a["NAVJPY"])+
    " | "+str(a["DDM5HighPlus100Cover"])+"% | "+
    str(b["closed"])+"/"+str(b["NAVJPY"])+" | "+
    str(b["DDM5HighPlus100Cover"])+"% | "+str(x["BothPass"])+" |")
 lines+=["",
  "Aster best exploratory macro bull + relative PENGU weakness: 30 trades 18 wins, normal M5 DD15.49%, NAV ¥15,683.87, stressed DD17.57%. Binance strictly matched calendar: 30 trades 18 wins, DD14.73%, NAV ¥15,949.71 versus original ¥17,769.89; fails profit retention even though stress DD16.67%. Binance full Aug1-Nov14 33/19, DD18.95%, NAV ¥14,574 versus original ¥16,237, stress DD21.57%.",
  "",
  "Exact matching entry hours: Aster Native53 and Binance Native62 fire simultaneously in 27 hours: 15 both win, 12 both lose, zero mixed. Signed score identical at each hour; 25 exit hour identical, remaining two differ by one hour. Native return correlation 0.99922 on these 27 paired price-source trades, so NOT independent outcome sets.",
  "",
  "H1 close-price market similarities: "+str(matchedSeries),
  "",
  "**Risk interpretation:** changing gross from0.25 to 0.5 improves trade significance but must not be accepted merely for low DD. Full trade retention/expected growth and realistic +100bps DD <=20% are both requirements. Some no-entry vetoes remove original winning signals; the original V20 is strongly profitable in some systemic bull environments. Gross1 is not defensible currently.",
  "",
  "**Research next:** fix market trend as signed score but use ASTER/Binance agreement / spread divergence as confidence, NOT doubled same PENGU/BTC trend points. Distinguish systemic BTC/ETH weekly/daily bull from PENGU 12H remaining downside and 4H/1H rebound rejection, then test on truly fresh Aster period/market with Native full stop execution, fees, funding, shared risk. Code changes and trading permissions remain zero.",
  ""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P77_NO025_19_POLICY_AST_BIN_SAME_CALENDAR_CROSS_PROFIT_STRESS20_NONE_PASS_AUDIT",
  json.dumps({"policies":19,"bothPass":len(both),
   "matchedPriceSources":matchedSeries,
   "pairedOriginalNative27":results,
   "asterBaselineNAV":baseA,"binanceBaselineNAV":baseB},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD)
if __name__=="__main__":main()
