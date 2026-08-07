from __future__ import annotations

import research_lab_v97_adaptive_event_core_v1 as v97


def completed_trade_ledger(schedule, market):
    out = []
    for item in schedule:
        symbol = item['symbol']
        side = int(item['side'])
        entry_ts = int(item['entryTs'])
        exit_ts = int(item['exitTs'])
        entry_idx = market['indexes'][symbol].get(entry_ts)
        exit_idx = market['indexes'][symbol].get(exit_ts)
        if entry_idx is None:
            raise RuntimeError(f'V97_LEDGER_ENTRY_PRICE_MISSING {symbol} {entry_ts}')
        # The final V6 trade is intentionally still open at END_MS. It remains in the
        # frozen account replay but is excluded from completed-trade router statistics.
        if exit_ts >= v97.END_MS or exit_idx is None:
            continue
        entry_price = float(market['bars'][symbol][entry_idx]['open'])
        exit_price = float(market['bars'][symbol][exit_idx]['open'])
        funding = 0.0
        ts = entry_ts
        while ts < exit_ts:
            funding += -side * v97.BASE_GROSS * market['funding'][symbol].get(ts, 0.0)
            ts += v97.BAR_MS
        net = side * v97.BASE_GROSS * (exit_price / entry_price - 1.0) + funding - 2.0 * v97.BASE_GROSS * 10.0 / 10_000.0
        out.append({**item, 'shadowReturn': net, 'shadowReturnPct': net * 100.0})
    return out


v97.trade_ledger = completed_trade_ledger

if __name__ == '__main__':
    v97.main()
