from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import statistics
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

from v96_stock_intraday_theme_flow_v1 import (
    CONFIG,
    STRATEGY_ID,
    Config,
    SignalState,
    risk_capped_gross,
    signal_passes,
    stop_distance_pct,
)

BASE_URL = "https://fapi.asterdex.com"
UTC = dt.timezone.utc
NY = ZoneInfo("America/New_York")
START_UTC = dt.datetime(2025, 1, 1, tzinfo=UTC)
END_UTC = dt.datetime(2026, 7, 23, tzinfo=UTC)
HISTORY_SESSIONS = 20
MIN_THEME_MEMBERS = 3
INTERVAL_MS = 15 * 60 * 1000

AI_SYMBOLS = (
    "ADBEUSDT", "AMDUSDT", "AMZNUSDT", "ARMUSDT", "AVGOUSDT", "CRMUSDT",
    "GOOGLUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "ORCLUSDT",
    "PLTRUSDT", "TSLAUSDT",
)
SEMICONDUCTOR_SYMBOLS = (
    "AMATUSDT", "AMDUSDT", "ARMUSDT", "ASMLUSDT", "AVGOUSDT", "DRAMUSDT",
    "INTCUSDT", "MRVLUSDT", "MUUSDT", "NVDAUSDT", "QCOMUSDT",
    "SNDKUSDT", "TSMUSDT",
)
THEMES = {"AI": AI_SYMBOLS, "SEMICONDUCTOR": SEMICONDUCTOR_SYMBOLS}
SYMBOLS = tuple(sorted(set(AI_SYMBOLS) | set(SEMICONDUCTOR_SYMBOLS)))


@dataclass(frozen=True)
class CostScenario:
    name: str
    turnover_bps: float
    stop_slippage_bps: float
    description: str


SCENARIOS = (
    CostScenario(
        "FORWARD_MEDIAN",
        12.0,
        3.0,
        "12 bps per one-way turnover, based on observed median round-trip execution before conservative tail stress.",
    ),
    CostScenario(
        "NORMAL",
        20.0,
        5.0,
        "20 bps per one-way turnover, matching the existing Stock Normal research convention.",
    ),
    CostScenario(
        "FORWARD_P95",
        22.0,
        10.0,
        "22 bps per one-way turnover, approximating observed p95 one-way Slippage plus fees.",
    ),
    CostScenario(
        "SEVERE",
        50.0,
        20.0,
        "50 bps per one-way turnover with additional adverse stop-fill stress.",
    ),
)


@dataclass(frozen=True)
class Bar:
    ts: int
    day: str
    minute: int
    open: float
    high: float
    low: float
    close: float
    base_volume: float
    quote_volume: float


@dataclass
class Position:
    symbol: str
    theme: str
    side: int
    gross: float
    stop_price: float
    entry_day: str
    entry_ts: int
    entry_equity: float
    entry_count: int = 1


@dataclass
class Pending:
    action: str
    symbol: Optional[str] = None
    theme: Optional[str] = None
    side: int = 0
    target_gross: float = 0.0
    stop_distance_pct: float = 0.0
    reason: str = ""


def finite(value: object, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def request_json(path: str, params: dict, timeout: int = 30):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{BASE_URL}{path}?{query}",
        headers={"User-Agent": "DisDex-V96-Stock-Intraday-Theme-Flow-BT/1.0"},
    )
    error: Optional[Exception] = None
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # pragma: no cover - network path
            error = exc
            if attempt < 5:
                time.sleep(0.75 * (attempt + 1))
    raise RuntimeError(f"GET {path} failed after retries: {error}")


def fetch_klines(symbol: str, cache_dir: Path) -> List[list]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{symbol}-15m-{START_UTC.date()}-{END_UTC.date()}.json"
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list) and payload:
            return payload

    start_ms = int(START_UTC.timestamp() * 1000)
    end_ms = int(END_UTC.timestamp() * 1000)
    cursor = start_ms
    rows: List[list] = []
    while cursor < end_ms:
        payload = request_json(
            "/fapi/v1/klines",
            {
                "symbol": symbol,
                "interval": "15m",
                "startTime": cursor,
                "endTime": end_ms - 1,
                "limit": 1500,
            },
        )
        if not isinstance(payload, list) or not payload:
            break
        usable = [row for row in payload if isinstance(row, list) and len(row) >= 8]
        rows.extend(usable)
        next_cursor = int(payload[-1][0]) + INTERVAL_MS
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1500:
            break
        time.sleep(0.04)
    dedup = {int(row[0]): row for row in rows}
    result = [dedup[key] for key in sorted(dedup)]
    path.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    return result


