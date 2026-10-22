#!/usr/bin/env python3
"""Research-only combined FET LONG high-water exit + initial adverse guard.

This is a follow-on compatibility test: preserve ALL 8-logic adopted HYPE,
TAO, RENDER, and prior exits. Do not treat component backtests as cumulative.
"""
from __future__ import annotations
import importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("fet_combined_exit_study", HERE/"run-fet-exits-after-hype-render-tao-20261022.py")
assert spec and spec.loader
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

TRAIL = m.RULES["FET_TRAIL_8P_GIVEBACK_4P"]
INITIALS = {
    "FET_COMBO_TRAIL8GB4_PLUS_INITIAL3H":m.RULES["FET_INITIAL_3H_MINUS1P5_LOW_MFE"],
    "FET_COMBO_TRAIL8GB4_PLUS_INITIAL4H":m.RULES["FET_INITIAL_4H_MINUS2P_LOW_MFE"]
}
for key,initial in INITIALS.items():
    m.RULES[key]={"id":key,"strategy":"FET","sides":["LONG"],"kind":"fet_combo",
                  "trail_rule":TRAIL,"initial_rule":initial}
    m.CASE_NAMES.append(key)

PRIOR=m.apply
def with_combo(row,rule,source,cost_bps,obs,original_row=None):
    if rule.get("kind")!="fet_combo":
        return PRIOR(row,rule,source,cost_bps,obs,original_row=original_row)
    if not m._safe_matching(row,rule):return row
    trail=m.apply_fet_trail(row,rule["trail_rule"],source,cost_bps,obs)
    initial=m.m.base.ORIGINAL_APPLY(row,rule["initial_rule"],source,cost_bps,obs,original_row=original_row)
    # The earlier real historical exit, new trail or initial adverse exit wins.
    return min((row,trail,initial),key=lambda r:int(r["exit_ts_ms"]))
m.apply=with_combo

if __name__=="__main__":
    m.main()
