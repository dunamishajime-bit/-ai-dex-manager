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
FOUR_REEXEC = ROOT / "docs/research/STABLE4_FOUR_NATIVE_SOURCE_SYNTHETIC_COMPARISON_20261128.json"
PENGU_NATIVE = ROOT / "docs/research/STABLE4_PENGU_BINANCE_NATIVE_H1_LEDGER_20261128.json"
PENGU_M5 = ROOT / "docs/research/STABLE4_PENGU_BINANCE_H1_ASTER_M5_CANDIDATE_QUALITY_20261128.json"
PENGU_M5_REVIEWED_REPORT_SHA256 = "f22b0aa4d9afcde3f0336d1884be54330d9c15b7ab6a2c6281e0f11f455a6f0d"
Q102_REAL = ROOT / "docs/research/STABLE4_Q102_BINANCE_BTC_SOL_12_MONTHLY_NATIVE_H1_20261128.json"
V52_COVERAGE = ROOT / "docs/research/STABLE4_V52_STOCK_ASTER5M_YAHOO1H_COVERAGE_20261128.json"
V52_LIQUIDITY = ROOT / "docs/research/STABLE4_V52_REGULAR_SESSION_LIQUIDITY_20261128.json"
Q102_H1_ARCHIVE = ROOT / "docs/research/STABLE4_Q102_ASTER_H1_181D_ARCHIVE_SOURCE_INTEGRITY_20261128.json"
Q102_H1_MONTHLY = ROOT / "docs/research/STABLE4_Q102_ASTER_H1_MONTHLY_181D_READINESS_20261128.json"
Q102_BTC_BAD_BAR = ROOT / "docs/research/STABLE4_Q102_BTC_H1_ASTERVS_BINANCE_BAD_BAR_20261128.json"
RUNNERS = ("V4", "PENGU", "Q102", "IDLE", "FET", "HYPE", "V52")


