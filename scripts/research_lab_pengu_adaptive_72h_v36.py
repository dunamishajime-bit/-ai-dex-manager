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
from typing import Dict, Iterable, List, Optional, Tuple

ASTER_BASE = "https://fapi.asterdex.com"
HOUR = 3_600_000
DAY = 24 * HOUR
START = 1704067200000  # 2024-01-01 UTC; PENGU is accepted from its first available candle.
DECISION_HOURS = 6
HOLD_HOURS = 72


@dataclass(frozen=True)
class Config:
    family: str
    fast: int
    slow: int
    threshold: float
    volume_floor: float
    btc_filter: str
    hold_hours: int = HOLD_HOURS

    @property
    def strategy_id(self) -> str:
        return (
            f"{self.family}_F{self.fast}_S{self.slow}_T{str(self.threshold).replace('.', 'p')}"
            f"_V{str(self.volume_floor).replace('.', 'p')}_B{self.btc_filter}_H{self.hold_hours}"
        )


@dataclass
class Trade:
    entry_ts: int
    exit_ts: int
    side: int
    entry_price: float
    exit_price: float
    gross_pct: float
    funding_pct: float
    base_pct: float
    severe_pct: float


def fetch_json(path: str, params: Optional[dict] = None, timeout: int = 30):
    query = urllib.parse.urlencode(params or {})
    url = f"{ASTER_BASE}{path}" + (f"?{query}" if query else "")
    request = urllib.request.Request(url, headers={"User-Agent": "DisDex-PENGU-V36/1.0"})
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


def configs() -> List[Config]:
    result: List[Config] = []
    for fast in [12, 24, 36, 48, 72]:
        for slow in [72, 120, 168, 240, 336]:
            if fast >= slow:
                continue
            for threshold in [0.0, 1.0, 2.0, 3.0]:
                for volume in [0.0, 0.8, 1.0]:
                    for btc_filter in ["NONE", "DIRECTION", "RISK"]:
                        result.append(Config("TREND", fast, slow, threshold, volume, btc_filter))
    for lookback in [24, 48, 72, 120, 168]:
        for confirm in [6, 12, 24]:
            for threshold in [0.0, 0.5, 1.0]:
                for volume in [0.8, 1.0, 1.2]:
                    for btc_filter in ["NONE", "DIRECTION", "RISK"]:
                        result.append(Config("BREAKOUT", confirm, lookback, threshold, volume, btc_filter))
    for fast in [12, 24, 36, 48]:
        for slow in [72, 120, 168]:
            for threshold in [1.0, 2.0, 3.0, 4.0]:
                for volume in [0.0, 0.8, 1.0]:
                    for btc_filter in ["NONE", "DIRECTION", "RISK"]:
                        result.append(Config("DUAL_MOM", fast, slow, threshold, volume, btc_filter))
    for fast in [14, 21, 28]:
        for slow in [72, 120, 168]:
            for threshold in [25.0, 30.0, 35.0]:
                for volume in [0.0, 0.8]:
                    for btc_filter in ["NONE", "RISK"]:
                        result.append(Config("REVERSAL", fast, slow, threshold, volume, btc_filter))
    return result


def btc_gate(direction: int, mode: str, btc: List[dict], index: int) -> bool:
    if mode == "NONE":
        return True
    slow = sma(btc, index, 168)
    mom = momentum(btc, index, 72)
    if slow is None or mom is None:
        return False
    close = float(btc[index]["close"])
    if mode == "DIRECTION":
        return (direction > 0 and close > slow and mom > 0) or (direction < 0 and close < slow and mom < 0)
    # RISK blocks long exposure in a BTC bear regime and blocks short exposure in a strong BTC bull regime.
    return not ((direction > 0 and close < slow and mom < -2.0) or (direction < 0 and close > slow and mom > 4.0))


