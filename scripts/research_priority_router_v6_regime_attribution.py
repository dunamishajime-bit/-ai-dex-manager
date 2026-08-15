"""Frozen V6 regime attribution and portfolio-level controller research.

Research-only harness.  The frozen V6 router is imported and never modified;
controllers are an exposure overlay that can only use candle history ending at
the current hour.  All thresholds are fixed from the pre-known 2023-07--2025-07
development/validation span and are not re-fit on the known 2025-26 OOS.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import research_lab_pair_specific_v109 as v109
import research_priority_router_one_year as base
import research_priority_router_v3 as v3
import research_priority_router_v6 as v6
import research_priority_router_v6_historical_robustness as hist


HOUR = base.HOUR
DAY = base.DAY
JST = timezone(timedelta(hours=9))
V6_FREEZE_COMMIT = "9a795bb478e4a2d21ab21552a650a3c8e2b693c7"
V6_SOURCE_SHA256 = "ade97549be141371a73c72d781915d1c5cc32eb00310552aaf48c419d36968c9"
V6_FLAGS = {v6.GUARD_SAME_DAY, v6.GUARD_CHURN}
V6_POLICY = v6.V6_FULL
V1_POLICY = v6.V1_BASELINE
KNOWN_OOS_START = hist.KNOWN_OOS_START
KNOWN_OOS_END = hist.KNOWN_OOS_END

PERIODS = (
    ("2023-24", hist.PRIOR_YEAR_2[1], hist.PRIOR_YEAR_2[2]),
    ("2024-25", hist.PRIOR_YEAR_1[1], hist.PRIOR_YEAR_1[2]),
    ("2025-26", hist.FULL_3Y[1] if False else hist.jst08(2025, 7, 1), hist.jst08(2026, 7, 1)),
    ("3Y_COMBINED", hist.jst08(2023, 7, 1), hist.jst08(2026, 7, 1)),
)
ROLLING = tuple((name, start, end) for name, start, end in hist.ROLLING)

# Controller design was declared before evaluation.  It uses only causal
# candle features and D/V distribution thresholds.  The 2025-26 known OOS is
# explicitly excluded from fitting.
CONTROLLER_DV = {
    "development": (hist.jst08(2023, 7, 1), hist.jst08(2024, 7, 1)),
    "validation": (hist.jst08(2024, 7, 1), hist.jst08(2025, 7, 1)),
}
FEATURES = (
    "btc_trend_168",
    "breadth_72",
    "alt_rel_72",
    "btc_vol_percentile",
    "dispersion_72",
)


def _source_hash() -> str:
    return hashlib.sha256(Path(v6.__file__).read_bytes()).hexdigest()


def _quantile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    xs = sorted(float(x) for x in values if math.isfinite(float(x)))
    if not xs:
        return 0.0
    pos = (len(xs) - 1) * q
    lo, hi = int(math.floor(pos)), int(math.ceil(pos))
    if lo == hi:
        return xs[lo]
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def _mean(values: list[float]) -> float:
    return statistics.fmean(values) if values else 0.0


class FeatureEngine:
    """Hourly causal BTC/cross-asset feature snapshots."""

    def __init__(self, candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]]):
        self.candles = candles
        self.index = index
        self.cache: dict[int, dict[str, float]] = {}
        self.symbols = ("BTC", "SOL", "LINK", "ETH", "BNB", "AVAX")

    def _idx(self, symbol: str, ts: int) -> int | None:
        return self.index[symbol].get(int(ts))

    def _close(self, symbol: str, idx: int) -> float:
        return float(self.candles[symbol][idx]["close"])

    def _ret(self, symbol: str, idx: int, bars: int) -> float:
        if idx < bars:
            return 0.0
        old = self._close(symbol, idx - bars)
        now = self._close(symbol, idx)
        return now / old - 1.0 if old else 0.0

    def _log_returns(self, symbol: str, idx: int, bars: int) -> list[float]:
        start = max(1, idx - bars + 1)
        rows = self.candles[symbol]
        out: list[float] = []
        for j in range(start, idx + 1):
            a, b = float(rows[j - 1]["close"]), float(rows[j]["close"])
            if a > 0 and b > 0:
                out.append(math.log(b / a))
        return out

    def _rv(self, symbol: str, idx: int, bars: int) -> float:
        values = self._log_returns(symbol, idx, bars)
        return statistics.pstdev(values) * math.sqrt(24.0) * 100.0 if len(values) >= 2 else 0.0

    def _ma_dist(self, symbol: str, idx: int, bars: int) -> float:
        if idx < bars:
            return 0.0
        rows = self.candles[symbol]
        ma = _mean([float(rows[j]["close"]) for j in range(idx - bars + 1, idx + 1)])
        return float(rows[idx]["close"]) / ma - 1.0 if ma else 0.0

    def _trend_persistence(self, idx: int) -> float:
        vals = [self._ret("BTC", idx, bars) for bars in range(24, min(idx, 24 * 14) + 1, 24)]
        return sum(1 for x in vals if x > 0) / len(vals) if vals else 0.5

    def _vol_percentile(self, idx: int, current: float) -> float:
        # A causal percentile proxy: the current 72h volatility relative to
        # the slower 168h volatility.  It is deliberately smooth and avoids
        # sorting a long history at every hourly mark.
        slow = self._rv("BTC", idx, 168)
        if slow <= 1e-12:
            return 0.5
        return min(1.0, max(0.0, current / slow))

    def _mean_reversion(self, idx: int) -> float:
        vals = self._log_returns("BTC", idx, min(48, idx))
        flips = sum(1 for a, b in zip(vals, vals[1:]) if a * b < 0)
        return flips / max(1, len(vals) - 1)

    def _breakouts(self, idx: int) -> tuple[float, float]:
        if idx < 168:
            return 0.0, 0.0
        rows = self.candles["BTC"]
        window = rows[max(0, idx - 168):idx]
        high = max(float(row["high"]) for row in window)
        low = min(float(row["low"]) for row in window)
        close = float(rows[idx]["close"])
        broke = float(close > high or close < low)
        # A reversal/compression proxy is causal and avoids looking beyond ts.
        rev = self._mean_reversion(idx)
        return broke, rev

    def snapshot(self, ts: int) -> dict[str, float]:
        ts = int(ts)
        if ts in self.cache:
            return self.cache[ts]
        btc_idx = self._idx("BTC", ts)
        if btc_idx is None:
            return {key: 0.0 for key in FEATURES}
        btc24 = self._ret("BTC", btc_idx, 24)
        btc72 = self._ret("BTC", btc_idx, 72)
        btc168 = self._ret("BTC", btc_idx, 168)
        rv24, rv72, rv168 = (self._rv("BTC", btc_idx, n) for n in (24, 72, 168))
        alt = ("SOL", "LINK", "ETH", "BNB", "AVAX")
        alt72 = [self._ret(s, self._idx(s, ts) or 0, 72) for s in alt]
        alt24 = [self._ret(s, self._idx(s, ts) or 0, 24) for s in alt]
        btc72_safe = btc72
        rel72 = [x - btc72_safe for x in alt72]
        ma_fast = [self._ma_dist(s, self._idx(s, ts) or 0, 72) for s in alt]
        btc_ma = self._ma_dist("BTC", btc_idx, 168)
        breakout, false_break = self._breakouts(btc_idx)
        snap = {
            "btc_return_24": btc24 * 100.0,
            "btc_return_72": btc72 * 100.0,
            "btc_return_168": btc168 * 100.0,
            "btc_trend_168": (btc168 * 100.0) / max(rv168, 1e-6),
            "btc_ma_distance": btc_ma * 100.0,
            "btc_rv_24": rv24,
            "btc_rv_72": rv72,
            "btc_rv_168": rv168,
            "btc_vol_percentile": self._vol_percentile(btc_idx, rv72),
            "btc_drawdown_168": (float(self.candles["BTC"][btc_idx]["close"]) / max(float(max(float(self.candles["BTC"][j]["close"]) for j in range(max(0, btc_idx - 168), btc_idx + 1))), 1e-12) - 1.0) * 100.0,
            "btc_trend_persistence": self._trend_persistence(btc_idx),
            "breadth_24": sum(x > 0 for x in alt24) / len(alt24),
            "breadth_72": sum(x > 0 for x in alt72) / len(alt72),
            "medium_trend_breadth": sum(x > 0 for x in ma_fast) / len(ma_fast),
            "alignment_breadth": sum((x > 0) == (btc72 > 0) for x in alt72) / len(alt72),
            "dispersion_24": statistics.pstdev(alt24) * 100.0,
            "dispersion_72": statistics.pstdev(alt72) * 100.0,
            "return_spread_72": (max(alt72) - min(alt72)) * 100.0,
            "alt_rel_24": _mean([x - btc24 for x in alt24]) * 100.0,
            "alt_rel_72": _mean(rel72) * 100.0,
            "alt_rel_168": _mean([self._ret(s, self._idx(s, ts) or 0, 168) - btc168 for s in alt]) * 100.0,
            "volatility_clustering": rv24 / max(rv168, 1e-9),
            "compression_expansion": rv24 / max(rv168, 1e-9),
            "mean_reversion_intensity": self._mean_reversion(btc_idx),
            "breakout_frequency": breakout,
            "false_break_frequency": false_break,
        }
        self.cache[ts] = snap
        return snap


def _feature_thresholds(engine: FeatureEngine) -> dict[str, Any]:
    start = CONTROLLER_DV["development"][0]
    end = CONTROLLER_DV["validation"][1]
    rows = engine.candles["BTC"]
    start_idx = next((i for i, row in enumerate(rows) if int(row["ts"]) >= start), 0)
    times = [int(rows[i]["ts"]) for i in range(start_idx, len(rows), 24) if start <= int(rows[i]["ts"]) < end]
    values = {feature: [engine.snapshot(ts)[feature] for ts in times] for feature in FEATURES}
    medians = {feature: _quantile(values[feature], 0.5) for feature in FEATURES}
    q33 = {feature: _quantile(values[feature], 0.33) for feature in FEATURES}
    q67 = {feature: _quantile(values[feature], 0.67) for feature in FEATURES}
    return {"features": list(FEATURES), "selectionSource": "DECLARED_FEATURE_SET; thresholds fit on controller D/V only", "development": CONTROLLER_DV["development"], "validation": CONTROLLER_DV["validation"], "sampleCount": len(times), "median": medians, "q33": q33, "q67": q67, "volHostileThreshold": 0.80}


class RegimeController:
    def __init__(self, engine: FeatureEngine, thresholds: dict[str, Any]):
        self.engine = engine
        self.t = thresholds
        self.cache: dict[int, dict[str, Any]] = {}

    def score(self, ts: int) -> dict[str, Any]:
        ts = int(ts)
        if ts in self.cache:
            return self.cache[ts]
        f = self.engine.snapshot(ts)
        good_trend = f["btc_trend_168"] >= self.t["median"]["btc_trend_168"]
        good_breadth = f["breadth_72"] >= self.t["median"]["breadth_72"]
        good_rel = f["alt_rel_72"] >= self.t["median"]["alt_rel_72"]
        hostile_vol = f["btc_vol_percentile"] >= self.t["volHostileThreshold"]
        score = int(good_trend) + int(good_breadth) + int(good_rel) - int(hostile_vol)
        state = "STRONG" if score >= 2 else ("NEUTRAL" if score == 1 else "WEAK")
        out = {"score": score, "state": state, "feature": f, "goodTrend": good_trend, "goodBreadth": good_breadth, "goodRelativeStrength": good_rel, "hostileVolatility": hostile_vol}
        self.cache[ts] = out
        return out

    def exposure(self, ts: int, variant: str) -> float:
        state = self.score(ts)["state"]
        if variant == "V6_FROZEN_BASELINE":
            return 1.0
        if variant == "V6_BINARY_REGIME":
            return 1.0 if state == "STRONG" else 0.0
        if variant == "V6_3STATE_REGIME":
            return {"STRONG": 1.0, "NEUTRAL": 0.5, "WEAK": 0.0}[state]
        if variant == "V6_DYNAMIC_EXPOSURE":
            score = int(self.score(ts)["score"])
            return 1.0 if score >= 3 else (0.5 if score == 2 else (0.25 if score == 1 else 0.0))
        raise ValueError(variant)


def _common_times_relaxed(candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]], period: dict[str, Any]) -> list[int]:
    start, end = int(period["fixedWindowStart"]), int(period["fixedWindowEndExclusive"])
    symbols = ("BTC",) + tuple(base.TRADE_SYMBOLS)
    return [int(row["ts"]) for row in candles["BTC"] if start <= int(row["ts"]) < end and all(index[s].get(int(row["ts"])) is not None for s in symbols)]


def run_exposed(candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]], period: dict[str, Any], candidates: dict[str, list[dict[str, Any]]], policy: str, dv: dict[str, dict[str, Any]], variant: str, controller: RegimeController | None, *, guard_flags: set[str], audit: bool = False) -> dict[str, Any]:
    try:
        times = base._common_times(candles, index, period)
    except RuntimeError:
        times = _common_times_relaxed(candles, index, period)
    events: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for rows in candidates.values():
        for row in rows:
            events[int(row["entryTs"])].append(row)
    slots = [{"cash": base.SLOT_INITIAL_CAPITAL, "position": None}, {"cash": base.SLOT_INITIAL_CAPITAL, "position": None}]
    real: list[dict[str, Any]] = []
    skipped: Counter[str] = Counter()
    adopted: Counter[str] = Counter()
    preempted: Counter[str] = Counter()
    states: Counter[str] = Counter()
    turnover = 0.0
    turnover_breakdown: Counter[str] = Counter()
    last_close: dict[tuple[str, str], int] = {}
    same_day_closed: dict[tuple[str, str], int] = {}
    last_closed_complement: tuple[str, int] | None = None
    recent_preemptions: dict[str, int] = {}
    equity: list[dict[str, Any]] = []
    decisions: list[dict[str, Any]] = []
    audit_events: list[dict[str, Any]] = []
    guards: dict[str, dict[str, Counter | float]] = {g: {} for g in v6.GUARDS}
    exposure_history: list[dict[str, Any]] = []

    def positions() -> list[dict[str, Any]]:
        return [slot["position"] for slot in slots if slot["position"] is not None]

    def target_exposure(ts: int) -> float:
        return controller.exposure(ts, variant) if controller is not None else 1.0

    def close_slot(slot: dict[str, Any], ts: int, reason: str, price: float | None = None) -> None:
        nonlocal turnover, last_closed_complement
        pos = slot["position"]
        if pos is None:
            return
        exit_price = price if price is not None else float(pos["plannedExitPrice"])
        pos["closeTs"] = ts
        trade = v6.v6._close_position(pos, exit_price, reason) if False else base._close_position(pos, exit_price, reason)
        slot["cash"] += float(pos["capital"])
        turnover += abs(float(pos["capital"]))
        turnover_breakdown["regime_exit" if reason.startswith("REGIME_") else ("preemption_exit" if reason.startswith("PREEMPTED_BY_") else "normal_exit")] += abs(float(pos["capital"]))
        key = (str(pos["symbol"]), str(pos["side"]))
        last_close[key] = ts
        if int(pos["entryTs"]) // DAY == int(ts) // DAY:
            same_day_closed[key] = ts
            turnover_breakdown["same_day_roundtrip"] += abs(float(pos.get("entryCapital", 0.0))) + abs(float(pos["capital"]))
        if str(pos["symbol"]) in base.COMPLEMENTS:
            last_closed_complement = (str(pos["symbol"]), ts)
        real.append(trade)
        slot["position"] = None

    def open_slot(slot: dict[str, Any], candidate: dict[str, Any], ts: int, kind: str = "normal") -> bool:
        nonlocal turnover
        exp = target_exposure(ts)
        if exp <= 0.0:
            skipped["regime_off"] += 1
            return False
        amount = float(slot["cash"]) * exp
        if amount <= 1e-12:
            skipped["no_investable_cash"] += 1
            return False
        turnover += amount
        slot["cash"] -= amount
        turnover_breakdown["regime_entry" if exp < 1.0 else ("preemption_entry" if kind == "preemption_replacement" else "normal_entry")] += amount
        slot["position"] = {"symbol": candidate["symbol"], "side": candidate["side"], "sideSign": candidate["sideSign"], "entryTs": ts, "entryPrice": candidate["entryPrice"], "plannedExitTs": candidate["exitTs"], "plannedExitPrice": candidate["exitPrice"], "capital": amount, "entryCapital": amount, "riskMultiplier": candidate["riskMultiplier"], "signalStrength": candidate["signalStrength"], "champion": candidate["champion"], "entryExposure": exp}
        adopted[str(candidate["symbol"])] += 1
        return True

    def free_slot() -> dict[str, Any] | None:
        return next((slot for slot in slots if slot["position"] is None), None)

    def held_symbols() -> set[str]:
        return {str(position["symbol"]) for position in positions()}

    for ts in times:
        exp = target_exposure(ts)
        ctrl = controller.score(ts) if controller is not None else {"state": "STRONG", "score": 3}
        exposure_history.append({"ts": ts, "exposure": exp, "state": ctrl["state"], "score": ctrl["score"]})
        # Exposure reductions are portfolio exits, not entry filters.  A zero
        # state fully returns capital to cash; smaller states close positions
        # opened at a higher exposure so the accounting remains conservative.
        for slot in slots:
            pos = slot["position"]
            if pos is not None and (exp <= 0.0 or exp < float(pos.get("entryExposure", 1.0))):
                close_slot(slot, ts, "REGIME_EXIT", base._price(candles, index, str(pos["symbol"]), ts, "open"))
            elif pos is not None and int(pos["plannedExitTs"]) <= ts:
                close_slot(slot, ts, "CHAMPION_EXIT", float(pos["plannedExitPrice"]))
        held = held_symbols()
        at_ts = events.get(ts, [])
        priorities = sorted([r for r in at_ts if r["symbol"] in base.PRIORITY], key=lambda r: (0 if r["symbol"] == "SOL" else 1, r["symbol"]))
        for challenger in priorities:
            symbol = str(challenger["symbol"])
            if symbol in held:
                skipped["priority_already_held"] += 1
                continue
            slot = free_slot()
            if slot is None:
                complement_slots = [s for s in slots if s["position"] is not None and s["position"]["symbol"] in base.COMPLEMENTS]
                if not complement_slots or exp <= 0.0:
                    skipped["priority_no_slot_or_regime_off"] += 1
                    continue
                target = complement_slots[0]
                old = target["position"]
                if old is None:
                    continue
                allowed, reason, details = v6._should_preempt(challenger, old, ts, candles, index, dv) if symbol == "SOL" else (True, "LINK_V1_PRIORITY", {"challengerSignalStrength": float(challenger["signalStrength"])})
                decisions.append({"timestamp": ts, "challenger": symbol, "held": old["symbol"], "allowed": allowed, "reason": reason, **details})
                if not allowed:
                    skipped[reason] += 1
                    continue
                if audit:
                    audit_events.append(v6._audit_event(old, challenger, ts, candles, index))
                old_symbol = str(old["symbol"])
                close_slot(target, ts, f"PREEMPTED_BY_{symbol}", base._price(candles, index, old_symbol, ts, "open"))
                recent_preemptions[old_symbol] = ts
                preempted[f"PREEMPTED_BY_{symbol}"] += 1
                if open_slot(target, challenger, ts, "preemption_replacement"):
                    held.add(symbol)
                continue
            if open_slot(slot, challenger, ts):
                held.add(symbol)
        complement_events = [r for r in at_ts if r["symbol"] in base.COMPLEMENTS and r["symbol"] not in held]
        complement_events = base._rank_complements(complement_events, "SHADOW_YTD_RANK", {s: list(candidates[s]) for s in base.COMPLEMENTS}, ts)
        for candidate in complement_events:
            guard = v6._guard_for_candidate(candidate, ts, guard_flags, last_close, same_day_closed, last_closed_complement, recent_preemptions)
            if guard is not None:
                v6._record_guard(guards, guard, candidate)
                skipped[guard] += 1
                continue
            slot = free_slot()
            if slot is None:
                skipped["complement_no_slot"] += 1
                continue
            if open_slot(slot, candidate, ts):
                held.add(str(candidate["symbol"]))
        marks = []
        for slot in slots:
            pos = slot["position"]
            if pos is None:
                marks.append(float(slot["cash"]))
            else:
                marks.append(float(slot["cash"]) + v3._position_value(pos, base._price(candles, index, str(pos["symbol"]), ts, "close")))
        total = sum(marks)
        state = base._state_label(positions())
        states[state] += 1
        equity.append({"ts": ts, "equity": total, "cash": sum(float(s["cash"]) for s in slots), "state": state, "controllerState": ctrl["state"], "exposure": exp, "positions": [str(p["symbol"]) for p in positions()]})
    final_ts = times[-1]
    for slot in slots:
        if slot["position"] is not None:
            pos = slot["position"]
            close_slot(slot, final_ts, "PERIOD_END", base._price(candles, index, str(pos["symbol"]), final_ts, "close"))
    values = [float(x["equity"]) for x in equity]
    peak, max_dd = values[0], 0.0
    for value in values:
        peak = max(peak, value)
        max_dd = min(max_dd, (value / peak - 1.0) * 100.0)
    final_equity = sum(float(s["cash"]) for s in slots)
    metrics = base.metric_from_trade_contributions([float(r["portfolioPnlPctPoints"]) for r in real])
    start, end = int(period["fixedWindowStart"]), int(period["fixedWindowEndExclusive"])
    years = (end - start) / (365.0 * DAY)
    state_keys = ("cash", "SOL only", "LINK only", "SOL+LINK", "complement only", "SOL/complement", "LINK/complement")
    alloc = {key: states[key] / len(equity) * 100.0 for key in state_keys}
    avg_cash = _mean([float(x["cash"]) / max(float(x["equity"]), 1e-12) * 100.0 for x in equity])
    turnover_breakdown["regime_turnover"] = turnover_breakdown["regime_entry"] + turnover_breakdown["regime_exit"]
    turnover_breakdown["preemption_turnover"] = turnover_breakdown["preemption_entry"] + turnover_breakdown["preemption_exit"]
    return {"mode": policy, "variant": variant, "window": {"start": start, "endExclusive": end, "hours": len(equity)}, "metrics": {**metrics, "oneYearReturnPct": (final_equity - 1.0) * 100.0, "cagrPct": (final_equity ** (1.0 / years) - 1.0) * 100.0 if final_equity > 0 else -100.0, "maxDrawdownHourlyMtmPct": max_dd, "returnToAbsDrawdown": ((final_equity - 1.0) * 100.0) / abs(max_dd) if abs(max_dd) > 1e-12 else None, "realTradeCount": len(real), "portfolioTurnoverPctOfInitialEquity": turnover * 100.0}, "allocationTimePct": {"cashPct": alloc["cash"], "SOL_onlyPct": alloc["SOL only"], "LINK_onlyPct": alloc["LINK only"], "SOL_LINKPct": alloc["SOL+LINK"], "complement_onlyPct": alloc["complement only"], "SOL_complementPct": alloc["SOL/complement"], "LINK_complementPct": alloc["LINK/complement"], "averageCashPct": avg_cash}, "realTrades": real, "skippedEventCounts": dict(skipped), "adoptedCounts": dict(adopted), "preemptedCounts": dict(preempted), "equityCurve": equity, "turnoverBreakdown": dict(turnover_breakdown), "preemptionEvents": audit_events, "preemptionDecisions": decisions, "guardAttribution": v6._guard_stats_json(guards), "exposureHistory": exposure_history, "policy": {"variant": variant, "guardFlags": sorted(guard_flags), "shadowUsedForEntryRejection": False, "entryLogicChanged": False, "championsFrozen": True, "btcPositionWeightPct": 0.0, "controllerExposureOverlay": variant != "V6_FROZEN_BASELINE"}}


def _summary(run: dict[str, Any], stress: dict[str, Any]) -> dict[str, Any]:
    result = v6._summary(run, stress)
    result["averageExposurePct"] = 100.0 - float(run["allocationTimePct"]["averageCashPct"])
    history = run.get("exposureHistory", [])
    if not history and str(run.get("variant", "")) == "":
        # Frozen V6 has no controller history; by definition it is fully ON.
        history = [{"state": "STRONG"}] * max(1, int(run["window"].get("hours", 1)))
    states = Counter(row["state"] for row in history)
    total = max(1, len(history))
    result["timeInStrongPct"] = states["STRONG"] / total * 100.0
    result["timeInNeutralPct"] = states["NEUTRAL"] / total * 100.0
    result["timeInWeakPct"] = states["WEAK"] / total * 100.0
    result["regimeTurnoverPct"] = float(run["turnoverBreakdown"].get("regime_turnover", 0.0)) * 100.0
    return result


def _year_label(ts: int) -> str:
    if hist.jst08(2023, 7, 1) <= ts < hist.jst08(2024, 7, 1):
        return "2023-24"
    if hist.jst08(2024, 7, 1) <= ts < hist.jst08(2025, 7, 1):
        return "2024-25"
    if hist.jst08(2025, 7, 1) <= ts < hist.jst08(2026, 7, 1):
        return "2025-26"
    return "other"


def _trade_attribution(run: dict[str, Any], engine: FeatureEngine, thresholds: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for tr in run.get("realTrades", []):
        ts = int(tr["entryTs"])
        feat = engine.snapshot(ts)
        rows.append({"symbol": tr["symbol"], "side": tr["side"], "entryTs": ts, "exitTs": int(tr["exitTs"]), "year": _year_label(ts), "pnlPctPoints": float(tr["portfolioPnlPctPoints"]), "netReturnPct": float(tr["netReturnPct"]), **feat})
    by_symbol = {}
    for symbol in base.TRADE_SYMBOLS:
        vals = [r for r in rows if r["symbol"] == symbol]
        by_symbol[symbol] = {"trades": len(vals), "returnPctPoints": sum(r["pnlPctPoints"] for r in vals), "pf": base.profit_factor([r["netReturnPct"] for r in vals]), "longTrades": sum(r["side"] == "LONG" for r in vals), "shortTrades": sum(r["side"] == "SHORT" for r in vals)}
    by_side = {side: {"trades": sum(r["side"] == side for r in rows), "returnPctPoints": sum(r["pnlPctPoints"] for r in rows if r["side"] == side), "pf": base.profit_factor([r["netReturnPct"] for r in rows if r["side"] == side])} for side in ("LONG", "SHORT")}
    bins = {}
    for feature in FEATURES:
        cut1, cut2 = thresholds["q33"][feature], thresholds["q67"][feature]
        groups = {"LOW": [r for r in rows if r[feature] < cut1], "MEDIUM": [r for r in rows if cut1 <= r[feature] < cut2], "HIGH": [r for r in rows if r[feature] >= cut2]}
        bins[feature] = {name: {"trades": len(vals), "returnPctPoints": sum(r["pnlPctPoints"] for r in vals), "pf": base.profit_factor([r["netReturnPct"] for r in vals]), "pfWithoutBest": base.profit_factor(base._without_best([r["netReturnPct"] for r in vals])) if vals else None, "winRatePct": sum(r["netReturnPct"] > 0 for r in vals) / len(vals) * 100.0 if vals else 0.0} for name, vals in groups.items()}
    monthly = defaultdict(list)
    for r in rows:
        dt = datetime.fromtimestamp(r["entryTs"] / 1000, JST)
        monthly[dt.strftime("%Y-%m")].append(r)
    monthly_out = {month: {"trades": len(vals), "returnPctPoints": sum(r["pnlPctPoints"] for r in vals), "pf": base.profit_factor([r["netReturnPct"] for r in vals])} for month, vals in sorted(monthly.items())}
    feature_distribution = {feature: {"mean": _mean([r[feature] for r in rows]), "median": _quantile([r[feature] for r in rows], 0.5), "q10": _quantile([r[feature] for r in rows], 0.1), "q90": _quantile([r[feature] for r in rows], 0.9)} for feature in FEATURES}
    return {"trades": rows, "bySymbol": by_symbol, "bySide": by_side, "featureBins": bins, "monthly": monthly_out, "featureDistribution": feature_distribution}


def _drawdown_episodes(run: dict[str, Any], engine: FeatureEngine) -> list[dict[str, Any]]:
    curve = run.get("equityCurve", [])
    episodes = []
    peak, peak_ts, in_dd = curve[0]["equity"], curve[0]["ts"], False
    current = None
    for row in curve:
        value = float(row["equity"])
        if value >= peak:
            if current is not None:
                current["endTs"] = row["ts"]
                episodes.append(current)
                current = None
            peak, peak_ts = value, row["ts"]
        else:
            dd = (value / peak - 1.0) * 100.0
            if current is None:
                current = {"startTs": peak_ts, "troughTs": row["ts"], "endTs": row["ts"], "maxDepthPct": dd}
            current["troughTs"] = row["ts"] if dd < current["maxDepthPct"] else current["troughTs"]
            current["maxDepthPct"] = min(current["maxDepthPct"], dd)
            current["endTs"] = row["ts"]
    if current is not None:
        episodes.append(current)
    episodes = sorted(episodes, key=lambda x: x["maxDepthPct"])[:5]
    for ep in episodes:
        trades = [r for r in run.get("realTrades", []) if ep["startTs"] <= int(r["entryTs"]) <= ep["endTs"]]
        ep.update({"durationHours": (int(ep["endTs"]) - int(ep["startTs"])) / HOUR, "trades": len(trades), "symbolContribution": {s: sum(float(r["portfolioPnlPctPoints"]) for r in trades if r["symbol"] == s) for s in base.TRADE_SYMBOLS}, "regimeAtStart": engine.snapshot(int(ep["startTs"])), "regimeAtTrough": engine.snapshot(int(ep["troughTs"]))})
    return episodes


def _false_on_off(run: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    base_by_ts = {int(x["ts"]): float(x["equity"]) for x in baseline.get("equityCurve", [])}
    ctrl = run.get("exposureHistory", [])
    times = sorted(base_by_ts)
    false_off = {"hours": 0, "futureBaselineMovePctPoints": 0.0}
    false_on = {"hours": 0, "futureBaselineMovePctPoints": 0.0}
    for i, row in enumerate(ctrl[:-24]):
        ts = int(row["ts"])
        if ts not in base_by_ts:
            continue
        future_ts = times[min(len(times) - 1, i + 24)]
        move = (base_by_ts[future_ts] / max(base_by_ts[ts], 1e-12) - 1.0) * 100.0
        if row["exposure"] <= 0 and move > 0:
            false_off["hours"] += 1
            false_off["futureBaselineMovePctPoints"] += move
        elif row["exposure"] > 0 and move < 0:
            false_on["hours"] += 1
            false_on["futureBaselineMovePctPoints"] += move
    return {"falseOff": false_off, "falseOn": false_on, "basis": "post-hoc 24-hour baseline MTM diagnostic; never used by controller"}


def _integrity(repo_root: Path) -> dict[str, Any]:
    return hist._cache_integrity(repo_root / ".cache" / "perp-research-usdm")


def _run_period(name: str, start: int, end: int, candles: dict[str, list[dict[str, Any]]], index: dict[str, dict[int, int]], models: dict[str, dict[str, Any]], dv: dict[str, dict[str, Any]], engine: FeatureEngine, controller: RegimeController, thresholds: dict[str, Any], cache: dict[tuple[int, int], Any]) -> dict[str, Any]:
    if (start, end) not in cache:
        cache[(start, end)] = (hist._records_for_window(candles, index, models, start, end, 10.0, 0), hist._records_for_window(candles, index, models, start, end, 30.0, 1))
    normal, stress = cache[(start, end)]
    period = {"fixedWindowStart": start, "fixedWindowEndExclusive": end}
    shadow = {s: list(normal[s]) for s in base.COMPLEMENTS}
    stress_shadow = {s: list(stress[s]) for s in base.COMPLEMENTS}
    variants = ("V6_FROZEN_BASELINE", "V6_BINARY_REGIME", "V6_3STATE_REGIME", "V6_DYNAMIC_EXPOSURE")
    out = {}
    original_bps, original_delay = base.NORMAL_BPS, base.EXECUTION_DELAY_BARS
    try:
        for variant in variants:
            run = v6.run_router(candles, index, period, normal, V6_POLICY, dv, shadow, guard_flags=V6_FLAGS, audit=True) if variant == "V6_FROZEN_BASELINE" else run_exposed(candles, index, period, normal, V6_POLICY, dv, variant, controller, guard_flags=V6_FLAGS, audit=True)
            base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = v6.STRESS_BPS, v6.STRESS_DELAY_BARS
            stress_run = v6.run_router(candles, index, period, stress, V6_POLICY, dv, stress_shadow, guard_flags=V6_FLAGS, audit=False) if variant == "V6_FROZEN_BASELINE" else run_exposed(candles, index, period, stress, V6_POLICY, dv, variant, controller, guard_flags=V6_FLAGS, audit=False)
            base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = original_bps, original_delay
            out[variant] = {"summary": _summary(run, stress_run), "run": run, "stress": stress_run, "attribution": _trade_attribution(run, engine, thresholds), "drawdownEpisodes": _drawdown_episodes(run, engine)}
        baseline = out["V6_FROZEN_BASELINE"]["run"]
        for variant in variants[1:]:
            out[variant]["falseOnOff"] = _false_on_off(out[variant]["run"], baseline)
            out[variant]["deltaVsBaseline"] = {"returnPctPoints": out[variant]["summary"]["returnPct"] - out["V6_FROZEN_BASELINE"]["summary"]["returnPct"], "pfDelta": out[variant]["summary"]["pf"] - out["V6_FROZEN_BASELINE"]["summary"]["pf"], "ddImprovementPctPoints": out[variant]["summary"]["maxDDPct"] - out["V6_FROZEN_BASELINE"]["summary"]["maxDDPct"], "stressPfDelta": out[variant]["summary"]["stressPf"] - out["V6_FROZEN_BASELINE"]["summary"]["stressPf"], "lossAvoidancePctPoints": out[variant]["summary"]["returnPct"] - out["V6_FROZEN_BASELINE"]["summary"]["returnPct"]}
        # Do not retain full hourly curves for every variant/window: the
        # artifact keeps the requested diagnostics while avoiding hundreds of
        # megabytes of duplicated MTM state in memory.
        compact = {k: {x: y for x, y in val.items() if x not in ("run", "stress")} for k, val in out.items()}
        return {"period": {"name": name, "start": start, "endExclusive": end, "hours": (end - start) // HOUR}, "variants": compact}
    finally:
        base.NORMAL_BPS, base.EXECUTION_DELAY_BARS = original_bps, original_delay


def _evidence(repo_root: Path) -> dict[str, Any]:
    audit = hist._historical_evidence_audit(repo_root)
    audit["oosIsNewEvidence"] = False
    return audit


def main() -> None:
    repo_root = Path.cwd()
    integrity = _integrity(repo_root)
    if not integrity["integrityPass"]:
        raise RuntimeError("CACHE_INTEGRITY_FAILED:" + json.dumps(integrity))
    if _source_hash() != V6_SOURCE_SHA256:
        raise RuntimeError("V6_SOURCE_HASH_CHANGED")
    candles, index, _ = v109.b.base.load()
    frozen_periods = base._periods(candles)
    _, models = base.load_candidates(candles, index, frozen_periods)
    dv_candidates = v6._dv_candidates(candles, index, frozen_periods, models)
    frozen_dv = v6._dv_expectancy(dv_candidates, frozen_periods)
    engine = FeatureEngine(candles, index)
    thresholds = _feature_thresholds(engine)
    controller = RegimeController(engine, thresholds)
    cache: dict[tuple[int, int], tuple[dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]] = {}
    period_specs = PERIODS if not os.environ.get("REGIME_QUICK") else (PERIODS[2],)
    rolling_specs = ROLLING if not os.environ.get("REGIME_QUICK") else ()
    annual = {}
    for name, start, end in period_specs:
        annual[name] = _run_period(name, start, end, candles, index, models, frozen_dv, engine, controller, thresholds, cache)
    rolling = [_run_period(name, start, end, candles, index, models, frozen_dv, engine, controller, thresholds, cache) for name, start, end in rolling_specs]
    evidence = _evidence(repo_root)
    baseline_known = annual["2025-26"]["variants"]["V6_FROZEN_BASELINE"]["summary"]
    # This guards against accidental deviation from the frozen, parity-checked
    # V6 implementation in the new harness.
    if abs(float(baseline_known["returnPct"]) - 42.455768) > 0.05:
        raise RuntimeError(f"FROZEN_V6_BASELINE_MISMATCH:{baseline_known}")
    controller_variant = "V6_DYNAMIC_EXPOSURE"
    def short(period: dict[str, Any], variant: str) -> dict[str, Any]:
        s = period["variants"][variant]["summary"]
        return {k: s.get(k) for k in ("returnPct", "cagrPct", "pf", "pfWithoutBest", "maxDDPct", "stressReturnPct", "stressPf", "stressDDPct", "trades", "winRatePct", "turnoverPct", "cashPct", "averageExposurePct", "timeInStrongPct", "timeInNeutralPct", "timeInWeakPct", "regimeTurnoverPct", "top5ContributionPctPoints", "contributionPctPoints", "preemptionCount", "preemptionPnlPctPoints")}
    result = {
        "status": "RESEARCH_ONLY", "productionChanged": False, "vpsChanged": False, "liveChanged": False, "ordersPlaced": False, "btcRole": "REFERENCE_ONLY; no positions/orders/PnL/allocation", "v6FreezeCommit": V6_FREEZE_COMMIT, "v6SourceSha256": _source_hash(), "v6SourceHashUnchanged": True, "v6FrozenFlags": sorted(V6_FLAGS), "normalAssumptions": {"roundTripBps": 10.0, "executionDelayBars": 0}, "stressAssumptions": {"roundTripBps": 30.0, "executionDelayBars": 1}, "cacheIntegrity": integrity, "historicalEvidenceAudit": evidence, "historicalTestIsUntouched": evidence["historicalTestIsUntouched"], "oosIsNewEvidence": False, "candidateGenerationMode": "WINDOW_LOCAL_RESET_WITH_FROZEN_V6_MODELS", "controllerDesign": {"selectedFeatures": list(FEATURES), "thresholds": thresholds, "controllerDVTreatment": "2023-07-01..2025-07-01 only; known 2025-26 excluded", "structures": {"V6_BINARY_REGIME": "STRONG=100%, else Cash", "V6_3STATE_REGIME": "STRONG=100%, NEUTRAL=50%, WEAK=Cash", "V6_DYNAMIC_EXPOSURE": "score>=3=100%, score=2=50%, score=1=25%, score<=0=Cash"}, "futureInformationUsed": False}, "frozenDvExpectancy": frozen_dv, "periods": {name: {"start": start, "endExclusive": end, "oosIsNewEvidence": False} for name, start, end in PERIODS}, "annual": {name: {"summary": {variant: short(data, variant) for variant in data["variants"]}, "rawDiagnostics": {variant: {"attribution": data["variants"][variant]["attribution"], "drawdownEpisodes": data["variants"][variant]["drawdownEpisodes"], "falseOnOff": data["variants"][variant].get("falseOnOff"), "deltaVsBaseline": data["variants"][variant].get("deltaVsBaseline")} for variant in data["variants"]}} for name, data in annual.items()}, "rolling": [{"period": x["period"], "summary": {variant: short(x, variant) for variant in x["variants"]}, "deltaVsBaseline": {variant: x["variants"][variant].get("deltaVsBaseline") for variant in x["variants"] if variant != "V6_FROZEN_BASELINE"}} for x in rolling], "diagnostics": {"knownOosReevaluated": True, "annualVsRollingParityBasis": "window-local reset; same timestamp boundaries", "controllerNotOptimizedOnKnownOos": True, "falseOnOffUsesFutureOnlyForPostHoc": True},
    }
    # Compact top-level comparison and classifications for Actions logs.
    base3 = annual["3Y_COMBINED"]["variants"]["V6_FROZEN_BASELINE"]["summary"]
    dyn3 = annual["3Y_COMBINED"]["variants"][controller_variant]["summary"]
    y23 = annual["2023-24"]["variants"][controller_variant]["summary"]["returnPct"] - annual["2023-24"]["variants"]["V6_FROZEN_BASELINE"]["summary"]["returnPct"]
    y24 = annual["2024-25"]["variants"][controller_variant]["summary"]["returnPct"] - annual["2024-25"]["variants"]["V6_FROZEN_BASELINE"]["summary"]["returnPct"]
    retention = annual["2025-26"]["variants"][controller_variant]["summary"]["returnPct"] / max(annual["2025-26"]["variants"]["V6_FROZEN_BASELINE"]["summary"]["returnPct"], 1e-9) * 100.0
    wins = sum(x["variants"][controller_variant]["summary"]["returnPct"] > x["variants"]["V6_FROZEN_BASELINE"]["summary"]["returnPct"] for x in rolling)
    classification = "REGIME_CONTROLLER_PROMISING" if y23 > 10 and y24 > 10 and retention >= 80 else ("MIXED" if y23 > 0 and y24 > 0 else "FAILED")
    result["controllerAssessment"] = {"selectedVariant": controller_variant, "2023-24LossAvoidedPctPoints": y23, "2024-25LossAvoidedPctPoints": y24, "2025-26ProfitRetentionPct": retention, "rollingReturnBeatRatio": wins / max(1, len(rolling)), "classification": classification, "3YBaseline": {"returnPct": base3["returnPct"], "cagrPct": base3["cagrPct"], "maxDDPct": base3["maxDDPct"], "stressPf": base3["stressPf"]}, "3YController": {"returnPct": dyn3["returnPct"], "cagrPct": dyn3["cagrPct"], "maxDDPct": dyn3["maxDDPct"], "stressPf": dyn3["stressPf"]}}
    out_root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    out_root.mkdir(parents=True, exist_ok=True)
    path = out_root / "priority-router-v6-regime-attribution-3y.json"
    path.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({"status": result["status"], "oosIsNewEvidence": result["oosIsNewEvidence"], "classification": classification, "controllerAssessment": result["controllerAssessment"], "annual": {name: data["summary"] for name, data in result["annual"].items()}}, indent=2))


if __name__ == "__main__":
    main()
