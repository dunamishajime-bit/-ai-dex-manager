#!/usr/bin/env python3
"""Research-only initial-adverse-stop and integrated DD study.

The fixed 2026-10-17 eight-logic H1 price-model replay is the immutable
baseline.  This script first produces causal loss-path diagnostics, then
evaluates predeclared initial-adverse-stop overlays in cumulative strategy
order.  It never changes Production, VPS, LIVE, HP, operator artifacts, or
real orders.
"""
from __future__ import annotations

import bisect
import hashlib
import json
import math
import statistics
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


FROZEN_ROOT = Path(r"C:/Users/dis/DisDex-five-improvements-20261008")
OUTPUT = Path(
    r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/"
    r"2026-10-20_dd-reduction-initial-adverse-stop"
)
BOOTSTRAP_REDIRECT = OUTPUT / "_legacy-bootstrap-cache"

PERIOD_START = 1754784000000
PERIOD_END = 1786320000000
OOS_BOUNDARY = PERIOD_START + int((PERIOD_END - PERIOD_START) * 0.70)
M5 = 300_000
HOUR = 3_600_000
HORIZONS_HOURS = (1, 2, 3, 4, 6, 12, 24)

BASELINE_EXPECTED = {
    10: {
        "final": 222818966.87803495,
        "pf": 3.4587962777009813,
        "dd": -15.62063681288941,
        "trades": 1310,
    },
    30: {
        "final": 124289206.81827945,
        "pf": 3.0785603081685435,
        "dd": -16.78776877493442,
        "trades": 1307,
    },
}

_path_write_text = Path.write_text


def _redirect_legacy_write_text(self: Path, data, *args, **kwargs):
    raw = str(self)
    frozen = str(FROZEN_ROOT)
    if raw.lower().startswith(frozen.lower()):
        relative = Path(raw[len(frozen):].lstrip("\\/"))
        target = BOOTSTRAP_REDIRECT / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        return _path_write_text(target, data, *args, **kwargs)
    return _path_write_text(self, data, *args, **kwargs)


def _ensure_research_output_parent_write_text(self: Path, data, *args, **kwargs):
    """Create parents for files emitted by the frozen research adapter only."""
    output_prefix = str(OUTPUT).lower()
    if str(self).lower().startswith(output_prefix):
        self.parent.mkdir(parents=True, exist_ok=True)
    return _path_write_text(self, data, *args, **kwargs)


# The legacy research bootstrap writes one warm-up cache below FROZEN_ROOT.
# Redirect only that write; the source checkout remains read-only.
Path.write_text = _redirect_legacy_write_text
LEGACY_DIR = Path(r"C:/Users/dis/.codex/worktrees/dd-reduction-sequential-20261019/-ai-dex-manager/scripts/dd-reduction")
sys.path.insert(0, str(LEGACY_DIR))
import task8_v12_long_noncanonical_20261020 as task8  # noqa: E402

Path.write_text = _path_write_text


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def directional_return(entry: float, price: float, side: str) -> float:
    """Return price movement in the position's favorable direction."""
    sign = 1.0 if side == "LONG" else -1.0
    return sign * (price / entry - 1.0)


def directional_excursion(entry: float, high: float, low: float, side: str) -> dict[str, float]:
    if side == "LONG":
        return {"favorable": high / entry - 1.0, "adverse": low / entry - 1.0}
    return {"favorable": entry / low - 1.0, "adverse": entry / high - 1.0}


def should_trigger_initial_stop(prior_mfe: float, mfe_gate: float | None) -> bool:
    return mfe_gate is None or prior_mfe < mfe_gate


def stop_price_for_adverse_pct(entry: float, adverse_pct: float, side: str) -> float:
    if side == "LONG":
        return entry * (1.0 + adverse_pct)
    return entry * (1.0 - adverse_pct)


def stop_touched(open_price: float, high: float, low: float,
                 side: str, stop_price: float) -> bool:
    if side == "LONG":
        return open_price <= stop_price or low <= stop_price
    return open_price >= stop_price or high >= stop_price


def reentry_allowed(last_stop_ts: int, entry_ts: int, holdoff_hours: float,
                    stopped_side: str, entry_side: str) -> bool:
    if stopped_side != entry_side:
        return True
    return entry_ts >= last_stop_ts + int(holdoff_hours * HOUR)


def structure_confirmed(bars: list[tuple], index: int, entry: float,
                        side: str, window: int = 3,
                        min_adverse_closes: int | None = None) -> bool:
    """Check only completed bars strictly before ``index``.

    This causal, direction-symmetric filter is used only by composite
    candidates. It requires recent closes to remain on the adverse side of
    entry and enough of them to continue in that direction. The current bar
    is never used to decide whether the structure gate is true.
    """
    if window <= 0 or index < window or entry <= 0:
        return False
    closes = [float(bars[j][4]) for j in range(index - window, index)]
    if len(closes) != window:
        return False
    required = min_adverse_closes if min_adverse_closes is not None else window
    required = max(1, min(window, int(required)))
    if side == "LONG":
        adverse = [close < entry for close in closes]
        continuing = [closes[j] <= closes[j - 1] for j in range(1, len(closes))]
    else:
        adverse = [close > entry for close in closes]
        continuing = [closes[j] >= closes[j - 1] for j in range(1, len(closes))]
    return sum(adverse) == window and sum(continuing) >= required - 1


def _read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text("utf-8").splitlines() if line.strip()]


