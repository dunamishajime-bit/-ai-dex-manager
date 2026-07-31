#!/usr/bin/env python3
"""Run tail research with normalized cached funding timestamps."""
import pandas as pd
from research import aster_binance_microstructure as m

_original_align = m.align_funding

def normalized_align(frame, index, name):
    normalized = frame.copy()
    normalized.index = pd.to_datetime(normalized.index, utc=True, format="mixed")
    normalized_index = pd.DatetimeIndex(pd.to_datetime(index, utc=True, format="mixed"))
    return _original_align(normalized, normalized_index, name)

m.align_funding = normalized_align

from research import trading_committee_tail as tail

if __name__ == "__main__":
    tail.main()
