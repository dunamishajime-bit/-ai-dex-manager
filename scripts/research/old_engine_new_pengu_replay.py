#!/usr/bin/env python3
"""Replay PREEXISTING frozen original Top2 Python engine with source-native PENGU Q60/DD17-H72 ledger.

This script does NOT implement/reinvent any original V12/Q102/V52 trading decisions.
Original engine SHA256 cae978... is loaded unchanged as a library.
Original V52 raw candidates are from the preceding archived-source external stock-data fetch.
Original 2025-08-10 V12/PENGU ledgers are SHA-pinned original artifact inputs.
PENGU replacement is re-run using September-24 ORIGINAL TypeScript simulator with Aster history,
NOT a multiplied old PENGU event sequence. Diagnostic scenarios separated.
"""
from __future__ import annotations
import argparse, csv, datetime as dt, hashlib, importlib.util, json, math, sys
from pathlib import Path

SOURCE_ENGINE_SHA = "cae9785492ea5dda8173853fe2cbc7d99ea451f550a739fb7f014f4773d9899d"
SOURCE_V12_SHA = "1f2c05f2a33e4ab4300eb3f6b39a36e0f853b32ddafdaeab1cda6ff016304125"
SOURCE_OLD_PENGU_SHA = "d448c01d270c6ab7ed624719d188e176e0a5c4cd04e510eb96226fa5960574f8"
SOURCE_FROZEN_SHA = "b45f492a67307cf1845fcce6af0919c5202a5853b13e7f0914daf11889bd5ead"

def load(path:Path,sha:str|None=None):
    blob=path.read_bytes()
    if sha is not None:
        actual=hashlib.sha256(blob).hexdigest()
        if actual!=sha:raise RuntimeError(f"INPUT_SHA_MISMATCH:{path}:{actual}:{sha}")
    return json.loads(blob)
def sha(path:Path):return hashlib.sha256(path.read_bytes()).hexdigest()