def _ledger_path(out_root: Path, policy_name: str, cost_bps: int) -> Path:
    paths = list(
        (out_root / policy_name / f"{cost_bps}bps" / "cases" /
         "V2_M150_D05_CORE_NATIVE" / "runs").glob("*/portfolio-trades.jsonl")
    )
    if len(paths) != 1:
        raise RuntimeError(f"expected one ledger for {policy_name}/{cost_bps}, got {paths}")
    return paths[0]


def _event_path(out_root: Path, policy_name: str, cost_bps: int) -> Path:
    return _ledger_path(out_root, policy_name, cost_bps).with_name("portfolio-events.jsonl")


def _profit_factor(rows: list[dict]) -> float | None:
    wins = sum(float(row.get("total_pnl_jpy", 0.0)) for row in rows if float(row.get("total_pnl_jpy", 0.0)) > 0)
    losses = abs(sum(float(row.get("total_pnl_jpy", 0.0)) for row in rows if float(row.get("total_pnl_jpy", 0.0)) < 0))
    return wins / losses if losses else None


def _max_loss_streak(rows: list[dict]) -> int:
    best = current = 0
    for row in sorted(rows, key=lambda item: int(item["exit_ts_ms"])):
        if float(row.get("total_pnl_jpy", 0.0)) < 0:
            current += 1
            best = max(best, current)
        else:
            current = 0
    return best


def _oos_metrics(rows: list[dict], cost_bps: int) -> dict:
    selected = [row for row in rows if int(row["exit_ts_ms"]) >= OOS_BOUNDARY]
    pnls = [float(row.get("total_pnl_jpy", 0.0)) for row in selected]
    wins = [value for value in pnls if value > 0]
    losses = [value for value in pnls if value < 0]
    equity = peak = max_dd = 0.0
    for pnl in pnls:
        equity += pnl
        peak = max(peak, equity)
        max_dd = min(max_dd, equity - peak)
    return {
        "boundary_utc": datetime.fromtimestamp(OOS_BOUNDARY / 1000, timezone.utc).isoformat(),
        "trades": len(pnls),
        "net_pnl_jpy": sum(pnls),
        "profit_factor": sum(wins) / abs(sum(losses)) if losses else None,
        "win_rate": len(wins) / len(pnls) if pnls else None,
        "max_cumulative_pnl_drawdown_jpy": max_dd,
        "cost_bps": cost_bps,
    }


def _data_quality(source, symbols: set[str]) -> dict:
    result: dict[str, dict] = {}
    for symbol in sorted(symbols | {"BTCUSDT"}):
        bars, _times = source.getdata(symbol)
        gaps = sum(1 for left, right in zip(bars, bars[1:]) if right[0] - left[0] != M5)
        duplicate = len(bars) - len({int(row[0]) for row in bars})
        result[symbol] = {
            "rows": len(bars),
            "first_ts_ms": bars[0][0] if bars else None,
            "last_ts_ms": bars[-1][0] if bars else None,
            "missing_5m_intervals": gaps,
            "duplicate_timestamps": duplicate,
        }
    return result


def _path_for_row(row: dict, source) -> dict:
    entry = float(row["entry_price"])
    entry_ts = int(row["entry_ts_ms"])
    exit_ts = int(row["exit_ts_ms"])
    side = str(row["side"])
    bars, times = source.getdata(str(row["symbol"]))
    start = bisect.bisect_left(times, entry_ts)
    end = bisect.bisect_left(times, exit_ts)
    if start >= len(bars) or start >= end or times[start] > entry_ts + M5:
        return {"valid": False, "reason": "ENTRY_DATA_GAP"}
    if abs(float(bars[start][1]) / entry - 1.0) > 0.025:
        return {"valid": False, "reason": "ENTRY_PRICE_MISMATCH"}
    scale = entry / float(bars[start][1])
    points = []
    peak = -math.inf
    trough = math.inf
    first_negative = None
    first_adverse = None
    crossed_profit_then_negative = False
    saw_profit = False
    for index in range(start, end):
        timestamp, op, high, low, close, _volume = bars[index]
        if index > start and timestamp - bars[index - 1][0] != M5:
            return {"valid": False, "reason": "INTERNAL_5M_GAP"}
        op *= scale
        high *= scale
        low *= scale
        close *= scale
        mark = directional_return(entry, close, side)
        excursion = directional_excursion(entry, high, low, side)
        peak = max(peak, excursion["favorable"])
        trough = min(trough, excursion["adverse"])
        if mark < 0 and first_negative is None:
            first_negative = timestamp
        if excursion["adverse"] < 0 and first_adverse is None:
            first_adverse = timestamp
        if mark > 0:
            saw_profit = True
        if saw_profit and mark < 0:
            crossed_profit_then_negative = True
        points.append({
            "ts_ms": timestamp,
            "open": op,
            "high": high,
            "low": low,
            "close": close,
            "mark_return": mark,
            "favorable": excursion["favorable"],
            "adverse": excursion["adverse"],
        })
    horizons: dict[str, dict | None] = {}
    for hours in HORIZONS_HOURS:
        target = entry_ts + hours * HOUR
        eligible = [point for point in points if point["ts_ms"] >= target]
        if not eligible:
            horizons[str(hours)] = None
            continue
        sample = eligible[0]
        until = [point for point in points if point["ts_ms"] <= sample["ts_ms"]]
        horizons[str(hours)] = {
            "mark_return_pct": 100.0 * sample["mark_return"],
            "mfe_pct": 100.0 * max(point["favorable"] for point in until),
            "mae_pct": 100.0 * min(point["adverse"] for point in until),
            "ts_ms": sample["ts_ms"],
        }
    return {
        "valid": True,
        "points": points,
        "horizons": horizons,
        "mfe_pct": 100.0 * peak,
        "mae_pct": 100.0 * trough,
        "first_negative_ts_ms": first_negative,
        "first_adverse_ts_ms": first_adverse,
        "crossed_profit_then_negative": crossed_profit_then_negative,
        "holding_hours": (exit_ts - entry_ts) / HOUR,
    }


