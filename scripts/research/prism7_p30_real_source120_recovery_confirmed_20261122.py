#!/usr/bin/env python3
"""P30 real SOURCE S4 120 structural setups with causal post-shock recovery confirmation.

This is previously observed historical Aster M5 and NOT independent OOS.
Original source S4 entry and REFERENCE_STOP72 unaffected; close BUY proxy only
when both new PENGU and BTC M5 close features are complete and STOP still ahead.
"""
from __future__ import annotations
import argparse,csv,hashlib,json
from pathlib import Path
from collections import Counter
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p21_pengu_s3_m5_seller_confirmation_fsm_20261122 import apply_single_slot
from prism7_p25_s4_cross_asset_capitulation_capture_20261122 import (
 original_121_source,load_btc_sanitized
)
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import aggregate
from prism7_p23_m5_mark_to_market_censored_position_risk_20261122 import stream_group
NAME="PENGU_S4_RECOVERY_CONFIRMED_EXIT_V1"
M5=300000
PENGU_REC=1.01
BTC_REC=1.005
FEES=(10,30)
SLIPS=(0,100,1000)
DELAYS=(1,2)
def detect(source_event,pengu,btc,original_stop_ts):
    if source_event["state"]!="CROSS_ASSET_CAPITULATION_CONFIRMED":
        return {"status":"NO_SOURCE_CAPITULATION_SIGNAL"}
    event_end=int(source_event["eventCloseTs"])
    orig_end=int(original_stop_ts) if original_stop_ts is not None else 1794960000000
    pc=float(source_event["penguM5Close"]);bc=float(source_event["btcM5Close"])
    for i in range(24):
        t=event_end+i*M5
        if t>=orig_end:break
        p=pengu.get(t);b=btc.get(t)
        if p is None:raise ValueError("P30_PENGU_SOURCE_M5_GAP")
        if b is None or float(p[5])<=0 or float(b[5])<=0:continue
        if not(float(p[4])>=pc*PENGU_REC and
               float(p[4])>float(p[1]) and
               float(b[4])>=bc*BTC_REC):
            continue
        confirmed_close=t+M5
        if confirmed_close>=orig_end:break
        fills=[]
        for k in range(1,25):
            ts=t+k*M5
            if ts>=orig_end:break
            row=pengu.get(ts)
            if row is None:raise ValueError("P30_PENGU_NEXT_POSITIVE_PRINT_GAP")
            if float(row[5])>0:
                fills.append({"ts":ts,"px":float(row[1]),
                              "positiveM5Volume":float(row[5]),
                              "positiveM5NotionalAtOpenUSDT":float(row[1])*float(row[5])})
                if len(fills)>=2:break
        return {
           "status":"RECOVERY_CONFIRMED_COMPLETED_SOURCE_M5",
           "lastCapitulationCloseTs":event_end,
           "confirmationM5StartTs":t,
           "confirmationM5CloseTs":confirmed_close,
           "penguConfirmedClose":float(p[4]),
           "btcConfirmedClose":float(b[4]),
           "confirmPENGUGreenClose":float(p[4])>float(p[1]),
           "newInformationOnlyAfterShock":True,
           "noFutureM5PriceUsedToDecideConfirmation":True,
           "positiveM5BuyProxyAfterConfirmation":fills,
           "signedVenueFillProven":False,
        }
    return {"status":"NO_RECOVERY_CONFIRMED_BEFORE_2H_OR_NATIVE_STOP",
            "newInformationOnlyAfterShock":True}

