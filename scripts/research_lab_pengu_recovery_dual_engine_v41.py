from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_pengu_dual_engine_v39 as v39
import research_lab_pengu_long_completion_v40 as v40

HOUR = v39.HOUR
DAY = v39.DAY
DECISION_HOURS = v39.DECISION_HOURS


@dataclass(frozen=True)
class RecoveryRule:
    family: str
    lookback: int
    confirm: int
    threshold: float
    secondary: float
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
            f"L41_{self.family}_L{self.lookback}_C{self.confirm}"
            f"_T{fmt(self.threshold)}_S{fmt(self.secondary)}"
            f"_R{self.relative_length}_{fmt(self.relative_threshold)}"
            f"_V{fmt(self.volume_floor)}_F{fmt(self.funding_cap)}"
            f"_B{self.btc_filter}_{self.exit.name}"
        )


def exits() -> List[v39.ExitSpec]:
    return [
        v39.ExitSpec("TIME24", 24),
        v39.ExitSpec("ATR2p5_SL1p25_H48", 48, 2.5, 1.25),
        v39.ExitSpec("ATR3_SL1p5_H72", 72, 3.0, 1.5),
    ]


def rules() -> List[RecoveryRule]:
    result: List[RecoveryRule] = []
    for exit_spec in exits():
        for oversold_window in [12, 24]:
            for reclaim_window in [3, 6]:
                for oversold_rsi in [30.0, 35.0]:
                    for recovered_rsi in [45.0, 50.0]:
                        for rel_length in [24, 48]:
                            for rel_threshold in [-2.0, 0.0]:
                                for volume in [0.8, 1.0]:
                                    for funding_cap in [0.0003, 0.0008]:
                                        for btc_filter in ["RISK"]:
                                            result.append(RecoveryRule(
                                                "OVERSOLD_RECLAIM", oversold_window, reclaim_window,
                                                oversold_rsi, recovered_rsi, rel_length, rel_threshold,
                                                volume, funding_cap, btc_filter, exit_spec,
                                            ))
        for breakout_lookback in [24, 48]:
            for breakout_age in [6, 12]:
                for retest_pct in [1.0, 2.0]:
                    for confirm_threshold in [0.0, 1.0]:
                        for rel_length in [24, 48]:
                            for rel_threshold in [0.0, 1.0]:
                                for volume in [0.8, 1.0]:
                                    for funding_cap in [0.0003, 0.0008]:
                                        for btc_filter in ["RISK"]:
                                            result.append(RecoveryRule(
                                                "BREAKOUT_RETEST", breakout_lookback, breakout_age,
                                                retest_pct, confirm_threshold, rel_length, rel_threshold,
                                                volume, funding_cap, btc_filter, exit_spec,
                                            ))
        for trend_sma in [72, 120]:
            for crossover_lag in [6, 12]:
                for current_mom in [0.0, 1.0]:
                    for rsi_cap in [65.0, 72.0]:
                        for rel_length in [24, 48]:
                            for rel_threshold in [-1.0, 1.0]:
                                for volume in [0.8, 1.0]:
                                    for funding_cap in [0.0003, 0.0008]:
                                        for btc_filter in ["RISK"]:
                                            result.append(RecoveryRule(
                                                "TREND_RESUME", trend_sma, crossover_lag,
                                                current_mom, rsi_cap, rel_length, rel_threshold,
                                                volume, funding_cap, btc_filter, exit_spec,
                                            ))
        for high_lookback in [48, 72]:
            for reclaim_window in [3, 6]:
                for drawdown_pct in [10.0, 15.0]:
                    for recovered_rsi in [45.0, 50.0]:
                        for rel_length in [24, 48]:
                            for rel_threshold in [-3.0, 0.0]:
                                for volume in [0.8, 1.0]:
                                    for funding_cap in [0.0003, 0.0008]:
                                        for btc_filter in ["RISK"]:
                                            result.append(RecoveryRule(
                                                "CAPITULATION_RECLAIM", high_lookback, reclaim_window,
                                                drawdown_pct, recovered_rsi, rel_length, rel_threshold,
                                                volume, funding_cap, btc_filter, exit_spec,
                                            ))
    return list({rule.strategy_id: rule for rule in result}.values())


