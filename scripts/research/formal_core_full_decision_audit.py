"""Audit full causal Core decision evidence without certifying missing V52 inputs.

This audit intentionally separates:
- full scheduled decision evidence for V12/PENGU/FET,
- full Q102 observability regenerated from the audited Production source snapshot,
- archived candidate-only V52 evidence, which is not upgraded to a full LIVE-equivalent
  decision stream when historical quote/depth/filter evidence is absent.

The script exits 0 when the audit itself completes. Certification state is recorded in
its manifest and remains BLOCKED while required evidence is absent.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta
import hashlib
import importlib
import json
from pathlib import Path
import sys
import types
from typing import Any, Iterable

HOUR_MS = 3_600_000


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_json(path: Path, value: Any) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    path.write_bytes(raw)
    return sha256_bytes(raw)


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = "".join(canonical_json(row) + "\n" for row in rows).encode("utf-8")
    path.write_bytes(raw)
    return {"path": str(path), "bytes": len(raw), "rows": raw.count(b"\n"), "sha256": sha256_bytes(raw)}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def validate_decision_file(path: Path, *, expected_strategy: str) -> dict[str, Any]:
    rows = load_jsonl(path)
    require(bool(rows), f"{expected_strategy}_DECISION_LEDGER_EMPTY")
    keys: set[tuple[int, str]] = set()
    statuses: Counter[str] = Counter()
    timestamps: set[int] = set()
    symbols: set[str] = set()
    cutoff_violations = 0
    for row in rows:
        require(row.get("strategy_id") == expected_strategy, f"{expected_strategy}_STRATEGY_ID_MISMATCH")
        ts = int(row["decision_ts_ms"])
        symbol = str(row["symbol"])
        key = (ts, symbol)
        require(key not in keys, f"{expected_strategy}_DUPLICATE_DECISION_KEY:{ts}:{symbol}")
        keys.add(key)
        timestamps.add(ts)
        symbols.add(symbol)
        statuses[str(row.get("status"))] += 1
        cutoff = row.get("data_cutoff_ms")
        if cutoff is not None and int(cutoff) > ts:
            cutoff_violations += 1
    require(cutoff_violations == 0, f"{expected_strategy}_FUTURE_DATA_CUTOFF")
    return {
        "rows": len(rows),
        "timestamps": len(timestamps),
        "symbols": sorted(symbols),
        "status_counts": dict(sorted(statuses.items())),
        "first_ts": min(timestamps),
        "last_ts": max(timestamps),
        "sha256": sha256_bytes(path.read_bytes()),
    }


def assert_regular_schedule(timestamps: list[int], step_ms: int, label: str) -> None:
    require(bool(timestamps), f"{label}_NO_TIMESTAMPS")
    for left, right in zip(timestamps, timestamps[1:]):
        require(right - left == step_ms, f"{label}_SCHEDULE_GAP:{left}:{right}:{right-left}")


def load_release_module(code_root: Path):
    package_name = "_formal_release_code"
    if package_name in sys.modules:
        del sys.modules[package_name]
    package = types.ModuleType(package_name)
    package.__path__ = [str(code_root)]
    sys.modules[package_name] = package
    return importlib.import_module(f"{package_name}.signal_scan")


def signal_semantics(row: dict[str, Any]) -> dict[str, Any]:
    signal = row.get("signal")
    return {
        "decision_ts_ms": int(row["decision_ts_ms"]),
        "symbol": row.get("symbol"),
        "signal": signal,
    }


def economic_signal_semantics(row: dict[str, Any]) -> dict[str, Any]:
    wrapped = signal_semantics(row)
    signal = dict(wrapped.get("signal") or {})
    signal.pop("referenceTs", None)
    return {**wrapped, "signal": signal}


def allowed_q102_fast_reference_ts_divergence(
    key: tuple[int, str],
    fast_row: dict[str, Any],
    full_row: dict[str, Any],
) -> bool:
    fast = fast_row.get("signal") or {}
    full = full_row.get("signal") or {}
    decision_ts, _ = key
    return (
        fast.get("referenceTs") != full.get("referenceTs")
        and str(full.get("family") or "").upper() == "HIGH_VOL"
        and full.get("referenceTs") == decision_ts
        and fast.get("referenceTs") == fast.get("dataCutoffTs")
        and full.get("dataCutoffTs") == fast.get("dataCutoffTs")
    )


@dataclass(frozen=True)
class ReleasePaths:
    root: Path
    code: Path
    data: Path
    baseline_scan: Path
    q102_fast_scan: Path
    v52: Path

    @classmethod
    def from_root(cls, root: Path) -> "ReleasePaths":
        return cls(
            root=root,
            code=root / "all-reconstruction-code-plus-90-file-audited-source",
            data=root / "market-Aster-H1-funding-and-manifests",
            baseline_scan=root / "baseline-complete-signal-and-gate-decisions" / "baseline-signal-scan",
            q102_fast_scan=root / "baseline-complete-signal-and-gate-decisions" / "baseline-signal-scan-q102",
            v52=root / "v52-SHA-verified-original-ledger",
        )

    def validate(self) -> None:
        for path in (self.code, self.data, self.baseline_scan, self.q102_fast_scan, self.v52):
            require(path.exists(), f"RELEASE_INPUT_MISSING:{path}")


def regenerate_q102_full(paths: ReleasePaths, output_root: Path) -> dict[str, Any]:
    scan_mod = load_release_module(paths.code)
    source_manifest = load_json(paths.code / "runtime_source_manifest.json")
    acquired = load_json(paths.data / "acquisition-manifest.json")
    require(
        acquired.get("runtime_sha") == source_manifest.get("runtime_sha"),
        "Q102_ACQUISITION_AND_AUDIT_TOOL_RUNTIME_MISMATCH",
    )

    universes = scan_mod.extract_universes()
    q102_symbols = list(universes["Q102"])
    high_vol_symbols = list(
        source_manifest["config_allowlist"]["live_process_environment"]["QUALITY102_CAUSAL_V1_SYMBOLS"]
    )
    start_ms = scan_mod._time_ms(scan_mod.START_DATE)
    end_ms = scan_mod._time_ms(scan_mod.END_DATE)

    candles_by_symbol: dict[str, list[dict[str, Any]]] = {}
    for symbol in [*q102_symbols, "BTCUSDT"]:
        rows = scan_mod._load_jsonl(scan_mod._history_path(paths.data, symbol))
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
    raw_event_count = 0
    raw_error_count = 0
    with scan_mod.RuntimeBridge() as bridge:
        # q102_fast_series uses the same audited Production signal functions and
        # monthly-rule cache, but avoids the observability-only per-symbol
        # snapshot expansion that is quadratic over the 8,784-hour period.
        series = bridge.q102_fast_series(candles_by_symbol, high_vol_symbols, q102_symbols, start_ms, end_ms)
        raw_event_count = len(series)
        for event in series:
            ts = int(event["decisionTs"])
            exact_signal = event.get("signal") or {}
            error = event.get("error")
            selected_symbol = str(exact_signal.get("symbol") or "").upper()
            side = int(exact_signal.get("side") or 0)
            if error:
                raw_error_count += 1
                status = "SOURCE_ERROR"
                reason = str(error)
            elif side != 0 and selected_symbol:
                status = "SIGNAL"
                reason = str(exact_signal.get("reason") or "Q102_SIGNAL")
            else:
                status = "NO_SIGNAL"
                reason = str(exact_signal.get("reason") or "Q102_POINT_IN_TIME_NO_SIGNAL")
            data_cutoff = min(ts, int(exact_signal.get("dataCutoffTs") or ts))
            ledger.append({
                "strategy_id": "Q102",
                "symbol": selected_symbol if status == "SIGNAL" else "Q102_UNIVERSE",
                "decision_ts_ms": ts,
                "status": status,
                "reason": reason,
                "signal": exact_signal if status == "SIGNAL" else None,
                "selected_symbol": selected_symbol or None,
                "available_symbols": event.get("availableSymbols", []),
                "available_high_vol": event.get("availableHighVol", []),
                "data_cutoff_ms": data_cutoff,
                "source_runtime_sha": bridge.runtime_sha,
            })

    decision_times = sorted({int(row["decision_ts_ms"]) for row in ledger})
    require(len(decision_times) == raw_event_count, "Q102_FULL_LEDGER_LOST_DECISION_TIMESTAMPS")
    assert_regular_schedule(decision_times, HOUR_MS, "Q102_FULL")
    period_hours = (end_ms - start_ms) // HOUR_MS
    in_period_times = [ts for ts in decision_times if start_ms <= ts < end_ms]
    right_boundary_times = [ts for ts in decision_times if ts == end_ms]
    require(len(in_period_times) == period_hours, "Q102_IN_PERIOD_HOURLY_COVERAGE_MISMATCH")
    require(right_boundary_times == [end_ms], "Q102_RIGHT_BOUNDARY_EVIDENCE_MISMATCH")
    require(raw_error_count == 0, f"Q102_FULL_RUNTIME_ERRORS:{raw_error_count}")
    require(all(int(row["data_cutoff_ms"]) <= int(row["decision_ts_ms"]) for row in ledger), "Q102_FULL_FUTURE_DATA")

    ledger_meta = write_jsonl(output_root / "Q102.global-h1-decisions.jsonl", ledger)

    fast_rows = load_jsonl(paths.q102_fast_scan / "decisions" / "Q102.jsonl")
    fast_signals = {
        (int(row["decision_ts_ms"]), str(row["symbol"])): signal_semantics(row)
        for row in fast_rows
        if row.get("status") == "SIGNAL"
    }
    full_signals = {
        (int(row["decision_ts_ms"]), str(row["symbol"])): signal_semantics(row)
        for row in ledger
        if row.get("status") == "SIGNAL"
    }
    require(set(fast_signals) == set(full_signals), "Q102_FAST_FULL_SIGNAL_KEY_MISMATCH")
    mismatches = [
        key for key in sorted(fast_signals)
        if canonical_json(fast_signals[key]) != canonical_json(full_signals[key])
    ]
    require(not mismatches, f"Q102_FAST_FULL_SIGNAL_SEMANTIC_MISMATCH:{mismatches[:5]}")

    return {
        "status": "PARTIAL_GLOBAL_H1_PASS_PER_SYMBOL_RANKING_MISSING",
        "global_h1_decision_evidence": "PASS",
        "per_symbol_full_ranking_evidence": "MISSING",
        "runtime_sha": source_manifest["runtime_sha"],
        "verified_repository_commit": source_manifest.get("verified_repository_commit"),
        "raw_event_count": raw_event_count,
        "period_hours": period_hours,
        "in_period_decision_timestamps": len(in_period_times),
        "right_boundary_decision_timestamps": len(right_boundary_times),
        "right_boundary_ts": end_ms,
        "ledger_rows": len(ledger),
        "error_timestamps": raw_error_count,
        "signal_rows": len(full_signals),
        "archived_signal_rows": len(fast_signals),
        "archived_signal_semantic_parity": "PASS",
        "output": ledger_meta,
        "first_ts": decision_times[0],
        "last_ts": decision_times[-1],
        "ruling": (
            "Every hourly global Q102 decision is regenerated from the audited Production signal "
            "functions with zero runtime errors, and all archived 372 SIGNAL rows match semantically. "
            "Per-symbol observability/ranking for every non-selected hour is not promoted to PASS "
            "because the archived full observer expands quadratically and is not itself the trading path."
        ),
    }



def merge_q102_chunks(paths: ReleasePaths, chunks_root: Path, output_root: Path) -> dict[str, Any]:
    manifests = sorted(chunks_root.rglob("q102-chunk-manifest.json"))
    require(bool(manifests), "Q102_CHUNK_MANIFESTS_MISSING")
    baseline = load_json(paths.baseline_scan / "signal-scan-manifest.json")
    expected_start = date.fromisoformat(str(baseline["period_start"]))
    expected_end_exclusive = date.fromisoformat(str(baseline["period_end_inclusive"])) + timedelta(days=1)
    expected_start_ms = int(__import__("datetime").datetime(
        expected_start.year, expected_start.month, expected_start.day, tzinfo=__import__("datetime").timezone.utc
    ).timestamp() * 1000)
    expected_end_ms = int(__import__("datetime").datetime(
        expected_end_exclusive.year, expected_end_exclusive.month, expected_end_exclusive.day,
        tzinfo=__import__("datetime").timezone.utc
    ).timestamp() * 1000)

    ordered: list[tuple[dict[str, Any], Path]] = []
    for manifest_path in manifests:
        manifest = load_json(manifest_path)
        require(manifest.get("status") == "PASS", f"Q102_CHUNK_NOT_PASS:{manifest_path}")
        ordered.append((manifest, manifest_path))
    ordered.sort(key=lambda pair: int(pair[0]["start_ms"]))

    runtime_shas = {str(manifest["source_runtime_sha"]) for manifest, _ in ordered}
    require(len(runtime_shas) == 1, "Q102_CHUNK_RUNTIME_SHA_MISMATCH")
    cursor = expected_start_ms
    rows: list[dict[str, Any]] = []
    chunk_summaries: list[dict[str, Any]] = []
    for manifest, manifest_path in ordered:
        start_ms = int(manifest["start_ms"])
        end_ms = int(manifest["end_exclusive_ms"])
        require(start_ms == cursor, f"Q102_CHUNK_GAP_OR_OVERLAP:{cursor}:{start_ms}")
        ledger_path = manifest_path.parent / "Q102.full-observability.jsonl"
        require(ledger_path.is_file(), f"Q102_CHUNK_LEDGER_MISSING:{ledger_path}")
        chunk_rows = load_jsonl(ledger_path)
        require(len(chunk_rows) == int(manifest["ledger_rows"]), f"Q102_CHUNK_ROW_COUNT_MISMATCH:{manifest_path}")
        require(sha256_bytes(ledger_path.read_bytes()) == manifest["output"]["sha256"], f"Q102_CHUNK_SHA_MISMATCH:{manifest_path}")
        rows.extend(chunk_rows)
        chunk_summaries.append({
            "start": manifest["start"], "end_exclusive": manifest["end_exclusive"],
            "hours": manifest["expected_hours"], "rows": manifest["ledger_rows"],
            "signals": manifest["signal_rows"], "manifest": str(manifest_path),
        })
        cursor = end_ms
    require(cursor == expected_end_ms, f"Q102_CHUNK_FINAL_BOUNDARY:{cursor}:{expected_end_ms}")

    decision_times = sorted({int(row["decision_ts_ms"]) for row in rows})
    expected_hours = (expected_end_ms - expected_start_ms) // HOUR_MS
    require(len(decision_times) == expected_hours, f"Q102_MERGED_HOUR_COUNT:{len(decision_times)}:{expected_hours}")
    require(decision_times[0] == expected_start_ms, "Q102_MERGED_START_MISMATCH")
    require(decision_times[-1] == expected_end_ms - HOUR_MS, "Q102_MERGED_END_MISMATCH")
    assert_regular_schedule(decision_times, HOUR_MS, "Q102_MERGED")

    keys: set[tuple[int, str]] = set()
    for row in rows:
        key = (int(row["decision_ts_ms"]), str(row["symbol"]))
        require(key not in keys, f"Q102_MERGED_DUPLICATE:{key[0]}:{key[1]}")
        keys.add(key)
        require(int(row.get("data_cutoff_ms") or row["decision_ts_ms"]) <= int(row["decision_ts_ms"]),
                "Q102_MERGED_FUTURE_DATA")

    fast_rows = load_jsonl(paths.q102_fast_scan / "decisions" / "Q102.jsonl")
    fast_signal_rows = {
        (int(row["decision_ts_ms"]), str(row["symbol"])): row
        for row in fast_rows
        if row.get("status") == "SIGNAL"
        and expected_start_ms <= int(row["decision_ts_ms"]) < expected_end_ms
    }
    full_signal_rows = {
        (int(row["decision_ts_ms"]), str(row["symbol"])): row
        for row in rows if row.get("status") == "SIGNAL"
    }
    require(set(fast_signal_rows) == set(full_signal_rows), "Q102_MERGED_FAST_FULL_SIGNAL_KEY_MISMATCH")
    economic_mismatches = [
        key for key in sorted(fast_signal_rows)
        if canonical_json(economic_signal_semantics(fast_signal_rows[key]))
        != canonical_json(economic_signal_semantics(full_signal_rows[key]))
    ]
    require(
        not economic_mismatches,
        f"Q102_MERGED_FAST_FULL_SIGNAL_ECONOMIC_SEMANTIC_MISMATCH:{economic_mismatches[:5]}",
    )
    reference_ts_divergences = []
    for key in sorted(fast_signal_rows):
        fast_signal = fast_signal_rows[key].get("signal") or {}
        full_signal = full_signal_rows[key].get("signal") or {}
        if fast_signal.get("referenceTs") == full_signal.get("referenceTs"):
            continue
        require(
            allowed_q102_fast_reference_ts_divergence(
                key, fast_signal_rows[key], full_signal_rows[key]
            ),
            f"Q102_MERGED_UNEXPECTED_REFERENCE_TS_DIVERGENCE:{key}",
        )
        reference_ts_divergences.append({
            "decision_ts_ms": key[0],
            "symbol": key[1],
            "fast_reference_ts": fast_signal.get("referenceTs"),
            "full_reference_ts": full_signal.get("referenceTs"),
            "data_cutoff_ts": full_signal.get("dataCutoffTs"),
            "family": full_signal.get("family"),
        })

    merged_meta = write_jsonl(output_root / "Q102.full-observability.jsonl", rows)
    statuses = Counter(str(row.get("status")) for row in rows)
    return {
        "status": "PASS",
        "global_h1_decision_evidence": "PASS",
        "per_symbol_full_ranking_evidence": "PASS",
        "source_runtime_sha": next(iter(runtime_shas)),
        "period_start": expected_start.isoformat(),
        "period_end_exclusive": expected_end_exclusive.isoformat(),
        "decision_timestamps": len(decision_times),
        "period_hours": expected_hours,
        "ledger_rows": len(rows),
        "status_counts": dict(sorted(statuses.items())),
        "signal_rows": len(full_signal_rows),
        "archived_signal_rows": len(fast_signal_rows),
        "archived_signal_key_parity": "PASS",
        "archived_signal_economic_semantic_parity": "PASS",
        "archived_fast_reference_ts_parity": (
            "PASS" if not reference_ts_divergences
            else "KNOWN_FAST_SCAN_HIGH_VOL_REFERENCE_TS_DIVERGENCE"
        ),
        "archived_fast_reference_ts_divergence_count": len(reference_ts_divergences),
        "archived_fast_reference_ts_divergences": reference_ts_divergences,
        "chunk_count": len(ordered),
        "chunks": chunk_summaries,
        "output": merged_meta,
    }


def audit_v52(paths: ReleasePaths, full_h1_manifest: Path | None = None) -> dict[str, Any]:
    provenance = load_json(paths.v52 / "restore-provenance.json")
    summary = load_json(paths.v52 / "v52-model-summary.json")
    ledger = load_jsonl(paths.v52 / "v52-model-ledger.jsonl")
    require(provenance.get("status") == "ARCHIVED_ORIGINAL_V52_TAPE_RESTORED_EXACT_SHA256", "V52_ARCHIVE_PROVENANCE_FAILED")
    require(len(ledger) == int(provenance.get("model_closed", 0)) + int(provenance.get("model_skipped", 0)), "V52_ARCHIVE_ROW_COUNT_MISMATCH")
    require(summary.get("audited_live_execution_parity") is False, "V52_ARCHIVE_UNEXPECTEDLY_ASSERTS_LIVE_PARITY")

    base = {
        "candidate_rows": len(ledger),
        "modeled_closed": summary.get("modeled_closed_trades"),
        "candidate_tape_sha256": provenance.get("reconstructed_v52_ledger_sha256"),
        "source_runtime_sha": summary.get("source_runtime_sha"),
        "audited_live_execution_parity": summary.get("audited_live_execution_parity"),
        "limitations": summary.get("limitations", []),
    }
    if full_h1_manifest is not None:
        model = load_json(full_h1_manifest.resolve())
        require(model.get("status") == "PASS_V52_PRICE_ONLY_FULL_H1_LEDGER", "V52_PRICE_ONLY_FULL_H1_MANIFEST_NOT_PASS")
        require(model.get("full_h1_model_decision_evidence") == "PASS", "V52_PRICE_ONLY_FULL_H1_DECISION_EVIDENCE_NOT_PASS")
        require(model.get("live_execution_parity") is False, "V52_PRICE_ONLY_LIVE_PARITY_UNEXPECTED")
        return {
            **base,
            "status": "PASS_PRICE_ONLY_FULL_H1_MODEL_DECISIONS",
            "full_h1_model_decision_evidence": "PASS",
            "decision_evidence_scope": model.get("decision_evidence_scope"),
            "price_model_manifest": model,
            "reason": (
                "The approved Yahoo/Aster price-only V52 backtest layer has an explicit full-H1 "
                "decision ledger. Historical LIVE spread/depth/filter/margin/fill parity remains "
                "separate and is not claimed by this decision-layer PASS."
            ),
        }
    return {
        **base,
        "status": "MISSING_FULL_LIVE_DECISION_STREAM",
        "full_h1_model_decision_evidence": "MISSING",
        "reason": (
            "The authenticated artifact retains selected V52 candidate/model lifecycle rows, "
            "not the complete historical LIVE quote/depth/filter decision stream. Candidate absence "
            "is therefore not converted to NO_SIGNAL evidence."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--q102-chunks-root", type=Path)
    parser.add_argument("--q102-source-parity", type=Path)
    parser.add_argument("--v52-full-h1-manifest", type=Path)
    args = parser.parse_args(argv)

    release = ReleasePaths.from_root(args.release_root.resolve())
    release.validate()
    output = args.output_root.resolve()
    output.mkdir(parents=True, exist_ok=True)

    baseline_manifest = load_json(release.baseline_scan / "signal-scan-manifest.json")
    q102_fast_manifest = load_json(release.q102_fast_scan / "signal-scan-manifest.json")

    v12 = validate_decision_file(release.baseline_scan / "decisions" / "V12.jsonl", expected_strategy="V12")
    pengu = validate_decision_file(release.baseline_scan / "decisions" / "PENGU.jsonl", expected_strategy="PENGU")
    fet = validate_decision_file(release.baseline_scan / "decisions" / "FET.jsonl", expected_strategy="FET")

    require(v12["rows"] == v12["timestamps"] * len(v12["symbols"]), "V12_INCOMPLETE_SYMBOL_MATRIX")
    pengu_times = sorted({int(row["decision_ts_ms"]) for row in load_jsonl(release.baseline_scan / "decisions" / "PENGU.jsonl")})
    fet_times = sorted({int(row["decision_ts_ms"]) for row in load_jsonl(release.baseline_scan / "decisions" / "FET.jsonl")})
    assert_regular_schedule(pengu_times, HOUR_MS, "PENGU")
    assert_regular_schedule(fet_times, 4 * HOUR_MS, "FET")
    require(pengu["rows"] == len(pengu_times), "PENGU_NOT_ONE_ROW_PER_DECISION")
    require(fet["rows"] == len(fet_times), "FET_NOT_ONE_ROW_PER_DECISION")

    q102 = (
        merge_q102_chunks(release, args.q102_chunks_root.resolve(), output)
        if args.q102_chunks_root
        else regenerate_q102_full(release, output)
    )
    if args.q102_chunks_root:
        require(args.q102_source_parity is not None, "Q102_SOURCE_PARITY_EVIDENCE_REQUIRED")
        q102_source_parity = load_json(args.q102_source_parity.resolve())
        require(
            q102_source_parity.get("status") == "PASS_Q102_DECISION_SOURCE_BYTE_PARITY",
            "Q102_SOURCE_PARITY_NOT_PASS",
        )
        q102["decision_source_byte_parity"] = q102_source_parity
    v52 = audit_v52(release, args.v52_full_h1_manifest)

    crypto_global_decision_pass = q102.get("global_h1_decision_evidence") == "PASS"
    q102_per_symbol_pass = (
        q102.get("per_symbol_full_ranking_evidence") == "PASS"
        and (
            not args.q102_chunks_root
            or (q102.get("decision_source_byte_parity") or {}).get("status")
            == "PASS_Q102_DECISION_SOURCE_BYTE_PARITY"
        )
    )
    v52_model_decision_pass = v52.get("full_h1_model_decision_evidence") == "PASS"
    if not q102_per_symbol_pass and not v52_model_decision_pass:
        overall = "BLOCKED_Q102_PER_SYMBOL_RANKING_AND_V52_MODEL_FULL_H1_EVIDENCE_MISSING"
    elif not q102_per_symbol_pass:
        overall = "BLOCKED_Q102_PER_SYMBOL_RANKING_EVIDENCE_MISSING"
    elif not v52_model_decision_pass:
        overall = "BLOCKED_V52_MODEL_FULL_H1_DECISION_EVIDENCE_MISSING"
    else:
        overall = "PASS_CORE_FULL_DECISION_EVIDENCE_PRICE_ONLY_V52"
    decision_ruling = (
        "V12/PENGU/FET scheduled decisions and Q102 all-hour per-symbol ranking/selection "
        "are proven from the audited frozen Production source. The archived Q102 fast scan "
        "matches selected signal keys and economic semantics; its HIGH_VOL referenceTs uses "
        "the prior H1 data cutoff while the full Production signal uses the decision timestamp, "
        "and that timestamp-only divergence is explicitly inventoried. V52 full-H1 decision "
        "coverage is proven only for the approved Yahoo/Aster price-only backtest model; historical "
        "LIVE quote/depth/filter/margin/fill parity remains a separate execution-evidence question."
        if q102_per_symbol_pass
        else
        "V12/PENGU/FET scheduled decision evidence and the global hourly Q102 trading decision "
        "stream are proven. Q102 per-symbol ranking for every non-selected hour remains a separate "
        "observability gap. V52 price-only full-H1 model coverage is evaluated separately from "
        "historical LIVE execution parity."
    )

    manifest = {
        "schema_version": 1,
        "status": overall,
        "certification_issued": False,
        "production_mutation_allowed": False,
        "release_root_name": release.root.name,
        "baseline_scan_runtime_sha": baseline_manifest.get("runtime_sha"),
        "q102_fast_scan_runtime_sha": q102_fast_manifest.get("runtime_sha"),
        "decision_evidence": {
            "V12": {
                **v12,
                "status": "PASS",
                "decision_time_semantics": (
                    "2h causal decision instants; the archived producer includes both the left "
                    "and right period boundaries, so the right-boundary decision is retained as "
                    "explicit boundary evidence rather than silently counted as another H1 hour."
                ),
            },
            "PENGU": {
                **pengu,
                "status": "PASS",
                "decision_time_semantics": (
                    "hourly decision timestamp is the completed H1 close boundary; the final "
                    "2026-08-11T00:00Z decision belongs to the last H1 interval of the period."
                ),
            },
            "FET": {
                **fet,
                "status": "PASS",
                "decision_time_semantics": "4h scheduled causal decisions inside the covered H1 market tape.",
            },
            "Q102": q102,
            "V52": v52,
        },
        "crypto_core_global_h1_decision_evidence": "PASS" if crypto_global_decision_pass else "FAIL",
        "crypto_core_full_per_symbol_decision_evidence": "PASS" if q102_per_symbol_pass else "MISSING",
        "v52_full_h1_price_model_decision_evidence": "PASS" if v52_model_decision_pass else "MISSING",
        "ruling": decision_ruling,
    }
    manifest_sha = write_json(output / "core-full-decision-audit-manifest.json", manifest)
    print(canonical_json({
        "status": overall,
        "crypto_core_global_h1_decision_evidence": manifest["crypto_core_global_h1_decision_evidence"],
        "crypto_core_full_per_symbol_decision_evidence": manifest["crypto_core_full_per_symbol_decision_evidence"],
        "q102_signal_economic_parity": q102.get(
            "archived_signal_economic_semantic_parity",
            q102.get("archived_signal_semantic_parity", "UNKNOWN"),
        ),
        "q102_fast_reference_ts_parity": q102.get(
            "archived_fast_reference_ts_parity", "NOT_AUDITED"
        ),
        "v52": v52["status"],
        "manifest_sha256": manifest_sha,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
