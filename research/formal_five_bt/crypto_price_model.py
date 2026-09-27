"""Causal H1 price-model trade candidates for the four crypto strategies.

This module converts audited strategy SIGNAL rows into candidate entry/exit
lifecycles using only Aster H1 OHLC/funding available in the frozen run.  It is
an explicit bar-price model, not proof of historical order-book execution.

Candidate generation deliberately does not apply the shared portfolio allocator:
that is a later chronological stage.  No candidate outcome may be used to
decide whether that candidate is allocated.
"""
from __future__ import annotations

from bisect import bisect_left
from collections import Counter, defaultdict
from datetime import datetime, timezone
import argparse
import json
import math
from pathlib import Path
from typing import Any, Iterable

from .strategies import RuntimeBridge

HOUR = 3_600_000
PERIOD_START_MS = int(datetime(2025, 8, 10, tzinfo=timezone.utc).timestamp() * 1000)
PERIOD_END_MS = int(datetime(2026, 8, 11, tzinfo=timezone.utc).timestamp() * 1000)

# Audited SHA-matched production constants.  Tests compare the formulas against
# the restored TypeScript source functions to prevent silent drift.
V12_STOP_ATR = 2.477
V12_TP_ATR = 3.1995
V12_TRAIL_ATR = 0.4
V12_MAX_HOLD_2H = 23
V12_REBALANCE_2H = 20
V12_RISK_PCT = 0.0319
V12_PER_POSITION_CAP = 1.0
V12_RANK3_CAP = 0.10
FET_MAX_GROSS = 2.25
FET_STOP = 0.05
FET_FLOOR_TRIGGER = 0.05
FET_FLOOR_STOP = 0.005
FET_HOLD_HOURS = 24
Q102_TRAIL_TRIGGER = 0.12
Q102_TRAIL_DISTANCE = 0.05


def _rows(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise FileNotFoundError(path)
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _bars(data_root: Path, symbol: str) -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]]]:
    rows = _rows(data_root / "normalized/aster/klines" / f"{symbol}.jsonl")
    rows.sort(key=lambda row: int(row["event_time_ms"]))
    by_ts = {int(row["event_time_ms"]): row for row in rows}
    if len(by_ts) != len(rows):
        raise ValueError(f"DUPLICATE_ASTER_H1:{symbol}")
    previous = None
    for row in rows:
        ts = int(row["event_time_ms"])
        values = [float(row[k]) for k in ("open", "high", "low", "close")]
        if (previous is not None and ts <= previous) or not all(math.isfinite(v) and v > 0 for v in values):
            raise ValueError(f"INVALID_ASTER_H1:{symbol}:{ts}")
        if values[1] < max(values[0], values[3]) or values[2] > min(values[0], values[3]):
            raise ValueError(f"INVALID_ASTER_OHLC:{symbol}:{ts}")
        previous = ts
    return rows, by_ts


def _funding(data_root: Path, symbol: str) -> list[tuple[int, float]]:
    path = data_root / "normalized/aster/funding" / f"{symbol}.jsonl"
    if not path.is_file():
        return []
    out = []
    for row in _rows(path):
        ts, rate = int(row["event_time_ms"]), float(row["funding_rate"])
        if math.isfinite(rate):
            out.append((ts, rate))
    return sorted(out)


def _funding_return_per_gross(
    observations: list[tuple[int, float]], side: str, entry_ts: int, exit_ts: int,
    *, partial_ts: int | None = None, remaining_fraction: float = 1.0,
) -> float:
    """Account return for gross=1; positive means funding credit.

    A funding event exactly at the entry timestamp is excluded because H1 data
    cannot establish whether the modeled entry preceded that settlement.
    """
    sign = -1.0 if side == "LONG" else 1.0
    value = 0.0
    for ts, rate in observations:
        if entry_ts < ts <= exit_ts:
            fraction = remaining_fraction if partial_ts is not None and ts > partial_ts else 1.0
            value += sign * rate * fraction
    return value


def _direction(side: str) -> float:
    if side == "LONG":
        return 1.0
    if side == "SHORT":
        return -1.0
    raise ValueError(f"BAD_SIDE:{side}")


