#!/usr/bin/env python3
"""Reproducible DOT SHORT research exit comparison.

HYPE entry and dual exits (user-adopted) remain locked. Other IDLE symbols
keep current unadopted-to-production baseline behavior. All 8 strategies are
dynamically reselected. 10bps and stress 30bps, 2025-08-10..2026-08-10.
Research-only: nothing is written to VPS, Production, HP or orders.
"""
from __future__ import annotations
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
SPEC = importlib.util.spec_from_file_location(
    "dot_short_profit_source_integrator",
    HERE / "run-idle-five-entry-full8-after-hype-20261022.py")
assert SPEC and SPEC.loader
mainmod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mainmod)

# Short-only DOT rules; no LONG / RENDER / TAO / HYPE / PENGU modifications.
DOT_GUARDS = {
    "DOT_PROFIT_1P5_FLOOR0P25": (.015, .0025),
    "DOT_PROFIT_2P0_FLOOR0P5": (.020, .005),
    "DOT_PROFIT_3P0_FLOOR1P0": (.030, .010),
}
for name, (arm, floor) in DOT_GUARDS.items():
    mainmod.POLICIES[name] = {}
    mainmod.EXIT_RULES[name] = {
        "id": "IDLE_" + name,
        "strategy": "IDLE",
        "sides": ["SHORT"],
        "symbols": ["DOTUSDT"],
        "kind": "profit_short",
        "arm": arm,
        "floor": floor,
    }
assert all(0 < r["floor"] < r["arm"] for r in mainmod.EXIT_RULES.values()
           if r["id"].startswith("IDLE_DOT_PROFIT"))

if __name__ == "__main__":
    mainmod.main()