def script() -> int:
    p=argparse.ArgumentParser()
    for arg in ["engine","v12","old-pengu","new-pengu","stock","frozen","stage1-baseline","output"]:
        p.add_argument("--"+arg,required=True)
    opts=p.parse_args()
    a={k.replace("_","-"):Path(v) for k,v in vars(opts).items()}
    # This load finds the original module pinned at checkout, and then the captured,
    # unedited 53KB source. No strategy source changes permitted in this replay.
    sys.path.insert(0,str(Path("scripts").resolve()))
    spec=importlib.util.spec_from_file_location("original_captured_integrated_engine",a["engine"])
    assert spec and spec.loader
    old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
    if sha(a["engine"])!=SOURCE_ENGINE_SHA:raise RuntimeError("ORIGINAL_ENGINE_SOURCE_SHA_MISMATCH")
    v12=load(a["v12"],SOURCE_V12_SHA)
    prev=load(a["old-pengu"],SOURCE_OLD_PENGU_SHA)
    fresh=load(a["new-pengu"])
    stock=load(a["stock"])
    orig_baseline=load(a["stage1-baseline"])
    if sha(a["frozen"])!=SOURCE_FROZEN_SHA:raise RuntimeError("FROZEN_CANDIDATE_SHA_MISMATCH")
    if len(stock["v11"])!=57 or len(stock["v50"])!=165:
        raise RuntimeError(f"REFRESHED_STOCK_COUNT_CHANGED:{len(stock['v11'])}/{len(stock['v50'])}")
    if fresh.get("contract")!={"logic":"COMBINED_FILTERED","grossCap":1,"everyEntryGross":1,"quarantineHours":60,"ddThresholdPct":-17,"globalCooldownHours":72}:
        raise RuntimeError("NEW_PENGU_NOT_Q60_DD17_H72_FLAT1")
    if len(fresh["modes"]["normal"])!=69 or len(fresh["modes"]["stress"])!=68:
        raise RuntimeError("NEW_PENGU_TRADE_LEDGER_LENGTH_MISMATCH")
    if old.V12_MAX_POSITIONS!=2 or old.V12_GROSS_CAP!=1.5 or old.TOTAL_GROSS_CAP!=3.5:
        raise RuntimeError("OLD_ENGINE_FROZEN_RISK_CONTRACT_CHANGED")
    with a["frozen"].open(newline="",encoding="utf-8") as f:candidates=list(csv.DictReader(f))
    if len(candidates)!=102:raise RuntimeError("ORIGINAL_Q102_FROZEN_CANDIDATE_COUNT_CHANGED")
    def epoch(value:str):return int(dt.datetime.fromisoformat(value).timestamp()*1000)
    def pengu_replacement(trades:list[dict])->list[dict]:
        result=[]
        for t in trades:
            if abs(float(t["requestedGross"])-1.0)>1e-12 or t.get("variant")!="COMBINED_FILTERED":raise RuntimeError("PENGU_SOURCE_TRADE_NOT_1x_COMBINED_FILTERED")
            if t.get("openAtWindowEnd"):raise RuntimeError("PENGU_OPEN_AT_END_NO_CLOSED_TRADE")
            if not (old.START_MS<=t["entryTs"]<t["exitTs"]<=old.END_MS):raise RuntimeError("NEW_PENGU_TRADE_OUTSIDE_FORMAL_WINDOW")
            result.append({"symbol":"PENGUUSDT","side":t["side"],"entryTs":t["entryTs"],"exitTs":t["exitTs"],
                "entryPrice":t["entryPrice"],"exitPrice":t["exitPrice"],"requestedGross":1.0,
                "netUnitReturn":float(t["accountReturn"]), "accountReturn":float(t["accountReturn"]),
                "exitReason":t["exitReason"],"route":t["route"],"sourceNativePengu":True})
        return result
    old_by_mode={"NORMAL":"normal","SEVERE":"stress"}
    result={"schema":"archived-engine-source-native-pengu-overlay/v1",
        "status":"DIAGNOSTIC_ORIGINAL_ENGINE_EXACT_BASELINE_CHECK_PENDING",
        "originalEngineSha256":sha(a["engine"]),
        "sourceInputs":{"v12Sha256":sha(a["v12"]),"oldPenguSha256":sha(a["old-pengu"]),
            "newPenguSha256":sha(a["new-pengu"]),"q102FrozenSha256":sha(a["frozen"]),
            "refreshedV52RawSha256":sha(a["stock"]),"v52StockCandidateCounts":{"v11":len(stock["v11"]),"v50":len(stock["v50"])}},
        "period":v12["period"],"modes":{},
        "comparisonContract":{
            "ARCHIVED_ORIGINAL":{"oldPengu":True,"globalGross":"old3.5","grossPengu":0.85},
            "ARCHIVED_ENGINE_NEW_PENGU":{"oldPengu":False,"globalGross":"old3.5","grossPengu":1.0},
            "CURRENT_GROSS_SENSITIVITY_NOT_LIVE_PARITY":{"oldPengu":False,"globalGross":"4.25","grossPengu":1.0,
               "caveat":"Only archived Top2/Quality102 candidate source and original stock raw signals. No current Rank3/HC1.75, native Q102 Causal V4, FET 2.25 or full governor."}
        },"safety":{"researchOnly":True,"ordersSent":False,"liveChanged":False,"vpsChanged":False}}
    for scenario,mode in old_by_mode.items():
        scenario_out={}
        frozen_col="normal_net" if scenario=="NORMAL" else "stress_net"
        supp=[{"entryTs":epoch(row["entry"]),"exitTs":epoch(row["exit"]),"symbol":row["symbol"],"layer":row["layer"],
           "requestedGross":old.SUPPLEMENT_GROSS_CAP,
           "side":old.QUALITY102_RESIZE_SIDES.get(epoch(row["entry"]),0),
           "feePerSide":0.0006 if scenario=="NORMAL" else 0.0010,
           "fundingPerDay":0.0002 if scenario=="NORMAL" else 0.0005,
           "netUnitReturn":old.finite(row[frozen_col]),"exitReason":row.get("exit_reason") or "QUALITY_FROZEN_EXIT"}
          for row in candidates]
        stock_cost=float(old.SCENARIOS[scenario]["stockCostBps"])
        v12_t=v12["modes"][mode]["trades"]
        old_t=prev["modes"][mode]["trades"]
        new_t=pengu_replacement(fresh["modes"][mode])
        old.PENGU_MAX_GROSS=0.85
        old.BASELINE_ONLY_MARKER=True
        base=old.simulate(v12_t,old_t,stock["v11"],stock["v50"],stock_cost,supp)
        expected=orig_baseline["results"][scenario]["endingAssetJpy"]
        diff=base["endingAssetJpy"]-expected
        if abs(diff)>0.10:raise RuntimeError(f"ORIGINAL_SOURCE_BASELINE_MISMATCH:{scenario}:{diff}:expected:{expected}")
        scenario_out["ARCHIVED_ORIGINAL"] = base
        old.PENGU_MAX_GROSS=1.0
        new=old.simulate(v12_t,new_t,stock["v11"],stock["v50"],stock_cost,supp)
        scenario_out["ARCHIVED_ENGINE_NEW_PENGU"]=new
        # Gross-only diagnostic. Changing risk caps cannot create absent current signals.
        old.V12_GROSS_CAP=2.0
        old.V12_MAX_POSITIONS=3
        old.CRYPTO_GROSS_CAP=3.0
        old.STOCK_GROSS_CAP=4.0
        old.V11_GROSS_CAP=2.0
        old.V50_GROSS_CAP=2.0
        old.TOTAL_GROSS_CAP=4.25
        gross_sensitivity=old.simulate(v12_t,new_t,stock["v11"],stock["v50"],stock_cost,supp)
        scenario_out["CURRENT_GROSS_SENSITIVITY_NOT_LIVE_PARITY"]=gross_sensitivity
        # Reset for severe baseline.
        old.PENGU_MAX_GROSS=0.85
        old.V12_GROSS_CAP=1.5
        old.V12_MAX_POSITIONS=2
        old.CRYPTO_GROSS_CAP=3.0
        old.STOCK_GROSS_CAP=1.5
        old.V11_GROSS_CAP=1.0
        old.V50_GROSS_CAP=1.0
        old.TOTAL_GROSS_CAP=3.5
        result["modes"][scenario]=scenario_out
        print("SCENARIO_COMPARISON",json.dumps({"mode":scenario,"oldJpy":base["endingAssetJpy"],"newPenguJpy":new["endingAssetJpy"],
           "grossOnlyJpy":gross_sensitivity["endingAssetJpy"],"oldTrades":base["trades"],"newTrades":new["trades"],
           "baseDifferenceJpy":diff,"newPenguEntries":new["routingDiagnostics"].get("PENGU_ENTERED"),
           "sourceModel":"UNCHANGED_ORIGINAL_PYTHON_CAPTURE_WITH_REPLAYED_SOURCE_NATIVE_PENGU"}),flush=True)
    result["status"]="PASS_ORIGINAL_ENGINE_BASELINE_PARITY_WITH_REFRESHED_STOCK_AND_NATIVE_NEW_PENGU"
    a["output"].parent.mkdir(parents=True,exist_ok=True)
    a["output"].write_text(json.dumps(old.rounded(result),indent=2,ensure_ascii=False)+"\n")
    print("RECOVERED_ENGINE_NEW_PENGU_COMPARISON_COMPLETED",a["output"])
    return 0
if __name__=="__main__":
    raise SystemExit(script())
