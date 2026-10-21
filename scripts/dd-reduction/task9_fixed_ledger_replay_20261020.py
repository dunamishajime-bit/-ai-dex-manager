#!/usr/bin/env python3
"""Task 9 corrected research replay.

This module is deliberately research-only.  It does not import Production
configuration, connect to a venue, or mutate VPS/LIVE state.  The frozen
accepted portfolio ledger is the admission boundary: rejected candidates are
never promoted by an overlay.  Early exits are replayed as lifecycle events so
funding, partial exits, fees, released cash, cooldown, and MTM can be audited
without treating the legacy candidate filter as an execution ledger.
"""
from __future__ import annotations

import bisect
import collections
import hashlib
import importlib.util
import json
import math
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TASK9_PATH = ROOT / "scripts" / "dd-reduction" / "task9_initial_adverse_stop_20261020.py"
OUTPUT = Path(
    r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/"
    r"2026-10-20_dd-reduction-initial-adverse-stop-audit"
)
CANONICAL_ROOT = Path(
    r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/"
    r"2026-10-20_dd-reduction-initial-adverse-stop/engine/BASELINE/BASELINE"
)
CASE_NAME = "V2_M150_D05_CORE_NATIVE"
PERIOD_START = 1754784000000
PERIOD_END = 1786320000000
EVENT_PRIORITY = {
    "MONTHLY_CONTRIBUTION": 0,
    "MODELED_ENTRY": 1,
    "FUNDING": 2,
    "MODELED_PARTIAL_EXIT": 3,
    "HYPE_PRIORITY_PARTIAL_EXIT": 3,
    "MODELED_EXIT": 4,
}


