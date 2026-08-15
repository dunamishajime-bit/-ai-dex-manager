"""Portfolio Profit Engine V8 — clean-sheet cross-pair wave ownership research.

Purpose: test whether high portfolio CAGR can come from concentrated rotation
into the strongest owned crypto wave rather than from stacking pair-specific
entry filters. The architecture and thresholds in this file are fixed before
its first result is observed.

Research only. No production, VPS, LIVE, order, or Fresh-OOS path is imported.
Baseline gross exposure is <=100% of equity (one position at a time, no
leverage). Validation/Evaluation never choose thresholds or symbols.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as base

HOUR = base.HOUR
TRADE_SYMBOLS = ("SOL", "LINK", "ETH", "BNB", "AVAX")
REFERENCE_SYMBOL = "BTC"
NORMAL_BPS = 10.0
STRESS_BPS = 30.0
STRESS_DELAY = 1

# Frozen architecture constants. They are deliberately global, not per-symbol.
MIN_Z168 = 0.75
MIN_Z72 = 0.35
MIN_Z24 = 0.05
MIN_EFF168 = 0.18
LONG_RANGE_POS = 0.55
SHORT_RANGE_POS = 0.45
MIN_OPPORTUNITY_SCORE = 1.20
ROTATION_ADVANTAGE = 0.35
MIN_HOLD_HOURS = 12
MAX_HOLD_HOURS = 24 * 30
COOLDOWN_HOURS = 3
OWNERSHIP_Z72_FLOOR = 0.15
OWNERSHIP_Z24_FAIL = -0.10
TRAIL_CAPTURE_FLOOR = 0.45

TARGET_CAGR_PCT = 100.0
PROGRESS_CAGR_PCT = 80.0
MIN_PF = 1.30
MIN_PF_WO_BEST = 1.15
MAX_DD_ABS_PCT = 35.0
MIN_STRESS_PF = 1.05
MAX_STRESS_DD_ABS_PCT = 45.0
MIN_COMBINED_TRADES = 24
MIN_YEAR_TRADES = 5
MAX_LOSING_YEAR_PCT = -25.0
MAX_BEST_WIN_SHARE = 0.35


def _ret_pct(close: list[float], i: int, bars: int) -> float | None:
    if i < bars or close[i - bars] <= 0:
        return None
    return (close[i] / close[i - bars] - 1.0) * 100.0


def _prefix(values: list[float]) -> tuple[list[float], list[float]]:
    total = [0.0]
    sq = [0.0]
    for value in values:
        total.append(total[-1] + value)
        sq.append(sq[-1] + value * value)
    return total, sq


def _window_sd(total: list[float], sq: list[float], i: int, window: int) -> float:
    lo = max(1, i - window + 1)
    hi = i + 1
    n = hi - lo
    if n < max(12, window // 2):
        return 0.0
    s = total[hi] - total[lo]
    q = sq[hi] - sq[lo]
    mean = s / n
    var = max(0.0, q / n - mean * mean)
    return math.sqrt(var)


def build_features(candles: dict[str, list[dict[str, Any]]]) -> dict[str, dict[int, dict[str, float]]]:
    all_features: dict[str, dict[int, dict[str, float]]] = {}
    for symbol in (REFERENCE_SYMBOL,) + TRADE_SYMBOLS:
        rows = candles[symbol]
        close = [float(r["close"]) for r in rows]
        highs = [float(r["high"]) for r in rows]
        lows = [float(r["low"]) for r in rows]
        hourly = [0.0]
        moves = [0.0]
        for i in range(1, len(rows)):
            if close[i - 1] <= 0:
                hourly.append(0.0); moves.append(0.0)
            else:
                r = (close[i] / close[i - 1] - 1.0) * 100.0
                hourly.append(r); moves.append(abs(r))
        total, sq = _prefix(hourly)
        move_total = [0.0]
        for value in moves:
            move_total.append(move_total[-1] + value)

        features: dict[int, dict[str, float]] = {}
        for i in range(720, len(rows)):
            sd168 = _window_sd(total, sq, i, 168)
            sd24 = _window_sd(total, sq, i, 24)
            if sd168 <= 1e-9:
                continue
            vals: dict[str, float] = {}
            good = True
            for bars in (6, 24, 72, 168, 720):
                ret = _ret_pct(close, i, bars)
                if ret is None:
                    good = False; break
                vals[f"r{bars}"] = float(ret)
                vals[f"z{bars}"] = float(ret) / (sd168 * math.sqrt(float(bars)))
            if not good:
                continue
            move_sum = move_total[i + 1] - move_total[i - 168 + 1]
            eff168 = abs(vals["r168"]) / move_sum if move_sum > 1e-9 else 0.0
            lo = min(lows[i - 167:i + 1]); hi = max(highs[i - 167:i + 1])
            rp = (close[i] - lo) / (hi - lo) if hi > lo else 0.5
            vals.update({
                "eff168": float(eff168),
                "rangePos168": float(rp),
                "sd168PctHourly": float(sd168),
                "volRatio24to168": float(sd24 / sd168) if sd168 > 0 else 1.0,
            })
            features[int(rows[i]["ts"])] = vals
        all_features[symbol] = features
    return all_features


def _opportunities(ts: int, features: dict[str, dict[int, dict[str, float]]]) -> list[dict[str, Any]]:
    btc = features[REFERENCE_SYMBOL].get(ts)
    if btc is None:
        return []
    available = {s: features[s].get(ts) for s in TRADE_SYMBOLS}
    vals72 = [float(x["z72"]) for x in available.values() if x is not None]
    if not vals72:
        return []
    median72 = statistics.median(vals72)
    positive72 = sum(float(x["z72"]) > 0 for x in available.values() if x is not None)
    breadth = positive72 / len(vals72)
    out: list[dict[str, Any]] = []
    for symbol in TRADE_SYMBOLS:
        x = available[symbol]
        if x is None:
            continue
        side = 0
        if (
            x["z168"] >= MIN_Z168 and x["z72"] >= MIN_Z72 and x["z24"] >= MIN_Z24
            and x["z6"] >= 0 and x["eff168"] >= MIN_EFF168 and x["rangePos168"] >= LONG_RANGE_POS
            and btc["z168"] > -0.80
        ):
            side = 1
        elif (
            x["z168"] <= -MIN_Z168 and x["z72"] <= -MIN_Z72 and x["z24"] <= -MIN_Z24
            and x["z6"] <= 0 and x["eff168"] >= MIN_EFF168 and x["rangePos168"] <= SHORT_RANGE_POS
            and btc["z168"] < 0.80
        ):
            side = -1
        if side == 0:
            continue
        relative = float(x["z72"]) - median72
        breadth_align = (2.0 * breadth - 1.0) * side
        btc_align = float(btc["z168"]) * side
        score = (
            0.42 * abs(float(x["z168"]))
            + 0.28 * abs(float(x["z72"]))
            + 0.12 * abs(float(x["z24"]))
            + 0.55 * float(x["eff168"])
            + 0.16 * abs(relative)
            + 0.12 * max(-1.0, min(1.0, breadth_align))
            + 0.08 * max(-1.0, min(1.0, btc_align))
        )
        if score < MIN_OPPORTUNITY_SCORE:
            continue
        out.append({
            "symbol": symbol,
            "sideSign": side,
            "score": float(score),
            "relativeZ72": float(relative),
            "breadth72": float(breadth),
            "btcZ168": float(btc["z168"]),
            **x,
        })
    out.sort(key=lambda row: (-float(row["score"]), row["symbol"]))
    return out


def _pf(values: list[float]) -> float | None:
    gains = sum(v for v in values if v > 0)
    losses = abs(sum(v for v in values if v < 0))
    if losses <= 1e-12:
        return 999.0 if gains > 0 else None
    return gains / losses


def _metric(records: list[dict[str, Any]], start: int, end: int, max_dd_pct: float) -> dict[str, Any]:
    vals = [float(r["netReturnPct"]) for r in records]
    equity = 1.0
    for value in vals:
        equity *= max(0.000001, 1.0 + value / 100.0)
    years = max(1e-9, (end - start) / (365.25 * 24.0 * 3600.0 * 1000.0))
    cagr = (equity ** (1.0 / years) - 1.0) * 100.0 if equity > 0 else -100.0
    wo = list(vals)
    if wo:
        wo.pop(max(range(len(wo)), key=wo.__getitem__))
    winning = [v for v in vals if v > 0]
    best_share = (max(winning) / sum(winning)) if winning and sum(winning) > 0 else 0.0
    return {
        "trades": len(vals),
        "returnPct": (equity - 1.0) * 100.0,
        "cagrPct": cagr,
        "pf": _pf(vals),
        "pfWithoutBest": _pf(wo),
        "maxDDPct": max_dd_pct,
        "winRatePct": 100.0 * sum(v > 0 for v in vals) / len(vals) if vals else None,
        "medianTradePct": statistics.median(vals) if vals else None,
        "bestWinningTradeShareOfGrossWins": best_share,
        "longTrades": sum(int(r["sideSign"]) > 0 for r in records),
        "shortTrades": sum(int(r["sideSign"]) < 0 for r in records),
        "symbolContributionPctPoints": {
            s: sum(float(r["netReturnPct"]) for r in records if r["symbol"] == s) for s in TRADE_SYMBOLS
        },
        "exitReasons": {
            reason: sum(r["exitReason"] == reason for r in records)
            for reason in sorted({str(r["exitReason"]) for r in records})
        },
    }


def simulate(
    candles: dict[str, list[dict[str, Any]]],
    index: dict[str, dict[int, int]],
    features: dict[str, dict[int, dict[str, float]]],
    start: int,
    end: int,
    cost_bps: float,
    delay_bars: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    timeline = [int(r["ts"]) for r in candles[REFERENCE_SYMBOL] if start <= int(r["ts"]) < end]
    equity = 1.0
    equity_peak = 1.0
    max_dd = 0.0
    position: dict[str, Any] | None = None
    pending_entry: dict[str, Any] | None = None
    pending_exit: dict[str, Any] | None = None
    cooldown_until = start
    records: list[dict[str, Any]] = []

    def update_mtm(ts: int) -> None:
        nonlocal equity_peak, max_dd
        if position is None:
            equity_peak = max(equity_peak, equity)
            max_dd = min(max_dd, (equity / equity_peak - 1.0) * 100.0)
            return
        symbol = str(position["symbol"]); i = index[symbol].get(ts)
        if i is None:
            return
        row = candles[symbol][i]
        side = int(position["sideSign"]); entry = float(position["entryPrice"])
        mtm_pct = side * (float(row["close"]) / entry - 1.0) * 100.0
        mtm_eq = float(position["entryEquity"]) * max(0.000001, 1.0 + mtm_pct / 100.0)
        equity_peak = max(equity_peak, mtm_eq)
        max_dd = min(max_dd, (mtm_eq / equity_peak - 1.0) * 100.0)
        if side > 0:
            position["bestPrice"] = max(float(position["bestPrice"]), float(row["high"]))
        else:
            position["bestPrice"] = min(float(position["bestPrice"]), float(row["low"]))

    for ts in timeline:
        # Execute scheduled exit first at this bar's open.
        if pending_exit is not None and position is not None and ts >= int(pending_exit["executeTs"]):
            symbol = str(position["symbol"]); i = index[symbol].get(int(pending_exit["executeTs"]))
            if i is None:
                raise RuntimeError(f"V8_EXIT_INDEX_MISSING:{symbol}:{pending_exit['executeTs']}")
            exit_row = candles[symbol][i]; exit_price = float(exit_row["open"])
            side = int(position["sideSign"]); entry = float(position["entryPrice"])
            gross = side * (exit_price / entry - 1.0) * 100.0
            net = gross - cost_bps / 100.0
            equity_before = float(position["entryEquity"])
            equity = equity_before * max(0.000001, 1.0 + net / 100.0)
            records.append({
                "symbol": symbol,
                "side": "LONG" if side > 0 else "SHORT",
                "sideSign": side,
                "signalTs": int(position["signalTs"]),
                "entryTs": int(position["entryTs"]),
                "exitSignalTs": int(pending_exit["signalTs"]),
                "exitTs": int(pending_exit["executeTs"]),
                "entryPrice": entry,
                "exitPrice": exit_price,
                "grossReturnPct": gross,
                "netReturnPct": net,
                "entryScore": float(position["entryScore"]),
                "exitReason": str(pending_exit["reason"]),
                "holdingHours": int((int(pending_exit["executeTs"]) - int(position["entryTs"])) // HOUR),
                "equityBefore": equity_before,
                "equityAfter": equity,
            })
            position = None; pending_exit = None
            cooldown_until = ts + COOLDOWN_HOURS * HOUR
            update_mtm(ts)
            continue

        # Execute scheduled entry at this bar's open.
        if pending_entry is not None and position is None and ts >= int(pending_entry["executeTs"]):
            symbol = str(pending_entry["symbol"]); i = index[symbol].get(int(pending_entry["executeTs"]))
            if i is not None and int(pending_entry["executeTs"]) < end:
                row = candles[symbol][i]; price = float(row["open"])
                position = {
                    "symbol": symbol,
                    "sideSign": int(pending_entry["sideSign"]),
                    "signalTs": int(pending_entry["signalTs"]),
                    "entryTs": int(pending_entry["executeTs"]),
                    "entryPrice": price,
                    "bestPrice": price,
                    "entryScore": float(pending_entry["score"]),
                    "entryEquity": equity,
                }
            pending_entry = None

        update_mtm(ts)

        if position is not None:
            if pending_exit is not None:
                continue
            symbol = str(position["symbol"]); side = int(position["sideSign"])
            i = index[symbol].get(ts); x = features[symbol].get(ts)
            if i is None or x is None:
                continue
            row = candles[symbol][i]; entry = float(position["entryPrice"])
            current_pct = side * (float(row["close"]) / entry - 1.0) * 100.0
            if side > 0:
                mfe = (float(position["bestPrice"]) / entry - 1.0) * 100.0
            else:
                mfe = (entry - float(position["bestPrice"])) / entry * 100.0
            held = int((ts - int(position["entryTs"])) // HOUR)
            expected24 = float(x["sd168PctHourly"]) * math.sqrt(24.0)
            stop_pct = max(2.5, min(8.0, 1.8 * expected24))
            trail_trigger = max(2.5, 1.2 * expected24)
            reason: str | None = None
            if current_pct <= -stop_pct:
                reason = "VOL_ADAPTIVE_STOP"
            elif held >= MIN_HOLD_HOURS and side * float(x["z24"]) < OWNERSHIP_Z24_FAIL and side * float(x["z72"]) < OWNERSHIP_Z72_FLOOR:
                reason = "OWNERSHIP_LOST"
            elif held >= MIN_HOLD_HOURS and mfe >= trail_trigger and (current_pct / max(mfe, 1e-9)) < TRAIL_CAPTURE_FLOOR:
                reason = "PROFIT_RELEASE"
            elif held >= MAX_HOLD_HOURS:
                reason = "MAX_HOLD"
            else:
                ranked = _opportunities(ts, features)
                top = ranked[0] if ranked else None
                current_opp = next((r for r in ranked if r["symbol"] == symbol and int(r["sideSign"]) == side), None)
                current_score = float(current_opp["score"]) if current_opp else -999.0
                if (
                    held >= MIN_HOLD_HOURS and top is not None and top["symbol"] != symbol
                    and float(top["score"]) >= max(MIN_OPPORTUNITY_SCORE, current_score + ROTATION_ADVANTAGE)
                    and (current_opp is None or side * float(x["z24"]) < 0.15)
                ):
                    reason = "STRONGER_WAVE_ROTATION"
            if reason is not None:
                ei = i + 1 + delay_bars
                if ei < len(candles[symbol]) and int(candles[symbol][ei]["ts"]) < end:
                    pending_exit = {"reason": reason, "signalTs": ts, "executeTs": int(candles[symbol][ei]["ts"])}
            continue

        if pending_entry is not None or ts < cooldown_until:
            continue
        ranked = _opportunities(ts, features)
        if not ranked:
            continue
        top = ranked[0]; symbol = str(top["symbol"]); i = index[symbol].get(ts)
        if i is None:
            continue
        ei = i + 1 + delay_bars
        if ei >= len(candles[symbol]):
            continue
        execute_ts = int(candles[symbol][ei]["ts"])
        if execute_ts >= end:
            continue
        pending_entry = {
            "symbol": symbol,
            "sideSign": int(top["sideSign"]),
            "score": float(top["score"]),
            "signalTs": ts,
            "executeTs": execute_ts,
        }

    # Fail-closed period-end liquidation at the last available close; pending
    # entries are cancelled. This never reads the next period.
    pending_entry = None
    if position is not None:
        symbol = str(position["symbol"]); side = int(position["sideSign"])
        available_ts = [int(r["ts"]) for r in candles[symbol] if start <= int(r["ts"]) < end]
        final_ts = max(available_ts); i = index[symbol][final_ts]
        exit_price = float(candles[symbol][i]["close"]); entry = float(position["entryPrice"])
        gross = side * (exit_price / entry - 1.0) * 100.0
        net = gross - cost_bps / 100.0
        equity_before = float(position["entryEquity"]); equity = equity_before * max(0.000001, 1.0 + net / 100.0)
        records.append({
            "symbol": symbol, "side": "LONG" if side > 0 else "SHORT", "sideSign": side,
            "signalTs": int(position["signalTs"]), "entryTs": int(position["entryTs"]),
            "exitSignalTs": final_ts, "exitTs": final_ts, "entryPrice": entry, "exitPrice": exit_price,
            "grossReturnPct": gross, "netReturnPct": net, "entryScore": float(position["entryScore"]),
            "exitReason": "PERIOD_END", "holdingHours": int((final_ts - int(position["entryTs"])) // HOUR),
            "equityBefore": equity_before, "equityAfter": equity,
        })
        equity_peak = max(equity_peak, equity)
        max_dd = min(max_dd, (equity / equity_peak - 1.0) * 100.0)

    return _metric(records, start, end, max_dd), records


def _historical_gate(normal: dict[str, Any], stress: dict[str, Any], annual: dict[str, dict[str, Any]]) -> dict[str, Any]:
    checks = {
        "cagr100": float(normal["cagrPct"]) >= TARGET_CAGR_PCT,
        "pf": float(normal["pf"] or 0) >= MIN_PF,
        "pfWithoutBest": float(normal["pfWithoutBest"] or 0) >= MIN_PF_WO_BEST,
        "maxDD": abs(float(normal["maxDDPct"])) <= MAX_DD_ABS_PCT,
        "stressPositive": float(stress["returnPct"]) > 0,
        "stressPf": float(stress["pf"] or 0) >= MIN_STRESS_PF,
        "stressDD": abs(float(stress["maxDDPct"])) <= MAX_STRESS_DD_ABS_PCT,
        "combinedTrades": int(normal["trades"]) >= MIN_COMBINED_TRADES,
        "annualTrades": all(int(annual[y]["trades"]) >= MIN_YEAR_TRADES for y in ("development", "validation", "evaluation")),
        "positiveYears": sum(float(annual[y]["returnPct"]) > 0 for y in ("development", "validation", "evaluation")) >= 2,
        "worstYear": min(float(annual[y]["returnPct"]) for y in ("development", "validation", "evaluation")) >= MAX_LOSING_YEAR_PCT,
        "bestTradeConcentration": float(normal["bestWinningTradeShareOfGrossWins"]) <= MAX_BEST_WIN_SHARE,
    }
    cagr = float(normal["cagrPct"])
    band = "MAIN_TARGET" if cagr >= TARGET_CAGR_PCT else "PROGRESS_80_TO_100" if cagr >= PROGRESS_CAGR_PCT else "INSUFFICIENT_LT_80"
    return {"performanceBand": band, "checks": checks, "historicalCandidatePass": all(checks.values())}


def main() -> None:
    candles, index, _ = base.v109.b.base.load()
    features = build_features(candles)
    annual: dict[str, dict[str, Any]] = {}
    annual_stress: dict[str, dict[str, Any]] = {}
    for label in ("development", "validation", "evaluation"):
        start, end = base.PERIODS[label]
        annual[label], _ = simulate(candles, index, features, start, end, NORMAL_BPS, 0)
        annual_stress[label], _ = simulate(candles, index, features, start, end, STRESS_BPS, STRESS_DELAY)
    start, end = base.PERIODS["combined"]
    combined, records = simulate(candles, index, features, start, end, NORMAL_BPS, 0)
    stress, _ = simulate(candles, index, features, start, end, STRESS_BPS, STRESS_DELAY)
    gate = _historical_gate(combined, stress, annual)

    out = {
        "researchLine": "PORTFOLIO_PROFIT_ENGINE_V8_WAVE_OWNERSHIP",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "liveEligible": False,
        "freshOosRead": False,
        "freshOosConsumed": False,
        "freshOosPermission": bool(gate["historicalCandidatePass"]),
        "target": {
            "main3YCagrPct": TARGET_CAGR_PCT,
            "progressFloorCagrPct": PROGRESS_CAGR_PCT,
            "grossExposureCapPct": 100.0,
            "leverageMultiplier": 1.0,
        },
        "architecture": "Regime -> Opportunity -> Cross-pair Selection -> Entry -> Wave Ownership -> Exit/Rotation",
        "antiOverfit": {
            "architectureFrozenBeforeFirstResult": True,
            "globalThresholdsOnly": True,
            "perSymbolParameters": False,
            "parameterGrid": False,
            "developmentParameterSearch": False,
            "validationUsedForSelection": False,
            "evaluationUsedForSelection": False,
            "sameRunRetuning": False,
            "freshOosUsedForTuning": False,
            "leverageUsedToReachTarget": False,
            "onePositionMaximum": True,
        },
        "costs": {"normalTotalBpsPerRoundTrip": NORMAL_BPS, "stressTotalBpsPerRoundTrip": STRESS_BPS, "stressExtraDelayBars": STRESS_DELAY},
        "periods": base.PERIODS,
        "annual": annual,
        "annualStress": annual_stress,
        "combined3Y": combined,
        "combined3YStress": stress,
        "historicalGate": gate,
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    report_path = root / "portfolio-profit-engine-v8.json"
    trades_path = root / "portfolio-profit-engine-v8-trades.jsonl"
    report_path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    with trades_path.open("w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record, sort_keys=True) + "\n")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
