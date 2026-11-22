#!/usr/bin/env python3
"""P56 fixed Native V20 53 causal pre-entry source features vs post-entry loss taxonomy. Research only."""
import json,hashlib,math,statistics
from collections import Counter
from pathlib import Path
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE
P39=R/"PRISM7_P39_ORIGINAL_NATIVE53_M5_ASOF_FEATURES_20261122.jsonl"
P40=R/"PRISM7_P40_ORIGINAL_NATIVE53_LOSS_ANATOMY_LEDGER_20261122.jsonl"
P44=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_0P75_SINGLE_SLOT_20261122.json"
OUT=R/"PRISM7_P56_NATIVE53_ENTRY_FAILURE_TAXONOMY_AND_CAUSAL_FEATURES_20261122.json"
MD=R/"PRISM7_P56_NATIVE53_ENTRY_FAILURE_TAXONOMY_AND_CAUSAL_FEATURES_20261122.md"
LEDGER=R/"PRISM7_P56_NATIVE53_CAUSAL_ASOF_AND_POSTTRADE_CATEGORIES_20261122.jsonl"
CATS=("WIN_ORIGINAL_NATIVE_EXIT","LOSS_NEVER_CONFIRMED_1PCT","LOSS_CONFIRMED_1_TO_LT3PCT","LOSS_CONFIRMED_3PCT_OR_MORE_GIVEN_BACK")
FEATURES=("BTC6_NONPOS","PENGU_RELWEAK6","M5_PRE_MICRO_DOWNTREND","M5_TAKER_SELLER60","M5_TAKER_SELLER30","M5_BELOW_VWAP","NATIVE48_D3_ALL3")
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rd(v):return round(float(v),5)
def wilson(k,n):
 if not n:return [None,None]
 z=1.95996398454;p=k/n;d=1+z*z/n
 c=(p+z*z/(2*n))/d
 h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
 return [rd(100*(c-h)),rd(100*(c+h))]