def _v12_primary_map(rows: list[dict[str, Any]]) -> dict[int, tuple[str, str]]:
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get("status") != "SIGNAL" or not isinstance(row.get("signal"), dict):
            continue
        signal = row["signal"]
        grouped[int(signal["entryTs"])].append(row)
    output = {}
    for ts, candidates in grouped.items():
        ranked = sorted(candidates, key=lambda row: (
            int((row["signal"] or {}).get("rank") or 99), str(row.get("symbol"))))
        first = ranked[0]
        output[ts] = (str(first["symbol"]), str(first["signal"]["side"]))
    return output


def _v12_outcome(
    row: dict[str, Any], by_ts: dict[int, dict[str, Any]],
    primary: dict[int, tuple[str, str]],
) -> dict[str, Any]:
    signal = row["signal"]
    symbol = str(row["symbol"])
    side = str(signal["side"])
    entry_ts = int(signal["entryTs"])
    entry_bar = by_ts.get(entry_ts)
    base = {
        "strategy_id": "V12", "symbol": symbol, "side": side, "entry_ts_ms": entry_ts,
        "signal_ts_ms": int(row["decision_ts_ms"]), "source_runtime_sha": row.get("source_runtime_sha"),
        "rank": int(signal.get("rank") or 0), "entry_quality_class": signal.get("entryQualityClass"),
    }
    if not entry_bar:
        return {**base, "status": "UNRESOLVED_ENTRY_BAR"}
    entry = float(entry_bar["open"])
    atr = float(signal["atr"])
    if not (entry > 0 and atr > 0):
        return {**base, "status": "UNRESOLVED_ENTRY_OR_ATR"}
    stop_distance = max(atr * V12_STOP_ATR, entry * 0.005)
    tp_distance = atr * V12_TP_ATR
    stop = entry - stop_distance if side == "LONG" else entry + stop_distance
    target = entry + tp_distance if side == "LONG" else entry - tp_distance
    trail_distance = atr * V12_TRAIL_ATR
    peak, trough = entry, entry
    multiplier = float(signal.get("entryGrossMultiplier") or 1.0)
    requested = min(V12_RISK_PCT / (stop_distance / entry), 1.0) * multiplier
    requested = min(requested, V12_RANK3_CAP if int(signal.get("rank") or 0) == 3 else V12_PER_POSITION_CAP)
    ambiguous = False
    for holding in range(1, V12_MAX_HOLD_2H + 1):
        block_start = entry_ts + (holding - 1) * 2 * HOUR
        block_rows = [by_ts.get(block_start), by_ts.get(block_start + HOUR)]
        if any(bar is None for bar in block_rows):
            return {**base, "status": "UNRESOLVED_EXIT_BAR", "entry_price": entry,
                    "requested_gross": requested, "unresolved_ts_ms": block_start}
        for bar in block_rows:
            assert bar is not None
            high, low = float(bar["high"]), float(bar["low"])
            stop_hit = low <= stop if side == "LONG" else high >= stop
            target_hit = high >= target if side == "LONG" else low <= target
            if stop_hit or target_hit:
                ambiguous = stop_hit and target_hit
                exit_price = stop if stop_hit else target
                exit_reason = "V12_STOP_AMBIGUOUS" if ambiguous else "V12_STOP" if stop_hit else "V12_TAKE_PROFIT"
                exit_ts = int(bar["event_time_ms"]) + HOUR
                return {
                    **base, "status": "MODELED_CLOSED_TRADE", "entry_price": entry,
                    "exit_price": exit_price, "exit_ts_ms": exit_ts, "exit_reason": exit_reason,
                    "requested_gross": requested, "unit_price_return": _direction(side) * (exit_price / entry - 1),
                    "ambiguous_bar": ambiguous,
                }
        block_high = max(float(bar["high"]) for bar in block_rows if bar)
        block_low = min(float(bar["low"]) for bar in block_rows if bar)
        peak, trough = max(peak, block_high), min(trough, block_low)
        trailing = peak - trail_distance if side == "LONG" else trough + trail_distance
        stop = max(stop, trailing) if side == "LONG" else min(stop, trailing)
        boundary = block_start + 2 * HOUR
        changed = primary.get(boundary) not in {None, (symbol, side)}
        if holding >= V12_MAX_HOLD_2H or (holding >= V12_REBALANCE_2H and changed):
            boundary_bar = by_ts.get(boundary)
            if boundary_bar:
                exit_price = float(boundary_bar["open"])
                exit_ts = boundary
            else:
                exit_price = float(block_rows[-1]["close"])
                exit_ts = boundary
            reason = "V12_MAX_HOLD" if holding >= V12_MAX_HOLD_2H else "V12_SIGNAL_ROTATION"
            return {
                **base, "status": "MODELED_CLOSED_TRADE", "entry_price": entry,
                "exit_price": exit_price, "exit_ts_ms": exit_ts, "exit_reason": reason,
                "requested_gross": requested, "unit_price_return": _direction(side) * (exit_price / entry - 1),
                "ambiguous_bar": False,
            }
    return {**base, "status": "UNRESOLVED_V12_LIFECYCLE", "entry_price": entry, "requested_gross": requested}


