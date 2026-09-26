#!/usr/bin/env python3
"""Use the archived 2026-09-24 integrated-engine.py UNCHANGED for paired PENGU comparison.

This is an adapter: it loads archived original artifacts, injects already
downloaded original V52 stock rows, and changes only PENGU ledger/gross in a
second replay. Does NOT claim equivalence to the 14.49億 Top3/FET result.
"""
from __future__ import annotations
import argparse
import csv
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path

EXPECTED_ENGINE_SHA256 = "cae9785492ea5dda8173853fe2cbc7d99ea451f550a739fb7f014f4773d9899d"
EXPECTED_NORMAL = 165415076.53599954
EXPECTED_STRESS = 22177854.10721198
EXPECTED_PERIOD = {"startInclusive":"2025-08-10T00:00:00.000Z","endExclusive":"2026-08-10T00:00:00.000Z"}

def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf8"))

def get_engine(path):
    raw=Path(path).read_bytes()
    sha=hashlib.sha256(raw).hexdigest()
    if sha!=EXPECTED_ENGINE_SHA256:
        raise RuntimeError("ORIGINAL_ENGINE_HASH_MISMATCH:"+sha)
    spec=importlib.util.spec_from_file_location("frozen_original_integrated_engine",path)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def candidate_rows(engine, frozen, mode):
    def iso_ms(v):return int(dt.datetime.fromisoformat(v).timestamp()*1000)
    severe=mode=="SEVERE"
    return [{
        "entryTs":iso_ms(row["entry"]),
        "exitTs":iso_ms(row["exit"]),
        "symbol":row["symbol"],
        "layer":row["layer"],
        "requestedGross":engine.SUPPLEMENT_GROSS_CAP,
        "side":engine.QUALITY102_RESIZE_SIDES.get(iso_ms(row["entry"]),0),
        "feePerSide":.0010 if severe else .0006,
        "fundingPerDay":.0005 if severe else .0002,
        "netUnitReturn":engine.finite(row["stress_net" if severe else "normal_net"]),
        "exitReason":row.get("exit_reason") or "QUALITY_FROZEN_EXIT",
    } for row in frozen]

def preload_original_price_evidence(engine, result):
    # Same source/price as originally loaded from Binance Vision by prior
    # authenticated GitHub Actions replay. Not a proxy or a new price model.
    for scenario in ("NORMAL","SEVERE"):
        for raw in result["results"][scenario]["grossVerification"].get("supplementGrossResizes",[]):
            symbol=str(raw["supplementSymbol"])
            engine._QUALITY102_KLINE_CACHE[(symbol,int(raw["supplementEntryTs"]))]=float(raw["entryPrice"])
            engine._QUALITY102_KLINE_CACHE[(symbol,int(raw["ts"]))]=float(raw["markPrice"])
    for (symbol,ts),(side,price) in engine.QUALITY102_FROZEN_ENTRY_EVIDENCE.items():
        engine._QUALITY102_KLINE_CACHE[(symbol,int(ts))]=float(price)

def convert_new_pengu(payload,mode):
    raw=payload["modes"]["normal" if mode=="NORMAL" else "stress"]
    clean=[]
    last_exit=-1
    for t in sorted(raw,key=lambda x:(int(x["entryTs"]),int(x["exitTs"]))):
        if t.get("variant")!="COMBINED_FILTERED" or abs(float(t["requestedGross"])-1)>1e-12:
            raise RuntimeError("NEW_PENGU_CONTRACT_MISMATCH")
        if t.get("openAtWindowEnd"):
            raise RuntimeError("NEW_PENGU_OPEN_AT_WINDOW_END")
        entry,exit=int(t["entryTs"]),int(t["exitTs"])
        if not entry<exit or entry<last_exit:
            raise RuntimeError("NEW_PENGU_OVERLAPPING_OR_INVALID_ENTRIES")
        last_exit=exit
        ret=float(t["accountReturn"])
        # Native PENGU gross=1, so accountReturn == netUnitReturn; preserve
        # original PENGU logic's fee/funding/partial-return accounting.
        clean.append({
            "entryTs":entry,"exitTs":exit,"requestedGross":1.0,
            "netUnitReturn":ret,"accountReturn":ret,
            "rawUnitReturn":float(t["rawUnitReturn"]),
            "fundingUnitReturn":float(t["fundingUnitReturn"]),
            "costUnitReturn":float(t["costUnitReturn"]),
            "entryPrice":float(t["entryPrice"]),"exitPrice":float(t["exitPrice"]),
            "exitReason":str(t["exitReason"]),"route":str(t["route"]),
            "side":t["side"],"signalTs":int(t["signalTs"])
        })
    expected=69 if mode=="NORMAL" else 68
    if len(clean)!=expected:raise RuntimeError(f"NEW_PENGU_TRADE_COUNT {len(clean)} expected {expected}")
    return clean

