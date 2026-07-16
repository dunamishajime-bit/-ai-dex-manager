#!/usr/bin/env python3
"""Compact, predeclared PENGU research grid for CI execution.

The underlying engine and acceptance gates remain unchanged. This wrapper
restricts the search to 192 long-only trend/pullback candidates because the
user's priority is higher hit rate rather than broad long/short coverage.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import run_pengu_swing_research as engine


def compact_grid():
    for slow_ema in [72, 120]:
        for fast_ema in [24, 36]:
            if fast_ema >= slow_ema:
                continue
            for pullback_hours in [6, 12]:
                for atr_min in [0.015, 0.020]:
                    for tp in [0.04, 0.05, 0.06]:
                        for sl in [0.020, 0.025]:
                            for max_hold in [48, 72]:
                                yield engine.Candidate(
                                    slow_ema=slow_ema,
                                    fast_ema=fast_ema,
                                    pullback_hours=pullback_hours,
                                    atr_min=atr_min,
                                    volume_ratio=1.0,
                                    rsi_long_max=62,
                                    rsi_short_min=38,
                                    tp=tp,
                                    sl=sl,
                                    max_hold_hours=max_hold,
                                    direction_mode="long_only",
                                    early_exit=True,
                                )


engine.candidate_grid = compact_grid
engine.main()
