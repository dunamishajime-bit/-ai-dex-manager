"""Funding Crowding Release V5 for non-SOL pairs.

Research only. No production/VPS/LIVE/order changes.
V4 is frozen failed and is not threshold-patched here. SOL V3 remains frozen.
Post-2026-07-01 fresh OOS is not read.

New causal information source: perpetual funding crowding. Each pair has one
predeclared architecture: fade an extreme funding crowd only after the pair's
short-horizon tape turns against the crowded 24h move. No parameter grid,
family tournament, or same-run retuning.
"""
from __future__ import annotations

import bisect
import json
import os
import statistics
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as base

HOUR = base.HOUR
NORMAL_BPS = 10.0
STRESS_BPS = 30.0
STRESS_DELAY = 1
TRADE_SYMBOLS = ("ETH", "LINK", "BNB", "AVAX")
ARCH = {
    "ETH": "FUNDING_CROWD_RELEASE_12H",
    "LINK": "FUNDING_CROWD_RELEASE_16H",
    "BNB": "FUNDING_CROWD_RELEASE_8H",
    "AVAX": "FUNDING_CROWD_RELEASE_12H",
}
MAXHOLD = {"ETH": 12, "LINK": 16, "BNB": 8, "AVAX": 12}
RISK = {s: float(base.RISK[s]) for s in TRADE_SYMBOLS}
PERIODS = dict(base.PERIODS)

_ctx_cache: dict[tuple[str, int], dict[str, float] | None] = {}
_fz_cache: dict[tuple[str, int], float | None] = {}
_funding_times: dict[str, list[int]] = {}
_funding_values: dict[str, list[float]] = {}


def pf(values: list[float]) -> float | None:
    gains = sum(v for v in values if v > 0)
    losses = abs(sum(v for v in values if v < 0))
    if losses <= 1e-12:
        return 999.0 if gains > 0 else None
    return gains / losses


def metric(records: list[dict[str, Any]]) -> dict[str, Any]:
    vals = [float(r["netReturnPct"]) for r in records]
    eq = peak = 1.0
    dd = 0.0
    for v in vals:
        eq *= max(0.001, 1.0 + v / 100.0)
        peak = max(peak, eq)
        dd = min(dd, (eq / peak - 1.0) * 100.0)
    wo = list(vals)
    if wo:
        wo.pop(max(range(len(wo)), key=wo.__getitem__))
    return {
        "trades": len(vals),
        "returnPct": (eq - 1.0) * 100.0,
        "pf": pf(vals),
        "pfWithoutBest": pf(wo),
        "winRatePct": 100.0 * sum(v > 0 for v in vals) / len(vals) if vals else None,
        "maxDDPct": dd,
        "medianTradePct": statistics.median(vals) if vals else None,
        "medianMfePct": statistics.median([float(r["mfePct"]) for r in records]) if records else None,
        "medianMaePct": statistics.median([float(r["maePct"]) for r in records]) if records else None,
        "medianHoldingHours": statistics.median([float(r["holdingHours"]) for r in records]) if records else None,
    }


def ctx(symbol: str, candles, index, ts: int):
    key = (str(symbol), int(ts))
    if key not in _ctx_cache:
        _ctx_cache[key] = base._ctx(symbol, candles, index, int(ts))
    value = _ctx_cache[key]
    return None if value is None else dict(value)


def prepare_funding(fby) -> None:
    for s in TRADE_SYMBOLS:
        items = sorted((int(ts), float(rate)) for ts, rate in fby[s].items())
        _funding_times[s] = [ts for ts, _ in items]
        _funding_values[s] = [rate for _, rate in items]


def funding_z(symbol: str, ts: int) -> float | None:
    key = (str(symbol), int(ts))
    if key in _fz_cache:
        return _fz_cache[key]
    times = _funding_times[symbol]
    vals = _funding_values[symbol]
    pos = bisect.bisect_left(times, int(ts))
    if pos >= len(times) or times[pos] != int(ts) or pos < 60:
        _fz_cache[key] = None
        return None
    lo = max(0, pos - 90)
    hist = vals[lo:pos]
    if len(hist) < 60:
        _fz_cache[key] = None
        return None
    sd = statistics.pstdev(hist)
    if sd <= 1e-12:
        _fz_cache[key] = None
        return None
    z = (vals[pos] - statistics.fmean(hist)) / sd
    _fz_cache[key] = float(z)
    return float(z)


