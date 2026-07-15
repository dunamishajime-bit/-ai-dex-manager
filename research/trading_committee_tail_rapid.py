#!/usr/bin/env python3
"""Representative tail pre-screen using only required cached datasets."""
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
    # The audited extended run found zero Binance mark-price archive rows.
    # Avoid repeating 18 months of known 404 checks; contract price is the
    # explicitly documented fallback in resample_symbol().
    bm = pd.DataFrame()
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


def representative_candidates():
    out = []
    for family in ["tail_mean_reversion", "tail_turn", "tail_carry", "tail_turn_carry"]:
        for z in [3.0, 4.0, 5.0]:
            for gap in [20.0, 40.0]:
                out.append(tail.TailCandidate(family, 14, z, gap, 24))
    return out


tail.candidates = representative_candidates

if __name__ == "__main__":
    tail.main()
