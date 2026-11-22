#!/usr/bin/env python3
"""P46 as-of lead-time robustness:
P42 first <=-3% crossing H1, latest in 48h before a native SHORT V20 source entry.
Check same 3 pre-bear conditions at exactly 1/3/6/12/24 HOURS BEFORE
the crossing H1 candle, using only then-completed H1 bars.
Native53 entries/exits unchanged; one slot and 0.75x P44 marks.
No future info in any precondition. Historical source is NOT unseen OOS.
"""
from __future__ import annotations
import gzip,json,hashlib
from pathlib import Path
from collections import Counter
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import h1_source,moving_ema,H
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE,PENGUH1,BTCH1,SOURCES,GROSS
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import source_slot,economy
P42SOURCE=R/"PRISM7_P42_PREQUALIFIED_DOWNCROSS_ALL_CANDIDATES_20261122.jsonl.gz"
P44=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_0P75_SINGLE_SLOT_20261122.json"
OUT=R/"PRISM7_P46_PRE_DOWNLEG_LEADTIME_ALL3_NATIVE53_20261122.json"
MD=R/"PRISM7_P46_PRE_DOWNLEG_LEADTIME_ALL3_NATIVE53_20261122.md"
LAGS=(1,3,6,12,24)
WINDOW_H=48
def rng(v):return round(float(v),5)
def sha(f):return hashlib.sha256(Path(f).read_bytes()).hexdigest()
def native_row(x):return {"key":x["period"]+"|"+x["id"]+"|"+str(x["entryTs"]),
    "period":x["period"],"id":x["id"],"entryTs":x["entryTs"],"entryPrice":x["entryPrice"],
    "exitTs":x["exitTs"],"exitPrice":x["exitPrice"],
    "sourceExitReason":x["exitReason"],"sourceNativeNet30Pct":x["net30pct"]}