def load_all(cache_dir: Path) -> Dict[str, List[list]]:
    result: Dict[str, List[list]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_klines, symbol, cache_dir): symbol for symbol in SYMBOLS}
        for future in concurrent.futures.as_completed(futures):
            symbol = futures[future]
            result[symbol] = future.result()
            print(f"loaded {symbol}: {len(result[symbol])} 15m bars")
    return dict(sorted(result.items()))


def regular_sessions(rows: Sequence[list]) -> Dict[str, Dict[int, Bar]]:
    sessions: Dict[str, Dict[int, Bar]] = defaultdict(dict)
    for row in rows:
        ts = int(row[0])
        local = dt.datetime.fromtimestamp(ts / 1000.0, tz=UTC).astimezone(NY)
        minute = local.hour * 60 + local.minute
        if local.weekday() >= 5 or not (570 <= minute < 960):
            continue
        bar = Bar(
            ts=ts,
            day=local.date().isoformat(),
            minute=minute,
            open=finite(row[1]),
            high=finite(row[2]),
            low=finite(row[3]),
            close=finite(row[4]),
            base_volume=finite(row[5]),
            quote_volume=finite(row[7]),
        )
        if min(bar.open, bar.high, bar.low, bar.close) <= 0:
            continue
        sessions[bar.day][minute] = bar
    return dict(sessions)


def session_summary(bars: Dict[int, Bar], previous_close: Optional[float]) -> Optional[dict]:
    ordered = [bars[key] for key in sorted(bars) if 570 <= key < 960]
    if len(ordered) < 20:
        return None
    high = max(bar.high for bar in ordered)
    low = min(bar.low for bar in ordered)
    close = ordered[-1].close
    denominator = previous_close if previous_close and previous_close > 0 else ordered[0].open
    true_range_pct = max(
        high - low,
        abs(high - denominator),
        abs(low - denominator),
    ) / denominator * 100.0
    return {
        "open": ordered[0].open,
        "high": high,
        "low": low,
        "close": close,
        "trueRangePct": true_range_pct,
        "bars": len(ordered),
    }


def build_features(sessions: Dict[str, Dict[str, Dict[int, Bar]]]) -> dict:
    summaries: Dict[str, Dict[str, dict]] = defaultdict(dict)
    atr_pct: Dict[str, Dict[str, float]] = defaultdict(dict)
    volume_baselines: Dict[str, Dict[str, Dict[int, float]]] = defaultdict(lambda: defaultdict(dict))

    for symbol, by_day in sessions.items():
        prior_close: Optional[float] = None
        valid_days: List[str] = []
        for day in sorted(by_day):
            summary = session_summary(by_day[day], prior_close)
            if summary is None:
                continue
            summaries[symbol][day] = summary
            prior_close = summary["close"]
            if len(valid_days) >= HISTORY_SESSIONS:
                history = valid_days[-HISTORY_SESSIONS:]
                atr_pct[symbol][day] = statistics.mean(
                    summaries[symbol][item]["trueRangePct"] for item in history
                )
                for minute in range(570, 946, 15):
                    samples: List[float] = []
                    for history_day in history:
                        bars = by_day[history_day]
                        cumulative = sum(
                            bar.quote_volume for key, bar in bars.items() if 570 <= key <= minute
                        )
                        if cumulative > 0:
                            samples.append(cumulative)
                    if samples:
                        volume_baselines[symbol][day][minute] = statistics.median(samples)
            valid_days.append(day)
    return {
        "summaries": summaries,
        "atrPct": atr_pct,
        "volumeBaselines": volume_baselines,
    }


def percentile_rank(values: Sequence[Tuple[str, float]], symbol: str) -> float:
    ordered = sorted(values, key=lambda item: (item[1], item[0]))
    if len(ordered) <= 1:
        return 0.5
    index = next(index for index, item in enumerate(ordered) if item[0] == symbol)
    return index / (len(ordered) - 1)


