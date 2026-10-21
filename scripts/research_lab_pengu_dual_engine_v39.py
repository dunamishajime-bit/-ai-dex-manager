from __future__ import annotations

import datetime as dt
import json
import math
import os
import statistics
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional

ASTER_BASE = "https://fapi.asterdex.com"
HOUR = 3_600_000
DAY = 24 * HOUR
START = 1704067200000
DECISION_HOURS = 6


@dataclass(frozen=True)
class ExitSpec:
    name: str
    max_hold_hours: int
    take_profit_atr: float = 0.0
    stop_loss_atr: float = 0.0


@dataclass(frozen=True)
class Rule:
    side: int
    family: str
    fast: int
    slow: int
    threshold: float
    aux_threshold: float
    volume_floor: float
    funding_threshold: float
    btc_filter: str
    exit: ExitSpec

    @property
    def strategy_id(self) -> str:
        side = "L" if self.side > 0 else "S"
        def fmt(value: float) -> str:
            return str(value).replace(".", "p")
        return (
            f"{side}_{self.family}_F{self.fast}_S{self.slow}_T{fmt(self.threshold)}"
            f"_A{fmt(self.aux_threshold)}_V{fmt(self.volume_floor)}"
            f"_FR{fmt(self.funding_threshold)}_B{self.btc_filter}_{self.exit.name}"
        )


@dataclass
class Trade:
    strategy_id: str
    entry_ts: int
    exit_ts: int
    side: int
    entry_price: float
    exit_price: float
    gross_pct: float
    funding_pct: float
    base_pct: float
    severe_pct: float
    exit_reason: str