def build_loss_path_diagnostics(rows: list[dict], source, cost_bps: int) -> dict:
    by_side: dict[str, dict] = {}
    by_strategy: dict[str, dict] = {}
    horizon_acc: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    threshold_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    valid_paths = invalid_paths = 0
    profit_to_negative = 0
    no_1pct_mfe_losses = 0
    first_negative_hours: list[float] = []
    all_paths: list[tuple[dict, dict]] = []
    for row in rows:
        path = _path_for_row(row, source)
        if not path.get("valid"):
            invalid_paths += 1
            continue
        valid_paths += 1
        all_paths.append((row, path))
        side = str(row["side"])
        strategy = str(row["strategy_id"])
        for key in ("__ALL__", side, strategy, f"{strategy}:{side}"):
            target = by_side.setdefault(key, {"trades": 0, "wins": 0, "losses": 0, "mfe": [], "mae": [], "profit_to_negative": 0, "never_1pct_mfe_loss": 0})
            target["trades"] += 1
            pnl = float(row.get("total_pnl_jpy", 0.0))
            target["wins" if pnl > 0 else "losses"] += 1
            target["mfe"].append(path["mfe_pct"])
            target["mae"].append(path["mae_pct"])
            if path["crossed_profit_then_negative"]:
                target["profit_to_negative"] += 1
            if pnl < 0 and path["mfe_pct"] < 1.0:
                target["never_1pct_mfe_loss"] += 1
        for hours, value in path["horizons"].items():
            if value is None:
                continue
            horizon_acc[f"{strategy}:{side}"][hours].append(value["mark_return_pct"])
        pnl = float(row.get("total_pnl_jpy", 0.0))
        for threshold in (1.0, 2.0, 3.0, 5.0):
            if path["mae_pct"] <= -threshold:
                threshold_counts[f"{strategy}:{side}"][f"wins_reached_adverse_{threshold:g}pct"] += int(pnl > 0)
                threshold_counts[f"{strategy}:{side}"][f"losses_reached_adverse_{threshold:g}pct"] += int(pnl < 0)
        if path["crossed_profit_then_negative"]:
            profit_to_negative += 1
        if pnl < 0 and path["mfe_pct"] < 1.0:
            no_1pct_mfe_losses += 1
        if path["first_negative_ts_ms"] is not None:
            first_negative_hours.append((path["first_negative_ts_ms"] - int(row["entry_ts_ms"])) / HOUR)
    summary = {}
    for key, value in by_side.items():
        summary[key] = {
            "trades": value["trades"],
            "wins": value["wins"],
            "losses": value["losses"],
            "mfe_avg_pct": statistics.fmean(value["mfe"]) if value["mfe"] else None,
            "mae_avg_pct": statistics.fmean(value["mae"]) if value["mae"] else None,
            "mae_worst_pct": min(value["mae"]) if value["mae"] else None,
            "profit_to_negative": value["profit_to_negative"],
            "never_1pct_mfe_loss": value["never_1pct_mfe_loss"],
        }
    horizons = {
        key: {
            hour: {
                "n": len(values),
                "avg_mark_return_pct": statistics.fmean(values) if values else None,
                "median_mark_return_pct": statistics.median(values) if values else None,
                "loss_rate": sum(value < 0 for value in values) / len(values) if values else None,
            }
            for hour, values in per_hour.items()
        }
        for key, per_hour in horizon_acc.items()
    }
    return {
        "cost_bps": cost_bps,
        "valid_paths": valid_paths,
        "invalid_paths": invalid_paths,
        "by_side_strategy": summary,
        "horizon_mark_returns_pct": horizons,
        "threshold_counts": {key: dict(value) for key, value in threshold_counts.items()},
        "profit_to_negative_total": profit_to_negative,
        "losses_without_1pct_mfe_total": no_1pct_mfe_losses,
        "first_negative_hours_avg": statistics.fmean(first_negative_hours) if first_negative_hours else None,
        "first_negative_hours_median": statistics.median(first_negative_hours) if first_negative_hours else None,
        "loss_causes": loss_causes(rows),
    }


def loss_causes(rows: list[dict]) -> dict:
    result: dict[str, dict] = {}
    for row in rows:
        reason = str(row.get("exit_reason_actual") or row.get("exit_reason") or "UNKNOWN")
        strategy = str(row.get("strategy_id"))
        side = str(row.get("side"))
        key = f"{strategy}:{side}:{reason}"
        item = result.setdefault(key, {"trades": 0, "losses": 0, "pnl_jpy": 0.0})
        pnl = float(row.get("total_pnl_jpy", 0.0))
        item["trades"] += 1
        item["losses"] += int(pnl < 0)
        item["pnl_jpy"] += pnl
    return result


