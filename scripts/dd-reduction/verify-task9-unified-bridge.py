#!/usr/bin/env python3
"""Offline validation of the unified old-full8/new-Task9 research bridge manifest.

Checks checked-in metadata only. Raw venue parity is intentionally NOT claimed.
"""
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs/research/results/dd-reduction-source-recovery-noncanonical-20261021"
POLICY = ROOT / "config/research/task9-unified-v12-short-20261021.json"
BRIDGE = DOC / "task9-unified-bridge-status-20261021.json"
RESULTS = DOC / "full8-5m-recovery-bt-20261021.json"


def check(ok, description):
    if not ok:
        raise AssertionError(f"TASK9_UNIFIED_BRIDGE_INVALID: {description}")


def verify():
    policy = json.loads(POLICY.read_text("utf8"))
    bridge = json.loads(BRIDGE.read_text("utf8"))
    model = json.loads(RESULTS.read_text("utf8"))
    check(policy["schemaVersion"] == 1, "policy version")
    check(policy["strategy"] == "V12" and policy["side"] == "SHORT", "strategy/side")
    check(policy["policyId"] == "V12_SHORT_PCT2P5_12H_MFE1P0_R12", "policyId")
    check(policy["task9CaseName"] == "SOURCE_BACKED_V12_SHORT_2P5", "dynamic opt-in identity")
    check(policy["stopPct"] == 0.025 and policy["armHours"] == 12, "STOP specifics")
    check(policy["mfeGatePct"] == 0.01 and policy["reentryHours"] == 12, "STOP gate")
    check(policy["selectionMode"] == "POST_HOC_EXPLORATORY", "post-hoc label")
    check(bridge["sharedPolicyId"] == policy["policyId"], "cross-language config")
    check(bridge["sharedPolicySha256"] == hashlib.sha256(POLICY.read_bytes()).hexdigest(), "policy SHA")
    check(bridge["status"] == "UNIFIED_RESEARCH_BRIDGE_COMPLETE_DYNAMIC_PARITY_BLOCKED", "blocked status")
    check(bridge["oldEconomicEngine"] == "FROZEN_SOURCE_BACKED_FULL8_UNTIL_PARITY", "economic authority")
    check(bridge["marketSourceSha256"] == model["sourceArchive"]["archiveSha256"], "source market SHA")
    check(bridge["modelBaselineExact"] is True, "baseline anchor")
    check(bridge["economicParityProven"] is False, "missing economic parity")
    check(bridge["cooldownParityProven"] is False and bridge["fullLifecycleStopParityProven"] is False, "unproven lifecycle")
    check(bridge["productionChanges"] == bridge["liveChanges"] == 0, "production mutation")
    check(set(bridge["costScenarios"]) == {"10", "30"}, "costs")
    for cost in ("10", "30"):
        item = bridge["costScenarios"][cost]
        check(item["observedRows"] == 3185, f"observed rows {cost}")
        check(item["newTask9Status"] == "BLOCKED_INCOMPLETE_SOURCE_COVERAGE", f"dynamic result {cost}")
        check(item["replayableRows"] == 0, f"no replayable set {cost}")
        check(item["newEngineEconomicEligible"] is False, f"no unsupported metrics {cost}")
        check(item["sourceCandidateSha256"] == item["newTask9SourceHash"], f"same raw candidate source {cost}")
        check(len(item["sourceCandidateSha256"]) == 64, f"source SHA length {cost}")
        orig = model["candidateResults"][policy["policyId"]]["results"][cost]
        check(item["modelFinalEquityJpy"] == orig["finalEquityJpy"], f"old final equity {cost}")
        check(item["modelMaxDdPct"] == orig["maximumMtmDdPct"], f"old MTM DD {cost}")
    return {"status": "PASS_BRIDGE_METADATA_PARITY_BLOCKED", "costs": [10, 30],
            "sharedPolicyId": policy["policyId"], "productionChanges": 0}


if __name__ == "__main__":
    print(json.dumps(verify(), sort_keys=True))
