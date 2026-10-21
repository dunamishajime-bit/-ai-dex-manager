"""Task 9 P0/P3/P5 read-only diagnostics.

This produces auditable loss-path, MTM exposure, concentration, preemption,
and top-DD-window evidence from the fixed accepted baseline.  It is research
only and does not touch Production, VPS, LIVE, or a venue.
"""
from __future__ import annotations

import bisect
import collections
import json
from pathlib import Path

from task9_fixed_ledger_replay_20261020 import (
    OUTPUT,
    PERIOD_END,
    PERIOD_START,
    _H1Source,
    _jsonl,
    _partial_events,
    load_canonical,
    sha256_file,
    t9,
)


OUT = OUTPUT / "fixed-ledger-replay" / "p0-p3-p5-diagnostics"
H1 = 3_600_000


class _FallbackSource:
    """Use the frozen H1 source first, with the saved 5m source for V52 stock."""

    def __init__(self, primary, fallback):
        self.primary = primary
        self.fallback = fallback
        self.fallback_symbols: set[str] = set()

    def getdata(self, symbol: str):
        try:
            return self.primary.getdata(symbol)
        except KeyError:
            self.fallback_symbols.add(symbol)
            return self.fallback.getdata(symbol)


def _bootstrap_sources():
    t9.Path.write_text = t9._redirect_legacy_write_text
    source, helper = t9.task8.legacy.bootstrap()
    t9.Path.write_text = t9._path_write_text
    return source, _FallbackSource(_H1Source(helper.base.s.w.bars), source)


def _empty_counter():
    return {"trades": 0, "wins": 0, "losses": 0, "unsettled": 0,
            "positive_to_negative": 0, "plus1_to_negative": 0,
            "plus3_to_negative": 0, "plus5_to_negative": 0,
            "final_loss_after_positive": 0, "final_win_after_positive": 0,
            "breakeven_crossed_twice": 0, "initial_bar_adverse": 0,
            "persistent_initial_adverse_3bars": 0,
            "mfe_avg_pct": 0.0, "mae_avg_pct": 0.0,
            "giveback_avg_pct": 0.0}


def _loss_path(rows: list[dict], source) -> dict:
    groups: dict[str, dict] = collections.defaultdict(_empty_counter)
    examples = []
    for row in rows:
        path = t9._path_for_row(row, source)
        if not path.get("valid"):
            continue
        outcome = t9.classify_pnl(row)
        status = outcome["status"]
        points = path["points"]
        returns = [100.0 * float(point["mark_return"]) for point in points]
        final_return = 100.0 * t9.directional_return(
            float(row["entry_price"]), float(row["exit_price"]), str(row["side"])
        )
        key_list = ["__ALL__", str(row["side"]), str(row["strategy_id"]),
                    f"{row['strategy_id']}:{row['side']}"]
        first_positive_index = next(
            (index for index, value in enumerate(returns) if value > 0),
            None,
        )
        positive_to_negative = (
            first_positive_index is not None
            and any(value < 0 for value in returns[first_positive_index + 1:])
        )
        for key in key_list:
            item = groups[key]
            item["trades"] += 1
            item[{"WIN": "wins", "LOSS": "losses", "UNSETTLED": "unsettled"}.get(status, "unsettled")] += 1
            item["positive_to_negative"] += int(positive_to_negative)
            for threshold, field in ((1.0, "plus1_to_negative"), (3.0, "plus3_to_negative"), (5.0, "plus5_to_negative")):
                reached = any(x >= threshold for x in returns)
                after = False
                for index, value in enumerate(returns):
                    if value >= threshold:
                        after = any(later < 0 for later in returns[index + 1:])
                        break
                item[field] += int(reached and after)
            if any(x > 0 for x in returns):
                first_positive = next(index for index, value in enumerate(returns) if value > 0)
                item["final_loss_after_positive"] += int(status == "LOSS" and final_return < 0)
                item["final_win_after_positive"] += int(status == "WIN" and final_return > 0)
                signs = [value >= 0 for value in returns[first_positive:]]
                crossings = sum(left != right for left, right in zip(signs, signs[1:]))
                item["breakeven_crossed_twice"] += int(crossings >= 2)
            item["initial_bar_adverse"] += int(bool(points) and points[0]["adverse"] < 0)
            item["persistent_initial_adverse_3bars"] += int(
                len(points) >= 3 and all(point["mark_return"] < 0 for point in points[:3])
            )
            item["mfe_avg_pct"] += float(path["mfe_pct"])
            item["mae_avg_pct"] += float(path["mae_pct"])
            item["giveback_avg_pct"] += float(path["mfe_pct"]) - final_return
        if status in {"WIN", "LOSS"} and len(examples) < 250:
            examples.append({
                "position_id": row.get("position_id"),
                "strategy_id": row.get("strategy_id"),
                "symbol": row.get("symbol"),
                "side": row.get("side"),
                "outcome": status,
                "mfe_pct": path["mfe_pct"],
                "mae_pct": path["mae_pct"],
                "final_directional_return_pct": final_return,
                "giveback_pct": float(path["mfe_pct"]) - final_return,
                "first_negative_ts_ms": path.get("first_negative_ts_ms"),
                "first_adverse_ts_ms": path.get("first_adverse_ts_ms"),
            })
    for item in groups.values():
        trades = item["trades"] or 1
        for field in ("mfe_avg_pct", "mae_avg_pct", "giveback_avg_pct"):
            item[field] /= trades
    return {"groups": dict(groups), "examples": examples}