def realized_dd_window(rows: list[dict], events: list[dict]) -> dict:
    """Return an auditable realized-event DD proxy and contribution window.

    The fixed ledger exposes wallet-after-event but not a full MTM time series.
    The engine's exact MTM DD remains the authoritative percentage.  This
    proxy identifies the closest auditable loss window without pretending it
    is a signed venue MTM series.
    """
    points = []
    for event in events:
        if "wallet_after_event" in event and "ts_ms" in event:
            points.append((int(event["ts_ms"]), float(event["wallet_after_event"])))
    points.sort()
    if not points:
        return {"status": "NO_WALLET_EVENT_SERIES"}
    peak_value = points[0][1]
    peak_ts = points[0][0]
    trough_value = points[0][1]
    trough_ts = points[0][0]
    best = {"drawdown": 0.0, "peak_ts_ms": peak_ts, "trough_ts_ms": trough_ts, "recovery_ts_ms": None}
    for ts, value in points:
        if value > peak_value:
            peak_value = value
            peak_ts = ts
        drawdown = value - peak_value
        if drawdown < best["drawdown"]:
            best = {"drawdown": drawdown, "peak_ts_ms": peak_ts, "trough_ts_ms": ts, "recovery_ts_ms": None}
        elif best["recovery_ts_ms"] is None and ts > best["trough_ts_ms"] and value >= peak_value:
            best["recovery_ts_ms"] = ts
    start = best["peak_ts_ms"]
    end = best["recovery_ts_ms"] or best["trough_ts_ms"]
    contributors = defaultdict(lambda: {"trades": 0, "pnl_jpy": 0.0})
    for row in rows:
        exit_ts = int(row["exit_ts_ms"])
        if start <= exit_ts <= end:
            key = f"{row.get('strategy_id')}:{row.get('side')}"
            contributors[key]["trades"] += 1
            contributors[key]["pnl_jpy"] += float(row.get("total_pnl_jpy", 0.0))
    return {
        "status": "REALIZED_EVENT_DD_PROXY",
        "peak_ts_ms": start,
        "trough_ts_ms": best["trough_ts_ms"],
        "recovery_ts_ms": best["recovery_ts_ms"],
        "drawdown_settlement": best["drawdown"],
        "contributors": dict(contributors),
        "limitation": "wallet-after-event proxy; not full MTM series",
    }


def _atr_pct_before(bars: list[tuple], index: int, entry: float, scale: float) -> float | None:
    if index < 25 or entry <= 0:
        return None
    ranges = []
    for j in range(index - 24, index):
        _t, _op, high, low, close, _vol = bars[j]
        previous_close = bars[j - 1][4]
        ranges.append(max(high - low, abs(high - previous_close), abs(low - previous_close)) * scale)
    return statistics.fmean(ranges) / entry if ranges else None


def _matches(row: dict, overlay: dict) -> bool:
    if row.get("strategy_id") != overlay["strategy"]:
        return False
    sides = overlay.get("sides")
    return not sides or row.get("side") in sides


def _apply_initial_stop(row: dict, overlay: dict, source, cost_bps: int, obs: dict) -> dict:
    if not _matches(row, overlay):
        return row
    entry = float(row["entry_price"])
    entry_ts = int(row["entry_ts_ms"])
    original_exit = int(row["exit_ts_ms"])
    side = str(row["side"])
    if entry <= 0 or original_exit <= entry_ts + M5:
        return row
    bars, times = source.getdata(str(row["symbol"]))
    start = bisect.bisect_left(times, entry_ts)
    end = bisect.bisect_left(times, original_exit)
    if start >= len(bars) or start >= end or times[start] > entry_ts + M5:
        obs["data_gap"] += 1
        return row
    first_open = float(bars[start][1])
    if abs(first_open / entry - 1.0) > 0.025:
        obs["entry_mismatch"] += 1
        return row
    scale = entry / first_open
    distance = abs(float(overlay.get("stop_pct", 0.0)))
    if overlay.get("atr_mult") is not None:
        atr_pct = _atr_pct_before(bars, start, entry, scale)
        if atr_pct is None:
            obs["atr_unavailable"] += 1
            return row
        distance = max(float(overlay.get("atr_floor_pct", 0.01)),
                       min(float(overlay.get("atr_cap_pct", 0.05)),
                           atr_pct * float(overlay["atr_mult"])))
    if distance <= 0 or not math.isfinite(distance):
        obs["invalid_input"] += 1
        return row
    stop = stop_price_for_adverse_pct(entry, -distance, side)
    arm_ts = entry_ts + int(float(overlay["arm_hours"]) * HOUR)
    mfe_gate = overlay.get("mfe_gate_pct")
    peak = 0.0
    obs["eligible"] += 1
    for index in range(start, end):
        timestamp, op, high, low, close, _volume = bars[index]
        if index > start and timestamp - bars[index - 1][0] != M5:
            obs["internal_gap"] += 1
            return row
        op *= scale
        high *= scale
        low *= scale
        close *= scale
        # A stop armed on the prior completed bar is evaluated before this
        # bar updates peak MFE, keeping same-bar ordering deterministic.
        if timestamp >= arm_ts and should_trigger_initial_stop(peak, mfe_gate) and stop_touched(op, high, low, side, stop):
            structure_window = int(overlay.get("structure_bars", 0) or 0)
            if structure_window and not structure_confirmed(
                bars, index, entry, side, structure_window,
                overlay.get("structure_min_adverse_closes")
            ):
                obs["structure_unconfirmed"] += 1
                peak = max(peak, directional_excursion(entry, high, low, side)["favorable"])
                continue
            sign = 1.0 if side == "LONG" else -1.0
            fill = min(op, stop) if side == "LONG" else max(op, stop)
            fill *= 1.0 - sign * float(overlay.get("slip_bps", cost_bps)) / 10000.0
            exit_ts = timestamp + M5
            if exit_ts < original_exit and fill > 0:
                obs["triggered"] += 1
                obs["by_reason"]["INITIAL_ADVERSE_STOP"] += 1
                original_pnl = float(row.get("total_pnl_jpy", 0.0))
                obs["original_winner_triggered" if original_pnl > 0 else "original_loser_triggered"] += 1
                return dict(
                    row,
                    exit_ts_ms=exit_ts,
                    exit_price=fill,
                    exit_reason=f"RESEARCH_INITIAL_ADVERSE_STOP_{overlay['id']}",
                    unit_price_return=sign * (fill / entry - 1.0),
                )
        peak = max(peak, directional_excursion(entry, high, low, side)["favorable"])
    return row


