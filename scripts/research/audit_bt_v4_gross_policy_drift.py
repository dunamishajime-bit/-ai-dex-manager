#!/usr/bin/env python3
"""Read-only V4 pinned offline entry-lifecycle cap vs STABLE4 study-model audit.

This inspects the source that may influence live reservations, but cannot
establish final global risk enforcement or authorize any trading.
"""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

SOURCE="lib/v12-v4-production-lifecycle.ts"
CASE="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON"

def pinned_source(repo:Path,sha:str)->bytes:
    if not re.fullmatch("[0-9a-f]{40}",sha):
        raise ValueError("UNKNOWN_V4_COMMIT")
    proc=subprocess.run(["git","-C",str(repo),"show",f"{sha}:{SOURCE}"],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30)
    if proc.returncode:raise ValueError("PINNED_V4_LIFECYCLE_SOURCE_MISSING")
    return proc.stdout

def extract_lifecycle_cap_literals(source:str)->dict[str,float]:
    contracts={
      "v4AggregateGrossCap":r'if\s*\(\s*g\.v12\s*\+\s*worst\s*>\s*([0-9.]+)\s*\+\s*1e-12\s*\)\s*throw\s+Error\("V12_GROSS_CAP"\)',
      "totalGrossCap":r'if\s*\(\s*g\.total\s*\+\s*worst\s*>\s*([0-9.]+)\s*\+\s*1e-12\s*\)\s*throw\s+Error\("TOTAL_GROSS_CAP"\)',
      "perPositionGrossCap":r'c\.requestedGross\s*>\s*([0-9.]+)\s*\)\s*throw\s+Error\("INVALID_REQUESTED_GROSS"\)',
      "cryptoRequestedCap":r'resolveCryptoGrossEntryControl\s*\(\s*\{\s*currentCryptoGross:\s*g\.crypto\s*,\s*requestedEntryCap:\s*([0-9.]+)\s*\}',
    }
    result={}
    for key,pattern in contracts.items():
        matches=re.findall(pattern,source,re.S)
        if len(matches)!=1:raise ValueError("UNKNOWN_OR_MULTIPLE_V4_ENTRY_GATES:"+key)
        value=float(matches[0])
        if not math.isfinite(value) or value<=0:raise ValueError("INVALID_SOURCE_GROSS_LIMIT")
        result[key]=value
    if "if (state.initial.holdProtected)" not in source or "if(state.executionReview)" not in source:
        raise ValueError("PROTECTED_LIFECYCLE_EVIDENCE_NOT_PRESENT")
    return result

def study_caps(manifest:dict)->dict[str,float]:
    if manifest.get("status")!="STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_RESEARCH_ONLY_NOT_FULL_PRODUCTION_PARITY":
        raise ValueError("HISTORICAL_STABLE4_MANIFEST_UNTRUSTED")
    rows=[row for row in manifest.get("results",[]) if row.get("case")==CASE and row.get("cost_bps_roundtrip") in (10,30)]
    if len(rows)!=2 or {r["cost_bps_roundtrip"] for r in rows}!={10,30}:
        raise ValueError("HISTORICAL_TWO_FEE_SCENARIOS_REQUIRED")
    result=[]
    for row in rows:
        caps={}
        for name,field in (("v4AggregateGrossCap","v4_aggregate_cap"),("perPositionGrossCap","v4_per_position_cap"),
                           ("cryptoRequestedCap","crypto_cap"),("totalGrossCap","total_cap")):
            value=row[field]
            if type(value) not in (int,float) or not math.isfinite(value) or value<=0:
                raise ValueError("INVALID_HISTORICAL_V4_CAP")
            caps[name]=float(value)
        result.append(caps)
    if result[0]!=result[1]:raise ValueError("COST_SCENARIO_GROSS_CAPS_DIFFER")
    return result[0]