def signal(config: Config, pengu: List[dict], p_index: int, btc: List[dict], b_index: int) -> int:
    if p_index < max(config.slow, 80) or b_index < 168:
        return 0
    vol = volume_ratio(pengu, p_index)
    if config.volume_floor > 0 and (vol is None or vol < config.volume_floor):
        return 0
    close = float(pengu[p_index]["close"])
    direction = 0
    if config.family == "TREND":
        average = sma(pengu, p_index, config.slow)
        mom = momentum(pengu, p_index, config.fast)
        if average is None or mom is None:
            return 0
        if close > average and mom > config.threshold:
            direction = 1
        elif close < average and mom < -config.threshold:
            direction = -1
    elif config.family == "BREAKOUT":
        if p_index - config.slow < 0:
            return 0
        prior = pengu[p_index - config.slow:p_index]
        confirm = momentum(pengu, p_index, config.fast)
        if confirm is None:
            return 0
        high = max(float(row["high"]) for row in prior)
        low = min(float(row["low"]) for row in prior)
        if close > high and confirm > config.threshold:
            direction = 1
        elif close < low and confirm < -config.threshold:
            direction = -1
    elif config.family == "DUAL_MOM":
        fast = momentum(pengu, p_index, config.fast)
        slow = momentum(pengu, p_index, config.slow)
        if fast is None or slow is None:
            return 0
        score = fast + slow * 0.5
        if fast > 0 and slow > 0 and score > config.threshold:
            direction = 1
        elif fast < 0 and slow < 0 and score < -config.threshold:
            direction = -1
    else:
        value = rsi(pengu, p_index, config.fast)
        average = sma(pengu, p_index, config.slow)
        if value is None or average is None:
            return 0
        trend_distance = (close / average - 1.0) * 100.0
        if value <= config.threshold and trend_distance > -12.0:
            direction = 1
        elif value >= 100.0 - config.threshold and trend_distance < 12.0:
            direction = -1
    return direction if direction and btc_gate(direction, config.btc_filter, btc, b_index) else 0


def funding_between(points: List[dict], start: int, end: int) -> float:
    return sum(float(row["rate"]) * 100.0 for row in points if start <= int(row["ts"]) < end)


def build_trades(config: Config, pengu: List[dict], btc: List[dict], funding: List[dict]) -> List[Trade]:
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
        side = signal(config, pengu, pi, btc, bi)
        if side == 0:
            continue
        entry_index = pi + 1
        exit_index = entry_index + config.hold_hours
        if exit_index >= len(pengu):
            continue
        entry = pengu[entry_index]
        exit_row = pengu[exit_index]
        entry_ts = int(entry["ts"])
        exit_ts = int(exit_row["ts"])
        if exit_ts - entry_ts != config.hold_hours * HOUR:
            continue
        entry_price = float(entry["open"])
        exit_price = float(exit_row["open"])
        gross = side * (exit_price / entry_price - 1.0) * 100.0
        paid_funding = side * funding_between(funding, entry_ts, exit_ts)
        base = gross - paid_funding - 0.12 - 0.02 * (config.hold_hours / 24.0)
        severe = gross - paid_funding - 0.20 - 0.05 * (config.hold_hours / 24.0)
        trades.append(Trade(entry_ts, exit_ts, side, entry_price, exit_price, gross, paid_funding, base, severe))
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


