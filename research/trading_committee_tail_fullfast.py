#!/usr/bin/env python3
"""Full 144-candidate tail grid with the audited event-first runner."""
from research import trading_committee_tail_rapid as fast
from research import trading_committee_tail as tail


def full_candidates():
    out = []
    for family in ["tail_mean_reversion", "tail_turn", "tail_carry", "tail_turn_carry"]:
        for lookback in [14, 30]:
            for z in [3.0, 4.0, 5.0]:
                for gap in [20.0, 40.0, 80.0]:
                    for hold in [24, 48]:
                        out.append(tail.TailCandidate(family, lookback, z, gap, hold))
    return out


tail.candidates = full_candidates
tail.build_positions = fast.event_first_positions

if __name__ == "__main__":
    tail.main()
