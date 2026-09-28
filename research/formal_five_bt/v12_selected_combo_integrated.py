"""Fail-closed provenance and baseline parity for the selected V12 five-logic research BT.

This deliberately patches only the *research copy* of one audited TypeScript
sources after a complete original-source replay. Only config is changed. All market data, other strategy
sources, and shared-portfolio logic remain identical. No LIVE writes/orders.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
from typing import Any

HERE=Path(__file__).resolve().parent
ORIGINAL_SOURCE_SHA="a09ea45ca3cbd72100f9eb0eaae499039c40b6a0"
ORIGINAL_RUNTIME_SHA="e1b58060d6263a3af7ced51bec854d3e211d2f35"
SELECTED_SOURCE_SHA="dbf84542311c15f69508f91a0e7311ff7e686d96"
CHANGED=("config/v12X1AllRuntime.ts",)
CAP_CASE="BRK0P75_MR0P75_FET1_DUAL_GATE"
EXPECTED_BASE={
    "PRICE_MODEL_8BPS":dict(final=155417832.2837019,dd=-.2283242854192271,pf=2.464228135438672,trades=1046),
    "PRICE_MODEL_10BPS":dict(final=130287867.06655651,dd=-.22944963848991073,pf=2.4176125792561076,trades=1046),
}

def digest(blob:bytes)->str:
    return hashlib.sha256(blob).hexdigest()

def read_json(path:Path)->dict:
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path:Path,payload:dict)->None:
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(payload,sort_keys=True,indent=2,ensure_ascii=False,allow_nan=False)+"\n",encoding="utf-8")

def exact_scenario(summary:dict,name:str)->dict:
    if not summary.get("cases",{}).get(CAP_CASE):
        raise ValueError("FET_CAP_GATE_COMBO_MISSING")
    case=summary["cases"][CAP_CASE]
    if case.get("status")!="ALL_FIVE_H1_PRICE_MODEL_NOT_FORMAL_L2_VERIFIED":
        raise ValueError("FIVE_LOGIC_MODEL_INCOMPLETE:"+str(case.get("status")))
    if case.get("v52_model_complete") is not True:
        raise ValueError("V52_REFERENCE_INCOMPLETE")
    if case.get("v52_missing_market_data_selected_candidates_excluded")!=0:
        raise ValueError("V52_MISSING_SELECTED_REFERENCE_DATA")
    found=[s for s in case["scenarios"] if s.get("scenario_id")==name]
    if len(found)!=1:
        raise ValueError("REQUIRED_SCENARIO_NOT_EXACTLY_ONCE:"+name)
    s=found[0]
    if s.get("accounting_reconciliation",{}).get("status")!="PASS":
        raise ValueError("PORTFOLIO_ACCOUNTING_NOT_RECONCILED:"+name)
    return s

def certify_baseline(summary_path:Path,report_path:Path)->dict:
    summary=read_json(summary_path)
    out={"status":"BASELINE_NOT_VALIDATED","baseline_summary_path":str(summary_path),
         "source":"ASTER_H1_2025_08_10_TO_2026_08_10",
         "expected":EXPECTED_BASE,"cases":{}}
    for scenario,expected in EXPECTED_BASE.items():
        actual=exact_scenario(summary,scenario)
        got={"final":float(actual["final_equity_jpy"]),
             "dd":float(actual["maximum_mtm_drawdown"]),
             "pf":float(actual["profit_factor"]),
             "trades":int(actual["closed_trades"])}
        checks={"final":math.isclose(got["final"],expected["final"],rel_tol=0,abs_tol=.1),
                "dd":math.isclose(got["dd"],expected["dd"],rel_tol=0,abs_tol=1e-8),
                "pf":math.isclose(got["pf"],expected["pf"],rel_tol=0,abs_tol=1e-8),
                "trades":got["trades"]==expected["trades"]}
        out["cases"][scenario]={"actual":got,"checks":checks}
    if all(all(s["checks"].values()) for s in out["cases"].values()):
        out["status"]="ORIGINAL_5LOGIC_BASELINE_EXACT_PARITY_PASS"
    write_json(report_path,out)
    print("SELECTED_V12_ORIGINAL_BASELINE_CERTIFICATION",out["status"],flush=True)
    if out["status"]!="ORIGINAL_5LOGIC_BASELINE_EXACT_PARITY_PASS":
        raise ValueError("ORIGINAL_BASELINE_PARITY_FAIL_NO_VARIANT_RESULT")
    return out

def patch_research_copy(repo:Path,data_root:Path,report_path:Path)->dict:
    snapshot=HERE/"runtime_source_snapshot"
    manifest_path=HERE/"runtime_source_manifest.json"
    manifest=read_json(manifest_path)
    if manifest.get("runtime_sha")!=ORIGINAL_RUNTIME_SHA or manifest.get("verified_repository_commit")!=ORIGINAL_SOURCE_SHA:
        raise ValueError("ORIGINAL_FROZEN_SOURCE_NOT_PRESENT")
    original_records={r["path"]:r["sha256"] for r in manifest["files"]}
    if len(original_records)!=90 or len(original_records)!=len(manifest["files"]):
        raise ValueError("ORIGINAL_90_SOURCE_CONTRACT_INVALID")
    # Validate *all* original source hashes first: no starting from a mixed tree.
    for rel,sha in original_records.items():
        if digest((snapshot/rel).read_bytes())!=sha:
            raise ValueError("SOURCE_NOT_ORIGINAL_BEFORE_PATCH:"+rel)
    changed={}
    for rel in CHANGED:
        proc=subprocess.run(["git","show",f"{SELECTED_SOURCE_SHA}:{rel}"],
            cwd=repo,capture_output=True,check=True)
        raw=proc.stdout
        before=(snapshot/rel).read_bytes()
        if before==raw:raise ValueError("RESEARCH_PATCH_DOES_NOT_CHANGE_SOURCE:"+rel)
        (snapshot/rel).write_bytes(raw)
        changed[rel]={"original_sha256":digest(before),"research_sha256":digest(raw)}
    config=(snapshot/CHANGED[0]).read_text(encoding="utf-8")
    logic=(snapshot/"lib/v12-x1-all.ts").read_text(encoding="utf-8")
    for literal in ("minimumVolumeRatio: 0.80","neutralScoreThreshold: 1.00",
                    "strongRegimeQualityScoreMinimum: 0.15",
                    "strongRegimeQualityScoreMaximum: 0.70"):
        if literal not in config:raise ValueError("SELECTED_V12_SOURCE_CONTRACT_NOT_PRESENT:"+literal)
    if ("input.score >= V12_X1_ALL.relaxedRegimeMinimumScore" in logic or
        "relaxedRegimeMinimumScore:" in config):
        raise ValueError("NORMAL_GATE_ONLY_RESCUE_MUST_REMAIN_ORIGINAL")
    if "input.score >= V12_X1_ALL.strongRegimeQualityScoreMinimum" not in logic:
        raise ValueError("STRONG_ROUTE_CHANGED_UNEXPECTEDLY")
    if len({r["path"] for r in manifest["files"]})!=90:
        raise ValueError("SOURCE_MANIFEST_DUPLICATE_PATH")
    for r in manifest["files"]:
        if r["path"] in changed:r["sha256"]=changed[r["path"]]["research_sha256"]
    manifest["runtime_sha"]=SELECTED_SOURCE_SHA
    manifest["research_modified_files"]=list(CHANGED)
    manifest["research_source_commit"]=SELECTED_SOURCE_SHA
    manifest["original_frozen_runtime_sha"]=ORIGINAL_RUNTIME_SHA
    write_json(manifest_path,manifest)
    # Re-verify complete manifest; 89 audited files must remain byte-identical.
    for r in manifest["files"]:
        if digest((snapshot/r["path"]).read_bytes())!=r["sha256"]:
            raise ValueError("PATCHED_MANIFEST_SHA_MISMATCH:"+r["path"])
        if r["path"] not in changed and r["sha256"]!=original_records[r["path"]]:
            raise ValueError("UNAPPROVED_SOURCE_MODIFICATION:"+r["path"])
    adapter=HERE/"strategies.py"
    source=adapter.read_text(encoding="utf-8")
    old=f'EXPECTED_RUNTIME_SHA = "{ORIGINAL_RUNTIME_SHA}"'
    if source.count(old)!=1:
        raise ValueError("SOURCE_ADAPTER_ORIGINAL_RUNTIME_SHA_NOT_FOUND")
    adapter.write_text(source.replace(old,f'EXPECTED_RUNTIME_SHA = "{SELECTED_SOURCE_SHA}"'),encoding="utf-8")
    acquired=data_root/"acquisition-manifest.json"
    original_blob=acquired.read_bytes()
    original_data_manifest=read_json(acquired)
    if original_data_manifest.get("runtime_sha")!=ORIGINAL_RUNTIME_SHA:
        raise ValueError("ORIGINAL_ASTEREDEX_DATA_MANIFEST_UNEXPECTED_SHA")
    # Same 32 data files; source-identity field alone is variant-labeled for
    # signal_scan's strict source/runtime contract. Never alter price/funding.
    original_data_manifest["runtime_sha"]=SELECTED_SOURCE_SHA
    original_data_manifest["research_data_manifest_parent_sha256"]=digest(original_blob)
    write_json(acquired,original_data_manifest)
    for name in ("BTCUSDT","FETUSDT","PENGUUSDT"):
        x=original_data_manifest["venues"]["aster"]["klines"][name]
        if x.get("status")!="ACQUIRED" or x.get("hour_gaps")!=0 or x.get("unresolved_malformed_source_h1"):
            raise ValueError("MANDATORY_MARKET_H1_NOT_VERIFIED:"+name)
    out={"status":"RESEARCH_PATCHED_1_OF_90_ONLY_NOT_PRODUCTION",
         "original_commit":ORIGINAL_SOURCE_SHA,
         "original_runtime_sha":ORIGINAL_RUNTIME_SHA,
         "research_source_commit":SELECTED_SOURCE_SHA,
         "changed_sources":changed,"unchanged_source_count":89,
         "original_market_manifest_sha256":digest(original_blob),
         "patched_market_manifest_sha256":digest(acquired.read_bytes()),
         "snapshot_manifest_sha256":digest(manifest_path.read_bytes()),
         "source_data_identical":True,"live_updated":False}
    write_json(report_path,out)
    print("SELECTED_V12_RESEARCH_SOURCE_PATCH",json.dumps({k:out[k] for k in ("status","unchanged_source_count","source_data_identical")}),flush=True)
    return out

def compare_outputs(baseline:Path,variant:Path,source_report:Path,output:Path)->dict:
    if not source_report.is_file():
        raise ValueError("RESEARCH_PROVENANCE_MISSING")
    source=read_json(source_report)
    if source.get("status")!="RESEARCH_PATCHED_1_OF_90_ONLY_NOT_PRODUCTION":
        raise ValueError("RESEARCH_VARIANT_SOURCE_NOT_CERTIFIED")
    b=read_json(baseline)
    v=read_json(variant)
    rows={}
    for case in EXPECTED_BASE:
        original=exact_scenario(b,case)
        experiment=exact_scenario(v,case)
        keys={"ending_jpy":"final_equity_jpy","maximum_mtm_dd":"maximum_mtm_drawdown",
              "profit_factor":"profit_factor","win_rate":"win_rate","closed_trades":"closed_trades"}
        base_metrics={k:original[f] for k,f in keys.items()}
        candidate_metrics={k:experiment[f] for k,f in keys.items()}
        rows[case]={"original":base_metrics,
                    "selected":candidate_metrics,
                    "delta":{k:candidate_metrics[k]-base_metrics[k] for k in keys},
                    "original_strategy_pnl_jpy":original["strategy_pnl_jpy"],
                    "selected_strategy_pnl_jpy":experiment["strategy_pnl_jpy"],
                    "strategy_pnl_difference_jpy":{k:experiment["strategy_pnl_jpy"].get(k,0)-p
                         for k,p in original["strategy_pnl_jpy"].items()},
                    "original_strategy_trades":original["strategy_trades"],
                    "selected_strategy_trades":experiment["strategy_trades"],
                    "monthly_equity_original":original.get("monthly_equity_jpy"),
                    "monthly_equity_selected":experiment.get("monthly_equity_jpy"),
                    "selected_admission_counts":experiment["candidate_decision_counts"]}
    report={"status":"RESEARCH_5LOGIC_SELECTED_V12_COMPARISON_COMPLETE_NOT_L2_VERIFIED",
            "period":"2025-08-10_to_2026-08-10",
            "baseline_source_runtime_sha":ORIGINAL_RUNTIME_SHA,
            "research_variant_source_commit":SELECTED_SOURCE_SHA,
            "research_change":"NORMAL GATE ONLY: V12 Score1.00 volume0.80. Strong [0.15,0.70] and nonstrong RELAXED original with NO score floor unchanged.",
            "q102":"BRK0.75/MR0.75",
            "fet":"1.00 and both existing preentry rejection gates",
            "pengu":"COMBINED_FILTERED unchanged gross1.0 each entry",
            "five_logic":True,"live_updated":False,
            "source_verification":source,
            "scenarios":rows,
            "limitations":["In-sample only; historical Aster H1 price-model fills not order-book verified",
                           "ECB daily FX reference not tradable USDTJPY",
                           "No standalone independently validated out-of-sample period",
                           "NORMAL cost 8/10bps only; not formal SEVERE orderbook/margin stress"]}
    write_json(output,report)
    for case,r in rows.items():
        print("SELECTED_V12_INTEGRATED_COMPARISON",json.dumps({"scenario":case,
            "baseline_ending_jpy":r["original"]["ending_jpy"],
            "selected_ending_jpy":r["selected"]["ending_jpy"],
            "baseline_dd":r["original"]["maximum_mtm_dd"],
            "selected_dd":r["selected"]["maximum_mtm_dd"],
            "baseline_pf":r["original"]["profit_factor"],
            "selected_pf":r["selected"]["profit_factor"],
            "baseline_trades":r["original"]["closed_trades"],
            "selected_trades":r["selected"]["closed_trades"]},sort_keys=True),flush=True)
    return report

def main():
    p=argparse.ArgumentParser()
    sub=p.add_subparsers(dest="action",required=True)
    cert=sub.add_parser("certify-baseline")
    cert.add_argument("--summary",required=True,type=Path)
    cert.add_argument("--output",required=True,type=Path)
    patch=sub.add_parser("patch")
    patch.add_argument("--repo",required=True,type=Path)
    patch.add_argument("--data-root",required=True,type=Path)
    patch.add_argument("--output",required=True,type=Path)
    compare=sub.add_parser("compare")
    compare.add_argument("--baseline",required=True,type=Path)
    compare.add_argument("--variant",required=True,type=Path)
    compare.add_argument("--source-report",required=True,type=Path)
    compare.add_argument("--output",required=True,type=Path)
    a=p.parse_args()
    if a.action=="certify-baseline":certify_baseline(a.summary,a.output)
    elif a.action=="patch":patch_research_copy(a.repo,a.data_root,a.output)
    else:compare_outputs(a.baseline,a.variant,a.source_report,a.output)
if __name__=="__main__":
    main()
