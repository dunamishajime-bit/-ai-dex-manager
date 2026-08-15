"""Research-only three-year diagnosis for pairwise Clean-sheet V1.

This script does not modify entry/exit logic or production code. It replays the
frozen five-family Clean-sheet V1 over the same 2023-2026 research windows and
exports trade-level diagnostics needed to design a new Clean-sheet V2.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as core

HOUR = core.HOUR
FEATURES = ("z3", "z6", "z12", "z24", "z72", "z168", "vol168", "vr", "breadth", "eff", "rp", "rel24", "rel72", "btcZ72", "rr12", "rr48")
FWD_HOURS = (1, 3, 6, 12, 24)

_raw_ctx = core._ctx
_ctx_cache: dict[tuple[str, int], dict[str, float] | None] = {}


def _cached_ctx(symbol: str, candles, index, ts: int):
    key = (str(symbol), int(ts))
    if key not in _ctx_cache:
        _ctx_cache[key] = _raw_ctx(symbol, candles, index, int(ts))
    return _ctx_cache[key]


core._ctx = _cached_ctx


def _pf(values: list[float]) -> float | None:
    gains = sum(x for x in values if x > 0)
    losses = abs(sum(x for x in values if x < 0))
    if losses <= 1e-12:
        return 999.0 if gains > 0 else None
    return gains / losses


def _pf_without_best(values: list[float]) -> float | None:
    if not values:
        return None
    best = max(range(len(values)), key=values.__getitem__)
    return _pf(values[:best] + values[best + 1 :])


def _compound(values: list[float]) -> float:
    equity = 1.0
    for x in values:
        equity *= max(0.001, 1.0 + x / 100.0)
    return (equity - 1.0) * 100.0


def _median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def _quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    xs = sorted(values)
    if len(xs) == 1:
        return xs[0]
    pos = (len(xs) - 1) * q
    lo = int(math.floor(pos)); hi = int(math.ceil(pos))
    if lo == hi:
        return xs[lo]
    w = pos - lo
    return xs[lo] * (1.0 - w) + xs[hi] * w


def _regimes(ctx: dict[str, float]) -> dict[str, str]:
    btc = "BTC_BULL" if ctx["btcZ72"] > 0.50 else "BTC_BEAR" if ctx["btcZ72"] < -0.50 else "BTC_NEUTRAL"
    structure = "TREND" if ctx["eff"] >= 0.35 else "RANGE" if ctx["eff"] <= 0.20 else "MIXED"
    vol = "VOL_EXPANDING" if ctx["vr"] >= 1.10 else "VOL_CONTRACTING" if ctx["vr"] <= 0.90 else "VOL_NORMAL"
    breadth = "BREADTH_POS" if ctx["breadth"] > 0.60 else "BREADTH_NEG" if ctx["breadth"] < 0.40 else "BREADTH_MID"
    return {"btcRegime": btc, "marketStructure": structure, "volRegime": vol, "breadthRegime": breadth}


def _forward_returns(record: dict[str, Any], candles, index) -> dict[str, float | None]:
    symbol = str(record["symbol"])
    side = int(record["sideSign"])
    i = index[symbol].get(int(record["signalTs"]))
    if i is None:
        return {f"fwd{h}hPct": None for h in FWD_HOURS}
    c = candles[symbol]
    base = float(c[i]["close"])
    out: dict[str, float | None] = {}
    for h in FWD_HOURS:
        j = i + h
        if j >= len(c):
            out[f"fwd{h}hPct"] = None
        else:
            out[f"fwd{h}hPct"] = side * (float(c[j]["close"]) / base - 1.0) * 100.0
    return out


def _decorate(record: dict[str, Any], period: str, mode: str, candles, index) -> dict[str, Any]:
    out = dict(record)
    out["period"] = period
    out["mode"] = mode
    out["holdingHours"] = max(0, int((int(record["exitTs"]) - int(record["entryTs"])) // HOUR))
    ctx = core._ctx(str(record["symbol"]), candles, index, int(record["signalTs"]))
    if ctx is not None:
        out["entryContext"] = {k: float(ctx[k]) for k in FEATURES}
        out.update(_regimes(ctx))
    else:
        out["entryContext"] = None
        out.update({"btcRegime": "UNKNOWN", "marketStructure": "UNKNOWN", "volRegime": "UNKNOWN", "breadthRegime": "UNKNOWN"})
    out.update(_forward_returns(record, candles, index))
    if float(record["netReturnPct"]) < 0:
        fwd_early = [out.get("fwd1hPct"), out.get("fwd3hPct"), out.get("fwd6hPct")]
        finite = [float(x) for x in fwd_early if x is not None]
        immediate = bool(finite and max(finite) <= 0 and float(record["mfePct"]) < 0.75)
        giveback = bool(float(record["mfePct"]) >= 0.75)
        out["lossAttribution"] = "IMMEDIATE_ADVERSE" if immediate else "MFE_GIVEBACK" if giveback else "MIXED_ADVERSE"
    else:
        out["lossAttribution"] = "WINNER"
    return out


def _group_metric(records: list[dict[str, Any]]) -> dict[str, Any]:
    vals = [float(r["netReturnPct"]) for r in records]
    losers = [r for r in records if float(r["netReturnPct"]) < 0]
    return {
        "trades": len(records),
        "returnPct": _compound(vals),
        "pf": _pf(vals),
        "pfWithoutBest": _pf_without_best(vals),
        "winRatePct": 100.0 * sum(x > 0 for x in vals) / len(vals) if vals else None,
        "medianTradePct": _median(vals),
        "medianMfePct": _median([float(r["mfePct"]) for r in records]),
        "medianMaePct": _median([float(r["maePct"]) for r in records]),
        "medianHoldingHours": _median([float(r["holdingHours"]) for r in records]),
        "immediateAdverseLossPct": 100.0 * sum(r.get("lossAttribution") == "IMMEDIATE_ADVERSE" for r in losers) / len(losers) if losers else None,
        "mfeGivebackLossPct": 100.0 * sum(r.get("lossAttribution") == "MFE_GIVEBACK" for r in losers) / len(losers) if losers else None,
        "fwdMedianPct": {str(h): _median([float(r[f"fwd{h}hPct"]) for r in records if r.get(f"fwd{h}hPct") is not None]) for h in FWD_HOURS},
    }


def _side_metrics(records: list[dict[str, Any]]) -> dict[str, Any]:
    return {side: _group_metric([r for r in records if r["side"] == side]) for side in ("LONG", "SHORT")}


def _regime_metrics(records: list[dict[str, Any]], key: str) -> dict[str, Any]:
    values = sorted({str(r.get(key, "UNKNOWN")) for r in records})
    return {v: _group_metric([r for r in records if str(r.get(key, "UNKNOWN")) == v]) for v in values}


def _distribution(period_records: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    all_records = [r for rows in period_records.values() for r in rows if r.get("entryContext")]
    out: dict[str, Any] = {"features": {}, "driftFeatures": []}
    for feature in FEATURES:
        combined = [float(r["entryContext"][feature]) for r in all_records]
        q25 = _quantile(combined, 0.25); q75 = _quantile(combined, 0.75)
        scale = max(0.10, float(q75 - q25)) if q25 is not None and q75 is not None else 0.10
        med = {p: _median([float(r["entryContext"][feature]) for r in rows if r.get("entryContext")]) for p, rows in period_records.items()}
        dv = [x for p in ("development", "validation") for x in [med.get(p)] if x is not None]
        eval_med = med.get("evaluation")
        dv_med = statistics.fmean(dv) if dv else None
        shift = abs(float(eval_med) - float(dv_med)) / scale if eval_med is not None and dv_med is not None else None
        out["features"][feature] = {"medianByPeriod": med, "evaluationVsDvIqrShift": shift}
        if shift is not None and shift >= 1.0:
            out["driftFeatures"].append(feature)
    out["distributionDrift"] = len(out["driftFeatures"]) >= 2
    return out


def _classify(period_records: dict[str, list[dict[str, Any]]], stress_records: dict[str, list[dict[str, Any]]], distribution: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    normal_metrics = {p: _group_metric(rows) for p, rows in period_records.items()}
    combined = [r for rows in period_records.values() for r in rows]
    stress_combined = [r for rows in stress_records.values() for r in rows]
    cm = _group_metric(combined); sm = _group_metric(stress_combined)
    if len(combined) < 20:
        labels.append("SAMPLE_TOO_SMALL")
    positive_periods = sum((normal_metrics[p].get("returnPct") or 0) > 0 and (normal_metrics[p].get("pf") or 0) >= 1.0 for p in period_records)
    negative_periods = sum((normal_metrics[p].get("returnPct") or 0) <= 0 or (normal_metrics[p].get("pf") or 0) < 1.0 for p in period_records)
    if positive_periods == 0:
        labels.append("NO_ENTRY_EDGE")
    if positive_periods >= 1 and negative_periods >= 1:
        labels.append("REGIME_DEPENDENT_EDGE")
    if any((normal_metrics[p].get("pf") or 0) >= 1.05 and (normal_metrics[p].get("pfWithoutBest") or 0) < 0.95 for p in period_records):
        labels.append("BEST_TRADE_DEPENDENT")
    if (cm.get("pf") or 0) >= 1.0 and (sm.get("pf") or 0) < 0.90 and ((cm.get("pf") or 0) - (sm.get("pf") or 0)) >= 0.20:
        labels.append("COST_SENSITIVE")
    side = _side_metrics(combined)
    lp, sp = side["LONG"].get("pf") or 0, side["SHORT"].get("pf") or 0
    if side["LONG"]["trades"] >= 5 and side["SHORT"]["trades"] >= 5 and ((lp >= 1.05 and sp < 0.95) or (sp >= 1.05 and lp < 0.95)):
        labels.append("SIDE_SPECIFIC")
    losers = [r for r in combined if float(r["netReturnPct"]) < 0]
    if len(losers) >= 5:
        giveback_pct = 100.0 * sum(r.get("lossAttribution") == "MFE_GIVEBACK" for r in losers) / len(losers)
        if giveback_pct >= 35.0:
            labels.append("LIFECYCLE_GIVEBACK")
    if distribution.get("distributionDrift"):
        labels.append("DISTRIBUTION_DRIFT")
    if not labels:
        labels.append("NO_CLEAR_FAILURE")
    return labels


def main() -> None:
    candles, index, _ = core.v109.b.base.load()
    selections = {s: core._select_symbol(s, candles, index) for s in core.TRADE_SYMBOLS}
    all_trade_rows: list[dict[str, Any]] = []
    diagnosis: dict[str, Any] = {}

    for symbol in core.TRADE_SYMBOLS:
        diagnosis[symbol] = {"selectedFamilyV1": selections[symbol]["selectedFamily"], "families": {}}
        for family in core.FAMILIES:
            normal_by_period: dict[str, list[dict[str, Any]]] = {}
            stress_by_period: dict[str, list[dict[str, Any]]] = {}
            period_summary: dict[str, Any] = {}
            for period in ("development", "validation", "evaluation"):
                start, end = core.PERIODS[period]
                _, recs = core.simulate(symbol, family, candles, index, start, end, core.NORMAL_BPS, 0)
                _, srecs = core.simulate(symbol, family, candles, index, start, end, core.STRESS_BPS, core.STRESS_DELAY)
                normal = [_decorate(r, period, "NORMAL", candles, index) for r in recs]
                stress = [_decorate(r, period, "STRESS", candles, index) for r in srecs]
                normal_by_period[period] = normal
                stress_by_period[period] = stress
                all_trade_rows.extend(normal); all_trade_rows.extend(stress)
                period_summary[period] = {
                    "normal": _group_metric(normal),
                    "stress": _group_metric(stress),
                    "side": _side_metrics(normal),
                    "btcRegime": _regime_metrics(normal, "btcRegime"),
                    "marketStructure": _regime_metrics(normal, "marketStructure"),
                    "volRegime": _regime_metrics(normal, "volRegime"),
                }
            dist = _distribution(normal_by_period)
            combined = [r for p in normal_by_period.values() for r in p]
            diagnosis[symbol]["families"][family] = {
                "periods": period_summary,
                "combined": _group_metric(combined),
                "combinedSide": _side_metrics(combined),
                "combinedBtcRegime": _regime_metrics(combined, "btcRegime"),
                "combinedMarketStructure": _regime_metrics(combined, "marketStructure"),
                "combinedVolRegime": _regime_metrics(combined, "volRegime"),
                "distribution": dist,
                "failureClasses": _classify(normal_by_period, stress_by_period, dist),
            }

    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    summary = {
        "researchLine": "PAIRWISE_CLEAN_SHEET_3Y_DIAGNOSIS_V1",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "sourceCleanSheetSha": os.environ.get("SOURCE_CLEAN_SHEET_SHA", "1e8062de0cc1f99bcda2bf32d099ba0c8cf5e7d4"),
        "rules": {
            "thresholdSearch": False,
            "sameRunRetuning": False,
            "diagnosticBandsOnly": True,
            "btcReferenceOnly": True,
            "v2ImplementationIncluded": False,
        },
        "selectedFamiliesV1": {s: selections[s]["selectedFamily"] for s in core.TRADE_SYMBOLS},
        "diagnosis": diagnosis,
    }
    (root / "pairwise-clean-sheet-3y-diagnosis.json").write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
    with (root / "pairwise-clean-sheet-3y-trades.jsonl").open("w", encoding="utf-8") as fh:
        for row in all_trade_rows:
            fh.write(json.dumps(row, sort_keys=True) + "\n")

    lines = ["# Pairwise Clean-sheet 3Y Diagnosis", "", "Research-only; no LIVE/VPS/production changes; no threshold search or retuning.", "", "## Symbol / family failure classes", ""]
    for symbol in core.TRADE_SYMBOLS:
        lines.append(f"### {symbol} — V1 selected: {selections[symbol]['selectedFamily']}")
        for family in core.FAMILIES:
            row = diagnosis[symbol]["families"][family]
            cm = row["combined"]
            classes = ", ".join(row["failureClasses"])
            lines.append(f"- {family}: classes={classes}; trades={cm['trades']}; return={cm['returnPct']:.2f}%; PF={cm['pf'] if cm['pf'] is not None else 'NA'}; givebackLoss={cm['mfeGivebackLossPct']}")
        lines.append("")
    lines += ["## V2 design rule", "", "Use this artifact only to identify causal failure modes. Do not tune V1 thresholds to fit 2023-2026. Build V2 only after failure modes are frozen, then validate with anchored/purged walk-forward and forward paper evidence."]
    (root / "pairwise-clean-sheet-3y-diagnosis.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "tradesWritten": len(all_trade_rows), "selectedFamiliesV1": summary["selectedFamiliesV1"]}, indent=2))


if __name__ == "__main__":
    main()