def _mark_at(source, symbol: str, timestamp: int):
    bars, times = source.getdata(symbol)
    index = bisect.bisect_right(times, timestamp) - 1
    if index < 0:
        return None
    # Frozen H1 anchor mark: current bar open at exact H1 timestamp.
    return float(bars[index][1])


def _top_dd_windows(timeline: list[dict], limit: int = 5) -> list[dict]:
    windows = []
    peak_ts = peak_equity = trough_ts = trough_equity = None
    for point in timeline:
        timestamp = int(point["ts_ms"])
        equity = float(point["equity_jpy"])
        if peak_equity is None or equity > peak_equity:
            if trough_ts is not None:
                windows.append({
                    "peak_ts_ms": peak_ts,
                    "peak_equity_jpy": peak_equity,
                    "trough_ts_ms": trough_ts,
                    "trough_equity_jpy": trough_equity,
                    "recovery_ts_ms": timestamp,
                    "drawdown_pct": 100.0 * (trough_equity / peak_equity - 1.0),
                })
            peak_ts, peak_equity = timestamp, equity
            trough_ts = trough_equity = None
        elif trough_ts is None or equity < trough_equity:
            trough_ts, trough_equity = timestamp, equity
    if trough_ts is not None and peak_equity:
        windows.append({
            "peak_ts_ms": peak_ts,
            "peak_equity_jpy": peak_equity,
            "trough_ts_ms": trough_ts,
            "trough_equity_jpy": trough_equity,
            "recovery_ts_ms": None,
            "drawdown_pct": 100.0 * (trough_equity / peak_equity - 1.0),
        })
    selected = []
    for window in sorted(windows, key=lambda item: item["drawdown_pct"]):
        if all(
            window["trough_ts_ms"] < old["peak_ts_ms"]
            or old["trough_ts_ms"] < window["peak_ts_ms"]
            for old in selected
        ):
            selected.append(window)
        if len(selected) >= limit:
            break
    return selected