def _transform_rows(rows: list[dict], overlays: list[dict], source, cost_bps: int, obs: dict) -> list[dict]:
    ordered = sorted(rows, key=lambda row: (int(row["entry_ts_ms"]), int(row.get("position_id", 0))))
    output = []
    last_stop: dict[tuple[str, str, str], int] = {}
    for row in ordered:
        current = row
        blocked = False
        for overlay in overlays:
            if not _matches(current, overlay):
                continue
            key = (str(current["strategy_id"]), str(current["symbol"]), str(current["side"]))
            prior_stop = last_stop.get(key)
            if prior_stop is not None and not reentry_allowed(
                prior_stop, int(current["entry_ts_ms"]), float(overlay.get("reentry_hours", 0)),
                str(current["side"]), str(current["side"])
            ):
                obs["reentry_rejected"] += 1
                obs["by_reason"]["REENTRY_HOLDOFF"] += 1
                blocked = True
                break
            before_exit = int(current["exit_ts_ms"])
            current = _apply_initial_stop(current, overlay, source, cost_bps, obs)
            if int(current["exit_ts_ms"]) < before_exit:
                last_stop[key] = int(current["exit_ts_ms"])
        if not blocked:
            output.append(current)
    return output


def candidate_grid(phase: str) -> list[dict]:
    """Return a fixed candidate grid before any result is executed."""
    if phase.endswith("_COMPOSITE"):
        base_phase = phase[:-len("_COMPOSITE")]
        if base_phase in ("V12_LONG", "V12_SHORT"):
            strategy = "V12"
            sides = ["LONG"] if base_phase == "V12_LONG" else ["SHORT"]
        else:
            strategy = {"Q102": "Q102", "IDLE": "IDLE", "FET": "FET",
                        "HYPE": "HYPE_LONG", "V52": "V52"}[base_phase]
            sides = ["LONG", "SHORT"]
        prefix = base_phase
        return [
            {
                "id": f"{prefix}_COMPOSITE_PCT2P0_12H_MFE1P0_STRUCTURE3_R12",
                "strategy": strategy,
                "sides": sides,
                "stop_pct": 0.020,
                "arm_hours": 12,
                "mfe_gate_pct": 0.010,
                "structure_bars": 3,
                "structure_min_adverse_closes": 3,
                "reentry_hours": 12,
            },
            {
                "id": f"{prefix}_COMPOSITE_ATR1P5_6H_MFE0P5_STRUCTURE3_R12",
                "strategy": strategy,
                "sides": sides,
                "atr_mult": 1.5,
                "atr_floor_pct": 0.010,
                "atr_cap_pct": 0.040,
                "arm_hours": 6,
                "mfe_gate_pct": 0.005,
                "structure_bars": 3,
                "structure_min_adverse_closes": 2,
                "reentry_hours": 12,
            },
        ]
    if phase in ("V12_LONG", "V12_SHORT"):
        sides = ["LONG"] if phase == "V12_LONG" else ["SHORT"]
        prefix = phase
        return [
            {"id": f"{prefix}_PCT1P0_3H_MFE0P5_R6", "strategy": "V12", "sides": sides, "stop_pct": 0.010, "arm_hours": 3, "mfe_gate_pct": 0.005, "reentry_hours": 6},
            {"id": f"{prefix}_PCT1P5_6H_MFE0P5_R12", "strategy": "V12", "sides": sides, "stop_pct": 0.015, "arm_hours": 6, "mfe_gate_pct": 0.005, "reentry_hours": 12},
            {"id": f"{prefix}_PCT2P0_12H_MFE1P0_R12", "strategy": "V12", "sides": sides, "stop_pct": 0.020, "arm_hours": 12, "mfe_gate_pct": 0.010, "reentry_hours": 12},
            {"id": f"{prefix}_PCT3P0_12H_NONE_R24", "strategy": "V12", "sides": sides, "stop_pct": 0.030, "arm_hours": 12, "mfe_gate_pct": None, "reentry_hours": 24},
            {"id": f"{prefix}_ATR1P5_6H_MFE0P5_R12", "strategy": "V12", "sides": sides, "atr_mult": 1.5, "atr_floor_pct": 0.010, "atr_cap_pct": 0.040, "arm_hours": 6, "mfe_gate_pct": 0.005, "reentry_hours": 12},
            {"id": f"{prefix}_ATR2P0_6H_MFE1P0_R12", "strategy": "V12", "sides": sides, "atr_mult": 2.0, "atr_floor_pct": 0.010, "atr_cap_pct": 0.050, "arm_hours": 6, "mfe_gate_pct": 0.010, "reentry_hours": 12},
            {"id": f"{prefix}_PCT2P0_6H_MFE0P5_R6", "strategy": "V12", "sides": sides, "stop_pct": 0.020, "arm_hours": 6, "mfe_gate_pct": 0.005, "reentry_hours": 6},
            {"id": f"{prefix}_PCT3P0_3H_MFE0P5_R24", "strategy": "V12", "sides": sides, "stop_pct": 0.030, "arm_hours": 3, "mfe_gate_pct": 0.005, "reentry_hours": 24},
        ]
    strategy = {"Q102": "Q102", "IDLE": "IDLE", "FET": "FET", "HYPE": "HYPE_LONG", "V52": "V52"}[phase]
    return [
        {"id": f"{phase}_PCT1P5_3H_MFE0P5_R6", "strategy": strategy, "sides": ["LONG", "SHORT"], "stop_pct": 0.015, "arm_hours": 3, "mfe_gate_pct": 0.005, "reentry_hours": 6},
        {"id": f"{phase}_PCT2P0_6H_MFE0P5_R12", "strategy": strategy, "sides": ["LONG", "SHORT"], "stop_pct": 0.020, "arm_hours": 6, "mfe_gate_pct": 0.005, "reentry_hours": 12},
        {"id": f"{phase}_PCT3P0_12H_NONE_R24", "strategy": strategy, "sides": ["LONG", "SHORT"], "stop_pct": 0.030, "arm_hours": 12, "mfe_gate_pct": None, "reentry_hours": 24},
        {"id": f"{phase}_ATR2P0_6H_MFE1P0_R12", "strategy": strategy, "sides": ["LONG", "SHORT"], "atr_mult": 2.0, "atr_floor_pct": 0.010, "atr_cap_pct": 0.050, "arm_hours": 6, "mfe_gate_pct": 0.010, "reentry_hours": 12},
    ]


