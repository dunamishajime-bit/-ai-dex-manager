#!/usr/bin/env python3
"""PRISM VII P34. Preregistered 0.75x causal feature ablation for PENGU SELLER.
No source order/runner change. Every scenario starts from 120 source S4 intents.
Only P20 pre-entry asofFeatures are allowed for trade eligibility.
"""
from __future__ import annotations
import csv,json,hashlib,argparse,math
from pathlib import Path
from collections import Counter,defaultdict
from prism7_p33_native_v20_s4_shock_fixed_gross_hybrid_20261122 import (
 source_slot_all,keep_case,strict_replay_native_slot)
from prism7_p28_layer3_fixed_gross_capital_allocation_20261122 import scan
from prism7_p21_pengu_s3_m5_seller_confirmation_fsm_20261122 import apply_single_slot
from prism7_native53_event_attribution_20261122 import load_m5

FEE=30
GROSS=.75
PENGU_PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
MODELS=("BASE_UNMODIFIED","SELLER_BTC_TREND_ONLY","SELLER_REL_WEAKNESS_ONLY",
        "SELLER_EMA_TREND_ONLY","SELLER_CONSENSUS_3_OF_3")
SCENARIOS=(("SHOCK_ON",2,0),("SHOCK_ON",2,1000),("SHOCK_ON",3,0),("SHOCK_ON",3,1000),
           ("SHOCK_OFF",0,0))
FIRST_ROUTE="SELLER_PULLBACK_REJECTION"
def causal_profiles(csvpath,native):
    with csvpath.open("r",encoding="utf-8",newline="") as f:
        records=list(csv.DictReader(f))
    if len(records)!=120:raise ValueError("P34_WRONG_SOURCE_P20_ENTRY_ROWS")
    if len(set(z["id"] for z in records))!=120:raise ValueError("P34_SOURCE_DUPLICATE")
    lookup={x["id"]:x for x in native}
    if set(lookup)!=set(z["id"] for z in records):raise ValueError("P34_P32_P20_SOURCE_120_SET_MISMATCH")
    profiles={}
    for z in records:
        x=lookup[z["id"]]
        if any(str(z[k])!=str(x[k]) for k in ("route","cohort","signalReferenceTs","intentTs")):
            raise ValueError("P34_PINNED_P20_CAUSAL_SOURCE_CHANGED:"+z["id"])
        if z["futurePricesUsedToFormSignal"].strip().lower()!="false":
            raise ValueError("P34_SOURCE_P20_FUTURE_PRICE_SIGNAL_LEAK:"+z["id"])
        if not(int(z["signalReferenceTs"])<=int(z["intentTs"])<=
                   int(x["entryProxyTs"] if x["entryProxyTs"] is not None else z["intentTs"])):
            raise ValueError("P34_BAD_H1_TIMESTAMP_ORDER:"+z["id"])
        d=json.loads(z["asofFeatures"])
        needed=("BTCret6","PENGUminusBTC6","EMA24","EMA72")
        if not all(n in d for n in needed):raise ValueError("P34_NOT_ALL_PRECOMMITTED_FEATURES")
        valid=all(isinstance(d[k],(int,float)) and math.isfinite(d[k]) for k in needed)
        flags={
          "btcWeak6h":valid and d["BTCret6"]<=0.,
          "relativeWeak6h":valid and d["PENGUminusBTC6"]<=0.,
          "emaDown24Below72":valid and d["EMA24"]<=d["EMA72"],
        }
        profiles[z["id"]]={
          "id":z["id"],"route":z["route"],"cohort":z["cohort"],
          "signalReferenceTs":int(z["signalReferenceTs"]),"intentTs":int(z["intentTs"]),
          "nativeEntryTs":x["entryProxyTs"],
          "valid":valid,
          "BTCret6":d["BTCret6"],"PENGUminusBTC6":d["PENGUminusBTC6"],
          "EMA24":d["EMA24"],"EMA72":d["EMA72"],"flags":flags,
          "originalP20SourceUsesFuture":False,
        }
    return profiles

