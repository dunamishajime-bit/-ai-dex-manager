"""Execution-only fix for V17.

The first V17 run correctly detected that a Range position could remain open
until the next 12H checkpoint even though the frozen V15 Trend sleeve entered
at the next-hour execution bar. The intended predeclared rule is Trend priority
with no overlapping exposure. This wrapper changes no Range family condition,
selection gate, cost, hold limit, stop, or V15 rule. It exits Range exactly at
the already-frozen V15 trend entry open when that entry occurs before the next
Range checkpoint.
"""
from __future__ import annotations

from typing import Any

import research_portfolio_profit_engine_v17 as v17


def simulate_range_fixed(family: str, candles, index, p12, hourly, trend_records, start: int, end: int, cost_bps: float, delay_bars: int):
    timeline = [ts for ts in sorted(p12['BTC']) if start <= ts < end and (ts - v17.base.START_2023) % v17.CHECK_MS == 0]
    records: list[dict[str, Any]] = []
    position: dict[str, Any] | None = None

    def close_position(exit_ts: int, exit_price: float, reason: str) -> None:
        nonlocal position
        if position is None:
            return
        symbol = str(position['symbol'])
        gross = (exit_price / float(position['entryPrice']) - 1.0) * 100.0
        net = gross - cost_bps / 100.0
        records.append({
            'symbol': symbol, 'side': 'LONG', 'sideSign': 1,
            'entryTs': int(position['entryTs']), 'exitTs': exit_ts,
            'entryPrice': float(position['entryPrice']), 'exitPrice': exit_price,
            'grossReturnPct': gross, 'netReturnPct': net,
            'entryScore': float(position['entryScore']), 'exitReason': reason,
            'holdingHours': int((exit_ts - int(position['entryTs'])) // v17.HOUR),
            'sleeve': 'RANGE', 'rangeFamily': family,
        })
        position = None

    for ts in timeline:
        # Exact V15 takeover occurs on the frozen V15 execution bar, which may
        # be between 12H Range checkpoints. Exit at the same bar open before
        # any new Trend exposure exists, so gross exposure never exceeds 100%.
        if position is not None:
            takeover_ts = position.get('takeoverTs')
            if takeover_ts is not None and int(takeover_ts) <= ts:
                symbol = str(position['symbol'])
                px = v17._price(candles, index, symbol, int(takeover_ts), 'open')
                if px is None:
                    raise RuntimeError(f'V17_TAKEOVER_PRICE_MISSING:{symbol}:{takeover_ts}')
                close_position(int(takeover_ts), float(px), 'TREND_TAKEOVER')

        if position is not None:
            symbol = str(position['symbol'])
            held = int((ts - int(position['entryTs'])) // v17.HOUR)
            close = v17._price(candles, index, symbol, ts, 'close')
            if close is None:
                continue
            gross_now = (close / float(position['entryPrice']) - 1.0) * 100.0
            h = hourly[symbol].get(ts)
            recovered = held >= v17.RANGE_RECOVERY_MIN_HOURS and h is not None and float(h['z6']) <= 0.0 and gross_now > 0
            stop = gross_now <= v17.RANGE_STOP_PCT
            timeout = held >= v17.RANGE_MAX_HOURS
            if recovered or stop or timeout:
                i = index[symbol].get(ts)
                if i is None:
                    continue
                ei = min(i + delay_bars, len(candles[symbol]) - 1)
                exit_ts = int(candles[symbol][ei]['ts'])
                if exit_ts >= end:
                    exit_ts = ts; ei = i
                exit_price = float(candles[symbol][ei]['open']) if exit_ts != ts else close
                # If delayed stress execution would cross a frozen Trend entry,
                # Trend priority clips the Range exit to that exact takeover.
                takeover_ts = position.get('takeoverTs')
                if takeover_ts is not None and exit_ts > int(takeover_ts):
                    exit_ts = int(takeover_ts)
                    px = v17._price(candles, index, symbol, exit_ts, 'open')
                    if px is None:
                        raise RuntimeError(f'V17_DELAY_TAKEOVER_PRICE_MISSING:{symbol}:{exit_ts}')
                    exit_price = float(px)
                    reason = 'TREND_TAKEOVER'
                else:
                    reason = 'RANGE_RECOVERY' if recovered else 'RANGE_STOP' if stop else 'RANGE_TIMEOUT'
                close_position(exit_ts, exit_price, reason)
            if position is not None:
                continue

        if v17._trend_occupied(trend_records, ts):
            continue
        cand = v17._candidate(family, ts, p12, hourly)
        if cand is None:
            continue
        symbol = str(cand['symbol']); i = index[symbol].get(ts)
        if i is None:
            continue
        ei = i + 1 + delay_bars
        if ei >= len(candles[symbol]):
            continue
        entry_ts = int(candles[symbol][ei]['ts'])
        if entry_ts >= end or v17._trend_occupied(trend_records, entry_ts):
            continue
        next_trend = v17._next_trend_entry(trend_records, entry_ts)
        if next_trend is not None and next_trend - entry_ts < v17.RANGE_RECOVERY_MIN_HOURS * v17.HOUR:
            continue
        position = {
            'symbol': symbol,
            'entryTs': entry_ts,
            'entryPrice': float(candles[symbol][ei]['open']),
            'entryScore': float(cand['score']),
            'takeoverTs': next_trend,
        }

    if position is not None:
        takeover_ts = position.get('takeoverTs')
        if takeover_ts is not None and int(takeover_ts) < end:
            symbol = str(position['symbol'])
            px = v17._price(candles, index, symbol, int(takeover_ts), 'open')
            if px is None:
                raise RuntimeError(f'V17_FINAL_TAKEOVER_PRICE_MISSING:{symbol}:{takeover_ts}')
            close_position(int(takeover_ts), float(px), 'TREND_TAKEOVER')
        else:
            symbol = str(position['symbol'])
            final_ts = max(int(r['ts']) for r in candles[symbol] if start <= int(r['ts']) < end)
            px = v17._price(candles, index, symbol, final_ts, 'close')
            if px is not None:
                close_position(final_ts, float(px), 'PERIOD_END')
    return records


if __name__ == '__main__':
    v17.simulate_range = simulate_range_fixed
    v17.main()
