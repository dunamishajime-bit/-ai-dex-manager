#!/usr/bin/env python3
"""P75: test P73 fixed dual-venue Aster/Binance joint market entry rule on
INDEPENDENT Binance Native V20 source from SAME UTC 2025Aug-2026Nov.

P74 PENGU/BTC pinned V20 native H1 signals+exits on Binance, 62 natural.
P73 0/.5/.75/1 gross policy imported UNCHANGED. Binance H1/M5 P70 SHA
official verified, Aster H1 context same entry timestamp only.
Binance original prices/fills for source independent of Aster original 53.
Replay source price only M5 high DD and capital, no real signed STOP.
Also exact Aster source Native53 first to last entry timestamp subwindow,
independent per-venue signal population compared, not falsely signal paired.
This is different market and formerly inspected dates, not new unseen OOS,
so failed transfer definitively blocks adoption; passing only research.
"""
from __future__ import annotations
from pathlib import Path
import json,datetime,bisect,hashlib,collections
from collections import Counter,defaultdict
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,PENGUH1,BTCH1,SOURCE
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import h1_source
from prism7_p71_aster_binance_signed_multitf_entry_points_20261122 import (
 tfcache,get_binance,macro_direction,score_joint)
from prism7_p66_native53_multitimeframe_score_size_20261122 import trend_features,replay
from prism7_p73_no025_dualmarket_score_veto_half_full_20261122 import allocation
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import source_slot
P74=R/"PRISM7_P74_SAME_CALENDAR_BINANCE_NATIVE_V20_FULL_SOURCE_20261122.json"
P71=R/"PRISM7_P71_DUAL_MARKET_SIGNED_TF_POINTS_NATIVE53_20261122.json"
P70=R/"PRISM7_P70_BINANCE_ASTER_COMMON_PERIOD_PUBLIC_ARCHIVE_MANIFEST_20261122.json"
P73=R/"PRISM7_P73_NO_GROSS025_V20_SIGNED_AST_BIN_RISK_REJECT_VS_HALF_20261122.json"
OUT=R/"PRISM7_P75_BINANCE_NATIVE62_SAME_UTC_DUAL_POINTS_NO025_TRANSFER_20261122.json"
LEDGER=R/"PRISM7_P75_BINANCE_NATIVE62_ASOF_AST_BIN_SIGNED_SCORE_20261122.jsonl"
MD=R/"PRISM7_P75_BINANCE_NATIVE62_SAME_UTC_DUAL_POINTS_NO025_TRANSFER_20261122.md"
BASE=R.parent/"p70_binance_same_aster_period_202507_202611"/"verified_series"
SOURCE_PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
POLICIES=(
 "ORIGINAL_075","ORIGINAL_100",
 "MACRO_BULL_VETO_075","MACRO_BULL_HALF_ELSE_075",
 "MACRO_BULL_VETO_ELSE_100","MACRO_BULL_HALF_ELSE_100",
 "SIGNED_NEGATIVE_VETO_ELSE_075","SIGNED_NEGATIVE_HALF_ELSE_075",
 "SIGNED_LESS_MINUS6_VETO_ELSE_075","SIGNED_LESS_MINUS6_HALF_ELSE_075",
 "MACRO_BULL_AND_NEGATIVE_VETO_ELSE_075","MACRO_BULL_AND_NEGATIVE_HALF_ELSE_075",
 "MACRO_BULL_ELSE_HALF_IF_SCORE_NEG_ELSE_075",
 "MACRO_BULL_AND_PENGU_BOTH_W_UP_VETO_075",
 "MACRO_BULL_AND_PENGU_W_UP_VETO_075",
 "MACRO_BULL_UP_AND_PENGU_SIGNED_UP_VETO_ELSE_HALF",
 "MACRO_BULL_REJECT_UNLESS_PENGU_REL_WEAK",
 "MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT",
 "MACRO_BULL_VETO_ELSE_075_SCORE_GT12_ADD_TO_100",
)
COSTS=((10,0),(30,0),(30,100))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def date(ts):return datetime.datetime.fromtimestamp(ts/1000,datetime.timezone.utc).isoformat()
def main():
 p74=json.loads(P74.read_text(encoding="utf8"))
 p73=json.loads(P73.read_text(encoding="utf8"))
 p71=json.loads(P71.read_text(encoding="utf8"))
 p70=json.loads(P70.read_text(encoding="utf8"))
 assert p74["nativeCodePinnedSourceSHA"]==SOURCE_PIN and p74["sourceNativeNaturalCrossVenueCandidates"]==62
 assert p74["sourceNativeNaturalClosed"]==62 and p74["sourceH1Aligned12120"]
 assert p70["officialArchiveCount"]==165 and p70["checksumsIndividuallyVerified"]
 assert p73["gross025ExcludedByOwnerRequest"] and set(POLICIES)==set(p73["predefinedExperimentalPolicies"])
 binp,bpSha=get_binance("PENGUUSDT")
 binb,bbSha=get_binance("BTCUSDT")
 bine,beSha=get_binance("ETHUSDT")
 astp,apSha=h1_source(PENGUH1)
 astb,abSha=h1_source(BTCH1)
 assert len(binp)==len(binb)==len(bine)==12120
 assert len(astp)==len(astb)==11376
 assert all(binp[i+744]["time"]==astp[i]["time"] for i in range(len(astp)))
 astpCache=tfcache(astp);astbCache=tfcache(astb)
 binpCache=tfcache(binp);binbCache=tfcache(binb);bineCache=tfcache(bine)
 m5file=BASE/"PENGUUSDT-5m-20250701-20261118-FUTURES_UM_VERIFIED.jsonl.gz"
 m5,m5hash=load_m5([m5file])
 native53=json.loads(SOURCE.read_text(encoding="utf8"))
 asterStart=min(z["entryTs"] for z in native53)
 asterLastEntry=max(z["entryTs"] for z in native53)
 assert len(native53)==53 and sum(z["net30pct"]>0 for z in native53)==29
 rows=[]
 for z in p74["sourceAllNaturalSignalLedger"]:
  assert z["nativeReplay"]["status"]=="NATIVE_EXIT_MODELED"
  ts=z["entryTs"]
  atp=trend_features(astpCache,astbCache,ts)
  btp=trend_features(binpCache,binbCache,ts)
  assert atp["entryTs"]==btp["entryTs"]
  mA=macro_direction(astbCache,ts)
  mB=macro_direction(binbCache,ts)
  mE=macro_direction(bineCache,ts)
  signed=score_joint(atp["penguTrend"],btp["penguTrend"],mA,mB,mE)
  signed["P66OriginalPositiveOnlyAsterScore"]=atp["weightedDownPoints"]
  exitTs=z["nativeReplay"]["exitTs"]
  exitPrice=z["nativeReplay"]["exitPrice"]
  assert ts<exitTs and exitPrice>0 and z["entryPrice"]>0
  assert abs(100*(1-exitPrice/z["entryPrice"])-.30-z["net30pct"])<1e-6
  rows.append({"key":z["id"]+"|"+str(ts),
    "entryTs":ts,"entryPrice":z["entryPrice"],"exitTs":exitTs,"exitPrice":exitPrice,
    "sourceNativeNet30Pct":z["net30pct"],"sourceNativeWin":z["net30pct"]>0,
    "score":signed["grossSignedScore"],
    "dualSigned":signed,"featuresAtNativeEntry":atp,
    "binanceNativeSourceExitReason":z["nativeReplay"].get("exitReason"),
    "asterAsOfTrend":atp["penguTrend"],
    "binanceAsOfTrend":btp["penguTrend"],
    "asterBTCMacro":mA,"binanceBTCMacro":mB,"binanceETHMacro":mE,
    "sourceMarket":"BINANCE_FUTURES_UM_PENGU_NOT_ASTER_EXECUTION",
    "referenceNativeV20Pin":SOURCE_PIN})
 assert len(rows)==62 and sum(z["sourceNativeWin"] for z in rows)==32
 # Exact timestamp overlap not necessarily signaled by both.
 astts=sorted(z["entryTs"] for z in native53)
 bints=sorted(z["entryTs"] for z in rows)
 common=set(astts)&set(bints)
 def near_hours(hours):
  return sum(min(abs(a-t) for a in astts)<=hours*3600000 for t in bints)
 scope={
  "fullP74":"from2025Aug01_until2026Nov14Exclusive",
  "withinAsterNativeFirstToLastEntry":"fromAsterNative53FirstToLastEntryInclusive",
 }
 scenarios=[]
 counts={}
 for key in scope:
  if key=="fullP74":subset=rows
  else:subset=[z for z in rows if asterStart<=z["entryTs"]<=asterLastEntry]
  orig=[{**z,"grossAllocation":.75} for z in subset]
  once,skipped=source_slot(orig)
  n0=len(once);w0=sum(z["sourceNativeWin"] for z in once)
  if key=="fullP74":assert n0==38 and w0==21
  counts[key]={"nativeNatural":len(subset),"nativeNaturalWins":sum(z["sourceNativeWin"] for z in subset),
    "sourceOneSlot":n0,"sourceOneSlotWins":w0,
    "sourceStartUTC":date(min(z["entryTs"] for z in subset)),
    "sourceLastEntryUTC":date(max(z["entryTs"] for z in subset)),
    "sourceMacroBullNatural":sum(z["dualSigned"]["macroBullBothBTCAndEthereum"] for z in subset),
    "sourceMacroBullWinners":sum(z["dualSigned"]["macroBullBothBTCAndEthereum"] and z["sourceNativeWin"] for z in subset),
    "sourceAsterWNotKnown":sum(not z["featuresAtNativeEntry"]["PENGUWeeklyKnown"] for z in subset)}
  for policy in POLICIES:
   arranged=[{**z,"grossAllocation":allocation(policy,z)} for z in subset]
   assert all(z["grossAllocation"] in (0.,.5,.75,1.) for z in arranged)
   rejected=[z for z in arranged if z["grossAllocation"]==0]
   for fee,slip in COSTS:
    econ=replay(arranged,m5,fee,slip)
    scenarios.append({"scope":key,"policy":policy,"feeBps":fee,
      "extraBuyCoverSlipBps":slip,
      "nativeIndependentSource62OriginalNoChanges":True,
      "sourceNaturalVetoed":len(rejected),
      "nativeWinningSignalsVetoed":sum(z["sourceNativeWin"] for z in rejected),
      "econ":{k:v for k,v in econ.items() if k!="capitalTradeLedger"},
      "selectedSlotPositionTrace30bps":econ["capitalTradeLedger"] if fee==30 and slip==0 else None})
 assert len(scenarios)==len(scope)*len(POLICIES)*len(COSTS)
 base=next(z for z in scenarios if z["scope"]=="fullP74" and
   z["policy"]=="ORIGINAL_075" and z["feeBps"]==30 and z["extraBuyCoverSlipBps"]==0)
 native=next(z for z in p74["comparison"] if z["gate"]=="ORIGINAL_PINNED_NATIVE_SOURCE_ALL")
 nat=native["noSlipNaturalSingleSlotPriceProxy"]
 assert (base["econ"]["closed"],base["econ"]["wins"])==(nat["trades"],nat["wins"])==(38,21)
 assert abs(base["econ"]["finalNAVYen"]-nat["finalNavYen"])<.02,(base["econ"]["finalNAVYen"],nat["finalNavYen"])
 # New M5 high stress can never be confused with the source realized-only DD.
 assert base["econ"]["M5HighStressDDPct"]>=nat["realizedOnlyDDPct"]-0.01
 normal=[s for s in scenarios if s["feeBps"]==30 and s["extraBuyCoverSlipBps"]==0]
 stress=[s for s in scenarios if s["feeBps"]==30 and s["extraBuyCoverSlipBps"]==100]
 comparison=[]
 for s in normal:
  q=next(z for z in stress if z["scope"]==s["scope"] and z["policy"]==s["policy"])
  comparison.append({"scope":s["scope"],"policy":s["policy"],
   "nativeOneSlotClosed":s["econ"]["closed"],"wins":s["econ"]["wins"],
   "winPct":s["econ"]["winPct"],"M5HighDDPct":s["econ"]["M5HighStressDDPct"],
   "NAVJPY":s["econ"]["finalNAVYen"],
   "M5HighDDPlus100bps":q["econ"]["M5HighStressDDPct"],
   "NAVPlus100bps":q["econ"]["finalNAVYen"],
   "nativeNaturalWinnersVetoed":s["nativeWinningSignalsVetoed"]})
 report={
  "schema":"prism7-p75-frozen-p73-no025-aster-binance-shared-utc-independent-binance-native62-transfer/v1",
  "status":"RESEARCH_CROSS_VENUE_SAME_CALENDAR_NOT_UNSEEN_ASTER",
  "originalPinnedSourceSHA":SOURCE_PIN,
  "sourceIndependentBinanceNative62FromUnmodifiedPINOriginal":True,
  "sourceNative62ThirtyTwoWins":True,
  "sourceBinancePENGU1h5mFromP70OfficialSHA":True,
  "sourceAsterPENGUBTCH1AsOfMarketContextOnly":True,
  "jointSignedScoreReusedUnmodifiedFromP71":True,
  "grossPolicyReusedUnmodifiedFromP73":True,
  "allEntryAmountsExactly0_0p5_0p75_1":True,
  "sourceOriginalAster53NaturalSetDifferentFromBinance62":True,
  "sameTimeOriginalNativeEntryOverlap":{
    "AsterNative53NaturalCount":53,"BinanceNative62NaturalCount":62,
    "exactSameHourCandidateCount":len(common),
    "within1hCandidateCountBinance":near_hours(1),
    "within4hCandidateCountBinance":near_hours(4),
    "within24hCandidateCountBinance":near_hours(24),
    "notPairwiseIndependentTradeFillComparison":True},
  "scopeBasePopulation":counts,
  "normal30bpsVs100bpsStress":comparison,
  "allScenariosAndSelectedPositions":scenarios,
  "independentSource62DualMarketAsOfFeatureLedger":rows,
  "P74Native62H1PriceSourceRealizedSingleSlotParity":True,
  "P74OriginalBaseRealizedOnlyDDNotM5":nat["realizedOnlyDDPct"],
  "sourceBinanceM5MarkedHighOriginalDDPct":base["econ"]["M5HighStressDDPct"],
  "sourceSha256":{
   "P74":sha(P74),"P73":sha(P73),"P71":sha(P71),"P70":sha(P70),
   "AsterNative53":sha(SOURCE),"BinanceM5":m5hash,
   "AsterPENGUH1":apSha,"AsterBTCH1":abSha,
   "BinancePENGUH1":bpSha,"BinanceBTCH1":bbSha,"BinanceETHH1":beSha},
  "limitations":[
   "Data source Binance USD-M may differ materially in PENGU price and volume from ASTER, despite identical UTC periods; native entry/exit logic source unmodified but original venue not identical.",
   "2025Aug-2026Nov dates were previously viewed for Aster. This out-of-venue evaluation is NOT truly unseen random holdout.",
   "Native source H1 exit price and M5 marked DD are research proxies, not Binance signed venue STOP fills, funding, cross-margin or account portfolio DD.",
   "Aster source H1 has only Aug2025-Nov2026, early Binance entry may lack ASTER completed W/D warm-up and should be marked missing; no synthetic prior context.",
   "Original ASTER entry timestamps are distinct, no direct per-signal equal outcome comparison except exact-hour matches.",
   "Gross1 strategy may exceed approved production per-runner allocation. Owner asked no Gross 0.25 and it was fully excluded from model.",
   "No production STOP/Runner/Gross/Orders/master touched."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(z,ensure_ascii=False,sort_keys=True)+"\n" for z in rows),encoding="utf8")
 lines=["# P75 | Same-calendar independent Binance Native62 source with P73 gross0.5-or-veto",
  "",
  "Original source pinned SHA "+SOURCE_PIN+". 2025Aug-2026Nov same UTC window, but independent original V20 signals on Binance source; Aster Native53 is a different 53 signal series. NO Gross0.25.",
  "",
  "Original Binance source62 natural 32 wins, one-slot38/21. H1 gross.75 30bps realized-only DD "+str(nat["realizedOnlyDDPct"])+
  "%, NAV ¥"+str(nat["finalNavYen"])+"; new Binance M5 high-stress DD "+str(base["econ"]["M5HighStressDDPct"])+"%.",
  "",
  "Exact-hour Native Aster/Binance candidate overlap "+str(len(common))+
  "; Binance candidate within 1h of any Aster "+str(near_hours(1))+
  ", within 4h "+str(near_hours(4))+
  ", within 24h "+str(near_hours(24))+". These are source intents, not identical signed venue fills.",
  "",
  "| Calendar | Entry Policy P73 unchanged | closed/wins | M5 high DD | NAV ¥ | +100bps DD | +100bps NAV | Original wins vetoed |",
  "|---|---|---:|---:|---:|---:|---:|---:|"]
 for z in comparison:
  lines.append("| "+z["scope"]+" | "+z["policy"]+" | "+
   str(z["nativeOneSlotClosed"])+"/"+str(z["wins"])+" | "+
   str(z["M5HighDDPct"])+"% | "+str(z["NAVJPY"])+" | "+
   str(z["M5HighDDPlus100bps"])+"% | "+str(z["NAVPlus100bps"])+" | "+
   str(z["nativeNaturalWinnersVetoed"])+" |")
 lines+=["","Do not cherry pick future rule from this research. Different source market and Aster original source previously inspected. No official signed fills/true shared account risk. Native Gross unchanged in LIVE.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P75_SOURCE_NATIVE_BINANCE_62_MATCHED_ASTER_CLOCK_DUAL_SIGNED_POLICY_TRANSFER_PASS",
  json.dumps({"native62":62,"naturalWins":32,"originalOneSlot":38,
   "sourceSameHour":len(common),"within4h":near_hours(4),
   "scope":counts,
   "examples":[z for z in comparison if z["policy"] in (
    "ORIGINAL_075","MACRO_BULL_VETO_075","MACRO_BULL_HALF_ELSE_075",
    "MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT","SIGNED_LESS_MINUS6_VETO_ELSE_075")]}
   ,ensure_ascii=False),flush=True)
 print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