def allowed(profile,model):
    if model=="BASE_UNMODIFIED":return True
    if profile["route"]!=FIRST_ROUTE:return True
    if not profile["valid"]:return False
    flags=profile["flags"]
    if model=="SELLER_BTC_TREND_ONLY":return flags["btcWeak6h"]
    if model=="SELLER_REL_WEAKNESS_ONLY":return flags["relativeWeak6h"]
    if model=="SELLER_EMA_TREND_ONLY":return flags["emaDown24Below72"]
    if model=="SELLER_CONSENSUS_3_OF_3":return all(flags.values())
    raise ValueError("P34_UNKNOWN_MODEL_"+model)

def block(row,profile,model):
    if allowed(profile,model):return {**row,
       "p34Model":model,
       "p34BlockedByPreEntrySignals":False}
    y={**row,"p34Model":model,"p34BlockedByPreEntrySignals":True,
       "p34OriginalSourceStatus":row["status"],
       "p34OriginalEntryTs":row.get("entryProxyTs"),
       "p34OriginalExitTs":row.get("exitProxyTs"),
       "p34OriginalExitPrice":row.get("exitProxyPrice"),
       "p34OriginalExitReason":row.get("exitReason"),
       "status":"RESEARCH_P34_GATE_BLOCKED",
       "entryProxyTs":None,"entryProxyPrice":None,
       "exitProxyTs":None,"exitProxyPrice":None,
       "exitReason":None}
    return y

def realized(proxies,fee=FEE):
    results={}
    for x in proxies:
        if x["status"]!="PRICE_PROXY_CLOSED":continue
        results[x["id"]]=100*(1-float(x["exitProxyPrice"])/float(x["entryProxyPrice"]))-fee/100
    return results

