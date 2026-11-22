#!/usr/bin/env python3
"""P39 original PINNED PENGU SHORT V20 native53 as-of M5 entry gate transfer.
No changes to source 53 signals, original exits, or source P35 net30 economics.
P38 fixed gates only. Standalone conditional outcomes, NOT portfolio DD.
"""
from __future__ import annotations
import json,math,statistics
from pathlib import Path
from collections import Counter,defaultdict
from datetime import datetime,timezone

from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p38_causal_multihorizon_entry_20261122 import (
  SOURCES,BTC,GATES,load_btc_quarantine,fsource,passes,win95,rounded,sha
)

R=Path(__file__).resolve().parent.parent/"results"
P35=R/"PRISM7_P35_ORIGINAL_NATIVE53_075_ALL53_H1_CONTEXT_AND_POSITIONS_20261122.json"
P38=R/"PRISM7_P38_M5_CAUSAL_MULTI_HORIZON_ENTRY_ABLATION_20261122.json"
OUT=R/"PRISM7_P39_ORIGINAL_NATIVE53_M5_CAUSAL_TRANSFER_20261122.json"
NOTE=R/"PRISM7_P39_ORIGINAL_NATIVE53_M5_CAUSAL_TRANSFER_20261122.md"
LEDGER=R/"PRISM7_P39_ORIGINAL_NATIVE53_M5_ASOF_FEATURES_20261122.jsonl"
FEE=(10,30)
EXTRA_SLIP=(0,100)
GROSS=.75

def stats(values,periods):
   n=len(values);w=sum(x["equityReturnPct"]>0 for x in values)
   gains=sum(x["equityReturnPct"] for x in values if x["equityReturnPct"]>0)
   losses=-sum(x["equityReturnPct"] for x in values if x["equityReturnPct"]<0)
   s=sum(x["equityReturnPct"] for x in values)
   by={}
   for cohort in sorted(periods):
     g=[x for x in values if x["cohort"]==cohort]
     by[cohort]={"n":len(g),"wins":sum(x["equityReturnPct"]>0 for x in g),
       "meanReturnOnEntryEquityPct":rounded(sum(x["equityReturnPct"] for x in g)/len(g)) if g else None}
   return {
      "selectedSourceNativeTrades":n,
      "selectedWins":w,"selectedLosses":n-w,
      "conditionalWinratePct":rounded(w/n*100) if n else None,
      "wilson95Pct":win95(w,n),
      "conditionalPF":rounded(gains/losses) if losses>0 else None,
      "meanReturnOnEntryEquityPct":rounded(s/n) if n else None,
      "sumStandaloneEquityReturnPctPoints":rounded(s),
      "yieldPerOriginal53NativeOpportunitiesPctPoints":rounded(s/53),
      "cohorts":by,
   }

