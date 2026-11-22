#!/usr/bin/env python3
"""P71 experimental pre-entry joint ASTER+Binance signed-score, negative points.

Native PENGU V20 source signals (ASTER) are kept immutable; Binance PENGU/BTC
and ETH 1H are contemporaneous CONTEXT ONLY. Exactly the same UTC completed
candle timestamps used, never future candles. Separate venues are never pooled
as OHLCV or used as Aster EXIT fills.

Signed trend:
 ASTER PENGU W,D,12H,4H,1H weights 5,4,3,2,1: DOWN +weight, UP -weight.
 Binance PENGU same time 3,2,2,1,1: DOWN +, UP -.
 Astro/Binance BTC macro weekly/daily and Binance ETH weekly/daily:
 risk penalties if 4-week BTC trend / 7-day market up, mild positives if down.
 Large positive BTC macro overrides isolated PENGU weakness by extra penalty.

Each preset threshold is provisional research, not optimized/trained on known
Native53 result. Costs 10/30bps and cover+100bps, source one-slot economic
DD M5, gross per original candidate 0..1, retain original W/D strict source
cache and independent original native53 price parity. Actual live unchanged.
"""
from __future__ import annotations
import hashlib,json,gzip,statistics,datetime,math,bisect
from collections import Counter,defaultdict
from pathlib import Path
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,PENGUH1,BTCH1,SOURCE,SOURCES
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import h1_source
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p66_native53_multitimeframe_score_size_20261122 import (
 aggregates,trend_features,TF_HOURS,replay)
P66=R/"PRISM7_P66_NATIVE53_MULTI_TF_TREND_POINT_SIZE_GROSS1_20261122.json"
P70=R/"PRISM7_P70_BINANCE_ASTER_COMMON_PERIOD_PUBLIC_ARCHIVE_MANIFEST_20261122.json"
OUT=R/"PRISM7_P71_DUAL_MARKET_SIGNED_TF_POINTS_NATIVE53_20261122.json"
LEDGER=R/"PRISM7_P71_ASTER_BINANCE_NATIVE53_ENTRY_ASOF_NEGATIVE_POINTS_LEDGER_20261122.jsonl"
MD=R/"PRISM7_P71_DUAL_MARKET_NEGATIVE_TREND_SCORE_GROSS_20261122.md"
BASE=R.parent/"p70_binance_same_aster_period_202507_202611"/"verified_series"
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
SOURCE_WEIGHTS_ASTER={"W":5,"D":4,"12H":3,"4H":2,"1H":1}
SOURCE_WEIGHTS_BINANCE={"W":3,"D":2,"12H":2,"4H":1,"1H":1}
POLICIES=(
 "NATIVE_075",
 "NATIVE_100",
 "P66_ORIGINAL_DOWN_ONLY_LAX",
 "P71_SIGNED_DUAL_REJECT_LOWS",
 "P71_SIGNED_DUAL_NO_REJECT",
 "P71_SIGNED_DUAL_REJECT_MACRO_BULL",
 "P71_SIGNED_DUAL_CAP_MACRO_BULL",
 "P71_SIGNED_DUAL_CAP_VENUE_DISAGREEMENT",
 "P71_SIGNED_DUAL_CONSERVATIVE_REJECT",
 "P71_ONLY_BOTH_VENUE_PENGU_MACRO_UP_VETO_075",
 "P71_ONLY_BTC_ETH_BULL_VETO_075",
 "P71_ONLY_BTC_ETH_BULL_CAP025_075",
)
FEE_STRESS=((10,0),(30,0),(30,100))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rd(x):return round(float(x),6)
def tfcache(rows):
 return {name:(a,[x["end"] for x in a]) for name in TF_HOURS for a in [aggregates(rows,name)]}