def neighbor(left: Config, right: Config) -> bool:
    if left.family != right.family or left.btc_filter != right.btc_filter or left.hold_hours != right.hold_hours:
        return False
    return (
        abs(left.fast - right.fast) <= 24
        and abs(left.slow - right.slow) <= 72
        and abs(left.threshold - right.threshold) <= (5.0 if left.family == "REVERSAL" else 1.01)
        and abs(left.volume_floor - right.volume_floor) <= 0.21
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
    pengu = fetch_klines("PENGUUSDT", end)
    btc = fetch_klines("BTCUSDT", end)
    funding = fetch_funding("PENGUUSDT", end)
    first = max(int(pengu[0]["ts"]), int(btc[0]["ts"])) + 360 * HOUR
    last = min(int(pengu[-1]["ts"]), int(btc[-1]["ts"]))
    span = last - first
    dev_end = first + int(span * 0.50)
    validation_end = first + int(span * 0.75)

    cfgs = configs()
    result_by_id: Dict[str, dict] = {}
    trade_by_id: Dict[str, List[Trade]] = {}
    development_passed: List[str] = []
    validation_passed: List[str] = []
    for config in cfgs:
        trades = build_trades(config, pengu, btc, funding)
        trade_by_id[config.strategy_id] = trades
        dev = metrics(trades, first, dev_end)
        val = metrics(trades, dev_end, validation_end)
        result_by_id[config.strategy_id] = {
            "config": asdict(config),
            "development": dev,
            "validation": val,
        }
        if (
            dev["trades"] >= 10
            and dev["longTrades"] >= 3
            and dev["shortTrades"] >= 3
            and dev["compoundedReturnPct"] > 0
            and (dev["profitFactor"] or 0) >= 1.20
            and dev["maxDrawdownPct"] >= -30
            and dev["severeReturnPct"] > 0
            and (dev["severeProfitFactor"] or 0) >= 1.05
        ):
            development_passed.append(config.strategy_id)
            if (
                val["trades"] >= 5
                and val["compoundedReturnPct"] > 0
                and (val["profitFactor"] or 0) >= 1.05
                and val["maxDrawdownPct"] >= -25
                and val["severeReturnPct"] > 0
                and (val["severeProfitFactor"] or 0) >= 1.0
            ):
                validation_passed.append(config.strategy_id)

    cfg_map = {config.strategy_id: config for config in cfgs}
    stable = [
        strategy_id for strategy_id in validation_passed
        if sum(1 for other in validation_passed if other != strategy_id and neighbor(cfg_map[strategy_id], cfg_map[other])) >= 2
    ]
    stable.sort(key=lambda strategy_id: (
        result_by_id[strategy_id]["validation"]["severeReturnPct"],
        result_by_id[strategy_id]["validation"]["compoundedReturnPct"],
        result_by_id[strategy_id]["development"]["profitFactor"] or 0,
    ), reverse=True)
    selected = stable[0] if stable else None
    if selected:
        result_by_id[selected]["frozenHoldout"] = metrics(trade_by_id[selected], validation_end, last + HOUR)
        selected_trades = [asdict(trade) for trade in trade_by_id[selected]]
    else:
        selected_trades = []

    holdout_pass = False
    if selected:
        hold = result_by_id[selected]["frozenHoldout"]
        holdout_pass = bool(
            hold["trades"] >= 5
            and hold["compoundedReturnPct"] > 0
            and (hold["profitFactor"] or 0) >= 1.0
            and hold["maxDrawdownPct"] >= -25
            and hold["severeReturnPct"] > 0
            and (hold["severeProfitFactor"] or 0) >= 1.0
        )
    status = "PENGU_72H_FROZEN_FORWARD_CANDIDATE" if selected and holdout_pass else "NO_ROBUST_PENGU_72H_RULE"
    ranked = sorted(result_by_id, key=lambda strategy_id: (
        result_by_id[strategy_id]["validation"]["severeReturnPct"],
        result_by_id[strategy_id]["validation"]["compoundedReturnPct"],
    ), reverse=True)
    payload = rounded({
        "version": 36,
        "strategyId": "PENGU_ADAPTIVE_72H_V36",
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
        "candidateCount": len(cfgs),
        "developmentPassed": development_passed,
        "validationPassed": validation_passed,
        "stableValidation": stable,
        "selected": selected,
        "holdoutPassed": holdout_pass,
        "results": result_by_id,
        "selectedTrades": selected_trades,
        "productionChanged": False,
        "realTradingEnabled": False,
        "limitations": [
            "PENGU history is shorter than the V28 core history.",
            "Selection uses development and validation only; frozen holdout is read once for the selected stable candidate.",
            "The strategy evaluates completed hourly candles every six hours, enters at the next hourly open and holds 72 hours without overlap.",
            "Live implementation must match the selected config exactly; fixed historical trade timestamps are not a signal rule.",
        ],
    })
    report = [
        "# PENGU Adaptive 72h V36",
        "",
        f"- Status: **{status}**",
        f"- Selected: **{selected or 'NONE'}**",
        f"- Candidates: {len(cfgs)}",
        f"- Development passed: {len(development_passed)}",
        f"- Validation passed: {len(validation_passed)}",
        f"- Stable validation: {len(stable)}",
        f"- Frozen holdout passed: **{'YES' if holdout_pass else 'NO'}**",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "| Candidate | Dev N | Dev return | Dev PF | Dev severe | Val N | Val return | Val PF | Val severe |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    shown = list(dict.fromkeys(([selected] if selected else []) + stable[:12] + validation_passed[:8] + ranked[:12]))
    for strategy_id in shown:
        if not strategy_id:
            continue
        item = payload["results"][strategy_id]
        dev = item["development"]
        val = item["validation"]
        report.append(
            f"| {strategy_id} | {dev['trades']} | {dev['compoundedReturnPct']}% | {dev['profitFactor']} | {dev['severeReturnPct']}% | "
            f"{val['trades']} | {val['compoundedReturnPct']}% | {val['profitFactor']} | {val['severeReturnPct']}% |"
        )
    if selected:
        hold = payload["results"][selected]["frozenHoldout"]
        report.extend([
            "",
            "## Frozen holdout",
            "",
            f"- Trades: {hold['trades']} (Long {hold['longTrades']} / Short {hold['shortTrades']})",
            f"- Return: {hold['compoundedReturnPct']}%",
            f"- PF: {hold['profitFactor']}",
            f"- DD: {hold['maxDrawdownPct']}%",
            f"- Severe: {hold['severeReturnPct']}% / PF {hold['severeProfitFactor']}",
        ])
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-adaptive-72h-v36.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "pengu-adaptive-72h-v36.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