def symbol_state(
    symbol: str,
    day: str,
    minute: int,
    sessions: Dict[str, Dict[str, Dict[int, Bar]]],
    features: dict,
) -> Optional[dict]:
    bars = sessions.get(symbol, {}).get(day, {})
    bar = bars.get(minute)
    opening = [bars.get(570), bars.get(585)]
    atr = features["atrPct"].get(symbol, {}).get(day)
    baseline = features["volumeBaselines"].get(symbol, {}).get(day, {}).get(minute)
    if bar is None or any(item is None for item in opening) or atr is None or atr <= 0 or not baseline:
        return None
    session_open = opening[0].open
    cumulative_base = sum(item.base_volume for key, item in bars.items() if 570 <= key <= minute)
    cumulative_quote = sum(item.quote_volume for key, item in bars.items() if 570 <= key <= minute)
    vwap = cumulative_quote / cumulative_base if cumulative_base > 0 else None
    if vwap is None or vwap <= 0:
        return None
    move_pct = (bar.close / session_open - 1.0) * 100.0
    opening_high = max(item.high for item in opening if item is not None)
    opening_low = min(item.low for item in opening if item is not None)
    long_break = (bar.close / opening_high - 1.0) * 100.0 / atr
    short_break = (bar.close / opening_low - 1.0) * 100.0 / atr
    relative_volume = cumulative_quote / baseline
    return {
        "symbol": symbol,
        "bar": bar,
        "movePct": move_pct,
        "moveAtr": move_pct / atr,
        "atrPct": atr,
        "vwap": vwap,
        "aboveVwap": bar.close > vwap,
        "longBreakAtr": long_break,
        "shortBreakAtr": short_break,
        "relativeVolume": relative_volume,
    }


def build_signal(
    day: str,
    minute: int,
    sessions: Dict[str, Dict[str, Dict[int, Bar]]],
    features: dict,
    config: Config = CONFIG,
) -> Optional[SignalState]:
    candidates: List[Tuple[SignalState, float]] = []
    for theme, symbols in THEMES.items():
        members = [
            state for state in (symbol_state(symbol, day, minute, sessions, features) for symbol in symbols)
            if state is not None
        ]
        if len(members) < MIN_THEME_MEMBERS:
            continue
        positive = sum(state["movePct"] > 0 for state in members) / len(members)
        negative = sum(state["movePct"] < 0 for state in members) / len(members)
        theme_move = statistics.median(state["moveAtr"] for state in members)
        ranked = [(state["symbol"], state["moveAtr"]) for state in members]
        side = 0
        if positive >= config.minimum_theme_breadth and theme_move >= config.minimum_theme_move_atr:
            side = 1
        elif negative >= config.minimum_theme_breadth and theme_move <= -config.minimum_theme_move_atr:
            side = -1
        if side == 0:
            continue
        ordered = sorted(members, key=lambda state: state["moveAtr"], reverse=side > 0)
        for state in ordered:
            rank = percentile_rank(ranked, state["symbol"])
            signal = SignalState(
                theme=theme,
                symbol=state["symbol"],
                side=side,
                theme_breadth=positive if side > 0 else negative,
                theme_move_atr=theme_move,
                symbol_rank=rank,
                opening_break_atr=state["longBreakAtr"] if side > 0 else state["shortBreakAtr"],
                above_session_vwap=state["aboveVwap"],
                relative_volume=state["relativeVolume"],
                confirmation_bars=1,
                atr_pct=state["atrPct"],
            )
            passed, _reason = signal_passes(signal, config)
            if passed:
                candidates.append((signal, abs(theme_move)))
                break
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[1], abs(item[0].opening_break_atr), item[0].symbol), reverse=True)
    return candidates[0][0]


def selected_bar(
    sessions: Dict[str, Dict[str, Dict[int, Bar]]], symbol: str, day: str, minute: int
) -> Optional[Bar]:
    return sessions.get(symbol, {}).get(day, {}).get(minute)


def apply_return(equity: float, gross: float, side: int, start: float, end: float) -> float:
    if gross <= 0 or side == 0 or start <= 0 or end <= 0:
        return equity
    raw = side * (end / start - 1.0)
    return equity * max(0.001, 1.0 + gross * raw)


def apply_cost(equity: float, turnover: float, bps: float) -> float:
    return equity * max(0.001, 1.0 - max(0.0, turnover) * bps / 10_000.0)