def exact_sha(path: Path) -> str:
    if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(ROOT):
        raise ValueError("SYNTHETIC_SOURCE_UNSAFE")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evaluate() -> dict:
    three = json.loads(THREE.read_text(encoding="utf-8"))
    other = json.loads(OTHER.read_text(encoding="utf-8"))
    four = json.loads(FOUR_REEXEC.read_text(encoding="utf-8"))
    pengu_native_raw = PENGU_NATIVE.read_bytes()
    pengu_native = json.loads(pengu_native_raw)
    if (not PENGU_M5.is_file() or PENGU_M5.is_symlink()
            or hashlib.sha256(PENGU_M5.read_bytes()).hexdigest() != PENGU_M5_REVIEWED_REPORT_SHA256):
        raise ValueError("PENGU_M5_REVIEWED_RESULT_BYTE_SHA_MISMATCH")
    pengu_m5 = json.loads(PENGU_M5.read_text(encoding="utf8"))
    if __package__:
        from .research.stable4_pengu_aster_m5_after_h1_source_audit import verify_report as verify_pengu_m5
    else:
        from research.stable4_pengu_aster_m5_after_h1_source_audit import verify_report as verify_pengu_m5
    verify_pengu_m5(pengu_m5, pengu_native, pengu_native_raw)
    q102_real = json.loads(Q102_REAL.read_text(encoding="utf8"))
    v52_coverage = json.loads(V52_COVERAGE.read_text(encoding="utf8"))
    v52_liquidity = json.loads(V52_LIQUIDITY.read_text(encoding="utf8"))
    q102_archive = json.loads(Q102_H1_ARCHIVE.read_text(encoding="utf8"))
    if __package__:
        from .research.stable4_q102_aster_h1_archive_source_audit import verify_snapshot as verify_q102_archive
    else:
        from research.stable4_q102_aster_h1_archive_source_audit import verify_snapshot as verify_q102_archive
    verify_q102_archive(q102_archive)
    q102_btc_conflict = json.loads(Q102_BTC_BAD_BAR.read_text(encoding="utf8"))
    if __package__:
        from .research.stable4_q102_aster_h1_archive_source_audit import verify_btc_aster_binance_conflict
    else:
        from research.stable4_q102_aster_h1_archive_source_audit import verify_btc_aster_binance_conflict
    verify_btc_aster_binance_conflict(q102_btc_conflict, q102_archive)
    q102_monthly = json.loads(Q102_H1_MONTHLY.read_text(encoding="utf8"))
    if __package__:
        from .research.stable4_q102_181d_monthly_readiness import verify_monthly_snapshot
    else:
        from research.stable4_q102_181d_monthly_readiness import verify_monthly_snapshot
    verify_monthly_snapshot(q102_monthly, q102_archive)
    # Both direct "python scripts/..." CLI and package unit-test imports are
    # supported; never skip the provenance verifier in either invocation.
    if __package__:
        from .research.stable4_v52_regular_session_liquidity_audit import verify_report
    else:
        from research.stable4_v52_regular_session_liquidity_audit import verify_report
    verify_report(v52_liquidity, v52_coverage)
    if (pengu_native.get("status") != "NATIVE_REAL_H1_RAW_SIGNAL_PARITY_PASS"
            or any(pengu_native.get("arms", {}).get(mode, {}).get("checked") != count
                   for mode, count in (("BASE", 54), ("V8_V64", 112)))
            or pengu_native.get("orderAuthority") is not False
            or pengu_native.get("annualProfitOrDdCertified") is not False
            or pengu_native.get("productionEligible") is not False):
        raise ValueError("PENGU_REAL_H1_NATIVE_ONLY_EVIDENCE_INVALID")
    if (q102_real.get("status") != "LIMITED_NATIVE_H1_MONTHLY_REPLAY_PASS_NO_TRADES"
            or q102_real.get("summary", {}).get("months") != 12
            or q102_real.get("summary", {}).get("noSignal") != 12
            or q102_real.get("portfolioReplayComplete") is not False
            or q102_real.get("orderAuthority") is not False):
        raise ValueError("Q102_LIMITED_REAL_H1_NATIVE_EVIDENCE_INVALID")
    if (v52_coverage.get("status") != "COVERAGE_REVIEW_ONLY"
            or v52_coverage.get("orderAuthority") is not False
            or v52_coverage.get("sourceFillParityProven") is not False
            or len(v52_coverage.get("perTicker", {})) != 5
            or any(v.get("asterM5", {}).get("rows") != 105120
                   or v.get("yahooH1", {}).get("rows") != 1742
                   for v in v52_coverage["perTicker"].values())):
        raise ValueError("V52_MARKET_COVERAGE_NOT_EXECUTION_EVIDENCE_INVALID")
    if (four.get("schema") != "stable4-four-native-source-synthetic-comparison/v1"
            or four.get("status") != "REVIEW_ONLY_PARTIAL_SOURCE_REPLAY_NO_ADOPTION"
            or four.get("adoptFourSleeveHype") is not False
            or four.get("portfolioNativeSevenComplete") is not False
            or four.get("productionEligible") is not False
            or four.get("liveOrderAuthority") is not False
            or four.get("rootCertificateIssued") is not False):
        raise ValueError("FOUR_SLEEVE_REPLAY_RELEASE_BOUNDARY_UNVERIFIED")
    if four.get("syntheticWindow", {}).get("cases") != 12:
        raise ValueError("FOUR_SLEEVE_CASE_COVERAGE_INVALID")
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
        "fourSleeveCurrentSource": {
            "path": "scripts/stable4-four-sleeve-native-synthetic.ts",
            "expected": next((e["sourceSha256"] for e in four.get("evidence", [])
                              if e.get("name") == "fourSleeve"), None),
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
        "HYPE": "PARTIAL_NATIVE_HYPE_IN_FOUR_SLEEVE_SHARED_WALLET",
        "V52": "NO_NATIVE_STOCK_SESSION_SYNTHETIC_REPLAY",
    }
    if set(coverage) != set(RUNNERS):
        raise ValueError("SEVEN_RUNNER_COVERAGE_INCOMPLETE")
    return {
        "schema": "stable4-seven-native-synthetic-coverage/v1",
        "status": "BLOCKED_INCOMPLETE_RESEARCH" if all_source_matched else "BLOCKED_SOURCE_SHA_MISMATCH",
        "runnerCoverage": coverage,
        "threeSleeveSharedWalletCases": len(three["cases"]),
        "fourSleeveSharedWalletCases": four["syntheticWindow"]["cases"],
        "fourSleeveComparisonAdopted": False,
        "realMarketNativeSourceScope": {
            "PENGU": "BINANCE_H1_RAW_SOURCE_ENTRY_166_OF_166_ONLY_NOT_VENUE",
            "Q102": "BTC_SOL_12_MONTH_START_SOURCE_HIGH_VOL_CHECKPOINTS_ONLY",
            "V52": "FIVE_STOCK_ASTER_M5_YAHOO_H1_INPUT_COVERAGE_ONLY",
        },
        "noCurrentSourceNativeSharedWalletPortfolioResult": True,
        "penguAsterM5SignalTape": {
            "crossArmUniqueNativeH1Signals": pengu_m5["crossArmDedup"]["union"],
            "crossArmOverlappingH1Signals": pengu_m5["crossArmDedup"]["shared"],
            "baselineAndV8AreIndependentTrades": False,
            "h1RawSignalArmCounts": {
                mode: row["rawH1Signals"] for mode, row in pengu_m5["arms"].items()
            },
            "first5mPositiveVolumeByArm": {
                mode: row["first5mPositiveVolume"] for mode, row in pengu_m5["arms"].items()
            },
            "first15mAllZeroByArm": {
                mode: row["first15mAllZero"] for mode, row in pengu_m5["arms"].items()
            },
            "verifiedVenueFills": 0,
            "m5VolumeIsNotExecutableFillProof": True,
        },
        "q102AsterArchiveCausal181d": {
            "matchingWarmupFiles": q102_archive["matchingCount"],
            "causallyValidWarmupAtTargetStart": q102_archive["matchedWarmupCoveringTargetStart"],
            "monthlyRolling181dReadyByTicker": {
                ticker: row["historyReadyMonths"] for ticker, row in q102_monthly["byTicker"].items()
            },
            "monthlyReadyIsNativeTradeProof": False,
            "btcDuplicatedCorruptAsterH1Bar": q102_btc_conflict["timestampUtc"],
            "binanceSubstitutionAuthorized": False,
            "wholeNativeQ102UniverseOrFillsProven": False,
        },
        "v52RegularSessionVolumeAudit": {
            "status": v52_liquidity["status"],
            "zeroVolumePercentByTicker": {
                ticker: stats["regularSessionZeroVolumePct"]
                for ticker, stats in v52_liquidity["perTicker"].items()
            },
            "fiveStockVenueExecutablePricesOrFillsProven": False,
        },
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
