from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .binance_fetch import fetch_binance_bundle
from .models import Bar, Funding
from .run_alternate_replay import START_MS, END_MS, run
from .validate_bundle import validate_bundle

REFERENCE_MANIFEST = Path("docs/research-results/raw-data-v12-pengu-q102-fet-v52-20260924.json")


def _decode_time(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def _json_default(value: Any) -> Any:
    if isinstance(value, (Bar, Funding)):
        return value.to_dict()
    raise TypeError("UNSERIALIZABLE_RAW_DATA")


def _write_gzip(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as file:
        with gzip.GzipFile(fileobj=file, mode="wb", filename="", mtime=0) as stream:
            stream.write(json.dumps(data, default=_json_default, sort_keys=True,
                                    ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Independent repaired alternate BT (NOT Production parity)")
    parser.add_argument("--bundle", type=Path, default=Path(".raw-data/repaired-binance-2025-2026.json.gz"))
    parser.add_argument("--output", type=Path, default=Path("research-results/repaired-independent-20260925/summary.json"))
    parser.add_argument("--manifest", type=Path, default=REFERENCE_MANIFEST)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--stock-dir", type=Path)
    parser.add_argument("--verify-determinism", action="store_true")
    args = parser.parse_args()

    source_manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    period = source_manifest["period"]
    start_ms = _decode_time(period["start"])
    end_ms = _decode_time(period["end"])
    if (start_ms, end_ms) != (START_MS, END_MS):
        raise SystemExit("REPAIRED_REPLAY_UTC_WINDOW_MISMATCH")
    symbols = source_manifest["alternateCryptoSource"]["symbols"]
    if len(symbols) != 16 or len(set(symbols)) != 16:
        raise SystemExit("ALTERNATE_BUNDLE_UNIVERSE_UNVERIFIED")

    if args.download:
        raw = fetch_binance_bundle(symbols, START_MS, END_MS)
        _write_gzip(args.bundle, raw)
    if not args.bundle.is_file():
        raise SystemExit("RAW_BUNDLE_MISSING_NO_DOWNLOAD")

    with gzip.open(args.bundle, "rt", encoding="utf-8") as file:
        bundle = json.load(file)
    if tuple(sorted(bundle.get("bars", {}))) != tuple(sorted(symbols)):
        raise SystemExit("RAW_BUNDLE_SYMBOLS_MISMATCH")
    quality = validate_bundle(bundle)
    if not quality["valid"] or quality["gaps"]:
        raise SystemExit("RAW_BUNDLE_FAILED_VALIDATION:" + json.dumps(quality, sort_keys=True))
    if sum(item["row_count"] for item in quality["ranges"].values()) != 140160:
        raise SystemExit("RAW_BUNDLE_EXPECTED_140160_HOURLY_BARS")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    summary = run(args.bundle, args.output, args.stock_dir)
    first = hashlib.sha256(args.output.read_bytes()).hexdigest()
    if args.verify_determinism:
        run(args.bundle, args.output, args.stock_dir)
        second = hashlib.sha256(args.output.read_bytes()).hexdigest()
        if first != second:
            raise SystemExit("NONDETERMINISTIC_REPLAY_SUMMARY")

    def compact(key: str) -> dict[str, Any]:
        row = summary[key]
        return {
            "finalEquity": row["finalEquity"],
            "netClosedPnl": row["metrics"]["netClosedPnl"],
            "pfNetOfEntryAndExitCosts": row["metrics"]["profitFactor"],
            "maxDrawdownPctRawEquity": row["metrics"]["maxDrawdownPct"],
            "trades": row["tradeCount"],
            "fees": row["fees"],
            "funding": row["funding"],
            "preemptions": len(row["preemptions"]),
            "ledgerReconciled": row["metrics"]["ledgerReconciled"],
            "scenarioAssumptions": row["stressAssumptions"],
        }
    report = {
        "status": "INDEPENDENT_ALTERNATE_REPLAY_NOT_PRODUCTION_PARITY",
        "formalIntegratedBtVerified": False,
        "newPenguProductionParityVerified": False,
        "v52PairedBasisExecutionVerified": False,
        "v52Included": bool(args.stock_dir and args.stock_dir.is_dir()),
        "rawSource": "Binance USD-M Futures public REST (NOT Aster parity)",
        "originalRawBundleHashMatches": (
            quality["sha256"].lower() ==
            source_manifest["alternateCryptoSource"]["canonicalBundleSha256"].lower()
        ),
        "referenceRawBundleSha256": source_manifest["alternateCryptoSource"]["canonicalBundleSha256"],
        "rawValidation": quality,
        "bundleArchiveSha256": hashlib.sha256(args.bundle.read_bytes()).hexdigest(),
        "summarySha256": first,
        "determinismVerified": bool(args.verify_determinism),
        "sourceCommit": "research/raw-replay-accounting-fix-20260925",
        "knownBlockers": [
            "ORIGINAL_CANONICAL_EVENT_LEDGER_UNAVAILABLE",
            "V12_Q102_PENGU_SIGNAL_AND_EXIT_PARITY_UNVERIFIED",
            "V52_BASIS_EXECUTION_PAIR_MISSING",
            "BINANCE_NOT_ASTER_VENUE_FILL_PARITY",
            "RESEARCH_STRESS_ASSUMPTIONS_NOT_ORIGINAL",
        ],
        "scenarios": {key: compact(key) for key in sorted(summary)},
    }
    report_path = args.output.parent / "audit-report.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({"status": report["status"], "scenarios": report["scenarios"],
                      "quality": quality, "bundleHashMatches": report["originalRawBundleHashMatches"],
                      "summarySha256": first}, sort_keys=True))


if __name__ == "__main__":
    main()
