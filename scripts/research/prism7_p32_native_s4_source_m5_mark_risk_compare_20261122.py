#!/usr/bin/env python3
"""P32 new S4 natural M5 entry with immutable pinned native V20 exit vs reference STOP72.

All source H1 structural setup120, original P8 source natural53, S4 entry prices
unchanged. M5 positive CLOSE mark DD including source native right-censored.
"""
from __future__ import annotations
import argparse,json,hashlib
from pathlib import Path
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p23_m5_mark_to_market_censored_position_risk_20261122 import stream_group
from prism7_p26_previous_completed_m5_peak_high_stress_20261122 import study as chronological_high
from prism7_p28_layer3_fixed_gross_capital_allocation_20261122 import scan as capital_gross
FEES=(10,30)
GROSS=(.75,1.,1.25)
EXTRA=(0,10,25)
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--p32-native-s4",type=Path,required=True)
 p.add_argument("--p32-native-summary",type=Path,required=True)
 p.add_argument("--p22-reference-events",type=Path,required=True)
 p.add_argument("--p23-reference-risk",type=Path,required=True)
 p.add_argument("--pengu-m5",type=Path,nargs="+",required=True)
 p.add_argument("--out-summary",type=Path,required=True)
 p.add_argument("--out-risk-ledger",type=Path,required=True)
 a=p.parse_args()
 source=json.loads(a.p32_native_summary.read_text(encoding="utf-8"))
 native=json.loads(a.p32_native_s4.read_text(encoding="utf-8"))
 original=[json.loads(x) for x in a.p22_reference_events.read_text(encoding="utf-8").splitlines() if x.strip()]
 oldref=[x for x in original if x["group"]=="S4_SINGLE_SLOT"]
 oldrisk=json.loads(a.p23_reference_risk.read_text(encoding="utf-8"))
 if len(native)!=120 or len(oldref)!=120 or source["originalNewS4NaturalH1Setups"]!=120:
  raise ValueError("P32_SOURCE120_NOT_PARITY")
 original_map={x["id"]:x for x in oldref}
 for z in native:
  if z["id"] not in original_map:raise ValueError("P32_NEW_NATIVE_SETUPS_NOT_IN_ORIGINAL")
  old=original_map[z["id"]]
  for field in ("intentTs","entryProxyTs","entryProxyPrice"):
   if z.get(field)!=old.get(field):
    raise ValueError("P32_NATIVE_ENTRY_SOURCE_CHANGED:"+z["id"]+":"+field)
 if source["sourceNative53OriginalTradeParity"]!="PASS_53_53":
  raise ValueError("P32_PIN_V20_ORIGINAL53_NOT_PARITY")
 m5,msha=load_m5(a.pengu_m5)
 stats=[]
 ledgers=[]
 for label,events in [("PINNED_V20_EXIT_ON_S4",native),("P22_REFERENCE_STOP72",oldref)]:
  for fee in FEES:
   for slip in EXTRA:
    risk,riskrows=stream_group(events,m5,fee,slip)
    row={"group":label,"sourceGrossMultiplier":1.0,"feeBps":fee,
         "additionalExitSlipBps":slip,
         "sourceM5CloseMarkDDPct":risk["maximumM5CloseMarkToMarketDDPct"],
         "sourceP23LegacyHighEnvelopeDDPct":risk["maximumM5HighAdverseEnvelopeDDPct"],
         "priceProxyClosed":risk["priceProxyClosed"],
         "rightCensored":risk["rightCensoredOpenPositions"],
         "finalMarkedNAVYen":risk["referenceFinalEquityIncludingUnrealizedYen"]}
    if slip==0:
     chron,modelrows=chronological_high(events,m5,fee)
     if abs(chron["maximum5MCloseMarkedDDPct"]-risk["maximumM5CloseMarkToMarketDDPct"])>1e-6:
      raise ValueError("P32_CHRONOLOGICAL_M5_MARK_PARITY_FAIL")
     row.update({
       "causalPreviousCompletedM5PeakHighStressDDPct":chron["maximumPriorM5ClosePeakHighStressDDPct"],
       "chronologicalWorstHighEvent":chron["worstChronologicalHighEvent"],
       "chronologicalWorstMarkEvent":chron["worst5MCloseDDRecord"],
     })
    stats.append(row)
    if fee==30 and slip==0:
     for r in riskrows:ledgers.append({"group":label,"feeBps":fee,**r})
  # Fixed user-requested gross0.75x/1.0x/1.25x, no micro-optimization.
  for fee in FEES:
   for gross in GROSS:
    capital,capitalTraces=capital_gross(events,m5,gross,fee)
    stats.append({
     "group":label,"sourceGrossMultiplier":gross,"feeBps":fee,
     "additionalExitSlipBps":0,
     "capitalModel":capital,
     "capitalModelNotAllRunnerAccountRisk":True,
    })
 if len(stats)!=24:raise ValueError("P32_36_RISK_SCENARIO_SOURCE_INCOMPLETE")
 model_ref=next(z for z in oldrisk["groups"] if z["group"]=="S4_SINGLE_SLOT" and
      z["feeBps"]==30 and z["exitSlippageBps"]==0)
 old=next(z for z in stats if z["group"]=="P22_REFERENCE_STOP72" and
    z["sourceGrossMultiplier"]==1.0 and z["feeBps"]==30 and
    z["additionalExitSlipBps"]==0 and "capitalModel" not in z)
 if abs(old["sourceM5CloseMarkDDPct"]-model_ref["maximumM5CloseMarkToMarketDDPct"])>1e-7:
  raise ValueError("P32_MANDATORY_REFERENCE_P22_P23_SOURCE_RISK_NOT_PARITY")
 report={
  "schema":"prism7-p32-fixed-pengu-native-v20-exit-on-S4-entry-5m-mark-dd-v1",
  "sourcePinnedV20Sha":"1657e173d250ad58f53e62f7bb0a3428fb405496",
  "allH1S4StructuralSetups":120,
  "sourceS4NativeCandidatesPreserved":len(native),
  "sourceS4ReferenceCandidatesPreserved":len(oldref),
  "nativeEntryAndV20ExitPurity":"SOURCE_V20_EXIT_ONLY_NO_PINNED_SOURCE_ENTRY_SIGNAL",
  "originalSourceNative53EntryExitParity":"PASS_53_53",
  "originalS4ReferenceP23DDParitied":"PASS",
  "allCostRiskAndGrossScenarios":stats,
  "sourceOriginalS4NativeOutcome30Bps":next(x for x in source["allCostAndSourceComparatorStats"]
                                    if x["group"]=="PINNED_NATIVE_S4_SINGLE_SLOT" and x["originalSetupCount"]==120 and
                                       x["feeBps"]==30),
  "inputSHA256":{
    "nativeS4":hashlib.sha256(a.p32_native_s4.read_bytes()).hexdigest(),
    "nativeSourceSummary":hashlib.sha256(a.p32_native_summary.read_bytes()).hexdigest(),
    "oldS4Events":hashlib.sha256(a.p22_reference_events.read_bytes()).hexdigest(),
    "oldP23Risk":hashlib.sha256(a.p23_reference_risk.read_bytes()).hexdigest(),
    "sourcePENGUM5":msha,
  },
  "limitations":[
   "S4 is not pinned original SHORT V20 entry signal; native V20 exit is adapted to newly observed S4 M5 entry times.",
   "Original S4 reference STOP72 differs from native V20 SHORT phase and deadline; source H1 feature evaluation occurs after complete H1.",
   "The actual V20 Runner gross/funding/price ordering, 5min intrabar STOP signed fills are not proven.",
   "Gross0.75/1/1.25 capital model cannot be applied to LIVE account without Shared Risk and all-runner correlated gross test.",
   "DD based on source public M5 close with one-asset 1x is not actual portfolio mark-to-market DD.",
   "All data from observed historic 2025Aug–2026Nov, not blind independent unseen OOS.",
  ],
 }
 a.out_summary.parent.mkdir(parents=True,exist_ok=True)
 a.out_summary.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
 a.out_risk_ledger.write_text(json.dumps(ledgers,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
 print("PRISM7_P32_NATIVE_V20_EXIT_SOURCE_NEW_S4_ENTRIES_M5_RISK_PASS")
 for z in stats:
  if z["feeBps"]==30 and z["additionalExitSlipBps"]==0:
   if "capitalModel" not in z:
    print("NATIVE_VS_REFERENCE",z["group"],"DD",z["sourceM5CloseMarkDDPct"],
          "highCausal",z.get("causalPreviousCompletedM5PeakHighStressDDPct"),
          "closed",z["priceProxyClosed"],"unclosed",z["rightCensored"],
          "NAV",z["finalMarkedNAVYen"])
   elif z["sourceGrossMultiplier"] in (.75,1,1.25):
    x=z["capitalModel"]
    print("GROSS",z["group"],z["sourceGrossMultiplier"],
          "M5DD",x["sourceM5CloseMarkedDDPct"],"HIGH",x["sourcePrevCompletedM5PeakHighStressDDPct"],
          "WIN",x["conditionalWinCount"],"NAV",x["sourceReferenceFinalEquityInclCensoredMarkYen"])
if __name__=="__main__":main()