def get_binance(sym):
 p=BASE/(f"{sym}-1h-20250701-20261118-FUTURES_UM_VERIFIED.jsonl.gz")
 data=p.read_bytes()
 with gzip.open(p,"rt",encoding="utf8") as f:
  rows=[json.loads(x) for x in f if x.strip()]
 out=[{"time":int(x[0]),"open":float(x[1]),"high":float(x[2]),
       "low":float(x[3]),"close":float(x[4]),"volume":float(x[5])}
      for x in rows]
 assert len(out)==12120
 return out,sha(p)
def tf_sign(state):
 if not state["known"]:return 0
 return 1 if state["trend"]=="DOWN" else -1 if state["trend"]=="UP" else 0
def asof_close_history(cache,name,ts):
 arr,ends=cache[name]
 i=bisect.bisect_right(ends,ts)-1
 if i<0:return []
 assert arr[i]["end"]<=ts
 return arr[:i+1]
def macro_direction(cache,ts):
 # Two independent time scales to catch established W-long bull when daily
 # temporarily falls (strict W/D consecutive-up gate misses both).
 w=asof_close_history(cache,"W",ts)
 d=asof_close_history(cache,"D",ts)
 wk=None;dy=None
 if len(w)>=5 and all(w[-j]["end"]==w[-j+1]["start"] for j in range(2,6)):
  before=w[-5]["close"]
  wkret=w[-1]["close"]/before-1
  wk=("UP" if wkret>=.03 and w[-1]["close"]>statistics.mean(z["close"] for z in w[-4:])
      else "DOWN" if wkret<=-.03 and w[-1]["close"]<statistics.mean(z["close"] for z in w[-4:])
      else "MIXED")
  weekStats={"weekEnd":w[-1]["end"],"pct4ClosedWeeks":rd(100*wkret),"state":wk}
 else:weekStats={"state":"UNKNOWN"}
 if len(d)>=8 and all(d[-j]["end"]==d[-j+1]["start"] for j in range(2,9)):
  dayret=d[-1]["close"]/d[-8]["close"]-1
  dy=("UP" if dayret>=.02 and d[-1]["close"]>statistics.mean(z["close"] for z in d[-7:])
      else "DOWN" if dayret<=-.02 and d[-1]["close"]<statistics.mean(z["close"] for z in d[-7:])
      else "MIXED")
  dayStats={"dayEnd":d[-1]["end"],"pct7ClosedDays":rd(100*dayret),"state":dy}
 else:dayStats={"state":"UNKNOWN"}
 return {"W4":weekStats,"D7":dayStats}