def close_trade(
    position: Position,
    equity: float,
    exit_ts: int,
    exit_day: str,
    reason: str,
    trades: List[dict],
) -> None:
    trades.append({
        "symbol": position.symbol,
        "theme": position.theme,
        "side": position.side,
        "entryDay": position.entry_day,
        "exitDay": exit_day,
        "entryTs": position.entry_ts,
        "exitTs": exit_ts,
        "grossAtExit": position.gross,
        "adds": max(0, position.entry_count - 1),
        "return": equity / position.entry_equity - 1.0,
        "exitReason": reason,
    })


def replay(
    sessions: Dict[str, Dict[str, Dict[int, Bar]]],
    features: dict,
    scenario: CostScenario,
    config: Config = CONFIG,
) -> dict:
    days = sorted(set().union(*(set(by_day) for by_day in sessions.values())))
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    equity_rows: List[dict] = []
    trades: List[dict] = []
    position: Optional[Position] = None
    pending: Optional[Pending] = None
    last_price: Optional[float] = None
    entries_today = 0
    cooldown_until = -1
    confirmation_key: Optional[Tuple[str, int]] = None
    confirmation_bars = 0
    total_turnover = 0.0
    rejection_counts: Dict[str, int] = defaultdict(int)
    signal_events = 0

    for day in days:
        entries_today = 0
        confirmation_key = None
        confirmation_bars = 0
        minutes = sorted(set().union(*(
            set(sessions.get(symbol, {}).get(day, {})) for symbol in SYMBOLS
        )))
        for minute in minutes:
            ts_candidates = [
                sessions[symbol][day][minute].ts
                for symbol in SYMBOLS
                if minute in sessions.get(symbol, {}).get(day, {})
            ]
            if not ts_candidates:
                continue
            ts = min(ts_candidates)

            # Mark an existing position from the prior close to this bar's open.
            if position is not None:
                bar = selected_bar(sessions, position.symbol, day, minute)
                if bar is None:
                    continue
                if last_price is not None:
                    equity = apply_return(equity, position.gross, position.side, last_price, bar.open)
                last_price = bar.open

                # Mandatory 15:45 New York flat is executed at the 15:45 bar open.
                if minute >= config.force_exit_new_york_minute:
                    turnover = position.gross
                    equity = apply_cost(equity, turnover, scenario.turnover_bps)
                    total_turnover += turnover
                    close_trade(position, equity, ts, day, "FORCED_INTRADAY_EXIT", trades)
                    position = None
                    pending = None
                    last_price = None

            # Execute a decision produced by the prior completed bar at this bar open.
            if pending is not None:
                if pending.action == "EXIT" and position is not None:
                    turnover = position.gross
                    equity = apply_cost(equity, turnover, scenario.turnover_bps)
                    total_turnover += turnover
                    close_trade(position, equity, ts, day, pending.reason, trades)
                    position = None
                    last_price = None
                elif pending.action == "ENTER" and position is None and minute <= config.entry_end_new_york_minute + 15:
                    bar = selected_bar(sessions, str(pending.symbol), day, minute)
                    if bar is not None and entries_today < config.maximum_entries_per_day and ts >= cooldown_until:
                        target = pending.target_gross
                        equity_before = equity
                        equity = apply_cost(equity, target, scenario.turnover_bps)
                        total_turnover += target
                        stop_fraction = pending.stop_distance_pct / 100.0
                        stop_price = bar.open * (1.0 - pending.side * stop_fraction)
                        position = Position(
                            symbol=str(pending.symbol),
                            theme=str(pending.theme),
                            side=pending.side,
                            gross=target,
                            stop_price=stop_price,
                            entry_day=day,
                            entry_ts=ts,
                            entry_equity=equity_before,
                        )
                        entries_today += 1
                        last_price = bar.open
                elif pending.action == "ADD" and position is not None and pending.symbol == position.symbol:
                    new_target = max(position.gross, pending.target_gross)
                    turnover = new_target - position.gross
                    if turnover > 1e-12:
                        equity = apply_cost(equity, turnover, scenario.turnover_bps)
                        total_turnover += turnover
                        position.gross = new_target
                        position.entry_count += 1
                pending = None

            # Apply this completed bar to an open position and enforce the hard stop.
            if position is not None:
                bar = selected_bar(sessions, position.symbol, day, minute)
                if bar is None:
                    continue
                stop_hit = (
                    position.side > 0 and bar.low <= position.stop_price
                ) or (
                    position.side < 0 and bar.high >= position.stop_price
                )
                if stop_hit:
                    stop_fill = position.stop_price * (
                        1.0 - position.side * scenario.stop_slippage_bps / 10_000.0
                    )
                    equity = apply_return(equity, position.gross, position.side, bar.open, stop_fill)
                    turnover = position.gross
                    equity = apply_cost(equity, turnover, scenario.turnover_bps)
                    total_turnover += turnover
                    close_trade(position, equity, ts + INTERVAL_MS, day, "HARD_STOP_EXIT", trades)
                    position = None
                    last_price = None
                    cooldown_until = ts + INTERVAL_MS + config.stop_cooldown_minutes * 60 * 1000
                else:
                    equity = apply_return(equity, position.gross, position.side, bar.open, bar.close)
                    last_price = bar.close

            peak = max(peak, equity)
            max_dd = min(max_dd, equity / peak - 1.0)
            equity_rows.append({"ts": ts + INTERVAL_MS, "day": day, "equity": equity})

            if minute < config.entry_start_new_york_minute or minute > config.entry_end_new_york_minute:
                continue

            signal = build_signal(day, minute, sessions, features, config)
            if signal is None:
                confirmation_key = None
                confirmation_bars = 0
                continue
            signal_events += 1
            key = (signal.symbol, signal.side)
            if key == confirmation_key:
                confirmation_bars += 1
            else:
                confirmation_key = key
                confirmation_bars = 1
            signal = SignalState(**{**asdict(signal), "confirmation_bars": confirmation_bars})

            if position is None:
                if entries_today >= config.maximum_entries_per_day:
                    rejection_counts["DAILY_ENTRY_LIMIT"] += 1
                    continue
                if ts + INTERVAL_MS < cooldown_until:
                    rejection_counts["POST_STOP_COOLDOWN"] += 1
                    continue
                maximum = risk_capped_gross(signal, config)
                target = min(config.initial_gross_cap, maximum)
                if target <= 0:
                    rejection_counts["RISK_SIZE_ZERO"] += 1
                    continue
                pending = Pending(
                    action="ENTER",
                    symbol=signal.symbol,
                    theme=signal.theme,
                    side=signal.side,
                    target_gross=target,
                    stop_distance_pct=stop_distance_pct(signal, config),
                    reason="ENTRY_ALLOWED",
                )
                continue

            held_bar = selected_bar(sessions, position.symbol, day, minute)
            if held_bar is None:
                continue
            held_state = symbol_state(position.symbol, day, minute, sessions, features)
            vwap_failure = bool(
                held_state is not None
                and ((position.side > 0 and held_bar.close < held_state["vwap"])
                     or (position.side < 0 and held_bar.close > held_state["vwap"]))
            )
            if signal.side == -position.side:
                pending = Pending(action="EXIT", reason="OPPOSITE_SIGNAL_EXIT")
            elif vwap_failure:
                pending = Pending(action="EXIT", reason="VWAP_FAILURE_EXIT")
            elif signal.symbol == position.symbol and signal.side == position.side and confirmation_bars >= 2:
                maximum = risk_capped_gross(signal, config)
                target = min(maximum, position.gross + config.add_gross_cap, config.stock_gross_cap)
                if target > position.gross + 1e-12:
                    pending = Pending(
                        action="ADD",
                        symbol=signal.symbol,
                        theme=signal.theme,
                        side=signal.side,
                        target_gross=target,
                        stop_distance_pct=stop_distance_pct(signal, config),
                        reason="CONFIRMED_ADD",
                    )

        # Fail closed at end of any session even if the final expected bar is missing.
        if position is not None and position.entry_day == day:
            available = sessions.get(position.symbol, {}).get(day, {})
            if available:
                final_bar = available[max(available)]
                if last_price is not None and final_bar.close != last_price:
                    equity = apply_return(equity, position.gross, position.side, last_price, final_bar.close)
                turnover = position.gross
                equity = apply_cost(equity, turnover, scenario.turnover_bps)
                total_turnover += turnover
                close_trade(position, equity, final_bar.ts + INTERVAL_MS, day, "SESSION_DATA_END_EXIT", trades)
            position = None
            pending = None
            last_price = None

    return {
        "scenario": asdict(scenario),
        "equity": equity_rows,
        "trades": trades,
        "metrics": trade_metrics(trades, equity_rows, total_turnover),
        "diagnostics": {
            "signalEvents": signal_events,
            "rejectionCounts": dict(sorted(rejection_counts.items())),
        },
    }


