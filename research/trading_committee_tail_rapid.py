#!/usr/bin/env python3
"""Representative tail pre-screen using cached data and event-first execution."""
import math
import numpy as np
import pandas as pd
from research import aster_binance_microstructure as m

_original_align = m.align_funding

def normalized_align(frame, index, name):
    normalized = frame.copy()
    normalized.index = pd.to_datetime(normalized.index, utc=True, format="mixed")
    normalized_index = pd.DatetimeIndex(pd.to_datetime(index, utc=True, format="mixed"))
    return _original_align(normalized, normalized_index, name)

m.align_funding = normalized_align


def price_funding_only_loader(symbol):
    coverage = {"symbol": symbol}
    a = m.fetch_klines(m.ASTER, "/fapi/v1/klines", symbol, m.START, m.END)
    am = m.fetch_klines(m.ASTER, "/fapi/v1/markPriceKlines", symbol, m.START, m.END)
    b = m.fetch_klines(m.BINANCE, "/fapi/v1/klines", symbol, m.START, m.END)
    af = m.fetch_funding(m.ASTER, symbol, m.START, m.END)
    bf = m.fetch_funding(m.BINANCE, symbol, m.START, m.END)
    coverage.update({
        "aster_bars": len(a), "binance_bars": len(b),
        "aster_mark_bars": len(am), "binance_mark_bars": 0,
        "aster_funding_rows": len(af), "binance_funding_rows": len(bf),
        "metrics_rows": 0, "liquidation_rows": 0,
    })
    if a.empty or b.empty:
        coverage["status"] = "missing_core_price_data"
        return pd.DataFrame(), coverage
    index = a.index.intersection(b.index)
    index = index[(index >= m.START) & (index < m.END)]
    if len(index) < 30 * 24 * 12:
        coverage["status"] = "insufficient_overlap"
        return pd.DataFrame(), coverage
    df = pd.DataFrame(index=index)
    for prefix, frame in [("a", a), ("b", b)]:
        for column in ["open", "high", "low", "close", "quote_volume", "trades", "taker_buy_quote"]:
            if column in frame:
                df[f"{prefix}_{column}"] = frame[column].reindex(index)
        df[f"{prefix}_flow"] = m.safe_flow(frame).reindex(index)
    df["a_mark"] = am["close"].reindex(index).ffill() if not am.empty else np.nan
    df["b_mark"] = np.nan
    df["a_funding"] = m.align_funding(af, index, "a_funding")
    df["b_funding"] = m.align_funding(bf, index, "b_funding")
    df["long_liq"] = np.nan
    df["short_liq"] = np.nan
    coverage.update({"start": str(index.min()), "end": str(index.max()), "status": "ok"})
    return m.build_features(df), coverage

m.load_symbol = price_funding_only_loader

from research import trading_committee_tail as tail
from research import trading_committee_basis as base


def representative_candidates():
    out = []
    for family in ["tail_mean_reversion", "tail_turn", "tail_carry", "tail_turn_carry"]:
        for z in [3.0, 4.0, 5.0]:
            for gap in [20.0, 40.0]:
                out.append(tail.TailCandidate(family, 14, z, gap, 24))
    return out


def event_first_positions(data, candidate):
    prepared = {symbol: tail.prepare(frame, candidate) for symbol, frame in data.items()}
    common = sorted(set.intersection(*(set(frame.index) for frame in prepared.values())))
    index = pd.DatetimeIndex(common)
    aligned = {symbol: frame.reindex(index) for symbol, frame in prepared.items()}
    gates = {symbol: base.liquidity_gate(frame, symbol) for symbol, frame in aligned.items()}
    positions = pd.DataFrame(0.0, index=index, columns=sorted(aligned))
    max_bars = candidate.max_hold_hours * 4

    # The original implementation checks every symbol on every bar and selects
    # the largest opportunity. Tail events are sparse, so build that same choice
    # map only at timestamps where a signal actually exists.
    best_by_bar = {}
    last_signal_bar = len(index) - max_bars - 3
    for symbol, frame in aligned.items():
        opportunity = frame["opportunity"].fillna(0.0).to_numpy(float)
        direction = frame["direction"].fillna(0.0).to_numpy(float)
        allowed = gates[symbol].fillna(False).to_numpy(bool)
        event_idx = np.flatnonzero((opportunity > 0.0) & (direction != 0.0) & allowed)
        event_idx = event_idx[event_idx < last_signal_bar]
        for i in event_idx:
            current = best_by_bar.get(int(i))
            value = float(opportunity[i])
            if current is None or value > current[0]:
                best_by_bar[int(i)] = (value, symbol, float(direction[i]))

    trades = []
    next_free = 0
    for i in sorted(best_by_bar):
        if i < next_free:
            continue
        _, symbol, direction = best_by_bar[i]
        frame = aligned[symbol]
        entry = i + 1
        if not gates[symbol].iat[entry]:
            continue
        entry_gap = 1e4 * math.log(float(frame["a_open"].iat[entry]) / float(frame["b_open"].iat[entry]))
        if np.sign(entry_gap) != -np.sign(direction) or abs(entry_gap) < candidate.min_gap_bps * 0.75:
            continue
        exit_index = min(entry + max_bars, len(index) - 2)
        reason = "time"
        target_abs = abs(entry_gap) * candidate.remaining_fraction
        stop_distance = max(20.0, abs(entry_gap) * 0.60)
        for j in range(entry + 1, exit_index + 1):
            gap_now = 1e4 * math.log(float(frame["a_close"].iat[j]) / float(frame["b_close"].iat[j]))
            favorable = direction * (gap_now - entry_gap)
            if abs(gap_now) <= target_abs or np.sign(gap_now) != np.sign(entry_gap):
                exit_index, reason = j, "gap_capture"
                break
            if favorable <= -stop_distance:
                exit_index, reason = j, "gap_stop"
                break
        holding_gate = gates[symbol].iloc[entry:exit_index + 1]
        minimum_ratio = 0.95 if symbol == "PENGUUSDT" else 0.70
        if len(holding_gate) == 0 or float(holding_gate.mean()) < minimum_ratio:
            continue
        positions.loc[index[entry:exit_index], symbol] = 0.5 * direction
        trades.append({
            "candidate": candidate.name,
            "symbol": symbol,
            "signal_time": index[i],
            "entry_time": index[entry],
            "exit_time": index[exit_index],
            "direction_aster": direction,
            "entry_gap_bps": entry_gap,
            "exit_reason": reason,
        })
        next_free = exit_index + 1
    return positions, trades


tail.candidates = representative_candidates
tail.build_positions = event_first_positions

if __name__ == "__main__":
    tail.main()
