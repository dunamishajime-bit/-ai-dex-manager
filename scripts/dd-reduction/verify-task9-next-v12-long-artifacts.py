#!/usr/bin/env python3
"""CI check: compact V12 LONG next-step evidence, no false LIVE certification."""
from __future__ import annotations

import json
import math
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DOC = REPO / "docs/research/results/dd-reduction-source-recovery-noncanonical-20261021"
RESULT = DOC / "task9-next-v12-long-cumulative-20261021.json"
PARENT = DOC / "task9-native-full8-causal-parity-20261021.json"
POLICY = REPO / "config/research/task9-unified-v12-short-20261021.json"


def require(condition, label):
    if not condition:
        raise AssertionError("TASK9_NEXT_LONG_COMPACT_FAIL_CLOSED:" + label)


def close(a, b, label):
    require(math.isclose(a, b, rel_tol=2e-10, abs_tol=1e-5), label)


def verify():
    data = json.loads(RESULT.read_text("utf8"))
    parent = json.loads(PARENT.read_text("utf8"))
    policy = json.loads(POLICY.read_text("utf8"))
    require(data["schemaVersion"] == 1, "schema")
    require(data["status"] == "RESEARCH_ONLY_CUMULATIVE_V12_LONG_NOT_LIVE", "status")
    require(data["predecessorPolicyId"] == parent["policyId"] == policy["policyId"], "predecessor")
    require(data["newPolicyId"] == "V12_LONG_PCT2P0_12H_MFE1P0_R12", "LONG selection")
    require(data["predecessorResearchGate"] == parent["researchGate"]
            == "FAIL_BELOW_75PCT_30BPS_EQUITY_RETENTION", "parent rejected")
    require(data["productionChanges"] == data["liveChanges"] == 0, "LIVE changes")
    require(data["venueFillParityProven"] is False and
            data["independentTypeScriptAllocatorParityProven"] is False, "false certification")
    require(set(data["cases"]) == {f"{name}_{bps}bps" for name in
            ("V12_LONG_ALONE", "CARRY_SHORT_THEN_ADD_V12_LONG") for bps in (10, 30)},
            "matrix")
    for bps in (10, 30):
        base = parent["costs"][str(bps)]["baseline"]
        short = parent["costs"][str(bps)]["stopWithConfirmedCooldown"]
        for name in ("V12_LONG_ALONE", "CARRY_SHORT_THEN_ADD_V12_LONG"):
            row = data["cases"][f"{name}_{bps}bps"]
            require(row["candidateCount"] == 3185 and row["h1Marks"] == 8761,
                    "full year evidence")
            require(row["acceptedCandidateCount"] == row["closedTrades"], "modeled admission")
            require(row["accounting"] == "PASS", "accounting")
            require(row["confirmedStopExits"] == sum(row["stopBySide"].values()),
                    "STOP event/side count")
            require(set(row["stopBySide"]) ==
                    ({"LONG"} if name == "V12_LONG_ALONE" else {"LONG", "SHORT"}),
                    "LONG/SHORT coverage")
            close(row["vsFrozenBaseline"]["ddImprovementPp"],
                  row["maxDrawdownPct"] - base["maxDrawdownPct"], "baseline dd")
            close(row["vsFrozenBaseline"]["equityRetention"],
                  row["finalEquityJpy"] / base["finalEquityJpy"], "baseline wallet")
            close(row["vsCarriedShort"]["ddImprovementPp"],
                  row["maxDrawdownPct"] - short["maxDrawdownPct"], "parent dd")
            close(row["vsCarriedShort"]["equityRetention"],
                  row["finalEquityJpy"] / short["finalEquityJpy"], "parent wallet")
    for name, gate in data["researchGates"].items():
        require(gate["bothCostAccountingPass"] is True, "accounting gate")
        require(gate["bothCostEquityRetention75Pct"] is False, "wrong acceptance")
        require(gate["researchOnly"] and gate["previousShortWasResearchRejected"], "research status")
    proof = data.get("independentRepeatShaProof")
    require(proof is not None and proof["compared"] == 20 and proof["exactMatches"] == 20,
            "repeat evidence")
    require(proof["status"] == "PASS_20_OUT_OF_20_NEXT_LONG_LEDGER_SHAS", "repeat status")
    require(len(proof["ledgerDigestPairs"]) == 20 and all(
        len(item["sha256"]) == 64 and item["exact"] for item in proof["ledgerDigestPairs"]),
        "SHA256 index")
    return {"status": "PASS_NEXT_V12_LONG_CUMULATIVE_RESEARCH_EVIDENCE",
            "longResearchGate": "REJECTED", "cases": 4,
            "deterministicHashes": 20, "productionChanges": 0}


if __name__ == "__main__":
    print(json.dumps(verify(), sort_keys=True))