def signal(symbol: str, x: dict[str, float], fz: float) -> int | None:
    # One architecture per pair. Thresholds fixed before this run.
    zthr = {"ETH": 1.60, "LINK": 1.50, "BNB": 1.70, "AVAX": 1.50}[symbol]
    move = {"ETH": 0.45, "LINK": 0.55, "BNB": 0.45, "AVAX": 0.55}[symbol]
    turn = {"ETH": 0.12, "LINK": 0.15, "BNB": 0.12, "AVAX": 0.15}[symbol]

    # Positive funding z = crowded longs -> short only after the tape turns down.
    if fz >= zthr and x["z24"] >= move and x["z3"] <= -turn:
        if x["vr"] > 1.70 or x["eff"] > 0.45:
            return None
        if x["breadth"] > 0.84:
            return None
        return -1

    # Negative funding z = crowded shorts -> long only after the tape turns up.
    if fz <= -zthr and x["z24"] <= -move and x["z3"] >= turn:
        if x["vr"] > 1.70 or x["eff"] > 0.45:
            return None
        if x["breadth"] < 0.16:
            return None
        return 1
    return None


def lifecycle(symbol: str, side: int, x: dict[str, float], held: int, current_pct: float) -> str | None:
    if held >= 4 and (current_pct <= 0 or side * x["z3"] <= 0):
        return "CROWD_RELEASE_INVALIDATED"
    if held >= MAXHOLD[symbol]:
        return "CROWD_RELEASE_FIXED_CAPTURE"
    return None


