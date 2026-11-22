#!/usr/bin/env python3
"""P62 cross-venue frozen P44 gate transfer: native source odds and retention.

Aster original 53 and Binance official Futures USD-M 2025 Jan-Jul Native 55
are DIFFERENT MARKET DATA and cannot be combined as portfolio or venue OOS.
Compares conditional source-case observed win odds (not signed executions),
true/false rejected signals, Wilson intervals, Fisher fixed-source 2x2.
No rules trained or adjusted here. Exact frozen P44 condition only.
"""
from __future__ import annotations
import json,math,hashlib,datetime,statistics
from pathlib import Path
from collections import defaultdict
R=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\results")
ASTER=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_0P75_SINGLE_SLOT_20261122.json"
ORIG=R/"PRISM7_P35_ORIGINAL_NATIVE53_075_ALL53_H1_CONTEXT_AND_POSITIONS_20261122.json"
BIN=R/"PRISM7_P61_EARLY_BINANCE_CROSS_VENUE_NATIVE_V20_P44_FROZEN_20261122.json"
MANIFEST=R/"PRISM7_P61_NEW_EARLIER_H1_ARCHIVE_SOURCE_MANIFEST_20261122.json"
OUT=R/"PRISM7_P62_P44_FROZEN_3PCT_48H_ALL3_CROSS_MARKET_TRANSFER_AUDIT_20261122.json"
MD=R/"PRISM7_P62_P44_FROZEN_3PCT_48H_ALL3_CROSS_MARKET_TRANSFER_AUDIT_20261122.md"
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rd(z,n=5):return round(float(z),n)
def wilson(k,n):
 if n==0:return [None,None]
 z=1.95996398454;p=k/n;d=1+z*z/n
 c=(p+z*z/(2*n))/d
 h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
 return [rd(100*(c-h),2),rd(100*(c+h),2)]
def fisher2(k1,m1,k0,m0):
 # Two-sided Fisher exact: hypergeom probabilities <= observed probability.
 N=k1+m1+k0+m0
 K=k1+k0
 n=k1+m1
 obs=math.comb(K,k1)*math.comb(N-K,n-k1)/math.comb(N,n)
 minx=max(0,n-(N-K));maxx=min(K,n)
 p=sum(math.comb(K,x)*math.comb(N-K,n-x)/math.comb(N,n)
   for x in range(minx,maxx+1)
   if (math.comb(K,x)*math.comb(N-K,n-x)/math.comb(N,n))<=obs+1e-13)
 return rd(min(1.,p),6)
def summary(src,market):
 total=len(src);selected=[z for z in src if z["passes"]]
 excluded=[z for z in src if not z["passes"]]
 assert len({z["id"] for z in src})==total
 assert all(z["win"] is not None for z in src)
 s=sum(z["win"] for z in selected)
 u=sum(z["win"] for z in excluded)
 n=len(selected);m=len(excluded)
 return {"market":market,"allNativeSourceIntents":total,
   "allSourceWinners":s+u,"allSourceLosers":total-s-u,
   "sourceKeptByFrozenP44":n,"keptWinningNativeSource":s,
   "keptLosingNativeSource":n-s,
   "sourceExcludedByFrozenP44":m,
   "excludedOriginalWinners":u,"excludedOriginalLosers":m-u,
   "ungatedWinPct":rd(100*(s+u)/total),
   "keptWinPct":rd(100*s/n) if n else None,
   "keptWilson95Pct":wilson(s,n),
   "excludedWinPct":rd(100*u/m) if m else None,
   "excludedWilson95Pct":wilson(u,m),
   "relativeConditionalWinPctDeltaKeptMinusExcluded":rd(100*s/n-100*u/m) if n and m else None,
   "fisherExactTwoSidedPWithinVenue":fisher2(s,n-s,u,m-u),
   "sourceCasesOverlapPossible":True,
   "perMonth":{month:{"signals":len(vals),
      "sourceWins":sum(z["win"] for z in vals),
      "keptByFrozenP44":sum(z["passes"] for z in vals),
      "sourceKeptWins":sum(z["passes"] and z["win"] for z in vals)}
      for month,vals in sorted((lambda d:d)(dict(
       (m,[z for z in src if z["month"]==m])
       for m in sorted({z["month"] for z in src}))).items())}}
