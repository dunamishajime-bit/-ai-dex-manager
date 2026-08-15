"""Diagnosis-driven Clean-sheet V2 research harness.

Research only. No production/VPS/LIVE/order changes. V2 does not call the V1
signal or exit functions. It uses raw causal context features and two newly
predeclared event architectures derived from the 3Y failure diagnosis:

* OWNERSHIP_CONFIRMATION: impulse -> arm -> delayed follow-through confirmation.
* SHOCK_REVERSION_CAPTURE: volatility shock -> reversal confirmation -> fast capture.

No parameter grid, no same-run retuning, CASH is allowed.
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
SYMBOL_ARCH = {
    "SOL": "OWNERSHIP_CONFIRMATION",
    "LINK": "OWNERSHIP_CONFIRMATION",
    "ETH": "SHOCK_REVERSION_CAPTURE",
    "BNB": "SHOCK_REVERSION_CAPTURE",
    "AVAX": "CASH",
}

_raw_ctx = base._ctx
_cache: dict[tuple[str, int], dict[str, float] | None] = {}


def ctx(symbol: str, candles, index, ts: int):
    key = (symbol, int(ts))
    if key not in _cache:
        _cache[key] = _raw_ctx(symbol, candles, index, int(ts))
    return _cache[key]


def pf(values: list[float]) -> float | None:
    gains = sum(x for x in values if x > 0)
    losses = abs(sum(x for x in values if x < 0))
    if losses <= 1e-12:
        return 999.0 if gains > 0 else None
    return gains / losses


def metric(records: list[dict[str, Any]]) -> dict[str, Any]:
    vals = [float(r["netReturnPct"]) for r in records]
    eq = 1.0; peak = 1.0; dd = 0.0
    for x in vals:
        eq *= max(0.001, 1.0 + x / 100.0)
        peak = max(peak, eq)
        dd = min(dd, (eq / peak - 1.0) * 100.0)
    if vals:
        bi = max(range(len(vals)), key=vals.__getitem__)
        wo = vals[:bi] + vals[bi + 1:]
    else:
        wo = []
    return {
        "trades": len(vals),
        "returnPct": (eq - 1.0) * 100.0,
        "pf": pf(vals),
        "pfWithoutBest": pf(wo),
        "winRatePct": 100.0 * sum(x > 0 for x in vals) / len(vals) if vals else None,
        "maxDDPct": dd,
        "medianTradePct": statistics.median(vals) if vals else None,
        "medianMfePct": statistics.median([float(r["mfePct"]) for r in records]) if records else None,
        "medianMaePct": statistics.median([float(r["maePct"]) for r in records]) if records else None,
        "medianHoldingHours": statistics.median([float(r["holdingHours"]) for r in records]) if records else None,
        "longContributionPctPoints": sum(float(r["netReturnPct"]) for r in records if r["side"] == "LONG"),
        "shortContributionPctPoints": sum(float(r["netReturnPct"]) for r in records if r["side"] == "SHORT"),
    }


def ownership_arm(x: dict[str, float]) -> int | None:
    # Global, non-symbol-specific diagnostic architecture bands.
    if not (0.20 < x["eff"] < 0.35):
        return None
    if x["z72"] >= 0.65 and x["z24"] >= 0.20 and x["rel24"] >= 0 and x["breadth"] >= 0.50:
        return 1
    if x["z72"] <= -0.65 and x["z24"] <= -0.20 and x["rel24"] <= 0 and x["breadth"] <= 0.50:
        return -1
    return None


def ownership_confirm(side: int, x: dict[str, float]) -> bool:
    return side * x["z3"] >= 0.15 and side * x["z6"] >= 0.10 and side * x["rr12"] >= 0


def shock_signal(x: dict[str, float]) -> int | None:
    if x["vr"] < 1.20 or x["eff"] > 0.30:
        return None
    if x["z24"] <= -1.40 and x["rp"] <= 0.25 and x["z3"] >= 0.20:
        return 1
    if x["z24"] >= 1.40 and x["rp"] >= 0.75 and x["z3"] <= -0.20:
        return -1
    return None


def exit_reason(arch: str, side: int, x: dict[str, float], held: int, current: float, mfe: float) -> str | None:
    capture = current / mfe if mfe > 1e-9 else 1.0
    if arch == "OWNERSHIP_CONFIRMATION":
        if held >= 3 and side * x["z3"] <= 0:
            return "OWNERSHIP_LOSS"
        if mfe >= 1.0 and capture < 0.60:
            return "OWNERSHIP_RELEASE"
        if held >= 12:
            return "OWNERSHIP_MAXHOLD"
    elif arch == "SHOCK_REVERSION_CAPTURE":
        if held >= 3 and current <= 0 and mfe < 0.50:
            return "SHOCK_EARLY_FAILURE"
        if mfe >= 0.75 and capture < 0.55:
            return "SHOCK_RELEASE"
        if held >= 6 and side * x["z6"] <= 0:
            return "SHOCK_REVERSION_END"
        if held >= 12:
            return "SHOCK_MAXHOLD"
    return None


def simulate(symbol: str, arch: str, candles, index, start: int, end: int, cost_bps: float, delay_bars: int) -> list[dict[str, Any]]:
    if arch == "CASH":
        return []
    c = candles[symbol]
    records: list[dict[str, Any]] = []
    pos: dict[str, Any] | None = None
    armed: dict[str, Any] | None = None
    cooldown_until = -1

    def close(ts: int, reason: str, period_end: bool = False) -> None:
        nonlocal pos, cooldown_until
        assert pos is not None
        i = index[symbol].get(int(ts))
        if i is None:
            return
        xi = i if period_end else i + 1 + delay_bars
        if xi >= len(c) or int(c[xi]["ts"]) >= end:
            xi = i
            xp = float(c[i]["close"])
        else:
            xp = float(c[xi]["open"])
        side = int(pos["side"]); entry = float(pos["entryPrice"])
        gross = side * (xp / entry - 1.0) * 100.0
        net = (gross - cost_bps / 100.0) * base.RISK[symbol]
        lo = int(pos["entryIndex"]); rows = c[min(lo, xi):max(lo, xi)+1]
        if side > 0:
            mfe = (max(float(r["high"]) for r in rows) / entry - 1.0) * 100.0
            mae = (min(float(r["low"]) for r in rows) / entry - 1.0) * 100.0
        else:
            mfe = (entry / min(float(r["low"]) for r in rows) - 1.0) * 100.0
            mae = (entry / max(float(r["high"]) for r in rows) - 1.0) * 100.0
        records.append({
            "symbol": symbol, "architecture": arch, "side": "LONG" if side > 0 else "SHORT", "sideSign": side,
            "signalTs": int(pos["signalTs"]), "entryTs": int(pos["entryTs"]), "exitTs": int(c[xi]["ts"]),
            "entryPrice": entry, "exitPrice": xp, "grossReturnPct": gross, "netReturnPct": net,
            "mfePct": mfe, "maePct": mae, "holdingHours": max(0, int((int(c[xi]["ts"]) - int(pos["entryTs"])) // HOUR)),
            "exitReason": reason,
        })
        cooldown_until = int(c[xi]["ts"]) + 6 * HOUR
        pos = None

    for row in c:
        ts = int(row["ts"])
        if not (start <= ts < end):
            continue
        x = ctx(symbol, candles, index, ts)
        if x is None:
            continue
        i = int(x["i"])
        if pos is not None:
            held = int((ts - int(pos["entryTs"])) // HOUR)
            side = int(pos["side"]); px = float(row["close"])
            current = side * (px / float(pos["entryPrice"]) - 1.0) * 100.0
            if side > 0:
                pos["peak"] = max(float(pos["peak"]), float(row["high"]))
                mfe = (float(pos["peak"]) / float(pos["entryPrice"]) - 1.0) * 100.0
            else:
                pos["trough"] = min(float(pos["trough"]), float(row["low"]))
                mfe = (float(pos["entryPrice"]) / float(pos["trough"]) - 1.0) * 100.0
            reason = exit_reason(arch, side, x, held, current, mfe)
            if reason:
                close(ts, reason)
                continue
        if pos is not None or ts < cooldown_until:
            continue

        side: int | None = None
        signal_ts = ts
        if arch == "OWNERSHIP_CONFIRMATION":
            if armed is not None:
                age = int((ts - int(armed["ts"])) // HOUR)
                if age > 6:
                    armed = None
                elif age >= 3 and ownership_confirm(int(armed["side"]), x):
                    side = int(armed["side"]); signal_ts = int(armed["ts"]); armed = None
            if side is None and armed is None:
                candidate = ownership_arm(x)
                if candidate is not None:
                    armed = {"side": candidate, "ts": ts}
                continue
            if side is None:
                continue
        else:
            side = shock_signal(x)
            if side is None:
                continue

        ei = i + 1 + delay_bars
        if ei >= len(c) or int(c[ei]["ts"]) >= end:
            continue
        ep = float(c[ei]["open"])
        pos = {"side": int(side), "signalTs": signal_ts, "entryTs": int(c[ei]["ts"]), "entryPrice": ep, "entryIndex": ei, "peak": ep, "trough": ep}

    if pos is not None:
        final_ts = max(int(r["ts"]) for r in c if start <= int(r["ts"]) < end)
        close(final_ts, "PERIOD_END", period_end=True)
    return records


def half_year_periods() -> list[tuple[str, int, int]]:
    points = [
        ("2023H2", base.hist.jst08(2023,7,1), base.hist.jst08(2024,1,1)),
        ("2024H1", base.hist.jst08(2024,1,1), base.hist.jst08(2024,7,1)),
        ("2024H2", base.hist.jst08(2024,7,1), base.hist.jst08(2025,1,1)),
        ("2025H1", base.hist.jst08(2025,1,1), base.hist.jst08(2025,7,1)),
        ("2025H2", base.hist.jst08(2025,7,1), base.hist.jst08(2026,1,1)),
        ("2026H1", base.hist.jst08(2026,1,1), base.hist.jst08(2026,7,1)),
    ]
    return points


def candidate_gate(combined: dict[str, Any], stress: dict[str, Any], annual: dict[str, Any], halves: dict[str, Any]) -> dict[str, Any]:
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
    return {"status": "FORWARD_PAPER_CANDIDATE" if passed else "RESEARCH_ONLY_NOT_READY", "positiveYears": positive_years, "positiveHalfYears": positive_halves}


def main() -> None:
    candles, index, _ = base.v109.b.base.load()
    results: dict[str, Any] = {}
    all_records: list[dict[str, Any]] = []
    for symbol, arch in SYMBOL_ARCH.items():
        annual: dict[str, Any] = {}
        for label in ("development", "validation", "evaluation"):
            start, end = base.PERIODS[label]
            n = simulate(symbol, arch, candles, index, start, end, NORMAL_BPS, 0)
            s = simulate(symbol, arch, candles, index, start, end, STRESS_BPS, STRESS_DELAY)
            annual[label] = {"normal": metric(n), "stress": metric(s)}
            for r in n: r.update({"period": label, "mode": "NORMAL"}); all_records.append(r)
            for r in s: r.update({"period": label, "mode": "STRESS"}); all_records.append(r)
        halves: dict[str, Any] = {}
        for label, start, end in half_year_periods():
            n = simulate(symbol, arch, candles, index, start, end, NORMAL_BPS, 0)
            s = simulate(symbol, arch, candles, index, start, end, STRESS_BPS, STRESS_DELAY)
            halves[label] = {"normal": metric(n), "stress": metric(s)}
        n3 = simulate(symbol, arch, candles, index, base.START_2023, base.END_2026, NORMAL_BPS, 0)
        s3 = simulate(symbol, arch, candles, index, base.START_2023, base.END_2026, STRESS_BPS, STRESS_DELAY)
        cm, sm = metric(n3), metric(s3)
        results[symbol] = {
            "architecture": arch,
            "annual": annual,
            "halfYears": halves,
            "combined3Y": cm,
            "combined3YStress": sm,
            "gate": candidate_gate(cm, sm, annual, halves),
            "exitReasonSummary": {
                reason: metric([r for r in n3 if r["exitReason"] == reason])
                for reason in sorted({r["exitReason"] for r in n3})
            },
        }

    out = {
        "researchLine": "DIAGNOSIS_DRIVEN_CLEAN_SHEET_V2",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "sourceDiagnosisRun": 31888548981,
        "antiOverfit": {
            "usesV1SignalFunction": False,
            "usesV1ExitFunction": False,
            "parameterGrid": False,
            "sameRunRetuning": False,
            "perSymbolThresholdGrid": False,
            "architecturesPredeclared": ["OWNERSHIP_CONFIRMATION", "SHOCK_REVERSION_CAPTURE", "CASH"],
            "threeYearsAreDiagnosisEvidenceNotFreshOOS": True,
            "forwardPaperRequiredBeforeAnyLiveUse": True,
        },
        "symbolArchitecture": SYMBOL_ARCH,
        "results": results,
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    (root / "clean-sheet-v2-rebuild.json").write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    with (root / "clean-sheet-v2-rebuild-trades.jsonl").open("w", encoding="utf-8") as fh:
        for r in all_records:
            fh.write(json.dumps(r, sort_keys=True) + "\n")
    lines = ["# Diagnosis-driven Clean-sheet V2", "", "Research only. No production/VPS/LIVE changes.", ""]
    for symbol in base.TRADE_SYMBOLS:
        r = results[symbol]; m = r["combined3Y"]; st = r["combined3YStress"]
        lines.append(f"- {symbol}: {r['architecture']} | {r['gate']['status']} | trades={m['trades']} return={m['returnPct']:.2f}% PF={m['pf']} PFwoBest={m['pfWithoutBest']} stressPF={st['pf']} positiveYears={r['gate']['positiveYears']}/3 positiveHalves={r['gate']['positiveHalfYears']}/6")
    (root / "clean-sheet-v2-rebuild.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "gates": {s: results[s]["gate"] for s in results}}, indent=2))


if __name__ == "__main__":
    main()
