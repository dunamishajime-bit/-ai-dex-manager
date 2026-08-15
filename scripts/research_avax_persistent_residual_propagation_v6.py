"""AVAX Persistent Residual Propagation V6.

Research only. Clean-sheet architecture derived from the frozen V4 regime-break
diagnosis, not a V4 threshold patch. All pre-2026-07-01 history is explicitly
DESIGN evidence because it has already been inspected. This script does NOT
read the untouched post-2026-07-01 Fresh OOS window.

Architecture:
1. BTC and ETH must own the same direction on both 12h impulse and 72h state.
2. AVAX must genuinely lag the BTC/ETH market component on 12h residual return.
3. AVAX must begin reaccelerating in the owned direction on 3h/6h tape.
4. Exit on loss of market ownership / reacceleration or fixed 12h capture.

No parameter grid, no family tournament, no same-run retuning.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as base

HOUR = base.HOUR
SYMBOL = "AVAX"
DATA_START = 1661990400000
FRESH_START = base.END_2026
NORMAL_BPS = 10.0
STRESS_BPS = 30.0
STRESS_DELAY = 1
RISK = float(base.RISK[SYMBOL])
ARCH = "PERSISTENT_RESIDUAL_PROPAGATION_12H"
PERIODS = {
    "prehistory": (DATA_START, base.START_2023),
    "development": base.PERIODS["development"],
    "validation": base.PERIODS["validation"],
    "evaluation": base.PERIODS["evaluation"],
    "allDesign": (DATA_START, FRESH_START),
}

# Single predeclared architecture constants. Not searched in this run.
FAST_Z_MIN = 0.70
SLOW_Z_MIN = 0.35
RESIDUAL_LAG_Z_MAX = -0.25
REACCEL_Z3_MIN = 0.15
REACCEL_Z6_MIN = 0.00
MAX_VOL_RATIO = 1.50
MAX_HOLD_HOURS = 12
INVALIDATION_MIN_HOURS = 3
COOLDOWN_HOURS = 6

_z_cache: dict[tuple[str, int, int], float | None] = {}
_ret_cache: dict[tuple[str, int, int], float | None] = {}
_ctx_cache: dict[tuple[str, int], dict[str, float] | None] = {}


def hourly_vol_pct(candles, i: int, n: int = 168) -> float | None:
    if i < n:
        return None
    vals = []
    for j in range(i - n + 1, i + 1):
        a = float(candles[j - 1]["close"])
        b = float(candles[j]["close"])
        if a > 0 and b > 0:
            vals.append((b / a - 1.0) * 100.0)
    return statistics.pstdev(vals) if len(vals) > 10 else None


def raw_ret(candles, index, symbol: str, ts: int, bars: int) -> float | None:
    key = (symbol, int(ts), int(bars))
    if key in _ret_cache:
        return _ret_cache[key]
    i = index[symbol].get(int(ts))
    if i is None or i < bars:
        _ret_cache[key] = None
        return None
    a = float(candles[symbol][i - bars]["close"])
    b = float(candles[symbol][i]["close"])
    value = (b / a - 1.0) * 100.0 if a > 0 else None
    _ret_cache[key] = value
    return value


def zret(candles, index, symbol: str, ts: int, bars: int) -> float | None:
    key = (symbol, int(ts), int(bars))
    if key in _z_cache:
        return _z_cache[key]
    i = index[symbol].get(int(ts))
    r = raw_ret(candles, index, symbol, ts, bars)
    if i is None or r is None:
        _z_cache[key] = None
        return None
    vol = hourly_vol_pct(candles[symbol], i, 168)
    if vol is None or vol <= 1e-9:
        _z_cache[key] = None
        return None
    value = float(r) / (float(vol) * math.sqrt(float(bars)))
    _z_cache[key] = value
    return value


def context(candles, index, ts: int) -> dict[str, float] | None:
    key = (SYMBOL, int(ts))
    if key in _ctx_cache:
        value = _ctx_cache[key]
        return None if value is None else dict(value)
    i = index[SYMBOL].get(int(ts))
    if i is None or i < 900:
        _ctx_cache[key] = None
        return None
    btc12 = zret(candles, index, "BTC", ts, 12)
    eth12 = zret(candles, index, "ETH", ts, 12)
    btc72 = zret(candles, index, "BTC", ts, 72)
    eth72 = zret(candles, index, "ETH", ts, 72)
    av3 = zret(candles, index, SYMBOL, ts, 3)
    av6 = zret(candles, index, SYMBOL, ts, 6)
    av12 = zret(candles, index, SYMBOL, ts, 12)
    br12 = raw_ret(candles, index, "BTC", ts, 12)
    er12 = raw_ret(candles, index, "ETH", ts, 12)
    ar12 = raw_ret(candles, index, SYMBOL, ts, 12)
    vals = (btc12, eth12, btc72, eth72, av3, av6, av12, br12, er12, ar12)
    if any(v is None for v in vals):
        _ctx_cache[key] = None
        return None
    av_vol = hourly_vol_pct(candles[SYMBOL], i, 168)
    av24 = hourly_vol_pct(candles[SYMBOL], i, 24)
    av96 = hourly_vol_pct(candles[SYMBOL], i, 96)
    if av_vol is None or av24 is None or av96 is None or av_vol <= 1e-9 or av96 <= 1e-9:
        _ctx_cache[key] = None
        return None
    market12 = 0.5 * float(br12) + 0.5 * float(er12)
    residual12 = float(ar12) - market12
    residual_z12 = residual12 / (float(av_vol) * math.sqrt(12.0))
    # Breadth is contextual only; it is not a threshold in V6.
    bx = base._ctx(SYMBOL, candles, index, int(ts))
    breadth = float(bx["breadth"]) if bx is not None else 0.5
    value = {
        "i": float(i),
        "btcZ12": float(btc12), "ethZ12": float(eth12),
        "btcZ72": float(btc72), "ethZ72": float(eth72),
        "avaxZ3": float(av3), "avaxZ6": float(av6), "avaxZ12": float(av12),
        "residualZ12": float(residual_z12),
        "volRatio24to96": float(av24 / av96),
        "breadth": breadth,
    }
    _ctx_cache[key] = value
    return dict(value)


def signal(x: dict[str, float]) -> int | None:
    if x["btcZ12"] >= FAST_Z_MIN and x["ethZ12"] >= FAST_Z_MIN:
        side = 1
    elif x["btcZ12"] <= -FAST_Z_MIN and x["ethZ12"] <= -FAST_Z_MIN:
        side = -1
    else:
        return None
    # Persistent ownership: both leaders must agree with fast impulse on 72h.
    if side * x["btcZ72"] < SLOW_Z_MIN or side * x["ethZ72"] < SLOW_Z_MIN:
        return None
    # True lag is residual to the BTC/ETH market component, not low AVAX absolute return.
    if side * x["residualZ12"] > RESIDUAL_LAG_Z_MAX:
        return None
    # AVAX must begin participating after lagging.
    if side * x["avaxZ3"] < REACCEL_Z3_MIN or side * x["avaxZ6"] < REACCEL_Z6_MIN:
        return None
    if x["volRatio24to96"] > MAX_VOL_RATIO:
        return None
    return side


def ownership_alive(x: dict[str, float], side: int) -> bool:
    return (
        side * x["btcZ12"] > 0
        and side * x["ethZ12"] > 0
        and side * x["btcZ72"] > 0
        and side * x["ethZ72"] > 0
    )


def lifecycle(x: dict[str, float], side: int, held: int, current_pct: float) -> str | None:
    if held >= INVALIDATION_MIN_HOURS:
        if current_pct <= 0 and (not ownership_alive(x, side) or side * x["avaxZ3"] <= 0):
            return "PROPAGATION_INVALIDATED"
    if held >= MAX_HOLD_HOURS:
        return "PROPAGATION_FIXED_CAPTURE"
    return None


def simulate(candles, index, start: int, end: int, cost_bps: float, delay_bars: int) -> list[dict[str, Any]]:
    c = candles[SYMBOL]
    records: list[dict[str, Any]] = []
    pos: dict[str, Any] | None = None
    cooldown_until = -1

    def close_position(ts: int, reason: str, period_end: bool = False) -> None:
        nonlocal pos, cooldown_until
        assert pos is not None
        i = index[SYMBOL].get(int(ts))
        if i is None:
            return
        xi = i if period_end else i + 1 + delay_bars
        if xi >= len(c) or int(c[xi]["ts"]) >= end:
            xi = i
            exit_price = float(c[i]["close"])
        else:
            exit_price = float(c[xi]["open"])
        side = int(pos["side"]); entry = float(pos["entryPrice"])
        gross = side * (exit_price / entry - 1.0) * 100.0
        net = (gross - cost_bps / 100.0) * RISK
        lo = int(pos["entryIndex"]); rows = c[min(lo, xi):max(lo, xi) + 1]
        if side > 0:
            mfe = (max(float(r["high"]) for r in rows) / entry - 1.0) * 100.0
            mae = (min(float(r["low"]) for r in rows) / entry - 1.0) * 100.0
        else:
            mfe = (entry / min(float(r["low"]) for r in rows) - 1.0) * 100.0
            mae = (entry / max(float(r["high"]) for r in rows) - 1.0) * 100.0
        records.append({
            "symbol": SYMBOL, "architecture": ARCH,
            "side": "LONG" if side > 0 else "SHORT", "sideSign": side,
            "signalTs": int(pos["signalTs"]), "entryTs": int(pos["entryTs"]), "exitTs": int(c[xi]["ts"]),
            "entryPrice": entry, "exitPrice": exit_price,
            "grossReturnPct": gross, "netReturnPct": net,
            "mfePct": mfe, "maePct": mae,
            "holdingHours": max(0, int((int(c[xi]["ts"]) - int(pos["entryTs"])) // HOUR)),
            "exitReason": reason,
            "signalContext": pos["signalContext"],
        })
        cooldown_until = int(c[xi]["ts"]) + COOLDOWN_HOURS * HOUR
        pos = None

    for row in c:
        ts = int(row["ts"])
        if not (start <= ts < end):
            continue
        x = context(candles, index, ts)
        if x is None:
            continue
        i = int(x["i"])
        if pos is not None:
            held = int((ts - int(pos["entryTs"])) // HOUR)
            side = int(pos["side"])
            current_pct = side * (float(row["close"]) / float(pos["entryPrice"]) - 1.0) * 100.0
            reason = lifecycle(x, side, held, current_pct)
            if reason:
                close_position(ts, reason)
                continue
        if pos is not None or ts < cooldown_until:
            continue
        side = signal(x)
        if side is None:
            continue
        ei = i + 1 + delay_bars
        if ei >= len(c) or int(c[ei]["ts"]) >= end:
            continue
        pos = {
            "side": int(side), "signalTs": ts,
            "entryTs": int(c[ei]["ts"]), "entryPrice": float(c[ei]["open"]), "entryIndex": ei,
            "signalContext": {k: v for k, v in x.items() if k != "i"},
        }
    if pos is not None:
        final_ts = max(int(r["ts"]) for r in c if start <= int(r["ts"]) < end)
        close_position(final_ts, "PERIOD_END", period_end=True)
    return records


def pf(vals: list[float]) -> float | None:
    w = sum(v for v in vals if v > 0); l = abs(sum(v for v in vals if v < 0))
    if l <= 1e-12:
        return 999.0 if w > 0 else None
    return w / l


def metric(records: list[dict[str, Any]]) -> dict[str, Any]:
    vals = [float(r["netReturnPct"]) for r in records]
    eq = peak = 1.0; dd = 0.0
    for v in vals:
        eq *= max(0.001, 1.0 + v / 100.0); peak = max(peak, eq); dd = min(dd, (eq / peak - 1.0) * 100.0)
    wo = list(vals)
    if wo:
        wo.pop(max(range(len(wo)), key=wo.__getitem__))
    return {
        "trades": len(vals), "returnPct": (eq - 1.0) * 100.0, "pf": pf(vals), "pfWithoutBest": pf(wo),
        "maxDDPct": dd, "winRatePct": 100.0 * sum(v > 0 for v in vals) / len(vals) if vals else None,
        "medianTradePct": statistics.median(vals) if vals else None,
        "exitReasons": {reason: sum(r["exitReason"] == reason for r in records) for reason in sorted({r["exitReason"] for r in records})},
    }


def main() -> None:
    candles, index, _ = base.v109.b.base.load()
    results: dict[str, Any] = {}
    records_by_period: dict[str, list[dict[str, Any]]] = {}
    for label, (start, end) in PERIODS.items():
        n = simulate(candles, index, start, end, NORMAL_BPS, 0)
        s = simulate(candles, index, start, end, STRESS_BPS, STRESS_DELAY)
        records_by_period[label] = n
        results[label] = {"normal": metric(n), "stress": metric(s)}
    design_blocks = [results[p]["normal"] for p in ("prehistory", "development", "validation", "evaluation")]
    design_total = results["allDesign"]["normal"]
    design_stress = results["allDesign"]["stress"]
    positive_blocks = sum(m["returnPct"] > 0 for m in design_blocks)
    worst_block = min(m["returnPct"] for m in design_blocks)
    sanity_gate = bool(
        design_total["trades"] >= 20
        and design_total["returnPct"] > 0
        and (design_total["pf"] or 0) >= 1.15
        and (design_total["pfWithoutBest"] or 0) >= 1.00
        and (design_stress["pf"] or 0) >= 0.90
        and positive_blocks >= 3
        and worst_block > -5.0
    )
    out = {
        "researchLine": "AVAX_PERSISTENT_RESIDUAL_PROPAGATION_V6",
        "researchOnly": True, "productionChanged": False, "vpsChanged": False, "liveChanged": False,
        "realTradingEnabled": False, "symbol": SYMBOL, "architecture": ARCH,
        "v4SignalOrExitCalled": False,
        "freshOosRead": False, "post20260701DataUsed": False,
        "allHistoricalDataTreatedAsDesignEvidence": True,
        "historicalSanityGateIsNotOosEvidence": True,
        "historicalSanityGate": sanity_gate,
        "freshOosPermission": sanity_gate,
        "parameters": {
            "FAST_Z_MIN": FAST_Z_MIN, "SLOW_Z_MIN": SLOW_Z_MIN,
            "RESIDUAL_LAG_Z_MAX": RESIDUAL_LAG_Z_MAX,
            "REACCEL_Z3_MIN": REACCEL_Z3_MIN, "REACCEL_Z6_MIN": REACCEL_Z6_MIN,
            "MAX_VOL_RATIO": MAX_VOL_RATIO, "MAX_HOLD_HOURS": MAX_HOLD_HOURS,
        },
        "antiOverfit": {
            "cleanSheet": True, "parameterGrid": False, "familyTournament": False, "sameRunRetuning": False,
            "v4ThresholdPatch": False, "freshOosRequiredBeforeAnyLiveUse": True,
        },
        "positiveDesignBlocks": positive_blocks, "worstDesignBlockReturnPct": worst_block,
        "periods": PERIODS, "results": results,
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    (root / "avax-persistent-residual-propagation-v6.json").write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    with (root / "avax-persistent-residual-propagation-v6-trades.jsonl").open("w", encoding="utf-8") as fh:
        for label in ("prehistory", "development", "validation", "evaluation"):
            for r in records_by_period[label]:
                row = dict(r); row["period"] = label
                fh.write(json.dumps(row, sort_keys=True) + "\n")
    lines = ["# AVAX Persistent Residual Propagation V6", "", f"Historical design sanity gate: {sanity_gate}", ""]
    for label in ("prehistory", "development", "validation", "evaluation", "allDesign"):
        n = results[label]["normal"]; s = results[label]["stress"]
        lines.append(f"- {label}: trades={n['trades']} return={n['returnPct']:.2f}% PF={n['pf']} PFwo={n['pfWithoutBest']} DD={n['maxDDPct']:.2f}% stressReturn={s['returnPct']:.2f}% stressPF={s['pf']}")
    lines += ["", "All history is design evidence, not OOS. Fresh post-2026-07-01 data remains untouched unless the frozen sanity gate passes."]
    (root / "avax-persistent-residual-propagation-v6.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
