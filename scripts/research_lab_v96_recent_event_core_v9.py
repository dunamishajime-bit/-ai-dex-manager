from __future__ import annotations

import argparse
import datetime as dt
import itertools
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_v96_recent_event_core_v6 as v6

UTC = dt.timezone.utc
START_MS, END_MS = v6.START_MS, v6.END_MS
F1_MS, F2_MS, F3_MS = v6.F1_MS, v6.F2_MS, v6.F3_MS
BAR_HOURS, BAR_MS, DAY_MS, GROSS = v6.BAR_HOURS, v6.BAR_MS, v6.DAY_MS, v6.GROSS
SYMBOLS = v6.SYMBOLS
ALT_SYMBOLS = ("ETH", "BNB", "SOL", "LINK", "AVAX")
BASELINE = 101.998210
HOLD_HOURS = 84


@dataclass(frozen=True)
class FilterConfig:
    config_id: str
    decline_min: float
    bounce_min: float
    bounce_max: float
    current4h_max: float
    relative_max: float
    volume_min: float
    distance20_min: float
    btc7_max: float
    breadth_max: int
    rank_mode: str
    cooldown_hours: int


@dataclass
class Position:
    symbol: str
    side: int
    entry_ts: int
    entry_price: float
    bars_held: int
    max_bars: int


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return fallback
    return x if math.isfinite(x) else fallback


def compound(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + float(value))
    return equity - 1.0


def profit_factor(values: Sequence[float]) -> Optional[float]:
    wins = sum(v for v in values if v > 0)
    losses = -sum(v for v in values if v < 0)
    return wins / losses if losses > 1e-15 else (999.0 if wins > 0 else None)


def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, list):
        return [rounded(v) for v in value]
    return value


def configs() -> List[FilterConfig]:
    result: List[FilterConfig] = []
    # Two-stage bounded grid around the known +101.998% region. Thresholds are intentionally coarse.
    for decline, bmax, cmax, rel, dist, btcmax, breadth, rank, cooldown in itertools.product(
        (5.0, 5.5, 6.0),
        (1.5, 2.0, 3.0, 99.0),
        (0.0, 0.5, 1.0, 99.0),
        (0.0, -2.0, -4.0),
        (-99.0, -15.0, -10.0),
        (0.0, 4.0, 8.0, 99.0),
        (2, 3, 5),
        ("DEEP", "RELATIVE", "BALANCED"),
        (0, 12),
    ):
        # Sample the combinatorial surface deterministically to keep the search bounded.
        signature = (
            int(decline * 10) * 3
            + int(bmax * 10) * 5
            + int(cmax * 10) * 7
            + int(abs(rel) * 10) * 11
            + int(abs(dist)) * 13
            + int(btcmax if btcmax < 90 else 17) * 17
            + breadth * 19
            + (0 if rank == "DEEP" else 1 if rank == "RELATIVE" else 2) * 23
            + cooldown
        )
        if signature % 4 != 0:
            continue
        result.append(FilterConfig(
            f"V9_D{decl:g}_BM{bmax:g}_C{cmax:g}_R{rel:g}_DIST{dist:g}_BTC{btcmax:g}_BR{breadth}_{rank}_CD{cooldown}",
            decline, 1.0, bmax, cmax, rel, 0.0, dist, btcmax, breadth, rank, cooldown,
        ))
    # Add a compact high-quality volume family explicitly rather than multiplying the whole grid.
    for rel, bmax, cmax, volume, rank in itertools.product(
        (0.0, -2.0, -4.0), (1.5, 2.0, 3.0), (0.0, 0.5, 1.0), (0.8, 1.0), ("DEEP", "BALANCED")
    ):
        result.append(FilterConfig(
            f"V9_VOL_R{rel:g}_BM{bmax:g}_C{cmax:g}_V{volume:g}_{rank}",
            5.0, 1.0, bmax, cmax, rel, volume, -15.0, 99.0, 5, rank, 0,
        ))
    # Always include the exact unfiltered +101.998% benchmark.
    result.append(FilterConfig("V9_BASELINE", 5.0, 1.0, 99.0, 99.0, 99.0, 0.0, -99.0, 99.0, 5, "DEEP", 0))
    unique = {cfg.config_id: cfg for cfg in result}
    return list(unique.values())


