from __future__ import annotations

import datetime as dt
import json
import math
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import research_lab_pengu_dual_engine_v39 as v39

HOUR = v39.HOUR
DAY = v39.DAY
DECISION_HOURS = v39.DECISION_HOURS


@dataclass(frozen=True)
class LongRule:
    family: str
    fast: int
    slow: int
    threshold: float
    aux_threshold: float
    relative_length: int
    relative_threshold: float
    volume_floor: float
    funding_cap: float
    btc_filter: str
    exit: v39.ExitSpec

    @property
    def side(self) -> int:
        return 1

    @property
    def strategy_id(self) -> str:
        def fmt(value: float) -> str:
            return str(value).replace(".", "p").replace("-", "m")
        return (
            f"L40_{self.family}_F{self.fast}_S{self.slow}_T{fmt(self.threshold)}"
            f"_A{fmt(self.aux_threshold)}_R{self.relative_length}_{fmt(self.relative_threshold)}"
            f"_V{fmt(self.volume_floor)}_FC{fmt(self.funding_cap)}"
            f"_B{self.btc_filter}_{self.exit.name}"
        )


@dataclass
class CachedSeries:
    rows: List[dict]
    close: List[float]
    high: List[float]
    low: List[float]
    volume: List[float]
    sma: Dict[int, List[Optional[float]]]
    momentum: Dict[int, List[Optional[float]]]
    rsi: Dict[int, List[Optional[float]]]
    atr: Dict[int, List[Optional[float]]]
    volume_ratio: List[Optional[float]]
    rolling_high: Dict[int, List[Optional[float]]]
    rolling_low: Dict[int, List[Optional[float]]]