def override(o,r,delay,slip):
    x={**o,"p30EvidenceState":r["status"],"p30ExtraExitSlippageBps":0,
       "p30ExitApplied":False,"p30CorrectSourceExitPreempts":True,
       "p30ResearchExitSignedVenueFillProven":False}
    if r["status"]!="RECOVERY_CONFIRMED_COMPLETED_SOURCE_M5":return x
    options=r["positiveM5BuyProxyAfterConfirmation"]
    if len(options)<delay:return x
    q=options[delay-1]
    original_exit=o.get("exitProxyTs") or 1794960000000
    if not r["confirmationM5CloseTs"]<=q["ts"]<original_exit:return x
    px=q["px"]*(1+slip/10000)
    x.update(status="PRICE_PROXY_CLOSED",exitProxyTs=q["ts"],
      exitProxyPrice=px,
      exitReason="RESEARCH_P30_RECOVERY_CONFIRMED_EXIT",
      exitKind="FIRST_NEXT_POSITIVE_PENGU_M5_AFTER_COMPLETED_BTC_PENGU_RECOVERY",
      p30ExitApplied=True,
      p30ConfirmM5ClosedTs=r["confirmationM5CloseTs"],
      p30ExtraExitSlippageBps=slip,
      p30BuyerRecoveryConfirmedAtUtcMs=r["confirmationM5StartTs"],
      p30ExitM5PositiveVolume=q["positiveM5Volume"],
      p30ExitM5NotionalUSDTNotBidDepth=q["positiveM5NotionalAtOpenUSDT"])
    if x["exitProxyTs"]<r["confirmationM5CloseTs"]:
        raise ValueError("P30_FUTURE_LEAK_EXECUTION_ON_CONFIRMING_BAR_OPEN")
    return x

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--p22-events",type=Path,required=True)
    a.add_argument("--p25-source",type=Path,required=True)
    a.add_argument("--pengu-m5",type=Path,nargs="+",required=True)
    a.add_argument("--btc-m5",type=Path,nargs="+",required=True)
    a.add_argument("--out-summary",type=Path,required=True)
    a.add_argument("--out-event-ledger",type=Path,required=True)
    a.add_argument("--out-scenario-ledger",type=Path,required=True)
    args=a.parse_args()
    p22=[json.loads(x) for x in args.p22_events.read_text(encoding="utf-8").splitlines() if x.strip()]
    p25=json.loads(args.p25_source.read_text(encoding="utf-8"))
    orig=original_121_source(p22)
    p25_events=p25["all120PerCandidateDetectionEvents"]
    if len(orig)!=120 or set(p25_events)!=set(x["id"] for x in orig):
        raise ValueError("P30_SOURCE120_PARITY_MISSING")
    pengu,ph=load_m5(args.pengu_m5)
    btc,bh,offpos=load_btc_sanitized(args.btc_m5,orig)
    events={x["id"]:detect(p25_events[x["id"]],pengu,btc,x.get("exitProxyTs")) for x in orig}
    originalSlot=[x for x in p22 if x["group"]=="S4_SINGLE_SLOT"]
    sourceSlot=apply_single_slot(orig)
    oldMap={x["id"]:x for x in originalSlot}
    if len(sourceSlot)!=120:raise ValueError("P30_BASE120_EMPTY")
    for o in sourceSlot:
        ref=oldMap[o["id"]]
        for k in ("status","entryProxyTs","entryProxyPrice",
                  "exitProxyTs","exitProxyPrice","exitReason"):
            if o.get(k)!=ref.get(k):raise ValueError("P30_P22_ORIGINAL_SINGLE_SLOT_CHANGED")
    results=[]
    individual=[]
    for delay in DELAYS:
        for slip in SLIPS:
            chosen=[override(o,events[o["id"]],delay,slip) for o in orig]
            slot=apply_single_slot(chosen)
            if len(slot)!=120:raise ValueError("P30_SINGLE_SLOT_SOURCE120_DROPPED")
            for fee in FEES:
                econ=aggregate(slot,fee,0)
                risk,_=stream_group(slot,pengu,fee,0)
                results.append({
                    "positivePrintDelayAfterRecovery":delay,"extraP30ExitSlipBps":slip,
                    "roundtripFeeBps":fee,
                    "allH1SourceStructureIntents":120,
                    "sourceRecoveryConfirmEventCount":sum(v["status"]=="RECOVERY_CONFIRMED_COMPLETED_SOURCE_M5" for v in events.values()),
                    "earlyExitExecutedCountAfterSingleSlot":sum(z.get("p30ExitApplied",False) for z in slot),
                    "entrySlotAndOriginalSourceReferenceStopUnchanged":True,
                    "referenceEconomics":econ,"referenceM5Risk":risk,
                })
                for z in slot:
                    individual.append({
                        "delay":delay,"slipBps":slip,"feeBps":fee,
                        "id":z["id"],"route":z["route"],"cohort":z["cohort"],
                        "sourceOriginalH1IntentTs":z["intentTs"],
                        "priceStatus":z["status"],"entryTs":z.get("entryProxyTs"),
                        "entryPrice":z.get("entryProxyPrice"),
                        "exitTs":z.get("exitProxyTs"),
                        "exitPrice":z.get("exitProxyPrice"),
                        "exitReason":z.get("exitReason"),
                        "p30RecoveryConfirmed":events[z["id"]]["status"]=="RECOVERY_CONFIRMED_COMPLETED_SOURCE_M5",
                        "p30ExitApplied":z.get("p30ExitApplied",False),
                        "signedFill":False,
                        "netPctPriceModel":100*(1-z["exitProxyPrice"]/z["entryProxyPrice"])-fee/100 if
                          z["status"]=="PRICE_PROXY_CLOSED" else None,
                    })
    if len(results)!=12 or len(individual)!=1440:raise ValueError("P30_REAL_SOURCE12_X_120_NOT_SAVED")
    main=next(z for z in results if z["positivePrintDelayAfterRecovery"]==1 and
            z["extraP30ExitSlipBps"]==0 and z["roundtripFeeBps"]==30)
    report={
      "schema":"prism7-p30-real-p25S4-120-causal-buyer-recovery-before-native-reference-stop/v1",
      "researchEngineName":NAME,
      "sourceReferencePinnedV20":"1657e173d250ad58f53e62f7bb0a3428fb405496",
      "originalH1StructuralSetups":120,
      "frozenRecoveryThresholds":{"PENGUShockCloseMultiplier":PENGU_REC,
                                  "BTCShockCloseMultiplier":BTC_REC,
                                  "PENGUM5MustBeGreen":True,"asofMaxHours":2},
      "p25SourceCapitulationEvents":{k:p25_events[k] for k in p25_events
                      if p25_events[k]["state"]=="CROSS_ASSET_CAPITULATION_CONFIRMED"},
      "newStateAfterExistingP25Events":events,
      "originalSourceS4SingleSlot120Parity":"PASS",
      "BTCSourceMalformedOffPosition":offpos,
      "all12SourceFeeCostDelayScenarios":results,
      "main30BpsFirstPositivePrintZeroSlip":main,
      "inputSHA256":{
         "P22Source":hashlib.sha256(args.p22_events.read_bytes()).hexdigest(),
         "P25Source":hashlib.sha256(args.p25_source.read_bytes()).hexdigest(),
         "PENGUM5":ph,"BTCM5":bh,
      },
      "limitations":[
        "P30 rule was invented after seeing original October 2025 actual flash event and P29 synthetic profit outcomes: NOT independent OOS.",
        "Frozen source H1 structure and REFERENCE_STOP72 are research economic overlay, NOT pinned PENGU SHORT V20 native position logic.",
        "Positive PENGU M5 open source proxy is not signed venue execution, actual bid/ask fill or orderbook depth.",
        "Changing only one historic trade cannot prove outperformance against unseen real or artificial false-bounce futures.",
        "No funding, real margin gross, multi-Runner correlated risk, daily shared risk7.5% or account mark DD full portfolio.",
      ],
    }
    args.out_summary.parent.mkdir(parents=True,exist_ok=True)
    args.out_summary.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    args.out_event_ledger.write_text(json.dumps(events,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    with args.out_scenario_ledger.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(individual[0]));w.writeheader();w.writerows(individual)
    print("PRISM7_P30_REAL_SOURCE120_12_COST_SCENARIOS_AND_1440_LEDGER_PASS")
    print("ALL_REAL_STATE_EVENTS",json.dumps({k:v for k,v in events.items()
       if v["status"]=="RECOVERY_CONFIRMED_COMPLETED_SOURCE_M5"},ensure_ascii=False))
    for z in results:
        if z["roundtripFeeBps"]==30 and z["extraP30ExitSlipBps"] in (0,1000):
            print("REAL_30BPS",z["positivePrintDelayAfterRecovery"],z["extraP30ExitSlipBps"],
                  "newExits",z["earlyExitExecutedCountAfterSingleSlot"],
                  "win",z["referenceEconomics"]["wins"],
                  "netMean",z["referenceEconomics"]["meanNetPctConditional"],
                  "pf",z["referenceEconomics"]["profitFactorConditional"],
                  "M5DD",z["referenceM5Risk"]["maximumM5CloseMarkToMarketDDPct"],
                  "highStressLegacy",z["referenceM5Risk"]["maximumM5HighAdverseEnvelopeDDPct"])
if __name__=="__main__":main()
