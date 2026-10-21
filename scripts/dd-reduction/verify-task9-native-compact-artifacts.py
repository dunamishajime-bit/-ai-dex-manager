#!/usr/bin/env python3
"""CI: verify checked-in compact Task9 native economic source proof.

CI lacks the user's external raw ZIP/5m/H1 source. This verifies reporting,
source identifiers, 20 independent-repeat SHA digests, cross-language metrics
and prevents a falsely certified standalone dynamic allocator or LIVE fill.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROOF = ROOT / "docs/research/results/dd-reduction-source-recovery-noncanonical-20261021/task9-native-full8-causal-parity-20261021.json"
POLICY = ROOT / "config/research/task9-unified-v12-short-20261021.json"
FILENAMES = {"candidate-decisions.jsonl", "portfolio-trades.jsonl",
             "portfolio-events.jsonl", "task9-mtm.jsonl", "metrics.json"}
STRATEGIES = ("V12", "Q102", "PENGU", "FET", "RESIDUAL", "IDLE", "V52", "HYPE_LONG")


def check(condition, label):
    if not condition:
        raise ValueError("TASK9_NATIVE_COMPACT_INVALID:" + label)


def close(left, right, label):
    check(isinstance(left, (int, float)) and isinstance(right, (int, float))
          and math.isfinite(left) and math.isfinite(right)
          and math.isclose(left, right, rel_tol=2e-10, abs_tol=1e-6), label)


def verify():
    proof = json.loads(PROOF.read_text("utf8"))
    policy = json.loads(POLICY.read_text("utf8"))
    check(proof["status"] == "PASS_NATIVE_SINGLE_ECONOMIC_CORE_CROSS_LANGUAGE_PARITY", "scope")
    check(proof["nativePythonLedgerParity"] == "PASS_NATIVE_SINGLE_CORE_FULL8_ECONOMIC_AND_STOP_CAUSAL_PARITY", "python proof")
    check(proof["nativeTypeScriptLedgerParity"] == proof["status"], "typescript proof")
    check(proof["numberOfScenarios"] == 4 and proof["strategies"] == len(STRATEGIES), "scenario coverage")
    check(proof["policyId"] == policy["policyId"], "shared source policy")
    check(policy["selectionMode"] == "POST_HOC_EXPLORATORY", "exploratory label")
    check(policy["armHours"] == 12 and policy["stopPct"] == 0.025
          and policy["mfeGatePct"] == 0.01 and policy["reentryHours"] == 12, "stop specifics")
    check(proof["candidatesPerScenario"] == 3185
          and proof["actionablePerScenario"] == 3169
          and proof["h1MarksPerScenario"] == 8761, "period/candidate source")
    check(proof["standaloneTask9DynamicReducerIndependentEconomicParity"] is False,
          "separate TypeScript allocator not proven")
    check(proof["signedVenueFillEvidence"] is False, "venue false-certification")
    check(proof["liveChanges"] == proof["productionChanges"] == 0, "Production mutation")
    pairs = proof["independentRepeatShaProof"]
    check(pairs["status"] == "PASS_20_OUT_OF_20_INDEPENDENT_LEDGER_SHAS"
          and pairs["compared"] == pairs["exactMatches"] == 20, "independent repeat count")
    rows = pairs["modelLedgerDigestPairs"]
    check(len(rows) == 20, "20 digest pairs")
    keys = set()
    for row in rows:
        key = (row["costBps"], row["case"], row["file"])
        check(key not in keys, "duplicate source digest")
        keys.add(key)
        check(row["costBps"] in (10, 30)
              and row["case"] in ("BASELINE", policy["policyId"])
              and row["file"] in FILENAMES, "unexpected raw source file")
        check(row["exact"] is True and len(row["sha256"]) == 64
              and all(c in "0123456789abcdef" for c in row["sha256"]), "hash drift")
    check(len(keys) == 20, "missing source digests")
    costs = proof["costs"]
    check(set(costs) == {"10", "30"}, "cost matrix")
    for cost in (10, 30):
        rows = costs[str(cost)]
        baseline, candidate = rows["baseline"], rows["stopWithConfirmedCooldown"]
        anchor = policy["standaloneBaselineAnchors"][f"{cost}bps"]
        for key, field in [("finalEquityJpy", "finalEquityJpy"),
                           ("profitFactor", "profitFactor"),
                           ("maxDrawdownPct", "maxDrawdownPct"),
                           ("tradeCount", "closedTrades")]:
            close(baseline[key], anchor[field], f"{cost}:baseline:{key}")
        for item in (baseline, candidate):
            check(item["h1MtmPoints"] == 8761, "H1 gaps")
            check(item["modeledStopExits"] >= 0
                  and item["stopCooldownRejected"] >= 0, "event counts")
            check(set(item["sha256"]) == FILENAMES, "missing ledger digest")
            for v in item["sha256"].values():
                check(len(v) == 64, "invalid digest")
        for file in FILENAMES:
            pair = next(r for r in pairs["modelLedgerDigestPairs"]
                        if r["costBps"] == cost and r["file"] == file
                        and r["case"] == "BASELINE")
            check(pair["sha256"] == baseline["sha256"][file], "baseline digest drift")
            pair = next(r for r in pairs["modelLedgerDigestPairs"]
                        if r["costBps"] == cost and r["file"] == file
                        and r["case"] == policy["policyId"])
            check(pair["sha256"] == candidate["sha256"][file], "STOP digest drift")
        check(baseline["modeledStopExits"] == baseline["stopCooldownRejected"] == 0,
              "baseline changed by STOP")
        check(candidate["modeledStopExits"] > 0
              and candidate["stopCooldownRejected"] > 0,
              "STOP cooldown missing")
        close(candidate["finalEquityJpy"] / baseline["finalEquityJpy"],
              rows["equityRetention"], "equity retention")
        close(candidate["maxDrawdownPct"] - baseline["maxDrawdownPct"],
              rows["ddImprovementPp"], "DD improvement")
        check(rows["ddImprovementPp"] > 0, "candidate DD not improved")
    check(costs["30"]["equityRetention"] < .75 and
          proof["researchGate"] == "FAIL_BELOW_75PCT_30BPS_EQUITY_RETENTION",
          "reject nonqualifying 30bps STOP")
    return {"status": "PASS_RESEARCH_COMPACT_METADATA_ONLY",
            "rawLedgerAccess": False, "ledgerShaPairs": 20,
            "nativeEconomicCore": "PASS", "separateTsReducer": "UNVERIFIED",
            "productionChanges": 0}


if __name__ == "__main__":
    print(json.dumps(verify(), ensure_ascii=False, sort_keys=True))