def product_return(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
    return equity - 1.0


def profit_factor(values: Sequence[float]) -> Optional[float]:
    positive = sum(value for value in values if value > 0)
    negative = -sum(value for value in values if value < 0)
    if negative <= 1e-15:
        return None if positive <= 0 else 999.0
    return positive / negative


def max_drawdown(rows: Sequence[dict]) -> float:
    peak = 1.0
    result = 0.0
    for row in rows:
        equity = finite(row.get("equity"), 1.0)
        peak = max(peak, equity)
        result = min(result, equity / peak - 1.0)
    return result


def trade_metrics(trades: Sequence[dict], equity_rows: Sequence[dict], turnover: float) -> dict:
    values = [finite(trade.get("return")) for trade in trades]
    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    first_ts = min((int(row["ts"]) for row in equity_rows), default=int(START_UTC.timestamp() * 1000))
    last_ts = max((int(row["ts"]) for row in equity_rows), default=int(END_UTC.timestamp() * 1000))
    years = max((last_ts - first_ts) / (365.2425 * 86_400_000.0), 1 / 365.2425)
    total_return = product_return(values)
    cagr = (max(0.001, 1.0 + total_return) ** (1.0 / years) - 1.0) if values else 0.0
    return {
        "trades": len(values),
        "longTrades": sum(int(trade.get("side", 0)) > 0 for trade in trades),
        "shortTrades": sum(int(trade.get("side", 0)) < 0 for trade in trades),
        "winRatePct": (len(wins) / len(values) * 100.0) if values else 0.0,
        "profitFactor": profit_factor(values),
        "averageTradePct": statistics.mean(values) * 100.0 if values else 0.0,
        "averageWinPct": statistics.mean(wins) * 100.0 if wins else 0.0,
        "averageLossPct": statistics.mean(losses) * 100.0 if losses else 0.0,
        "compoundedReturnPct": total_return * 100.0,
        "cagrPct": cagr * 100.0,
        "maxDrawdownPct": max_drawdown(equity_rows) * 100.0,
        "turnover": turnover,
    }


def chronological_splits(days: Sequence[str]) -> dict:
    ordered = sorted(set(days))
    if not ordered:
        return {}
    n = len(ordered)
    dev_end = max(1, int(n * 0.60))
    val_end = max(dev_end + 1, int(n * 0.80))
    return {
        "DEVELOPMENT": (ordered[0], ordered[min(dev_end - 1, n - 1)]),
        "VALIDATION": (ordered[min(dev_end, n - 1)], ordered[min(val_end - 1, n - 1)]),
        "HOLDOUT": (ordered[min(val_end, n - 1)], ordered[-1]),
    }


def subset_trade_metrics(trades: Sequence[dict], start: str, end: str) -> dict:
    selected = [trade for trade in trades if start <= str(trade.get("exitDay")) <= end]
    values = [finite(trade.get("return")) for trade in selected]
    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    return {
        "start": start,
        "end": end,
        "trades": len(selected),
        "winRatePct": len(wins) / len(values) * 100.0 if values else 0.0,
        "profitFactor": profit_factor(values),
        "averageTradePct": statistics.mean(values) * 100.0 if values else 0.0,
        "compoundedReturnPct": product_return(values) * 100.0,
        "averageWinPct": statistics.mean(wins) * 100.0 if wins else 0.0,
        "averageLossPct": statistics.mean(losses) * 100.0 if losses else 0.0,
    }


def removal_metrics(trades: Sequence[dict]) -> dict:
    if not trades:
        return {
            "bestTradeRemovedPct": 0.0,
            "bestMonthRemovedPct": 0.0,
            "largestTradeShareOfPositivePct": None,
        }
    values = [finite(trade.get("return")) for trade in trades]
    best_index = max(range(len(values)), key=values.__getitem__)
    without_best = [value for index, value in enumerate(values) if index != best_index]
    monthly: Dict[str, List[float]] = defaultdict(list)
    for trade, value in zip(trades, values):
        monthly[str(trade.get("exitDay", ""))[:7]].append(value)
    monthly_returns = {month: product_return(items) for month, items in monthly.items()}
    best_month = max(monthly_returns, key=monthly_returns.get)
    without_month = [
        value for trade, value in zip(trades, values)
        if str(trade.get("exitDay", ""))[:7] != best_month
    ]
    positives = [value for value in values if value > 0]
    return {
        "bestTradeRemovedPct": product_return(without_best) * 100.0,
        "bestMonth": best_month,
        "bestMonthRemovedPct": product_return(without_month) * 100.0,
        "largestTradeShareOfPositivePct": (
            max(positives) / sum(positives) * 100.0 if positives and sum(positives) > 0 else None
        ),
    }


def concentration(trades: Sequence[dict]) -> dict:
    symbol_values: Dict[str, List[float]] = defaultdict(list)
    theme_values: Dict[str, List[float]] = defaultdict(list)
    for trade in trades:
        value = finite(trade.get("return"))
        symbol_values[str(trade.get("symbol"))].append(value)
        theme_values[str(trade.get("theme"))].append(value)
    return {
        "symbols": {
            key: {"trades": len(values), "compoundedReturnPct": product_return(values) * 100.0}
            for key, values in sorted(symbol_values.items())
        },
        "themes": {
            key: {"trades": len(values), "compoundedReturnPct": product_return(values) * 100.0}
            for key, values in sorted(theme_values.items())
        },
    }


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def analyze(cache_dir: Path) -> dict:
    raw = load_all(cache_dir)
    sessions = {symbol: regular_sessions(rows) for symbol, rows in raw.items()}
    features = build_features(sessions)
    eligible_days = sorted(set().union(*(
        set(features["atrPct"].get(symbol, {})) for symbol in SYMBOLS
    )))
    splits = chronological_splits(eligible_days)
    results = {}
    for scenario in SCENARIOS:
        replayed = replay(sessions, features, scenario)
        trades = replayed["trades"]
        replayed["splits"] = {
            name: subset_trade_metrics(trades, start, end)
            for name, (start, end) in splits.items()
        }
        replayed["years"] = {
            year: subset_trade_metrics(trades, f"{year}-01-01", f"{year}-12-31")
            for year in sorted({str(trade.get("exitDay", ""))[:4] for trade in trades if trade.get("exitDay")})
        }
        replayed["removals"] = removal_metrics(trades)
        replayed["concentration"] = concentration(trades)
        results[scenario.name] = replayed

    median = results["FORWARD_MEDIAN"]
    severe = results["SEVERE"]
    val_m = median["splits"].get("VALIDATION", {})
    hold_m = median["splits"].get("HOLDOUT", {})
    val_s = severe["splits"].get("VALIDATION", {})
    hold_s = severe["splits"].get("HOLDOUT", {})
    robust = bool(
        median["metrics"]["trades"] >= 30
        and val_m.get("trades", 0) >= 5
        and hold_m.get("trades", 0) >= 5
        and val_m.get("compoundedReturnPct", 0) > 0
        and hold_m.get("compoundedReturnPct", 0) > 0
        and val_s.get("compoundedReturnPct", 0) > 0
        and hold_s.get("compoundedReturnPct", 0) > 0
        and (median["metrics"].get("profitFactor") or 0) > 1.10
        and (severe["metrics"].get("profitFactor") or 0) > 1.0
        and median["removals"]["bestTradeRemovedPct"] > 0
        and severe["removals"]["bestTradeRemovedPct"] > 0
    )
    status = (
        "ROBUST_HISTORICAL_CORE_LEAD_FORWARD_GATES_STILL_REQUIRED"
        if robust else "NO_ROBUST_INTRADAY_THEME_FLOW_EDGE"
    )
    return rounded({
        "version": 1,
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "dataWindow": {"startUtc": START_UTC.isoformat(), "endUtc": END_UTC.isoformat()},
        "universe": list(SYMBOLS),
        "themes": {key: list(value) for key, value in THEMES.items()},
        "implementationChoicesRequiredForReplay": {
            "atr": "mean regular-session True Range percent over the prior 20 completed sessions",
            "relativeVolume": "cumulative quote volume through the completed 15m slot divided by the prior-20-session median for the same slot",
            "symbolRank": "cross-sectional percentile of session-open-to-current-close move normalized by prior ATR",
            "entryFill": "next 15m bar open after a completed signal bar",
            "vwapOrOppositeExitFill": "next 15m bar open",
            "hardStopFill": "fixed stop plus scenario-specific adverse Slippage",
            "forcedExitFill": "15:45 New York bar open",
        },
        "splits": splits,
        "results": results,
        "comparisonReferences": {
            "rejectedDailyDirectionalNormalPct": -3.75,
            "rejectedDailyDirectionalSeverePct": -9.5216,
            "rejectedWeeklyNeutralNormalPct": -2.2554,
            "rejectedWeeklyNeutralSeverePct": -5.3501,
        },
        "evidenceLimits": [
            "Historical Aster stock-perpetual listing depth is uneven and current-listing survivorship bias remains.",
            "Historical Open Interest snapshots, exact event first-seen chronology, halts, and book-quality gates are not reconstructed.",
            "The historical test evaluates the frozen OHLCV direction and exit core with Forward-calibrated execution costs.",
            "Because Forward-only gates can block entries, this historical result can overstate live trade count and profitability.",
            "Thresholds were frozen before this run, but the available Holdout is limited by short listing histories.",
        ],
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
        },
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-intraday-theme-flow-bt.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        "# V96 Stock Intraday Theme Flow V1 — Historical Backtest",
        "",
        f"- Status: **{result['status']}**",
        f"- Window: {result['dataWindow']['startUtc']} through {result['dataWindow']['endUtc']}",
        f"- Symbols: {len(result['universe'])}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Scenario | Trades | Return | CAGR | PF | Win rate | Max DD | Best trade removed | Best month removed |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95", "SEVERE"):
        item = result["results"][name]
        metric = item["metrics"]
        removal = item["removals"]
        lines.append(
            f"| {name} | {metric['trades']} | {metric['compoundedReturnPct']}% | {metric['cagrPct']}% | "
            f"{metric['profitFactor']} | {metric['winRatePct']}% | {metric['maxDrawdownPct']}% | "
            f"{removal['bestTradeRemovedPct']}% | {removal['bestMonthRemovedPct']}% |"
        )
    lines.extend(["", "## Chronological splits", ""])
    for name in ("FORWARD_MEDIAN", "SEVERE"):
        lines.append(f"### {name}")
        lines.append("")
        lines.append("| Split | Dates | Trades | Return | PF | Win rate |")
        lines.append("| --- | --- | ---: | ---: | ---: | ---: |")
        for split_name, metric in result["results"][name]["splits"].items():
            lines.append(
                f"| {split_name} | {metric['start']}–{metric['end']} | {metric['trades']} | "
                f"{metric['compoundedReturnPct']}% | {metric['profitFactor']} | {metric['winRatePct']}% |"
            )
        lines.append("")
    lines.extend([
        "## Interpretation limit",
        "",
        "This is the historical OHLCV core with Forward-calibrated costs. Historical OI, exact event chronology, halts, and order-book consistency are not reconstructed, so live execution can produce fewer trades and lower returns.",
    ])
    (output_dir / "v96-stock-intraday-theme-flow-bt.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(SYMBOLS) == 22
    assert set(AI_SYMBOLS) | set(SEMICONDUCTOR_SYMBOLS) == set(SYMBOLS)
    assert abs(product_return([0.10, -0.05]) - 0.045) < 1e-12
    assert percentile_rank([("A", -1.0), ("B", 0.0), ("C", 1.0)], "C") == 1.0
    signal = SignalState(
        theme="AI",
        symbol="NVDAUSDT",
        side=1,
        theme_breadth=0.70,
        theme_move_atr=0.50,
        symbol_rank=0.90,
        opening_break_atr=0.20,
        above_session_vwap=True,
        relative_volume=1.30,
        confirmation_bars=1,
        atr_pct=1.0,
    )
    assert signal_passes(signal)[0] is True
    assert risk_capped_gross(signal) == 0.6


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=".cache/v96-stock-intraday-theme-flow")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-intraday-theme-flow-bt")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock intraday theme-flow backtest self-test: PASS")
        return 0
    result = analyze(Path(args.cache_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({
        "strategyId": result["strategyId"],
        "status": result["status"],
        "forwardMedian": result["results"]["FORWARD_MEDIAN"]["metrics"],
        "severe": result["results"]["SEVERE"]["metrics"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