def relative_momentum(
    pengu: v40.CachedSeries,
    p_index: int,
    btc: v40.CachedSeries,
    b_index: int,
    length: int,
) -> Optional[float]:
    p_value = pengu.momentum[length][p_index]
    b_value = btc.momentum[length][b_index]
    if p_value is None or b_value is None:
        return None
    return p_value - b_value


def common_gate(
    rule: RecoveryRule,
    pengu: v40.CachedSeries,
    p_index: int,
    btc: v40.CachedSeries,
    b_index: int,
    funding_by_index: List[float],
) -> bool:
    if p_index < 220 or b_index < 220:
        return False
    volume = pengu.volume_ratio[p_index]
    if volume is None or volume < rule.volume_floor:
        return False
    if funding_by_index[p_index] > rule.funding_cap:
        return False
    if not v39.btc_gate(1, rule.btc_filter, btc.rows, b_index):
        return False
    relative = relative_momentum(pengu, p_index, btc, b_index, rule.relative_length)
    return relative is not None and relative >= rule.relative_threshold


def signal(
    rule: RecoveryRule,
    pengu: v40.CachedSeries,
    p_index: int,
    btc: v40.CachedSeries,
    b_index: int,
    funding_by_index: List[float],
) -> bool:
    if not common_gate(rule, pengu, p_index, btc, b_index, funding_by_index):
        return False
    close = pengu.close[p_index]
    mom6 = pengu.momentum[6][p_index]
    rsi_now = pengu.rsi[14][p_index]
    if mom6 is None or rsi_now is None:
        return False

    if rule.family == "OVERSOLD_RECLAIM":
        start = max(0, p_index - rule.lookback)
        recent_rsi = [value for value in pengu.rsi[14][start:p_index] if value is not None]
        reclaim_high = pengu.rolling_high[rule.confirm][p_index]
        sma72 = pengu.sma[72][p_index]
        if not recent_rsi or reclaim_high is None or sma72 is None:
            return False
        was_oversold = min(recent_rsi) <= rule.threshold
        recovered = rsi_now >= rule.secondary and close > reclaim_high and mom6 > 0
        trend_ok = close > sma72 or (rsi_now >= rule.secondary + 6 and mom6 > 2)
        return was_oversold and recovered and trend_ok

    if rule.family == "BREAKOUT_RETEST":
        age = rule.confirm
        breakout_index = p_index - age
        if breakout_index <= rule.lookback:
            return False
        prior_high = max(pengu.high[breakout_index - rule.lookback:breakout_index])
        breakout_close = pengu.close[breakout_index]
        if breakout_close <= prior_high:
            return False
        post_breakout_lows = pengu.low[breakout_index + 1:p_index + 1]
        if not post_breakout_lows:
            return False
        retested = min(post_breakout_lows) <= prior_high * (1 + rule.threshold / 100.0)
        held_level = min(post_breakout_lows) >= prior_high * 0.94
        return (
            retested
            and held_level
            and close > prior_high
            and mom6 > rule.secondary
            and 45 <= rsi_now <= 76
        )

    if rule.family == "TREND_RESUME":
        trend = pengu.sma[rule.lookback][p_index]
        prior_mom = pengu.momentum[6][p_index - rule.confirm]
        mom24 = pengu.momentum[24][p_index]
        if trend is None or prior_mom is None or mom24 is None:
            return False
        return (
            close > trend
            and mom24 > 0
            and prior_mom <= 0
            and mom6 > rule.threshold
            and 45 <= rsi_now <= rule.secondary
        )

    recent_high = pengu.rolling_high[rule.lookback][p_index]
    reclaim_high = pengu.rolling_high[rule.confirm][p_index]
    if recent_high is None or reclaim_high is None:
        return False
    drawdown = (close / recent_high - 1.0) * 100.0
    min_close = min(pengu.close[max(0, p_index - rule.lookback):p_index + 1])
    peak_to_trough = (min_close / recent_high - 1.0) * 100.0
    return (
        peak_to_trough <= -rule.threshold
        and drawdown > peak_to_trough + 4.0
        and close > reclaim_high
        and mom6 > 0
        and rsi_now >= rule.secondary
    )