def main():
    native=json.loads(P35.read_text(encoding="utf8"))
    p38=json.loads(P38.read_text(encoding="utf8"))
    assert len(native)==53 and all(x["originalNativeShortSignalUnchanged"] and x["parity"]=="EXACT" for x in native)
    assert sum(x["net30pct"]>0 for x in native)==29
    assert p38["precommittedGates"]==list(GATES) and p38["pinnedSha"]=="1657e173d250ad58f53e62f7bb0a3428fb405496"
    m5,ph=load_m5(SOURCES)
    btc,bh,bad=load_btc_quarantine(BTC)
    assert ph==p38["inputSHA"]["PENGU_M5"]
    assert bh==p38["inputSHA"]["BTC_M5"]
    assert bad==p38["btcInvalidBarsQuarantined"]
    feature_rows=[]
    for x in native:
       key=f"{x['period']}|{x['id']}|{x['entryTs']}"
       source={"id":key,"entryProxyTs":x["entryTs"],"route":"SHORT_V20"}
       f=fsource(source,{},m5,btc)
       if f.get("asof"):
           assert f["lastObservedM5CloseTs"]<=int(x["entryTs"])
       calc=100*(1-float(x["exitPrice"])/float(x["entryPrice"]))-.3
       if abs(calc-float(x["net30pct"]))>1e-7:
           raise ValueError("P39_NATIVE53_P35_PINNED_EXIT_PARITY:"+key+":"+str(calc)+":"+str(x["net30pct"]))
       feature_rows.append({"key":key,"id":x["id"],"cohort":x["period"],
                            "entryTs":x["entryTs"],"exitTs":x["exitTs"],
                            "entryPrice":x["entryPrice"],"exitPrice":x["exitPrice"],
                            "exitReason":x["exitReason"],"sourceNativeNet30Pct":x["net30pct"],
                            "causalM5":f})
    assert len({x["key"] for x in feature_rows})==53
    cohorts={x["cohort"] for x in feature_rows}
    test_results=[]
    test_ids={}
    for fee in FEE:
      for slip in EXTRA_SLIP:
        orig=[]
        for x in feature_rows:
           p=100*(1-float(x["exitPrice"])*(1+slip/10000)/float(x["entryPrice"]))-fee/100
           orig.append({**x,"equityReturnPct":GROSS*p})
        original_stats=stats(orig,cohorts)
        index={x["key"]:x for x in orig}
        for gate in GATES:
          chosen=[x for x in orig if gate=="BASE_P34_ONLY" or passes(gate,x["causalM5"])]
          selectedstats=stats(chosen,cohorts)
          chosenkeys={x["key"] for x in chosen}
          removed=[x for x in orig if x["key"] not in chosenkeys]
          label="ORIGINAL_NATIVE53_UNFILTERED" if gate=="BASE_P34_ONLY" else gate
          result={
             "gate":label,"roundTripFeeBps":fee,"additionalBuyCoverSlippageBps":slip,
             "original53Unaffected":len(orig),
             "original53Wins":original_stats["selectedWins"],
             "sourceEligible":len(chosen),
             "excludedWinners":sum(x["equityReturnPct"]>0 for x in removed),
             "excludedLosers":sum(x["equityReturnPct"]<=0 for x in removed),
             "excludedWinnersIds":[x["key"] for x in removed if x["equityReturnPct"]>0],
             "excludedLosersIds":[x["key"] for x in removed if x["equityReturnPct"]<=0],
             **selectedstats,
             "liveCertified":False}
          test_results.append(result)
          if fee==30 and slip==0:test_ids[label]=[x["key"] for x in chosen]
    assert len(test_results)==len(FEE)*len(EXTRA_SLIP)*len(GATES)
    normal=[x for x in test_results if x["roundTripFeeBps"]==30 and x["additionalBuyCoverSlippageBps"]==0]
    source=next(x for x in normal if x["gate"]=="ORIGINAL_NATIVE53_UNFILTERED")
    assert source["selectedSourceNativeTrades"]==53 and source["selectedWins"]==29
    missing=[x for x in feature_rows if not x["causalM5"].get("asof")]
    assert len(missing)==6
    zero_feature_winners=sum(x["sourceNativeNet30Pct"]>0 for x in missing)
    assert zero_feature_winners==5
    compliant=[x["gate"] for x in normal if x["conditionalWinratePct"]>=80
               and x["selectedSourceNativeTrades"]>=30
               and x["sumStandaloneEquityReturnPctPoints"]>=source["sumStandaloneEquityReturnPctPoints"]]
    out={
       "schema":"prism7-p39-original-pinned53-frozen-p38-causal-m5-entry-gates/v1",
       "status":"RESEARCH_ONLY__SOURCE_NATIVE_EXIT_UNCHANGED",
       "pinnedSourceSha":p38["pinnedSha"],
       "native53P35OriginalWins":29,
       "native53P35ExitAndNet30Parity53Of53":True,
       "sourceP38GatesReusedWithoutThresholdTuning":GATES,
       "p39BaselineLabel":"ORIGINAL_NATIVE53_UNFILTERED",
       "p39BaselineIsNotP34Filtered":True,
       "causalM5UnscorableNative53":[{"key":x["key"],"state":x["causalM5"]["state"],"nativeNet30Pct":x["sourceNativeNet30Pct"]} for x in missing],
       "causalM5UnscorableNative53Winners":zero_feature_winners,
       "allOriginal53NativeSourcesKept":True,
       "featureAvailableForNative53":sum(x["causalM5"].get("asof",False) for x in feature_rows),
       "sourceFiles":{"nativeP35":sha(P35),"p38":sha(P38),"pengu":ph,"btc":bh},
       "btcQuarantinedBarCount":len(bad),
       "scenarioCount":len(test_results),
       "feeBps":FEE,"extraBuyCoverSlipBps":EXTRA_SLIP,"gross":GROSS,
       "normal30bpsNoExtraSlippage":normal,
       "allScenarios":test_results,
       "selectedNative53KeysByGate30bps":test_ids,
       "criteriaMetInExploredPeriodsOnly":compliant,
       "economicCaveat":"sum of standalone position returns, overlap NOT netted, NOT compounding NAV or DD",
       "limits":[
         "P35 53 native entries and exits were already extensively studied and are not an untouched holdout.",
         "This is 53 natural Native V20 source outcomes, not a set of 53 distinct filled production orders or portfolio slot reconciled trades.",
         "Original Native53 exits are retained by price as recorded. No hypothetical P25 shock modifications are mixed in.",
         "Gross0.75x conditions scale isolated equity return; source entries may overlap, so do not call aggregate sum a portfolio or DD.",
         "As-of M5 features are pre-entry but zero order book depth, signed fills, funding, model uncertainty, and live execution verification.",
         "The one BTC invalid M5 bar is quarantined, not repaired; check causal coverage for each source entry.",
         "A fixed filter selected from observed 53 winners and losers is not independent evidence of forecast skill.",
       ],
    }
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
    with LEDGER.open("w",encoding="utf8") as f:
       for row in feature_rows:f.write(json.dumps(row,ensure_ascii=False,sort_keys=True)+"\n")
    md=[
       "# P39 Original Native53 causal M5 gate transfer",
       "",
       "P38で事前固定した入口判定をS4構造系列ではなく元のNative V20 53件にそのまま移植（出口・指標の再学習なし）。Native基準行にはP34の入口フィルタを適用していない。",
       "Native53各取引の元本比損益は単独収益であり、重複建玉・複利・単独ポートフォリオDDを計算していない。",
       "",
       "| Gate | 採用候補 | 勝数 | 勝率 | 累積単独元本比ポイント | 勝ち除外 | 負け除外 |",
       "|---|---:|---:|---:|---:|---:|---:|"]
    for x in normal:
       md.append(f"| {x['gate']} | {x['selectedSourceNativeTrades']} | {x['selectedWins']} | {x['conditionalWinratePct']:.2f}% | {x['sumStandaloneEquityReturnPctPoints']:.2f} | {x['excludedWinners']} | {x['excludedLosers']} |")
    md+=["","結論：未見の独立期間で再現しない限り採用しない。元P35からの検証であり、P38との二重利用による過学習を警戒する。",""]
    NOTE.write_text("\n".join(md),encoding="utf8")
    print("PRISM7_P39_ORIGINAL_NATIVE53_CAUSAL_TRANSFER_PASS")
    print("NATIVE53",{"n":len(native),"validMicro":out["featureAvailableForNative53"],"scenarios":len(test_results)})
    for x in normal:
       print("P39",json.dumps({k:x[k] for k in ("gate","selectedSourceNativeTrades","selectedWins","conditionalWinratePct","sumStandaloneEquityReturnPctPoints","excludedWinners","excludedLosers","cohorts")},ensure_ascii=False))
    print("P39_CRITERIA_MET",compliant)
    print("OUT",OUT,LEDGER,NOTE)

if __name__=="__main__":main()