def main():
 a=json.loads(ASTER.read_text(encoding="utf8"))
 orig=json.loads(ORIG.read_text(encoding="utf8"))
 b=json.loads(BIN.read_text(encoding="utf8"))
 manifest=json.loads(MANIFEST.read_text(encoding="utf8"))
 assert len(orig)==53 and a["sourceNative53ExitNet30Parity53Of53"]
 assert b["sourceNativeNaturalCrossVenueCandidates"]==55
 assert manifest["monthlyOfficialChecksumVerified"]
 p44={z["key"]:z for z in a["targetDetailed53"]["all53Matched"]}
 assert len(p44)==53
 origcases=[]
 for z in orig:
  key=z["period"]+"|"+z["id"]+"|"+str(z["entryTs"])
  ref=p44[key]
  assert (z["net30pct"]>0)==(ref["sourceNativeNet30Pct"]>0)
  month=datetime.datetime.fromtimestamp(z["entryTs"]/1000,datetime.timezone.utc).strftime("%Y-%m")
  origcases.append({"id":key,"passes":bool(ref["all3"]),"win":z["net30pct"]>0,
      "month":month,"period":z["period"],"originalPriceMarket":"ASTER_RESEARCH_PRICE"})
 newcases=[]
 for z in b["sourceAllNaturalSignalLedger"]:
  gating=z["p44FrozenEarlierCrossing"]["P44_FROZEN_D3_PRIOR48H_ALL3"]
  assert z["nativeReplay"]["status"]=="NATIVE_EXIT_MODELED"
  assert isinstance(gating["pass"],bool)
  month=datetime.datetime.fromtimestamp(z["entryTs"]/1000,datetime.timezone.utc).strftime("%Y-%m")
  newcases.append({"id":z["id"],"passes":gating["pass"],"win":z["net30pct"]>0,
      "month":month,"originalPriceMarket":"BINANCE_FUTURES_UM"})
 assert len(newcases)==55
 aa=summary(origcases,"ASTER_REFERENCE_2025AUG_2026NOV")
 bb=summary(newcases,"BINANCE_EXTERNAL_2025JAN_JUL")
 assert (aa["sourceKeptByFrozenP44"],aa["keptWinningNativeSource"])==(21,19)
 assert (bb["sourceKeptByFrozenP44"],bb["keptWinningNativeSource"])==(14,7)
 assert (bb["excludedOriginalWinners"],bb["excludedOriginalLosers"])==(21,20)
 assert aa["keptWinPct"]>90 and bb["keptWinPct"]==50
 report={
  "schema":"prism7-p62-p44-frozen-predrop-gate-cross-market-negative-transfer-evidence/v1",
  "status":"REJECT_FROZEN_P44_AS_DEPLOYABLE_GATE",
  "exactFixedP44Rule":"last strictly earlier PENGU 24h -3% H1 downcross within48h; previous completed H1 BTC24<=0, PENGU24-BTC24<=-1pp, EMA72<EMA168 and PENGUclose<EMA72",
  "marketSourceComparison":[aa,bb],
  "AsterWins19of21SelectedOriginallyWasSampleChosen":True,
  "BinanceCrossVenueWinsOnly7of14FrozenSelected":True,
  "BinanceVenuePriceOHLCVDoesNotMatchAsterOnJuly2025Overlap":True,
  "crossMarketIdenticalNativeSignalCodeNotMarketData":True,
  "AsterSourceNativeTotal53AndBinanceSourceNative55NotSameTrades":True,
  "statsFisherAreDescriptiveNotProofOfIndependentOutOfSample":True,
  "doNotTuneNext3pctThresholdFromObservedP61AlternativeD5":True,
  "originalNative53NeverMutated":True,
  "sourceSHA256":{"P44Aster":sha(ASTER),"Native53Aster":sha(ORIG),
   "P61Binance":sha(BIN),"P61BinancePublishedChecksums":sha(MANIFEST)},
  "researchRecommendation":"Keep original Native V20 unchanged. Do not deploy P44 or optimize D5 on these observed results. Acquire future ASTER native source plus signed fills & STOP/account risk, prespecify comprehensive candidate mechanism before independent tests.",
  "limitations":[
   "Binance external historical market is NOT original Aster venue; differing prices and volume mean this is robustness check, not strict out-of-time Aster.",
   "P44 D3 condition had previously been selected based on original Aster historical 53 outcomes; Aster Fisher p-value is discovery-selected and not independently inferential.",
   "Binance 14 selected events occur in 2025 Feb, Apr, May, Jun and are source natural overlapping intents; Fisher treats as independent for descriptive convenience only.",
   "Source 53 and 55 original Native short signals are H1 synthetic price events, not exchange confirmed signed order fills.",
   "No 5m high-stress drawdown, funding, true native venue STOP priority, or cross-runner portfolio account risk available from Binance historical H1.",
   "Do not confuse high 5/7 overlapping-filter one-slot win rate with 7/14 entire source natural signal win rate, or compare slot NAVs directly as same trades.",
   "Alternative 5% downcross results were viewed in P61 sensitivity and may not be promoted without new unseen venue OOS."
  ]
 }
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 lines=[
  "# P62 — frozen P44 market-transfer falsification, source Native V20, same gate",
  "",
  "P44 D3 prior48h ALL3 was fixed before fetching Binance USD-M 2025 Jan-Jul. Aster & Binance OHLCV are different venues. Original Native53 source events remain immutable.",
  "",
  "| Market | All source | All wins | Kept | Kept wins | Kept win rate | Excluded wins/total | Kept 95% Wilson | Fisher two-sided (descriptive) |",
  "|---|---:|---:|---:|---:|---:|---|---|---:|"
 ]
 for z in (aa,bb):
  lines.append("| "+z["market"]+" | "+str(z["allNativeSourceIntents"])+" | "+str(z["allSourceWinners"])+" | "+str(z["sourceKeptByFrozenP44"])+" | "+str(z["keptWinningNativeSource"])+" | "+str(z["keptWinPct"])+"% | "+str(z["excludedOriginalWinners"])+"/"+str(z["sourceExcludedByFrozenP44"])+" | "+str(z["keptWilson95Pct"])+" | "+str(z["fisherExactTwoSidedPWithinVenue"])+" |")
 lines+=["",
  "**Outcome:** Frozen P44 condition is not cross-market robust. In Binance source signals, selected 7/14=50%, excluded 21/41=51.22%, meaning no better discrimination in this test. Do not replace 3% with retrospective 5% threshold (P61 sensitivity showed D5 13/21 natural source).",
  "",
  "Fisher p for Aster discovery-selected gate cannot be used as independent validation. All candidate source entries can overlap, 55 source cases are NOT 55 independent venue fills. Cross-market H1 cannot certify Aster M5 DD or real STOP.",
  "",
  "Preserve original Native V20 and original P44 history for falsification; no production changes."
 ]
 MD.write_text("\n".join(lines)+"\n",encoding="utf8")
 print("P62_P44_CROSS_MARKET_SOURCE_WIN_LOSS_RETENTION_FISHER_INVARIANTS_PASS",
  json.dumps({"Aster":{k:aa[k] for k in ("allNativeSourceIntents","allSourceWinners","sourceKeptByFrozenP44","keptWinningNativeSource","excludedOriginalWinners","keptWinPct","excludedWinPct","fisherExactTwoSidedPWithinVenue")},
    "Binance":{k:bb[k] for k in ("allNativeSourceIntents","allSourceWinners","sourceKeptByFrozenP44","keptWinningNativeSource","excludedOriginalWinners","keptWinPct","excludedWinPct","fisherExactTwoSidedPWithinVenue")}},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD)
if __name__=="__main__":main()