def _load_task9():
    spec = importlib.util.spec_from_file_location("task9_audit_target", TASK9_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {TASK9_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


t9 = _load_task9()


def _jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text("utf-8").splitlines() if line.strip()]


class _H1Source:
    """Read-only adapter over the frozen H1 market already used by the anchor.

    The adverse-stop decision logic uses the 5-minute archive.  The canonical
    anchor's MTM metric, however, is evaluated at each H1 timestamp.  Keeping
    these sources separate prevents a 5-minute mark from silently changing the
    published H1 baseline definition.
    """

    def __init__(self, bars_by_symbol: dict[str, dict[int, dict]]):
        self._data: dict[str, tuple[list[tuple], list[int]]] = {}
        for symbol, series in bars_by_symbol.items():
            rows = []
            for timestamp, bar in sorted(series.items()):
                rows.append((
                    int(timestamp),
                    float(bar["open"]),
                    float(bar["high"]),
                    float(bar["low"]),
                    float(bar["close"]),
                    0.0,
                ))
            self._data[symbol] = (rows, [row[0] for row in rows])

    def getdata(self, symbol: str) -> tuple[list[tuple], list[int]]:
        if symbol not in self._data:
            raise KeyError(symbol)
        return self._data[symbol]


def _canonical_path(cost_bps: int, name: str) -> Path:
    return (
        CANONICAL_ROOT
        / f"{cost_bps}bps"
        / "BASELINE"
        / f"{cost_bps}bps"
        / "cases"
        / CASE_NAME
        / "runs"
        / f"PRICE_MODEL_{cost_bps}BPS"
        / name
    )


def load_canonical(cost_bps: int) -> tuple[list[dict], list[dict], Path, Path]:
    ledger = _canonical_path(cost_bps, "portfolio-trades.jsonl")
    events = _canonical_path(cost_bps, "portfolio-events.jsonl")
    if not ledger.is_file() or not events.is_file():
        raise FileNotFoundError(f"canonical baseline missing for {cost_bps}bps: {ledger}")
    event_rows = _jsonl(events)
    fx_at = _fx_lookup(event_rows)
    return _normalize_pnl_units(_jsonl(ledger), fx_at), event_rows, ledger, events


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _position_key(row: dict) -> str:
    return str(row.get("position_id", row.get("candidate_id", "")))


def _fx_lookup(events: list[dict]):
    points = sorted(
        (int(event["ts_ms"]), float(event["reference_fx_jpy_per_usd"]))
        for event in events
        if event.get("ts_ms") is not None and event.get("reference_fx_jpy_per_usd") is not None
    )
    if not points:
        raise RuntimeError("canonical events have no reference FX")
    times = [point[0] for point in points]
    values = [point[1] for point in points]

    def at(timestamp: int) -> float:
        index = bisect.bisect_right(times, int(timestamp)) - 1
        return values[max(0, index)]

    return at


def _normalize_pnl_units(rows: list[dict], fx_at) -> list[dict]:
    """Make settlement and JPY PnL explicit for every closed trade.

    Historical source rows called the settlement-currency amount
    total_pnl_jpy. The source also contains a modeled exit-FX JPY amount for
    most rows. Preserve the old value under total_pnl_settlement and expose
    one true JPY field for all downstream metrics.
    """
    normalized: list[dict] = []
    for row in rows:
        item = dict(row)
        settlement = t9._optional_finite(
            row.get("total_pnl_settlement", row.get("total_pnl_jpy"))
        )
        jpy = t9._optional_finite(row.get("modeled_realized_pnl_jpy_at_exit_fx"))
        exit_ts = row.get("exit_ts_ms")
        if jpy is None and settlement is not None and exit_ts is not None:
            jpy = settlement * fx_at(int(exit_ts))
        if settlement is not None:
            item["total_pnl_settlement"] = settlement
        if jpy is not None:
            item["total_pnl_jpy"] = jpy
            item["modeled_realized_pnl_jpy_at_exit_fx"] = jpy
            item["pnl_unit"] = "JPY"
        item["settlement_pnl_unit"] = "SETTLEMENT"
        normalized.append(item)
    return normalized


def _profit_factor_for_field(rows: list[dict], field: str) -> float | None:
    """Calculate PF from one explicitly named PnL unit.

    The historical anchor used the legacy ``total_pnl_jpy`` field even though
    those values are denominated in the row's settlement currency.  Keeping
    this helper field-specific prevents a legacy parity check from being
    silently mixed with the corrected JPY metrics used for research decisions.
    """
    values = []
    for row in rows:
        value = t9._optional_finite(row.get(field))
        if value is not None:
            values.append(value)
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    return gains / losses if losses else None


def _final_cumulative_gate(
    cumulative_by_cost: dict[int, dict],
    initial_baseline_by_cost: dict[int, dict],
    minimum_dd_improvement_pp: float = 0.10,
    minimum_oos_pf_retention: float = 0.90,
    minimum_final_equity_retention: float = 0.75,
) -> dict:
    """Apply the acceptance gate to the final cumulative configuration.

    Phase selection is intentionally allowed to compare a candidate with the
    immediately preceding cumulative configuration.  That local comparison
    is not sufficient for the final configuration: cumulative overlays can
    erode the original OOS PF or final equity while every incremental phase
    still passes.  This helper always compares the final cumulative result to
    the immutable initial baseline.
    """
    per_cost: dict[str, dict] = {}
    for cost in (10, 30):
        candidate = cumulative_by_cost[cost]
        baseline = initial_baseline_by_cost[cost]
        candidate_oos = candidate.get("oos") or {}
        baseline_oos = baseline.get("oos") or {}
        candidate_pf = candidate_oos.get("profit_factor")
        baseline_pf = baseline_oos.get("profit_factor")
        oos_pf_retention = (
            candidate_pf / baseline_pf
            if candidate_pf is not None and baseline_pf not in (None, 0)
            else None
        )
        final_equity_retention = (
            candidate.get("final_equity_jpy") / baseline.get("final_equity_jpy")
            if baseline.get("final_equity_jpy") not in (None, 0)
            else None
        )
        checks = {
            "dd_improvement_pp": (
                candidate.get("maximum_mtm_drawdown_pct", 0.0)
                - baseline.get("maximum_mtm_drawdown_pct", 0.0)
            ),
            "accounting_pass": candidate.get("accounting") == "PASS",
            "oos_pf_retention_ratio": oos_pf_retention,
            "oos_pf_guard_pass": bool(
                oos_pf_retention is not None
                and oos_pf_retention >= minimum_oos_pf_retention
                and candidate_oos.get("net_pnl_jpy", 0.0) > 0
            ),
            "final_equity_retention_ratio": final_equity_retention,
            "final_equity_guard_pass": bool(
                final_equity_retention is not None
                and final_equity_retention >= minimum_final_equity_retention
            ),
        }
        checks["dd_guard_pass"] = checks["dd_improvement_pp"] >= minimum_dd_improvement_pp
        checks["accepted"] = all(
            (
                checks["dd_guard_pass"],
                checks["accounting_pass"],
                checks["oos_pf_guard_pass"],
                checks["final_equity_guard_pass"],
            )
        )
        per_cost[str(cost)] = checks
    return {
        "baseline_scope": "INITIAL_FIXED_BASELINE",
        "minimum_dd_improvement_pp": minimum_dd_improvement_pp,
        "minimum_oos_pf_retention": minimum_oos_pf_retention,
        "minimum_final_equity_retention": minimum_final_equity_retention,
        "per_cost": per_cost,
        "accepted": all(item["accepted"] for item in per_cost.values()),
    }


def _funding_by_position(events: list[dict]) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = collections.defaultdict(list)
    for event in events:
        if event.get("event_type") == "FUNDING":
            result[str(event.get("position_id"))].append(event)
    for values in result.values():
        values.sort(key=lambda event: int(event["ts_ms"]))
    return result


def _partial_events(events: list[dict], position_id: str) -> list[dict]:
    return sorted(
        [
            event
            for event in events
            if str(event.get("position_id")) == position_id
            and event.get("event_type")
            in {"MODELED_PARTIAL_EXIT", "HYPE_PRIORITY_PARTIAL_EXIT"}
        ],
        key=lambda event: int(event["ts_ms"]),
    )


def _fee_rate(row: dict, field: str, cost_bps: int) -> float:
    price = abs(float(row.get("exit_price") or 0.0))
    quantity = abs(float(row.get("quantity") or row.get("original_quantity") or 0.0))
    observed = t9._optional_finite(row.get(field))
    if observed is not None and price > 0 and quantity > 0:
        return observed / (price * quantity)
    # The fixed ledger's 10/30bps cost is round-trip; each side is half.
    return float(cost_bps) / 20_000.0


def _recalculate_changed_row(
    original: dict,
    actual: dict,
    events: list[dict],
    cost_bps: int,
    fx_at,
) -> tuple[dict, list[dict]]:
    """Recalculate a changed final exit, retaining prior partial lifecycle."""
    position_id = _position_key(original)
    entry = float(original["entry_price"])
    side = str(original["side"])
    sign = 1.0 if side == "LONG" else -1.0
    entry_ts = int(original["entry_ts_ms"])
    exit_ts = int(actual["exit_ts_ms"])
    original_quantity = float(original.get("original_quantity") or original.get("quantity"))
    partials = [event for event in _partial_events(events, position_id) if int(event["ts_ms"]) < exit_ts]
    partial_quantity = sum(float(event.get("quantity") or 0.0) for event in partials)
    remaining = max(0.0, original_quantity - partial_quantity)
    if remaining <= 0:
        raise RuntimeError(f"changed exit has no remaining quantity: {position_id}")
    funding = [
        event
        for event in events
        if str(event.get("position_id")) == position_id
        and event.get("event_type") == "FUNDING"
        and entry_ts < int(event["ts_ms"]) <= exit_ts
    ]
    funding_pnl = sum(float(event.get("cashflow_settlement") or 0.0) for event in funding)
    partial_price = sum(float(event.get("price_pnl_settlement") or 0.0) for event in partials)
    partial_fees = sum(float(event.get("fee_settlement") or 0.0) for event in partials)
    exit_price = float(actual["exit_price"])
    exit_fee = abs(remaining * exit_price) * _fee_rate(original, "exit_fee", cost_bps)
    final_price = sign * (exit_price - entry) * remaining
    entry_fee = float(original.get("entry_fee") or 0.0)
    total = partial_price + final_price + funding_pnl - entry_fee - partial_fees - exit_fee
    fx = fx_at(exit_ts)
    total_jpy = total * fx
    changed = dict(
        original,
        exit_ts_ms=exit_ts,
        exit_price=exit_price,
        exit_reason=actual.get("exit_reason") or actual.get("exit_reason_actual"),
        exit_reason_actual=actual.get("exit_reason") or actual.get("exit_reason_actual"),
        quantity=remaining,
        price_pnl=partial_price + final_price,
        exit_fee=exit_fee,
        funding_pnl=funding_pnl,
        total_pnl_settlement=total,
        total_pnl_jpy=total_jpy,
        modeled_realized_pnl_jpy_at_exit_fx=total_jpy,
        pnl_unit="JPY",
        settlement_pnl_unit="SETTLEMENT",
        reference_fx_exit_jpy_per_usd=fx,
    )
    generated = []
    entry_event = next(
        (
            event
            for event in events
            if str(event.get("position_id")) == position_id
            and event.get("event_type") == "MODELED_ENTRY"
        ),
        None,
    )
    if entry_event is None:
        raise RuntimeError(f"changed position has no entry event: {position_id}")
    generated.append(dict(entry_event))
    generated.extend(dict(event) for event in funding)
    generated.extend(dict(event) for event in partials)
    generated.append(
        {
            "candidate_id": original.get("candidate_id"),
            "event_type": "MODELED_EXIT",
            "exit_reason": changed["exit_reason_actual"],
            "fee_settlement": exit_fee,
            "historical_fill_verified": False,
            "modeled_price_usd": exit_price,
            "net_cashflow_settlement": final_price - exit_fee,
            "position_id": original.get("position_id"),
            "price_pnl_settlement": final_price,
            "quantity": remaining,
            "reference_fx_jpy_per_usd": fx,
            "side": side,
            "strategy_id": original.get("strategy_id"),
            "symbol": original.get("symbol"),
            "total_trade_pnl_settlement": total,
            "ts_ms": exit_ts,
        }
    )
    return changed, generated


def _event_sort_key(event: dict, ordinal: int) -> tuple[int, int, int, int]:
    return (
        int(event.get("ts_ms", 0)),
        EVENT_PRIORITY.get(str(event.get("event_type")), 5),
        int(event.get("position_id") or 0),
        ordinal,
    )


def _event_identity(event: dict) -> tuple[str, str, str, int]:
    """Stable identity used to retain the canonical wallet delta.

    The frozen event ledger's ``wallet_after_event`` is authoritative for the
    historical baseline.  Re-deriving every delta from a subset of fields
    loses small modeled components in some original exits.  For unchanged
    events we therefore carry the exact canonical delta forward; generated
    replacement exits use their newly calculated cashflow instead.
    """
    return (
        str(event.get("position_id", "")),
        str(event.get("candidate_id", "")),
        str(event.get("event_type", "")),
        int(event.get("ts_ms", 0)),
    )


def _event_cashflow_settlement(event: dict) -> float | None:
    kind = str(event.get("event_type"))
    if kind == "MONTHLY_CONTRIBUTION":
        return float(event.get("settlement_cashflow") or 0.0)
    if kind == "MODELED_ENTRY":
        return -float(event.get("fee_settlement") or 0.0)
    if kind == "FUNDING":
        return float(event.get("cashflow_settlement") or 0.0)
    if kind in {"MODELED_PARTIAL_EXIT", "HYPE_PRIORITY_PARTIAL_EXIT", "MODELED_EXIT"}:
        return float(event.get("net_cashflow_settlement") or 0.0)
    return None


def _reconcile_accounting(events: list[dict], tolerance: float = 1e-8) -> dict:
    """Independently reconcile event cashflows against wallet snapshots."""
    independent_wallet = 0.0
    mismatches: list[dict] = []
    unknown_events: list[str] = []
    for ordinal, event in enumerate(events):
        cashflow = _event_cashflow_settlement(event)
        if cashflow is None:
            unknown_events.append(str(event.get("event_type")))
            continue
        independent_wallet += cashflow
        observed = event.get("wallet_after_event")
        if observed is None or not math.isfinite(float(observed)):
            mismatches.append({
                "ordinal": ordinal,
                "reason": "MISSING_OR_NONFINITE_WALLET",
                "expected_wallet": independent_wallet,
                "observed_wallet": observed,
            })
            continue
        delta = independent_wallet - float(observed)
        if abs(delta) > tolerance:
            mismatches.append({
                "ordinal": ordinal,
                "reason": "EVENT_WALLET_MISMATCH",
                "expected_wallet": independent_wallet,
                "observed_wallet": float(observed),
                "delta": delta,
            })
    observed_final = (
        float(events[-1].get("wallet_after_event"))
        if events and events[-1].get("wallet_after_event") is not None
        else None
    )
    final_delta = (
        independent_wallet - observed_final
        if observed_final is not None
        else None
    )
    status = (
        "PASS"
        if events
        and not unknown_events
        and observed_final is not None
        and math.isfinite(independent_wallet)
        and final_delta is not None
        and abs(final_delta) <= tolerance
        and not mismatches
        else "FAIL"
    )
    return {
        "status": status,
        "independent_wallet_settlement": independent_wallet,
        "observed_wallet_settlement": observed_final,
        "wallet_delta_settlement": final_delta,
        "event_mismatch_count": len(mismatches),
        "unknown_event_types": sorted(set(unknown_events)),
        "mismatches": mismatches[:25],
    }


def _replay_events(
    baseline_rows: list[dict],
    baseline_events: list[dict],
    transformed_rows: list[dict],
    cost_bps: int,
    fx_at,
    source,
    output_root: Path,
) -> tuple[list[dict], list[dict], dict]:
    original_by_id = {_position_key(row): row for row in baseline_rows}
    transformed_by_id = {_position_key(row): row for row in transformed_rows}
    dropped = set(original_by_id) - set(transformed_by_id)
    changed = {
        position_id
        for position_id, row in transformed_by_id.items()
        if position_id in original_by_id
        and (
            int(row.get("exit_ts_ms", 0)) != int(original_by_id[position_id].get("exit_ts_ms", 0))
            or not math.isclose(
                float(row.get("exit_price", 0.0)),
                float(original_by_id[position_id].get("exit_price", 0.0)),
                rel_tol=0.0,
                abs_tol=1e-12,
            )
            or (row.get("exit_reason") or row.get("exit_reason_actual"))
            != original_by_id[position_id].get("exit_reason_actual")
        )
    }
    final_rows: dict[str, dict] = {}
    replacement_events: dict[str, list[dict]] = {}
    for position_id, row in transformed_by_id.items():
        original = original_by_id[position_id]
        if position_id in changed:
            recalculated, generated = _recalculate_changed_row(
                original, row, baseline_events, cost_bps, fx_at
            )
            final_rows[position_id] = recalculated
            replacement_events[position_id] = generated
        else:
            final_rows[position_id] = dict(original)

    events_out: list[dict] = []
    emitted_replacement: set[str] = set()
    for event in baseline_events:
        position_id = str(event.get("position_id", ""))
        if position_id in dropped:
            continue
        if position_id in changed:
            if position_id not in emitted_replacement:
                events_out.extend(replacement_events[position_id])
                emitted_replacement.add(position_id)
            continue
        events_out.append(dict(event))
    # Contribution has no position id and is retained above.  Replacement
    # events are emitted at the first old position event; sort below restores
    # the deterministic global lifecycle ordering.
    events_out.sort(key=lambda event: _event_sort_key(event, 0))

    canonical_deltas: dict[tuple[str, str, str, int], collections.deque[float]] = collections.defaultdict(collections.deque)
    previous_wallet = 0.0
    for event in baseline_events:
        wallet_after = event.get("wallet_after_event")
        if wallet_after is None:
            continue
        current_wallet = float(wallet_after)
        canonical_deltas[_event_identity(event)].append(current_wallet - previous_wallet)
        previous_wallet = current_wallet

    wallet = 0.0
    exit_wallet: dict[str, float] = {}
    normalized_events: list[dict] = []
    for ordinal, event in enumerate(events_out):
        kind = str(event.get("event_type"))
        exact_delta = canonical_deltas.get(_event_identity(event))
        if exact_delta:
            cash = exact_delta.popleft()
        elif kind == "MONTHLY_CONTRIBUTION":
            cash = float(event.get("settlement_cashflow") or 0.0)
        elif kind == "MODELED_ENTRY":
            cash = -float(event.get("fee_settlement") or 0.0)
        elif kind == "FUNDING":
            cash = float(event.get("cashflow_settlement") or 0.0)
        elif kind in {"MODELED_PARTIAL_EXIT", "HYPE_PRIORITY_PARTIAL_EXIT", "MODELED_EXIT"}:
            cash = float(event.get("net_cashflow_settlement") or 0.0)
        else:
            cash = 0.0
        wallet += cash
        normalized = dict(event, wallet_after_event=wallet)
        normalized_events.append(normalized)
        if kind == "MODELED_EXIT":
            exit_wallet[str(event.get("position_id"))] = wallet

    for position_id, row in final_rows.items():
        if position_id in exit_wallet:
            row["wallet_after_exit"] = exit_wallet[position_id]

    # The source bar paths are used for the corrected MTM timeline.  The
    # audit records missing/invalid marks instead of filling them optimistically.
    mtm = build_mtm_timeline(final_rows, normalized_events, source, fx_at, output_root)
    independent_accounting = _reconcile_accounting(normalized_events)
    accounting = {
        "status": (
            "PASS"
            if normalized_events
            and math.isfinite(wallet)
            and independent_accounting["status"] == "PASS"
            else "FAIL"
        ),
        "final_wallet_settlement": wallet,
        "event_count": len(normalized_events),
        "dropped_positions": len(dropped),
        "changed_positions": len(changed),
        "independent_reconciliation": independent_accounting,
    }
    return list(final_rows.values()), normalized_events, {
        "dropped_positions": sorted(dropped, key=lambda value: int(value) if value.isdigit() else value),
        "changed_positions": sorted(changed, key=lambda value: int(value) if value.isdigit() else value),
        "accounting": accounting,
        "mtm": mtm,
    }


def _open_position_snapshot(rows: list[dict], timestamp: int, source, evaluation: str = "H1") -> list[dict]:
    positions = []
    for row in rows:
        if not int(row["entry_ts_ms"]) <= timestamp < int(row["exit_ts_ms"]):
            continue
        try:
            bars, times = source.getdata(str(row["symbol"]))
            index = bisect.bisect_right(times, timestamp) - 1
            if index < 0:
                continue
            # The frozen H1 price-model uses the observation-bar OPEN when
            # the mark timestamp equals that bar's timestamp.  The close is
            # reserved for the optional intrabar diagnostic path.
            mark = float(bars[index][1] if evaluation == "H1" else bars[index][4])
            entry = float(row["entry_price"])
            # The formal H1 anchor marks at the frozen venue close.  It does
            # not rescale that mark to an entry fill that occurred between H1
            # observations (for example a :30 execution).  Scaling is only a
            # diagnostic convenience for the optional 5m path; applying it to
            # H1 would silently change the published MTM definition.
            if evaluation != "H1":
                mark *= entry / float(bars[bisect.bisect_left(times, int(row["entry_ts_ms"]))][1])
            qty = float(row.get("quantity") or row.get("original_quantity") or 0.0)
            sign = 1.0 if row["side"] == "LONG" else -1.0
            positions.append({
                "position_id": row.get("position_id"),
                "strategy_id": row.get("strategy_id"),
                "symbol": row.get("symbol"),
                "side": row.get("side"),
                "quantity": qty,
                "gross": row.get("accepted_gross"),
                "unrealized_settlement": sign * (mark - entry) * qty,
            })
        except (IndexError, KeyError, TypeError, ValueError, ZeroDivisionError):
            continue
    return positions


def build_mtm_timeline(
    rows_by_id: dict[str, dict],
    events: list[dict],
    source,
    fx_at,
    output_root: Path,
    evaluation: str = "H1",
) -> dict:
    """Build a complete corrected 5m MTM timeline and top DD windows."""
    marks: dict[int, dict[str, float]] = collections.defaultdict(
        lambda: {"unrealized": 0.0, "gross": 0.0, "open_count": 0.0}
    )
    invalid_rows = []
    partials_by_id: dict[str, list[dict]] = collections.defaultdict(list)
    for event in events:
        if event.get("event_type") in {"MODELED_PARTIAL_EXIT", "HYPE_PRIORITY_PARTIAL_EXIT"}:
            partials_by_id[str(event.get("position_id"))].append(event)
    for row in rows_by_id.values():
        try:
            bars, times = source.getdata(str(row["symbol"]))
            entry_ts = int(row["entry_ts_ms"])
            exit_ts = int(row["exit_ts_ms"])
            start = bisect.bisect_left(times, entry_ts)
            end = bisect.bisect_left(times, exit_ts)
            if start >= len(bars) or start >= end:
                raise ValueError("NO_MARK_PATH")
            entry = float(row["entry_price"])
            first_open = float(bars[start][1])
            if first_open <= 0 or entry <= 0:
                raise ValueError("INVALID_ENTRY_PRICE")
            if evaluation == "H1":
                scale = 1.0
            else:
                if abs(first_open / entry - 1.0) > 0.025:
                    raise ValueError("ENTRY_PRICE_MISMATCH")
                scale = entry / first_open
            original_qty = float(row.get("original_quantity") or row.get("quantity") or 0.0)
            sign = 1.0 if row["side"] == "LONG" else -1.0
            partials = sorted(partials_by_id.get(_position_key(row), []), key=lambda e: int(e["ts_ms"]))
            for index in range(start, end):
                timestamp, op, _high, _low, close, _volume = bars[index]
                qty = original_qty - sum(
                    float(event.get("quantity") or 0.0)
                    for event in partials
                    if int(event["ts_ms"]) <= int(timestamp)
                )
                if qty <= 0:
                    continue
                mark = float(op if evaluation == "H1" else close) * scale
                point = marks[int(timestamp)]
                point["unrealized"] += sign * (mark - entry) * qty
                point["gross"] += float(row.get("accepted_gross") or 0.0) * qty / original_qty
                point["open_count"] += 1.0
        except (IndexError, KeyError, TypeError, ValueError, ZeroDivisionError) as exc:
            invalid_rows.append({"position_id": row.get("position_id"), "reason": str(exc)})

    event_cash: dict[int, float] = collections.defaultdict(float)
    previous_wallet = 0.0
    for event in events:
        wallet_after = event.get("wallet_after_event")
        if wallet_after is not None:
            current_wallet = float(wallet_after)
            cash = current_wallet - previous_wallet
            previous_wallet = current_wallet
        else:
            kind = str(event.get("event_type"))
            if kind == "MONTHLY_CONTRIBUTION":
                cash = float(event.get("settlement_cashflow") or 0.0)
            elif kind == "MODELED_ENTRY":
                cash = -float(event.get("fee_settlement") or 0.0)
            elif kind == "FUNDING":
                cash = float(event.get("cashflow_settlement") or 0.0)
            elif kind in {"MODELED_PARTIAL_EXIT", "HYPE_PRIORITY_PARTIAL_EXIT", "MODELED_EXIT"}:
                cash = float(event.get("net_cashflow_settlement") or 0.0)
            else:
                cash = 0.0
        event_cash[int(event["ts_ms"])] += cash

    if evaluation == "H1":
        # This is the frozen anchor's exact observation schedule.  Cashflows
        # that occur at :30 are applied before the next H1 mark, but do not
        # create artificial intra-hour equity points.
        timestamps = list(range(PERIOD_START, PERIOD_END + 1, 3_600_000))
    else:
        timestamps = sorted(set(marks) | set(event_cash))
    if not timestamps:
        return {"status": "NO_MTM_TIMELINE", "invalid_rows": invalid_rows}
    cash = 0.0
    event_times = sorted(event_cash)
    event_index = 0
    peak = None
    peak_ts = None
    best = {"drawdown_pct": 0.0, "peak_ts_ms": None, "trough_ts_ms": None, "recovery_ts_ms": None}
    series: list[tuple[int, float]] = []
    timeline_path = output_root / "mtm" / "fixed-ledger-timeline.jsonl"
    timeline_path.parent.mkdir(parents=True, exist_ok=True)
    monthly: dict[str, float] = {}
    with timeline_path.open("w", encoding="utf-8") as handle:
        for timestamp in timestamps:
            while event_index < len(event_times) and event_times[event_index] <= timestamp:
                cash += event_cash[event_times[event_index]]
                event_index += 1
            point = marks.get(timestamp, {"unrealized": 0.0, "gross": 0.0, "open_count": 0.0})
            fx = fx_at(timestamp)
            equity = (cash + point["unrealized"]) * fx
            if peak is None or equity > peak:
                peak = equity
                peak_ts = timestamp
            drawdown = 100.0 * (equity / peak - 1.0) if peak else 0.0
            if drawdown < best["drawdown_pct"]:
                best = {
                    "drawdown_pct": drawdown,
                    "peak_ts_ms": peak_ts,
                    "trough_ts_ms": timestamp,
                    "recovery_ts_ms": None,
                }
            elif (
                best["trough_ts_ms"] is not None
                and best["recovery_ts_ms"] is None
                and timestamp > best["trough_ts_ms"]
                and equity >= peak
            ):
                best["recovery_ts_ms"] = timestamp
            series.append((timestamp, equity))
            month = datetime.fromtimestamp(timestamp / 1000, timezone.utc).strftime("%Y-%m")
            monthly[month] = equity
            handle.write(json.dumps({
                "ts_ms": timestamp,
                "equity_jpy": equity,
                "wallet_settlement": cash,
                "unrealized_settlement": point["unrealized"],
                "gross": point["gross"],
                "open_positions": int(point["open_count"]),
            }, ensure_ascii=False) + "\n")
    # Extract independent drawdown windows from the full equity series. A
    # window closes only after the equity recovers to the peak that preceded
    # its trough; this keeps a later decline from being incorrectly merged
    # into the first event. Windows are then selected by drawdown depth with
    # non-overlap so the report can show the five largest independent DDs.
    windows: list[dict] = []
    active_peak_ts = None
    active_peak_equity = None
    active_trough_ts = None
    active_trough_equity = None
    for timestamp, equity in series:
        if active_peak_equity is None or equity > active_peak_equity:
            if active_trough_ts is not None:
                windows.append({
                    "peak_ts_ms": active_peak_ts,
                    "peak_equity_jpy": active_peak_equity,
                    "trough_ts_ms": active_trough_ts,
                    "trough_equity_jpy": active_trough_equity,
                    "recovery_ts_ms": timestamp,
                    "drawdown_pct": 100.0 * (active_trough_equity / active_peak_equity - 1.0),
                })
            active_peak_ts = timestamp
            active_peak_equity = equity
            active_trough_ts = None
            active_trough_equity = None
        elif active_trough_ts is None or equity < active_trough_equity:
            active_trough_ts = timestamp
            active_trough_equity = equity
    if active_trough_ts is not None and active_peak_equity:
        windows.append({
            "peak_ts_ms": active_peak_ts,
            "peak_equity_jpy": active_peak_equity,
            "trough_ts_ms": active_trough_ts,
            "trough_equity_jpy": active_trough_equity,
            "recovery_ts_ms": None,
            "drawdown_pct": 100.0 * (active_trough_equity / active_peak_equity - 1.0),
        })
    top_windows: list[dict] = []
    for window in sorted(windows, key=lambda item: item["drawdown_pct"]):
        if all(
            window["trough_ts_ms"] < selected["peak_ts_ms"]
            or selected["trough_ts_ms"] < window["peak_ts_ms"]
            for selected in top_windows
        ):
            top_windows.append(window)
        if len(top_windows) == 5:
            break

    snapshots = {}
    for name, timestamp in (("peak", best["peak_ts_ms"]), ("trough", best["trough_ts_ms"]), ("recovery", best["recovery_ts_ms"])):
        if timestamp is not None:
            snapshots[name] = _open_position_snapshot(
                list(rows_by_id.values()), timestamp, source, evaluation=evaluation
            )
    return {
        "status": "COMPLETE_CORRECTED_H1_MTM" if evaluation == "H1" else "COMPLETE_CORRECTED_INTRABAR_MTM",
        "evaluation_schedule": evaluation,
        "timeline": str(timeline_path),
        "timeline_sha256": sha256_file(timeline_path),
        "points": len(timestamps),
        "invalid_mark_rows": invalid_rows,
        "maximum_mtm_drawdown_pct": best["drawdown_pct"],
        "peak_ts_ms": best["peak_ts_ms"],
        "trough_ts_ms": best["trough_ts_ms"],
        "recovery_ts_ms": best["recovery_ts_ms"],
        "top5_independent_drawdown_windows": top_windows,
        "monthly_equity_jpy": monthly,
        "dd_window_open_positions": snapshots,
    }


def _metrics(rows: list[dict], events: list[dict], replay_meta: dict, cost_bps: int) -> dict:
    outcomes = [t9.classify_pnl(row) for row in rows]
    values = [float(item["value"]) for item in outcomes if isinstance(item["value"], (int, float))]
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    final_event = events[-1] if events else {}
    final_wallet = float(final_event.get("wallet_after_event") or 0.0)
    final_fx = float(final_event.get("reference_fx_jpy_per_usd") or 0.0)
    strategies = collections.Counter(str(row.get("strategy_id")) for row in rows)
    pnl_by_strategy = collections.defaultdict(float)
    for row in rows:
        value = t9.classify_pnl(row)["value"]
        if isinstance(value, (int, float)):
            pnl_by_strategy[str(row.get("strategy_id"))] += value
    mtm = replay_meta["mtm"]
    return {
        "final_equity_jpy": final_wallet * final_fx,
        "final_wallet_settlement": final_wallet,
        "final_fx_jpy_per_usd": final_fx,
        "profit_factor": gains / losses if losses else None,
        "maximum_mtm_drawdown_pct": mtm.get("maximum_mtm_drawdown_pct"),
        "canonical_engine_maximum_mtm_drawdown_pct": None,
        "win_rate": sum(item["status"] == "WIN" for item in outcomes) / len(values) if values else None,
        "closed_trades": len(rows),
        "strategy_trades": dict(strategies),
        "strategy_pnl_jpy": dict(pnl_by_strategy),
        "accounting": replay_meta["accounting"]["status"],
        "oos": t9._oos_metrics(rows, cost_bps),
        "cost_bps": cost_bps,
    }


def replay_case(
    baseline_rows: list[dict],
    baseline_events: list[dict],
    overlays: list[dict],
    source,
    cost_bps: int,
    output_dir: Path,
    mtm_source=None,
) -> tuple[dict, dict, dict]:
    fx_at = _fx_lookup(baseline_events)
    baseline_lookup = {_position_key(row): row for row in baseline_rows}
    observations = {
        "eligible": 0,
        "triggered": 0,
        "original_winner_triggered": 0,
        "original_loser_triggered": 0,
        "original_unsettled_triggered": 0,
        "reentry_rejected": 0,
        "unfilled_skipped": 0,
        "stop_decisions": [],
        "cooldown_decisions": [],
        "data_gap": 0,
        "entry_mismatch": 0,
        "atr_unavailable": 0,
        "internal_gap": 0,
        "structure_unconfirmed": 0,
        "invalid_input": 0,
        "by_reason": collections.Counter(),
    }
    if overlays:
        transformed = t9._transform_rows(
            baseline_rows, overlays, source, cost_bps, observations,
            baseline_lookup=baseline_lookup,
        )
    else:
        transformed = [dict(row) for row in baseline_rows]
    rows, events, meta = _replay_events(
        baseline_rows, baseline_events, transformed, cost_bps, fx_at,
        mtm_source or source, output_dir
    )
    for audit in observations["stop_decisions"]:
        final = next((row for row in rows if str(row.get("position_id")) == str(audit.get("position_id"))), None)
        if final is not None:
            outcome = t9.classify_pnl(final)
            audit.update({
                "actual_exit_ts_ms": final.get("exit_ts_ms"),
                "actual_exit_price": final.get("exit_price"),
                "actual_exit_reason": final.get("exit_reason_actual") or final.get("exit_reason"),
                "actual_pnl_jpy": outcome["value"],
                "actual_pnl_source": outcome["source"],
                "actual_outcome": outcome["status"],
                "pnl_delta_jpy": (
                    outcome["value"] - audit["original_pnl_jpy"]
                    if isinstance(outcome["value"], (int, float))
                    and isinstance(audit.get("original_pnl_jpy"), (int, float))
                    else None
                ),
            })
    metrics = _metrics(rows, events, meta, cost_bps)
    output_dir.mkdir(parents=True, exist_ok=True)
    ledger = output_dir / "portfolio-trades.jsonl"
    event_file = output_dir / "portfolio-events.jsonl"
    ledger.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
    event_file.write_text("\n".join(json.dumps(event, ensure_ascii=False) for event in events) + "\n", encoding="utf-8")
    audit = {
        "engine_audit_version": t9.ENGINE_AUDIT_VERSION,
        "accepted_baseline_overlay_replay": True,
        "candidate_promotion": False,
        "observations": {**observations, "by_reason": dict(observations["by_reason"])},
        "stop_audit": observations["stop_decisions"],
        "cooldown_audit": observations["cooldown_decisions"],
        "replay_meta": meta,
        "ledger": str(ledger),
        "events": str(event_file),
        "ledger_sha256": sha256_file(ledger),
        "events_sha256": sha256_file(event_file),
    }
    return metrics, audit, rows


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Research-only fixed accepted-ledger Task 9 replay")
    parser.add_argument(
        "--baseline-only",
        action="store_true",
        help="rebuild and validate the fixed baseline, without running the candidate grid",
    )
    args = parser.parse_args()
    output = OUTPUT / "fixed-ledger-replay"
    output.mkdir(parents=True, exist_ok=True)
    # Bootstrap only the read-only 5m research source.  The legacy runner is
    # not executed here; its candidate-filter/accepted-ledger boundary was the
    # P0 failure this replay fixes.
    t9.Path.write_text = t9._redirect_legacy_write_text
    source, _helper = t9.task8.legacy.bootstrap()
    t9.Path.write_text = t9._path_write_text
    h1_source = _H1Source(_helper.base.s.w.bars)
    summaries = {}
    all_diagnostics = {}
    for cost in (10, 30):
        baseline_rows, baseline_events, source_ledger, source_events = load_canonical(cost)
        base_dir = output / "BASELINE" / f"{cost}bps"
        base_metrics, base_audit, _ = replay_case(
            baseline_rows, baseline_events, [], source, cost, base_dir, h1_source
        )
        expected = t9.BASELINE_EXPECTED[cost]
        legacy_settlement_pf = _profit_factor_for_field(
            baseline_rows, "total_pnl_settlement"
        )
        legacy_settlement_pf_exact = math.isclose(
            legacy_settlement_pf,
            expected["pf"],
            rel_tol=2e-10,
            abs_tol=1e-8,
        )
        baseline_control = {
            "canonical_ledger_sha256": sha256_file(source_ledger),
            "canonical_events_sha256": sha256_file(source_events),
            "rows": len(baseline_rows),
            "final_exact": math.isclose(base_metrics["final_equity_jpy"], expected["final"], rel_tol=2e-10, abs_tol=1e-4),
            # ``pf_exact`` remains a compatibility alias for the historical
            # anchor check.  It must never be interpreted as proof that the
            # corrected JPY PF equals the settlement-unit anchor.
            "pf_exact": legacy_settlement_pf_exact,
            "historical_anchor_pf_unit": "SETTLEMENT",
            "historical_anchor_pf": expected["pf"],
            "legacy_settlement_pf": legacy_settlement_pf,
            "legacy_settlement_pf_exact": legacy_settlement_pf_exact,
            "corrected_jpy_pf": base_metrics["profit_factor"],
            "corrected_jpy_pnl_unit": "JPY",
            "corrected_jpy_pf_matches_legacy_anchor": math.isclose(
                base_metrics["profit_factor"],
                expected["pf"],
                rel_tol=2e-10,
                abs_tol=1e-8,
            ),
            "trades_exact": len(baseline_rows) == expected["trades"],
            "accounting_pass": base_metrics["accounting"] == "PASS",
            "independent_accounting_reconciliation": base_audit["replay_meta"]["accounting"]["independent_reconciliation"],
            "corrected_mtm_status": base_audit["replay_meta"]["mtm"].get("status"),
            "canonical_engine_dd_pct": expected["dd"],
            "corrected_h1_mtm_dd_pct": base_metrics["maximum_mtm_drawdown_pct"],
            "mtm_exact": math.isclose(
                base_metrics["maximum_mtm_drawdown_pct"],
                expected["dd"],
                rel_tol=2e-12,
                abs_tol=1e-10,
            ),
            "mtm_schedule": base_audit["replay_meta"]["mtm"].get("evaluation_schedule"),
        }
        _write = output / f"baseline-control-{cost}bps.json"
        _write.write_text(json.dumps(baseline_control, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        diagnostics = t9.build_loss_path_diagnostics(baseline_rows, source, cost)
        all_diagnostics[str(cost)] = diagnostics
        summaries[str(cost)] = {"baseline": base_metrics, "control": baseline_control}
    (output / "baseline-loss-path-diagnostics.json").write_text(
        json.dumps(all_diagnostics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    if args.baseline_only:
        baseline_only = {
            "status": "BASELINE_ONLY_COMPLETE_RESEARCH_ONLY_NONCANONICAL",
            "classification": "RESEARCH_ONLY_NONCANONICAL",
            "baseline": summaries,
            "source_sha256": {
                "task9_audit": sha256_file(TASK9_PATH),
                "fixed_replay": sha256_file(Path(__file__)),
            },
        }
        (output / "baseline-only-summary.json").write_text(
            json.dumps(baseline_only, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print("TASK9_FIXED_BASELINE_ONLY_COMPLETE", output, flush=True)
        return

    baseline_by_cost = {cost: load_canonical(cost)[:2] for cost in (10, 30)}
    phase_reports = []
    cumulative: list[dict] = []
    initial_baseline = {cost: summaries[str(cost)]["baseline"] for cost in (10, 30)}
    current_baseline = dict(initial_baseline)
    for phase in t9.ALL_PHASES:
        candidate_summaries = []
        for candidate in t9.candidate_grid(phase):
            results = {}
            checks = {}
            for cost in (10, 30):
                rows, events = baseline_by_cost[cost]
                candidate_id = candidate["id"]
                safe_name = f"{phase}__{candidate_id}__{cost}bps"
                metrics, audit, _ = replay_case(
                    rows, events, cumulative + [candidate], source, cost,
                    output / "candidates" / safe_name, h1_source,
                )
                metrics["candidate"] = candidate_id
                metrics["phase"] = phase
                metrics["audit"] = audit
                results[str(cost)] = metrics
                checks[str(cost)] = {
                    "dd_improvement_pp": (
                        metrics["maximum_mtm_drawdown_pct"]
                        - current_baseline[cost]["maximum_mtm_drawdown_pct"]
                    ),
                    "accounting_pass": metrics["accounting"] == "PASS",
                    "final_equity_guard_pass": metrics["final_equity_jpy"] >= 0.75 * current_baseline[cost]["final_equity_jpy"],
                    "oos": t9._oos_metrics(
                        _jsonl(Path(metrics["audit"]["ledger"])), cost
                    ),
                }
                baseline_oos = current_baseline[cost].get("oos") or {}
                candidate_oos = checks[str(cost)]["oos"]
                checks[str(cost)]["oos_pass"] = bool(
                    candidate_oos.get("profit_factor") is not None
                    and baseline_oos.get("profit_factor") is not None
                    and candidate_oos["profit_factor"] >= 0.90 * baseline_oos["profit_factor"]
                    and candidate_oos.get("net_pnl_jpy", 0.0) > 0
                )
                checks[str(cost)]["accepted"] = (
                    checks[str(cost)]["dd_improvement_pp"] >= 0.10
                    and checks[str(cost)]["accounting_pass"]
                    and checks[str(cost)]["oos_pass"]
                    and checks[str(cost)]["final_equity_guard_pass"]
                )
            item = {
                "phase": phase,
                "candidate": candidate,
                "results": results,
                "checks": checks,
                "accepted_both_costs": all(checks[str(cost)]["accepted"] for cost in (10, 30)),
            }
            improved = all(
                checks[str(cost)]["dd_improvement_pp"] >= 0.10
                for cost in (10, 30)
            )
            item["classification"] = (
                "ACCEPTED"
                if item["accepted_both_costs"]
                else "DD_IMPROVED_RESEARCH_ONLY"
                if improved
                else "REJECTED"
            )
            candidate_summaries.append(item)
            path = output / "phases" / phase / f"{candidate['id']}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        accepted = [item for item in candidate_summaries if item["accepted_both_costs"]]
        selected = None
        if accepted:
            selected = sorted(
                accepted,
                key=lambda item: min(
                    item["checks"]["10"]["dd_improvement_pp"],
                    item["checks"]["30"]["dd_improvement_pp"],
                ),
                reverse=True,
            )[0]
            cumulative.append(selected["candidate"])
            current_baseline = {
                cost: selected["results"][str(cost)] for cost in (10, 30)
            }
            selection = "ACCEPTED_AND_CARRIED_FORWARD"
        else:
            selection = "NO_ACCEPTED_CANDIDATE_BASELINE_UNCHANGED"
        report = {
            "phase": phase,
            "candidate_count": len(candidate_summaries),
            "selected_candidate": selected["candidate"] if selected else None,
            "selection_status": selection,
            "cumulative_overlays_after_phase": cumulative,
            "candidate_summaries": candidate_summaries,
        }
        phase_reports.append(report)
        (output / "phase-summary" / f"{phase}.json").parent.mkdir(parents=True, exist_ok=True)
        (output / "phase-summary" / f"{phase}.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print("TASK9_FIXED_PHASE_COMPLETE", json.dumps({"phase": phase, "selection": selection}, ensure_ascii=False), flush=True)

    final_cumulative_gate = _final_cumulative_gate(current_baseline, initial_baseline)
    final_cumulative = {
        str(cost): {
            key: current_baseline[cost].get(key)
            for key in (
                "final_equity_jpy",
                "profit_factor",
                "maximum_mtm_drawdown_pct",
                "win_rate",
                "closed_trades",
                "strategy_trades",
                "strategy_pnl_jpy",
                "accounting",
                "oos",
            )
        }
        for cost in (10, 30)
    }
    final = {
        "status": "COMPLETE_RESEARCH_ONLY_NONCANONICAL",
        "classification": "RESEARCH_ONLY_NONCANONICAL",
        "replay_contract": "FIXED_ACCEPTED_LEDGER_LIFECYCLE_OVERLAY",
        "production_changes": 0,
        "phase_reports": phase_reports,
        "accepted_cumulative_overlays": cumulative,
        "final_cumulative": final_cumulative,
        "final_cumulative_gate": final_cumulative_gate,
        "baseline": summaries,
        "source_sha256": {
            "task9_audit": sha256_file(TASK9_PATH),
            "fixed_replay": sha256_file(Path(__file__)),
        },
    }
    (output / "task9-fixed-replay-summary.json").write_text(
        json.dumps(final, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("TASK9_FIXED_REPLAY_COMPLETE", output, flush=True)


if __name__ == "__main__":
    main()