def grouped(rows):
    g=defaultdict(list)
    for z in rows:
        if z["status"]=="PRICE_PROXY_CLOSED":
            pct=100*(1-z["exitProxyPrice"]/z["entryProxyPrice"])-FEE/100
            g[(z["route"],z["cohort"])].append(pct)
    return [
       {"route":k[0],"cohort":k[1],"closed":len(p),
        "wins":sum(v>0 for v in p),"meanNetOnNotional":sum(p)/len(p)}
       for k,p in sorted(g.items())
    ]
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--p20",type=Path,required=True)
    ap.add_argument("--p32-all",type=Path,required=True)
    ap.add_argument("--p32-single",type=Path,required=True)
    ap.add_argument("--p33-events",type=Path,required=True)
    ap.add_argument("--p33-summary",type=Path,required=True)
    ap.add_argument("--pengu-m5",type=Path,nargs="+",required=True)
    ap.add_argument("--out-summary",type=Path,required=True)
    ap.add_argument("--out-positions",type=Path,required=True)
    ap.add_argument("--out-source-profiles",type=Path,required=True)
    a=ap.parse_args()
    native=json.loads(a.p32_all.read_text(encoding="utf-8"))
    priorSingle=json.loads(a.p32_single.read_text(encoding="utf-8"))
    if len(native)!=120 or len(priorSingle)!=120:raise ValueError("P34_NATIVE_SOURCE_120_MISSING")
    strict_replay_native_slot(native,priorSingle)
    profiles=causal_profiles(a.p20,native)
    prior=json.loads(a.p33_summary.read_text(encoding="utf-8"))
    detections=json.loads(a.p33_events.read_text(encoding="utf-8"))
    if len(detections)!=120 or prior["originalPinnedNativeV20SHA"]!=PENGU_PIN:
        raise ValueError("P34_S4_NATIVE_PIN_OR_SHOCK_EVENTS_MISSING")
    market,msha=load_m5(a.pengu_m5)
    baseline_by_source={}
    for version,delay,slip in SCENARIOS:
        scenarioId=(version,delay,slip)
        raw=[keep_case(x,detections[x["id"]],delay,slip)
             if version=="SHOCK_ON" else {**x,"p25EarlyExitApplied":False}
             for x in native]
        refslot=source_slot_all(raw)
        ref=realized(refslot)
        baseline_by_source[scenarioId]={
         "originalSourceCandidates":raw,"sourceSingleSlot":refslot,"sourceRealized":ref}
    all_results=[]
    all_ledger=[]
    for model in MODELS:
      for version,delay,slip in SCENARIOS:
        key=(version,delay,slip)
        baseline=baseline_by_source[key]
        raw=[block(x,profiles[x["id"]],model)
             for x in baseline["originalSourceCandidates"]]
        slot=apply_single_slot(raw)
        if len(slot)!=120 or set(x["id"] for x in slot)!=set(profiles):
            raise ValueError("P34_LOST_NATIVE_SOURCE_SETUP")
        ev,records=scan(slot,market,GROSS,FEE)
        p33=next((z for z in prior["allNinetyJointEconomicAndRiskScenarios"] if
            z["grossPerSourceEntryEquity"]==.75 and z["roundtripFeeBps"]==30
            and z["positiveM5ExitPrintAfterCausalShock"]==delay and
            z["extraBuyToCoverSlipBps"]==slip),None) if version=="SHOCK_ON" else None
        if model=="BASE_UNMODIFIED" and version=="SHOCK_ON":
            if p33 is None:raise ValueError("P34_P33_SOURCE_SCENARIO_NO_EXACT_PARITY")
            old=p33["referenceEconomicsAndRisk"]
            for k in ("sourceM5CloseMarkedDDPct","sourcePrevCompletedM5PeakHighStressDDPct",
                "conditionalMeanNetReturnPctOnEquity","conditionalProfitFactor",
                "sourceReferenceFinalEquityInclCensoredMarkYen","conditionalWinCount",
                "originalSourceCompletedTradeCount"):
                if abs(float(ev[k])-float(old[k]))>1e-6:
                    raise ValueError("P34_P33_ORIGINAL_0P75_PARITY_MISMATCH:"+k)
        original=baseline["sourceRealized"]
        new=realized(slot)
        excludedWins=[{"id":k,"referenceGrossNetPct":v} for k,v in original.items()
               if v>0 and k not in new]
        excludedLosses=[{"id":k,"referenceGrossNetPct":v} for k,v in original.items()
               if v<0 and k not in new]
        newAdmitted=[{"id":k,"grossNetPct":v} for k,v in new.items()
              if k not in original]
        sameChanged=[{"id":k,"original":v,"new":new[k]} for k,v in original.items()
              if k in new and abs(v-new[k])>1e-9]
        markedWorst=ev["worstMarkEvent"]
        selected={x["id"] for x in slot if x["status"]=="PRICE_PROXY_CLOSED" or
                  x["status"].startswith("RIGHT_CENSORED")}
        res={
          "model":model,"p25ShockModel":version,
          "positiveM5PrintAfterShock":delay if version=="SHOCK_ON" else None,
          "buyCoverExtraSlipBps":slip,
          "gross":GROSS,"roundtripFeeBps":FEE,
          "originalSourceS4Intents":len(slot),
          "blockedIntentsOfSource120":sum(x["p34BlockedByPreEntrySignals"] for x in slot),
          "blockedOfNativeValidEntryCandidates":sum(
             x["p34BlockedByPreEntrySignals"] and x["p34OriginalEntryTs"] is not None
             for x in slot),
          "nativeReference21Completed":len(original),
          "sourceReferenceWinners":sum(v>0 for v in original.values()),
          "stoppedOriginalWinners":excludedWins,
          "stoppedOriginalLosers":excludedLosses,
          "newlyAdmittedTrades":newAdmitted,
          "originalSurvivorChangedEconomics":sameChanged,
          "originalReferenceWinnersNetPctPointsLost":sum(z["referenceGrossNetPct"] for z in excludedWins),
          "originalReferenceLosersNetPctPointsAvoided":-sum(z["referenceGrossNetPct"] for z in excludedLosses),
          "sourceWinnersPreserved":sum(v>0 and k in new and new[k]>0
                  for k,v in original.items()),
          "routeCohortClosedAt0p75":grouped(slot),
          "selectedIds":sorted(selected),
          "sourceOriginalSourceStatusCounts":dict(Counter(x["status"] for x in slot)),
          "riskAndProfitAtFixed0p75":ev,
          "productionReady":False,
        }
        all_results.append(res)
        for row in records:
            all_ledger.append({
                "model":model,"shockModel":version,"delay":delay,"extraSlip":slip,
                "gross":GROSS,"fee":FEE,"p34CausalSignals":profiles[row["id"]]["flags"],
                **row,
            })
    if len(all_results)!=25:raise ValueError("P34_PRECOMMIT_25_CASES_NOT_ALL")
    report={
       "schema":"prism7-p34-pengu-seller-3asof-gates-fixed0p75-source120-25-models/v1",
       "sourcePinnedSHA":PENGU_PIN,
       "grossFixed":GROSS,
       "source120IntentsPreserved":True,
       "p33OriginalNativeExitBaseParityVerified":True,
       "sourceNative53NaturalSignalsUnaltered":True,
       "testedModels":MODELS,
       "sourceM5StressScenarios":SCENARIOS,
       "source120SignalProfileStats":{
           "SELLER_PULLBACK_REJECTION":{
              "allSourceCandidates":sum(z["route"]==FIRST_ROUTE for z in profiles.values()),
              "precommittedFlagsAggregateCounts":{
                 k:sum(z["route"]==FIRST_ROUTE and z["flags"][k] for z in profiles.values())
                 for k in ("btcWeak6h","relativeWeak6h","emaDown24Below72")
              }
           },
           "allNativeS4StructureCandidates":120,
       },
       "allTwentyFiveFixed0p75Scenarios":all_results,
       "inputSHA":{
          "P20SourceAsOfOriginal120":hashlib.sha256(a.p20.read_bytes()).hexdigest(),
          "P32NativeS4All120":hashlib.sha256(a.p32_all.read_bytes()).hexdigest(),
          "P32NativeS4Single120":hashlib.sha256(a.p32_single.read_bytes()).hexdigest(),
          "P33CausalSourceShock":hashlib.sha256(a.p33_events.read_bytes()).hexdigest(),
          "P33EconomicSourceComparator":hashlib.sha256(a.p33_summary.read_bytes()).hexdigest(),
          "PENGUM5Source":msha,
       },
       "limitations":[
         "PRE, BASE, and POST price outcomes have already been used in prior phase studies. POST is not a truly blind untouched time-period validation.",
         "Only 21 source S4 native reference completed positions with 15wins. A threshold-based screen may be inflated by low sample and structurally biased missing opportunity trades.",
         "Fixed P33 shock rule was developed in sample from a 2025-10 flash crash, and only 1 signal was seen in 120 causal source setups.",
         "S4 entry is NEW and not a pinned original V20 runner entry signal.",
         "Actual multi-runner portfolio DD, fills, asks, funding and source trading approvals not represented. Production blocked.",
       ],
    }
    for dest in (a.out_summary,a.out_positions,a.out_source_profiles):
        dest.parent.mkdir(parents=True,exist_ok=True)
    a.out_summary.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    with a.out_positions.open("w",encoding="utf-8") as f:
        for rec in all_ledger:f.write(json.dumps(rec,ensure_ascii=False,sort_keys=True)+"\n")
    a.out_source_profiles.write_text(json.dumps(profiles,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("PRISM7_P34_ALL_SOURCE120_P33_0P75_PARITY_25_GRID_PASS")
    for r in all_results:
        if r["p25ShockModel"]=="SHOCK_OFF" or (r["positiveM5PrintAfterShock"] in (2,3)
          and r["buyCoverExtraSlipBps"] in (0,1000)):
          e=r["riskAndProfitAtFixed0p75"]
          print("CANDIDATE",json.dumps({
             "model":r["model"],"shock":r["p25ShockModel"],"delay":r["positiveM5PrintAfterShock"],
             "slip":r["buyCoverExtraSlipBps"],
             "blocked":r["blockedOfNativeValidEntryCandidates"],
             "closed":e["originalSourceCompletedTradeCount"],"wins":e["conditionalWinCount"],
             "winrate":e["conditionalWinratePct"],
             "average":e["conditionalMeanNetReturnPctOnEquity"],"pf":e["conditionalProfitFactor"],
             "DD":e["sourceM5CloseMarkedDDPct"],"HIGHDD":e["sourcePrevCompletedM5PeakHighStressDDPct"],
             "removedWins":len(r["stoppedOriginalWinners"]),"removedLosses":len(r["stoppedOriginalLosers"]),
             "newAdmitted":len(r["newlyAdmittedTrades"])
          },ensure_ascii=False))
if __name__=="__main__":main()
