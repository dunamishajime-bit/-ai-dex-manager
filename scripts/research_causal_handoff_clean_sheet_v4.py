"""Causal Handoff Clean-sheet V4 for failed non-SOL pairs.

Research only. Production/VPS/LIVE/order paths are untouched.
SOL V3 remains frozen and is deliberately excluded from this research line.
The untouched post-2026-07-01 window is NOT read here.

Predeclared one-architecture-per-pair structures:
- ETH: BTC impulse -> ETH lag catch-up.
- LINK: ETH impulse -> LINK lag catch-up.
- BNB: residual dislocation -> short-horizon snapback.
- AVAX: synchronized BTC/ETH impulse -> AVAX lag catch-up.

No parameter grid, no family tournament, no same-run retuning, no use of
2025-26 evaluation for selection. Development/validation alone decide whether
a pair earns the right to consume fresh OOS later.
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
NORMAL_BPS = 10.0
STRESS_BPS = 30.0
STRESS_DELAY = 1
TRADE_SYMBOLS = ("ETH", "LINK", "BNB", "AVAX")
ARCH = {
    "ETH": "BTC_TO_ETH_HANDOFF_12H",
    "LINK": "ETH_TO_LINK_HANDOFF_18H",
    "BNB": "MARKET_RESIDUAL_SNAPBACK_8H",
    "AVAX": "SYNCHRONIZED_MARKET_CATCHUP_12H",
}
PERIODS = dict(base.PERIODS)
RISK = {s: float(base.RISK[s]) for s in TRADE_SYMBOLS}


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
        "longContributionPctPoints": sum(float(r["netReturnPct"]) for r in records if r["side"] == "LONG"),
        "shortContributionPctPoints": sum(float(r["netReturnPct"]) for r in records if r["side"] == "SHORT"),
    }


def expected_move(vol_annual_pct: float, bars: int) -> float:
    return max(1e-9, float(vol_annual_pct) * math.sqrt(float(bars) / (24.0 * 365.0)))


def raw_ret(candles, index, symbol: str, ts: int, bars: int) -> float | None:
    i = index[symbol].get(int(ts))
    if i is None:
        return None
    return base.v109.ret(candles[symbol], i, bars)


def norm_ret(candles, index, symbol: str, ts: int, bars: int) -> float | None:
    i = index[symbol].get(int(ts))
    if i is None or i < max(900, bars + 168):
        return None
    vol = base.v109.b.vol(candles[symbol], i, 168)
    r = base.v109.ret(candles[symbol], i, bars)
    if vol is None or r is None or vol <= 1e-9:
        return None
    return float(r) / expected_move(float(vol), bars)


def feature(symbol: str, candles, index, ts: int) -> dict[str, float] | None:
    x = base._ctx(symbol, candles, index, ts)
    if x is None:
        return None
    btc3 = norm_ret(candles, index, "BTC", ts, 3)
    btc12 = norm_ret(candles, index, "BTC", ts, 12)
    btc24 = norm_ret(candles, index, "BTC", ts, 24)
    eth3 = norm_ret(candles, index, "ETH", ts, 3)
    eth12 = norm_ret(candles, index, "ETH", ts, 12)
    eth24 = norm_ret(candles, index, "ETH", ts, 24)
    if None in (btc3, btc12, btc24, eth3, eth12, eth24):
        return None
    out = dict(x)
    out.update({
        "btcZ3": float(btc3), "btcZ12": float(btc12), "btcZ24": float(btc24),
        "ethZ3": float(eth3), "ethZ12": float(eth12), "ethZ24": float(eth24),
    })
    if symbol == "BNB":
        bnb24 = raw_ret(candles, index, "BNB", ts, 24)
        br24 = raw_ret(candles, index, "BTC", ts, 24)
        er24 = raw_ret(candles, index, "ETH", ts, 24)
        i = index["BNB"].get(int(ts))
        vol = base.v109.b.vol(candles["BNB"], i, 168) if i is not None else None
        if None in (bnb24, br24, er24, vol) or float(vol) <= 1e-9:
            return None
        resid = float(bnb24) - 0.55 * float(br24) - 0.45 * float(er24)
        out["marketResidual24"] = resid / expected_move(float(vol), 24)
    return out


def signal(symbol: str, x: dict[str, float]) -> int | None:
    # Thresholds are predeclared once for this V4 line. No per-symbol grid.
    if symbol == "ETH":
        leader = x["btcZ12"]
        side = 1 if leader >= 0.90 else -1 if leader <= -0.90 else 0
        if side == 0:
            return None
        # BTC already moved; ETH is aligned but still lagging, and its 3h tape has turned.
        if not (0.05 <= side * x["z12"] <= 0.70):
            return None
        if side * x["z3"] < 0.18:
            return None
        if side * (x["z12"] - leader) > -0.20:
            return None
        if not (0.12 <= x["eff"] <= 0.42):
            return None
        if (side > 0 and x["breadth"] < 0.50) or (side < 0 and x["breadth"] > 0.50):
            return None
        return side

    if symbol == "LINK":
        leader = x["ethZ12"]
        side = 1 if leader >= 0.95 else -1 if leader <= -0.95 else 0
        if side == 0:
            return None
        if not (-0.10 <= side * x["z12"] <= 0.60):
            return None
        if side * x["z3"] < 0.15 or side * x["z6"] < 0.10:
            return None
        if side * (x["z12"] - leader) > -0.25:
            return None
        if x["vr"] > 1.35 or x["eff"] > 0.45:
            return None
        if (side > 0 and x["breadth"] < 0.50) or (side < 0 and x["breadth"] > 0.50):
            return None
        return side

    if symbol == "BNB":
        resid = x.get("marketResidual24", 0.0)
        side = 1 if resid <= -1.20 else -1 if resid >= 1.20 else 0
        if side == 0:
            return None
        # Trade only after the BNB tape begins reverting toward the market component.
        if side * x["z3"] < 0.20:
            return None
        if abs(x["btcZ12"]) > 1.80 or abs(x["ethZ12"]) > 1.80:
            return None
        if x["vr"] > 1.50 or x["eff"] > 0.38:
            return None
        return side

    if symbol == "AVAX":
        if x["btcZ12"] >= 0.70 and x["ethZ12"] >= 0.70:
            side = 1
        elif x["btcZ12"] <= -0.70 and x["ethZ12"] <= -0.70:
            side = -1
        else:
            return None
        # Market leaders agree while AVAX is still lagging, then AVAX turns with them.
        if not (-0.15 <= side * x["z12"] <= 0.55):
            return None
        if side * x["z3"] < 0.18:
            return None
        if side > 0 and x["breadth"] < 0.60:
            return None
        if side < 0 and x["breadth"] > 0.40:
            return None
        if x["vr"] > 1.40:
            return None
        return side
    return None


def lifecycle(symbol: str, side: int, x: dict[str, float], held: int, current_pct: float) -> str | None:
    maxhold = {"ETH": 12, "LINK": 18, "BNB": 8, "AVAX": 12}[symbol]
    if held >= 4 and (current_pct <= 0 or side * x["z3"] <= 0):
        return "HANDOFF_INVALIDATED" if symbol != "BNB" else "SNAPBACK_INVALIDATED"
    if held >= maxhold:
        return "HANDOFF_FIXED_CAPTURE" if symbol != "BNB" else "SNAPBACK_FIXED_CAPTURE"
    return None


def simulate(symbol: str, candles, index, start: int, end: int, cost_bps: float, delay_bars: int) -> list[dict[str, Any]]:
    c = candles[symbol]
    records: list[dict[str, Any]] = []
    position: dict[str, Any] | None = None
    cooldown_until = -1

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
            "grossReturnPct": gross,
            "netReturnPct": net,
            "mfePct": mfe,
            "maePct": mae,
            "holdingHours": max(0, int((int(c[xi]["ts"]) - int(position["entryTs"])) // HOUR)),
            "exitReason": reason,
        })
        cooldown_until = int(c[xi]["ts"]) + 6 * HOUR
        position = None

    for row in c:
        ts = int(row["ts"])
        if not (start <= ts < end):
            continue
        x = feature(symbol, candles, index, ts)
        if x is None:
            continue
        i = int(x["i"])
        if position is not None:
            held = int((ts - int(position["entryTs"])) // HOUR)
            side = int(position["side"])
            current_pct = side * (float(row["close"]) / float(position["entryPrice"]) - 1.0) * 100.0
            reason = lifecycle(symbol, side, x, held, current_pct)
            if reason is not None:
                close_position(ts, reason)
                continue
        if position is not None or ts < cooldown_until:
            continue
        side = signal(symbol, x)
        if side is None:
            continue
        ei = i + 1 + delay_bars
        if ei >= len(c) or int(c[ei]["ts"]) >= end:
            continue
        position = {
            "side": int(side),
            "signalTs": ts,
            "entryTs": int(c[ei]["ts"]),
            "entryPrice": float(c[ei]["open"]),
            "entryIndex": ei,
        }
    if position is not None:
        final_ts = max(int(r["ts"]) for r in c if start <= int(r["ts"]) < end)
        close_position(final_ts, "PERIOD_END", period_end=True)
    return records


def evaluate_symbol(symbol: str, candles, index) -> dict[str, Any]:
    out: dict[str, Any] = {"architecture": ARCH[symbol], "periods": {}}
    for label in ("development", "validation", "evaluation"):
        start, end = PERIODS[label]
        normal = simulate(symbol, candles, index, start, end, NORMAL_BPS, 0)
        stress = simulate(symbol, candles, index, start, end, STRESS_BPS, STRESS_DELAY)
        out["periods"][label] = metric(normal)
        out["periods"][label + "Stress"] = metric(stress)
    normal3 = simulate(symbol, candles, index, *PERIODS["combined"], NORMAL_BPS, 0)
    stress3 = simulate(symbol, candles, index, *PERIODS["combined"], STRESS_BPS, STRESS_DELAY)
    out["combined3Y"] = metric(normal3)
    out["combined3YStress"] = metric(stress3)
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
    candles, index, _ = base.v109.b.base.load()
    symbols = {s: evaluate_symbol(s, candles, index) for s in TRADE_SYMBOLS}
    candidates = [s for s in TRADE_SYMBOLS if symbols[s]["historicalCandidateGate"]]
    out = {
        "researchLine": "CAUSAL_HANDOFF_CLEAN_SHEET_V4",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "solV3Frozen": True,
        "freshOosRead": False,
        "freshOosStartReserved": base.END_2026,
        "selectionUses": ["2023-24 development", "2024-25 validation"],
        "evaluation2025_26UsedForSelection": False,
        "architectures": ARCH,
        "antiOverfit": {
            "oneArchitecturePerPair": True,
            "parameterGrid": False,
            "familyTournament": False,
            "sameRunRetuning": False,
            "v3ThresholdPatch": False,
            "post20260701DataUsed": False,
            "freshOosRequiredBeforeAnyLiveUse": True,
        },
        "historicalCandidates": candidates,
        "symbols": symbols,
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    (root / "causal-handoff-clean-sheet-v4.json").write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    trades_path = root / "causal-handoff-clean-sheet-v4-trades.jsonl"
    with trades_path.open("w", encoding="utf-8") as fh:
        for s in TRADE_SYMBOLS:
            for label in ("development", "validation", "evaluation"):
                for r in simulate(s, candles, index, *PERIODS[label], NORMAL_BPS, 0):
                    row = dict(r); row["period"] = label
                    fh.write(json.dumps(row, sort_keys=True) + "\n")
    lines = ["# Causal Handoff Clean-sheet V4", "", f"Historical candidates: {', '.join(candidates) if candidates else 'NONE'}", ""]
    for s in TRADE_SYMBOLS:
        r = symbols[s]
        c = r["combined3Y"]
        lines.append(f"- {s} {ARCH[s]}: gate={r['historicalCandidateGate']} trades={c['trades']} return={c['returnPct']:.2f}% PF={c['pf']} PFwo={c['pfWithoutBest']} DD={c['maxDDPct']:.2f}% positiveYears={r['positiveYears']}/3")
    lines += ["", "Research-only. SOL V3 frozen. Fresh post-2026-07-01 OOS not read."]
    (root / "causal-handoff-clean-sheet-v4.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
