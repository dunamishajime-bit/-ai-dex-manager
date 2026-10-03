"""Replay one exact Q102 full-observability time chunk from the audited frozen runtime.

The runtime implementation is not simplified. This script only partitions the decision
timeline so independent CI workers can replay the same q102Series function in parallel.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
import hashlib
import importlib
import json
from pathlib import Path
import sys
import types
from typing import Any

HOUR_MS = 3_600_000


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_json(path: Path, value: Any) -> str:
    raw = (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    raw = "".join(canonical(row) + "\n" for row in rows).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return {"path": path.name, "rows": len(rows), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def load_release_module(code_root: Path):
    package_name = "_formal_q102_chunk_release"
    package = types.ModuleType(package_name)
    package.__path__ = [str(code_root)]
    sys.modules[package_name] = package
    return importlib.import_module(f"{package_name}.signal_scan")


def signal_semantics(signal: dict[str, Any] | None) -> dict[str, Any] | None:
    if not signal:
        return None
    keys = (
        "strategyId", "referenceTs", "side", "symbol", "family", "variant", "layer",
        "requestedGross", "reason", "dataCutoffTs", "hardStop", "maxHoldHours",
        "exitPolicy", "brkEnabled",
    )
    return {key: signal.get(key) for key in keys if key in signal}


def economic_signal_semantics(signal: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in signal.items() if key != "referenceTs"}


def allowed_fast_reference_ts_divergence(
    key: tuple[int, str],
    fast: dict[str, Any],
    full: dict[str, Any],
) -> bool:
    decision_ts, _ = key
    return (
        fast.get("referenceTs") != full.get("referenceTs")
        and str(full.get("family") or "").upper() == "HIGH_VOL"
        and full.get("referenceTs") == decision_ts
        and fast.get("referenceTs") == fast.get("dataCutoffTs")
        and full.get("dataCutoffTs") == fast.get("dataCutoffTs")
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--start", type=date.fromisoformat, required=True)
    parser.add_argument("--end-exclusive", type=date.fromisoformat, required=True)
    args = parser.parse_args(argv)

    require(args.start < args.end_exclusive, "Q102_CHUNK_INVALID_RANGE")
    release = args.release_root.resolve()
    code = release / "all-reconstruction-code-plus-90-file-audited-source"
    data = release / "market-Aster-H1-funding-and-manifests"
    fast_scan = release / "baseline-complete-signal-and-gate-decisions" / "baseline-signal-scan-q102"
    for path in (code, data, fast_scan):
        require(path.exists(), f"Q102_CHUNK_INPUT_MISSING:{path}")

    scan_mod = load_release_module(code)
    source_manifest = load_json(code / "runtime_source_manifest.json")
    acquired = load_json(data / "acquisition-manifest.json")
    require(acquired.get("runtime_sha") == source_manifest.get("runtime_sha"), "Q102_CHUNK_RUNTIME_MISMATCH")

    universes = scan_mod.extract_universes()
    symbols = list(universes["Q102"])
    high_vol_symbols = list(
        source_manifest["config_allowlist"]["live_process_environment"]["QUALITY102_CAUSAL_V1_SYMBOLS"]
    )
    start_ms = scan_mod._time_ms(args.start)
    end_exclusive_ms = scan_mod._time_ms(args.end_exclusive)
    end_inclusive_ms = end_exclusive_ms - HOUR_MS
    expected_hours = (end_exclusive_ms - start_ms) // HOUR_MS
    require(expected_hours > 0, "Q102_CHUNK_EMPTY_RANGE")

    candles_by_symbol: dict[str, list[dict[str, Any]]] = {}
    for symbol in [*symbols, "BTCUSDT"]:
        rows = scan_mod._load_jsonl(scan_mod._history_path(data, symbol))
        candles_by_symbol[symbol] = [
            {
                "timestampMs": int(row["event_time_ms"]),
                "open": row["open"],
                "high": row["high"],
                "low": row["low"],
                "close": row["close"],
                "quoteVolume": row.get("quote_volume") or 0,
                "baseVolume": row["base_volume"],
            }
            for row in rows
        ]

    ledger: list[dict[str, Any]] = []
    selected_signals: dict[tuple[int, str], dict[str, Any]] = {}
    error_timestamps: list[int] = []
    with scan_mod.RuntimeBridge() as bridge:
        series = bridge.q102_series(
            candles_by_symbol, high_vol_symbols, symbols, start_ms, end_inclusive_ms
        )
        require(len(series) == expected_hours, f"Q102_CHUNK_EVENT_COUNT:{len(series)}:{expected_hours}")
        for offset, event in enumerate(series):
            ts = int(event["decisionTs"])
            expected_ts = start_ms + offset * HOUR_MS
            require(ts == expected_ts, f"Q102_CHUNK_TIMESTAMP_GAP:{expected_ts}:{ts}")
            snapshot = event.get("snapshot")
            if event.get("error") or snapshot is None:
                error_timestamps.append(ts)
                reason = str(event.get("error") or "Q102_SNAPSHOT_MISSING")
                for symbol in symbols:
                    ledger.append({
                        "strategy_id": "Q102", "symbol": symbol, "decision_ts_ms": ts,
                        "status": "NOT_VERIFIABLE", "reason": reason,
                        "available_symbols": event.get("availableSymbols", []),
                        "available_high_vol": event.get("availableHighVol", []),
                        "data_cutoff_ms": ts, "source_runtime_sha": bridge.runtime_sha,
                    })
                continue

            items = list(snapshot.get("items") or [])
            if not items:
                ledger.append({
                    "strategy_id": "Q102", "symbol": "Q102_UNIVERSE", "decision_ts_ms": ts,
                    "status": "NO_SIGNAL",
                    "reason": snapshot.get("selectedReason") or "Q102_POINT_IN_TIME_UNIVERSE_NOT_READY",
                    "available_symbols": event.get("availableSymbols", []),
                    "available_high_vol": event.get("availableHighVol", []),
                    "selected_symbol": snapshot.get("selectedSymbol"),
                    "data_cutoff_ms": ts, "source_runtime_sha": bridge.runtime_sha,
                })
                continue

            exact_signal = event.get("signal") or {}
            for item in items:
                selected = bool(item.get("selected"))
                ref = item.get("referenceTs")
                row = {
                    "strategy_id": "Q102", "symbol": item["symbol"], "decision_ts_ms": ts,
                    "status": "SIGNAL" if selected else "CANDIDATE" if item.get("eligible") else "WAIT",
                    "item": item,
                    "signal": exact_signal if selected else None,
                    "selected_symbol": snapshot.get("selectedSymbol"),
                    "selected_reason": snapshot.get("selectedReason"),
                    "available_symbols": event.get("availableSymbols", []),
                    "available_high_vol": event.get("availableHighVol", []),
                    "data_cutoff_ms": min(ts, int(ref or ts)),
                    "source_runtime_sha": bridge.runtime_sha,
                }
                ledger.append(row)
                if selected:
                    selected_signals[(ts, str(item["symbol"]))] = signal_semantics(exact_signal) or {}

    require(not error_timestamps, f"Q102_CHUNK_RUNTIME_ERRORS:{error_timestamps[:10]}")
    require(all(int(row["data_cutoff_ms"]) <= int(row["decision_ts_ms"]) for row in ledger), "Q102_CHUNK_FUTURE_DATA")

    fast_rows = load_jsonl(fast_scan / "decisions" / "Q102.jsonl")
    fast_signals = {
        (int(row["decision_ts_ms"]), str(row["symbol"])): signal_semantics(row.get("signal")) or {}
        for row in fast_rows
        if row.get("status") == "SIGNAL" and start_ms <= int(row["decision_ts_ms"]) < end_exclusive_ms
    }
    require(set(fast_signals) == set(selected_signals), "Q102_CHUNK_FAST_FULL_SIGNAL_KEY_MISMATCH")
    economic_mismatches = [
        key for key in sorted(fast_signals)
        if canonical(economic_signal_semantics(fast_signals[key]))
        != canonical(economic_signal_semantics(selected_signals[key]))
    ]
    require(
        not economic_mismatches,
        f"Q102_CHUNK_FAST_FULL_SIGNAL_ECONOMIC_SEMANTIC_MISMATCH:{economic_mismatches[:5]}",
    )
    reference_ts_divergences = []
    for key in sorted(fast_signals):
        fast_ref = fast_signals[key].get("referenceTs")
        full_ref = selected_signals[key].get("referenceTs")
        if fast_ref == full_ref:
            continue
        require(
            allowed_fast_reference_ts_divergence(key, fast_signals[key], selected_signals[key]),
            f"Q102_CHUNK_UNEXPECTED_REFERENCE_TS_DIVERGENCE:{key}:{fast_ref}:{full_ref}",
        )
        reference_ts_divergences.append({
            "decision_ts_ms": key[0],
            "symbol": key[1],
            "fast_reference_ts": fast_ref,
            "full_reference_ts": full_ref,
            "data_cutoff_ts": selected_signals[key].get("dataCutoffTs"),
            "family": selected_signals[key].get("family"),
        })

    out = args.output_root.resolve()
    ledger_meta = write_jsonl(out / "Q102.full-observability.jsonl", ledger)
    manifest = {
        "schema_version": 1,
        "status": "PASS",
        "source_runtime_sha": source_manifest["runtime_sha"],
        "verified_repository_commit": source_manifest.get("verified_repository_commit"),
        "start": args.start.isoformat(),
        "end_exclusive": args.end_exclusive.isoformat(),
        "start_ms": start_ms,
        "end_exclusive_ms": end_exclusive_ms,
        "expected_hours": expected_hours,
        "decision_timestamps": expected_hours,
        "ledger_rows": len(ledger),
        "signal_rows": len(selected_signals),
        "fast_signal_rows": len(fast_signals),
        "fast_full_signal_key_parity": "PASS",
        "fast_full_signal_economic_semantic_parity": "PASS",
        "fast_full_reference_ts_parity": (
            "PASS" if not reference_ts_divergences
            else "KNOWN_FAST_SCAN_HIGH_VOL_REFERENCE_TS_DIVERGENCE"
        ),
        "fast_full_reference_ts_divergence_count": len(reference_ts_divergences),
        "fast_full_reference_ts_divergences": reference_ts_divergences,
        "runtime_error_timestamps": 0,
        "output": ledger_meta,
    }
    sha = write_json(out / "q102-chunk-manifest.json", manifest)
    print(canonical({
        "status": "PASS", "start": manifest["start"], "end_exclusive": manifest["end_exclusive"],
        "hours": expected_hours, "rows": len(ledger), "signals": len(selected_signals),
        "manifest_sha256": sha,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
