"""USD-M Metrics Mechanism Router V7.

Research-only clean-sheet line using a genuinely new information source:
Binance USD-M historical metrics (OI, crowding, taker-flow). It does not patch
V2-V6 price thresholds and never imports their signal/exit functions.

Anti-overfit protocol is fixed before metrics-strategy results are observed:
- Development: 2023-07 -> 2024-07. Four predeclared causal mechanisms are
  diagnosed and at most ONE mechanism per pair may be selected.
- Validation: 2024-07 -> 2025-07. Selected mechanism is frozen.
- Evaluation: 2025-07 -> 2026-07. Selected mechanism is frozen.
- Validation/Evaluation never participate in mechanism selection or threshold
  choice. No same-run retuning exists.
- Post-2026-07-01 Fresh OOS is not present in the metrics cache and is not read.
- Historical pass only grants permission for a separate one-shot Fresh OOS run;
  it never grants LIVE eligibility.

Signals are evaluated after an hourly candle closes, using the final 5-minute
metrics snapshot inside that same UTC candle hour, and entered on the next bar.
"""
from __future__ import annotations

import gzip
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
PAIRS = ("ETH", "BNB", "LINK", "AVAX")
METRIC_SYMBOL = {s: f"{s}USDT" for s in PAIRS}
METRICS_ROOT = Path(".cache/research-usdm-metrics-v1")
ROLL = 24 * 30

MECHANISMS = (
    "POSITION_BUILD_CONTINUATION",
    "DELEVERAGING_REVERSAL",
    "CROWD_SQUEEZE",
    "TOP_GLOBAL_DIVERGENCE",
)
HOLDS = {
    "POSITION_BUILD_CONTINUATION": 12,
    "DELEVERAGING_REVERSAL": 8,
    "CROWD_SQUEEZE": 8,
    "TOP_GLOBAL_DIVERGENCE": 12,
}
RISK = {s: float(base.RISK[s]) for s in PAIRS}

# Fixed, interpretable standardized event thresholds. No grid/search.
PRICE_BUILD_Z = 0.65
PRICE_SHOCK_Z = 0.90
OI_EXPAND_Z = 0.75
OI_CONTRACT_Z = -0.75
TAKER_ALIGN_Z = 0.75
TAKER_TURN_Z = 0.40
CROWD_EXTREME_Z = 1.25
SQUEEZE_OI_Z = -0.40
DIVERGENCE_Z = 1.25
DIVERGENCE_TAKER_Z = 0.50
MAX_ALIGNED_CROWD_Z = 1.75

DEV_MIN_TRADES = 12
DEV_MIN_PF = 1.15
DEV_MIN_PF_WO = 0.95
VAL_MIN_TRADES = 8
VAL_MIN_PF = 1.15
VAL_MIN_PF_WO = 1.00
EVAL_MIN_TRADES = 8
EVAL_MIN_PF = 1.05
EVAL_MIN_PF_WO = 0.90
STRESS_MIN_PF = 0.90


def pf(vals: list[float]) -> float | None:
    win = sum(v for v in vals if v > 0)
    loss = abs(sum(v for v in vals if v < 0))
    if loss <= 1e-12:
        return 999.0 if win > 0 else None
    return win / loss


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
        "maxDDPct": dd,
        "winRatePct": 100.0 * sum(v > 0 for v in vals) / len(vals) if vals else None,
        "medianTradePct": statistics.median(vals) if vals else None,
        "longContributionPctPoints": sum(float(r["netReturnPct"]) for r in records if r["sideSign"] > 0),
        "shortContributionPctPoints": sum(float(r["netReturnPct"]) for r in records if r["sideSign"] < 0),
    }