def _q102_outcome(row: dict[str, Any], by_ts: dict[int, dict[str, Any]]) -> dict[str, Any]:
    signal = row.get("signal") or {}
    item = row.get("item") or {}
    symbol = str(row["symbol"])
    side = "LONG" if int(signal.get("side") or (1 if item.get("side") == "LONG" else -1)) > 0 else "SHORT"
    entry_ts = int(signal.get("referenceTs") or row["decision_ts_ms"])
    base = {
        "strategy_id": "Q102", "symbol": symbol, "side": side, "entry_ts_ms": entry_ts,
        "signal_ts_ms": int(row["decision_ts_ms"]), "source_runtime_sha": row.get("source_runtime_sha"),
        "family": signal.get("family") or item.get("family"), "variant": signal.get("variant") or item.get("variant"),
        "exit_policy": signal.get("exitPolicy"),
    }
    bar = by_ts.get(entry_ts)
    hard = signal.get("hardStop")
    hold = int(signal.get("maxHoldHours") or 72)
    requested = float(signal.get("requestedGross") or item.get("requestedGross") or 0)
    if not bar or hard is None or not (0 < float(hard) < 1) or requested <= 0:
        return {**base, "status": "UNRESOLVED_Q102_ENTRY_METADATA"}
    entry = float(bar["open"])
    stop = entry * (1 - float(hard)) if side == "LONG" else entry * (1 + float(hard))
    best = entry
    trail_active = False
    for offset in range(hold):
        ts = entry_ts + offset * HOUR
        current = by_ts.get(ts)
        if current is None:
            return {**base, "status": "UNRESOLVED_EXIT_BAR", "entry_price": entry,
                    "requested_gross": requested, "unresolved_ts_ms": ts}
        high, low = float(current["high"]), float(current["low"])
        hard_hit = low <= stop if side == "LONG" else high >= stop
        trail_price = (best * (1 - Q102_TRAIL_DISTANCE) if side == "LONG"
                       else best * (1 + Q102_TRAIL_DISTANCE))
        trail_hit = trail_active and (low <= trail_price if side == "LONG" else high >= trail_price)
        if hard_hit or trail_hit:
            exit_price = stop if hard_hit else trail_price
            reason = "Q102_HARD_STOP" if hard_hit else "Q102_TRAIL_5_AFTER_12"
            return {
                **base, "status": "MODELED_CLOSED_TRADE", "entry_price": entry,
                "exit_price": exit_price, "exit_ts_ms": ts + HOUR, "exit_reason": reason,
                "requested_gross": requested, "unit_price_return": _direction(side) * (exit_price / entry - 1),
                "ambiguous_bar": bool(hard_hit and trail_hit),
            }
        if signal.get("exitPolicy") != "FIXED_HOLD_STOP":
            best = max(best, high) if side == "LONG" else min(best, low)
            if not trail_active:
                gain = best / entry - 1 if side == "LONG" else 1 - best / entry
                trail_active = gain >= Q102_TRAIL_TRIGGER
    boundary = entry_ts + hold * HOUR
    boundary_bar = by_ts.get(boundary)
    exit_price = float(boundary_bar["open"]) if boundary_bar else float(by_ts[entry_ts + (hold - 1) * HOUR]["close"])
    return {
        **base, "status": "MODELED_CLOSED_TRADE", "entry_price": entry,
        "exit_price": exit_price, "exit_ts_ms": boundary, "exit_reason": "Q102_TIME_EXIT",
        "requested_gross": requested, "unit_price_return": _direction(side) * (exit_price / entry - 1),
        "ambiguous_bar": False,
    }


