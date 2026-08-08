from __future__ import annotations

import hashlib
import json
import math
import os
import statistics
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4

STRATEGY_ID = "NEXT_GEN_FOUR_FAMILY_V49"
SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]
TRADE_SYMBOLS = ["ETH", "BNB", "SOL", "LINK", "AVAX"]
HOUR = 3_600_000
BAR_MS = 12 * HOUR
NORMAL_COST_BPS = 10.0
STRESS_COST_BPS = 30.0

DEV = (v4.START_2023, v4.START_2024)
VAL = (v4.START_2024, v4.START_2025)
CONF = (v4.START_2025, v4.START_2026)
HOLD = (v4.START_2026, v4.END)


@dataclass(frozen=True)
class Spec:
    family: str
    variant_id: str
    params: dict


def product_return(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value / 100.0)
    return (equity - 1.0) * 100.0


def profit_factor(values: List[float]) -> Optional[float]:
    wins = sum(v for v in values if v > 0)
    losses = abs(sum(v for v in values if v < 0))
    if losses > 1e-12:
        return wins / losses
    return 999.0 if wins > 0 else None


def max_drawdown(values: List[float]) -> float:
    equity = 1.0
    peak = 1.0
    worst = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value / 100.0)
        peak = max(peak, equity)
        worst = min(worst, (equity / peak - 1.0) * 100.0)
    return worst