def main():
    native=json.loads(SOURCE.read_text(encoding="utf8"))
    assert len(native)==53 and sum(x["net30pct"]>0 for x in native)==29
    p,psha=h1_source(PENGUH1);b,bsha=h1_source(BTCH1)
    assert len(p)==len(b) and all(x["time"]==y["time"] for x,y in zip(p,b))
    m5,msha=load_m5(SOURCES)
    with gzip.open(P42SOURCE,"rt",encoding="utf8") as f:
        crossing=sorted([json.loads(z) for z in f if z.strip()],key=lambda x:x["intentTs"])
    crossing=[z for z in crossing if z["thresholdPct"]==3]
    assert len(crossing)==410
    byhour={x["time"]:i for i,x in enumerate(p)}
    e72=moving_ema(p,72);e168=moving_ema(p,168)
    cohort_cases=[]
    for x in native:
        earlier=[z for z in crossing if 0<x["entryTs"]-z["intentTs"]<=WINDOW_H*H]
        trigger=earlier[-1] if earlier else None
        detail={"source":native_row(x),"sourceWin":x["net30pct"]>0,
             "triggerId":trigger["id"] if trigger else None,"candidateAtUtc":trigger["intentTs"] if trigger else None,
             "leads":{}}
        for lag in LAGS:
            if not trigger:detail["leads"][str(lag)]=None;continue
            i=byhour[trigger["signalReferenceTs"]]
            k=i-lag
            if k<180:detail["leads"][str(lag)]=None;continue
            if p[k]["time"]+H>trigger["signalReferenceTs"]:
                raise ValueError("P46_FUTURE_H1_FEATURE_SIGNAL_LEAK")
            btc24=b[k]["close"]/b[k-24]["close"]-1
            pengu24=p[k]["close"]/p[k-24]["close"]-1
            flags={
                "btcBear":btc24<=0,
                "relativeWeak":pengu24-btc24<=-.01,
                "emaBear":e72[k]<e168[k] and p[k]["close"]<e72[k]
            }
            detail["leads"][str(lag)]={
                "H1FeatureReferenceTs":p[k]["time"],
                "strictlyBeforeCrossingH1":True,
                "leadHours":lag,
                "penguReturn24Pct":rng(100*pengu24),
                "btcReturn24Pct":rng(100*btc24),
                "flags":flags,
                "all3":all(flags.values()),
                "wasAlreadyBelowD3AtPreconditionTime":pengu24<=-.03,
            }
            if lag==1:
                old=trigger["prior"]["flags"]
                assert all(old[z]==flags[z] for z in ("btcBear","relativeWeak","emaBear")),("P46_P42_H1_FLAG_PARITY",x["id"])
        cohort_cases.append(detail)
    assert len(cohort_cases)==53
    p44=json.loads(P44.read_text(encoding="utf8"))
    assert p44["targetNativeSourcePeriodCounts"]=={"PRE":"1/3 wins","BASE":"17/17 wins","POST":"1/1 wins"}
    scenarios=[]
    for lag in LAGS:
        for pure_before in (False,True):
            selected=[]
            for x in cohort_cases:
                one=x["leads"][str(lag)]
                if one is None or not one["all3"]:continue
                if pure_before and one["wasAlreadyBelowD3AtPreconditionTime"]:continue
                selected.append(x["source"])
            slot,blocked=source_slot(selected)
            for slip in (0,100):
                e=economy(slot,m5,30,slip)
                scenarios.append({"featureLeadHours":lag,"requireBeforeD3":pure_before,
                    "sourceNative53":53,"sourceCandidates":len(selected),
                    "sourceWins":sum(z["sourceNativeNet30Pct"]>0 for z in selected),
                    "nativeSourceWinRatePct":rng(100*sum(z["sourceNativeNet30Pct"]>0 for z in selected)/len(selected)) if selected else None,
                    "singleSlotBlocked":len(blocked),"feeBps":30,"extraCoverSlippageBps":slip,"capital":e})
    ref=next(z for z in scenarios if z["featureLeadHours"]==1 and not z["requireBeforeD3"] and z["extraCoverSlippageBps"]==0)
    p44_ref=next(z for z in p44["modelGrid"] if z["thresholdPct"]==3 and z["hours"]==48 and z["feeBps"]==30 and z["extraBuyCoverSlipBps"]==0)
    for k in ("singleSlotPositions","wins","M5HighStressMarkedDDPct","finalNAVYen"):
       assert abs(ref["capital"][k]-p44_ref["economics"][k])<=1e-7,(k,ref["capital"][k],p44_ref["economics"][k])
    report={"schema":"prism7-p46-real-pre-downleg-3flag-hours-before-d3-native53/v1",
       "status":"IN_SAMPLE_LEAD_HOUR_SENSITIVITY_RESEARCH_ONLY",
       "asofPriorH1FlagsP42Parity":True,"baseP44NativeSourceSingleSlotParity":True,
       "crossingThresholdD3Pct":-3,"crossingLookbackNativeHours":WINDOW_H,
       "preFeatureLeadHours":LAGS,
       "all20ScenarioEvidence":scenarios,"scenarios":len(scenarios),
       "allOriginalNative53CaseFeatureTrace":cohort_cases,
       "gross":GROSS,
       "hashes":{"Native53":sha(SOURCE),"P42SourceCrosses":sha(P42SOURCE),
           "P44":sha(P44),"PENGUH1":psha,"BTCH1":bsha,"PENGUM5":msha},
       "limitations":[
          "All PRE/BASE/POST have previously been examined, not genuine untouched out-of-sample.",
          "A filter from 1h before -3 crossing is not necessarily from before the ENTIRE price downleg; require-before-D3 flag tests multi-cross history.",
          "Small selected Native53 source cohort and 20 scenarios can severely overfit.",
          "Source Native53 has overlapping natural candidates and no production signed fill proofs. Single-slot is a hypothetical gross0.75 accounting model.",
          "Earlier H1 indicators may reflect the decline already underway: cannot assert pre-trend predictive power.",
          "M5 mark-to-market against source H1 entries/exits may be incoherent; no funding, shared Gross, other Runner impact.",
          "No live adoption regardless of positive in-sample scores."
       ]}
    OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    normal=[x for x in scenarios if x["extraCoverSlippageBps"]==0]
    lines=["# P46 | pre-D3 leading H1 condition stability check",
      "",
      "Tests 3 bearish context flags with 1h/3h/6h/12h/24h lead before crossing D3. Same native53 H1 original exits and P44 one-slot gross0.75.",
      "",
      "| Lead h | Before D3 regime? | Source kept | Source winners | Single-slot n | Single-slot wins | win% | M5 high DD | NAV yen |",
      "|---|---|---:|---:|---:|---:|---:|---:|---:|"]
    for x in normal:
       y=x["capital"]
       lines.append("| "+str(x["featureLeadHours"])+" | "+str(x["requireBeforeD3"])+" | "+str(x["sourceCandidates"])+" | "+str(x["sourceWins"])+" | "+str(y["singleSlotPositions"])+" | "+str(y["wins"])+" | "+str(y["conditionalWinPct"])+"% | "+str(y["M5HighStressMarkedDDPct"])+"% | "+str(y["finalNAVYen"])+" |")
    lines+=["","Status: no unseen OOS, no production approval, any positive result research only."]
    MD.write_text("\n".join(lines)+"\n",encoding="utf8")
    print("P46_PREDROP_H1_3FLAG_LEADTIME_NATIVE53_SOURCE_P44_PARITY_PASS",json.dumps({
      "lagSensitivity":[{"leadHours":z["featureLeadHours"],"beforeD3":z["requireBeforeD3"],
        "kept":z["sourceCandidates"],"winSource":z["sourceWins"],
        "closed":z["capital"]["singleSlotPositions"],"winSlot":z["capital"]["wins"],
        "winPct":z["capital"]["conditionalWinPct"],"DD":z["capital"]["M5HighStressMarkedDDPct"],
        "NAV":z["capital"]["finalNAVYen"]} for z in normal]},ensure_ascii=False),flush=True)
    print("OUT",OUT,MD)
if __name__=="__main__":main()