def score_joint(asterP,binP,macroAB,macroBB,macroEth):
 # Positive PENGU bear, negative PENGU bull, all calendar-aligned.
 def market_signatures(trends,weights):
  return {name:weights[name]*tf_sign(trends[name]) for name in weights}
 own=market_signatures(asterP,SOURCE_WEIGHTS_ASTER)
 alt=market_signatures(binP,SOURCE_WEIGHTS_BINANCE)
 macroFlags={
  "asterBTCWeeklyUp":macroAB["W4"]["state"]=="UP",
  "asterBTCDailyUp":macroAB["D7"]["state"]=="UP",
  "binanceBTCWeeklyUp":macroBB["W4"]["state"]=="UP",
  "binanceBTCDailyUp":macroBB["D7"]["state"]=="UP",
  "binanceETHWeeklyUp":macroEth["W4"]["state"]=="UP",
  "binanceETHDailyUp":macroEth["D7"]["state"]=="UP",
  "asterBTCWeeklyDown":macroAB["W4"]["state"]=="DOWN",
  "asterBTCDailyDown":macroAB["D7"]["state"]=="DOWN",
  "binanceBTCWeeklyDown":macroBB["W4"]["state"]=="DOWN",
  "binanceBTCDailyDown":macroBB["D7"]["state"]=="DOWN",
  "binanceETHWeeklyDown":macroEth["W4"]["state"]=="DOWN",
  "binanceETHDailyDown":macroEth["D7"]["state"]=="DOWN"
 }
 risk={
  "AsterBTCWeekly":(-3 if macroFlags["asterBTCWeeklyUp"] else 1 if macroFlags["asterBTCWeeklyDown"] else 0),
  "AsterBTCDaily":(-2 if macroFlags["asterBTCDailyUp"] else 1 if macroFlags["asterBTCDailyDown"] else 0),
  "BinanceBTCWeekly":(-2 if macroFlags["binanceBTCWeeklyUp"] else 1 if macroFlags["binanceBTCWeeklyDown"] else 0),
  "BinanceBTCDaily":(-1 if macroFlags["binanceBTCDailyUp"] else 1 if macroFlags["binanceBTCDailyDown"] else 0),
  "BinanceETHWeekly":(-2 if macroFlags["binanceETHWeeklyUp"] else 1 if macroFlags["binanceETHWeeklyDown"] else 0),
  "BinanceETHDaily":(-1 if macroFlags["binanceETHDailyUp"] else 1 if macroFlags["binanceETHDailyDown"] else 0)}
 systemMacroBull=(macroFlags["asterBTCWeeklyUp"] and macroFlags["binanceBTCWeeklyUp"] and
                  (macroFlags["binanceETHWeeklyUp"] or macroFlags["binanceETHDailyUp"]))
 if systemMacroBull:risk["BTC_2Venues_ETH_ConfirmedBullPenalty"]=-3
 # Uncertain when one venue strongly W4 BTC up, opposite venue W4 BTC down.
 conflict=(macroFlags["asterBTCWeeklyUp"] and macroFlags["binanceBTCWeeklyDown"] or
   macroFlags["asterBTCWeeklyDown"] and macroFlags["binanceBTCWeeklyUp"])
 if conflict:risk["BTC_DifferentVenueTrendConflict"]=-2
 pts=sum(own.values())+sum(alt.values())+sum(risk.values())
 return {
  "asterPENGUSignedPoints":sum(own.values()),
  "binancePENGUSignedPoints":sum(alt.values()),
  "macroBTCEthereumSignedPoints":sum(risk.values()),
  "grossSignedScore":pts,
  "componentPoints":{"asterPENGU":own,"binancePENGU":alt,"macroBTCETH":risk},
  "macroBullBothBTCAndEthereum":systemMacroBull,
  "marketBTCWeeklyDirectionConflict":conflict,
  "bothPENGUWeeklyUp":asterP["W"]["trend"]=="UP" and binP["W"]["trend"]=="UP",
  "asterBTCandBinanceBTCbothDailyUp":macroFlags["asterBTCDailyUp"] and macroFlags["binanceBTCDailyUp"],
  "macroFlags":macroFlags,
 }
def allocation(policy,features):
 pts=features["grossSignedScore"]
 if policy=="NATIVE_075":return .75
 if policy=="NATIVE_100":return 1.
 if policy=="P66_ORIGINAL_DOWN_ONLY_LAX":
  score=features["P66OriginalPositiveOnlyAsterScore"]
  return (0 if score<=3 else .5 if score<=6 else .75 if score<=10 else 1.)
 if policy.startswith("P71_ONLY_"):
  if policy=="P71_ONLY_BOTH_VENUE_PENGU_MACRO_UP_VETO_075":
   return 0 if features["bothPENGUWeeklyUp"] else .75
  if policy=="P71_ONLY_BTC_ETH_BULL_VETO_075":
   return 0 if features["macroBullBothBTCAndEthereum"] else .75
  if policy=="P71_ONLY_BTC_ETH_BULL_CAP025_075":
   return .25 if features["macroBullBothBTCAndEthereum"] else .75
 if policy=="P71_SIGNED_DUAL_NO_REJECT":
  base=.25 if pts<0 else .5 if pts<6 else .75 if pts<13 else 1.
 elif policy=="P71_SIGNED_DUAL_CONSERVATIVE_REJECT":
  base=0 if pts<5 else .5 if pts<10 else .75 if pts<16 else 1.
 else:
  base=0 if pts<0 else .5 if pts<6 else .75 if pts<13 else 1.
 if policy=="P71_SIGNED_DUAL_REJECT_MACRO_BULL" and features["macroBullBothBTCAndEthereum"]:
  return 0
 if policy=="P71_SIGNED_DUAL_CAP_MACRO_BULL" and features["macroBullBothBTCAndEthereum"]:
  return min(base,.25)
 if policy=="P71_SIGNED_DUAL_CAP_VENUE_DISAGREEMENT" and features["marketBTCWeeklyDirectionConflict"]:
  return min(base,.5)
 return base
