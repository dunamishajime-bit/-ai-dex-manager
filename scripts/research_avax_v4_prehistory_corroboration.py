"""Prehistory corroboration for frozen AVAX V4.

Diagnostic only. It does not change or override the original V4 candidate gate.
It applies the exact frozen AVAX SYNCHRONIZED_MARKET_CATCHUP_12H architecture
to the earlier 2022-09 through 2023-07 history. Post-2026-07-01 fresh OOS is
not read. Production/VPS/LIVE/order paths are untouched.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import research_causal_handoff_clean_sheet_v4 as v4

SYMBOL = "AVAX"
DATA_START = 1661990400000  # 2022-09-01 00:00 UTC
SPLIT = v4.base.hist.jst08(2023, 2, 1)
PRE_END = v4.base.START_2023
PERIODS = {
    "preA": (DATA_START, SPLIT),
    "preB": (SPLIT, PRE_END),
    "preCombined": (DATA_START, PRE_END),
}

_raw_feature = v4.feature
_feature_cache: dict[tuple[str, int], dict[str, float] | None] = {}


def cached_feature(symbol: str, candles, index, ts: int):
    key = (str(symbol), int(ts))
    if key not in _feature_cache:
        _feature_cache[key] = _raw_feature(symbol, candles, index, int(ts))
    value = _feature_cache[key]
    return None if value is None else dict(value)


def main() -> None:
    v4.feature = cached_feature
    candles, index, _ = v4.base.v109.b.base.load()
    results = {}
    all_records = []
    for label, (start, end) in PERIODS.items():
        normal = v4.simulate(SYMBOL, candles, index, start, end, v4.NORMAL_BPS, 0)
        stress = v4.simulate(SYMBOL, candles, index, start, end, v4.STRESS_BPS, v4.STRESS_DELAY)
        results[label] = {
            "normal": v4.metric(normal),
            "stress": v4.metric(stress),
        }
        if label != "preCombined":
            for r in normal:
                row = dict(r); row["period"] = label
                all_records.append(row)

    out = {
        "researchLine": "AVAX_V4_PREHISTORY_CORROBORATION",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "symbol": SYMBOL,
        "architecture": v4.ARCH[SYMBOL],
        "v4LogicFrozen": True,
        "originalV4GateStillBinding": True,
        "originalV4GateOverride": False,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "periods": PERIODS,
        "results": results,
        "interpretationRule": "Diagnostic corroboration only; cannot promote AVAX to Fresh OOS or LIVE eligibility and cannot relax the original V4 minimum-sample gate.",
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    (root / "avax-v4-prehistory-corroboration.json").write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    with (root / "avax-v4-prehistory-corroboration-trades.jsonl").open("w", encoding="utf-8") as fh:
        for row in all_records:
            fh.write(json.dumps(row, sort_keys=True) + "\n")
    lines = ["# AVAX V4 Prehistory Corroboration", "", f"Architecture: {v4.ARCH[SYMBOL]}", ""]
    for label in ("preA", "preB", "preCombined"):
        n = results[label]["normal"]; s = results[label]["stress"]
        lines.append(f"- {label}: trades={n['trades']} return={n['returnPct']:.2f}% PF={n['pf']} PFwo={n['pfWithoutBest']} DD={n['maxDDPct']:.2f}% stressReturn={s['returnPct']:.2f}% stressPF={s['pf']}")
    lines += ["", "Diagnostic only. Original V4 Gate remains binding. Fresh OOS not read."]
    (root / "avax-v4-prehistory-corroboration.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