def _fet_outcome(row: dict[str, Any], by_ts: dict[int, dict[str, Any]]) -> dict[str, Any]:
    signal = row.get("signal") or {}
    entry_ts = int(signal.get("entryTs") or row["decision_ts_ms"])
    base = {
        "strategy_id": "FET", "symbol": "FETUSDT", "side": "LONG", "entry_ts_ms": entry_ts,
        "signal_ts_ms": int(row["decision_ts_ms"]), "source_runtime_sha": row.get("source_runtime_sha"),
    }
    entry_bar = by_ts.get(entry_ts)
    if not entry_bar:
        return {**base, "status": "UNRESOLVED_ENTRY_BAR"}
    entry = float(entry_bar["open"])
    stop = entry * (1 - FET_STOP)
    trigger = entry * (1 + FET_FLOOR_TRIGGER)
    floor = entry * (1 + FET_FLOOR_STOP)
    armed = False
    for offset in range(FET_HOLD_HOURS):
        ts = entry_ts + offset * HOUR
        bar = by_ts.get(ts)
        if bar is None:
            return {**base, "status": "UNRESOLVED_EXIT_BAR", "entry_price": entry,
                    "requested_gross": FET_MAX_GROSS, "unresolved_ts_ms": ts}
        low, high = float(bar["low"]), float(bar["high"])
        active_stop = floor if armed else stop
        if low <= active_stop:
            return {
                **base, "status": "MODELED_CLOSED_TRADE", "entry_price": entry,
                "exit_price": active_stop, "exit_ts_ms": ts + HOUR,
                "exit_reason": "FET_PROFIT_FLOOR_STOP" if armed else "FET_HARD_STOP",
                "requested_gross": FET_MAX_GROSS,
                "unit_price_return": active_stop / entry - 1,
                "ambiguous_bar": False,
            }
        # A trigger observed somewhere inside this H1 cannot causally protect an
        # earlier low in the same bar, so the +0.5% floor begins next hour.
        if not armed and high >= trigger:
            armed = True
    boundary = entry_ts + FET_HOLD_HOURS * HOUR
    boundary_bar = by_ts.get(boundary)
    exit_price = float(boundary_bar["open"]) if boundary_bar else float(by_ts[boundary - HOUR]["close"])
    return {
        **base, "status": "MODELED_CLOSED_TRADE", "entry_price": entry,
        "exit_price": exit_price, "exit_ts_ms": boundary, "exit_reason": "FET_24H_TIME_EXIT",
        "requested_gross": FET_MAX_GROSS, "unit_price_return": exit_price / entry - 1,
        "ambiguous_bar": False,
    }


