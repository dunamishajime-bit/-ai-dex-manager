#!/usr/bin/env python3
"""Run the multi-asset scanner with Binance USD-M contract symbol mapping."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import run_multiasset_scanner_v1 as scanner

scanner.UNIVERSE = [
    "PENGUUSDT",
    "1000PEPEUSDT",
    "WIFUSDT",
    "1000BONKUSDT",
    "DOGEUSDT",
    "SUIUSDT",
    "SEIUSDT",
    "APTUSDT",
    "OPUSDT",
    "ARBUSDT",
]

scanner.GROUP = {
    "PENGUUSDT": "MEME",
    "1000PEPEUSDT": "MEME",
    "WIFUSDT": "MEME",
    "1000BONKUSDT": "MEME",
    "DOGEUSDT": "MEME",
    "SUIUSDT": "L1_L2",
    "SEIUSDT": "L1_L2",
    "APTUSDT": "L1_L2",
    "OPUSDT": "L1_L2",
    "ARBUSDT": "L1_L2",
}

scanner.main()
