#!/usr/bin/env python3
"""Point-in-time PENGU ablation for the existing cross-sectional strategy.

PENGU is added only when the underlying loader finds real historical data and
when the strategy's existing minimum-history/liquidity gates are satisfied.
No pre-listing backfill or synthetic history is used.
"""
from pathlib import Path

from research import multiperp_cross_section as base

if "PENGUUSDT" not in base.SYMBOLS:
    base.SYMBOLS = [*base.SYMBOLS, "PENGUUSDT"]

base.OUTPUT_DIR = Path("backtest_output_pengu_ablation")
base.CACHE_DIR = Path(".cache/multiperp_4h_pengu")

if __name__ == "__main__":
    print("Running point-in-time cross-sectional test with PENGUUSDT added.")
    print("PENGU becomes eligible only after the existing history and liquidity gates pass.")
    base.main()