def load_metrics() -> tuple[dict[str, dict[int, dict[str, float]]], dict[str, Any]]:
    manifest = json.loads((METRICS_ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["researchOnly"] is True
    assert manifest["freshOosRead"] is False
    assert manifest["post20260701DataUsed"] is False
    assert manifest["freshOosBoundaryExclusiveMs"] == base.END_2026
    data: dict[str, dict[int, dict[str, float]]] = {}
    for pair in PAIRS:
        symbol = METRIC_SYMBOL[pair]
        with gzip.open(METRICS_ROOT / f"{symbol}.hourly.json.gz", "rt", encoding="utf-8") as fh:
            rows = json.load(fh)
        d = {int(r["hourTs"]): r for r in rows}
        if d and max(d) >= base.END_2026:
            raise RuntimeError(f"METRICS_FRESH_OOS_CONTAMINATION:{pair}:{max(d)}")
        data[pair] = d
    return data, manifest


def price_ret(candles, index, symbol: str, ts: int, bars: int) -> float | None:
    i = index[symbol].get(int(ts))
    if i is None or i < max(bars, 168):
        return None
    a = float(candles[symbol][i - bars]["close"])
    b = float(candles[symbol][i]["close"])
    if a <= 0:
        return None
    return (b / a - 1.0) * 100.0


def price_z(candles, index, symbol: str, ts: int, bars: int) -> float | None:
    i = index[symbol].get(int(ts))
    r = price_ret(candles, index, symbol, ts, bars)
    if i is None or r is None or i < 168:
        return None
    hourly = []
    c = candles[symbol]
    for j in range(i - 167, i + 1):
        a = float(c[j - 1]["close"]); b = float(c[j]["close"])
        if a > 0:
            hourly.append((b / a - 1.0) * 100.0)
    vol = statistics.pstdev(hourly) if len(hourly) > 30 else 0.0
    if vol <= 1e-9:
        return None
    return r / (vol * math.sqrt(float(bars)))


def safe_log_ratio(value: float) -> float | None:
    return math.log(value) if value > 1e-12 else None


def prefix_stats(values: list[float | None]):
    count = [0]; total = [0.0]; sq = [0.0]
    for value in values:
        if value is None or not math.isfinite(value):
            count.append(count[-1]); total.append(total[-1]); sq.append(sq[-1])
        else:
            count.append(count[-1] + 1); total.append(total[-1] + value); sq.append(sq[-1] + value * value)
    return count, total, sq


def window_z(value: float | None, i: int, stats, lookback: int = ROLL) -> float | None:
    if value is None or i < lookback:
        return None
    count, total, sq = stats
    lo = max(0, i - lookback)
    n = count[i] - count[lo]
    if n < int(lookback * 0.90):
        return None
    s = total[i] - total[lo]
    q = sq[i] - sq[lo]
    mean = s / n
    var = max(0.0, q / n - mean * mean)
    sd = math.sqrt(var)
    return (value - mean) / sd if sd > 1e-9 else 0.0


def build_metric_features(pair: str, metrics: dict[int, dict[str, float]]) -> dict[int, dict[str, float]]:
    hours = sorted(metrics)
    pos = {ts: i for i, ts in enumerate(hours)}
    oi6: list[float | None] = []
    taker: list[float | None] = []
    crowd: list[float | None] = []
    top_pos: list[float | None] = []
    divergence: list[float | None] = []
    for ts in hours:
        row = metrics[ts]
        prior = metrics.get(ts - 6 * HOUR)
        cur_oi = float(row["openInterest"])
        prev_oi = float(prior["openInterest"]) if prior else 0.0
        oi6.append(math.log(cur_oi / prev_oi) if cur_oi > 0 and prev_oi > 0 else None)
        t = safe_log_ratio(float(row["takerLongShortVol"]))
        g = safe_log_ratio(float(row["globalLongShort"]))
        p = safe_log_ratio(float(row["topTraderPositionLongShort"]))
        taker.append(t); crowd.append(g); top_pos.append(p)
        divergence.append((p - g) if p is not None and g is not None else None)
    stat_oi = prefix_stats(oi6); stat_taker = prefix_stats(taker); stat_crowd = prefix_stats(crowd); stat_div = prefix_stats(divergence)
    out: dict[int, dict[str, float]] = {}
    for i, ts in enumerate(hours):
        vals = {
            "oi6Z": window_z(oi6[i], i, stat_oi),
            "takerZ": window_z(taker[i], i, stat_taker),
            "crowdZ": window_z(crowd[i], i, stat_crowd),
            "divergenceZ": window_z(divergence[i], i, stat_div),
        }
        if all(v is not None and math.isfinite(v) for v in vals.values()):
            out[ts] = {k: float(v) for k, v in vals.items()}
    return out


def signal(mechanism: str, pz3: float, pz6: float, x: dict[str, float]) -> int | None:
    if mechanism == "POSITION_BUILD_CONTINUATION":
        side = 1 if pz6 >= PRICE_BUILD_Z else -1 if pz6 <= -PRICE_BUILD_Z else 0
        if side == 0 or x["oi6Z"] < OI_EXPAND_Z:
            return None
        if side * x["takerZ"] < TAKER_ALIGN_Z:
            return None
        if side * x["crowdZ"] > MAX_ALIGNED_CROWD_Z:
            return None
        return side

    if mechanism == "DELEVERAGING_REVERSAL":
        shock = 1 if pz6 >= PRICE_SHOCK_Z else -1 if pz6 <= -PRICE_SHOCK_Z else 0
        if shock == 0 or x["oi6Z"] > OI_CONTRACT_Z:
            return None
        side = -shock
        if side * x["takerZ"] < TAKER_TURN_Z:
            return None
        return side

    if mechanism == "CROWD_SQUEEZE":
        crowd_side = 1 if x["crowdZ"] >= CROWD_EXTREME_Z else -1 if x["crowdZ"] <= -CROWD_EXTREME_Z else 0
        if crowd_side == 0 or x["oi6Z"] > SQUEEZE_OI_Z:
            return None
        side = -crowd_side
        if side * pz3 < 0.30 or side * x["takerZ"] < TAKER_TURN_Z:
            return None
        return side

    if mechanism == "TOP_GLOBAL_DIVERGENCE":
        side = 1 if x["divergenceZ"] >= DIVERGENCE_Z else -1 if x["divergenceZ"] <= -DIVERGENCE_Z else 0
        if side == 0 or side * x["takerZ"] < DIVERGENCE_TAKER_Z:
            return None
        if x["oi6Z"] < 0.0:
            return None
        return side
    return None


def simulate(pair: str, mechanism: str, candles, index, features, start: int, end: int, cost_bps: float, delay: int) -> list[dict[str, Any]]:
    c = candles[pair]
    hold = HOLDS[mechanism]
    out: list[dict[str, Any]] = []
    blocked_until = -1
    for row in c:
        ts = int(row["ts"])
        if ts < start or ts >= end or ts < blocked_until:
            continue
        x = features.get(ts)
        if x is None:
            continue
        pz3 = price_z(candles, index, pair, ts, 3)
        pz6 = price_z(candles, index, pair, ts, 6)
        if pz3 is None or pz6 is None:
            continue
        side = signal(mechanism, pz3, pz6, x)
        if side is None:
            continue
        i = index[pair].get(ts)
        if i is None:
            continue
        ei = i + 1 + delay
        xi = ei + hold
        if xi >= len(c) or int(c[xi]["ts"]) >= end:
            continue
        entry = float(c[ei]["open"]); exit_price = float(c[xi]["open"])
        if entry <= 0:
            continue
        gross = side * (exit_price / entry - 1.0) * 100.0
        net = (gross - cost_bps / 100.0) * RISK[pair]
        out.append({
            "symbol": pair, "mechanism": mechanism,
            "side": "LONG" if side > 0 else "SHORT", "sideSign": side,
            "signalTs": ts, "entryTs": int(c[ei]["ts"]), "exitTs": int(c[xi]["ts"]),
            "holdingHours": hold, "grossReturnPct": gross, "netReturnPct": net,
            "priceZ3": pz3, "priceZ6": pz6, **x,
        })
        blocked_until = int(c[xi]["ts"]) + HOUR
    return out


def development_select(pair: str, candles, index, features) -> tuple[str | None, dict[str, Any]]:
    details: dict[str, Any] = {}
    eligible: list[tuple[float, int, str]] = []
    start, end = base.PERIODS["development"]
    for mechanism in MECHANISMS:
        records = simulate(pair, mechanism, candles, index, features, start, end, NORMAL_BPS, 0)
        m = metric(records)
        qualifies = bool(
            m["trades"] >= DEV_MIN_TRADES
            and m["returnPct"] > 0
            and (m["pf"] or 0) >= DEV_MIN_PF
            and (m["pfWithoutBest"] or 0) >= DEV_MIN_PF_WO
            and (m["medianTradePct"] or -999) > 0
        )
        details[mechanism] = {"metric": m, "eligible": qualifies}
        if qualifies:
            # Conservative deterministic selector: highest PF without best; then sample size; then fixed name.
            eligible.append((float(m["pfWithoutBest"] or 0), int(m["trades"]), mechanism))
    selected = sorted(eligible, key=lambda x: (-x[0], -x[1], x[2]))[0][2] if eligible else None
    return selected, details


def evaluate_pair(pair: str, candles, index, features) -> dict[str, Any]:
    selected, development = development_select(pair, candles, index, features)
    result: dict[str, Any] = {
        "selectedMechanism": selected,
        "developmentDiagnostics": development,
        "validationUsedForSelection": False,
        "evaluationUsedForSelection": False,
        "periods": {},
        "freshOosPermission": False,
    }
    if selected is None:
        return result
    for label in ("development", "validation", "evaluation"):
        start, end = base.PERIODS[label]
        normal = simulate(pair, selected, candles, index, features, start, end, NORMAL_BPS, 0)
        stress = simulate(pair, selected, candles, index, features, start, end, STRESS_BPS, STRESS_DELAY)
        result["periods"][label] = metric(normal)
        result["periods"][label + "Stress"] = metric(stress)
    combined_n = simulate(pair, selected, candles, index, features, *base.PERIODS["combined"], NORMAL_BPS, 0)
    combined_s = simulate(pair, selected, candles, index, features, *base.PERIODS["combined"], STRESS_BPS, STRESS_DELAY)
    result["combined3Y"] = metric(combined_n)
    result["combined3YStress"] = metric(combined_s)
    v = result["periods"]["validation"]
    e = result["periods"]["evaluation"]
    vs = result["periods"]["validationStress"]
    es = result["periods"]["evaluationStress"]
    cs = result["combined3YStress"]
    result["freshOosPermission"] = bool(
        v["trades"] >= VAL_MIN_TRADES and e["trades"] >= EVAL_MIN_TRADES
        and v["returnPct"] > 0 and e["returnPct"] > 0
        and (v["pf"] or 0) >= VAL_MIN_PF and (v["pfWithoutBest"] or 0) >= VAL_MIN_PF_WO
        and (e["pf"] or 0) >= EVAL_MIN_PF and (e["pfWithoutBest"] or 0) >= EVAL_MIN_PF_WO
        and (vs["pf"] or 0) >= STRESS_MIN_PF and (es["pf"] or 0) >= STRESS_MIN_PF
        and (cs["pf"] or 0) >= STRESS_MIN_PF
    )
    return result


def main() -> None:
    metrics, manifest = load_metrics()
    candles, index, _ = base.v109.b.base.load()
    metric_features = {pair: build_metric_features(pair, metrics[pair]) for pair in PAIRS}
    pairs = {pair: evaluate_pair(pair, candles, index, metric_features[pair]) for pair in PAIRS}
    fresh = [p for p in PAIRS if pairs[p]["freshOosPermission"]]
    out = {
        "researchLine": "USD_M_METRICS_MECHANISM_ROUTER_V7",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "newInformationSource": "BINANCE_USDM_HISTORICAL_METRICS",
        "metricsSchema": manifest["schema"],
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "validationUsedForSelection": False,
        "evaluationUsedForSelection": False,
        "sameRunRetuning": False,
        "parameterGrid": False,
        "mechanismSet": list(MECHANISMS),
        "selectionPeriod": "development_only_2023_07_to_2024_07",
        "freshOosCandidates": fresh,
        "liveEligiblePairs": [],
        "pairs": pairs,
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    (root / "metrics-mechanism-router-v7.json").write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    lines = ["# USD-M Metrics Mechanism Router V7", "", f"Fresh OOS candidates: {', '.join(fresh) if fresh else 'NONE'}", ""]
    for pair in PAIRS:
        r = pairs[pair]; sel = r["selectedMechanism"]
        if sel is None:
            lines.append(f"- {pair}: selected=NONE; Development had no eligible mechanism")
        else:
            c = r["combined3Y"]; cs = r["combined3YStress"]
            v = r["periods"]["validation"]; e = r["periods"]["evaluation"]
            lines.append(f"- {pair}: selected={sel}; freshOosPermission={r['freshOosPermission']}; 3Y trades={c['trades']} return={c['returnPct']:.2f}% PF={c['pf']} PFwo={c['pfWithoutBest']} DD={c['maxDDPct']:.2f}%; StressPF={cs['pf']}; V={v['returnPct']:.2f}%/{v['pf']}; E={e['returnPct']:.2f}%/{e['pf']}")
    lines += ["", "Development-only mechanism selection. Validation/Evaluation frozen. No Fresh OOS data read. No LIVE eligibility granted."]
    (root / "metrics-mechanism-router-v7.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