PHASES = ("V12_LONG", "V12_SHORT", "Q102", "IDLE", "FET", "HYPE", "V52")
COMPOSITE_PHASES = tuple(f"{phase}_COMPOSITE" for phase in PHASES)
ALL_PHASES = PHASES + COMPOSITE_PHASES


def _phase_result(rows: list[dict], output: dict, plan: dict | None, cost_bps: int, obs: dict, oos: dict) -> dict:
    losses = [float(row.get("total_pnl_jpy", 0.0)) for row in rows if float(row.get("total_pnl_jpy", 0.0)) < 0]
    return {
        "candidate": plan["id"] if plan else "CUMULATIVE_BASELINE",
        "plan": plan,
        "cost_bps": cost_bps,
        "final_equity_jpy": output["final_equity_jpy"],
        "profit_factor": output["profit_factor"],
        "maximum_mtm_drawdown_pct": 100.0 * output["maximum_mtm_drawdown"],
        "win_rate": output["win_rate"],
        "closed_trades": output["closed_trades"],
        "average_loss_jpy": statistics.fmean(losses) if losses else 0.0,
        "maximum_loss_streak": _max_loss_streak(rows),
        "strategy_trades": output["strategy_trades"],
        "strategy_pnl_jpy": output["strategy_pnl_jpy"],
        "accounting": output["accounting"],
        "oos": oos,
        "observations": {**obs, "by_reason": dict(obs["by_reason"])},
        "research_classification": "RESEARCH_ONLY_NONCANONICAL",
    }


