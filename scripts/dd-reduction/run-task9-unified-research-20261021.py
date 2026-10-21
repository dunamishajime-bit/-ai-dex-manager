#!/usr/bin/env python3
"""Single Task 9 research bridge: frozen full8 prices + causal replay diagnostics.

The original full8 H1 price model (with 5m modeled exits) is the historical
economic baseline. The new Task9 replay consumes its candidate-decision source
through the SAME research policy ID, one cost at a time. It is prohibited from
replacing the economic figures before source/lifecycle/MTM parity is proven.

No LIVE, Production, operator artifact, or venue write exists in this script.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
POLICY_PATH = REPO / "config/research/task9-unified-v12-short-20261021.json"
DEFAULT_MODEL = Path(
    r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/"
    r"2026-10-21_task9_full8_5m_replay_fixed"
)
DEFAULT_OUTPUT = Path(
    r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/"
    r"2026-10-21_task9_unified_bridge"
)


def require(yes: bool, message: str) -> None:
    if not yes:
        raise RuntimeError(f"TASK9_UNIFIED_BRIDGE_FAIL_CLOSED: {message}")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def model_source_path(model_root: Path, cost: int) -> Path:
    return (
        model_root / "engine" / "BASELINE" / "BASELINE" / f"{cost}bps"
        / "cases" / "V2_M150_D05_CORE_NATIVE" / "runs"
        / f"PRICE_MODEL_{cost}BPS" / "candidate-decisions.jsonl"
    )


def validate_model(model_root: Path, shared: dict) -> dict:
    path = model_root / "manifest.json"
    require(path.is_file(), "model manifest missing")
    model = json.loads(path.read_text("utf8"))
    require(model.get("status") == "COMPLETE_REPRODUCIBLE_RESEARCH_ONLY_NONCANONICAL", "unexpected source-backed model status")
    require(model.get("productionChanges") == 0 and model.get("liveChanges") == 0, "source-backed model changed Production/LIVE")
    require(model.get("dynamicBaseline8LogicExact") is True, "source-backed baseline not certified")
    require(model["sourceArchive"]["symbolCount"] == 35 and model["sourceArchive"]["zipCount"] == 422, "missing archived symbols/ZIPs")
    require(model["sourceArchive"].get("zipIntegrity") in {"422_ZIP_SHA_AND_CRC_PASS", "ALL_ZIP_SHA_AND_CRC_PASS"}, "market ZIP integrity unverified")
    candidate = model["candidateResults"].get(shared["policyId"])
    require(candidate is not None, "shared policy result missing in source-backed engine")
    rule = candidate["rule"]
    for key, config_key in {
        "stop_pct": "stopPct", "arm_hours": "armHours",
        "mfe_gate_pct": "mfeGatePct", "reentry_hours": "reentryHours",
    }.items():
        require(math.isclose(float(rule[key]), float(shared[config_key]), rel_tol=1e-12),
                f"model-policy drift in {key}")
    require(rule["strategy"] == shared["strategy"] and rule["sides"] == [shared["side"]],
            "source-backed strategy/side drift")
    for cost in (10, 30):
        b = model["baseline"][str(cost)]
        anchor = shared["standaloneBaselineAnchors"][f"{cost}bps"]
        for source_field, anchor_field in (
            ("finalEquityJpy", "finalEquityJpy"),
            ("profitFactor", "profitFactor"),
            ("maximumMtmDdPct", "maxDrawdownPct"),
            ("closedTrades", "closedTrades"),
        ):
            require(math.isclose(float(b[source_field]), float(anchor[anchor_field]), rel_tol=1e-12, abs_tol=1e-5),
                    f"baseline anchor drift {cost}bps/{source_field}")
        require(b["accounting"] == "PASS", f"baseline accounting failed {cost}bps")
        require(model_source_path(model_root, cost).is_file(), f"candidate source {cost}bps missing")
    return model


def execute_new_replay(repo: Path, model_root: Path, output: Path, shared: dict, cost: int) -> dict:
    dest = output / f"new-task9-{cost}bps"
    src = model_source_path(model_root, cost)
    command = [
        "node.exe", "--import", "tsx",
        "scripts/dd-reduction/run-task9-dynamic.ts",
        "--source", str(src), "--source-kind", "RAW_CANDIDATE_DECISIONS",
        "--case", "BASELINE", "--case", shared["task9CaseName"],
        "--cost-bps", str(cost), "--output", str(dest),
    ]
    run = subprocess.run(command, cwd=repo, capture_output=True, text=True, timeout=150, check=False)
    require(run.returncode in (0, 2), f"new Task9 failed unexpectedly {cost}bps: {run.stderr[-400:]}")
    out_file = dest / "task9-dynamic-run.json"
    require(out_file.is_file(), f"new Task9 output missing {cost}bps")
    result = json.loads(out_file.read_text("utf8"))
    require(result.get("productionChanges") == 0 and result.get("liveClaim") is False,
            "new Task9 claimed or changed LIVE")
    expected = {"BASELINE", shared["task9CaseName"]}
    require({row["caseName"] for row in result["cases"]} == expected, f"new Task9 policy set mismatch {cost}bps")
    require(all(row["costBps"] == cost for row in result["cases"]), f"new Task9 mixed cost scenarios {cost}bps")
    status = result["cumulativeGate"]["status"]
    passed = status == "ACCEPTED" and all(
        row.get("economicMetrics") is not None and row.get("economicAcceptanceEligible")
        for row in result["cases"] if row["caseName"] == shared["task9CaseName"]
    )
    if not passed:
        require(all(row.get("economicMetrics") is None and not row.get("economicAcceptanceEligible")
                    for row in result["cases"]),
                "new Task9 emitted unsupported economic results while parity is blocked")
    # Pinpoint the first old-versus-new candidate evidence gap; do not
    # substitute modeled legacy fills for independent Task9 execution proof.
    first_divergence_file = output / f"first-divergence-{cost}bps.json"
    compare = subprocess.run([
        sys.executable, "-B", str(HERE / "verify-task9-first-divergence.py"),
        "--legacy-decisions", str(src),
        "--legacy-trades", str(src.with_name("portfolio-trades.jsonl")),
        "--new-task9-run", str(out_file),
        "--cost-bps", str(cost),
        "--output", str(first_divergence_file),
    ], cwd=repo, capture_output=True, text=True, timeout=90, check=False)
    require(compare.returncode in (0, 2),
            f"first-divergence verifier failed {cost}bps: {compare.stderr[-500:]}")
    proof = json.loads(first_divergence_file.read_text("utf8"))
    require(proof["sourceCandidateSha256"] == digest(src), "candidate provenance changed")
    require(proof["costBps"] == cost and proof["productionChanges"] == 0,
            "first-divergence cost/production marker mismatch")
    require(not proof["economicParityProven"],
            "first-divergence trace parity unexpectedly claimed without registered canonical trace directories")
    return {
        "costBps": cost,
        "firstDivergence": proof["firstDivergence"],
        "firstDivergenceReport": str(first_divergence_file),
        "sourceCandidateJsonl": str(src),
        "sourceSha256": digest(src),
        "runnerExit": run.returncode,
        "task9CumulativeGate": status,
        "newEngineEconomicEligible": passed,
        "sourceCoverage": result["sourceCoverage"],
        "caseClassifications": {row["caseName"]: row["classification"] for row in result["cases"]},
        "newEngineResultHash": result["hashes"]["result"],
        "jsonOutput": str(out_file),
        "newEngineJsonSha256": digest(out_file),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--refresh-model", action="store_true",
                        help="Re-run source-backed full8 economic model with canonical shared rule")
    args = parser.parse_args()
    repo = REPO
    model_root = args.model_root.resolve()
    output = args.output.resolve()
    require(repo not in output.parents and output != repo, "raw bridge outputs must be outside repository")
    shared = json.loads(POLICY_PATH.read_text("utf8"))
    require(shared["schemaVersion"] == 1, "wrong policy schema")
    require(shared["policyId"] == "V12_SHORT_PCT2P5_12H_MFE1P0_R12", "unapproved shared policy")
    require(shared["task9CaseName"] == "SOURCE_BACKED_V12_SHORT_2P5", "incorrect replay case binding")
    require(shared["coordinatorOnly"] and shared["economicAuthority"] == "FROZEN_SOURCE_BACKED_FULL8_UNTIL_PARITY",
            "independent economic authority disallowed before parity")
    output.mkdir(parents=True, exist_ok=True)
    if args.refresh_model:
        command = [
            sys.executable, "-B", str(HERE / "run-task9-sourcebacked-5m-bt-20261021.py"),
            "--output", str(model_root), "--candidates", shared["policyId"],
        ]
        proc = subprocess.run(command, cwd=repo, capture_output=True, text=True, timeout=400, check=False)
        require(proc.returncode == 0, f"source-backed full8 refresh failed: {proc.stderr[-600:]}")
    model = validate_model(model_root, shared)
    task9 = [execute_new_replay(repo, model_root, output, shared, cost) for cost in (10, 30)]
    # The old core preserves economic truth; the new core is a diagnostic gate
    # until its lifecycle marks and candidate sizing are genuinely source-backed.
    # Replaying without errors is NOT proof of matching economics or lifecycles.
    # A dedicated first-divergence comparator for all candidate/order/MTM
    # fields must be implemented before this bridge may report FULL PARITY.
    parity = False
    merged = {
        "schemaVersion": 1,
        "status": "UNIFIED_ENGINE_PARITY_VERIFIED" if parity
                  else "UNIFIED_RESEARCH_BRIDGE_COMPLETE_DYNAMIC_PARITY_BLOCKED",
        "policyId": shared["policyId"],
        "policySha256": digest(POLICY_PATH),
        "policyStage": shared["selectionMode"],
        "modelAuthority": shared["economicAuthority"],
        "sourceMarketSha256": model["sourceArchive"]["archiveSha256"],
        "full8ModelBaselineExact": True,
        "full8ModelResearchGate": model["researchCostGates"][shared["policyId"]],
        "full8ModelCostResults": model["candidateResults"][shared["policyId"]]["results"],
        "newTask9CostReplays": task9,
        "economicParityProven": parity,
        "cooldownParityProven": False,
        "fullLifecycleStopParityProven": False,
        "orderBookVenueParityProven": False,
        "newTask9EconomicMetricsAdopted": False,
        "productionChanges": 0,
        "liveChanges": 0,
        "nextUnresolved": [
            "actual rejected-candidate quantity/equity/priority/expiry in Task9",
            "original-model PnL/funding/margin/protective-fill source bridge",
            "time-sequential STOP-confirmed cooldown and gross re-admission",
            "source-backed mark-to-market marks and same chronological wallet",
            "formal transaction-level plus IS/OOS/Holdout economic parity",
        ] if not parity else [],
    }
    manifest = output / "task9-unified-bridge.json"
    manifest.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps({
        "status": merged["status"], "policyId": shared["policyId"],
        "model10bpsFinal": model["candidateResults"][shared["policyId"]]["results"]["10"]["finalEquityJpy"],
        "newReplays": {str(row["costBps"]): row["task9CumulativeGate"] for row in task9},
        "unifiedManifest": str(manifest), "productionChanges": 0,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
