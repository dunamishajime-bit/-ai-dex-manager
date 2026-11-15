#!/usr/bin/env python3
"""Fail-closed model-source SHA vs read-only production runner-pin manifest audit.

Source and manifest consistency is NOT evidence of an active runner, venue
fill, exchange risk or current STOP protections. Never connect to exchange.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,re
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path

PIN_MAP={
    "V4":"V12_V4","Q102":"QUALITY102_CAUSAL_V1",
    "PENGU":"PENGU_V8","V52":"V52","HYPE":"HYPE_TREND_LONG",
    "IDLE":"IDLE_PRIORITY_SHORT","FET":"FET_BRK48_RESIDUAL",
}
SUPERVISORS=("SHARED_CRYPTO_RISK","MARGIN_GUARD")
SHA=re.compile(r"[0-9a-f]{40}\Z")
def digest(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
def validate_manifest(manifest:dict)->dict:
    if manifest.get("schema")!="disdex-bt-readonly-runner-pins/v1" or (
        manifest.get("sourceType")!="read_only_vps_runner_pin_manifest"):
        raise ValueError("MANIFEST_EVIDENCE_SCHEMA_MISSING")
    items=manifest.get("runnerPins")
    if not isinstance(items,dict) or set(items)!=(set(PIN_MAP.values())|set(SUPERVISORS)):
        raise ValueError("MANIFEST_ALL_NINE_PINS_REQUIRED")
    if manifest.get("activeUnitStatusProven") is not False or (
         manifest.get("venueEconomicsCertified") is not False):
        raise ValueError("MANIFEST_UNSUPPORTED_RUNTIME_CERTIFICATION")
    observed=datetime.fromisoformat(manifest["observedAtUtc"].replace("Z","+00:00"))
    if observed.tzinfo is None:
        raise ValueError("MANIFEST_TIMEZONE_MISSING")
    for key,value in items.items():
        if not isinstance(value,str) or SHA.fullmatch(value) is None:
            raise ValueError("MALFORMED_PIN_SHA:"+key)
    return items
def source_shas(path:Path)->dict[str,set[str]]:
    result=defaultdict(set);seen=set()
    with path.open("r",encoding="utf-8-sig",newline="") as f:
        reader=csv.DictReader(f)
        required={"trade_id","logic","source_runtime_sha"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("MODEL_ENTRIES_SOURCE_COLUMNS_INVALID")
        for row in reader:
            key=row["trade_id"];label=row["logic"];sha=row["source_runtime_sha"]
            if key in seen or not key or label not in PIN_MAP or SHA.fullmatch(sha) is None:
                raise ValueError("MODEL_DUPLICATE_OR_INVALID_SOURCE_SHA")
            seen.add(key);result[label].add(sha)
    if set(result)!=set(PIN_MAP):
        raise ValueError("MODEL_SEVEN_STRATEGY_FAMILIES_INCOMPLETE")
    return result
def compare(manifest:dict,source10:dict,source30:dict)->dict:
    pins=validate_manifest(manifest)
    if set(source10)!=set(PIN_MAP) or set(source30)!=set(PIN_MAP):
        raise ValueError("SEVEN_STRATEGY_MODEL_INCOMPLETE")
    outcomes={}
    for logic,service in PIN_MAP.items():
        a=source10[logic];b=source30[logic]
        if not a or not b:raise ValueError("ZERO_ADMISSION_ROUTE_SOURCE")
        if a!=b:raise ValueError("COST_CASE_PIN_POPULATION_DRIFT:"+logic)
        observed=pins[service]
        status=("PIN_MATCH_ONLY_NOT_LIVE_CERTIFIED" if a=={observed} else
            "MODEL_SOURCE_PIN_MISMATCH_REQUIRE_REPLAY")
        outcomes[logic]={"status":status,"currentManifestPin":observed,
            "modelSourcePins":sorted(a),"manifestRunnerKey":service}
    return {"schema":"disdex-bt-model-vs-production-manifest-pins/v1",
      "status":"BLOCKED_REPLAY_REQUIRED" if any(x["status"].startswith("MODEL_SOURCE_PIN_MISMATCH")
            for x in outcomes.values()) else "PINS_MATCH_ONLY_NOT_ECONOMIC_PARITY",
      "modelCostCohortPinsIdentical":True,"strategyCount":len(outcomes),
      "activeUnitStatusProven":False,"sharedRiskGrossParityProven":False,
      "killSwitchAndStopOwnershipProven":False,"signedVenueFillsCertified":False,
      "needsV4CodexReleaseIntegration":outcomes["V4"]["status"].startswith("MODEL_SOURCE_PIN_MISMATCH"),
      "supervisorPins":{"SHARED_CRYPTO_RISK":pins["SHARED_CRYPTO_RISK"],
                        "MARGIN_GUARD":pins["MARGIN_GUARD"]},
      "strategies":outcomes,"productionMutations":0}
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest",type=Path,required=True)
    ap.add_argument("--entries10",type=Path,required=True)
    ap.add_argument("--entries30",type=Path,required=True)
    ap.add_argument("--output",type=Path,required=True)
    a=ap.parse_args()
    manifest=json.loads(a.manifest.read_text("utf-8-sig"))
    out=compare(manifest,source_shas(a.entries10),source_shas(a.entries30))
    out["inputSha256"]={name:digest(p) for name,p in
       (("manifest",a.manifest),("10bpsEntries",a.entries10),("30bpsEntries",a.entries30))}
    a.output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n","utf8")
    print(json.dumps({"status":out["status"],
       "matches":[x for x,v in out["strategies"].items() if v["status"].startswith("PIN_MATCH")],
       "needsReplay":[x for x,v in out["strategies"].items() if v["status"].startswith("MODEL_SOURCE_PIN_MISMATCH")],
       "v4Pin":out["strategies"]["V4"]["currentManifestPin"],
       "activeUnitStatusProven":out["activeUnitStatusProven"]},ensure_ascii=False))
if __name__=="__main__":main()