def simulate(symbol: str, candles, index, fby, start: int, end: int, cost_bps: float, delay_bars: int) -> list[dict[str, Any]]:
    c = candles[symbol]
    records: list[dict[str, Any]] = []
    position: dict[str, Any] | None = None
    cooldown_until = -1
    funding_set = set(_funding_times[symbol])

    def close_position(ts: int, reason: str, period_end: bool = False) -> None:
        nonlocal position, cooldown_until
        assert position is not None
        i = index[symbol].get(int(ts))
        if i is None:
            return
        xi = i if period_end else i + 1 + delay_bars
        if xi >= len(c) or int(c[xi]["ts"]) >= end:
            xi = i
            exit_price = float(c[i]["close"])
        else:
            exit_price = float(c[xi]["open"])
        side = int(position["side"])
        entry = float(position["entryPrice"])
        gross = side * (exit_price / entry - 1.0) * 100.0
        net = (gross - cost_bps / 100.0) * RISK[symbol]
        lo = int(position["entryIndex"])
        rows = c[min(lo, xi):max(lo, xi) + 1]
        if side > 0:
            mfe = (max(float(r["high"]) for r in rows) / entry - 1.0) * 100.0
            mae = (min(float(r["low"]) for r in rows) / entry - 1.0) * 100.0
        else:
            mfe = (entry / min(float(r["low"]) for r in rows) - 1.0) * 100.0
            mae = (entry / max(float(r["high"]) for r in rows) - 1.0) * 100.0
        records.append({
            "symbol": symbol,
            "architecture": ARCH[symbol],
            "side": "LONG" if side > 0 else "SHORT",
            "sideSign": side,
            "signalTs": int(position["signalTs"]),
            "entryTs": int(position["entryTs"]),
            "exitTs": int(c[xi]["ts"]),
            "entryPrice": entry,
            "exitPrice": exit_price,
            "fundingZ": float(position["fundingZ"]),
            "grossReturnPct": gross,
            "netReturnPct": net,
            "mfePct": mfe,
            "maePct": mae,
            "holdingHours": max(0, int((int(c[xi]["ts"]) - int(position["entryTs"])) // HOUR)),
            "exitReason": reason,
        })
        cooldown_until = int(c[xi]["ts"]) + 8 * HOUR
        position = None

    for row in c:
        ts = int(row["ts"])
        if not (start <= ts < end):
            continue
        if position is not None:
            x = ctx(symbol, candles, index, ts)
            if x is not None:
                held = int((ts - int(position["entryTs"])) // HOUR)
                side = int(position["side"])
                current_pct = side * (float(row["close"]) / float(position["entryPrice"]) - 1.0) * 100.0
                reason = lifecycle(symbol, side, x, held, current_pct)
                if reason is not None:
                    close_position(ts, reason)
                    continue
        if position is not None or ts < cooldown_until or ts not in funding_set:
            continue
        fz = funding_z(symbol, ts)
        if fz is None:
            continue
        x = ctx(symbol, candles, index, ts)
        if x is None:
            continue
        side = signal(symbol, x, fz)
        if side is None:
            continue
        i = int(x["i"])
        ei = i + 1 + delay_bars
        if ei >= len(c) or int(c[ei]["ts"]) >= end:
            continue
        position = {
            "side": int(side),
            "signalTs": ts,
            "entryTs": int(c[ei]["ts"]),
            "entryPrice": float(c[ei]["open"]),
            "entryIndex": ei,
            "fundingZ": float(fz),
        }
    if position is not None:
        final_ts = max(int(r["ts"]) for r in c if start <= int(r["ts"]) < end)
        close_position(final_ts, "PERIOD_END", period_end=True)
    return records


def evaluate_symbol(symbol: str, candles, index, fby) -> dict[str, Any]:
    out: dict[str, Any] = {"architecture": ARCH[symbol], "periods": {}}
    for label in ("development", "validation", "evaluation"):
        start, end = PERIODS[label]
        n = simulate(symbol, candles, index, fby, start, end, NORMAL_BPS, 0)
        s = simulate(symbol, candles, index, fby, start, end, STRESS_BPS, STRESS_DELAY)
        out["periods"][label] = metric(n)
        out["periods"][label + "Stress"] = metric(s)
    n3 = simulate(symbol, candles, index, fby, *PERIODS["combined"], NORMAL_BPS, 0)
    s3 = simulate(symbol, candles, index, fby, *PERIODS["combined"], STRESS_BPS, STRESS_DELAY)
    out["combined3Y"] = metric(n3)
    out["combined3YStress"] = metric(s3)
    d = out["periods"]["development"]
    v = out["periods"]["validation"]
    vs = out["periods"]["validationStress"]
    out["historicalCandidateGate"] = bool(
        d["trades"] >= 8 and v["trades"] >= 6
        and d["returnPct"] > 0 and v["returnPct"] > 0
        and (d["pf"] or 0) >= 1.10 and (v["pf"] or 0) >= 1.10
        and (d["pfWithoutBest"] or 0) >= 0.95 and (v["pfWithoutBest"] or 0) >= 0.95
        and (vs["pf"] or 0) >= 0.90
    )
    out["positiveYears"] = sum(out["periods"][p]["returnPct"] > 0 for p in ("development", "validation", "evaluation"))
    return out


def main() -> None:
    candles, index, fby = base.v109.b.base.load()
    prepare_funding(fby)
    symbols = {s: evaluate_symbol(s, candles, index, fby) for s in TRADE_SYMBOLS}
    candidates = [s for s in TRADE_SYMBOLS if symbols[s]["historicalCandidateGate"]]
    out = {
        "researchLine": "FUNDING_CROWDING_RELEASE_V5",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "solV3Frozen": True,
        "v4FrozenFailed": True,
        "freshOosRead": False,
        "freshOosStartReserved": base.END_2026,
        "evaluation2025_26UsedForSelection": False,
        "architectures": ARCH,
        "antiOverfit": {
            "newInformationSource": "PERPETUAL_FUNDING_CROWDING",
            "oneArchitecturePerPair": True,
            "parameterGrid": False,
            "familyTournament": False,
            "sameRunRetuning": False,
            "v4GateRelaxation": False,
            "post20260701DataUsed": False,
            "freshOosRequiredBeforeAnyLiveUse": True,
        },
        "historicalCandidates": candidates,
        "symbols": symbols,
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    (root / "funding-crowding-release-v5.json").write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    with (root / "funding-crowding-release-v5-trades.jsonl").open("w", encoding="utf-8") as fh:
        for s in TRADE_SYMBOLS:
            for label in ("development", "validation", "evaluation"):
                for r in simulate(s, candles, index, fby, *PERIODS[label], NORMAL_BPS, 0):
                    row = dict(r); row["period"] = label
                    fh.write(json.dumps(row, sort_keys=True) + "\n")
    lines = ["# Funding Crowding Release V5", "", f"Historical candidates: {', '.join(candidates) if candidates else 'NONE'}", ""]
    for s in TRADE_SYMBOLS:
        r = symbols[s]; c = r["combined3Y"]; cs = r["combined3YStress"]
        lines.append(f"- {s} {ARCH[s]}: gate={r['historicalCandidateGate']} trades={c['trades']} return={c['returnPct']:.2f}% PF={c['pf']} PFwo={c['pfWithoutBest']} DD={c['maxDDPct']:.2f}% stressPF={cs['pf']} positiveYears={r['positiveYears']}/3")
    lines += ["", "Research-only. V4 frozen failed. SOL V3 frozen. Fresh post-2026-07-01 OOS not read."]
    (root / "funding-crowding-release-v5.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
