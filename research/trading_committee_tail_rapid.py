#!/usr/bin/env python3
"""Representative pre-screen for the full tail-basis grid."""
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