def fetch_json(path: str, params: Optional[dict] = None, timeout: int = 30):
    query = urllib.parse.urlencode(params or {})
    url = f"{ASTER_BASE}{path}" + (f"?{query}" if query else "")
    request = urllib.request.Request(url, headers={"User-Agent": "DisDex-PENGU-V39/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_klines(symbol: str, end: int) -> List[dict]:
    rows: List[dict] = []
    cursor = START
    empty = 0
    while cursor < end:
        payload = fetch_json("/fapi/v1/klines", {
            "symbol": symbol,
            "interval": "1h",
            "startTime": cursor,
            "endTime": end - 1,
            "limit": 1500,
        })
        if not isinstance(payload, list):
            raise RuntimeError(f"unexpected {symbol} kline payload")
        if not payload:
            cursor += 30 * DAY
            empty += 1
            if empty > 24:
                break
            continue
        empty = 0
        for item in payload:
            if isinstance(item, list) and len(item) >= 6:
                rows.append({
                    "ts": int(item[0]),
                    "open": float(item[1]),
                    "high": float(item[2]),
                    "low": float(item[3]),
                    "close": float(item[4]),
                    "volume": float(item[5]),
                })
        next_cursor = int(payload[-1][0]) + HOUR
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1500:
            break
        time.sleep(0.04)
    unique = {int(row["ts"]): row for row in rows if int(row["ts"]) < end}
    result = [unique[key] for key in sorted(unique)]
    if len(result) < 3000:
        raise RuntimeError(f"insufficient {symbol} candles: {len(result)}")
    return result


def fetch_funding(symbol: str, end: int) -> List[dict]:
    rows: List[dict] = []
    cursor = START
    empty = 0
    while cursor < end:
        payload = fetch_json("/fapi/v1/fundingRate", {
            "symbol": symbol,
            "startTime": cursor,
            "endTime": end - 1,
            "limit": 1000,
        })
        if not isinstance(payload, list):
            raise RuntimeError(f"unexpected {symbol} funding payload")
        if not payload:
            cursor += 90 * DAY
            empty += 1
            if empty > 12:
                break
            continue
        empty = 0
        for item in payload:
            if isinstance(item, dict):
                ts = int(item.get("fundingTime", item.get("time", 0)) or 0)
                rate = float(item.get("fundingRate", item.get("rate", 0)) or 0)
                if 0 < ts < end:
                    rows.append({"ts": ts, "rate": rate})
        next_cursor = int(payload[-1].get("fundingTime", payload[-1].get("time", 0)) or 0) + 1
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1000:
            break
        time.sleep(0.04)
    unique = {int(row["ts"]): row for row in rows}
    return [unique[key] for key in sorted(unique)]


def sma(rows: List[dict], end: int, length: int) -> Optional[float]:
    if end - length + 1 < 0:
        return None
    return statistics.fmean(float(row["close"]) for row in rows[end - length + 1:end + 1])


def momentum(rows: List[dict], end: int, length: int) -> Optional[float]:
    prior = end - length
    if prior < 0 or float(rows[prior]["close"]) <= 0:
        return None
    return (float(rows[end]["close"]) / float(rows[prior]["close"]) - 1.0) * 100.0


def volume_ratio(rows: List[dict], end: int, recent: int = 12, base: int = 72) -> Optional[float]:
    if end - base + 1 < 0:
        return None
    recent_values = [float(row["volume"]) for row in rows[end - recent + 1:end + 1]]
    base_values = [float(row["volume"]) for row in rows[end - base + 1:end - recent + 1]]
    denominator = statistics.fmean(base_values) if base_values else 0.0
    return statistics.fmean(recent_values) / denominator if denominator > 0 else None


def rsi(rows: List[dict], end: int, length: int = 14) -> Optional[float]:
    if end - length < 0:
        return None
    gains = losses = 0.0
    for index in range(end - length + 1, end + 1):
        change = float(rows[index]["close"]) - float(rows[index - 1]["close"])
        gains += max(change, 0.0)
        losses += max(-change, 0.0)
    if losses <= 0:
        return 100.0 if gains > 0 else 50.0
    rs = gains / losses
    return 100.0 - 100.0 / (1.0 + rs)


def atr(rows: List[dict], end: int, length: int = 24) -> Optional[float]:
    if end - length < 0:
        return None
    values: List[float] = []
    for index in range(end - length + 1, end + 1):
        previous = float(rows[index - 1]["close"])
        high = float(rows[index]["high"])
        low = float(rows[index]["low"])
        values.append(max(high - low, abs(high - previous), abs(low - previous)))
    return statistics.fmean(values) if values else None


def funding_between(points: List[dict], start: int, end: int) -> float:
    return sum(float(row["rate"]) * 100.0 for row in points if start <= int(row["ts"]) < end)


def latest_funding(points: List[dict], ts: int) -> float:
    value = 0.0
    for row in points:
        if int(row["ts"]) > ts:
            break
        value = float(row["rate"])
    return value


def btc_gate(direction: int, mode: str, btc: List[dict], index: int) -> bool:
    if mode == "NONE":
        return True
    average = sma(btc, index, 168)
    mom = momentum(btc, index, 72)
    if average is None or mom is None:
        return False
    close = float(btc[index]["close"])
    if mode == "DIRECTION":
        return (direction > 0 and close > average and mom > 0) or (direction < 0 and close < average and mom < 0)
    return not ((direction > 0 and close < average and mom < -2.0) or (direction < 0 and close > average and mom > 4.0))


def exits() -> List[ExitSpec]:
    return [
        ExitSpec("TIME24", 24),
        ExitSpec("TIME48", 48),
        ExitSpec("TIME72", 72),
        ExitSpec("ATR2_SL1p25_H24", 24, 2.0, 1.25),
        ExitSpec("ATR3_SL1p5_H48", 48, 3.0, 1.5),
        ExitSpec("ATR4_SL2_H72", 72, 4.0, 2.0),
    ]


def long_rules() -> List[Rule]:
    result: List[Rule] = []
    for exit_spec in exits():
        for fast in [12, 24, 36]:
            for slow in [72, 120, 168]:
                for threshold in [1.0, 2.0, 3.0]:
                    for volume in [0.8, 1.0]:
                        for btc_filter in ["DIRECTION", "RISK"]:
                            result.append(Rule(1, "TREND", fast, slow, threshold, 0.0, volume, 0.0008, btc_filter, exit_spec))
        for confirm in [6, 12, 24]:
            for lookback in [24, 48, 72]:
                for threshold in [0.0, 0.5, 1.0]:
                    for volume in [0.8, 1.0, 1.2]:
                        for btc_filter in ["DIRECTION", "RISK"]:
                            result.append(Rule(1, "BREAKOUT", confirm, lookback, threshold, 0.0, volume, 0.0008, btc_filter, exit_spec))
    return result


def short_rules() -> List[Rule]:
    result: List[Rule] = []
    for exit_spec in exits():
        for confirm in [6, 12, 24]:
            for lookback in [24, 48, 72]:
                for threshold in [0.0, 0.5, 1.0]:
                    for volume in [0.8, 1.0, 1.2]:
                        for btc_filter in ["DIRECTION", "RISK"]:
                            result.append(Rule(-1, "BREAKDOWN", confirm, lookback, threshold, 0.0, volume, 0.0, btc_filter, exit_spec))
        for rsi_length in [14, 21]:
            for slow in [72, 120, 168]:
                for rsi_threshold in [65.0, 70.0, 75.0]:
                    for distance in [6.0, 10.0, 14.0]:
                        for funding_floor in [0.0, 0.0001]:
                            for btc_filter in ["NONE", "RISK"]:
                                result.append(Rule(-1, "EXHAUST", rsi_length, slow, rsi_threshold, distance, 0.0, funding_floor, btc_filter, exit_spec))
    return result


def signal(rule: Rule, pengu: List[dict], p_index: int, btc: List[dict], b_index: int, funding: List[dict]) -> bool:
    if p_index < max(rule.slow, 180) or b_index < 180:
        return False
    vol = volume_ratio(pengu, p_index)
    if rule.volume_floor > 0 and (vol is None or vol < rule.volume_floor):
        return False
    current_funding = latest_funding(funding, int(pengu[p_index]["ts"]))
    close = float(pengu[p_index]["close"])
    value = False
    if rule.family == "TREND":
        average = sma(pengu, p_index, rule.slow)
        fast = momentum(pengu, p_index, rule.fast)
        confirm = momentum(pengu, p_index, 6)
        value = bool(average and fast is not None and confirm is not None and close > average and fast > rule.threshold and confirm > 0 and current_funding <= rule.funding_threshold)
    elif rule.family == "BREAKOUT":
        prior = pengu[p_index - rule.slow:p_index]
        confirm = momentum(pengu, p_index, rule.fast)
        value = bool(prior and confirm is not None and close > max(float(row["high"]) for row in prior) and confirm > rule.threshold and current_funding <= rule.funding_threshold)
    elif rule.family == "BREAKDOWN":
        prior = pengu[p_index - rule.slow:p_index]
        confirm = momentum(pengu, p_index, rule.fast)
        value = bool(prior and confirm is not None and close < min(float(row["low"]) for row in prior) and confirm < -rule.threshold)
    elif rule.family == "EXHAUST":
        value_rsi = rsi(pengu, p_index, rule.fast)
        average = sma(pengu, p_index, rule.slow)
        confirm = momentum(pengu, p_index, 6)
        distance = (close / average - 1.0) * 100.0 if average else 0.0
        value = bool(value_rsi is not None and confirm is not None and value_rsi >= rule.threshold and distance >= rule.aux_threshold and confirm < 0 and current_funding >= rule.funding_threshold)
    return value and btc_gate(rule.side, rule.btc_filter, btc, b_index)


def resolve_exit(rule: Rule, pengu: List[dict], entry_index: int, entry_price: float, signal_atr: float) -> tuple[int, float, str]:
    end_index = min(len(pengu) - 1, entry_index + rule.exit.max_hold_hours)
    if rule.exit.take_profit_atr <= 0 or rule.exit.stop_loss_atr <= 0 or signal_atr <= 0:
        return end_index, float(pengu[end_index]["open"]), "TIME"
    if rule.side > 0:
        tp = entry_price + rule.exit.take_profit_atr * signal_atr
        sl = entry_price - rule.exit.stop_loss_atr * signal_atr
    else:
        tp = entry_price - rule.exit.take_profit_atr * signal_atr
        sl = entry_price + rule.exit.stop_loss_atr * signal_atr
    for index in range(entry_index, end_index):
        high = float(pengu[index]["high"])
        low = float(pengu[index]["low"])
        stop_hit = low <= sl if rule.side > 0 else high >= sl
        take_hit = high >= tp if rule.side > 0 else low <= tp
        if stop_hit:
            return index, sl, "SL"
        if take_hit:
            return index, tp, "TP"
    return end_index, float(pengu[end_index]["open"]), "TIME"


def build_trades(rule: Rule, pengu: List[dict], btc: List[dict], funding: List[dict]) -> List[Trade]:
    p_index = {int(row["ts"]): index for index, row in enumerate(pengu)}
    b_index = {int(row["ts"]): index for index, row in enumerate(btc)}
    common = sorted(set(p_index) & set(b_index))
    trades: List[Trade] = []
    next_free = 0
    for ts in common:
        if ts < next_free or (ts // HOUR) % DECISION_HOURS != 0:
            continue
        pi = p_index[ts]
        bi = b_index[ts]
        if not signal(rule, pengu, pi, btc, bi, funding):
            continue
        entry_index = pi + 1
        if entry_index >= len(pengu):
            continue
        entry = pengu[entry_index]
        entry_ts = int(entry["ts"])
        entry_price = float(entry["open"])
        signal_atr = atr(pengu, pi, 24) or 0.0
        exit_index, exit_price, reason = resolve_exit(rule, pengu, entry_index, entry_price, signal_atr)
        exit_ts = int(pengu[exit_index]["ts"])
        if exit_ts <= entry_ts:
            continue
        gross = rule.side * (exit_price / entry_price - 1.0) * 100.0
        paid_funding = rule.side * funding_between(funding, entry_ts, exit_ts)
        held_days = max(1.0 / 24.0, (exit_ts - entry_ts) / DAY)
        base = gross - paid_funding - 0.12 - 0.02 * held_days
        severe = gross - paid_funding - 0.20 - 0.05 * held_days
        trades.append(Trade(rule.strategy_id, entry_ts, exit_ts, rule.side, entry_price, exit_price, gross, paid_funding, base, severe, reason))
        next_free = exit_ts
    return trades


def product(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value / 100.0)
    return (equity - 1.0) * 100.0


def profit_factor(values: List[float]) -> Optional[float]:
    wins = sum(value for value in values if value > 0)
    losses = abs(sum(value for value in values if value < 0))
    return wins / losses if losses > 0 else 999.0 if wins > 0 else None


def metrics(trades: List[Trade], start: int, end: int) -> dict:
    active = [trade for trade in trades if start <= trade.entry_ts and trade.exit_ts < end]
    values = [trade.base_pct for trade in active]
    severe = [trade.severe_pct for trade in active]
    equity = peak = 1.0
    max_dd = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value / 100.0)
        peak = max(peak, equity)
        max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
    return {
        "trades": len(active),
        "longTrades": sum(trade.side > 0 for trade in active),
        "shortTrades": sum(trade.side < 0 for trade in active),
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else None,
        "averagePct": statistics.fmean(values) if values else None,
        "compoundedReturnPct": product(values),
        "profitFactor": profit_factor(values),
        "maxDrawdownPct": max_dd,
        "severeReturnPct": product(severe),
        "severeProfitFactor": profit_factor(severe),
    }


def neighbor(left: Rule, right: Rule) -> bool:
    if left.side != right.side or left.family != right.family or left.btc_filter != right.btc_filter:
        return False
    if left.exit.name != right.exit.name:
        return False
    return (
        abs(left.fast - right.fast) <= 12
        and abs(left.slow - right.slow) <= 48
        and abs(left.threshold - right.threshold) <= (5.1 if left.family == "EXHAUST" else 1.01)
        and abs(left.aux_threshold - right.aux_threshold) <= 4.1
        and abs(left.volume_floor - right.volume_floor) <= 0.21
        and abs(left.funding_threshold - right.funding_threshold) <= 0.00011
    )


def pass_development(item: dict) -> bool:
    dev = item["development"]
    return bool(
        dev["trades"] >= 8
        and dev["compoundedReturnPct"] > 0
        and (dev["profitFactor"] or 0) >= 1.15
        and dev["maxDrawdownPct"] >= -35
        and dev["severeReturnPct"] > 0
        and (dev["severeProfitFactor"] or 0) >= 1.0
    )


def pass_validation(item: dict) -> bool:
    val = item["validation"]
    return bool(
        val["trades"] >= 4
        and val["compoundedReturnPct"] > 0
        and (val["profitFactor"] or 0) >= 1.05
        and val["maxDrawdownPct"] >= -30
        and val["severeReturnPct"] > 0
        and (val["severeProfitFactor"] or 0) >= 1.0
    )


def pass_holdout(metric: dict) -> bool:
    return bool(
        metric["trades"] >= 4
        and metric["compoundedReturnPct"] > 0
        and (metric["profitFactor"] or 0) >= 1.0
        and metric["maxDrawdownPct"] >= -30
        and metric["severeReturnPct"] > 0
        and (metric["severeProfitFactor"] or 0) >= 1.0
    )


def select_side(rules: List[Rule], pengu: List[dict], btc: List[dict], funding: List[dict], first: int, dev_end: int, val_end: int):
    results: Dict[str, dict] = {}
    trades_by_id: Dict[str, List[Trade]] = {}
    passed: List[str] = []
    validated: List[str] = []
    rule_map = {rule.strategy_id: rule for rule in rules}
    for rule in rules:
        trades = build_trades(rule, pengu, btc, funding)
        trades_by_id[rule.strategy_id] = trades
        item = {
            "rule": asdict(rule),
            "development": metrics(trades, first, dev_end),
            "validation": metrics(trades, dev_end, val_end),
        }
        results[rule.strategy_id] = item
        if pass_development(item):
            passed.append(rule.strategy_id)
            if pass_validation(item):
                validated.append(rule.strategy_id)
    stable = [
        strategy_id for strategy_id in validated
        if sum(1 for other in validated if other != strategy_id and neighbor(rule_map[strategy_id], rule_map[other])) >= 2
    ]
    stable.sort(key=lambda strategy_id: (
        min(results[strategy_id]["development"]["severeReturnPct"], results[strategy_id]["validation"]["severeReturnPct"]),
        min(results[strategy_id]["development"]["profitFactor"] or 0, results[strategy_id]["validation"]["profitFactor"] or 0),
        results[strategy_id]["validation"]["maxDrawdownPct"],
        -rule_map[strategy_id].exit.max_hold_hours,
    ), reverse=True)
    selected = stable[0] if stable else None
    return results, trades_by_id, passed, validated, stable, selected


def combine_trades(long_trades: List[Trade], short_trades: List[Trade], long_priority: float, short_priority: float) -> List[Trade]:
    grouped: Dict[int, List[Trade]] = {}
    for trade in [*long_trades, *short_trades]:
        grouped.setdefault(trade.entry_ts, []).append(trade)
    result: List[Trade] = []
    next_free = 0
    for entry_ts in sorted(grouped):
        if entry_ts < next_free:
            continue
        candidates = grouped[entry_ts]
        if len(candidates) == 1:
            chosen = candidates[0]
        else:
            chosen = next((trade for trade in candidates if trade.side > 0), candidates[0]) if long_priority >= short_priority else next((trade for trade in candidates if trade.side < 0), candidates[0])
        result.append(chosen)
        next_free = chosen.exit_ts
    return result


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
    pengu = fetch_klines("PENGUUSDT", end)
    btc = fetch_klines("BTCUSDT", end)
    funding = fetch_funding("PENGUUSDT", end)
    first = max(int(pengu[0]["ts"]), int(btc[0]["ts"])) + 360 * HOUR
    last = min(int(pengu[-1]["ts"]), int(btc[-1]["ts"]))
    span = last - first
    dev_end = first + int(span * 0.50)
    validation_end = first + int(span * 0.75)

    long = select_side(long_rules(), pengu, btc, funding, first, dev_end, validation_end)
    short = select_side(short_rules(), pengu, btc, funding, first, dev_end, validation_end)
    long_results, long_trades, long_dev, long_val, long_stable, long_selected = long
    short_results, short_trades, short_dev, short_val, short_stable, short_selected = short

    long_hold = metrics(long_trades[long_selected], validation_end, last + HOUR) if long_selected else None
    short_hold = metrics(short_trades[short_selected], validation_end, last + HOUR) if short_selected else None
    long_pass = bool(long_hold and pass_holdout(long_hold))
    short_pass = bool(short_hold and pass_holdout(short_hold))

    combined: List[Trade] = []
    combined_metrics = None
    combined_pass = False
    if long_selected and short_selected:
        long_priority = long_results[long_selected]["validation"]["severeProfitFactor"] or 0
        short_priority = short_results[short_selected]["validation"]["severeProfitFactor"] or 0
        combined = combine_trades(long_trades[long_selected], short_trades[short_selected], long_priority, short_priority)
        combined_metrics = {
            "development": metrics(combined, first, dev_end),
            "validation": metrics(combined, dev_end, validation_end),
            "frozenHoldout": metrics(combined, validation_end, last + HOUR),
            "full": metrics(combined, first, last + HOUR),
        }
        hold = combined_metrics["frozenHoldout"]
        combined_pass = bool(long_pass and short_pass and pass_holdout(hold) and hold["trades"] >= 8)

    status = (
        "PENGU_DUAL_ENGINE_FROZEN_CANDIDATE" if combined_pass
        else "PENGU_PARTIAL_SIDE_ONLY" if long_pass or short_pass
        else "NO_ROBUST_PENGU_DUAL_ENGINE"
    )
    payload = rounded({
        "version": 39,
        "strategyId": "PENGU_DUAL_ENGINE_V39",
        "status": status,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "data": {
            "penguRows": len(pengu),
            "btcRows": len(btc),
            "fundingRows": len(funding),
            "first": dt.datetime.fromtimestamp(first / 1000, tz=dt.timezone.utc).isoformat(),
            "developmentEnd": dt.datetime.fromtimestamp(dev_end / 1000, tz=dt.timezone.utc).isoformat(),
            "validationEnd": dt.datetime.fromtimestamp(validation_end / 1000, tz=dt.timezone.utc).isoformat(),
            "last": dt.datetime.fromtimestamp(last / 1000, tz=dt.timezone.utc).isoformat(),
        },
        "long": {
            "candidateCount": len(long_results),
            "developmentPassed": long_dev,
            "validationPassed": long_val,
            "stableValidation": long_stable,
            "selected": long_selected,
            "frozenHoldout": long_hold,
            "holdoutPassed": long_pass,
            "results": long_results,
        },
        "short": {
            "candidateCount": len(short_results),
            "developmentPassed": short_dev,
            "validationPassed": short_val,
            "stableValidation": short_stable,
            "selected": short_selected,
            "frozenHoldout": short_hold,
            "holdoutPassed": short_pass,
            "results": short_results,
        },
        "combined": {
            "metrics": combined_metrics,
            "holdoutPassed": combined_pass,
            "trades": [asdict(trade) for trade in combined] if combined_pass else [],
        },
        "productionChanged": False,
        "realTradingEnabled": False,
        "limitations": [
            "PENGU Aster history begins in 2025 and remains materially shorter than the V28 core history.",
            "Long and Short use separate signal families and exits; no symmetric 72-hour assumption is imposed.",
            "Frozen Holdout is read only after stable Development and Validation clusters are selected.",
            "Microstructure features are not available historically and are reserved for fixed forward-only VETO testing.",
        ],
    })

    report = [
        "# PENGU Dual-Engine V39", "",
        f"- Status: **{status}**",
        f"- Long selected: **{long_selected or 'NONE'}**",
        f"- Long holdout pass: **{'YES' if long_pass else 'NO'}**",
        f"- Short selected: **{short_selected or 'NONE'}**",
        f"- Short holdout pass: **{'YES' if short_pass else 'NO'}**",
        f"- Combined holdout pass: **{'YES' if combined_pass else 'NO'}**",
        f"- Long candidates: {len(long_results)} / stable {len(long_stable)}",
        f"- Short candidates: {len(short_results)} / stable {len(short_stable)}",
        "- Production changed: NO",
        "- Real trading: DISABLED", "",
    ]
    for label, selected, results, hold in [
        ("Long", long_selected, long_results, long_hold),
        ("Short", short_selected, short_results, short_hold),
    ]:
        if selected:
            dev = results[selected]["development"]
            val = results[selected]["validation"]
            report.extend([
                f"## {label}", "",
                f"- Rule: `{selected}`",
                f"- Development: N {dev['trades']} / Return {dev['compoundedReturnPct']}% / PF {dev['profitFactor']} / Severe {dev['severeReturnPct']}% / DD {dev['maxDrawdownPct']}%",
                f"- Validation: N {val['trades']} / Return {val['compoundedReturnPct']}% / PF {val['profitFactor']} / Severe {val['severeReturnPct']}% / DD {val['maxDrawdownPct']}%",
                f"- Frozen Holdout: N {hold['trades']} / Return {hold['compoundedReturnPct']}% / PF {hold['profitFactor']} / Severe {hold['severeReturnPct']}% / DD {hold['maxDrawdownPct']}%",
                "",
            ])
    if combined_metrics:
        for period in ["development", "validation", "frozenHoldout", "full"]:
            item = combined_metrics[period]
            report.append(
                f"- Combined {period}: N {item['trades']} / Return {item['compoundedReturnPct']}% / PF {item['profitFactor']} / Severe {item['severeReturnPct']}% / DD {item['maxDrawdownPct']}%"
            )

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-dual-engine-v39.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "pengu-dual-engine-v39.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
