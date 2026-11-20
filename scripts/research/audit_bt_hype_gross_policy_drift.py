#!/usr/bin/env python3
"""Read-only source-defined STABLE4 Gross-cap drift audit, not trade permission proof."""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

CASE="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON"
CONFIG="config/disdexStable4Opportunity.ts"
RUNTIME="config/hypeZecLongRuntime.ts"
GUARD="lib/stable4-entry-gross-guard.ts"
RUNNER="lib/hype-zec-long-runner.ts"
CATEGORIES=("crypto","stock","total")

def pinned_blob(repo:Path,commit:str,path:str)->bytes:
    if not re.fullmatch(r"[a-f0-9]{40}",commit):
        raise ValueError("INVALID_PINNED_GIT_COMMIT")
    p=subprocess.run(["git","-C",str(repo),"show",commit+":"+path],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=25)
    if p.returncode:raise ValueError("PINNED_GIT_SOURCE_NOT_AVAILABLE:"+path)
    return p.stdout

def cap_literals(source:str)->dict[str,float]:
    found=re.search(r"const\s+productionRisk\s*=\s*Object\.freeze\s*\(\s*\{([^{}]*)\}\s*\)",source,re.S)
    if found is None:raise ValueError("HYPE_GROSS_POLICY_LITERAL_NOT_FOUND")
    body=found.group(1)
    out={}
    for name in ("cryptoGrossCap","stockGrossCap","totalGrossCap","v4TotalGrossCap"):
        all_values=re.findall(r"\b"+re.escape(name)+r"\s*:\s*(\d+(?:\.\d+)?)(?=\s*(?:,|$))",body)
        if len(all_values)!=1:raise ValueError("AMBIGUOUS_HYPE_GROSS_CAP:"+name)
        out[name]=float(all_values[0])
        if not math.isfinite(out[name]) or out[name]<=0:raise ValueError("INVALID_HYPE_GROSS_CAP")
    return out

def historical_caps(manifest:dict)->dict:
    if manifest.get("status")!="STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_RESEARCH_ONLY_NOT_FULL_PRODUCTION_PARITY":
        raise ValueError("HISTORICAL_RESEARCH_MODEL_STATUS_UNKNOWN")
    results=[r for r in manifest.get("results",[]) if r.get("case")==CASE and r.get("cost_bps_roundtrip") in (10,30)]
    if len(results)!=2 or {r["cost_bps_roundtrip"] for r in results}!={10,30}:
        raise ValueError("MISSING_INDEPENDENT_STUDY_BPS")
    output={}
    for r in results:
        values={}
        for category in CATEGORIES:
            cap=r[category+"_cap"]
            if type(cap) not in (int,float) or not math.isfinite(cap) or cap<=0:
                raise ValueError("INVALID_STUDY_CAP")
            values[category+"GrossCap"]=float(cap)
        if values["cryptoGrossCap"]+values["stockGrossCap"] < values["totalGrossCap"]-1e-9:
            raise ValueError("STUDY_CAPS_INTERNALLY_INCONSISTENT")
        output[str(r["cost_bps_roundtrip"])]=values
    if output["10"]!=output["30"]:raise ValueError("INCONSISTENT_BPS_PORTFOLIO_CAPS")
    return output["10"]

