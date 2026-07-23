from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v46_gross2 as pv46
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_strong_growth_v86 as v86
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_strong_v95 as v95
import research_lab_v35_weight_band_v90 as v90
import research_lab_v96_frequency_uplift as freq

core = v69.core
FLOORS = (0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80)
PENGU_GROSS = 0.15
NORMAL_TOTAL_COST_PCT = 0.14
SEVERE_TOTAL_COST_PCT = 0.25
EXTREME_TOTAL_COST_PCT = 0.40


def trade_metrics(trades: List[pv46.Trade], start: int, end: int, cost_pct: float, gross: float = 1.0) -> dict:
    active = [trade for trade in trades if start <= trade.entry_ts and trade.exit_ts < end]
    values: List[float] = []
    equity = peak = 1.0
    max_dd = 0.0
    for trade in active:
        value = (trade.gross_pct - trade.funding_pct - cost_pct) / 100.0 * gross
        values.append(value)
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    gains = sum(value for value in values if value > 0)
    losses = abs(sum(value for value in values if value < 0))
    positive = [value for value in values if value > 0]
    return {
        "trades": len(active),
        "longTrades": sum(trade.side > 0 for trade in active),
        "shortTrades": sum(trade.side < 0 for trade in active),
        "returnPct": (equity - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "profitFactor": gains / losses if losses > 0 else 999.0 if gains > 0 else None,
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else None,
        "largestPositiveSharePct": max(positive) / sum(positive) * 100.0 if positive else None,
    }


def remove_best_trade(trades: List[pv46.Trade]) -> List[pv46.Trade]:
    if not trades:
        return []
    best = max(range(len(trades)), key=lambda index: trades[index].base_pct)
    return [trade for index, trade in enumerate(trades) if index != best]


def remove_best_month(trades: List[pv46.Trade]) -> List[pv46.Trade]:
    monthly: Dict[str, float] = {}
    for trade in trades:
        key = dt.datetime.fromtimestamp(trade.entry_ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
        monthly[key] = monthly.get(key, 0.0) + trade.base_pct
    if not monthly:
        return []
    best = max(monthly, key=monthly.get)
    return [
        trade for trade in trades
        if dt.datetime.fromtimestamp(trade.entry_ts / 1000, tz=dt.timezone.utc).strftime("%Y-%m") != best
    ]


def build_core_rows(raw: dict) -> tuple[List[dict], List[dict]]:
    candidate = freq.CoreCandidate("CORE_BASE")
    raw_targets = freq.raw_targets_for(candidate, raw)
    targets, _diag = v90.stabilize(
        raw_targets,
        raw["times"],
        v90.Config(candidate.weight_tolerance, candidate.turnover_threshold, candidate.stale_bars),
    )
    base_core = core.v32.core_series(targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0)
    severe_core = core.v32.core_series(targets, raw["times"], raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3)
    features = core.v34.features_with_vol(raw["times"], targets, raw["bars"], raw["indexes"], raw["funding"])
    config = core.CoreConfig()
    base_rows = core.core_rows(config, raw["times"], base_core, features)
    severe_rows = core.core_rows(config, raw["times"], severe_core, features)
    context = v89.context_for(targets, raw, base_core, features)
    normal, _normal_diag = v86.controlled_core(base_rows, context, v95.STRONG_CONFIG)
    severe, _severe_diag = v86.controlled_core(severe_rows, context, v95.STRONG_CONFIG)
    return normal, severe


def reserved_combine(core_rows: List[dict], pengu_series: Dict[int, dict], field: str) -> List[dict]:
    result: List[dict] = []
    for row in core_rows:
        p = pengu_series.get(int(row["ts"]), {"base": 0.0, "severe": 0.0, "maxExposure": 0.0, "averageExposure": 0.0})
        p_max = float(p.get("maxExposure", 0.0))
        p_avg = float(p.get("averageExposure", 0.0))
        core_gross_raw = float(row.get("gross", 0.0))
        capacity = max(0.0, 2.0 - p_max)
        core_scale = min(1.0, capacity / core_gross_raw) if core_gross_raw > 0 else 1.0
        result.append({
            "ts": int(row["ts"]),
            "return": float(row["return"]) * core_scale + float(p.get(field, 0.0)),
            "gross": core_gross_raw * core_scale + p_avg,
            "maxGross": core_gross_raw * core_scale + p_max,
        })
    return result


def evaluate_floor(
    floor: float,
    pengu: List[dict],
    btc: List[dict],
    funding: List[dict],
    core_normal: List[dict],
    core_severe: List[dict],
) -> dict:
    candidate = freq.PenguCandidate(f"PENGU_VOLUME_{int(round(floor * 100)):02d}", volume_floor=floor)
    trades = freq.pengu_trades(candidate, pengu, btc, funding)
    no_best = remove_best_trade(trades)
    no_month = remove_best_month(trades)
    series = pv46.pengu_12h_series(pengu, funding, trades, PENGU_GROSS)
    combined = reserved_combine(core_normal, series, "base")
    combined_severe = reserved_combine(core_severe, series, "severe")
    years = {}
    for year in (2024, 2025, 2026):
        start = int(dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
        end = core.CORE_END if year == 2026 else int(dt.datetime(year + 1, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
        years[str(year)] = {
            "normal": trade_metrics(trades, start, end, NORMAL_TOTAL_COST_PCT),
            "severe": trade_metrics(trades, start, end, SEVERE_TOTAL_COST_PCT),
        }
    return {
        "floor": floor,
        "normal": trade_metrics(trades, freq.PENGU_START, core.CORE_END, NORMAL_TOTAL_COST_PCT),
        "severe": trade_metrics(trades, freq.PENGU_START, core.CORE_END, SEVERE_TOTAL_COST_PCT),
        "extreme": trade_metrics(trades, freq.PENGU_START, core.CORE_END, EXTREME_TOTAL_COST_PCT),
        "reused2026H1": trade_metrics(trades, core.v4.START_2026, core.CORE_END, NORMAL_TOTAL_COST_PCT),
        "reused2026H1Severe": trade_metrics(trades, core.v4.START_2026, core.CORE_END, SEVERE_TOTAL_COST_PCT),
        "removeBestTrade": trade_metrics(no_best, freq.PENGU_START, core.CORE_END, NORMAL_TOTAL_COST_PCT),
        "removeBestTradeSevere": trade_metrics(no_best, freq.PENGU_START, core.CORE_END, SEVERE_TOTAL_COST_PCT),
        "removeBestMonth": trade_metrics(no_month, freq.PENGU_START, core.CORE_END, NORMAL_TOTAL_COST_PCT),
        "removeBestMonthSevere": trade_metrics(no_month, freq.PENGU_START, core.CORE_END, SEVERE_TOTAL_COST_PCT),
        "years": years,
        "combinedOperationalGross015": v69.metrics(combined, core.CORE_START, core.CORE_END),
        "combinedOperationalGross015Severe": v69.metrics(combined_severe, core.CORE_START, core.CORE_END),
    }


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v89.build_raw()
    core_normal, core_severe = build_core_rows(raw)
    pengu = pv46.fetch_klines("PENGUUSDT", freq.PENGU_START, core.CORE_END)
    btc = pv46.fetch_klines("BTCUSDT", freq.PENGU_START, core.CORE_END)
    funding = pv46.fetch_funding("PENGUUSDT", freq.PENGU_START, core.CORE_END)
    results = [evaluate_floor(floor, pengu, btc, funding, core_normal, core_severe) for floor in FLOORS]
    baseline = next(item for item in results if abs(item["floor"] - 0.80) < 1e-9)
    lead = next(item for item in results if abs(item["floor"] - 0.60) < 1e-9)
    neighbors = [item for item in results if item["floor"] in (0.55, 0.60, 0.65, 0.70)]
    neighbor_pass = all(
        item["normal"]["returnPct"] > baseline["normal"]["returnPct"]
        and item["severe"]["returnPct"] > baseline["severe"]["returnPct"]
        and item["reused2026H1"]["returnPct"] > 0
        and item["reused2026H1Severe"]["returnPct"] > 0
        for item in neighbors
    )
    concentration_pass = bool(
        (lead["normal"]["largestPositiveSharePct"] or 100.0) <= 40.0
        and lead["removeBestTradeSevere"]["returnPct"] > 0
        and lead["removeBestMonthSevere"]["returnPct"] > 0
    )
    combined_pass = bool(
        lead["combinedOperationalGross015"]["compoundedReturnPct"] > baseline["combinedOperationalGross015"]["compoundedReturnPct"]
        and lead["combinedOperationalGross015Severe"]["compoundedReturnPct"] > baseline["combinedOperationalGross015Severe"]["compoundedReturnPct"]
        and lead["combinedOperationalGross015"]["maxDrawdownPct"] >= baseline["combinedOperationalGross015"]["maxDrawdownPct"] - 0.5
        and lead["combinedOperationalGross015Severe"]["maxDrawdownPct"] >= baseline["combinedOperationalGross015Severe"]["maxDrawdownPct"] - 0.5
    )
    status = "PENGU_VOLUME60_HISTORICAL_ROBUST_LEAD_SHADOW_ONLY" if neighbor_pass and concentration_pass and combined_pass else "PENGU_VOLUME60_NOT_ROBUST"
    payload = rounded({
        "version": 1,
        "strategyId": "PENGU_V46_VOLUME_FLOOR_060_RESEARCH_V1",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "neighborPass": neighbor_pass,
        "concentrationPass": concentration_pass,
        "combinedPass": combined_pass,
        "baselineFloor": 0.80,
        "leadFloor": 0.60,
        "results": results,
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "The volume-floor lead was discovered on already inspected history; it is not independent holdout evidence.",
            "2026H1 is reused evidence.",
            "Promotion requires a new strategy ID, frozen config fingerprint and fresh Forward Shadow clock.",
            "The current V96/PENGU Production and Operator Override settings are unchanged.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-pengu-volume-floor-validation.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# V96 PENGU Volume-floor Validation",
        "",
        f"- Status: **{status}**",
        f"- Neighbor stability: **{'PASS' if neighbor_pass else 'FAIL'}**",
        f"- Concentration/removal tests: **{'PASS' if concentration_pass else 'FAIL'}**",
        f"- Core integration at PENGU Gross 0.15: **{'PASS' if combined_pass else 'FAIL'}**",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Volume floor | Trades | Normal | Severe | Extreme | 2026H1 | Best trade removed severe | Best month removed severe | Combined G0.15 | Combined severe |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in payload["results"]:
        report.append(
            f"| {item['floor']} | {item['normal']['trades']} | {item['normal']['returnPct']}% | {item['severe']['returnPct']}% | "
            f"{item['extreme']['returnPct']}% | {item['reused2026H1']['returnPct']}% | "
            f"{item['removeBestTradeSevere']['returnPct']}% | {item['removeBestMonthSevere']['returnPct']}% | "
            f"{item['combinedOperationalGross015']['compoundedReturnPct']}% | {item['combinedOperationalGross015Severe']['compoundedReturnPct']}% |"
        )
    report.extend([
        "",
        "The 0.60 floor is a historical Shadow lead only. No runtime gate is changed by this validation.",
    ])
    (state_dir / "v96-pengu-volume-floor-validation.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
