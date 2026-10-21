#!/usr/bin/env python3
"""Cached nine-month pre-screen using the same committee economics."""
from __future__ import annotations

from research import trading_committee_basis as base
from research import trading_committee_basis_fast as fast

base.SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "PENGUUSDT"]
base.DEV_END = base.pd.Timestamp("2026-01-01", tz="UTC")
base.VAL_END = base.pd.Timestamp("2026-04-01", tz="UTC")
base.FINAL_END = base.pd.Timestamp("2026-07-01", tz="UTC")


def rapid_candidates() -> list[base.Candidate]:
    out = []
    for family in ["mean_reversion", "carry_confirmed", "turn_confirmed", "funding_carry"]:
        for lookback in [7, 14]:
            for entry in [1.5, 2.25, 3.0]:
                for hold in [4, 8]:
                    out.append(base.Candidate(family, lookback, entry, 0.35, hold))
    return out


base.candidates = rapid_candidates
base.build_positions = fast.aligned_build_positions

if __name__ == "__main__":
    base.main()