def _run_engine(policy_name: str, phase: str, overlays: list[dict], cost_bps: int,
                source, helper, previous_factory) -> dict:
    # Cost is part of the replay identity.  Keeping 10bps and 30bps in the
    # same result path would silently reuse the first completed run and could
    # make the second baseline look like a parity failure.
    # The legacy engine itself appends <policy>/<cost>/cases/... below
    # helper.base.OUTROOT.  Keep our metadata beside that tree, but do not
    # pass the already-expanded run path back as OUTROOT (that would produce
    # policy/cost/policy/cost nesting and eventually hit WinError 206).
    # Composite identifiers are intentionally descriptive, but passing the
    # full identifier through the frozen engine would exceed Windows' path
    # limit once its case/run directories are appended. Keep the human-facing
    # candidate id in the result JSON and use a deterministic short engine
    # namespace only for filesystem paths.
    if phase.endswith("_COMPOSITE"):
        digest = hashlib.sha256(policy_name.encode("utf-8")).hexdigest()[:12]
        engine_phase = f"cmp_{digest}"
        engine_policy_name = f"cmp_{digest}"
    else:
        engine_phase = phase
        engine_policy_name = policy_name
    engine_root = OUTPUT / "engine" / engine_phase
    run_root = engine_root / engine_policy_name / f"{cost_bps}bps"
    result_path = run_root / "result.json"
    if result_path.exists():
        return json.loads(result_path.read_text("utf-8"))
    # The frozen virtual-leg adapter writes the candidate file directly and
    # assumes the legacy case directory already exists.  The old cached
    # phases masked that assumption; create it explicitly for new composite
    # cases so a fresh replay is deterministic.
    case_root = run_root / "cases" / "V2_M150_D05_CORE_NATIVE"
    (case_root / "candidates").mkdir(parents=True, exist_ok=True)
    (case_root / "runs").mkdir(parents=True, exist_ok=True)
    obs = {
        "eligible": 0,
        "triggered": 0,
        "original_winner_triggered": 0,
        "original_loser_triggered": 0,
        "reentry_rejected": 0,
        "data_gap": 0,
        "entry_mismatch": 0,
        "atr_unavailable": 0,
        "internal_gap": 0,
        "structure_unconfirmed": 0,
        "invalid_input": 0,
        "by_reason": Counter(),
    }

    def factory(base_filter, policy, _ignored_obs):
        existing = previous_factory(base_filter, policy, _ignored_obs)

        def wrapped(candidates, case):
            rows = existing(candidates, case)
            return _transform_rows(rows, overlays, source, cost_bps, obs)

        return wrapped

    helper.base.wrapped_filter = factory
    base_spec = helper.POLICIES["LATEST_20261017_BASELINE"]
    helper.POLICIES[engine_policy_name] = {
        **base_spec,
        "sizes": dict(base_spec.get("sizes", {})),
        "symbols": set(base_spec.get("symbols", set())),
        "exit": base_spec.get("exit"),
    }
    helper.gross._allowed_fractional_symbols.clear()
    helper.gross._allowed_fractional_symbols.update(base_spec.get("sizes", {}))
    source.COUNTS = {"changed": 0, "byStrategy": {}, "byReason": {}, "warnings": {}}
    helper.base.OUTROOT = engine_root
    started = time.monotonic()
    # The frozen adapter writes one candidate manifest before its own setup
    # creates all case directories.  Guard only this isolated research tree;
    # do not alter the source checkout or any production path.
    Path.write_text = _ensure_research_output_parent_write_text
    try:
        result = helper.base.run_one(engine_policy_name, cost_bps)
    finally:
        Path.write_text = _path_write_text
    elapsed = round(time.monotonic() - started, 2)
    ledger = _ledger_path(engine_root, engine_policy_name, cost_bps)
    rows = _read_jsonl(ledger)
    output = result["output"]
    row = _phase_result(rows, output, overlays[-1] if overlays else None,
                        cost_bps, obs, _oos_metrics(rows, cost_bps))
    row["engine_seconds"] = elapsed
    row["ledger"] = str(ledger)
    row["all_overlays"] = overlays
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(row, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("TASK9_RESULT", json.dumps({key: row[key] for key in (
        "candidate", "cost_bps", "final_equity_jpy", "profit_factor",
        "maximum_mtm_drawdown_pct", "closed_trades", "accounting",
    )}, ensure_ascii=False), flush=True)
    return row


def _load_rows(result: dict) -> list[dict]:
    return _read_jsonl(Path(result["ledger"]))


def _dd_improvement(candidate: dict, baseline: dict) -> float:
    return candidate["maximum_mtm_drawdown_pct"] - baseline["maximum_mtm_drawdown_pct"]


def _acceptance(candidate: dict, baseline: dict) -> dict:
    dd = _dd_improvement(candidate, baseline)
    oos_base = baseline["oos"]
    oos_candidate = candidate["oos"]
    pf_guard = (
        oos_candidate.get("profit_factor") is not None
        and oos_base.get("profit_factor") is not None
        and oos_candidate["profit_factor"] >= 0.90 * oos_base["profit_factor"]
        and oos_candidate.get("net_pnl_jpy", 0.0) > 0
    )
    final_guard = candidate["final_equity_jpy"] >= 0.75 * baseline["final_equity_jpy"]
    return {
        "dd_improvement_pp": dd,
        "dd_pass": dd >= 0.10,
        "accounting_pass": candidate["accounting"] == "PASS",
        "oos_pass": pf_guard,
        "final_equity_guard_pass": final_guard,
        "accepted": dd >= 0.10 and candidate["accounting"] == "PASS" and pf_guard and final_guard,
    }


def _select_candidate(candidate_pairs: list[tuple[dict, dict, dict]]) -> tuple[dict, dict, dict] | None:
    accepted = [item for item in candidate_pairs if item[2]["accepted"]]
    if not accepted:
        return None
    accepted.sort(
        key=lambda item: (
            item[2]["dd_improvement_pp"] + item[1]["maximum_mtm_drawdown_pct"] - item[0]["maximum_mtm_drawdown_pct"],
            item[1]["oos"].get("profit_factor") or -math.inf,
            item[1]["final_equity_jpy"],
        ),
        reverse=True,
    )
    return accepted[0]


def _write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    Path.write_text = _redirect_legacy_write_text
    source, helper = task8.legacy.bootstrap()
    Path.write_text = _path_write_text
    task8.legacy.ensure_baseline(helper)
    previous_factory = helper.experiment_filter

    baseline_results: dict[int, dict] = {}
    for cost in (10, 30):
        result = _run_engine("BASELINE", "BASELINE", [], cost, source, helper, previous_factory)
        expected = BASELINE_EXPECTED[cost]
        checks = {
            "final": math.isclose(result["final_equity_jpy"], expected["final"], rel_tol=2e-10, abs_tol=1e-4),
            "pf": math.isclose(result["profit_factor"], expected["pf"], rel_tol=2e-10, abs_tol=1e-8),
            "dd": math.isclose(result["maximum_mtm_drawdown_pct"], expected["dd"], rel_tol=2e-10, abs_tol=1e-7),
            "trades": result["closed_trades"] == expected["trades"],
            "accounting": result["accounting"] == "PASS",
        }
        if not all(checks.values()):
            raise RuntimeError(f"BASELINE_CONTROL_MISMATCH {cost} {checks}")
        baseline_results[cost] = result
        print("TASK9_BASELINE_CONTROL_PASS", cost, flush=True)

    baseline_rows = {cost: _load_rows(result) for cost, result in baseline_results.items()}
    symbols = {str(row["symbol"]) for rows in baseline_rows.values() for row in rows}
    diagnostics = {str(cost): build_loss_path_diagnostics(rows, source, cost) for cost, rows in baseline_rows.items()}
    dd_window = {}
    for cost, result in baseline_results.items():
        event_file = Path(result["ledger"]).with_name("portfolio-events.jsonl")
        events = _read_jsonl(event_file) if event_file.exists() else []
        dd_window[str(cost)] = realized_dd_window(baseline_rows[cost], events)
    _write_json(OUTPUT / "baseline-loss-path-diagnostics.json", diagnostics)
    _write_json(OUTPUT / "baseline-dd-window-diagnostic.json", dd_window)

    cumulative_overlays: list[dict] = []
    current_baseline = dict(baseline_results)
    phase_reports = []
    for phase in ALL_PHASES:
        candidates = candidate_grid(phase)
        candidate_pairs = []
        for candidate in candidates:
            overlay_set = cumulative_overlays + [candidate]
            candidate_results = {}
            for cost in (10, 30):
                policy_name = f"{phase}__{candidate['id']}__{cost}"
                candidate_results[cost] = _run_engine(
                    policy_name, phase, overlay_set, cost, source, helper, previous_factory
                )
            checks = {
                str(cost): _acceptance(candidate_results[cost], current_baseline[cost])
                for cost in (10, 30)
            }
            accepted = all(checks[str(cost)]["accepted"] for cost in (10, 30))
            pair = {
                "phase": phase,
                "candidate": candidate,
                "results": {str(cost): candidate_results[cost] for cost in (10, 30)},
                "checks": checks,
                "accepted_both_costs": accepted,
            }
            candidate_pairs.append((candidate_results[10], candidate_results[30], {
                "accepted": accepted,
                "dd_improvement_pp": min(checks[str(cost)]["dd_improvement_pp"] for cost in (10, 30)),
                "checks": checks,
                "pair": pair,
            }))
            _write_json(OUTPUT / "phases" / phase / f"{candidate['id']}.json", pair)
        selected = _select_candidate(candidate_pairs)
        if selected:
            selected_candidate = selected[2]["pair"]["candidate"]
            cumulative_overlays.append(selected_candidate)
            current_baseline = {cost: selected[idx] for idx, cost in ((0, 10), (1, 30))}
            selection_status = "ACCEPTED_AND_CARRIED_FORWARD"
        else:
            selected_candidate = None
            selection_status = "NO_ACCEPTED_CANDIDATE_BASELINE_UNCHANGED"
        phase_report = {
            "phase": phase,
            "candidate_count": len(candidates),
            "selected_candidate": selected_candidate,
            "selection_status": selection_status,
            "cumulative_overlays_after_phase": cumulative_overlays,
            "candidate_summaries": [item[2]["pair"] for item in candidate_pairs],
        }
        phase_reports.append(phase_report)
        _write_json(OUTPUT / "phase-summary" / f"{phase}.json", phase_report)
        print("TASK9_PHASE_COMPLETE", json.dumps({
            "phase": phase,
            "selection_status": selection_status,
            "selected_candidate": selected_candidate,
        }, ensure_ascii=False), flush=True)

    final_summary = {
        "status": "COMPLETE_RESEARCH_ONLY_NONCANONICAL",
        "classification": "RESEARCH_ONLY_NONCANONICAL",
        "baseline_expected": BASELINE_EXPECTED,
        "phase_order": ALL_PHASES,
        "phase_reports": phase_reports,
        "accepted_cumulative_overlays": cumulative_overlays,
        "pengu_unchanged": True,
        "production_changes": 0,
        "production_certification": False,
        "acceptance_contract": {
            "dd_improvement_min_percentage_points_at_each_cost": 0.10,
            "oos_profit_factor_min_ratio": 0.90,
            "oos_net_pnl_positive": True,
            "final_equity_min_ratio": 0.75,
            "accounting": "PASS",
        },
    }
    _write_json(OUTPUT / "task9-summary.json", final_summary)
    _write_json(OUTPUT / "manifest.json", {
        "classification": "RESEARCH_ONLY_NONCANONICAL",
        "period": {"start_utc": "2025-08-10T00:00:00Z", "end_utc": "2026-08-10T00:00:00Z"},
        "initial_capital_jpy": 10000,
        "monthly_deposits": 0,
        "costs_bps": [10, 30],
        "engine": "fixed 2026-10-17 eight-logic H1 price-model replay",
        "phase_order": ALL_PHASES,
        "horizons_hours": HORIZONS_HOURS,
        "production_changes": 0,
        "production_certification": False,
        "source_sha256": {
            "task8_baseline_runner": sha256_file(LEGACY_DIR / "task8_v12_long_noncanonical_20261020.py"),
            "task9_runner": sha256_file(Path(__file__)),
            "compound_reference": sha256_file(LEGACY_DIR / "task8_v12_long_compound_20261020.py"),
        },
        "data_quality": _data_quality(source, symbols),
        "results": "task9-summary.json",
    })
    print("TASK9_COMPLETE", OUTPUT, flush=True)


if __name__ == "__main__":
    main()