def digest(rows):
    raw=json.dumps(rows,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()
    return hashlib.sha256(raw).hexdigest()

def main():
    p=argparse.ArgumentParser()
    for k in ("old_engine","old_result","new_pengu","stock_raw","v12_ledger","old_pengu_ledger","quality102_frozen","output"):
        p.add_argument("--"+k.replace("_","-"),required=True)
    args=p.parse_args()
    engine=get_engine(args.old_engine)
    old_result=read_json(args.old_result)
    new_payload=read_json(args.new_pengu)
    stock=read_json(args.stock_raw)
    v12=read_json(args.v12_ledger)
    old_peng=read_json(args.old_pengu_ledger)
    if v12["period"]!=EXPECTED_PERIOD or old_peng["period"]!=EXPECTED_PERIOD:
        raise RuntimeError("HISTORICAL_INPUT_PERIOD_MISMATCH")
    if new_payload.get("contract")!={"logic":"COMBINED_FILTERED","grossCap":1,
      "everyEntryGross":1,"quarantineHours":60,"ddThresholdPct":-17,"globalCooldownHours":72}:
        raise RuntimeError("NEW_PENGU_SOURCE_CONTRACT_MISMATCH")
    for scenario in ("NORMAL","SEVERE"):
        if old_result["results"][scenario]["endingAssetJpy"]<0:raise RuntimeError("INVALID_BASELINE_ASSET")
    with Path(args.quality102_frozen).open(newline="",encoding="utf8") as f:
        frozen=list(csv.DictReader(f))
    if len(frozen)!=102:raise RuntimeError("FROZEN_Q102_102_COUNT_MISMATCH")
    # Do not fetch NEW Yahoo/Aster data in this pairing: the same old V52
    # raw trades are already frozen from the previous original-source run.
    v11,v50,days=stock["v11"],stock["v50"],stock["targetDays"]
    if len(v11)!=57 or len(v50)!=165 or len(days)!=246:
        raise RuntimeError("FROZEN_RESTORED_STOCK_INPUT_CHANGED")
    preload_original_price_evidence(engine,old_result)
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    original_gross=engine.PENGU_MAX_GROSS
    baseline={}
    new={}
    for scenario in ("NORMAL","SEVERE"):
        ledger_mode=str(engine.SCENARIOS[scenario]["ledgerMode"])
        v12_rows=v12["modes"][ledger_mode]["trades"]
        old_pengu_rows=old_peng["modes"][ledger_mode]["trades"]
        q102_rows=candidate_rows(engine,frozen,scenario)
        cost=engine.finite(engine.SCENARIOS[scenario]["stockCostBps"])
        baseline[scenario]=engine.simulate(v12_rows,old_pengu_rows,v11,v50,cost,q102_rows)
        expected=EXPECTED_NORMAL if scenario=="NORMAL" else EXPECTED_STRESS
        actual=baseline[scenario]["endingAssetJpy"]
        print("ORIGINAL_BASELINE_REPLAY",scenario,"actual",actual,"expected",expected,
              "absoluteDifference",round(actual-expected,6),"events",baseline[scenario]["trades"],flush=True)
        if abs(actual-expected)>max(.02,expected*1e-9):
            raise RuntimeError(f"OLD_BASELINE_SOURCE_PARITY_FAILED {scenario} actual={actual} expected={expected}")
        # Same code and same original V12, V52, Q102; ONLY new PENGU entry
        # times, routes, unit returns and desired max gross change.
        engine.PENGU_MAX_GROSS=1.0
        pengu_rows=convert_new_pengu(new_payload,scenario)
        new[scenario]=engine.simulate(v12_rows,pengu_rows,v11,v50,cost,q102_rows)
        engine.PENGU_MAX_GROSS=original_gross
        print("NEW_PENGU_IN_ORIGINAL_ENGINE",scenario,"endingAsset",new[scenario]["endingAssetJpy"],
              "PF",new[scenario]["profitFactor"],"DD",new[scenario]["maxDrawdownPctClosedEventTwr"],
              "trades",new[scenario]["trades"],
              "PenguEntered",new[scenario]["routingDiagnostics"].get("PENGU_ENTERED"),
              "PenguScaled",new[scenario]["routingDiagnostics"].get("PENGU_GROSS_SCALED",0),flush=True)
        (out/f"{scenario.lower()}-baseline.json").write_text(json.dumps(baseline[scenario],indent=2,ensure_ascii=False)+"\n")
        (out/f"{scenario.lower()}-new-pengu.json").write_text(json.dumps(new[scenario],indent=2,ensure_ascii=False)+"\n")
    summary={
      "schema":"historical-source-pengu-native-ledger-substitution/v1",
      "status":"BASELINE_MATCH_NEW_PENGU_REPLAY_COMPLETED",
      "referenceOriginal":"restored Sep18 Top2/Q102 original-source engine, NOT historical 14.49bn Top3/FET",
      "originalEngineSha256":EXPECTED_ENGINE_SHA256,
      "inputs":{"v12":digest(v12["modes"]["normal"]["trades"]),"oldPengu":digest(old_peng["modes"]["normal"]["trades"]),
          "newPengu":digest(new_payload["modes"]["normal"]),"v52":digest(v11+v50),
          "q102":hashlib.sha256(Path(args.quality102_frozen).read_bytes()).hexdigest()},
      "settings":{"v12Gross":engine.V12_GROSS_CAP,"cryptoGross":engine.CRYPTO_GROSS_CAP,
         "stockGross":engine.STOCK_GROSS_CAP,"totalGross":engine.TOTAL_GROSS_CAP,
         "q102Gross":engine.SUPPLEMENT_GROSS_CAP,
         "oldPenguGrossCap":original_gross,"newPenguGrossCap":1.0,
         "newPenguContract":new_payload["contract"],
         "allocationRule":"original engine allows lower allocatedGross when headroom insufficient; see PENGU_GROSS_SCALED"},
      "results":{k:{
           "baseline":{"asset":baseline[k]["endingAssetJpy"],"PF":baseline[k]["profitFactor"],
              "DD":baseline[k]["maxDrawdownPctClosedEventTwr"],"trades":baseline[k]["trades"],
              "bySleeve":baseline[k]["bySleeve"],"routing":baseline[k]["routingDiagnostics"]},
           "newPengu":{"asset":new[k]["endingAssetJpy"],"PF":new[k]["profitFactor"],
              "DD":new[k]["maxDrawdownPctClosedEventTwr"],"trades":new[k]["trades"],
              "bySleeve":new[k]["bySleeve"],"routing":new[k]["routingDiagnostics"],
              "maxObservedGross":new[k]["grossVerification"]}
         } for k in ("NORMAL","SEVERE")},
      "safety":{"researchOnly":True,"tradingMutation":0,"liveUnchanged":True}
    }
    (out/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
    print("OLD_ORIGINAL_ENGINE_PENGU_SWAP_COMPLETE",json.dumps(
       {k:{"old":v["baseline"]["asset"],"new":v["newPengu"]["asset"],
           "dd":v["newPengu"]["DD"],"pf":v["newPengu"]["PF"],
           "penguGrossScaled":v["newPengu"]["routing"].get("PENGU_GROSS_SCALED",0)}
        for k,v in summary["results"].items()},ensure_ascii=False),flush=True)
if __name__=="__main__":
    main()