def build_candidate_ledger(data_root: Path, scan_root: Path, output_root: Path) -> dict[str, Any]:
    data_root, scan_root, output_root = map(Path, (data_root, scan_root, output_root))
    v12_scan = _rows(scan_root / "baseline-signal-scan/decisions/V12.jsonl")
    q102_scan = _rows(scan_root / "baseline-signal-scan-q102/decisions/Q102.jsonl")
    fet_scan = _rows(scan_root / "baseline-signal-scan/decisions/FET.jsonl")
    pengu_scan = _rows(scan_root / "baseline-signal-scan/decisions/PENGU.jsonl")

    symbols = sorted({str(row["symbol"]) for row in v12_scan if row.get("status") == "SIGNAL"}
                     | {str(row["symbol"]) for row in q102_scan if row.get("status") == "SIGNAL"}
                     | {"FETUSDT", "PENGUUSDT", "BTCUSDT"})
    bars = {}
    by_ts = {}
    funding = {}
    for symbol in symbols:
        bars[symbol], by_ts[symbol] = _bars(data_root, symbol)
        funding[symbol] = _funding(data_root, symbol)

    candidates: list[dict[str, Any]] = []
    v12_primary = _v12_primary_map(v12_scan)
    for row in v12_scan:
        if row.get("status") == "SIGNAL" and isinstance(row.get("signal"), dict):
            candidates.append(_v12_outcome(row, by_ts[str(row["symbol"])], v12_primary))
    for row in q102_scan:
        if row.get("status") == "SIGNAL" and isinstance(row.get("signal"), dict):
            candidates.append(_q102_outcome(row, by_ts[str(row["symbol"])]))
    for row in fet_scan:
        if row.get("status") == "SIGNAL":
            candidates.append(_fet_outcome(row, by_ts["FETUSDT"]))

    # PENGU candidate exits are replayed by the exact SHA-verified TypeScript
    # source functions; Python only attaches Aster funding and common schema.
    p_rows = bars["PENGUUSDT"]
    b_rows = bars["BTCUSDT"]
    history = {
        "pengu1h": [{"openTime": int(row["event_time_ms"]), "closeTime": int(row["close_time_ms"]),
                     "open": row["open"], "high": row["high"], "low": row["low"],
                     "close": row["close"], "volume": row["base_volume"]} for row in p_rows],
        "btc1h": [{"openTime": int(row["event_time_ms"]), "closeTime": int(row["close_time_ms"]),
                   "open": row["open"], "high": row["high"], "low": row["low"],
                   "close": row["close"], "volume": row["base_volume"]} for row in b_rows],
        "penguFunding": [],
    }
    with RuntimeBridge() as bridge:
        pengu = bridge.pengu_trade_outcomes(history, PERIOD_END_MS)
    for item in pengu["candidates"]:
        entry_ts = int(item["entryTs"])
        if not (PERIOD_START_MS <= entry_ts < PERIOD_END_MS):
            continue
        exit_info = item.get("exit")
        candidate = {
            "strategy_id": "PENGU", "symbol": "PENGUUSDT", "side": item["side"],
            "entry_ts_ms": entry_ts, "signal_ts_ms": int(item["signalReferenceTs"]),
            "entry_price": float(item["entryPrice"]), "requested_gross": float(item["targetGross"]),
            "entry_version": item["entryVersion"], "route": item["route"],
            "source_runtime_sha": item["sourceRuntimeSha"],
            "status": "MODELED_CLOSED_TRADE" if exit_info else "UNRESOLVED_PENGU_EXIT",
            "partial": item.get("partial"), "unit_price_return": item.get("unitPriceReturn"),
            "exit_ts_ms": int(exit_info["ts"]) if exit_info else None,
            "exit_price": float(exit_info["price"]) if exit_info else None,
            "exit_reason": exit_info.get("reason") if exit_info else None,
            "hard_stop_exit": bool(item.get("hardStopExit")),
            "ambiguous_bar": False,
        }
        candidates.append(candidate)

    for candidate in candidates:
        if candidate.get("status") != "MODELED_CLOSED_TRADE":
            candidate["funding_return_per_gross"] = None
            continue
        partial = candidate.get("partial")
        candidate["funding_return_per_gross"] = _funding_return_per_gross(
            funding[candidate["symbol"]], candidate["side"], int(candidate["entry_ts_ms"]),
            int(candidate["exit_ts_ms"]),
            partial_ts=int(partial["ts"]) if partial else None,
            remaining_fraction=0.5 if partial else 1.0,
        )

    candidates.sort(key=lambda row: (
        int(row.get("entry_ts_ms") or 0), row["strategy_id"], row["symbol"],
        int(row.get("rank") or 0)))
    output_root.mkdir(parents=True, exist_ok=True)
    ledger = output_root / "crypto-price-model-candidates.jsonl"
    ledger.write_text("".join(json.dumps(row, sort_keys=True, allow_nan=False) + "\n"
                              for row in candidates), encoding="utf-8")
    summary: dict[str, Any] = {
        "status": "CRYPTO_H1_PRICE_MODEL_CANDIDATES_READY",
        "formal_verified_fills": False,
        "period_start_ms": PERIOD_START_MS, "period_end_exclusive_ms": PERIOD_END_MS,
        "candidate_count": len(candidates),
        "strategies": {},
        "execution_assumptions": {
            "entry": "Aster H1 open at audited signal entry timestamp",
            "intrabar_stop_target": "adverse stop first when order is ambiguous",
            "funding": "Aster funding strictly after modeled entry through exit",
            "fees_slippage": "not applied at candidate stage",
            "shared_allocator": "not applied at candidate stage",
        },
    }
    for strategy in ("V12", "PENGU", "Q102", "FET"):
        rows = [row for row in candidates if row["strategy_id"] == strategy]
        closed = [row for row in rows if row.get("status") == "MODELED_CLOSED_TRADE"]
        values = [float(row["unit_price_return"]) for row in closed
                  if row.get("unit_price_return") is not None]
        summary["strategies"][strategy] = {
            "candidates": len(rows), "modeled_closed": len(closed),
            "unresolved": len(rows) - len(closed),
            "gross_price_win_rate": (sum(value > 0 for value in values) / len(values) if values else None),
            "mean_unit_price_return": (sum(values) / len(values) if values else None),
            "exit_reasons": dict(Counter(str(row.get("exit_reason")) for row in closed)),
        }
    (output_root / "crypto-price-model-summary.json").write_text(
        json.dumps(summary, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--scan-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    result = build_candidate_ledger(args.data_root, args.scan_root, args.output_root)
    print(json.dumps(result, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
