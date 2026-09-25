"""Rebuild independent 1y replay with *native* TS V12 pure signal decisions.

This explicitly is NOT the original 740,771,278 JPY five-sleeve model:
the original allocator, Q102 causal selector, PENGU exit/acceptance feedback,
FET quote/preemption parity and V52 basis/execution inputs remain unverified.
Never deploy this research replay to a trading runtime.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
from pathlib import Path

from .integrated_engine import CapitalContract, run_integrated
from .run_alternate_replay import START_MS, _load_bundle, _metrics
from .v12_native_crosscheck import generate, compare


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(bundle_path: Path, native_path: Path, output_dir: Path) -> dict:
    native = json.loads(native_path.read_text(encoding="utf8"))
    # Independently regenerate all 1,443 pure signals; do not accept a
    # mutable flag or candidate-count agreement alone as parity proof.
    with gzip.open(bundle_path, "rt", encoding="utf8") as stream:
        full_bundle = json.load(stream)
    reference, h2_bars = generate(full_bundle)
    crosscheck = compare(reference, native)
    if native.get("h2Bars") != h2_bars:
        raise ValueError("V12_NATIVE_H2_COUNT_MISMATCH")
    bundle = _load_bundle(bundle_path)
    bundle["native_v12_signals"] = native
    bundle["v12_native_crosscheck"] = crosscheck
    capital = CapitalContract(start_ts_ms=START_MS)
    output_dir.mkdir(parents=True, exist_ok=True)
    scenarios: dict[str, dict] = {}
    for mode in ("NORMAL", "SEVERE"):
        for variant in ("CURRENT", "Q60_DD170_H72"):
            bundle["penguVariant"] = variant
            result = run_integrated(mode, bundle, capital)
            metric = _metrics(result)
            suffix = mode.lower() + "-" + variant.lower()
            event_path = output_dir / (suffix + "-events.json")
            equity_path = output_dir / (suffix + "-equity.json")
            event_path.write_text(json.dumps(result["events"], separators=(",", ":")), encoding="utf8")
            equity_path.write_text(json.dumps(result["equityTimeline"], separators=(",", ":")), encoding="utf8")
            scenarios[suffix] = {
                "finalEquityJpy": result["finalEquity"],
                "profitFactorNetOfFees": metric["profitFactor"],
                "maxDrawdownPctRawEquity": metric["maxDrawdownPct"],
                "ddPeakTs": metric["ddPeakTs"], "ddTroughTs": metric["ddTroughTs"],
                "acceptedEntries": result["acceptedEntryCount"],
                "rejectedEntries": result["rejectedEntryCount"],
                "closedTrades": result["tradeCount"],
                "fees": result["fees"], "funding": result["funding"],
                "preemptions": len(result["preemptions"]),
                "strategyPnL": metric["logic"],
                "ledgerReconciled": metric["ledgerReconciled"],
                "stress": result["stressAssumptions"],
                "eventsSha256": sha256(event_path),
                "equitySha256": sha256(equity_path),
            }
    report = {
        "status": "INDEPENDENT_NATIVE_V12_ONLY_INTEGRATION_NOT_PRODUCTION_PARITY",
        "nativeV12SignalCrosscheck": crosscheck,
        "pureSignalSource": "lib/v12-x1-all.ts",
        "nativeSignalsSha256": sha256(native_path),
        "bundleSha256": sha256(bundle_path),
        "formalIntegratedComparisonPermitted": False,
        "historicalReferenceOnly": {
            "logicVintage": "HISTORICAL_TOP3_FET1P25_Q102GOV030_20260920",
            "normalFinalEquityJpy": 740771278.01,
            "severeFinalEquityJpy": 65669109.00,
            "status": "HEADLINE_ONLY_DIFFERENT_LOGIC_NOT_REPRODUCTION_TARGET",
            "sameLogicAsStudy": False,
            "directPerformanceComparisonPermitted": False,
        },
        "studyLogicVintage": "RESEARCH_NATIVE_V12_PLUS_NONPARITY_PROXIES_20260925",
        "requestedCurrentLogicTarget": "VPS_EFFECTIVE_RUNTIME_7e80cf8a_20260925",
        "currentRuntimeFullParityVerified": False,
        "missingParity": [
            "V12_REAL_ENTRY_EXIT_TRAILING_DYNAMIC_RESIDUAL",
            "PENGU_FULL_COMBINED_FILTERED_ROUTE_AND_EXECUTION",
            "Q102_CAUSAL_V4_SELECTOR_AND_GOVERNOR",
            "FET_EXECUTION_AND_RESIDUAL_GROSS",
            "V52_PAIRED_BASIS_EXECUTION",
            "ORIGINAL_CANONICAL_ALLOCATOR",
            "ASTER_VENUE_AND_ORIGINAL_NORMAL_SEVERE_STRESS",
        ],
        "scenarios": scenarios,
    }
    (output_dir / "audit-summary.json").write_text(
        json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf8"
    )
    print(json.dumps({
        "status": report["status"],
        "v12NativeCandidates": crosscheck["signals"],
        "scenarios": {k: {p: row[p] for p in (
            "finalEquityJpy", "profitFactorNetOfFees", "maxDrawdownPctRawEquity",
            "acceptedEntries", "closedTrades", "preemptions", "ledgerReconciled"
        )} for k, row in scenarios.items()},
    }, sort_keys=True))
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--native", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    run(args.bundle, args.native, args.output_dir)


if __name__ == "__main__":
    main()
