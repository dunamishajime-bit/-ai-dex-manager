"""Deterministic integrated replay runner with fail-closed fill qualification.

The runner deliberately separates production-signal candidates from orders and
verified fills. It emits a full scenario decision log even when missing
execution data prevents a defensible P&L result.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
import gzip
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping
from zoneinfo import ZoneInfo

from .calendars import NYSE_SOURCE_URL, is_nyse_core_open, nyse_close_utc
from .datasets import load_aster_dataset, load_fred_fx
from .l2_archive import decode_zstd_parquet
from .manifest import load_manifest
from .portfolio import monthly_deposit_events
from .scenarios import select_execution_conditions
from .yahoo_v52 import STOCKS, load_v52_signal_scan, load_yahoo_bars, model_v52_signal
from .v52_research_bridge import load_price_only_research


PERIOD_START = datetime(2025, 8, 10, tzinfo=timezone.utc)
PERIOD_END_EXCLUSIVE = datetime(2026, 8, 11, tzinfo=timezone.utc)
INITIAL_GAP_END = datetime(2025, 9, 29, tzinfo=timezone.utc)
STRATEGIES = ("V12", "PENGU", "Q102", "FET", "V52")
SCENARIOS = (("NORMAL", "PROXY_APPLIED"), ("SEVERE", "PROXY_APPLIED"),
             ("NORMAL", "ASTER_DATA_ONLY"), ("SEVERE", "ASTER_DATA_ONLY"))
_NY = ZoneInfo("America/New_York")


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def _read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as source:
        for line_no, line in enumerate(source, 1):
            if line.strip():
                row = json.loads(line)
                if not isinstance(row, dict):
                    raise ValueError(f"JSONL_ROW_NOT_OBJECT:{path.name}:{line_no}")
                yield row


def _write_jsonl_gz(path: Path, rows: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0, compresslevel=9) as compressed:
            count = 0
            for row in rows:
                compressed.write(_json_bytes(dict(row)))
                count += 1
    contents = path.read_bytes()
    return {"path": path.name, "rows": count, "bytes": len(contents), "sha256": _sha(contents)}


def _load_signal_rows(scan_root: Path) -> tuple[dict[str, list[dict[str, Any]]], dict[str, str]]:
    layout = {
        "V12": scan_root / "baseline-signal-scan" / "decisions" / "V12.jsonl",
        "PENGU": scan_root / "baseline-signal-scan" / "decisions" / "PENGU.jsonl",
        "FET": scan_root / "baseline-signal-scan" / "decisions" / "FET.jsonl",
        "Q102": scan_root / "baseline-signal-scan-q102" / "decisions" / "Q102.jsonl",
    }
    rows: dict[str, list[dict[str, Any]]] = {}
    hashes: dict[str, str] = {}
    for strategy, path in layout.items():
        if not path.is_file():
            raise FileNotFoundError(f"SIGNAL_SCAN_MISSING:{strategy}")
        rows[strategy] = list(_read_jsonl(path))
        hashes[strategy] = _sha(path.read_bytes())
    return rows, hashes


def _load_signal_scan_manifests(scan_root: Path) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    manifests: dict[str, dict[str, Any]] = {}
    hashes: dict[str, str] = {}
    for name in ("baseline-signal-scan", "baseline-signal-scan-q102"):
        path = scan_root / name / "signal-scan-manifest.json"
        if path.is_file():
            raw = path.read_bytes()
            manifests[name] = json.loads(raw)
            hashes[name] = _sha(raw)
    return manifests, hashes


def _inventory_l2(l2_root: Path) -> tuple[list[dict[str, Any]], dict[tuple[str, str, int], dict[str, Any]]]:
    inventory: list[dict[str, Any]] = []
    lookup: dict[tuple[str, str, int], dict[str, Any]] = {}
    if not l2_root.is_dir():
        return inventory, lookup
    for path in sorted(l2_root.rglob("*_orderbook.parquet.zst")):
        venue = path.parents[2].name
        symbol = path.name.removesuffix("_orderbook.parquet.zst")
        relative_path = path.relative_to(l2_root).as_posix()
        try:
            dt_hour = datetime.strptime(path.parents[1].name + "T" + path.parent.name, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
            hour_ms = int(dt_hour.timestamp() * 1000)
        except ValueError:
            inventory.append({"file": path.name, "status": "NOT_VERIFIABLE", "reason": "ARCHIVE_PATH_TIME_INVALID"})
            continue
        protocol = "bybit_v5" if venue == "bybit" else "binance_diff"
        try:
            check = decode_zstd_parquet(path, expected_symbol=symbol, sequence_protocol=protocol)
            record = {
                "venue": venue, "symbol": symbol, "hour_start_ms": hour_ms,
                "path": relative_path, "sha256": _sha(path.read_bytes()),
                "bytes": path.stat().st_size, "sequence_protocol": protocol,
                "status": check.status, "rows": check.rows, "event_groups": check.event_groups,
                "snapshots": check.snapshots, "updates": check.updates,
                "issue_counts": dict(Counter(issue.code for issue in check.issues)),
            }
        except Exception as error:
            record = {
                "venue": venue, "symbol": symbol, "hour_start_ms": hour_ms,
                "path": relative_path, "sha256": _sha(path.read_bytes()),
                "bytes": path.stat().st_size, "sequence_protocol": protocol,
                "status": "NOT_VERIFIABLE", "rows": 0, "event_groups": 0,
                "snapshots": 0, "updates": 0, "issue_counts": {"ARCHIVE_DECODE_FAILED": 1},
                "error_code": type(error).__name__,
            }
        inventory.append(record)
        lookup[(venue, symbol, hour_ms)] = record
    return inventory, lookup


def _dataset_coverage(data_root: Path) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    acquired = json.loads((data_root / "acquisition-manifest.json").read_text(encoding="utf-8"))
    universe = sorted({symbol for values in acquired.get("universes", {}).values() for symbol in values})
    coverage: list[dict[str, Any]] = []
    by_symbol: dict[str, dict[str, Any]] = {}
    for symbol in universe:
        dataset = load_aster_dataset(data_root, symbol)
        blocking = [issue for issue in dataset.issues if issue.blocking]
        item = {
            "source": "ASTER", "native_instrument": symbol,
            "contract_type": "linear_perpetual", "bar_interval_ms": 3_600_000,
            "first_bar_ms": dataset.bars[0].event_time_ms if dataset.bars else None,
            "last_bar_ms": dataset.bars[-1].event_time_ms if dataset.bars else None,
            "bar_count": len(dataset.bars), "funding_count": len(dataset.funding),
            "normalized_sha256": dataset.normalized_sha256,
            "status": "VERIFIED" if not blocking else "NOT_VERIFIABLE",
            "blocking_issue_counts": dict(Counter(issue.code for issue in blocking)),
            "blocking_issues": [{"code": issue.code, "event_time_ms": issue.event_time_ms, "detail": issue.detail} for issue in blocking],
            "nonblocking_issue_counts": dict(Counter(issue.code for issue in dataset.issues if not issue.blocking)),
        }
        coverage.append(item)
        by_symbol[symbol] = item
    return coverage, by_symbol


def _candidate_time(strategy: str, row: Mapping[str, Any]) -> int:
    if strategy == "V12":
        return int((row.get("signal") or {}).get("entryTs") or row.get("decision_ts_ms") or 0)
    if strategy == "FET":
        return int((row.get("signal") or {}).get("entryTs") or row.get("decision_ts_ms") or 0)
    return int(row.get("decision_ts_ms") or 0)


def _scenario_candidate(
    strategy: str,
    row: Mapping[str, Any],
    *,
    scenario: str,
    coverage_path: str,
    archive_lookup: Mapping[tuple[str, str, int], Mapping[str, Any]],
) -> dict[str, Any]:
    entry_time = _candidate_time(strategy, row)
    initial_gap = entry_time < int(INITIAL_GAP_END.timestamp() * 1000)
    symbol = str(row.get("symbol") or "")
    # A signal is only a candidate at this stage. LIVE positions, cooldown,
    # allocator competition, and order lifecycle have not been opened because
    # no historical book/fee contract is verified for this event.
    hourly = entry_time // 3_600_000 * 3_600_000
    available = []
    for venue in (("bybit", "binance_futures", "okx_futures") if initial_gap else ("aster_futures",)):
        for candidate_hour in (hourly, hourly - 3_600_000):
            item = archive_lookup.get((venue, symbol, candidate_hour))
            if item and item.get("status") == "VERIFIED":
                available.append(item)
    if initial_gap and coverage_path == "ASTER_DATA_ONLY":
        selected = select_execution_conditions([], scenario=scenario, coverage_path=coverage_path,
                                               decision_time_ms=entry_time, aster_data_available=False,
                                               initial_gap=True)
        execution_status, execution_reason = selected.status, selected.reason
    elif not available:
        execution_status = "NOT_VERIFIABLE"
        if initial_gap:
            execution_reason = "NO_VALID_PROXY_SNAPSHOT_SEQUENCE_FOR_CANDIDATE_TIME"
        else:
            execution_reason = "NO_VALID_ASTER_SNAPSHOT_SEQUENCE_FOR_CANDIDATE_TIME"
    else:
        # A sequence-valid historical book is still insufficient without a
        # decoded depth snapshot, contemporaneous Aster basis, and the
        # historical Aster crypto commission tier. Never infer those values.
        execution_status = "NOT_VERIFIABLE"
        execution_reason = "VALID_BOOK_DEPTH_AND_ASTER_FEE_BASIS_NOT_YET_RECONSTRUCTED"
    return {
        "candidate_signal": True,
        "entry_time_ms": entry_time,
        "initial_50_day_gap": initial_gap,
        "scenario_execution_status": execution_status,
        "scenario_execution_reason": execution_reason,
        "valid_matching_l2_archives": len(available),
        "fill_status": "NOT_FILLED_OR_SKIPPED",
        "realized_pnl_usdt": None,
        "realized_pnl_status": "NOT_VERIFIABLE",
    }


def _decision_row(strategy: str, source_row: Mapping[str, Any], *, scenario: str, coverage_path: str,
                  archive_lookup: Mapping[tuple[str, str, int], Mapping[str, Any]]) -> dict[str, Any]:
    row = dict(source_row)
    candidate = row.get("status") == "SIGNAL"
    row["strategy_id"] = strategy
    row["candidate_signal"] = candidate
    row["execution_scenario"] = scenario
    row["coverage_path"] = coverage_path
    if candidate:
        row["execution"] = _scenario_candidate(strategy, row, scenario=scenario,
                                               coverage_path=coverage_path, archive_lookup=archive_lookup)
        row["status"] = "ORDER_CANDIDATE_NOT_FILLED"
    elif row.get("status") == "NOT_VERIFIABLE":
        row["execution"] = {"candidate_signal": False, "scenario_execution_status": "NOT_VERIFIABLE",
                            "scenario_execution_reason": row.get("reason", "LIVE_DECISION_NOT_VERIFIABLE"),
                            "realized_pnl_usdt": None}
    elif row.get("status") == "NO_CANDIDATE_METRICS":
        row["execution"] = {"candidate_signal": False, "scenario_execution_status": "NOT_VERIFIABLE",
                            "scenario_execution_reason": "LIVE_TRACE_DID_NOT_EXPOSE_REQUIRED_CANDIDATE_METRICS",
                            "realized_pnl_usdt": None}
    else:
        row["execution"] = {"candidate_signal": False, "scenario_execution_status": "NO_ORDER_CANDIDATE",
                            "scenario_execution_reason": row.get("runtime_reason", "LIVE_GATES_DID_NOT_EMIT_ORDER_INTENT"),
                            "realized_pnl_usdt": None}
    return row


def _v52_decisions(start: datetime, end: datetime, *, scenario: str, coverage_path: str) -> Iterator[dict[str, Any]]:
    # Exact candidate-entry schedules from the audited V52 dispatcher.
    schedules = (
        ("V11_EQ", "SIGNAL_CAPTURE", time(10, 0)),
        ("V11_EQ", "ENTRY_GATE", time(10, 30)),
        ("V50_POST_OPEN_BASIS", "SIGNAL_CAPTURE", time(11, 29, 50)),
        ("V50_POST_OPEN_BASIS", "ENTRY_GATE", time(11, 30)),
        ("V50_POST_OPEN_BASIS", "SIGNAL_CAPTURE", time(12, 29, 50)),
        ("V50_POST_OPEN_BASIS", "ENTRY_GATE", time(12, 30)),
        ("V50_POST_OPEN_BASIS", "SIGNAL_CAPTURE", time(13, 29, 50)),
        ("V50_POST_OPEN_BASIS", "ENTRY_GATE", time(13, 30)),
    )
    symbols = ("AMZN", "META", "MSFT", "NVDA", "TSLA")
    day = start.astimezone(_NY).date()
    end_day = (end - timedelta(milliseconds=1)).astimezone(_NY).date()
    while day <= end_day:
        if day.weekday() < 5 and nyse_close_utc(day) is not None:
            for route, phase, local_time in schedules:
                local_dt = datetime.combine(day, local_time, _NY)
                utc_dt = local_dt.astimezone(timezone.utc)
                timestamp_ms = int(utc_dt.timestamp() * 1000)
                if not (int(start.timestamp() * 1000) <= timestamp_ms < int(end.timestamp() * 1000)):
                    continue
                is_entry = phase == "ENTRY_GATE"
                session_ok = is_nyse_core_open(utc_dt) if is_entry else is_nyse_core_open(utc_dt)
                early_closed = not session_ok
                initial_gap = utc_dt < INITIAL_GAP_END
                if initial_gap:
                    status, reason = "SKIPPED", "INITIAL_50_DAY_HAS_NO_VERIFIED_STOCK_PERP_PROXY"
                elif not session_ok:
                    status, reason = "SKIPPED", "NYSE_OFFICIAL_SESSION_OR_EARLY_CLOSE_BLOCK"
                else:
                    status, reason = "NOT_VERIFIABLE", "HISTORICAL_ASTER_STOCK_PERP_BOOK_AND_REFERENCE_QUOTE_NOT_VERIFIED"
                for symbol in symbols:
                    yield {
                        "strategy_id": "V52", "route": route, "symbol": symbol + "USDT",
                        "equity_reference_symbol": symbol, "phase": phase,
                        "decision_ts_ms": timestamp_ms, "execution_scenario": scenario,
                        "coverage_path": coverage_path, "status": status, "reason": reason,
                        "initial_50_day_gap": initial_gap, "early_close_block": early_closed,
                        "gates": {
                            "NYSE_SESSION": "PASS" if session_ok else "FAIL",
                            "ASTER_STOCK_PERP_LISTING": "UNVERIFIED",
                            "ASTER_HISTORICAL_L2": "UNVERIFIED",
                            "REFERENCE_QUOTE_IEX": "UNVERIFIED",
                            "LIVE_CANDIDATE_BASIS_COST_DEPTH": "NOT_REACHED",
                            "ORDER_SUBMIT": "BLOCKED" if (status != "NOT_VERIFIABLE" or not is_entry) else "NOT_REACHED",
                        },
                        "data_cutoff_ms": timestamp_ms,
                        "realized_pnl_usdt": None,
                    }
        day += timedelta(days=1)


def _metric_row(strategy: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    statuses = Counter(str(row.get("execution", {}).get("scenario_execution_status", "")) for row in rows)
    signals = sum(row.get("candidate_signal") is True for row in rows)
    not_verified = sum(row.get("status") == "NOT_VERIFIABLE" for row in rows)
    return {
        "strategy_id": strategy,
        "decision_rows": len(rows),
        "signal_candidates": signals,
        "fills_verified": 0,
        "closed_trades_verified": 0,
        "final_equity_usdt": None,
        "net_profit_usdt": None,
        "profit_factor": None,
        "maximum_drawdown_pct": None,
        "win_rate_pct": None,
        "metric_status": "NOT_VERIFIABLE",
        "reason_counts": dict(statuses),
    }


def run_integrated_bt(data_root: str | Path, scan_root: str | Path, l2_root: str | Path,
                      output_root: str | Path, *,
                      v52_yahoo_root: str | Path | None = None,
                      v52_signal_file: str | Path | None = None,
                      v52_research_scan_root: str | Path | None = None) -> dict[str, Any]:
    data_root = Path(data_root).resolve()
    scan_root = Path(scan_root).resolve()
    l2_root = Path(l2_root).resolve()
    output_root = Path(output_root).resolve()
    runtime_manifest_path = Path(__file__).with_name("runtime_source_manifest.json")
    runtime_manifest = load_manifest(runtime_manifest_path)
    acquisition_path = data_root / "acquisition-manifest.json"
    if not acquisition_path.is_file():
        raise FileNotFoundError("ACQUISITION_MANIFEST_MISSING")
    acquisition = json.loads(acquisition_path.read_text(encoding="utf-8"))
    if acquisition.get("runtime_sha") != runtime_manifest["runtime_sha"]:
        raise ValueError("ACQUISITION_RUNTIME_SHA_MISMATCH")

    signal_rows, signal_hashes = _load_signal_rows(scan_root)
    coverage, coverage_by_symbol = _dataset_coverage(data_root)
    fx_series, fx_issues = load_fred_fx(data_root)
    deposits = monthly_deposit_events(fx_series) if not fx_issues else ()
    l2_inventory, l2_lookup = _inventory_l2(l2_root)

    # Price-only V52 is a separate user-requested RESEARCH execution model.
    # The baseline still requires exchange-verified fills to report final P&L.
    v52_scan = Path(v52_signal_file).resolve() if v52_signal_file else (
        scan_root / "baseline-signal-scan-v52" / "decisions" / "V52.jsonl")
    v52_signal_rows: list[dict[str, Any]] = []
    v52_signal_hash: str | None = None
    v52_scan_status = "NOT_VERIFIABLE_NO_AUDITED_V52_SIGNAL_SCAN"
    if v52_scan.is_file():
        try:
            v52_signal_rows, v52_signal_hash = load_v52_signal_scan(
                v52_scan, runtime_manifest["runtime_sha"])
            v52_scan_status = "AUDITED_RUNTIME_SHA_MATCH"
        except (ValueError, json.JSONDecodeError) as error:
            v52_scan_status = f"NOT_VERIFIABLE:{error}"

    yahoo_root = (Path(v52_yahoo_root).resolve() if v52_yahoo_root
                  else data_root / "normalized" / "yahoo" / "60m")
    yahoo_bars: dict[str, tuple[Any, ...]] = {}
    yahoo_file_hashes: dict[str, str] = {}
    yahoo_status: dict[str, str] = {}
    for equity in sorted(STOCKS):
        file = yahoo_root / f"{equity}.jsonl"
        if not file.is_file():
            yahoo_bars[equity] = ()
            yahoo_status[equity] = "NOT_VERIFIABLE_MISSING_YAHOO_60M"
            continue
        yahoo_file_hashes[equity] = _sha(file.read_bytes())
        try:
            yahoo_bars[equity] = load_yahoo_bars(file, equity)
            yahoo_status[equity] = ("AVAILABLE_ASOF_PRICE_ONLY"
                                    if yahoo_bars[equity] else "NOT_VERIFIABLE_EMPTY_YAHOO_60M")
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
            yahoo_bars[equity] = ()
            yahoo_status[equity] = f"NOT_VERIFIABLE:{error}"

    scan_manifests, scan_manifest_hashes = _load_signal_scan_manifests(scan_root)
    if any(manifest.get("runtime_sha") != runtime_manifest["runtime_sha"] for manifest in scan_manifests.values()):
        raise ValueError("SIGNAL_SCAN_RUNTIME_SHA_MISMATCH")

    source_hashes = {
        "runtime_source_manifest_sha256": _sha(runtime_manifest_path.read_bytes()),
        "acquisition_manifest_sha256": _sha(acquisition_path.read_bytes()),
        "signal_scan_manifests": scan_manifest_hashes,
        "signal_logs": signal_hashes,
        "l2_files": {item["path"]: item["sha256"] for item in l2_inventory if item.get("sha256")},
        "v52_live_signal_scan": v52_signal_hash,
        "yahoo_60m_files": yahoo_file_hashes,
    }
    run_id = _sha(_json_bytes({"period_start": PERIOD_START.isoformat(), "period_end_exclusive": PERIOD_END_EXCLUSIVE.isoformat(),
                               "runtime_sha": runtime_manifest["runtime_sha"], "source_hashes": source_hashes}))[:24]
    output_root.mkdir(parents=True, exist_ok=True)

    decisions_by_strategy = {
        strategy: signal_rows.get(strategy, []) for strategy in ("V12", "PENGU", "Q102", "FET")
    }
    input_candidate_counts = {
        strategy: sum(row.get("status") == "SIGNAL" for row in rows)
        for strategy, rows in decisions_by_strategy.items()
    }
    initial_gap_counts = {
        strategy: sum(row.get("status") == "SIGNAL" and _candidate_time(strategy, row) < int(INITIAL_GAP_END.timestamp() * 1000)
                      for row in rows)
        for strategy, rows in decisions_by_strategy.items()
    }

    scenario_summaries = []
    output_inventory: dict[str, Any] = {}
    monthly_by_key: dict[tuple[str, str, str], Counter] = defaultdict(Counter)
    order_rows_count = 0
    for scenario, coverage_path in SCENARIOS:
        scenario_id = f"{scenario}_{coverage_path}"
        scenario_dir = output_root / scenario_id
        scenario_dir.mkdir(parents=True, exist_ok=True)
        all_decisions: list[dict[str, Any]] = []
        order_rows: list[dict[str, Any]] = []
        route_metrics = []
        for strategy in ("V12", "PENGU", "Q102", "FET"):
            rows = [_decision_row(strategy, row, scenario=scenario, coverage_path=coverage_path, archive_lookup=l2_lookup)
                    for row in decisions_by_strategy[strategy]]
            all_decisions.extend(rows)
            route_metrics.append(_metric_row(strategy, rows))
            for row in rows:
                entry = row.get("execution", {})
                if row.get("candidate_signal"):
                    order = {
                        "run_id": run_id, "scenario_id": scenario_id, "strategy_id": strategy,
                        "symbol": row.get("symbol"), "side": (row.get("signal") or {}).get("side") or row.get("side"),
                        "signal_ts_ms": row.get("decision_ts_ms"), "entry_ts_ms": entry.get("entry_time_ms"),
                        "order_type": "LIVE_ORDER_TYPE_REQUIRES_ROUTE_REPLAY",
                        "intent_status": "ORDER_CANDIDATE_NOT_ALLOCATED",
                        "fill_status": entry.get("scenario_execution_status"),
                        "reason": entry.get("scenario_execution_reason"),
                        "l2_valid_file_count": entry.get("valid_matching_l2_archives", 0),
                        "fee_bps": None, "slippage_bps": None, "funding_usdt": None,
                        "realized_pnl_usdt": None, "ledger_status": "NOT_VERIFIABLE",
                    }
                    order_rows.append(order)
                    ts = int(row.get("decision_ts_ms") or 0)
                    month = datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m")
                    monthly_by_key[(scenario_id, strategy, month)]["signal_candidates"] += 1
                    monthly_by_key[(scenario_id, strategy, month)]["fills_verified"] += 0
                elif row.get("status") == "NOT_VERIFIABLE":
                    monthly_by_key[(scenario_id, strategy, datetime.fromtimestamp(int(row.get("decision_ts_ms") or 0) / 1000, timezone.utc).strftime("%Y-%m"))]["decision_not_verifiable"] += 1

        v52_rows = list(_v52_decisions(PERIOD_START, PERIOD_END_EXCLUSIVE, scenario=scenario, coverage_path=coverage_path))
        all_decisions.extend(v52_rows)
        v52_price_model_statuses: Counter = Counter()
        v52_actual_candidates = 0
        v52_modeled_entries = 0
        for live_row in v52_signal_rows:
            if live_row.get("status") != "SIGNAL":
                continue
            v52_actual_candidates += 1
            equity = str(live_row.get("equity_reference_symbol") or live_row.get("symbol") or "").upper().removesuffix("USDT")
            modeled = model_v52_signal(live_row, yahoo_bars.get(equity, ()))
            v52_price_model_statuses[modeled["status"]] += 1
            v52_modeled_entries += modeled["status"] == "MODELED_PRICE_FILL"
            modeled_row = dict(live_row)
            modeled_row.update({
                "strategy_id": "V52", "execution_scenario": scenario,
                "coverage_path": coverage_path, "status": "PRICE_MODEL_" + modeled["status"],
                "execution": modeled, "candidate_signal": True,
                "realized_pnl_usdt": None, "ledger_status": "MODELED_ENTRY_ONLY_EXIT_UNVERIFIED",
            })
            all_decisions.append(modeled_row)
            order_rows.append({
                "run_id": run_id, "scenario_id": scenario_id, "strategy_id": "V52",
                "route": modeled.get("route"), "symbol": modeled_row.get("symbol"),
                "signal_ts_ms": modeled.get("decision_ts_ms"),
                "entry_ts_ms": modeled.get("decision_ts_ms"),
                "order_type": "MODELED_IMMEDIATE_AT_YAHOO_60M_COMPLETED_CLOSE",
                "intent_status": "AUDITED_V52_SIGNAL_PRICE_MODEL_ONLY",
                "fill_status": modeled["status"], "modeled_price_usd": modeled.get("price_usd"),
                "price_bar_end_ms": modeled.get("price_bar_end_ms"),
                "price_source_sha256": modeled.get("price_source_sha256"),
                "fee_bps": None, "slippage_bps": None, "funding_usdt": None,
                "realized_pnl_usdt": None, "ledger_status": "MODELED_ONLY_NOT_VENUE_VERIFIED",
            })
            if modeled.get("decision_ts_ms"):
                month = datetime.fromtimestamp(modeled["decision_ts_ms"] / 1000, timezone.utc).strftime("%Y-%m")
                monthly_by_key[(scenario_id, "V52_" + str(modeled.get("route")), month)]["audited_signal_candidates"] += 1
                monthly_by_key[(scenario_id, "V52_" + str(modeled.get("route")), month)]["yahoo_modeled_entries"] += (
                    modeled["status"] == "MODELED_PRICE_FILL")
        route_metrics.append({
            "strategy_id": "V52", "decision_rows": len(v52_rows) + v52_actual_candidates,
            "signal_candidates": v52_actual_candidates if v52_scan_status == "AUDITED_RUNTIME_SHA_MATCH" else None,
            "price_model_entries": v52_modeled_entries,
            "price_model_statuses": dict(v52_price_model_statuses),
            "fills_verified": 0, "closed_trades_verified": 0,
            "final_equity_usdt": None, "net_profit_usdt": None, "profit_factor": None,
            "maximum_drawdown_pct": None, "win_rate_pct": None,
            "metric_status": "NOT_VERIFIABLE",
            "reason_counts": dict(Counter(row["status"] for row in v52_rows)),
        })
        for row in v52_rows:
            month = datetime.fromtimestamp(row["decision_ts_ms"] / 1000, timezone.utc).strftime("%Y-%m")
            monthly_by_key[(scenario_id, row["route"], month)]["scheduled_checks"] += 1
            monthly_by_key[(scenario_id, row["route"], month)]["fills_verified"] += 0
        # V52 price-only research is not an audited LIVE signal or an allocated fill.
        v52_research_info: dict[str, Any] = {"status": "NOT_SUPPLIED", "selection_count": 0}
        if v52_research_scan_root is not None:
            try:
                research_rows, v52_research_info = load_price_only_research(
                    Path(v52_research_scan_root), runtime_manifest["runtime_sha"])
            except (ValueError, OSError, KeyError, TypeError) as error:
                research_rows = []
                v52_research_info = {"status": "NOT_VERIFIABLE", "reason": str(error)[:160], "selection_count": 0}
            for research_row in research_rows:
                research_row.update(execution_scenario=scenario, coverage_path=coverage_path)
                all_decisions.append(research_row)
                month = datetime.fromtimestamp(research_row["decision_ts_ms"] / 1000, timezone.utc).strftime("%Y-%m")
                monthly_by_key[(scenario_id, "V52_V50_PRICE_RESEARCH", month)]["research_unallocated_candidates"] += 1
        all_decisions.sort(key=lambda row: (int(row.get("decision_ts_ms") or 0), str(row.get("strategy_id") or ""), str(row.get("symbol") or "")))
        decision_file = _write_jsonl_gz(scenario_dir / "decision-gates.jsonl.gz", all_decisions)
        order_rows.sort(key=lambda row: (row["signal_ts_ms"] or 0, row["strategy_id"], row["symbol"] or ""))
        order_file = _write_jsonl_gz(scenario_dir / "order-ledger.jsonl.gz", order_rows)
        order_rows_count += len(order_rows)
        summary = {
            "scenario_id": scenario_id, "scenario": scenario, "coverage_path": coverage_path,
            "status": "NOT_VERIFIABLE", "metric_semantics": "NULL_METRICS_ARE_UNAVAILABLE_NOT_ZERO_RETURNS",
            "initial_gap_start": PERIOD_START.isoformat(), "initial_gap_end_exclusive": INITIAL_GAP_END.isoformat(),
            "initial_gap_candidate_signals": initial_gap_counts,
            "initial_gap_fills_verified": 0,
            "initial_gap_pnl_usdt": None,
            "contributed_jpy": deposits[-1].cumulative_jpy if deposits else 130_000,
            "contributed_usdt_asof_fx": round(deposits[-1].cumulative_usdt, 8) if deposits else None,
            "final_equity_usdt": None, "net_profit_usdt": None, "profit_factor": None,
            "maximum_drawdown_pct": None, "win_rate_pct": None,
            "verified_fills": 0, "verified_closed_trades": 0,
            "candidate_signals": {**input_candidate_counts, "V52": v52_actual_candidates if v52_scan_status == "AUDITED_RUNTIME_SHA_MATCH" else None},
            "v52_hourly_price_research": v52_research_info,
            "v52_yahoo_price_model": {
                "status": "RESEARCH_MODELED_NOT_VERIFIED",
                "signal_scan_status": v52_scan_status,
                "audited_signal_candidates": v52_actual_candidates,
                "modeled_entries": v52_modeled_entries,
                "modeled_entry_statuses": dict(v52_price_model_statuses),
                "price_data_status": yahoo_status,
                "verified_fills": 0, "closed_trade_pnl_usdt": None,
                "assumption": "User-requested decision-time fill at as-of Yahoo 60m completed close; no book requirement; no verified Aster execution",
            },
            "decision_rows": len(all_decisions), "order_ledger_rows": len(order_rows),
            "strategy_metrics": route_metrics,
            "variants": {"status": "NOT_RUN_BASELINE_NOT_VERIFIED", "hc_gross_multiplier_fixed": 1.75},
            "outputs": {"decision_gates": decision_file, "order_ledger": order_file},
        }
        scenario_path = scenario_dir / "scenario-metrics.json"
        scenario_path.write_bytes(json.dumps(summary, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False).encode("utf-8") + b"\n")
        summary["outputs"]["scenario_metrics"] = {"path": scenario_path.name, "sha256": _sha(scenario_path.read_bytes()), "bytes": scenario_path.stat().st_size}
        output_inventory[scenario_id] = summary["outputs"]
        scenario_summaries.append(summary)

    monthly_rows = []
    for (scenario_id, strategy, month), metrics in sorted(monthly_by_key.items()):
        monthly_rows.append({
            "scenario_id": scenario_id, "strategy_id": strategy, "month_utc": month,
            **dict(metrics), "realized_pnl_usdt": None, "equity_usdt": None,
            "profit_factor": None, "max_drawdown_pct": None,
            "metric_status": "NOT_VERIFIABLE_NO_COMPLETE_EXECUTION_LEDGER",
        })
    monthly_path = output_root / "monthly-metrics.jsonl.gz"
    monthly_record = _write_jsonl_gz(monthly_path, monthly_rows)

    coverage_path = output_root / "data-coverage.json"
    coverage_doc = {
        "status": "ACQUIRED_REQUIRES_ROUTE_SPECIFIC_VALIDATION",
        "runtime_sha": runtime_manifest["runtime_sha"],
        "sources": {
            "aster_api": "https://asterdex.github.io/aster-api-website/futures-v3/market-data/",
            "binance_api": "https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md?plain=1",
            "bybit_v5_orderbook": "https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook",
            "nyse_calendar": NYSE_SOURCE_URL,
            "fred_dexjpus": "https://fred.stlouisfed.org/series/DEXJPUS",
            "yahoo_60m": "https://query1.finance.yahoo.com/v8/finance/chart/",
        },
        "symbols": coverage,
        "fx": {"source": "FRED DEXJPUS", "observations": len(fx_series), "blocking_issues": [issue.code for issue in fx_issues],
               "status": "VERIFIED" if not fx_issues and fx_series else "NOT_VERIFIABLE"},
        "l2_archives": l2_inventory,
        "v52_price_only_research": {
            "signal_scan_status": v52_scan_status,
            "yahoo_symbols": yahoo_status,
            "yahoo_input_sha256": yahoo_file_hashes,
            "execution_model": "YAHOO_60M_COMPLETED_CLOSE_PRICE_ONLY",
            "price_fills_are_verified_aster_fills": False,
        },
    }
    coverage_path.write_bytes(json.dumps(coverage_doc, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False).encode("utf-8") + b"\n")
    deposit_path = output_root / "contribution-events.jsonl"
    deposit_path.write_bytes(b"".join(_json_bytes({
        "timestamp_ms": row.timestamp_ms, "amount_jpy": row.amount_jpy, "amount_usdt": round(row.amount_usdt, 8),
        "fx_rate_jpy_per_usd": row.fx_rate_jpy_per_usd, "fx_timestamp_ms": row.fx_timestamp_ms,
        "fx_sha256": row.fx_sha256, "cumulative_jpy": row.cumulative_jpy,
        "cumulative_usdt": round(row.cumulative_usdt, 8),
    }) for row in deposits))

    top_level = {
        "schema_version": 1, "run_id": run_id,
        "status": "NOT_VERIFIABLE",
        "status_reason": "Candidate signals were replayed from the audited LIVE functions, but verified same-time execution books, historical Aster crypto fee tiers, and V52 stock-perpetual book/reference parity are incomplete. No P&L is reported.",
        "runtime_sha": runtime_manifest["runtime_sha"],
        "audited_release_id": runtime_manifest["active_release_id"],
        "period_start_utc": PERIOD_START.isoformat(),
        "period_end_inclusive_utc": "2026-08-10",
        "period_end_exclusive_utc": PERIOD_END_EXCLUSIVE.isoformat(),
        "initial_gap_end_exclusive_utc": INITIAL_GAP_END.isoformat(),
        "starting_capital_jpy": 10_000, "monthly_contribution_jpy": 10_000,
        "monthly_contribution_count": 12, "total_contributions_jpy": 130_000,
        "contribution_event_count": len(deposits),
        "source_hashes": source_hashes,
        "signal_scan_manifests": scan_manifest_hashes,
        "data_coverage_sha256": _sha(coverage_path.read_bytes()),
        "contribution_events_sha256": _sha(deposit_path.read_bytes()),
        "monthly_metrics": monthly_record,
        "data_coverage": {"path": coverage_path.name, "sha256": _sha(coverage_path.read_bytes()), "bytes": coverage_path.stat().st_size},
        "contribution_events": {"path": deposit_path.name, "sha256": _sha(deposit_path.read_bytes()), "bytes": deposit_path.stat().st_size},
        "order_ledger_rows_across_scenarios": order_rows_count,
        "scenarios": scenario_summaries,
        "outputs": output_inventory,
        "limitations": [
            "Aster 1h/funding data was normalized and integrity-checked per native instrument; BTCUSDT includes one invalid OHLC row and RENDERUSDT includes one candle before the verified listing timestamp.",
            "The Q102 LIVE selector returns invalid-candle or insufficient-walk-forward-history errors for the entire tested decision stream; no Q102 order was emitted.",
            "The tested Binance Futures, Bybit, and Aster historical L2 candidate files have no verified event chain seeded by a valid snapshot. Missing event files are not presumed fillable.",
            "Historical crypto commission tier was not available in the audited LIVE config; actual Aster stock-perpetual history/reference quote parity for V52 was not verified.",
            "V12 variants were not run because the unchanged integrated baseline did not reach a verified fill/ledger state; HC1.75 remains fixed for later research.",
            "No trade counts, P&L, profit factor, drawdown, or win rate in this status should be interpreted as zero-return or as investment evidence.",
        ],
    }
    top_path = output_root / "run-manifest.json"
    report_path = output_root / "formal-bt-report.md"
    report_path.write_text(render_report(top_level, coverage_doc), encoding="utf-8")
    top_level["outputs"]["report"] = {"path": report_path.name, "sha256": _sha(report_path.read_bytes()), "bytes": report_path.stat().st_size}
    top_path.write_bytes(json.dumps(top_level, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False).encode("utf-8") + b"\n")
    return top_level


def render_report(manifest: Mapping[str, Any], coverage: Mapping[str, Any]) -> str:
    issue_symbols = [row for row in coverage["symbols"] if row["status"] != "VERIFIED"]
    lines = [
        "# Formal V12 / PENGU / Q102 / FET / V52 Backtest",
        "",
        f"- Run ID: `{manifest['run_id']}`",
        f"- Status: **{manifest['status']}**",
        f"- Runtime SHA: `{manifest['runtime_sha']}` (release `{manifest['audited_release_id']}`)",
        f"- Period: {manifest['period_start_utc']} through 2026-08-10 UTC inclusive",
        f"- Contributions: ¥{manifest['starting_capital_jpy']:,} initial + ¥{manifest['monthly_contribution_jpy']:,} × {manifest['monthly_contribution_count']} = ¥{manifest['total_contributions_jpy']:,}",
        "",
        "## Result interpretation",
        "",
        "The audited LIVE decision functions were replayed and their emitted signals retained, but the integration did not produce verified completed fills. The final asset value, profit, PF, max DD, and win rate are **null / NOT_VERIFIABLE**, not zero. These runs are not valid performance estimates.",
        "",
        "## Signal candidates and four required paths",
        "",
        "| Scenario | Status | Candidates | Verified fills | Profit | PF | Max DD |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]
    for row in manifest["scenarios"]:
        candidate_total = sum(int(value) for value in row["candidate_signals"].values())
        lines.append(f"| {row['scenario_id']} | {row['status']} | {candidate_total} | {row['verified_fills']} | — | — | — |")
    lines.extend([
        "",
        "Each signal count is a LIVE-function candidate, not a trade count: shared position-state, cooldown, and allocator allocation have not been converted into filled orders because no candidate passed historical execution-data verification.",
        "",
        "V12: " + str(manifest["scenarios"][0]["candidate_signals"].get("V12", 0))
        + "; PENGU: " + str(manifest["scenarios"][0]["candidate_signals"].get("PENGU", 0))
        + "; Q102: " + str(manifest["scenarios"][0]["candidate_signals"].get("Q102", 0))
        + "; FET: " + str(manifest["scenarios"][0]["candidate_signals"].get("FET", 0))
        + " signal candidates were returned by the scan.",
        "",
        "## Coverage findings",
        "",
        f"Aster instrument H1/funding streams checked: {len(coverage['symbols'])} symbols. Blocking data-quality symbols: "
        + (", ".join(f"{row['native_instrument']} ({row['blocking_issue_counts']})" for row in issue_symbols) if issue_symbols else "none"),
        f"FRED DEXJPUS rows: {coverage['fx']['observations']} ({coverage['fx']['status']}).",
        f"L2 candidate files checked: {len(coverage['l2_archives'])}; verified full snapshot/sequence files: "
        f"{sum(row.get('status') in {'VERIFIED', 'VERIFIED_PROXY_RESEARCH'} for row in coverage['l2_archives'])}.",
        "",
        "### Initial 50-day comparison",
        "",
        "- `ASTER_DATA_ONLY`: initial-gap entry candidates are explicitly SKIPPED because verified Aster order-book snapshots are unavailable.",
        "- `PROXY_APPLIED`: the exact candidate-time Binance/Bybit/Aster archive samples tested did not provide a complete verified book snapshot/update chain, so they remain NOT_VERIFIABLE and are not applied as fills.",
        "- Initial-gap candidate counts are in the run manifest. Initial-gap P&L remains null; an omitted or unfilled event is not treated as a zero return.",
        "- V52 is omitted in the gap in both paths; after it, stock-equity quotes cannot replace an Aster stock-perpetual execution book.",
        "",
        "## V52 runtime schedule",
        "",
        "The audited V52 dispatcher checks V11_EQ at 10:30 New York time after its 10:00 reference capture, and V50_POST_OPEN_BASIS at 11:30, 12:30, and 13:30 after a 10-second pre-window capture. Official NYSE closures and early closes are applied. Historical Aster stock-perpetual book/listing and same-provider reference quotes are still unverified, so each schedule row remains gate-level NOT_VERIFIABLE or skipped.",
        "",
        "### User-requested Yahoo Finance 60-minute price-only model",
        "",
        "A confirmed historical V52 signal can receive a MODELED_PRICE_FILL at the last completed same-session Yahoo hourly close. This model does not require historical order books. It does not assert an actual Aster fill or finished trade, and missing/stale price data blocks its hypothetical entry.",
        f"Audited V52 signal scan: {manifest['scenarios'][0].get('v52_yahoo_price_model', {}).get('signal_scan_status', 'NOT_SUPPLIED')}; Yahoo modeled entries: {manifest['scenarios'][0].get('v52_yahoo_price_model', {}).get('modeled_entries', 0)}; Aster-verified V52 fills: 0.",
        "",
        "## V12 variants",
        "",
        "Not run. The unchanged baseline did not reach a verified execution/ledger state, so comparing looser gates would turn candidate signals into unsupported performance claims. HC gross multiplier remains fixed at 1.75.",
        "",
        "## Reasons baseline is not verifiable",
        "",
    ])
    lines.extend(f"- {reason}" for reason in manifest["limitations"])
    lines.extend([
        "",
        "## Re-run",
        "",
        "Run `python -m research.formal_five_bt.engine --data-root <local-data> --scan-root <local-signal-scans> --l2-root <local-l2> --output-root <local-output>`. Raw market data and the resulting data-bearing logs/reports are local-only and excluded from the public GitHub push.",
        "",
    ])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--scan-root", required=True)
    parser.add_argument("--l2-root", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--v52-yahoo-root", help="Local normalized Yahoo 60m JSONL directory; defaults to data-root/normalized/yahoo/60m")
    parser.add_argument("--v52-signal-file", help="Audited V52 decision scan JSONL; scanner manifest must have matching runtime SHA")
    parser.add_argument("--v52-research-scan-root", help="Optional SHA-verified V52 1h price-only research output; not audited LIVE signals")
    args = parser.parse_args(argv)
    result = run_integrated_bt(args.data_root, args.scan_root, args.l2_root, args.output_root,
                               v52_yahoo_root=args.v52_yahoo_root, v52_signal_file=args.v52_signal_file,
                               v52_research_scan_root=args.v52_research_scan_root)
    print(json.dumps({"status": result["status"], "run_id": result["run_id"], "scenarios": [row["scenario_id"] for row in result["scenarios"]],
                      "outputs": list(result["outputs"]), "candidate_signals": result["scenarios"][0]["candidate_signals"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