def precompute_pool(market: dict) -> Dict[int, List[dict]]:
    pool: Dict[int, List[dict]] = {}
    lookback = int(10 * 24 / BAR_HOURS)
    bounce_bars = int(8 / BAR_HOURS)
    sma_bars = int(20 * 24 / BAR_HOURS)
    btc7_bars = int(7 * 24 / BAR_HOURS)
    for ts in market["times"]:
        if ts < START_MS - BAR_MS or ts >= END_MS:
            continue
        bidx = market["indexes"]["BTC"].get(ts)
        if bidx is None:
            continue
        btc_rows = market["bars"]["BTC"]
        btc10 = v6.mom(btc_rows, bidx, lookback)
        btc7 = v6.mom(btc_rows, bidx, btc7_bars)
        if btc10 is None or btc7 is None:
            continue
        breadth = 0
        for symbol in ALT_SYMBOLS:
            idx = market["indexes"][symbol].get(ts)
            if idx is None:
                continue
            rows = market["bars"][symbol]
            avg = v6.sma(rows, idx, sma_bars)
            m7 = v6.mom(rows, idx, btc7_bars)
            if avg is not None and m7 is not None and float(rows[idx]["close"]) > avg and m7 > 0:
                breadth += 1

        rows_out = []
        for symbol in SYMBOLS:
            idx = market["indexes"][symbol].get(ts)
            if idx is None:
                continue
            rows = market["bars"][symbol]
            move10 = v6.mom(rows, idx, lookback)
            bounce8 = v6.mom(rows, idx, bounce_bars)
            current4 = v6.mom(rows, idx, 1)
            avg20 = v6.sma(rows, idx, sma_bars)
            vol = v6.volratio(rows, idx)
            if None in (move10, bounce8, current4, avg20, vol):
                continue
            close = float(rows[idx]["close"])
            if close >= avg20:
                continue
            relative = move10 - btc10
            distance20 = (close / avg20 - 1.0) * 100.0
            rows_out.append({
                "symbol": symbol,
                "move10": move10,
                "bounce8": bounce8,
                "current4": current4,
                "relative10": relative,
                "volumeRatio": vol,
                "distance20": distance20,
                "btc7": btc7,
                "breadth": breadth,
            })
        pool[ts] = rows_out
    return pool


def choose(cfg: FilterConfig, ts: int, pool: Dict[int, List[dict]]) -> Optional[dict]:
    candidates = []
    for item in pool.get(ts, []):
        if item["move10"] > -cfg.decline_min:
            continue
        if item["bounce8"] < cfg.bounce_min or item["bounce8"] > cfg.bounce_max:
            continue
        if item["current4"] > cfg.current4h_max:
            continue
        if cfg.relative_max < 90 and item["relative10"] > cfg.relative_max:
            continue
        if item["volumeRatio"] < cfg.volume_min:
            continue
        if item["distance20"] < cfg.distance20_min:
            continue
        if item["btc7"] > cfg.btc7_max:
            continue
        if item["breadth"] > cfg.breadth_max:
            continue
        if cfg.rank_mode == "DEEP":
            score = -item["move10"] + 0.20 * item["bounce8"]
        elif cfg.rank_mode == "RELATIVE":
            score = -item["relative10"] + 0.20 * (-item["move10"])
        else:
            score = -item["move10"] + 0.35 * (-item["relative10"]) + 0.15 * item["volumeRatio"] - 0.10 * max(0.0, item["bounce8"] - 1.0)
        candidates.append((score, item["symbol"], item))
    if not candidates:
        return None
    score, symbol, item = max(candidates, key=lambda x: (x[0], x[1]))
    return {**item, "score": score, "symbol": symbol}


