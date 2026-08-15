"""Pair-specific Clean-sheet V3 derived from frozen 3Y diagnosis evidence.

Research only. This is not a V2 threshold patch and does not modify production,
VPS, LIVE, or order code. Three historical years are diagnosis evidence, not
fresh OOS. Any historical pass is only eligible for forward paper validation.

Predeclared pair structures:
- SOL: contraction -> re-acceleration capture.
- LINK: mixed-structure trend capture with early invalidation.
- ETH: strict extreme reversion with short fixed lifecycle.
- BNB: strict extreme reversion with longer fixed lifecycle.
- AVAX: CASH.

No parameter grid, no same-run retuning, no V1/V2 signal or exit calls.
"""
from __future__ import annotations

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

SYMBOL_ARCH = {
    "SOL": "CONTRACTION_REACCEL_CAPTURE",
    "LINK": "MIXED_TREND_CAPTURE",
    "ETH": "EXTREME_REVERSION_6H",
    "BNB": "EXTREME_REVERSION_12H",
    "AVAX": "CASH",
}

_raw_ctx = base._ctx
_ctx_cache: dict[tuple[str, int], dict[str, float] | None] = {}


def ctx(symbol: str, candles, index, ts: int):
    key = (str(symbol), int(ts))
    if key not in _ctx_cache:
        _ctx_cache[key] = _raw_ctx(symbol, candles, index, int(ts))
    return _ctx_cache[key]


def pf(values: list[float]) -> float | None:
    gains = sum(x for x in values if x > 0)
    losses = abs(sum(x for x in values if x < 0))
    if losses <= 1e-12:
        return 999.0 if gains > 0 else None
    return gains / losses


def metric(records: list[dict[str, Any]]) -> dict[str, Any]:
    vals = [float(r["netReturnPct"]) for r in records]
    eq = 1.0
    peak = 1.0
    dd = 0.0
    for value in vals:
        eq *= max(0.001, 1.0 + value / 100.0)
        peak = max(peak, eq)
        dd = min(dd, (eq / peak - 1.0) * 100.0)
    if vals:
        best = max(range(len(vals)), key=vals.__getitem__)
        wo = vals[:best] + vals[best + 1:]
    else:
        wo = []
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


def supportive_breadth(side: int, breadth: float) -> bool:
    return breadth >= 0.50 if side > 0 else breadth <= 0.50


def signal(symbol: str, arch: str, x: dict[str, float], prev6: dict[str, float] | None) -> int | None:
    if arch == "CONTRACTION_REACCEL_CAPTURE":
        if prev6 is None or not (0.18 < x["eff"] < 0.35) or x["vr"] > 0.90:
            return None
        side = 1 if x["z168"] >= 0.70 else -1 if x["z168"] <= -0.70 else 0
        if side == 0:
            return None
        if side * prev6["z6"] > 0:
            return None
        if side * x["z6"] < 0.10 or side * x["z12"] < 0.15:
            return None
        if not supportive_breadth(side, x["breadth"]):
            return None
        return side

    if arch == "MIXED_TREND_CAPTURE":
        if not (0.20 < x["eff"] < 0.35):
            return None
        side = 1 if x["z72"] >= 0.80 else -1 if x["z72"] <= -0.80 else 0
        if side == 0:
            return None
        if side * x["z24"] < 0.35 or side * x["z6"] <= 0 or side * x["rel24"] < 0:
            return None
        if side * x["btcZ72"] < -0.50:
            return None
        if not supportive_breadth(side, x["breadth"]):
            return None
        return side

    if arch in ("EXTREME_REVERSION_6H", "EXTREME_REVERSION_12H"):
        if x["vr"] < 1.25 or x["eff"] > 0.30:
            return None
        if x["z24"] <= -1.50 and x["z3"] >= 0.25 and x["rp"] <= 0.20:
            return 1
        if x["z24"] >= 1.50 and x["z3"] <= -0.25 and x["rp"] >= 0.80:
            return -1
    return None