def _exposure(rows: list[dict], events: list[dict], source, timeline: list[dict]) -> dict:
    by_entry = sorted(rows, key=lambda row: (int(row["entry_ts_ms"]), int(row.get("position_id", 0))))
    partials: dict[str, list[dict]] = collections.defaultdict(list)
    for event in events:
        if event.get("event_type") in {"MODELED_PARTIAL_EXIT", "HYPE_PRIORITY_PARTIAL_EXIT"}:
            partials[str(event.get("position_id"))].append(event)
    active: dict[str, dict] = {}
    cursor = 0
    maxes = {"open_positions": 0, "gross": 0.0, "same_side_gross": 0.0, "crypto_gross": 0.0}
    additions_while_loss = []
    strategy_gross_peak = collections.defaultdict(float)
    side_gross_peak = collections.defaultdict(float)
    exposure_points = []
    for timestamp in range(PERIOD_START, PERIOD_END + 1, H1):
        # Exit at the observation timestamp is no longer active; then add
        # entries at that timestamp, matching the frozen engine ordering.
        for position_id in [pid for pid, row in active.items() if int(row["exit_ts_ms"]) <= timestamp]:
            del active[position_id]
        while cursor < len(by_entry) and int(by_entry[cursor]["entry_ts_ms"]) <= timestamp:
            row = by_entry[cursor]
            current_group = [item for item in active.values()
                             if str(item["symbol"]) == str(row["symbol"])
                             and str(item["side"]) == str(row["side"])]
            if current_group:
                current_unrealized = 0.0
                for existing in current_group:
                    mark = _mark_at(source, str(existing["symbol"]), timestamp)
                    if mark is None:
                        continue
                    sign = 1.0 if existing["side"] == "LONG" else -1.0
                    current_unrealized += sign * (mark - float(existing["entry_price"])) * float(existing["quantity"])
                if current_unrealized < 0:
                    additions_while_loss.append({
                        "timestamp": timestamp,
                        "position_id": row.get("position_id"),
                        "symbol": row.get("symbol"),
                        "side": row.get("side"),
                        "strategy_id": row.get("strategy_id"),
                        "existing_unrealized_settlement": current_unrealized,
                        "existing_position_ids": [item.get("position_id") for item in current_group],
                    })
            active[str(row.get("position_id"))] = row
            cursor += 1
        gross = 0.0
        unrealized = 0.0
        by_strategy = collections.defaultdict(float)
        by_side = collections.defaultdict(float)
        by_symbol = collections.defaultdict(float)
        for row in active.values():
            original_qty = float(row.get("original_quantity") or row.get("quantity") or 0.0)
            qty = original_qty - sum(
                float(event.get("quantity") or 0.0)
                for event in partials.get(str(row.get("position_id")), [])
                if int(event["ts_ms"]) <= timestamp
            )
            if qty <= 0 or original_qty <= 0:
                continue
            mark = _mark_at(source, str(row["symbol"]), timestamp)
            if mark is None:
                continue
            sign = 1.0 if row["side"] == "LONG" else -1.0
            unrealized += sign * (mark - float(row["entry_price"])) * qty
            row_gross = float(row.get("accepted_gross") or 0.0) * qty / original_qty
            gross += row_gross
            by_strategy[str(row["strategy_id"])] += row_gross
            by_side[str(row["side"])] += row_gross
            by_symbol[str(row["symbol"])] += row_gross
        maxes["open_positions"] = max(maxes["open_positions"], len(active))
        maxes["gross"] = max(maxes["gross"], gross)
        maxes["same_side_gross"] = max(maxes["same_side_gross"], max(by_side.values(), default=0.0))
        maxes["crypto_gross"] = max(maxes["crypto_gross"], gross)
        for key, value in by_strategy.items():
            strategy_gross_peak[key] = max(strategy_gross_peak[key], value)
        for key, value in by_side.items():
            side_gross_peak[key] = max(side_gross_peak[key], value)
        exposure_points.append({
            "ts_ms": timestamp,
            "gross": gross,
            "unrealized_settlement": unrealized,
            "open_positions": len(active),
            "by_strategy_gross": dict(by_strategy),
            "by_side_gross": dict(by_side),
            "by_symbol_gross": dict(by_symbol),
        })
    reason_counts = collections.Counter()
    pnl_by_reason = collections.defaultdict(float)
    pnl_by_strategy = collections.defaultdict(float)
    for row in rows:
        reason = str(row.get("exit_reason_actual") or row.get("exit_reason") or "UNKNOWN")
        pnl = t9.classify_pnl(row)["value"]
        reason_counts[reason] += 1
        if isinstance(pnl, (int, float)):
            pnl_by_reason[reason] += pnl
            pnl_by_strategy[str(row.get("strategy_id"))] += pnl
    preemption_rows = [
        {
            "position_id": row.get("position_id"),
            "strategy_id": row.get("strategy_id"),
            "symbol": row.get("symbol"),
            "side": row.get("side"),
            "exit_reason": row.get("exit_reason_actual") or row.get("exit_reason"),
            "total_pnl_jpy": row.get("total_pnl_jpy"),
        }
        for row in rows
        if any(token in str(row.get("exit_reason_actual") or row.get("exit_reason") or "").upper()
               for token in ("PREEMPT", "PRIORITY", "HANDOFF"))
    ]
    return {
        "max_open_positions": maxes["open_positions"],
        "max_gross": maxes["gross"],
        "max_same_side_gross": maxes["same_side_gross"],
        "max_crypto_gross": maxes["crypto_gross"],
        "peak_gross_by_strategy": dict(strategy_gross_peak),
        "peak_gross_by_side": dict(side_gross_peak),
        "additions_while_same_symbol_side_unrealized_loss_count": len(additions_while_loss),
        "additions_while_same_symbol_side_unrealized_loss": additions_while_loss,
        "exit_reason_counts": dict(reason_counts),
        "pnl_by_exit_reason_jpy": dict(pnl_by_reason),
        "pnl_by_strategy_jpy": dict(pnl_by_strategy),
        "preemption_count": len(preemption_rows),
        "preemption_rows": preemption_rows,
        "exposure_timeline": exposure_points,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    source, h1_source = _bootstrap_sources()
    result = {
        "status": "COMPLETE_RESEARCH_ONLY_NONCANONICAL",
        "production_changes": 0,
        "costs": {},
        "source_sha256": {
            "script": sha256_file(Path(__file__)),
            "fixed_replay": sha256_file(Path(__file__).with_name("task9_fixed_ledger_replay_20261020.py")),
            "task9_audit": sha256_file(Path(t9.__file__)),
        },
    }
    for cost in (10, 30):
        rows, events, ledger, event_file = load_canonical(cost)
        timeline_path = OUTPUT / "fixed-ledger-replay" / "BASELINE" / f"{cost}bps" / "mtm" / "fixed-ledger-timeline.jsonl"
        timeline = _jsonl(timeline_path)
        dd_windows = json.loads((OUTPUT / "fixed-ledger-replay" / f"baseline-control-{cost}bps.json").read_text())
        diagnostics = {
            "cost_bps": cost,
            "ledger_sha256": sha256_file(ledger),
            "events_sha256": sha256_file(event_file),
            "loss_path": _loss_path(rows, source),
            "exposure": _exposure(rows, events, h1_source, timeline),
            "h1_source_fallback_symbols": sorted(h1_source.fallback_symbols),
            "top5_independent_dd_windows": _top_dd_windows(timeline),
            "dd_control": dd_windows,
            "mtm_timeline_sha256": sha256_file(timeline_path),
        }
        (OUT / f"p0-p3-p5-{cost}bps.json").write_text(
            json.dumps(diagnostics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        result["costs"][str(cost)] = diagnostics
    # The compact report keeps the full exposure timeline in per-cost files,
    # while the index records hashes and the headline diagnostics.
    index = {
        "status": result["status"],
        "production_changes": 0,
        "files": {
            str(cost): sha256_file(OUT / f"p0-p3-p5-{cost}bps.json") for cost in (10, 30)
        },
        "headlines": {
            str(cost): {
                "max_gross": result["costs"][str(cost)]["exposure"]["max_gross"],
                "max_open_positions": result["costs"][str(cost)]["exposure"]["max_open_positions"],
                "same_symbol_loss_additions": result["costs"][str(cost)]["exposure"]["additions_while_same_symbol_side_unrealized_loss_count"],
                "preemption_count": result["costs"][str(cost)]["exposure"]["preemption_count"],
            }
            for cost in (10, 30)
        },
    }
    (OUT / "p0-p3-p5-index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("TASK9_P0_P3_P5_DIAGNOSTICS_COMPLETE", OUT, flush=True)


if __name__ == "__main__":
    main()
