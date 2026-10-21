#!/usr/bin/env python3
"""Verify checked-in Task 9 source-backed *research* BT metadata.

This intentionally does NOT replay external raw 5-minute market ZIPs or claim
venue parity. The primary and repeat raw ledgers live outside Git; only their
source SHA and independently checked equality proof are versioned here.
"""
from __future__ import annotations

import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / "docs/research/results/dd-reduction-source-recovery-noncanonical-20261021"
CANDIDATE = "V12_SHORT_PCT2P5_12H_MFE1P0_R12"
ARCHIVE_SHA = "10cdc48705a6f9e310cd0aecc95ce781af24325b1a99c2eb9aaefe3bd2953934"


def check(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(f"MODEL_RESEARCH_PROVENANCE_INVALID: {message}")


def verify() -> dict:
    research = json.loads((DIR / "full8-5m-recovery-bt-20261021.json").read_text("utf-8"))
    repeat = json.loads((DIR / "full8-5m-independent-repeat-20261021.json").read_text("utf-8"))
    report = (DIR / "FULL8_5M_RECOVERY_BT_20261021.md").read_text("utf-8")

    check(research["status"] == "COMPLETE_REPRODUCIBLE_RESEARCH_ONLY_NONCANONICAL", "wrong research status")
    check(research["productionChanges"] == 0 and research["liveChanges"] == 0, "production mutation marker")
    archive = research["sourceArchive"]
    check(archive["symbolCount"] == 35 and archive["zipCount"] == 422, "market archive coverage")
    check(archive["archiveSha256"] == ARCHIVE_SHA, "historical archive SHA")
    check(archive["zipIntegrity"] in ("ALL_ZIP_SHA_AND_CRC_PASS", "422_ZIP_SHA_AND_CRC_PASS"), "CRC status")
    check(repeat["status"] == "PASS" and repeat["archiveSha256"] == ARCHIVE_SHA, "independent repeat status")
    check(repeat["candidate"] == CANDIDATE and repeat["costScenarios"] == [10, 30], "repeat case identity")
    check(all(repeat["checks"].values()) and len(repeat["checks"]) == 18, "repeat SHA or metric mismatch")
    check(repeat["productionChanges"] == 0 and repeat["liveChanges"] == 0, "repeat mutation marker")
    check(research["independentRepeat"] == repeat, "proof divergence across reports")
    check("未使用" in report and "12時間経過後" in report, "missing essential modeling limitations")
    check(isinstance(research["originalSourceSha256"], dict) and len(research["originalSourceSha256"]) >= 5, "source code index")

    baseline = research["baseline"]
    for cost, expected in {
        "10": (222818966.87803495, -15.62063681288941, 1310),
        "30": (124289206.81827945, -16.78776877493442, 1307),
    }.items():
        row = baseline[cost]
        for key, value in zip(("finalEquityJpy", "maximumMtmDdPct", "closedTrades"), expected):
            check(math.isclose(row[key], value, rel_tol=1e-12, abs_tol=1e-5), f"baseline {cost}:{key}")
        check(row["accounting"] == "PASS", f"baseline {cost}:accounting")

    cases = research["candidateResults"]
    gates = research["researchCostGates"]
    check(len(cases) == len(gates) == 6, "expected six candidate models")
    for name, result in cases.items():
        gate = gates[name]
        calculations = {}
        for cost in ("10", "30"):
            trial = result["results"][cost]
            original = baseline[cost]
            dd = trial["maximumMtmDdPct"] - original["maximumMtmDdPct"]
            retention = trial["finalEquityJpy"] / original["finalEquityJpy"]
            pf = trial["oos"]["profit_factor"] / original["oos"]["profit_factor"]
            calculations[cost] = (dd, retention, pf)
            check(trial["accounting"] == "PASS", f"{name} {cost}:accounting")
            check(math.isclose(dd, trial["baselineComparison"]["ddImprovementPercentagePoints"], abs_tol=1e-7),
                  f"{name} {cost}:DD delta")
            check(math.isclose(retention, trial["baselineComparison"]["finalEquityRetention"], rel_tol=1e-12),
                  f"{name} {cost}:retention")
            check(math.isclose(pf, gate["oosPfRetentionByCost"][cost], rel_tol=1e-12),
                  f"{name} {cost}:OOS PF")
        eligible = all(dd >= 0.1 and ret >= 0.75 and pf >= 0.90 for dd, ret, pf in calculations.values())
        eligible = eligible and all(result["results"][cost]["oos"]["net_pnl_jpy"] > 0 for cost in ("10", "30"))
        check(gate["researchGatePass"] == eligible, f"{name}:incorrect preliminary gate")
    check(gates[CANDIDATE]["researchGatePass"], "candidate 2.5% fails preliminary research gate")
    check(cases[CANDIDATE]["postHocExploratorySensitivity"], "post-hoc nature omitted")
    check(not gates["V12_SHORT_PCT2P25_12H_MFE1P0_R12"]["researchGatePass"],
          "2.25% incorrectly passes historical OOS PF gate")
    return {
        "status": "PASS_RESEARCH_ARTIFACT_METADATA_ONLY",
        "candidateCases": len(cases),
        "archiveZipFiles": archive["zipCount"],
        "archiveSymbols": archive["symbolCount"],
        "repeatChecks": len(repeat["checks"]),
        "bestResearchCandidate": CANDIDATE,
        "productionChanges": 0,
        "liveChanges": 0,
        "formalParityProven": False,
    }


if __name__ == "__main__":
    print(json.dumps(verify(), ensure_ascii=False, sort_keys=True))
