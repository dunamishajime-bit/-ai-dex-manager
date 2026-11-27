"""Audit genuine synthetic replay coverage without certifying trading authority.

This script reads the actual source-level research reports. Separate sleeve
simulations are not a seven-runner shared-wallet replay, even if every sleeve
eventually has some independently tested synthetic trades.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
THREE = ROOT / "docs/research/STABLE4_THREE_NATIVE_SLEEVE_SYNTHETIC_20261127.json"
OTHER = ROOT / "docs/research/STABLE4_Q102_V4_HYPE_NATIVE_SYNTHETIC_EVIDENCE_20261127.json"
RUNNERS = ("V4", "PENGU", "Q102", "IDLE", "FET", "HYPE", "V52")


def exact_sha(path: Path) -> str:
    if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(ROOT):
        raise ValueError("SYNTHETIC_SOURCE_UNSAFE")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evaluate() -> dict:
    three = json.loads(THREE.read_text(encoding="utf-8"))
    other = json.loads(OTHER.read_text(encoding="utf-8"))
    if three.get("status") != "PARTIAL_NATIVE_SOURCE_RESEARCH_ONLY" or len(three.get("cases", [])) != 12:
        raise ValueError("THREE_SLEEVE_EVIDENCE_UNVERIFIED")
    if other.get("schema") != "stable4-q102-hype-monthly-native-synthetic-evidence/v1" or other.get("status") != "RESEARCH_ONLY_NOT_CERTIFIED":
        raise ValueError("Q102_HYPE_EVIDENCE_UNVERIFIED")
    if len(other.get("samples", [])) != 8 or other.get("summary", {}).get("q102", {}).get("opened") != 4:
        raise ValueError("Q102_SAMPLE_COVERAGE_UNVERIFIED")
    if "no PENGU Q102 HYPE V52 or legacy V4" not in " ".join(three.get("limitations", [])):
        raise ValueError("THREE_SLEEVE_LIMITATIONS_UNAVAILABLE")
    sources = {
        "threeSleeve": {
            "path": "scripts/stable4-three-sleeve-native-synthetic.ts",
            "expected": three.get("source_sha256"),
        },
        "isolatedQ102Hype": {
            "path": other["source"],
            "expected": other.get("sourceSha256"),
        },
    }
    integrity = {}
    for source_name, item in sources.items():
        if not isinstance(item["expected"], str) or len(item["expected"]) != 64:
            raise ValueError("SYNTHETIC_SOURCE_DIGEST_UNAVAILABLE")
        actual = exact_sha(ROOT / item["path"])
        integrity[source_name] = {
            "path": item["path"],
            "expected": item["expected"],
            "actual": actual,
            "matched": actual == item["expected"],
        }
    all_source_matched = all(x["matched"] for x in integrity.values())
    coverage = {
        "V4": "PARTIAL_R21_ROUTE_IN_THREE_SLEEVE_WALLET",
        "PENGU": "NO_NATIVE_SYNTHETIC_REPLAY",
        "Q102": "ISOLATED_MONTHLY_NATIVE_FOUR_TRADES_ONLY",
        "IDLE": "PARTIAL_R26_IN_THREE_SLEEVE_WALLET",
        "FET": "PARTIAL_BRK48_IN_THREE_SLEEVE_WALLET",
        "HYPE": "ISOLATED_NATIVE_NOT_SHARED_WALLET",
        "V52": "NO_NATIVE_STOCK_SESSION_SYNTHETIC_REPLAY",
    }
    if set(coverage) != set(RUNNERS):
        raise ValueError("SEVEN_RUNNER_COVERAGE_INCOMPLETE")
    return {
        "schema": "stable4-seven-native-synthetic-coverage/v1",
        "status": "BLOCKED_INCOMPLETE_RESEARCH" if all_source_matched else "BLOCKED_SOURCE_SHA_MISMATCH",
        "runnerCoverage": coverage,
        "threeSleeveSharedWalletCases": len(three["cases"]),
        "q102IsolatedCases": other["summary"]["q102"]["cases"],
        "hypeIsolatedCases": other["summary"]["hype"]["cases"],
        "singleSevenRunnerNativeReplay": False,
        "completeYearFromCurrentPinnedRunnerSources": False,
        "portfolioFundingAndExecutableProtectionProven": False,
        "sourceEvidenceByteDigestsMatched": all_source_matched,
        "sourceEvidenceIntegrity": integrity,
        "rootCertificateIssued": False,
        "orderAuthority": False,
    }


if __name__ == "__main__":
    print(json.dumps(evaluate(), ensure_ascii=False, sort_keys=True))