def mean(values: List[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def std(values: List[float]) -> float:
    return statistics.pstdev(values) if len(values) >= 2 else 0.0


def ret(rows: List[dict], end: int, bars_back: int) -> Optional[float]:
    prior = end - bars_back
    if prior < 0:
        return None
    p0 = float(rows[prior]["close"])
    p1 = float(rows[end]["close"])
    if p0 <= 0:
        return None
    return (p1 / p0 - 1.0) * 100.0


def rolling_vol(rows: List[dict], end: int, bars_back: int) -> Optional[float]:
    if end - bars_back < 0:
        return None
    vals: List[float] = []
    for i in range(end - bars_back + 1, end + 1):
        p0 = float(rows[i - 1]["close"])
        p1 = float(rows[i]["close"])
        if p0 > 0 and p1 > 0:
            vals.append(math.log(p1 / p0))
    return std(vals) * math.sqrt(730.0) * 100.0 if len(vals) >= 4 else None


def highest(rows: List[dict], end_exclusive: int, length: int) -> Optional[float]:
    start = end_exclusive - length
    if start < 0:
        return None
    return max(float(row["high"]) for row in rows[start:end_exclusive])


def lowest(rows: List[dict], end_exclusive: int, length: int) -> Optional[float]:
    start = end_exclusive - length
    if start < 0:
        return None
    return min(float(row["low"]) for row in rows[start:end_exclusive])


def sma(rows: List[dict], end: int, length: int) -> Optional[float]:
    if end - length + 1 < 0:
        return None
    return mean([float(r["close"]) for r in rows[end - length + 1:end + 1]])


def covariance(xs: List[float], ys: List[float]) -> float:
    if len(xs) != len(ys) or len(xs) < 2:
        return 0.0
    mx, my = mean(xs), mean(ys)
    return mean([(x - mx) * (y - my) for x, y in zip(xs, ys)])


def beta_to_btc(rows: List[dict], btc: List[dict], end: int, lookback: int) -> Optional[float]:
    if end - lookback < 0:
        return None
    xs: List[float] = []
    ys: List[float] = []
    for i in range(end - lookback + 1, end + 1):
        b0, b1 = float(btc[i - 1]["close"]), float(btc[i]["close"])
        a0, a1 = float(rows[i - 1]["close"]), float(rows[i]["close"])
        if min(b0, b1, a0, a1) <= 0:
            continue
        xs.append(math.log(b1 / b0))
        ys.append(math.log(a1 / a0))
    vx = statistics.pvariance(xs) if len(xs) >= 2 else 0.0
    return covariance(xs, ys) / vx if vx > 1e-12 else None


def residual_return(rows: List[dict], btc: List[dict], end: int, window: int, beta: float) -> Optional[float]:
    ar = ret(rows, end, window)
    br = ret(btc, end, window)
    if ar is None or br is None:
        return None
    return ar - beta * br


def funding_average(points: List[dict], end_ts: int, lookback_days: int) -> Optional[float]:
    start = end_ts - lookback_days * 24 * HOUR
    vals = [float(p["rate"]) * 100.0 for p in points if start <= int(p["ts"]) <= end_ts]
    return mean(vals) if vals else None


def funding_during(points: List[dict], start_ts: int, end_ts: int) -> float:
    return sum(float(p["rate"]) * 100.0 for p in points if start_ts <= int(p["ts"]) < end_ts)


def normalize_gross(weights: Dict[str, float], gross: float) -> Dict[str, float]:
    current = sum(abs(v) for v in weights.values())
    if current <= 1e-12:
        return {}
    scale = min(1.0, gross / current)
    return {k: v * scale for k, v in weights.items()}


def vol_target_weights(signals: Dict[str, float], bars: Dict[str, List[dict]], indexes: Dict[str, Dict[int, int]], ts: int, target_vol: float, max_gross: float, vol_bars: int = 40) -> Dict[str, float]:
    raw: Dict[str, float] = {}
    for symbol, direction in signals.items():
        idx = indexes[symbol].get(ts)
        if idx is None:
            continue
        vol = rolling_vol(bars[symbol], idx, vol_bars)
        if vol is None or vol <= 1e-6:
            continue
        raw[symbol] = direction / vol
    denom = sum(abs(v) for v in raw.values())
    if denom <= 0:
        return {}
    gross = min(max_gross, max(0.15, target_vol / 60.0))
    return {s: v / denom * gross for s, v in raw.items()}


def family1_target(spec: Spec, ts: int, bars, indexes, raw) -> Dict[str, float]:
    p = spec.params
    lookback = int(p["breakout_days"] * 2)
    trend_len = int(p["trend_days"] * 2)
    btc_idx = indexes["BTC"].get(ts)
    if btc_idx is None:
        return {}
    long_breadth = 0
    short_breadth = 0
    for symbol in TRADE_SYMBOLS:
        idx = indexes[symbol].get(ts)
        if idx is None:
            continue
        avg = sma(bars[symbol], idx, trend_len)
        if avg is None:
            continue
        close = float(bars[symbol][idx]["close"])
        long_breadth += close > avg
        short_breadth += close < avg
    threshold = int(p["breadth"])
    signals: Dict[str, float] = {}
    for symbol in TRADE_SYMBOLS:
        idx = indexes[symbol].get(ts)
        if idx is None:
            continue
        hi = highest(bars[symbol], idx, lookback)
        lo = lowest(bars[symbol], idx, lookback)
        if hi is None or lo is None:
            continue
        close = float(bars[symbol][idx]["close"])
        if close > hi and long_breadth >= threshold:
            signals[symbol] = 1.0
        elif close < lo and short_breadth >= threshold:
            signals[symbol] = -1.0
    return vol_target_weights(signals, bars, indexes, ts, float(p["target_vol"]), float(p["max_gross"]), int(p["vol_days"] * 2))


def family2_target(spec: Spec, ts: int, bars, indexes, raw) -> Dict[str, float]:
    p = spec.params
    btc_idx = indexes["BTC"].get(ts)
    if btc_idx is None:
        return {}
    beta_bars = int(p["beta_days"] * 2)
    resid_bars = int(p["resid_days"] * 2)
    btc_mom = ret(bars["BTC"], btc_idx, int(p["regime_days"] * 2))
    if btc_mom is None:
        return {}
    scores: List[Tuple[str, float]] = []
    for symbol in TRADE_SYMBOLS:
        idx = indexes[symbol].get(ts)
        if idx is None or idx != btc_idx:
            continue
        beta = beta_to_btc(bars[symbol], bars["BTC"], idx, beta_bars)
        if beta is None:
            continue
        rr = residual_return(bars[symbol], bars["BTC"], idx, resid_bars, beta)
        if rr is not None:
            scores.append((symbol, rr))
    if len(scores) < 4:
        return {}
    ordered = sorted(scores, key=lambda x: x[1])
    loser, winner = ordered[0], ordered[-1]
    trend_regime = abs(btc_mom) >= float(p["btc_mom_threshold"])
    if trend_regime:
        signals = {winner[0]: 1.0, loser[0]: -1.0}
    else:
        signals = {winner[0]: -1.0, loser[0]: 1.0}
    each = float(p["gross"]) / 2.0
    return {s: d * each for s, d in signals.items()}


def family3_target(spec: Spec, ts: int, bars, indexes, raw) -> Dict[str, float]:
    p = spec.params
    vals: List[Tuple[str, float, float]] = []
    for symbol in TRADE_SYMBOLS:
        idx = indexes[symbol].get(ts)
        if idx is None:
            continue
        favg = funding_average(raw[symbol]["funding"], ts, int(p["fund_days"]))
        mom = ret(bars[symbol], idx, int(p["trend_days"] * 2))
        if favg is not None and mom is not None:
            vals.append((symbol, favg, mom))
    if len(vals) < 4:
        return {}
    fvals = [v[1] for v in vals]
    sd = std(fvals)
    if sd <= 1e-12:
        return {}
    mu = mean(fvals)
    crowded = [(s, f, m, (f - mu) / sd) for s, f, m in vals]
    pos = sorted([x for x in crowded if x[3] >= float(p["z"]) and x[2] <= float(p["trend_cap"])], key=lambda x: x[3], reverse=True)
    neg = sorted([x for x in crowded if x[3] <= -float(p["z"]) and x[2] >= -float(p["trend_cap"])], key=lambda x: x[3])
    weights: Dict[str, float] = {}
    if not pos or not neg:
        return {}
    each = float(p["gross"]) / 2.0
    weights[pos[0][0]] = -each
    weights[neg[0][0]] = each
    return weights


def family4_target_factory(spec: Spec, times: List[int], bars, indexes, raw) -> Callable[[int], Dict[str, float]]:
    p = spec.params
    hold_bars = int(p["hold_hours"] // 12)
    state = {"until_idx": -1, "weights": {}}
    time_index = {ts: i for i, ts in enumerate(times)}

    def target(ts: int) -> Dict[str, float]:
        ti = time_index.get(ts, -1)
        if ti < 0:
            return {}
        if ti <= state["until_idx"] and state["weights"]:
            return dict(state["weights"])
        state["weights"] = {}
        state["until_idx"] = -1
        btc_idx = indexes["BTC"].get(ts)
        if btc_idx is None or btc_idx < 7:
            return {}
        crash_bars = int(p["crash_days"] * 2)
        btc_crash = ret(bars["BTC"], btc_idx, crash_bars)
        if btc_crash is None or btc_crash > -float(p["btc_crash"]):
            return {}
        crash_count = 0
        rebound: List[Tuple[str, float]] = []
        for symbol in TRADE_SYMBOLS:
            idx = indexes[symbol].get(ts)
            if idx is None:
                continue
            cr = ret(bars[symbol], idx, crash_bars)
            one = ret(bars[symbol], idx, 1)
            if cr is not None and cr <= -float(p["alt_crash"]):
                crash_count += 1
            if cr is not None and one is not None and one > float(p["reversal_bar"]):
                rebound.append((symbol, one))
        if crash_count < int(p["breadth"]) or not rebound:
            return {}
        selected = sorted(rebound, key=lambda x: x[1], reverse=True)[:int(p["top_k"])]
        signals = {s: 1.0 for s, _ in selected}
        weights = vol_target_weights(signals, bars, indexes, ts, float(p["target_vol"]), float(p["max_gross"]), 40)
        if weights:
            state["weights"] = weights
            state["until_idx"] = ti + max(1, hold_bars) - 1
        return dict(weights)

    return target


def make_target(spec: Spec, times, bars, indexes, raw) -> Callable[[int], Dict[str, float]]:
    if spec.family == "VOL_BREAKOUT_BREADTH":
        return lambda ts: family1_target(spec, ts, bars, indexes, raw)
    if spec.family == "RESIDUAL_REGIME_SWITCH":
        return lambda ts: family2_target(spec, ts, bars, indexes, raw)
    if spec.family == "FUNDING_TREND_CROWDING":
        return lambda ts: family3_target(spec, ts, bars, indexes, raw)
    if spec.family == "CRASH_REBOUND_EVENT":
        return family4_target_factory(spec, times, bars, indexes, raw)
    raise ValueError(spec.family)


def simulate(spec: Spec, period: Tuple[int, int], bars, indexes, raw, times, cost_bps: float, delay_bars: int) -> dict:
    target_fn = make_target(spec, times, bars, indexes, raw)
    active = [ts for ts in times if period[0] <= ts < period[1]]
    global_idx = {ts: i for i, ts in enumerate(times)}
    portfolio: Dict[str, float] = {}
    bar_returns: List[float] = []
    cycles: List[float] = []
    cycle_vals: List[float] = []
    exposures: List[float] = []
    turnovers: List[float] = []

    def close_cycle() -> None:
        nonlocal cycle_vals
        if cycle_vals:
            cycles.append(product_return(cycle_vals))
            cycle_vals = []

    for ts in active:
        gi = global_idx[ts]
        signal_i = gi - 1 - delay_bars
        desired = target_fn(times[signal_i]) if signal_i >= 0 else {}
        turn = v4.turnover(portfolio, desired)
        if desired != portfolio:
            close_cycle()
            portfolio = desired
        gross = 0.0
        funding = 0.0
        for symbol, weight in portfolio.items():
            idx = indexes[symbol].get(ts)
            if idx is None:
                continue
            row = bars[symbol][idx]
            op = float(row["open"])
            cl = float(row["close"])
            if op > 0:
                gross += weight * (cl / op - 1.0) * 100.0
            funding += weight * funding_during(raw[symbol]["funding"], ts, ts + BAR_MS)
        cost = turn * cost_bps / 100.0
        value = gross - funding - cost
        bar_returns.append(value)
        exposures.append(sum(abs(v) for v in portfolio.values()))
        turnovers.append(turn)
        if portfolio:
            cycle_vals.append(value)
    if portfolio:
        final_cost = sum(abs(v) for v in portfolio.values()) * cost_bps / 100.0
        if bar_returns:
            bar_returns[-1] -= final_cost
        if cycle_vals:
            cycle_vals[-1] -= final_cost
    close_cycle()

    pf = profit_factor(cycles)
    wins = [v for v in cycles if v > 0]
    best = max(wins) if wins else 0.0
    win_sum = sum(wins)
    best_share = best / win_sum if win_sum > 1e-12 else 0.0
    without_best = list(cycles)
    if best > 0:
        without_best.remove(best)
    result = {
        "cycles": len(cycles),
        "winRatePct": (sum(v > 0 for v in cycles) / len(cycles) * 100.0) if cycles else 0.0,
        "compoundedReturnPct": product_return(bar_returns),
        "profitFactor": pf,
        "maxDrawdownPct": max_drawdown(bar_returns),
        "bestCycleProfitSharePct": best_share * 100.0,
        "profitFactorWithoutBest": profit_factor(without_best),
        "avgGross": mean(exposures),
        "totalTurnover": sum(turnovers),
    }
    return rounded(result)


def enough_samples(metrics: dict, stage: str, family: str) -> bool:
    mins = {
        "dev": 8 if family == "CRASH_REBOUND_EVENT" else 20,
        "val": 5 if family == "CRASH_REBOUND_EVENT" else 12,
        "conf": 5 if family == "CRASH_REBOUND_EVENT" else 12,
        "hold": 3 if family == "CRASH_REBOUND_EVENT" else 6,
    }
    return int(metrics["cycles"]) >= mins[stage]


def stage_pass(normal: dict, stress: dict, stage: str, family: str) -> bool:
    npf = normal.get("profitFactor") or 0.0
    spf = stress.get("profitFactor") or 0.0
    exbest = normal.get("profitFactorWithoutBest") or 0.0
    return (
        enough_samples(normal, stage, family)
        and normal["compoundedReturnPct"] > 0
        and npf >= (1.20 if stage in ("conf", "hold") else 1.15)
        and normal["maxDrawdownPct"] > -20.0
        and spf > 1.0
        and stress["compoundedReturnPct"] > -2.0
        and normal["bestCycleProfitSharePct"] < 45.0
        and exbest > 1.0
    )


def score(metrics: dict) -> float:
    pf = min(5.0, float(metrics.get("profitFactor") or 0.0))
    dd = abs(float(metrics.get("maxDrawdownPct") or 0.0))
    retv = float(metrics.get("compoundedReturnPct") or 0.0)
    conc = float(metrics.get("bestCycleProfitSharePct") or 100.0)
    return pf * 10.0 + retv * 0.15 - dd * 0.35 - conc * 0.05


def evaluate_family(specs: List[Spec], bars, indexes, raw, times) -> dict:
    dev_rows = []
    for spec in specs:
        n = simulate(spec, DEV, bars, indexes, raw, times, NORMAL_COST_BPS, 0)
        s = simulate(spec, DEV, bars, indexes, raw, times, STRESS_COST_BPS, 1)
        if stage_pass(n, s, "dev", spec.family):
            dev_rows.append((spec, n, s))
    val_rows = []
    for spec, dn, ds in dev_rows:
        n = simulate(spec, VAL, bars, indexes, raw, times, NORMAL_COST_BPS, 0)
        s = simulate(spec, VAL, bars, indexes, raw, times, STRESS_COST_BPS, 1)
        if stage_pass(n, s, "val", spec.family):
            val_rows.append((spec, dn, ds, n, s))
    if not val_rows:
        return {
            "family": specs[0].family,
            "evaluated": len(specs),
            "developmentPassed": len(dev_rows),
            "validationPassed": 0,
            "selected": None,
            "confirmation": None,
            "holdout": None,
            "robust": False,
        }
    val_rows.sort(key=lambda x: score(x[1]) + score(x[3]), reverse=True)
    spec, dn, ds, vn, vs = val_rows[0]
    cn = simulate(spec, CONF, bars, indexes, raw, times, NORMAL_COST_BPS, 0)
    cs = simulate(spec, CONF, bars, indexes, raw, times, STRESS_COST_BPS, 1)
    conf_pass = stage_pass(cn, cs, "conf", spec.family)
    hold = None
    robust = False
    if conf_pass:
        hn = simulate(spec, HOLD, bars, indexes, raw, times, NORMAL_COST_BPS, 0)
        hs = simulate(spec, HOLD, bars, indexes, raw, times, STRESS_COST_BPS, 1)
        robust = stage_pass(hn, hs, "hold", spec.family)
        hold = {"normal": hn, "stress": hs, "passed": robust}
    return {
        "family": spec.family,
        "evaluated": len(specs),
        "developmentPassed": len(dev_rows),
        "validationPassed": len(val_rows),
        "selected": {"variantId": spec.variant_id, "params": spec.params, "development": {"normal": dn, "stress": ds}, "validation": {"normal": vn, "stress": vs}},
        "confirmation": {"normal": cn, "stress": cs, "passed": conf_pass},
        "holdout": hold,
        "robust": robust,
    }


def build_specs() -> Dict[str, List[Spec]]:
    families: Dict[str, List[Spec]] = {k: [] for k in ["VOL_BREAKOUT_BREADTH", "RESIDUAL_REGIME_SWITCH", "FUNDING_TREND_CROWDING", "CRASH_REBOUND_EVENT"]}
    for breakout in [10, 20, 40]:
        for vol_days in [10, 20]:
            for breadth in [3, 4]:
                p = {"breakout_days": breakout, "vol_days": vol_days, "trend_days": 40, "breadth": breadth, "target_vol": 30, "max_gross": 0.8}
                vid = f"VB_B{breakout}_V{vol_days}_BR{breadth}"
                families["VOL_BREAKOUT_BREADTH"].append(Spec("VOL_BREAKOUT_BREADTH", vid, p))
    for beta_days in [20, 40]:
        for resid_days in [5, 10]:
            for thresh in [4.0, 7.0]:
                p = {"beta_days": beta_days, "resid_days": resid_days, "regime_days": 20, "btc_mom_threshold": thresh, "gross": 0.6}
                vid = f"RR_B{beta_days}_R{resid_days}_T{thresh}"
                families["RESIDUAL_REGIME_SWITCH"].append(Spec("RESIDUAL_REGIME_SWITCH", vid, p))
    for fund_days in [3, 7]:
        for trend_days in [10, 20]:
            for z in [0.5, 0.9]:
                p = {"fund_days": fund_days, "trend_days": trend_days, "z": z, "trend_cap": 12.0, "gross": 0.5}
                vid = f"FC_F{fund_days}_T{trend_days}_Z{z}"
                families["FUNDING_TREND_CROWDING"].append(Spec("FUNDING_TREND_CROWDING", vid, p))
    for btc_crash in [6.0, 9.0, 12.0]:
        for hold in [24, 48]:
            p = {"crash_days": 3, "btc_crash": btc_crash, "alt_crash": btc_crash * 1.15, "breadth": 3, "reversal_bar": 0.5, "hold_hours": hold, "top_k": 2, "target_vol": 25, "max_gross": 0.6}
            vid = f"CR_C{btc_crash}_H{hold}"
            families["CRASH_REBOUND_EVENT"].append(Spec("CRASH_REBOUND_EVENT", vid, p))
    return families


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, list):
        return [rounded(v) for v in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {s: v4.load_symbol(cache_root, s) for s in SYMBOLS}
    bars = {s: v4.resample_12h(raw[s]["candles"]) for s in SYMBOLS}
    indexes = {s: {int(row["ts"]): i for i, row in enumerate(bars[s])} for s in SYMBOLS}
    times = [int(r["ts"]) for r in bars["BTC"] if v4.START_2023 <= int(r["ts"]) < v4.END]

    families = build_specs()
    results = []
    robust = None
    for family_name in ["VOL_BREAKOUT_BREADTH", "RESIDUAL_REGIME_SWITCH", "FUNDING_TREND_CROWDING", "CRASH_REBOUND_EVENT"]:
        result = evaluate_family(families[family_name], bars, indexes, raw, times)
        results.append(result)
        if result["robust"]:
            robust = result
            break

    status = "ROBUST_NEXT_GEN_CANDIDATE" if robust else "NO_ROBUST_IMPROVEMENT"
    output = rounded({
        "version": 49,
        "strategyId": STRATEGY_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "familyOrder": ["VOL_BREAKOUT_BREADTH", "RESIDUAL_REGIME_SWITCH", "FUNDING_TREND_CROWDING", "CRASH_REBOUND_EVENT"],
        "results": results,
        "robustCandidate": robust,
        "gates": {
            "normalPF": ">=1.20 on Confirmation/Holdout",
            "maxDD": ">-20%",
            "stressPF": ">1.0",
            "holdoutReturn": ">0",
            "bestCycleProfitShare": "<45%",
            "profitFactorWithoutBest": ">1.0",
            "chronology": "Development 2023 -> Validation 2024 -> Confirmation 2025 -> Holdout 2026H1, no retune after opening Confirmation/Holdout",
        },
        "v9ForwardUsedForOptimization": False,
        "productionChanged": False,
        "realTradingEnabled": False,
        "limitations": [
            "2026H1 is untouched by each family before that family's Confirmation passes, but the calendar period has been seen by unrelated prior research in this repository.",
            "This is research-only evidence, not live-trading authorization.",
            "No Frozen V6/Fresh Forward V9 parameter or production/runtime setting is changed.",
        ],
        "fingerprint": hashlib.sha256(json.dumps({k: [s.params for s in v] for k, v in families.items()}, sort_keys=True).encode()).hexdigest(),
    })

    lines = [
        "# Next-Gen Four-Family V49",
        "",
        f"- Status: **{status}**",
        "- Frozen V6 / Fresh Forward V9 changed: NO",
        "- V9 13-cycle forward data used for optimization: NO",
        "- Production / VPS / .env / live runner changed: NO",
        "",
        "| Family | Evaluated | Dev pass | Val pass | Confirmation | Holdout | Robust |",
        "| --- | ---: | ---: | ---: | --- | --- | --- |",
    ]
    for r in results:
        conf = "NOT OPENED" if r["confirmation"] is None else ("PASS" if r["confirmation"]["passed"] else "FAIL")
        hold = "NOT OPENED" if r["holdout"] is None else ("PASS" if r["holdout"]["passed"] else "FAIL")
        lines.append(f"| {r['family']} | {r['evaluated']} | {r['developmentPassed']} | {r['validationPassed']} | {conf} | {hold} | {'YES' if r['robust'] else 'NO'} |")
    if robust:
        lines += ["", "## Robust candidate", "", f"`{robust['selected']['variantId']}` passed all gates."]
    else:
        lines += ["", "## Verdict", "", "All four additional next-generation families were exhausted without a candidate passing the full chronological robustness gates."]

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "next-gen-four-family-v49.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "next-gen-four-family-v49.md").write_text("\n".join(lines), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("\n\n" + "\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