def main():
 original=json.loads(SOURCE.read_text(encoding="utf8"))
 a=[json.loads(z) for z in P39.read_text(encoding="utf8").splitlines() if z.strip()]
 b=[json.loads(z) for z in P40.read_text(encoding="utf8").splitlines() if z.strip()]
 p44=json.loads(P44.read_text(encoding="utf8"))
 assert len(original)==len(a)==len(b)==53 and sum(z["net30pct"]>0 for z in original)==29
 d39={z["key"]:z for z in a};d40={z["key"]:z for z in b}
 d44={z["key"]:z for z in p44["targetDetailed53"]["all53Matched"]}
 assert len(d39)==len(d40)==len(d44)==53
 records=[]
 for z in original:
  key=z["period"]+"|"+z["id"]+"|"+str(z["entryTs"])
  q=d39[key];loss=d40[key];context=d44[key]
  assert q["entryTs"]==z["entryTs"]==context["entryTs"]
  assert q["exitTs"]==z["exitTs"]==loss["originalExitTs"]
  assert abs(100*(1-z["exitPrice"]/z["entryPrice"])-.3-z["net30pct"])<1e-7
  m=q["causalM5"];h=z["p35AsOfFeature"]
  flags={"BTC6_NONPOS":bool(h["BTCret6NonPositive"]),
   "PENGU_RELWEAK6":bool(h["PENGURelativelyWeak6H"]),
   "M5_PRE_MICRO_DOWNTREND":bool(m["flags"]["microDown"]) if m.get("asof") else None,
   "M5_TAKER_SELLER60":bool(m["flags"]["seller60"]) if m.get("asof") else None,
   "M5_TAKER_SELLER30":bool(m["flags"]["seller30"]) if m.get("asof") else None,
   "M5_BELOW_VWAP":bool(m["flags"]["belowVWAP"]) if m.get("asof") else None,
   "NATIVE48_D3_ALL3":bool(context["all3"])}
  t=loss["postEntryM5EventTrace"]
  records.append({"key":key,"id":z["id"],"cohort":z["period"],
   "entryTs":z["entryTs"],"exitTs":z["exitTs"],"entryPrice":z["entryPrice"],
   "exitPrice":z["exitPrice"],"exitReason":z["exitReason"],
   "nativeNet30Pct":rd(z["net30pct"]),"win":z["net30pct"]>0,
   "outcomeFamilyFutureDiagnosticONLY":loss["postEntryLossCategory"],
   "entryFlagsKnownBeforeNativeEntry":flags,
   "asofM5Available":bool(m.get("asof")),
   "asofM5Status":m["state"],
   "asofBTC6ReturnPct":rd(100*h["btcReturnLast6CompletedH1"]),
   "asofRelative6ReturnPct":rd(100*h["penguMinusBTC6H"]),
   "asofM5TakerBuy60":m.get("penguTakerBuyRatio60"),
   "asofM5TakerBuy30":m.get("penguTakerBuyRatio30"),
   "M5MaxFavorableClosePctFutureDiagnosticONLY":t["maxf_m5_pct"],
   "M5MaxAdverseClosePctFutureDiagnosticONLY":t["maxa_m5_pct"],
   "M5FirstFavorableClose1TsFutureONLY":t["first_close_favorable_1pct"],
   "M5FirstFavorableClose3TsFutureONLY":t["first_close_favorable_3pct"],
   "M5FirstAdverseClose1TsFutureONLY":t["first_close_adverse_1pct"],
   "M5PrintsFirst3H":t["n_positive_print_m5_first3"],
   "M5PrintsFirst6H":t["n_positive_print_m5_first6"],
   "M5PrintsToExit":t["n_printed_m5_lifetime"],
   "futureOutcomeCannotBeUsedAsGate":True})
 assert Counter(x["outcomeFamilyFutureDiagnosticONLY"] for x in records)==dict(zip(CATS,(29,12,5,7)))
 categories={}
 for c in CATS:
  z=[x for x in records if x["outcomeFamilyFutureDiagnosticONLY"]==c]
  categories[c]={"cases":len(z),"stops":dict(Counter(x["exitReason"] for x in z)),
   "cohorts":dict(Counter(x["cohort"] for x in z)),
   "medianMaxFavorablePositiveM5ClosePct":rd(statistics.median(x["M5MaxFavorableClosePctFutureDiagnosticONLY"] for x in z)),
   "medianFirst3hPrints":rd(statistics.median(x["M5PrintsFirst3H"] for x in z))}
 features=[]
 for feature in FEATURES:
  kept=[x for x in records if x["entryFlagsKnownBeforeNativeEntry"][feature] is True]
  m=[x for x in records if x["entryFlagsKnownBeforeNativeEntry"][feature] is None]
  w=sum(x["win"] for x in kept)
  features.append({"feature":feature,"kept":len(kept),"winsKept":w,"lossKept":len(kept)-w,
   "originalWinnersDiscarded":29-w,"originalLosersDiscarded":24-(len(kept)-w),
   "neverFavorableLossesKept":sum(x["outcomeFamilyFutureDiagnosticONLY"]==CATS[1] for x in kept),
   "oneToThreeFavorableLossesKept":sum(x["outcomeFamilyFutureDiagnosticONLY"]==CATS[2] for x in kept),
   "threePlusGivenBackLossesKept":sum(x["outcomeFamilyFutureDiagnosticONLY"]==CATS[3] for x in kept),
   "unknownFlagN":len(m),"selectedSourceWinWilson95":wilson(w,len(kept)),
   "perCohort":{c:{"n":len(z),"wins":sum(x["win"] for x in z)}
     for c in ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV")
     for z in [[x for x in kept if x["cohort"]==c]]}})
 p44gate=next(x for x in features if x["feature"]=="NATIVE48_D3_ALL3")
 assert (p44gate["kept"],p44gate["winsKept"],p44gate["lossKept"])==(21,19,2)
 missing=[z for z in records if not z["asofM5Available"]]
 assert len(missing)==6 and sum(x["win"] for x in missing)==5
 report={"schema":"prism7-p56-native53-entry-error-vs-profit-giveback-source-parity/v1",
  "status":"RESEARCH_ONLY__NO_ADOPTED_GATES",
  "pinnedNativeSha":"1657e173d250ad58f53e62f7bb0a3428fb405496",
  "originalSource53":53,"originalWinners":29,"originalLosers":24,
  "originalSourceNet30ExitParity53":True,"lossFamilies":categories,
  "preentryM5MissingCases":len(missing),"preentryM5MissingWinners":sum(x["win"] for x in missing),
  "featureAsOfWinnerRetentionControls":features,
  "riskOfUsingFutureLossCategoryAsEntryFeature":True,
  "P44RuleOnlyRetrospectiveSelectedOnAlreadyViewedData":True,
  "all53SourceCaseLedger":records,
  "sourceSha256":{"original53":sha(SOURCE),"P39":sha(P39),"P40":sha(P40),"P44":sha(P44)},
  "limitations":["Original53 price source natural intents may overlap, not actual unique venue fills.",
  "12 no >=1% favorable, 5 1-<3%, 7 >=3% lost are POST-entry outcomes, not allowed as entry flags.",
  "P39 5 of 6 M5 feature-unscorable original cases WIN; requiring full M5 would discard winners.",
  "P44 earlier D3 All3 19/21 only retrospectively selected, PRE only 1/3 win. No unseen OOS.",
  "No signed fills, orderbook/STOP intrabar parity, funding, shared gross or actual account DD.",
  "Do not optimize gates on these labeled 53 without independent future holdout."]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in records),encoding="utf8")
 lines=["# P56 Native V20 53: classify wrong direction vs profit given back","","All 53 pinned-source entry/exits verified, 29 wins and 24 losses. Loss family labels are POST-entry DIAGNOSTICS only.",
  "","| Outcome family | Cases | Stops | Median favorable M5 CLOSE % | PRE/BASE/POST |","|---|---:|---|---:|---|"]
 for c in CATS:
  x=categories[c]
  lines.append("| "+c+" | "+str(x["cases"])+" | "+str(x["stops"])+" | "+str(x["medianMaxFavorablePositiveM5ClosePct"])+"% | "+str(x["cohorts"])+" |")
 lines+=["","| Original as-of entry feature | Keep | Winner kept | Loser kept | Winner dropped | Never-favorable losers kept |","|---|---:|---:|---:|---:|---:|"]
 for x in features:
  lines.append("| "+x["feature"]+" | "+str(x["kept"])+" | "+str(x["winsKept"])+" | "+str(x["lossKept"])+" | "+str(x["originalWinnersDiscarded"])+" | "+str(x["neverFavorableLossesKept"])+" |")
 lines+=["","M5 feature signal missing 6/53 with 5 winners: blanket entry veto would remove those wins. P44 D3-all3 retains 19/29 original winners and 2/24 losers historically, not independent evidence. New objective: fix loss types without optimizing away winners.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P56_NATIVE53_ENTRY_VS_PROFIT_GIVEBACK_INVARIANTS_PASS",json.dumps({
  "lossFamilies":categories,"asofM5Missing":len(missing),
  "missingWinners":sum(x["win"] for x in missing),
  "features":[{"name":x["feature"],"kept":x["kept"],"win":x["winsKept"],"loss":x["lossKept"],"lostWin":x["originalWinnersDiscarded"],"neverFavorableLossesKept":x["neverFavorableLossesKept"],"cohorts":x["perCohort"]} for x in features]},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
