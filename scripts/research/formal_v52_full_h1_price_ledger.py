"""Build a complete hourly V52 price-model decision ledger.

This is intentionally a BACKTEST/MODEL decision layer, not historical LIVE execution
parity.  Every UTC H1 interval is represented exactly once.  The three V50 decision
windows on eligible NYSE sessions carry the full five-symbol price-only evaluation;
all other H1 intervals are explicit NO_SCHEDULE rows.  Yahoo/Aster source gaps remain
SOURCE_ERROR and are never silently converted to NO_SIGNAL.

The authenticated 99-row historical V52 candidate tape remains a separate historical
anchor.  Re-acquired Yahoo values are a new source-pinned baseline and never rewrite
that anchor.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
import hashlib
import importlib
import json
from pathlib import Path
import sys
import types
from typing import Any
from zoneinfo import ZoneInfo

HOUR_MS = 3_600_000
NY = ZoneInfo("America/New_York")
WINDOWS = (time(11, 30), time(12, 30), time(13, 30))
INITIAL_GAP_END = date(2025, 9, 29)


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_json(path: Path, value: Any) -> str:
    raw = (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return sha256_bytes(raw)


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    raw = "".join(canonical(row) + "\n" for row in rows).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return {"path": str(path), "rows": len(rows), "bytes": len(raw), "sha256": sha256_bytes(raw)}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def load_release_calendar(code_root: Path):
    package = "_formal_v52_h1_release"
    if package not in sys.modules:
        module = types.ModuleType(package)
        module.__path__ = [str(code_root)]
        sys.modules[package] = module
    return importlib.import_module(f"{package}.calendars")


def expected_windows(calendar: Any, start: date, end_exclusive: date) -> list[int]:
    output: list[int] = []
    day = start
    while day < end_exclusive:
        if day >= INITIAL_GAP_END and calendar.nyse_close_utc(day) is not None:
            for window in WINDOWS:
                entered = datetime.combine(day, window, NY).astimezone(timezone.utc)
                if calendar.is_nyse_core_open(entered):
                    output.append(int(entered.timestamp() * 1000))
        day += timedelta(days=1)
    return output


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", required=True, type=Path)
    parser.add_argument("--price-scan", required=True, type=Path)
    parser.add_argument("--price-source-audit", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--start", type=date.fromisoformat, default=date(2025, 8, 10))
    parser.add_argument("--end-exclusive", type=date.fromisoformat, default=date(2026, 8, 11))
    args = parser.parse_args(argv)

    release = args.release_root.resolve()
    code_root = release / "all-reconstruction-code-plus-90-file-audited-source"
    archived_root = release / "v52-SHA-verified-original-ledger"
    require(code_root.is_dir(), "V52_RELEASE_CODE_MISSING")
    require(archived_root.is_dir(), "V52_ARCHIVED_ANCHOR_MISSING")
    require(args.start < args.end_exclusive, "V52_BAD_PERIOD")

    price_scan = args.price_scan.resolve()
    source_audit_path = args.price_source_audit.resolve()
    require(price_scan.is_file(), "V52_PRICE_SCAN_MISSING")
    require(source_audit_path.is_file(), "V52_PRICE_SOURCE_AUDIT_MISSING")
    source_audit = load_json(source_audit_path)
    require(source_audit.get("price_scan_status") == "RESEARCH_PRICE_ONLY_NOT_LIVE_PARITY",
            "V52_PRICE_SCAN_SCOPE_MISMATCH")
    require(source_audit.get("live_execution_parity") is False, "V52_LIVE_PARITY_UNEXPECTED")
    require(
        source_audit.get("price_scan_decision_sha256") == sha256_bytes(price_scan.read_bytes()),
        "V52_PRICE_SCAN_SHA_MISMATCH",
    )

    calendar = load_release_calendar(code_root)
    expected = expected_windows(calendar, args.start, args.end_exclusive)
    expected_set = set(expected)

    scan_rows = load_jsonl(price_scan)
    by_decision: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in scan_rows:
        ts = int(row["decision_ts_ms"])
        by_decision[ts].append(row)

    unexpected_windows = sorted(set(by_decision) - expected_set)
    missing_windows = sorted(expected_set - set(by_decision))
    require(not unexpected_windows, f"V52_UNEXPECTED_DECISION_WINDOWS:{unexpected_windows[:5]}")

    for ts, rows in by_decision.items():
        symbols = {str(row["symbol"]).upper() for row in rows}
        require(len(rows) == 5 and len(symbols) == 5, f"V52_WINDOW_SYMBOL_MATRIX:{ts}:{len(rows)}:{len(symbols)}")

    start_dt = datetime(args.start.year, args.start.month, args.start.day, tzinfo=timezone.utc)
    end_dt = datetime(args.end_exclusive.year, args.end_exclusive.month, args.end_exclusive.day, tzinfo=timezone.utc)
    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = int(end_dt.timestamp() * 1000)
    expected_hours = (end_ms - start_ms) // HOUR_MS

    windows_by_hour: dict[int, list[int]] = defaultdict(list)
    for ts in expected:
        windows_by_hour[(ts // HOUR_MS) * HOUR_MS].append(ts)

    ledger: list[dict[str, Any]] = []
    status_counts: Counter[str] = Counter()
    source_error_windows = 0
    signal_windows = 0
    missing_window_hours = 0

    for hour_ms in range(start_ms, end_ms, HOUR_MS):
        hour_windows = sorted(windows_by_hour.get(hour_ms, []))
        if not hour_windows:
            row = {
                "strategy_id": "V52",
                "interval_open_ts_ms": hour_ms,
                "interval_close_ts_ms": hour_ms + HOUR_MS,
                "status": "NO_SCHEDULE",
                "reason": "V52_PRICE_MODEL_NO_DECISION_WINDOW_THIS_H1",
                "decision_model": "V52_PRICE_ONLY_BACKTEST_BASELINE",
                "live_execution_parity": False,
            }
            ledger.append(row)
            status_counts[row["status"]] += 1
            continue

        require(len(hour_windows) == 1, f"V52_MULTIPLE_WINDOWS_PER_H1:{hour_ms}:{hour_windows}")
        decision_ts = hour_windows[0]
        rows = by_decision.get(decision_ts)
        if not rows:
            missing_window_hours += 1
            row = {
                "strategy_id": "V52",
                "interval_open_ts_ms": hour_ms,
                "interval_close_ts_ms": hour_ms + HOUR_MS,
                "decision_ts_ms": decision_ts,
                "status": "SOURCE_ERROR",
                "reason": "V52_EXPECTED_PRICE_MODEL_WINDOW_MISSING",
                "decision_model": "V52_PRICE_ONLY_BACKTEST_BASELINE",
                "live_execution_parity": False,
            }
            ledger.append(row)
            status_counts[row["status"]] += 1
            source_error_windows += 1
            continue

        selected = [row for row in rows if row.get("status") == "PRICE_ONLY_MODEL_SELECTED_UNALLOCATED"]
        source_errors = [
            row for row in rows
            if "MISSING_CAUSAL_PRICE_INPUT" in list(row.get("reasons") or [])
        ]
        if selected:
            status = "SIGNAL"
            signal_windows += 1
        elif source_errors:
            status = "SOURCE_ERROR"
            source_error_windows += 1
        else:
            status = "WAIT"

        symbol_rows = []
        for item in sorted(rows, key=lambda value: str(value["symbol"])):
            symbol_rows.append({
                "symbol": item["symbol"],
                "status": item.get("status"),
                "side": item.get("side"),
                "entry_basis_bps": item.get("entry_basis_bps"),
                "capture_basis_bps": item.get("capture_basis_bps"),
                "reasons": item.get("reasons") or [],
                "gates": item.get("gates") or {},
                "data_cutoff_ms": max(
                    int(item.get("asof", {}).get("capture", {}).get("yahoo_end_ms") or 0),
                    int(item.get("asof", {}).get("capture", {}).get("aster_end_ms") or 0),
                    int(item.get("asof", {}).get("entry", {}).get("yahoo_end_ms") or 0),
                    int(item.get("asof", {}).get("entry", {}).get("aster_end_ms") or 0),
                ),
            })

        row = {
            "strategy_id": "V52",
            "interval_open_ts_ms": hour_ms,
            "interval_close_ts_ms": hour_ms + HOUR_MS,
            "decision_ts_ms": decision_ts,
            "status": status,
            "reason": (
                "V52_PRICE_MODEL_SELECTED"
                if selected else
                "V52_PRICE_MODEL_SOURCE_ERROR"
                if source_errors else
                "V52_PRICE_MODEL_NO_SELECTION"
            ),
            "selected_symbol": selected[0]["symbol"] if selected else None,
            "selected_side": selected[0].get("side") if selected else None,
            "decision_model": "V52_PRICE_ONLY_BACKTEST_BASELINE",
            "symbol_decisions": symbol_rows,
            "live_execution_parity": False,
        }
        ledger.append(row)
        status_counts[status] += 1

    require(len(ledger) == expected_hours, f"V52_H1_ROW_COUNT:{len(ledger)}:{expected_hours}")
    require(all(
        int(right["interval_open_ts_ms"]) - int(left["interval_open_ts_ms"]) == HOUR_MS
        for left, right in zip(ledger, ledger[1:])
    ), "V52_H1_SCHEDULE_GAP")

    archived_provenance = load_json(archived_root / "restore-provenance.json")
    archived_summary = load_json(archived_root / "v52-model-summary.json")
    output_root = args.output_root.resolve()
    ledger_meta = write_jsonl(output_root / "V52.price-only-full-h1.jsonl", ledger)

    status = (
        "PASS_V52_PRICE_ONLY_FULL_H1_LEDGER"
        if not missing_windows and not unexpected_windows
        else "FAIL_V52_PRICE_ONLY_EXPECTED_WINDOW_COVERAGE"
    )
    manifest = {
        "schema_version": 1,
        "status": status,
        "decision_evidence_scope": "PRICE_ONLY_BACKTEST_MODEL",
        "full_h1_model_decision_evidence": "PASS" if status.startswith("PASS_") else "FAIL",
        "live_execution_parity": False,
        "certification_issued": False,
        "period_start": args.start.isoformat(),
        "period_end_exclusive": args.end_exclusive.isoformat(),
        "period_hours": expected_hours,
        "ledger_rows": len(ledger),
        "status_counts": dict(sorted(status_counts.items())),
        "expected_price_windows": len(expected),
        "observed_price_windows": len(by_decision),
        "missing_expected_windows": missing_windows,
        "unexpected_windows": unexpected_windows,
        "signal_windows": signal_windows,
        "source_error_windows": source_error_windows,
        "missing_window_hours": missing_window_hours,
        "price_scan_sha256": sha256_bytes(price_scan.read_bytes()),
        "price_source_audit_sha256": sha256_bytes(source_audit_path.read_bytes()),
        "price_source_audit_status": source_audit.get("status"),
        "yahoo_common_missing_session_days": source_audit.get("common_missing_session_days", []),
        "historical_anchor": {
            "status": archived_provenance.get("status"),
            "candidate_rows": int(archived_provenance.get("model_closed", 0)) + int(archived_provenance.get("model_skipped", 0)),
            "candidate_tape_sha256": archived_provenance.get("reconstructed_v52_ledger_sha256"),
            "audited_live_execution_parity": archived_summary.get("audited_live_execution_parity"),
        },
        "output": ledger_meta,
        "ruling": (
            "This ledger proves complete H1 coverage for the approved Yahoo/Aster price-only V52 "
            "backtest model.  Current Yahoo re-acquisition is source-pinned and explicit source gaps "
            "remain SOURCE_ERROR.  The authenticated historical 99-row tape remains a separate anchor. "
            "Neither artifact claims historical LIVE spread/depth/filter/margin/fill parity."
        ),
    }
    manifest_sha = write_json(output_root / "v52-price-only-full-h1-manifest.json", manifest)
    print(canonical({
        "status": status,
        "period_hours": expected_hours,
        "expected_price_windows": len(expected),
        "observed_price_windows": len(by_decision),
        "signal_windows": signal_windows,
        "source_error_windows": source_error_windows,
        "manifest_sha256": manifest_sha,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
