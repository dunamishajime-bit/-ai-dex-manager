#!/usr/bin/env python3
"""Read-only legacy Q102 S1/S2 fixture provenance contract.

This cannot certify upstream stage membership: the legacy reconstruction
itself states ORIGINAL_RAW_GENERATOR_PROVEN=False. Never turns these rows
into LIVE or research simulation entries. Does not copy fixture rows.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

EXPECTED_SOURCE_SHA256 = "7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f"
HOUR_MS = 3_600_000
EXPECTED_NATIVE_SELECTED_STAGE_ROWS = {"S1": 8, "S2": 10}
EXPECTED_UPSTREAM_EXPANDED_ROWS = 30
EXPECTED_FIXTURE_COLUMNS = (
    "layer", "symbol", "signal_timestamp_ms", "entry_timestamp_ms", "side"
)
RESULT = "LEGACY_FIXTURE_CONTRACT_ONLY_STAGE_MEMBERSHIP_UNVERIFIED"


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def audit_legacy_stage_fixture(
    fixture: Path, native_source: Path, reconstructed_script: Path
) -> dict:
    raw_fixture = fixture.read_bytes()
    raw_source = native_source.read_bytes()
    normalized_source = raw_source.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    if sha256(normalized_source) != EXPECTED_SOURCE_SHA256:
        raise ValueError("Q102_LEGACY_SOURCE_PIN_MISMATCH")
    script = reconstructed_script.read_text(encoding="utf-8")
    if 'ORIGINAL_RAW_GENERATOR_PROVEN = False' not in script or \
        'RESEARCH_ONLY = True' not in script:
        raise ValueError("Q102_LEGACY_RECONSTRUCTION_PROVENANCE_NOT_EXPLICIT")
    # Strict UTF-8 parser; the only accepted contract is a closed historical
    # signal fixture, NOT actual source stage IDs or realized exit fills.
    with fixture.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if tuple(reader.fieldnames or ()) != EXPECTED_FIXTURE_COLUMNS:
            raise ValueError("Q102_LEGACY_FIXTURE_COLUMNS_CHANGED")
        rows = list(reader)
    if len(rows) != sum(EXPECTED_NATIVE_SELECTED_STAGE_ROWS.values()):
        raise ValueError("Q102_LEGACY_FIXTURE_ROW_COUNT_CHANGED")
    seen = set()
    stages = Counter()
    symbols = set()
    dates = []
    previous_signal = -1
    for row in rows:
        stage, symbol = row["layer"], row["symbol"]
        if stage not in EXPECTED_NATIVE_SELECTED_STAGE_ROWS or not symbol or \
            not symbol.isascii() or not symbol.isalnum() or not symbol.isupper():
            raise ValueError("Q102_LEGACY_STAGE_OR_SYMBOL_INVALID")
        try:
            signal = int(row["signal_timestamp_ms"])
            entry = int(row["entry_timestamp_ms"])
            side = int(row["side"])
        except (TypeError, ValueError) as exc:
            raise ValueError("Q102_LEGACY_TIMESTAMP_OR_SIDE_INVALID") from exc
        if signal <= 0 or signal % HOUR_MS or entry != signal + HOUR_MS or \
            side not in (-1, 1) or signal <= previous_signal:
            raise ValueError("Q102_LEGACY_TIME_CAUSALITY_OR_ORDER_INVALID")
        ident = (stage, symbol, signal)
        if ident in seen:
            raise ValueError("Q102_LEGACY_DUPLICATE_ID")
        seen.add(ident)
        stages[stage] += 1
        symbols.add(symbol)
        dates.append(signal)
        previous_signal = signal
    if dict(stages) != EXPECTED_NATIVE_SELECTED_STAGE_ROWS:
        raise ValueError("Q102_LEGACY_STAGE_COUNTS_CHANGED")
    return {
        "schema": "bt481-q102-s1s2-legacy-fixture-provenance-v1",
        "outcome": RESULT,
        "sourceSha256": sha256(normalized_source),
        "fixtureSha256": sha256(raw_fixture),
        "reconstructionScriptSha256": sha256(reconstructed_script.read_bytes()),
        "historicSelectedRows": len(rows),
        "historicSelectedStageCounts": dict(stages),
        "distinctSymbols": len(symbols),
        "firstSignalTimestampMs": min(dates),
        "lastSignalTimestampMs": max(dates),
        "upstreamExpandedExpected": EXPECTED_UPSTREAM_EXPANDED_ROWS,
        "upstreamExpandedIdsSupplied": False,
        "nativeMonthlyRulesSupplied": False,
        "upstreamOriginalRawGeneratorProven": False,
        "verifiedStageMembership": False,
        "approvedNativeS1S2Entries": 0,
        "verifiedVenueFills": 0,
        "note": (
            "18 historic selected-signal rows are not the 30 expanded "
            "stage source IDs. Legacy reconstruction explicitly states the "
            "original raw generator is not proven. No stage promotion."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--native-source", type=Path, required=True)
    parser.add_argument("--reconstructed-script", type=Path, required=True)
    parser.add_argument("--private-output", type=Path)
    args = parser.parse_args()
    result = audit_legacy_stage_fixture(
        args.fixture, args.native_source, args.reconstructed_script
    )
    if args.private_output:
        args.private_output.parent.mkdir(parents=True, exist_ok=True)
        args.private_output.write_text(
            json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    # Expected fail-closed code: successful fixture syntax does not establish
    # original source membership. Do not convert this status to pass/admitted.
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