def simulate(cfg: FilterConfig, market: dict, pool: Dict[int, List[dict]]) -> Tuple[List[dict], List[dict], List[dict], List[dict]]:
    times = [ts for ts in market["times"] if START_MS <= ts < END_MS]
    normal_rows: List[dict] = []
    severe_rows: List[dict] = []
    entries: List[dict] = []
    position: Optional[Position] = None
    pending: Optional[dict] = None
    cooldown_until = 0
    previous: Dict[str, float] = {}

    for ts in times:
        if position is None and pending is not None and ts >= cooldown_until:
            symbol = pending["symbol"]
            idx = market["indexes"][symbol].get(ts)
            if idx is not None:
                position = Position(symbol, -1, ts, float(market["bars"][symbol][idx]["open"]), 0, HOLD_HOURS // BAR_HOURS)
                entries.append({"entryTs": ts, "signalTs": ts - BAR_MS, **pending})
            pending = None

        weights: Dict[str, float] = {}
        gross_return = 0.0
        funding_return = 0.0
        if position is not None:
            weights[position.symbol] = -GROSS
            idx = market["indexes"][position.symbol].get(ts)
            if idx is not None:
                bar = market["bars"][position.symbol][idx]
                gross_return = -GROSS * (float(bar["close"]) / float(bar["open"]) - 1.0)
                funding_return = GROSS * market["funding"][position.symbol].get(ts, 0.0)

        turnover = sum(abs(weights.get(s, 0.0) - previous.get(s, 0.0)) for s in set(weights) | set(previous))
        normal = gross_return + funding_return - turnover * 10.0 / 10_000.0
        severe = gross_return + funding_return - turnover * 50.0 / 10_000.0 - (GROSS * 3.0 / 10_000.0 if weights else 0.0)
        gross = sum(abs(v) for v in weights.values())
        normal_rows.append({"ts": ts, "return": normal, "gross": gross, "maxGross": gross, "regime": -1 if weights else 0})
        severe_rows.append({"ts": ts, "return": severe, "gross": gross, "maxGross": gross, "regime": -1 if weights else 0})
        previous = dict(weights)

        if position is not None:
            position.bars_held += 1
            if position.bars_held >= position.max_bars:
                position = None
                cooldown_until = ts + cfg.cooldown_hours * v6.HOUR

        if position is None and pending is None and ts >= cooldown_until:
            pending = choose(cfg, ts, pool)

    return normal_rows, severe_rows, entries, entries


def metrics(rows: Sequence[dict], entries: Sequence[dict], start: int, end: int) -> dict:
    active = [r for r in rows if start <= int(r["ts"]) < end]
    values = [float(r["return"]) for r in active]
    equity = peak = 1.0
    dd = 0.0
    months: Dict[str, List[float]] = {}
    for row in active:
        equity *= max(0.001, 1.0 + float(row["return"]))
        peak = max(peak, equity)
        dd = min(dd, equity / peak - 1.0)
        key = dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC).strftime("%Y-%m")
        months.setdefault(key, []).append(float(row["return"]))
    monthly = {k: compound(v) * 100.0 for k, v in months.items()}
    trade_count = sum(1 for e in entries if start <= int(e["entryTs"]) < end)
    years = max(1e-9, (end - start) / (365.25 * DAY_MS))
    return {
        "tradeEpisodes": trade_count,
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "cagrPct": (equity ** (1.0 / years) - 1.0) * 100.0 if equity > 0 else None,
        "maxDrawdownPct": dd * 100.0,
        "profitFactor": profit_factor(values),
        "positiveMonthRatio": sum(v > 0 for v in monthly.values()) / len(monthly) if monthly else 0.0,
        "monthlyReturnsPct": monthly,
    }


def evaluate(cfg: FilterConfig, market: dict, pool: Dict[int, List[dict]]) -> Tuple[dict, List[dict], List[dict]]:
    normal, severe, entries, severe_entries = simulate(cfg, market, pool)
    ranges = {
        "fold1": (START_MS, F1_MS),
        "fold2": (F1_MS, F2_MS),
        "fold3": (F2_MS, F3_MS),
        "lateEvaluation": (F3_MS, END_MS),
        "full": (START_MS, END_MS),
    }
    out = {"variantId": cfg.config_id, "config": asdict(cfg)}
    for name, (a, b) in ranges.items():
        out[name] = {"normal": metrics(normal, entries, a, b), "severe": metrics(severe, severe_entries, a, b)}
    ns = [out[x]["normal"] for x in ("fold1", "fold2", "fold3")]
    ss = [out[x]["severe"] for x in ("fold1", "fold2", "fold3")]
    pre = compound([finite(x["compoundedReturnPct"]) / 100.0 for x in ns]) * 100.0
    pre_s = compound([finite(x["compoundedReturnPct"]) / 100.0 for x in ss]) * 100.0
    pn = sum(finite(x["compoundedReturnPct"]) > 0 for x in ns)
    ps = sum(finite(x["compoundedReturnPct"]) > 0 for x in ss)
    trades = sum(int(x["tradeEpisodes"]) for x in ns)
    worst = min(finite(x["maxDrawdownPct"], -99.0) for x in ns)
    avg_pf = sum(min(5.0, finite(x.get("profitFactor"))) for x in ns) / 3.0
    eligible = bool(trades >= 12 and pn == 3 and ps >= 2 and pre >= 45.0 and pre_s >= 15.0 and worst >= -15.0 and avg_pf >= 1.12)
    score = pre + 0.70 * pre_s + 5.0 * (pn + ps) + 5.0 * max(0.0, avg_pf - 1.0) - 0.20 * abs(worst) if eligible else -1e12
    out["preSelection"] = {
        "eligible": eligible, "score": score, "compoundedReturnPct": pre, "severeCompoundedReturnPct": pre_s,
        "positiveFolds": pn, "positiveSevereFolds": ps, "tradeEpisodes": trades,
        "worstFoldDrawdownPct": worst, "averageFoldProfitFactor": avg_pf,
    }
    return out, normal, severe