def main():
 p70=json.loads(P70.read_text(encoding="utf8"))
 assert p70["officialArchiveCount"]==165 and p70["checksumsIndividuallyVerified"]
 p66=json.loads(P66.read_text(encoding="utf8"))
 original53=p66["native53OriginalSignalEntryAsOfMarketTrendRows"]
 assert len(original53)==53
 bp,bpSha=get_binance("PENGUUSDT")
 bb,bbSha=get_binance("BTCUSDT")
 be,beSha=get_binance("ETHUSDT")
 ap,apSha=h1_source(PENGUH1);ab,abSha=h1_source(BTCH1)
 assert len(ap)==len(ab)==11376 and len(bp)==len(bb)==len(be)==12120
 assert all(ap[i]["time"]==ab[i]["time"] for i in range(len(ap)))
 commonStart=ap[0]["time"];commonEnd=ap[-1]["time"]+3600000
 assert all(bp[i+744]["time"]==ap[i]["time"] for i in range(len(ap)))
 acp=tfcache(ap);acb=tfcache(ab);bcp=tfcache(bp);bcb=tfcache(bb);bce=tfcache(be)
 ast=[]
 for z in original53:
  entry=z["entryTs"]
  pt=trend_features(acp,acb,entry)
  bt=trend_features(bcp,bcb,entry)
  assert pt["weightedDownPoints"]==z["score"],("P66_PARITY",z["key"])
  assert bt["entryTs"]==pt["entryTs"]==entry
  mA=macro_direction(acb,entry)
  mB=macro_direction(bcb,entry)
  mE=macro_direction(bce,entry)
  signed=score_joint(pt["penguTrend"],bt["penguTrend"],mA,mB,mE)
  signed["P66OriginalPositiveOnlyAsterScore"]=z["score"]
  ast.append({**z,
     "sourceNative53OriginalPinnedSHA":PIN,
     "sourceAsterAndBinanceH1EndSameEntryUTC":True,
     "BinanceNotOriginalAsterEntryExecutionVenue":True,
     "dualSigned":signed,
     "binancePENGUCompletedCandleTrends":bt["penguTrend"],
     "binanceBTCCompletedCandleTrends":bt["btcTrend"],
     "macroAsterBTC":mA,"macroBinanceBTC":mB,"macroBinanceETH":mE})
 assert len(ast)==53 and sum(x["sourceNativeWin"] for x in ast)==29
 m5,m5sha=load_m5(SOURCES)
 models=[]
 for policy in POLICIES:
  rows=[{**x,"grossAllocation":allocation(policy,x["dualSigned"]),
      "score":x["dualSigned"]["grossSignedScore"]} for x in ast]
  for fee,slip in FEE_STRESS:
   out=replay(rows,m5,fee,slip)
   models.append({"policy":policy,"feeBps":fee,"extraCoverSlipBps":slip,
     "asOfNoNextBarData":True,"BinanceAsContextOnly":True,
     "sourceNaturalVetoed":out["sourceRejectedBeforeSlot"],
     "sourceNativeOriginalWinnersVetoed":out["sourceRejectedWinningSignals"],
     "originalSource53SignalsPreserved":True,
     "econ":{k:v for k,v in out.items() if k!="capitalTradeLedger"},
     "selectedSlotLedger30bps":out["capitalTradeLedger"] if fee==30 and slip==0 else None})
 assert len(models)==len(POLICIES)*len(FEE_STRESS)
 normal=[z for z in models if z["feeBps"]==30 and z["extraCoverSlipBps"]==0]
 base=next(z for z in normal if z["policy"]=="NATIVE_075")
 p66ref=next(z for z in p66["allPolicyEconomicScenarios"] if
  z["policy"]=="NATIVE_UNCHANGED_075" and z["feeBps"]==30 and z["extraCoverSlipBps"]==0)
 for k in ("closed","wins","M5HighStressDDPct","finalNAVYen"):
  assert abs(base["econ"][k]-p66ref["economic"][k])<.001,(k,base["econ"][k],p66ref["economic"][k])
 old=next(z for z in normal if z["policy"]=="P66_ORIGINAL_DOWN_ONLY_LAX")
 p66old=next(z for z in p66["allPolicyEconomicScenarios"] if
  z["policy"]=="POINTS_LAX" and z["feeBps"]==30 and z["extraCoverSlipBps"]==0)
 for k in ("closed","wins","M5HighStressDDPct","finalNAVYen"):
  assert abs(old["econ"][k]-p66old["economic"][k])<.001,(k,old["econ"][k],p66old["economic"][k])
 # Itemize loss/wins by signed score and risk flags; do NOT fit weights on outcomes.
 sourceByScore=defaultdict(list)
 for z in ast:
  s=z["dualSigned"]["grossSignedScore"]
  band=("<0" if s<0 else "0_to5" if s<6 else "6_to12" if s<13 else "13plus")
  sourceByScore[band].append(z)
 sourceFlags={}
 for flag in ("macroBullBothBTCAndEthereum","marketBTCWeeklyDirectionConflict",
       "bothPENGUWeeklyUp","asterBTCandBinanceBTCbothDailyUp"):
  group=[z for z in ast if z["dualSigned"][flag]]
  sourceFlags[flag]={"nativeSource53Matching":len(group),"originalWinnerCases":sum(z["sourceNativeWin"] for z in group),
    "originalLoserCases":sum(not z["sourceNativeWin"] for z in group)}
 scoreBands={k:{"n":len(z),"nativeWins":sum(x["sourceNativeWin"] for x in z),
                   "nativeLosers":sum(not x["sourceNativeWin"] for x in z)}
            for k,z in sorted(sourceByScore.items())}
 report={
  "schema":"prism7-p71-source53-aster-binance-shared-clock-signed-score-negative-point-macro-trend/v1",
  "status":"RESEARCH_ONLY_NOT_VALIDATED_PRODUCTION_ENTRY_RULE",
  "sourcePinnedNativeV20SHA":PIN,
  "p70Verified165PublicOfficialArchiveSHA":True,
  "sourceOriginalNative53EntryExitPriceUnmodified":True,
  "binanceUSDMAsterSameTimestampJoinAll53":True,
  "fiveTFWeightedAsterPositiveAndNegative":SOURCE_WEIGHTS_ASTER,
  "fiveTFWeightedBinancePositiveAndNegative":SOURCE_WEIGHTS_BINANCE,
  "marketPenaltyDefinition":"Aster/Binance BTC 4 closed weeks >=+3pct and 7 full closed days >=+2pct; Binance ETH confirms market; symmetric mild downtrend bonus, risk conflicts penalty",
  "sourceSignedBinRiskMacroThreeSubscoreAudit":True,
  "sourceM5AsterExecutionDoesNotUseBinancePrices":True,
  "sourceNative53OriginalWins29Parity":True,
  "sourceAsOfWeekDay12h4h1hOnlyFullClosedCandle":True,
  "scoreRulesAndPoliciesPreDeclared":POLICIES,
  "crossVenueSourceCaseAsOfScoreLedger53":ast,
  "sourceSignedPointBandConfusion":scoreBands,
  "sourceMacroRiskFlagOutcomes":sourceFlags,
  "policyGridScenarios":models,"normal30bpsNoExtraSlip":normal,
  "scenarioCount":len(models),
  "sourceSHA256":{"P70":sha(P70),"P66":sha(P66),
    "ASTERPENGUH1":apSha,"ASTERBTCH1":abSha,
    "BINANCEPENGUH1":bpSha,"BINANCEBTCH1":bbSha,
    "BINANCEETHH1":beSha,"ASTERPENGUM5":m5sha},
  "limitations":[
   "Source PENGU V20 is executed on Aster price source. Binance PENGU BTC ETH are synchronous CONTEXT ONLY, not venue aggregation or proof of Binance Native short signal.",
   "53 original natural overlapping V20 signal intents. Single slot fills price proxy only; P66 Native exit and STOP values retained.",
   "Both markets correlated and may double count crypto directional beta, weighted points are exploratory no validation.",
   "Macro 4w +3pct and 7d +2pct provisional trend thresholds, need independent future data for calibration; different regimes/market liquidity can break.",
   "Price series already known, score exploration on prior inspected Aster53 is in-sample. No untouched original Aster forward OOS.",
   "BTC/ETH macro combined W and D regime may differ from stricter two-consecutive closed up candles; no current forming candle or future price is read.",
   "No actual shared risk/account DD, signed stops, full exchange orderbook/venue fees/funding. No production change."]
 }
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in ast),encoding="utf8")
 lines=["# P71 | Aster+Binance SAME UTC Multi-TF Signed Score with NEGATIVE points",
  "",
  "Original Native PENGU SHORT V20 53 Aster signal entry/exits exactly retained. Binance PENGU/BTC/ETH 1h from P70 same-calendar SHA-verified official source. Downtrend positive points, UPTREND negative points. Extra negative for confirmed BTC/ETH macro bull; every score uses only completed candles. Gross per candidate 0-1.0.",
  "",
  "| Entry rule | Source vetoed | Winning native source rejected | Single-slot closed | Wins | M5 max DD | 10k NAV yen |",
  "|---|---:|---:|---:|---:|---:|---:|"]
 for z in normal:
  e=z["econ"]
  lines.append("| "+z["policy"]+" | "+str(e["sourceRejectedBeforeSlot"])+
   " | "+str(e["sourceRejectedWinningSignals"])+
   " | "+str(e["closed"])+" | "+str(e["wins"])+" | "+str(e["M5HighStressDDPct"])+"% | "+str(e["finalNAVYen"])+" |")
 lines+=["","Macro risk flags by all53 Native candidates: "+str(sourceFlags),
  "","Source signed score outcome bands: "+str(scoreBands),
  "","**Not deployable:** Source53 previously inspected, BTC market and PENGU signals correlated across venues. New source same-UTC improves temporal comparability only, not independent validation. Verify lost winners, capital/gross and stress. Production unchanged.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P71_DUAL_MARKET_SAME_UTC_SIGNED_NEGATIVE_POINTS_NATIVE53_P66_BASELINE_PARITY_PASS",
  json.dumps({"signedScoreBands":scoreBands,"macroFlags":sourceFlags,"count":len(models),
   "regular":[{"policy":z["policy"],"veto":z["econ"]["sourceRejectedBeforeSlot"],
     "rejectedWinners":z["econ"]["sourceRejectedWinningSignals"],
     "n":z["econ"]["closed"],"wins":z["econ"]["wins"],
     "DD":z["econ"]["M5HighStressDDPct"],"NAV":z["econ"]["finalNAVYen"]}
     for z in normal]},ensure_ascii=False),flush=True)
 print("FILES",OUT,LEDGER,MD)
if __name__=="__main__":main()