def audit(study:dict, pin_evidence:dict, dependency_evidence:dict, blobs:dict[str,bytes])->dict:
    if pin_evidence.get("schema")!="disdex-bt-vps-entrypoint-parity/v1" or pin_evidence.get("all_entrypoints_verified") is not True:
        raise ValueError("TRUSTED_ENTRYPOINT_EVIDENCE_REQUIRED")
    pinned=[row for row in pin_evidence["rows"] if row.get("runner")=="HYPE" and row.get("verified") is True]
    if len(pinned)!=1:raise ValueError("LIVE_HYPE_SHA_AMBIGUOUS")
    commit=pinned[0]["git_commit"]
    if dependency_evidence.get("schema")!="disdex-bt-live-vps-dependency-bytes/v1" or dependency_evidence.get("all_files_match") is not True:
        raise ValueError("TRUSTED_VPS_STATIC_SOURCE_EVIDENCE_REQUIRED")
    for path in (CONFIG,RUNTIME,GUARD,RUNNER):
        matches=[r for r in dependency_evidence["rows"] if r.get("runner")=="HYPE" and r.get("path")==path and r.get("verified") is True]
        if len(matches)!=1:raise ValueError("VPS_SOURCE_DEPENDENCY_NOT_VERIFIED:"+path)
        if path not in blobs:raise ValueError("MISSING_PINNED_SOURCE:"+path)
    config=blobs[CONFIG].decode("utf-8-sig")
    runtime=blobs[RUNTIME].decode("utf-8-sig")
    guard=blobs[GUARD].decode("utf-8-sig")
    runner=blobs[RUNNER].decode("utf-8-sig")
    required_runtime=[
      'stable4Mode === "LIVE"', 'DISDEX_STABLE4_OPPORTUNITY.portfolio.totalGrossCap',
    ]
    required_guard=[
      "const caps = DISDEX_STABLE4_OPPORTUNITY.productionRisk",
      "caps.cryptoGrossCap","caps.stockGrossCap","caps.totalGrossCap","caps.v4TotalGrossCap",
    ]
    required_runner=["totalGrossCap: this.dependencies.runtime.totalGrossCap"]
    if any(marker not in runtime for marker in required_runtime) or any(marker not in guard for marker in required_guard) or any(marker not in runner for marker in required_runner):
        raise ValueError("REVIEWED_CODE_PATH_CHANGED_OR_UNKNOWN")
    model=historical_caps(study)
    live=cap_literals(config)
    differences={}
    for category in CATEGORIES:
        key=category+"GrossCap"
        differences[key]={"historical_research":model[key],"pinned_hype_stable4":live[key],
                          "delta_x":round(live[key]-model[key],9),
                          "same":abs(live[key]-model[key])<=1e-9}
    return {
        "schema":"disdex-bt-hype-source-defined-gross-policy-drift/v1",
        "created_at_utc":datetime.now(timezone.utc).isoformat(),
        "observed_live_sha":commit,
        "live_service_snapshot_utc":pin_evidence["observed_utc"],
        "live_static_source_bytes_verified_from_vps":True,
        "pinned_source_sha256":{k:hashlib.sha256(v).hexdigest() for k,v in sorted(blobs.items())},
        "research_is_actual_venue_fills":False,
        "comparison":{"crypto_stock_total":differences,
          "conditional_v4_total_cap_x":live["v4TotalGrossCap"],
          "conditional_v4_total_cap_runtime_trigger_verified":False},
        "code_path": {
          "hype_runtime_chooses_stable4_total_cap_when_stable4_mode_live":True,
          "hype_entry_planner_receives_runtime_total_cap":True,
          "stable4_entry_gross_guard_references_source_defined_caps":True,
        },
        "risk_reference": "HISTORICAL_RESEARCH_MANIFEST_NOT_SIGNED_CURRENT_OWNER_POLICY",
        "effective_signed_global_risk_policy_verified":False,
        "independent_restrictive_gates_excluded":False,
        "actual_exchange_gross_limit_breach_verified":False,
        "production_bt_parity_certified":False,
        "research_vs_pinned_source_cap_drift":any(not x["same"] for x in differences.values()),
        "recommendation":"Read-only review shared risk/margin guard/current owner policy before treating either cap as final live account authority",
    }

def main():
    repo=Path(__file__).resolve().parents[2]
    evidence=repo/"docs/research-results"
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--research-manifest",required=True,type=Path)
    p.add_argument("--live",type=Path,default=evidence/"BT_VPS_ENTRYPOINT_PARITY_20261119_UNCERTIFIED.json")
    p.add_argument("--vps-dependencies",type=Path,default=evidence/"BT_LIVE_VPS_DEPENDENCY_BYTES_20261119_UNCERTIFIED.json")
    p.add_argument("--output",type=Path,default=evidence/"BT_HYPE_SOURCE_GROSS_CAP_DRIFT_20261119_UNCERTIFIED.json")
    args=p.parse_args()
    live=json.loads(args.live.read_text(encoding="utf-8"))
    pins=[row for row in live["rows"] if row.get("runner")=="HYPE" and row.get("verified") is True]
    if len(pins)!=1:raise ValueError("HYPE_PIN_NOT_VERIFIED")
    sha=pins[0]["git_commit"]
    blobs={path:pinned_blob(repo,sha,path) for path in (CONFIG,RUNTIME,GUARD,RUNNER)}
    report=audit(json.loads(args.research_manifest.read_text(encoding="utf-8")),live,
                 json.loads(args.vps_dependencies.read_text(encoding="utf-8")),blobs)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    for name,row in report["comparison"]["crypto_stock_total"].items():
        print(f"{name}: historical={row['historical_research']}x pinned_source={row['pinned_hype_stable4']}x drift={row['delta_x']:+g}x")
    print("EFFECTIVE_GLOBAL_ACCOUNT_LIMIT_NOT_CERTIFIED")
if __name__=="__main__":
    main()