def rolling_mean(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    running = 0.0
    for index, value in enumerate(values):
        running += value
        if index >= length:
            running -= values[index - length]
        if index >= length - 1:
            result[index] = running / length
    return result


def momentum_series(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    for index in range(length, len(values)):
        prior = values[index - length]
        if prior > 0:
            result[index] = (values[index] / prior - 1.0) * 100.0
    return result


def rsi_series(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    gains = [0.0] * len(values)
    losses = [0.0] * len(values)
    for index in range(1, len(values)):
        change = values[index] - values[index - 1]
        gains[index] = max(change, 0.0)
        losses[index] = max(-change, 0.0)
    gain_sum = loss_sum = 0.0
    for index in range(1, len(values)):
        gain_sum += gains[index]
        loss_sum += losses[index]
        if index > length:
            gain_sum -= gains[index - length]
            loss_sum -= losses[index - length]
        if index >= length:
            if loss_sum <= 0:
                result[index] = 100.0 if gain_sum > 0 else 50.0
            else:
                rs = gain_sum / loss_sum
                result[index] = 100.0 - 100.0 / (1.0 + rs)
    return result


def atr_series(rows: List[dict], length: int) -> List[Optional[float]]:
    true_ranges = [0.0] * len(rows)
    for index in range(1, len(rows)):
        previous = float(rows[index - 1]["close"])
        high = float(rows[index]["high"])
        low = float(rows[index]["low"])
        true_ranges[index] = max(high - low, abs(high - previous), abs(low - previous))
    return rolling_mean(true_ranges, length)


def prior_extreme(values: List[float], length: int, maximum: bool) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    for index in range(length, len(values)):
        window = values[index - length:index]
        result[index] = max(window) if maximum else min(window)
    return result


def build_cache(rows: List[dict]) -> CachedSeries:
    close = [float(row["close"]) for row in rows]
    high = [float(row["high"]) for row in rows]
    low = [float(row["low"]) for row in rows]
    volume = [float(row["volume"]) for row in rows]
    sma_lengths = [24, 48, 72, 120, 168]
    momentum_lengths = [6, 12, 24, 48, 72]
    rsi_lengths = [14, 21]
    atr_lengths = [24, 72]
    high_lengths = [3, 6, 12, 24, 48, 72]
    sma_map = {length: rolling_mean(close, length) for length in sma_lengths}
    momentum_map = {length: momentum_series(close, length) for length in momentum_lengths}
    rsi_map = {length: rsi_series(close, length) for length in rsi_lengths}
    atr_map = {length: atr_series(rows, length) for length in atr_lengths}
    recent = rolling_mean(volume, 12)
    base = rolling_mean(volume, 72)
    volume_ratio: List[Optional[float]] = [None] * len(rows)
    for index in range(len(rows)):
        if recent[index] is not None and base[index] and base[index] > 0:
            volume_ratio[index] = recent[index] / base[index]
    rolling_high = {length: prior_extreme(high, length, True) for length in high_lengths}
    rolling_low = {length: prior_extreme(low, length, False) for length in high_lengths}
    return CachedSeries(
        rows=rows,
        close=close,
        high=high,
        low=low,
        volume=volume,
        sma=sma_map,
        momentum=momentum_map,
        rsi=rsi_map,
        atr=atr_map,
        volume_ratio=volume_ratio,
        rolling_high=rolling_high,
        rolling_low=rolling_low,
    )


def long_exits() -> List[v39.ExitSpec]:
    return [
        v39.ExitSpec("TIME24", 24),
        v39.ExitSpec("TIME48", 48),
        v39.ExitSpec("ATR2p5_SL1p25_H48", 48, 2.5, 1.25),
        v39.ExitSpec("ATR3_SL1p5_H72", 72, 3.0, 1.5),
    ]


def long_rules() -> List[LongRule]:
    rules: List[LongRule] = []
    for exit_spec in long_exits():
        for lookback in [24, 48, 72]:
            for confirm in [6, 12]:
                for confirm_threshold in [0.0, 1.0]:
                    for relative_length in [24, 48]:
                        for relative_threshold in [0.0, 2.0]:
                            for volume_floor in [0.8, 1.0]:
                                for funding_cap in [0.0003, 0.0008]:
                                    rules.append(LongRule(
                                        "REL_BREAKOUT", confirm, lookback, confirm_threshold, 0.0,
                                        relative_length, relative_threshold, volume_floor, funding_cap,
                                        "RISK", exit_spec,
                                    ))
        for slow in [72, 120, 168]:
            for pullback_window in [12, 24]:
                for reclaim_window in [3, 6]:
                    for max_distance_pct in [4.0, 7.0]:
                        for relative_length in [24, 48]:
                            for relative_threshold in [-1.0, 1.0]:
                                for volume_floor in [0.8, 1.0]:
                                    for funding_cap in [0.0003, 0.0008]:
                                        rules.append(LongRule(
                                            "PULLBACK_RECLAIM", reclaim_window, slow,
                                            max_distance_pct, float(pullback_window),
                                            relative_length, relative_threshold, volume_floor,
                                            funding_cap, "RISK", exit_spec,
                                        ))
        for fast_sma in [24, 48]:
            for slow_sma in [120, 168]:
                for rsi_cap in [65.0, 72.0]:
                    for relative_length in [24, 48]:
                        for relative_threshold in [-1.0, 1.0]:
                            for volume_floor in [0.8, 1.0]:
                                for funding_cap in [0.0003, 0.0008]:
                                    rules.append(LongRule(
                                        "MA_RECLAIM", fast_sma, slow_sma, rsi_cap, 0.0,
                                        relative_length, relative_threshold, volume_floor,
                                        funding_cap, "RISK", exit_spec,
                                    ))
    unique = {rule.strategy_id: rule for rule in rules}
    return list(unique.values())


def latest_funding_by_index(points: List[dict], rows: List[dict]) -> List[float]:
    result = [0.0] * len(rows)
    cursor = 0
    latest = 0.0
    ordered = sorted(points, key=lambda row: int(row["ts"]))
    for index, row in enumerate(rows):
        ts = int(row["ts"])
        while cursor < len(ordered) and int(ordered[cursor]["ts"]) <= ts:
            latest = float(ordered[cursor]["rate"])
            cursor += 1
        result[index] = latest
    return result


def relative_momentum(
    pengu_cache: CachedSeries,
    p_index: int,
    btc_cache: CachedSeries,
    b_index: int,
    length: int,
) -> Optional[float]:
    p_value = pengu_cache.momentum[length][p_index]
    b_value = btc_cache.momentum[length][b_index]
    if p_value is None or b_value is None:
        return None
    return p_value - b_value


def rule_signal(
    rule: LongRule,
    pengu: CachedSeries,
    p_index: int,
    btc: CachedSeries,
    b_index: int,
    funding_by_index: List[float],
) -> bool:
    if p_index < 200 or b_index < 200:
        return False
    vol = pengu.volume_ratio[p_index]
    if vol is None or vol < rule.volume_floor:
        return False
    if funding_by_index[p_index] > rule.funding_cap:
        return False
    if not v39.btc_gate(1, rule.btc_filter, btc.rows, b_index):
        return False
    rel = relative_momentum(pengu, p_index, btc, b_index, rule.relative_length)
    if rel is None or rel < rule.relative_threshold:
        return False

    close = pengu.close[p_index]
    mom6 = pengu.momentum[6][p_index]
    if mom6 is None or mom6 <= 0:
        return False

    if rule.family == "REL_BREAKOUT":
        prior_high = pengu.rolling_high[rule.slow][p_index]
        confirm = pengu.momentum[rule.fast][p_index]
        trend = pengu.sma[72][p_index]
        rsi_value = pengu.rsi[14][p_index]
        return bool(
            prior_high is not None
            and confirm is not None
            and trend is not None
            and rsi_value is not None
            and close > prior_high
            and close > trend
            and confirm > rule.threshold
            and rsi_value <= 78.0
        )

    if rule.family == "PULLBACK_RECLAIM":
        trend = pengu.sma[rule.slow][p_index]
        trend_mom = pengu.momentum[24][p_index]
        reclaim_high = pengu.rolling_high[rule.fast][p_index]
        rsi_value = pengu.rsi[14][p_index]
        pullback_window = int(rule.aux_threshold)
        if trend is None or trend_mom is None or reclaim_high is None or rsi_value is None:
            return False
        start = max(0, p_index - pullback_window)
        touched = min(pengu.low[start:p_index + 1]) <= trend * 1.015
        distance = (close / trend - 1.0) * 100.0
        return bool(
            close > trend
            and trend_mom > 0
            and touched
            and close > reclaim_high
            and 0 <= distance <= rule.threshold
            and 45.0 <= rsi_value <= 72.0
        )

    fast_now = pengu.sma[rule.fast][p_index]
    fast_prev = pengu.sma[rule.fast][p_index - 1]
    slow_now = pengu.sma[rule.slow][p_index]
    rsi_value = pengu.rsi[14][p_index]
    previous_close = pengu.close[p_index - 1]
    return bool(
        fast_now is not None
        and fast_prev is not None
        and slow_now is not None
        and rsi_value is not None
        and close > fast_now
        and previous_close <= fast_prev
        and close > slow_now
        and rsi_value <= rule.threshold
    )


def resolve_long_exit(
    rule: LongRule,
    pengu: CachedSeries,
    entry_index: int,
    entry_price: float,
    signal_atr: float,
) -> tuple[int, float, str]:
    end_index = min(len(pengu.rows) - 1, entry_index + rule.exit.max_hold_hours)
    if rule.exit.take_profit_atr <= 0 or rule.exit.stop_loss_atr <= 0 or signal_atr <= 0:
        return end_index, float(pengu.rows[end_index]["open"]), "TIME"
    tp = entry_price + rule.exit.take_profit_atr * signal_atr
    sl = entry_price - rule.exit.stop_loss_atr * signal_atr
    for index in range(entry_index, end_index):
        high = pengu.high[index]
        low = pengu.low[index]
        if low <= sl:
            return index, sl, "SL"
        if high >= tp:
            return index, tp, "TP"
    return end_index, float(pengu.rows[end_index]["open"]), "TIME"


def build_trades(
    rule: LongRule,
    pengu: CachedSeries,
    btc: CachedSeries,
    funding: List[dict],
    funding_by_index: List[float],
) -> List[v39.Trade]:
    p_index = {int(row["ts"]): index for index, row in enumerate(pengu.rows)}
    b_index = {int(row["ts"]): index for index, row in enumerate(btc.rows)}
    common = sorted(set(p_index) & set(b_index))
    trades: List[v39.Trade] = []
    next_free = 0
    for ts in common:
        if ts < next_free or (ts // HOUR) % DECISION_HOURS != 0:
            continue
        pi = p_index[ts]
        bi = b_index[ts]
        if not rule_signal(rule, pengu, pi, btc, bi, funding_by_index):
            continue
        entry_index = pi + 1
        if entry_index >= len(pengu.rows):
            continue
        entry_ts = int(pengu.rows[entry_index]["ts"])
        entry_price = float(pengu.rows[entry_index]["open"])
        signal_atr = pengu.atr[24][pi] or 0.0
        exit_index, exit_price, reason = resolve_long_exit(rule, pengu, entry_index, entry_price, signal_atr)
        exit_ts = int(pengu.rows[exit_index]["ts"])
        if exit_ts <= entry_ts:
            continue
        gross = (exit_price / entry_price - 1.0) * 100.0
        paid_funding = v39.funding_between(funding, entry_ts, exit_ts)
        held_days = max(1.0 / 24.0, (exit_ts - entry_ts) / DAY)
        base = gross - paid_funding - 0.12 - 0.02 * held_days
        severe = gross - paid_funding - 0.20 - 0.05 * held_days
        trades.append(v39.Trade(
            rule.strategy_id, entry_ts, exit_ts, 1, entry_price, exit_price,
            gross, paid_funding, base, severe, reason,
        ))
        next_free = exit_ts
    return trades


def window_metrics(trades: List[v39.Trade], start: int, end: int) -> dict:
    return v39.metrics(trades, start, end)


def passes(metric: dict, min_trades: int, pf: float, max_dd: float) -> bool:
    return bool(
        metric["trades"] >= min_trades
        and metric["compoundedReturnPct"] > 0
        and (metric["profitFactor"] or 0) >= pf
        and metric["maxDrawdownPct"] >= max_dd
        and metric["severeReturnPct"] > 0
        and (metric["severeProfitFactor"] or 0) >= 1.0
    )


def neighbor(left: LongRule, right: LongRule) -> bool:
    if left.family != right.family or left.btc_filter != right.btc_filter or left.exit.name != right.exit.name:
        return False
    return bool(
        abs(left.fast - right.fast) <= 24
        and abs(left.slow - right.slow) <= 48
        and abs(left.threshold - right.threshold) <= 4.1
        and abs(left.aux_threshold - right.aux_threshold) <= 12.1
        and abs(left.relative_length - right.relative_length) <= 24
        and abs(left.relative_threshold - right.relative_threshold) <= 2.1
        and abs(left.volume_floor - right.volume_floor) <= 0.21
        and abs(left.funding_cap - right.funding_cap) <= 0.00051
    )


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    pengu_rows = v39.fetch_klines("PENGUUSDT", end)
    btc_rows = v39.fetch_klines("BTCUSDT", end)
    funding = v39.fetch_funding("PENGUUSDT", end)
    pengu = build_cache(pengu_rows)
    btc = build_cache(btc_rows)
    funding_by_index = latest_funding_by_index(funding, pengu_rows)

    first = max(int(pengu_rows[0]["ts"]), int(btc_rows[0]["ts"])) + 360 * HOUR
    last = min(int(pengu_rows[-1]["ts"]), int(btc_rows[-1]["ts"]))
    span = last - first
    dev_end = first + int(span * 0.45)
    val1_end = first + int(span * 0.65)
    val2_end = first + int(span * 0.80)

    rules = long_rules()
    results: Dict[str, dict] = {}
    trades_by_id: Dict[str, List[v39.Trade]] = {}
    passed: List[str] = []
    rule_map = {rule.strategy_id: rule for rule in rules}

    for rule in rules:
        trades = build_trades(rule, pengu, btc, funding, funding_by_index)
        trades_by_id[rule.strategy_id] = trades
        dev = window_metrics(trades, first, dev_end)
        val1 = window_metrics(trades, dev_end, val1_end)
        val2 = window_metrics(trades, val1_end, val2_end)
        combined_validation = window_metrics(trades, dev_end, val2_end)
        results[rule.strategy_id] = {
            "rule": asdict(rule),
            "development": dev,
            "validation1": val1,
            "validation2": val2,
            "combinedValidation": combined_validation,
        }
        if (
            passes(dev, 7, 1.15, -30)
            and passes(combined_validation, 5, 1.05, -25)
            and val1["compoundedReturnPct"] >= -2.0
            and val2["compoundedReturnPct"] >= -2.0
            and val1["severeReturnPct"] >= -3.0
            and val2["severeReturnPct"] >= -3.0
        ):
            passed.append(rule.strategy_id)

    stable = [
        strategy_id for strategy_id in passed
        if sum(1 for other in passed if other != strategy_id and neighbor(rule_map[strategy_id], rule_map[other])) >= 2
    ]
    stable.sort(key=lambda strategy_id: (
        min(
            results[strategy_id]["development"]["severeReturnPct"],
            results[strategy_id]["validation1"]["severeReturnPct"],
            results[strategy_id]["validation2"]["severeReturnPct"],
        ),
        min(
            results[strategy_id]["development"]["profitFactor"] or 0,
            results[strategy_id]["combinedValidation"]["profitFactor"] or 0,
        ),
        results[strategy_id]["combinedValidation"]["maxDrawdownPct"],
        -rule_map[strategy_id].exit.max_hold_hours,
    ), reverse=True)
    selected = stable[0] if stable else None
    holdout = window_metrics(trades_by_id[selected], val2_end, last + HOUR) if selected else None
    holdout_passed = bool(holdout and passes(holdout, 4, 1.0, -25))

    short_rule = v39.Rule(
        -1, "BREAKDOWN", 6, 24, 0.0, 0.0, 0.8, 0.0, "RISK",
        v39.ExitSpec("TIME24", 24),
    )
    short_trades = v39.build_trades(short_rule, pengu_rows, btc_rows, funding)
    short_metrics = {
        "development": v39.metrics(short_trades, first, dev_end),
        "validation1": v39.metrics(short_trades, dev_end, val1_end),
        "validation2": v39.metrics(short_trades, val1_end, val2_end),
        "frozenHoldout": v39.metrics(short_trades, val2_end, last + HOUR),
    }

    selected_trades = trades_by_id[selected] if selected and holdout_passed else []
    combined = v39.combine_trades(selected_trades, short_trades, 1.0, 1.0)
    combined_metrics = {
        "development": v39.metrics(combined, first, dev_end),
        "validation1": v39.metrics(combined, dev_end, val1_end),
        "validation2": v39.metrics(combined, val1_end, val2_end),
        "frozenHoldout": v39.metrics(combined, val2_end, last + HOUR),
        "full": v39.metrics(combined, first, last + HOUR),
    }
    short_holdout_passed = passes(short_metrics["frozenHoldout"], 3, 1.0, -25)
    combined_holdout_passed = bool(
        holdout_passed
        and short_holdout_passed
        and passes(combined_metrics["frozenHoldout"], 5, 1.0, -25)
    )
    status = (
        "PENGU_DUAL_ENGINE_FROZEN_CANDIDATE"
        if combined_holdout_passed
        else "PENGU_LONG_INCOMPLETE_SHORT_RETAINED"
    )

    payload = rounded({
        "version": 40,
        "strategyId": "PENGU_LONG_COMPLETION_V40",
        "status": status,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "data": {
            "penguRows": len(pengu_rows),
            "btcRows": len(btc_rows),
            "fundingRows": len(funding),
            "first": dt.datetime.fromtimestamp(first / 1000, tz=dt.timezone.utc).isoformat(),
            "developmentEnd": dt.datetime.fromtimestamp(dev_end / 1000, tz=dt.timezone.utc).isoformat(),
            "validation1End": dt.datetime.fromtimestamp(val1_end / 1000, tz=dt.timezone.utc).isoformat(),
            "validation2End": dt.datetime.fromtimestamp(val2_end / 1000, tz=dt.timezone.utc).isoformat(),
            "last": dt.datetime.fromtimestamp(last / 1000, tz=dt.timezone.utc).isoformat(),
        },
        "candidateCount": len(rules),
        "passedCount": len(passed),
        "stableCount": len(stable),
        "selectedLong": selected,
        "selectedLongRule": asdict(rule_map[selected]) if selected else None,
        "selectedLongFrozenHoldout": holdout,
        "longHoldoutPassed": holdout_passed,
        "fixedShortRule": asdict(short_rule),
        "fixedShortMetrics": short_metrics,
        "shortHoldoutPassed": short_holdout_passed,
        "combinedMetrics": combined_metrics,
        "combinedHoldoutPassed": combined_holdout_passed,
        "topStable": stable[:20],
        "results": {strategy_id: results[strategy_id] for strategy_id in stable[:30]},
        "selectedLongTrades": [asdict(trade) for trade in selected_trades],
        "fixedShortTrades": [asdict(trade) for trade in short_trades],
        "productionChanged": False,
        "realTradingEnabled": False,
        "limitations": [
            "Aster PENGU history begins in 2025, so all windows are shorter than the V28 core history.",
            "The latest frozen window has been observed in earlier PENGU research and is confirmation, not pristine future evidence.",
            "Microstructure signals are not backfilled historically; V19 spread, taker flow, basis and depth are reserved for forward vetoes.",
            "Long and Short never overlap; one-way position changes must close reduce-only before opening the opposite side.",
        ],
    })

    report = [
        "# PENGU Long Completion V40",
        "",
        f"- Status: **{status}**",
        f"- Candidates: {len(rules)}",
        f"- Pre-holdout passed: {len(passed)}",
        f"- Stable clusters: {len(stable)}",
        f"- Selected Long: **{selected or 'NONE'}**",
        f"- Long frozen holdout passed: **{'YES' if holdout_passed else 'NO'}**",
        f"- Fixed Short frozen holdout passed: **{'YES' if short_holdout_passed else 'NO'}**",
        f"- Combined frozen holdout passed: **{'YES' if combined_holdout_passed else 'NO'}**",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
    ]
    if selected and holdout:
        report.extend([
            "## Selected Long",
            "",
            f"- Rule: `{selected}`",
            f"- Holdout trades: {holdout['trades']}",
            f"- Holdout return: {holdout['compoundedReturnPct']}%",
            f"- Holdout PF: {holdout['profitFactor']}",
            f"- Holdout Severe: {holdout['severeReturnPct']}%",
            f"- Holdout DD: {holdout['maxDrawdownPct']}%",
            "",
        ])
    report.extend([
        "## Fixed V39 Short",
        "",
        f"- Rule: `{short_rule.strategy_id}`",
        f"- Holdout trades: {short_metrics['frozenHoldout']['trades']}",
        f"- Holdout return: {short_metrics['frozenHoldout']['compoundedReturnPct']}%",
        f"- Holdout PF: {short_metrics['frozenHoldout']['profitFactor']}",
        f"- Holdout Severe: {short_metrics['frozenHoldout']['severeReturnPct']}%",
        "",
        "## Combined",
        "",
        f"- Holdout return: {combined_metrics['frozenHoldout']['compoundedReturnPct']}%",
        f"- Holdout PF: {combined_metrics['frozenHoldout']['profitFactor']}",
        f"- Holdout Severe: {combined_metrics['frozenHoldout']['severeReturnPct']}%",
        f"- Full return: {combined_metrics['full']['compoundedReturnPct']}%",
        f"- Full PF: {combined_metrics['full']['profitFactor']}",
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-long-completion-v40.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    (state_dir / "pengu-long-completion-v40.md").write_text(
        "\n".join(report), encoding="utf-8",
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