def build(manifest:dict,pins:dict,dep:dict,source:bytes)->dict:
    if pins.get("schema")!="disdex-bt-vps-entrypoint-parity/v1" or pins.get("all_entrypoints_verified") is not True:
        raise ValueError("TRUSTED_LIVE_V4_PIN_REQUIRED")
    matches=[row for row in pins["rows"] if row.get("runner")=="V4" and row.get("verified") is True]
    if len(matches)!=1:raise ValueError("AMBIGUOUS_V4_LIVE_PIN")
    if dep.get("schema")!="disdex-bt-live-vps-dependency-bytes/v1" or dep.get("all_files_match") is not True:
        raise ValueError("VPS_DEPENDENCY_BYTE_COMPARISON_REQUIRED")
    verified=[r for r in dep["rows"] if r.get("runner")=="V4" and r.get("path")==SOURCE and r.get("verified") is True]
    if len(verified)!=1:raise ValueError("V4_LIFECYCLE_NOT_MATCHED_TO_VPS")
    known=extract_lifecycle_cap_literals(source.decode("utf-8-sig"))
    modeled=study_caps(manifest)
    diff={key:{"historical_model":modeled[key],"pinned_v4_lifecycle":known[key],
               "delta_x":round(known[key]-modeled[key],9)} for key in known}
    return {
      "schema":"disdex-bt-v4-source-gross-cap-drift/v1",
      "created_at_utc":datetime.now(timezone.utc).isoformat(),
      "pinned_live_v4_sha":matches[0]["git_commit"],
      "vps_static_lifecycle_source_verified":True,
      "pinned_source_sha256":hashlib.sha256(source).hexdigest(),
      "caps":diff,
      "historical_study_stock_gross_cap_x":manifest["results"][0]["stock_cap"],
      "v4_lifecycle_stock_cap_explicitly_present":False,
      "final_shared_policy_stricter_than_lifecycle_verified":False,
      "crypto_effective_cap_may_be_lowered_by_control":True,
      "other_risk_guards_and_owner_policy_evaluated":False,
      "actual_orders_created_or_modified":False,
      "actual_exchange_gross_excess_verified":False,
      "economic_reexecution_with_current_v4_risk_caps_complete":False,
      "production_bt_parity_certified":False,
    }

def main():
    p=argparse.ArgumentParser(description=__doc__)
    repo=Path(__file__).resolve().parents[2]
    evidence=repo/"docs/research-results"
    p.add_argument("--research-manifest",type=Path,required=True)
    p.add_argument("--pins",type=Path,default=evidence/"BT_VPS_ENTRYPOINT_PARITY_20261119_UNCERTIFIED.json")
    p.add_argument("--vps-dependencies",type=Path,default=evidence/"BT_LIVE_VPS_DEPENDENCY_BYTES_20261119_UNCERTIFIED.json")
    p.add_argument("--output",type=Path,default=evidence/"BT_V4_SOURCE_GROSS_CAP_DRIFT_20261119_UNCERTIFIED.json")
    args=p.parse_args()
    pin=json.loads(args.pins.read_text(encoding="utf8"))
    rows=[r for r in pin.get("rows",[]) if r.get("runner")=="V4" and r.get("verified") is True]
    if len(rows)!=1:raise ValueError("SOURCE_PIN_AMBIGUOUS")
    source=pinned_source(repo,rows[0]["git_commit"])
    result=build(json.loads(args.research_manifest.read_text(encoding="utf8")),pin,
                 json.loads(args.vps_dependencies.read_text(encoding="utf8")),source)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    for name,row in result["caps"].items():
        print(f"{name}: historical={row['historical_model']}x pinned_lifecycle={row['pinned_v4_lifecycle']}x delta={row['delta_x']:+g}x")
    print("V4_ENTRY_SOURCE_LIMITS_NOT_FINAL_GLOBAL_TRADING_AUTHORITY")
if __name__=="__main__":
 main()