def compact(row: dict) -> dict:
    return {k: row[k] for k in ("variantId", "config", "preSelection", "fold1", "fold2", "fold3", "lateEvaluation", "full")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=".research-state/v96-v9")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)

    market = v6.load_market()
    pool = precompute_pool(market)
    results = []
    replays = {}
    for cfg in configs():
        row, normal, severe = evaluate(cfg, market, pool)
        results.append(row)
        replays[row["variantId"]] = (normal, severe)

    eligible = sorted((r for r in results if r["preSelection"]["eligible"]), key=lambda r: (r["preSelection"]["score"], r["variantId"]), reverse=True)
    ranked = sorted(results, key=lambda r: (r["preSelection"]["score"], r["variantId"]), reverse=True)
    selected = eligible[0] if eligible else ranked[0]
    normal, severe = replays[selected["variantId"]]
    full, full_s = selected["full"]["normal"], selected["full"]["severe"]
    late, late_s = selected["lateEvaluation"]["normal"], selected["lateEvaluation"]["severe"]
    late_pass = bool(int(late["tradeEpisodes"]) >= 3 and finite(late["compoundedReturnPct"]) > 0 and finite(late_s["compoundedReturnPct"]) > 0 and finite(late["maxDrawdownPct"], -99) >= -12 and finite(late.get("profitFactor")) > 1.05)
    beats = bool(finite(full["compoundedReturnPct"]) > BASELINE and finite(full_s["compoundedReturnPct"]) > 25 and finite(full["maxDrawdownPct"], -99) >= -15 and finite(full.get("profitFactor")) > 1.22)
    status = "V96_RECENT_EVENT_CORE_V9_PASS" if selected["preSelection"]["eligible"] and late_pass and beats else "V96_RECENT_EVENT_CORE_V9_DIAGNOSTIC"
    top_full = sorted(results, key=lambda r: finite(r["full"]["normal"]["compoundedReturnPct"], -1e12), reverse=True)

    payload = rounded({
        "version": 9,
        "strategyId": "V96_RECENT_EVENT_CORE_V9_PRE_RANK_QUALITY",
        "status": status,
        "architecture": {
            "barHours": BAR_HOURS, "gross": GROSS, "holdHours": HOLD_HOURS,
            "baseSignal": "10d decline, 8h rebound, below 20d SMA",
            "filterBeforeSymbolRanking": True,
            "features": ["decline10d", "bounce8h", "current4h", "relative10d", "volume", "distance20dSMA", "BTC7d", "altBreadth"],
            "nextBarExecution": True,
        },
        "benchmark": {"unfilteredFullDiagnosticPct": BASELINE},
        "candidateCounts": {"tested": len(results), "eligible": len(eligible)},
        "poolStats": {"timestamps": len(pool), "rawCandidateRows": sum(len(v) for v in pool.values())},
        "selected": compact(selected),
        "selectedPassesLateEvaluation": late_pass,
        "selectedBeats101p998": beats,
        "topPreSelection": [compact(r) for r in ranked[:25]],
        "topFullDiagnosticOnly": [compact(r) for r in top_full[:25]],
        "selectionPolicy": {
            "rankingUsesOnlyFirstThreeFolds": True,
            "lateEvaluationUsedForRanking": False,
            "fullPeriodUsedForRanking": False,
            "promotionTarget": "full >101.998%, Severe >25%, DD >=-15%, PF >1.22, late Normal/Severe positive",
        },
        "selectedReplay": {"strategyId": "V96_RECENT_EVENT_CORE_V9_PRE_RANK_QUALITY", "variantId": selected["variantId"], "normal": normal, "severe": severe},
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    })
    (output / "v96-recent-event-core-v9.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": status, "counts": payload["candidateCounts"], "selected": selected["variantId"],
        "pre": selected["preSelection"], "full": selected["full"], "late": selected["lateEvaluation"],
        "beats": beats, "latePass": late_pass, "bestFullDiagnostic": compact(top_full[0]),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