def exit_reason(arch: str, side: int, x: dict[str, float], held: int, current_pct: float) -> str | None:
    if arch == "CONTRACTION_REACCEL_CAPTURE":
        if held >= 3 and (current_pct <= 0 or side * x["z3"] <= 0):
            return "REACCEL_INVALIDATED"
        if held >= 6:
            return "REACCEL_FIXED_CAPTURE"
    elif arch == "MIXED_TREND_CAPTURE":
        if held >= 3 and (current_pct <= 0 or side * x["z3"] <= 0):
            return "MIXED_TREND_INVALIDATED"
        if held >= 12:
            return "MIXED_TREND_FIXED_CAPTURE"
    elif arch == "EXTREME_REVERSION_6H":
        if held >= 3 and current_pct <= 0 and side * x["z3"] <= 0:
            return "REVERSION_EARLY_FAILURE"
        if held >= 6:
            return "REVERSION_6H_CAPTURE"
    elif arch == "EXTREME_REVERSION_12H":
        if held >= 3 and current_pct <= 0 and side * x["z3"] <= 0:
            return "REVERSION_EARLY_FAILURE"
        if held >= 12:
            return "REVERSION_12H_CAPTURE"
    return None


def simulate(symbol: str, arch: str, candles, index, start: int, end: int,
             cost_bps: float, delay_bars: int) -> list[dict[str, Any]]:
    if arch == "CASH":
        return []
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
        net = (gross - cost_bps / 100.0) * base.RISK[symbol]
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
            "architecture": arch,
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
        x = ctx(symbol, candles, index, ts)
        if x is None:
            continue
        i = int(x["i"])

        if position is not None:
            held = int((ts - int(position["entryTs"])) // HOUR)
            side = int(position["side"])
            current_pct = side * (float(row["close"]) / float(position["entryPrice"]) - 1.0) * 100.0
            reason = exit_reason(arch, side, x, held, current_pct)
            if reason is not None:
                close_position(ts, reason)
                continue

        if position is not None or ts < cooldown_until:
            continue

        prev6 = ctx(symbol, candles, index, ts - 6 * HOUR)
        side = signal(symbol, arch, x, prev6)
        if side is None:
            continue
        ei = i + 1 + delay_bars
        if ei >= len(c) or int(c[ei]["ts"]) >= end:
            continue
        entry_price = float(c[ei]["open"])
        position = {
            "side": int(side),
            "signalTs": ts,
            "entryTs": int(c[ei]["ts"]),
            "entryPrice": entry_price,
            "entryIndex": ei,
        }

    if position is not None:
        final_ts = max(int(r["ts"]) for r in c if start <= int(r["ts"]) < end)
        close_position(final_ts, "PERIOD_END", period_end=True)
    return records


def half_year_periods() -> list[tuple[str, int, int]]:
    return [
        ("2023H2", base.hist.jst08(2023, 7, 1), base.hist.jst08(2024, 1, 1)),
        ("2024H1", base.hist.jst08(2024, 1, 1), base.hist.jst08(2024, 7, 1)),
        ("2024H2", base.hist.jst08(2024, 7, 1), base.hist.jst08(2025, 1, 1)),
        ("2025H1", base.hist.jst08(2025, 1, 1), base.hist.jst08(2025, 7, 1)),
        ("2025H2", base.hist.jst08(2025, 7, 1), base.hist.jst08(2026, 1, 1)),
        ("2026H1", base.hist.jst08(2026, 1, 1), base.hist.jst08(2026, 7, 1)),
    ]


def historical_gate(combined: dict[str, Any], stress: dict[str, Any], annual: dict[str, Any], halves: dict[str, Any]) -> dict[str, Any]:
    positive_years = sum((annual[p]["normal"].get("returnPct") or 0) > 0 for p in annual)
    positive_halves = sum((halves[p]["normal"].get("returnPct") or 0) > 0 for p in halves)
    passed = bool(
        combined.get("trades", 0) >= 24
        and (combined.get("pf") or 0) >= 1.10
        and (combined.get("pfWithoutBest") or 0) >= 0.95
        and (stress.get("pf") or 0) >= 0.90
        and positive_years >= 2
        and positive_halves >= 4
    )
    return {
        "status": "FORWARD_PAPER_CANDIDATE" if passed else "RESEARCH_ONLY_NOT_READY",
        "positiveYears": positive_years,
        "positiveHalfYears": positive_halves,
    }


def main() -> None:
    candles, index, _ = base.v109.b.base.load()
    results: dict[str, Any] = {}
    trade_rows: list[dict[str, Any]] = []

    for symbol, arch in SYMBOL_ARCH.items():
        annual: dict[str, Any] = {}
        for label in ("development", "validation", "evaluation"):
            start, end = base.PERIODS[label]
            normal = simulate(symbol, arch, candles, index, start, end, NORMAL_BPS, 0)
            stress = simulate(symbol, arch, candles, index, start, end, STRESS_BPS, STRESS_DELAY)
            annual[label] = {"normal": metric(normal), "stress": metric(stress)}
            for row in normal:
                row.update({"period": label, "mode": "NORMAL"})
                trade_rows.append(row)
            for row in stress:
                row.update({"period": label, "mode": "STRESS"})
                trade_rows.append(row)

        halves: dict[str, Any] = {}
        for label, start, end in half_year_periods():
            normal = simulate(symbol, arch, candles, index, start, end, NORMAL_BPS, 0)
            stress = simulate(symbol, arch, candles, index, start, end, STRESS_BPS, STRESS_DELAY)
            halves[label] = {"normal": metric(normal), "stress": metric(stress)}

        normal3 = simulate(symbol, arch, candles, index, base.START_2023, base.END_2026, NORMAL_BPS, 0)
        stress3 = simulate(symbol, arch, candles, index, base.START_2023, base.END_2026, STRESS_BPS, STRESS_DELAY)
        combined = metric(normal3)
        combined_stress = metric(stress3)
        results[symbol] = {
            "architecture": arch,
            "annual": annual,
            "halfYears": halves,
            "combined3Y": combined,
            "combined3YStress": combined_stress,
            "gate": historical_gate(combined, combined_stress, annual, halves),
            "exitReasonSummary": {
                reason: metric([r for r in normal3 if r["exitReason"] == reason])
                for reason in sorted({r["exitReason"] for r in normal3})
            },
        }

    output = {
        "researchLine": "PAIR_SPECIFIC_CLEAN_SHEET_V3",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "sourceDiagnosisRun": 31888548981,
        "sourceFailedV2Run": 31889249366,
        "antiOverfit": {
            "v2FrozenFailed": True,
            "v2ThresholdPatch": False,
            "usesV1SignalFunction": False,
            "usesV1ExitFunction": False,
            "usesV2SignalFunction": False,
            "usesV2ExitFunction": False,
            "parameterGrid": False,
            "sameRunRetuning": False,
            "threeYearsAreDiagnosisEvidenceNotFreshOOS": True,
            "forwardPaperRequiredBeforeAnyLiveUse": True,
        },
        "symbolArchitecture": SYMBOL_ARCH,
        "results": results,
    }

    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    (root / "pair-specific-clean-sheet-v3.json").write_text(json.dumps(output, indent=2, sort_keys=True), encoding="utf-8")
    with (root / "pair-specific-clean-sheet-v3-trades.jsonl").open("w", encoding="utf-8") as fh:
        for row in trade_rows:
            fh.write(json.dumps(row, sort_keys=True) + "\n")

    lines = ["# Pair-specific Clean-sheet V3", "", "Research only. Three years are diagnosis evidence, not fresh OOS.", ""]
    for symbol in base.TRADE_SYMBOLS:
        r = results[symbol]
        m = r["combined3Y"]
        st = r["combined3YStress"]
        lines.append(
            f"- {symbol}: {r['architecture']} | {r['gate']['status']} | trades={m['trades']} "
            f"return={m['returnPct']:.2f}% PF={m['pf']} PFwoBest={m['pfWithoutBest']} "
            f"stressPF={st['pf']} positiveYears={r['gate']['positiveYears']}/3 "
            f"positiveHalves={r['gate']['positiveHalfYears']}/6"
        )
    (root / "pair-specific-clean-sheet-v3.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "gates": {s: results[s]["gate"] for s in results}}, indent=2))


if __name__ == "__main__":
    main()