def resolve_exit(
    rule: RecoveryRule,
    pengu: v40.CachedSeries,
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
        if pengu.low[index] <= sl:
            return index, sl, "SL"
        if pengu.high[index] >= tp:
            return index, tp, "TP"
    return end_index, float(pengu.rows[end_index]["open"]), "TIME"


def build_trades(
    rule: RecoveryRule,
    pengu: v40.CachedSeries,
    btc: v40.CachedSeries,
    funding: List[dict],
    funding_by_index: List[float],
) -> List[v39.Trade]:
    p_map = {int(row["ts"]): index for index, row in enumerate(pengu.rows)}
    b_map = {int(row["ts"]): index for index, row in enumerate(btc.rows)}
    common = sorted(set(p_map) & set(b_map))
    trades: List[v39.Trade] = []
    next_free = 0
    for ts in common:
        if ts < next_free or (ts // HOUR) % DECISION_HOURS != 0:
            continue
        pi = p_map[ts]
        bi = b_map[ts]
        if not signal(rule, pengu, pi, btc, bi, funding_by_index):
            continue
        entry_index = pi + 1
        if entry_index >= len(pengu.rows):
            continue
        entry_ts = int(pengu.rows[entry_index]["ts"])
        entry_price = float(pengu.rows[entry_index]["open"])
        atr_value = pengu.atr[24][pi] or 0.0
        exit_index, exit_price, reason = resolve_exit(rule, pengu, entry_index, entry_price, atr_value)
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


def neighbor(left: RecoveryRule, right: RecoveryRule) -> bool:
    if left.family != right.family or left.exit.name != right.exit.name or left.btc_filter != right.btc_filter:
        return False
    return (
        abs(left.lookback - right.lookback) <= 48
        and abs(left.confirm - right.confirm) <= 12
        and abs(left.threshold - right.threshold) <= 5.1
        and abs(left.secondary - right.secondary) <= 6.1
        and abs(left.relative_length - right.relative_length) <= 24
        and abs(left.relative_threshold - right.relative_threshold) <= 3.1
        and abs(left.volume_floor - right.volume_floor) <= 0.21
        and abs(left.funding_cap - right.funding_cap) <= 0.00051
    )


def metrics(trades: List[v39.Trade], start: int, end: int) -> dict:
    return v39.metrics(trades, start, end)


def preholdout_pass(item: dict) -> bool:
    full = item["preHoldout"]
    folds = item["folds"]
    positive = sum(fold["compoundedReturnPct"] > 0 for fold in folds)
    severe_positive = sum(fold["severeReturnPct"] > 0 for fold in folds)
    return bool(
        full["trades"] >= 12
        and full["compoundedReturnPct"] > 0
        and (full["profitFactor"] or 0) >= 1.15
        and full["maxDrawdownPct"] >= -30
        and full["severeReturnPct"] > 0
        and (full["severeProfitFactor"] or 0) >= 1.05
        and positive >= 3
        and severe_positive >= 3
        and min(fold["compoundedReturnPct"] for fold in folds) >= -6.0
        and min(fold["severeReturnPct"] for fold in folds) >= -7.0
    )


def holdout_pass(metric: dict) -> bool:
    return bool(
        metric["trades"] >= 3
        and metric["compoundedReturnPct"] > 0
        and (metric["profitFactor"] or 0) >= 1.0
        and metric["maxDrawdownPct"] >= -25
        and metric["severeReturnPct"] > 0
        and (metric["severeProfitFactor"] or 0) >= 1.0
    )


def build_ensemble_trades(
    members: List[RecoveryRule],
    pengu: v40.CachedSeries,
    btc: v40.CachedSeries,
    funding: List[dict],
    funding_by_index: List[float],
) -> List[v39.Trade]:
    if not members:
        return []
    p_map = {int(row["ts"]): index for index, row in enumerate(pengu.rows)}
    b_map = {int(row["ts"]): index for index, row in enumerate(btc.rows)}
    common = sorted(set(p_map) & set(b_map))
    trades: List[v39.Trade] = []
    next_free = 0
    required = 2 if len(members) >= 3 else 1
    ensemble_id = "ENS41_" + "_".join(rule.strategy_id for rule in members[:3])
    for ts in common:
        if ts < next_free or (ts // HOUR) % DECISION_HOURS != 0:
            continue
        pi = p_map[ts]
        bi = b_map[ts]
        votes = sum(signal(rule, pengu, pi, btc, bi, funding_by_index) for rule in members)
        if votes < required:
            continue
        entry_index = pi + 1
        if entry_index >= len(pengu.rows):
            continue
        entry_ts = int(pengu.rows[entry_index]["ts"])
        entry_price = float(pengu.rows[entry_index]["open"])
        proxy = members[0]
        atr_value = pengu.atr[24][pi] or 0.0
        exit_index, exit_price, reason = resolve_exit(proxy, pengu, entry_index, entry_price, atr_value)
        exit_ts = int(pengu.rows[exit_index]["ts"])
        gross = (exit_price / entry_price - 1.0) * 100.0
        paid_funding = v39.funding_between(funding, entry_ts, exit_ts)
        held_days = max(1.0 / 24.0, (exit_ts - entry_ts) / DAY)
        base = gross - paid_funding - 0.12 - 0.02 * held_days
        severe = gross - paid_funding - 0.20 - 0.05 * held_days
        trades.append(v39.Trade(
            ensemble_id, entry_ts, exit_ts, 1, entry_price, exit_price,
            gross, paid_funding, base, severe, reason,
        ))
        next_free = exit_ts
    return trades


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
    pengu = v40.build_cache(pengu_rows)
    btc = v40.build_cache(btc_rows)
    funding_by_index = v40.latest_funding_by_index(funding, pengu_rows)

    first = max(int(pengu_rows[0]["ts"]), int(btc_rows[0]["ts"])) + 360 * HOUR
    last = min(int(pengu_rows[-1]["ts"]), int(btc_rows[-1]["ts"]))
    span = last - first
    holdout_start = first + int(span * 0.80)
    fold_edges = [first + int((holdout_start - first) * step / 4) for step in range(5)]

    candidates = rules()
    rule_map = {rule.strategy_id: rule for rule in candidates}
    trades_by_id: Dict[str, List[v39.Trade]] = {}
    results: Dict[str, dict] = {}
    passed: List[str] = []
    for rule in candidates:
        trades = build_trades(rule, pengu, btc, funding, funding_by_index)
        trades_by_id[rule.strategy_id] = trades
        folds = [metrics(trades, fold_edges[index], fold_edges[index + 1]) for index in range(4)]
        item = {
            "rule": asdict(rule),
            "preHoldout": metrics(trades, first, holdout_start),
            "folds": folds,
        }
        results[rule.strategy_id] = item
        if preholdout_pass(item):
            passed.append(rule.strategy_id)

    stable = [
        strategy_id for strategy_id in passed
        if sum(1 for other in passed if other != strategy_id and neighbor(rule_map[strategy_id], rule_map[other])) >= 2
    ]
    stable.sort(key=lambda strategy_id: (
        statistics.median(fold["severeReturnPct"] for fold in results[strategy_id]["folds"]),
        min(fold["compoundedReturnPct"] for fold in results[strategy_id]["folds"]),
        results[strategy_id]["preHoldout"]["profitFactor"] or 0,
        results[strategy_id]["preHoldout"]["maxDrawdownPct"],
        -rule_map[strategy_id].exit.max_hold_hours,
    ), reverse=True)

    selected_members: List[RecoveryRule] = []
    if stable:
        anchor = rule_map[stable[0]]
        selected_members = [anchor]
        for strategy_id in stable[1:]:
            candidate = rule_map[strategy_id]
            if neighbor(anchor, candidate):
                selected_members.append(candidate)
            if len(selected_members) == 3:
                break
    long_trades = build_ensemble_trades(selected_members, pengu, btc, funding, funding_by_index)
    long_holdout = metrics(long_trades, holdout_start, last + HOUR)
    long_passed = bool(selected_members and holdout_pass(long_holdout))

    short_rule = v39.Rule(
        -1, "BREAKDOWN", 6, 24, 0.0, 0.0, 0.8, 0.0, "RISK",
        v39.ExitSpec("TIME24", 24),
    )
    short_trades = v39.build_trades(short_rule, pengu_rows, btc_rows, funding)
    short_holdout = metrics(short_trades, holdout_start, last + HOUR)
    short_passed = holdout_pass(short_holdout)

    combined = v39.combine_trades(long_trades if long_passed else [], short_trades, 1.0, 1.0)
    combined_holdout = metrics(combined, holdout_start, last + HOUR)
    combined_full = metrics(combined, first, last + HOUR)
    combined_passed = bool(long_passed and short_passed and holdout_pass(combined_holdout))
    status = "PENGU_DUAL_ENGINE_V41_COMPLETE" if combined_passed else "PENGU_LONG_V41_NOT_COMPLETE"

    payload = rounded({
        "version": 41,
        "strategyId": "PENGU_RECOVERY_DUAL_ENGINE_V41",
        "status": status,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "data": {
            "penguRows": len(pengu_rows),
            "btcRows": len(btc_rows),
            "fundingRows": len(funding),
            "first": dt.datetime.fromtimestamp(first / 1000, tz=dt.timezone.utc).isoformat(),
            "holdoutStart": dt.datetime.fromtimestamp(holdout_start / 1000, tz=dt.timezone.utc).isoformat(),
            "last": dt.datetime.fromtimestamp(last / 1000, tz=dt.timezone.utc).isoformat(),
        },
        "candidateCount": len(candidates),
        "preHoldoutPassedCount": len(passed),
        "stableCount": len(stable),
        "selectedLongMembers": [asdict(rule) for rule in selected_members],
        "selectedLongMemberIds": [rule.strategy_id for rule in selected_members],
        "longPreHoldout": metrics(long_trades, first, holdout_start),
        "longFrozenHoldout": long_holdout,
        "longHoldoutPassed": long_passed,
        "fixedShortRule": asdict(short_rule),
        "shortPreHoldout": metrics(short_trades, first, holdout_start),
        "shortFrozenHoldout": short_holdout,
        "shortHoldoutPassed": short_passed,
        "combinedFrozenHoldout": combined_holdout,
        "combinedFull": combined_full,
        "combinedHoldoutPassed": combined_passed,
        "topStable": stable[:20],
        "topStableResults": {strategy_id: results[strategy_id] for strategy_id in stable[:20]},
        "productionChanged": False,
        "realTradingEnabled": False,
        "limitations": [
            "The final holdout has been observed in prior PENGU studies and is reused confirmation, not pristine forward evidence.",
            "V19 microstructure data is used only as a forward entry veto because historical depth and taker flow are unavailable.",
            "PENGU Long and Short are mutually exclusive in Aster one-way mode.",
        ],
    })

    report = [
        "# PENGU Recovery Dual Engine V41",
        "",
        f"- Status: **{status}**",
        f"- Candidates: {len(candidates)}",
        f"- Pre-holdout passed: {len(passed)}",
        f"- Stable: {len(stable)}",
        f"- Long ensemble: **{', '.join(rule.strategy_id for rule in selected_members) or 'NONE'}**",
        f"- Long holdout: {long_holdout['compoundedReturnPct']}% / PF {long_holdout['profitFactor']} / Severe {long_holdout['severeReturnPct']}%",
        f"- Short holdout: {short_holdout['compoundedReturnPct']}% / PF {short_holdout['profitFactor']} / Severe {short_holdout['severeReturnPct']}%",
        f"- Combined holdout: {combined_holdout['compoundedReturnPct']}% / PF {combined_holdout['profitFactor']} / Severe {combined_holdout['severeReturnPct']}%",
        f"- Combined full: {combined_full['compoundedReturnPct']}% / PF {combined_full['profitFactor']} / DD {combined_full['maxDrawdownPct']}%",
        "- Production changed: NO",
        "- Real trading: DISABLED",
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-recovery-dual-engine-v41.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    (state_dir / "pengu-recovery-dual-engine-v41.md").write_text(
        "\n".join(report), encoding="utf-8",
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
