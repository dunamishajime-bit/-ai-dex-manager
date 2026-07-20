from __future__ import annotations

import datetime as dt
import json
import os
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
from typing import List

import research_lab_major_core_nested_v73 as stats
import research_lab_major_pengu_balanced_v74 as balance
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_v35_fixed_signal_nested_risk_v75 as v75

BAR = 12 * stats.HOUR
TOTAL_GROSS_CAP = 2.0
FIELDS = ("base_pct", "severe_pct", "excluded_base_pct", "excluded_severe_pct")


def safe_rows(rows: List[dict]) -> List[dict]:
    result = []
    for row in rows:
        item = dict(row)
        item.setdefault("turnover", 0.0)
        item.setdefault("stops", 0)
        result.append(item)
    return result


def combine_safe(core_rows, series, field, config):
    return safe_rows(balance.combine_rows(core_rows, series, field, config))


def metrics(rows, start, end):
    return balance.metrics(safe_rows(rows), start, end)


def scenario(core_normal, core_severe, pengu_rows, trades, config, start, end):
    series = balance.pengu_series(pengu_rows, trades)
    return {
        "full": metrics(combine_safe(core_normal, series, "base", config), start, end),
        "severe": metrics(combine_safe(core_severe, series, "severe", config), start, end),
        "excluded": metrics(combine_safe(core_normal, series, "excludedBase", config), start, end),
        "excludedSevere": metrics(combine_safe(core_severe, series, "excludedSevere", config), start, end),
    }


def rounded(value):
    return stats.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    core_payload = json.loads((state_dir / "v35-fixed-signal-nested-risk-v75.json").read_text(encoding="utf-8"))
    v57_payload = json.loads((state_dir / "pengu-wave-sleeve-v57.json").read_text(encoding="utf-8"))
    v67_payload = json.loads((state_dir / "pengu-v67-distribution-floor.json").read_text(encoding="utf-8"))

    bars, funding, times, _coverage = stats.fetch_data()
    features = stats.build_features(bars)
    targets, _v35_features = v75.build_v35_fixed_targets(bars, funding, times)
    risk = stats.RiskConfig(**core_payload["selectedRisk"])
    core_normal = safe_rows(v75.simulate(targets, risk, bars, features, funding, times, False))
    core_severe = safe_rows(v75.simulate(targets, risk, bars, features, funding, times, True))

    full_start, full_end = times[0], times[-1] + BAR
    holdout_start = int(dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    original_start = v47.START
    v47.START = int(dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    pengu_rows = v47.fetch_klines("PENGUUSDT", full_end)
    v47.START = original_start

    long_trades = [deepcopy(trade) for trade in v57_payload["longTrades"] if bool(trade.get("confirmed"))]
    long_trades = balance.add_long_exclusions(long_trades, pengu_rows)
    short_trades = [deepcopy(trade) for trade in v67_payload["aster"]["trades"]]
    for trade in short_trades:
        trade.setdefault("excluded_base_pct", trade.get("base_pct", 0.0))
        trade.setdefault("excluded_severe_pct", trade.get("severe_pct", 0.0))

    core_full = metrics(core_normal, full_start, full_end)
    core_severe_full = metrics(core_severe, full_start, full_end)
    candidate_results = {}
    for config in balance.balance_space():
        scaled_long = [balance.rescale_trade(trade, config.long_scale, FIELDS) for trade in long_trades]
        scaled_short = [balance.rescale_trade(trade, config.short_scale, FIELDS) for trade in short_trades]
        trades = balance.combine_pengu_trades(scaled_long, scaled_short)
        series = balance.pengu_series(pengu_rows, trades)
        normal = combine_safe(core_normal, series, "base", config)
        severe = combine_safe(core_severe, series, "severe", config)
        excluded = combine_safe(core_normal, series, "excludedBase", config)
        excluded_severe = combine_safe(core_severe, series, "excludedSevere", config)
        candidate_results[config.config_id] = {
            "config": asdict(config),
            "full": metrics(normal, full_start, full_end),
            "fullSevere": metrics(severe, full_start, full_end),
            "excluded": metrics(excluded, full_start, full_end),
            "excludedSevere": metrics(excluded_severe, full_start, full_end),
            "holdout": metrics(normal, holdout_start, full_end),
            "holdoutSevere": metrics(severe, holdout_start, full_end),
            "holdoutExcluded": metrics(excluded, holdout_start, full_end),
            "holdoutExcludedSevere": metrics(excluded_severe, holdout_start, full_end),
            "trades": trades,
        }

    passed = []
    if core_payload.get("robustPass", False):
        for key, item in candidate_results.items():
            if (
                item["full"]["compoundedReturnPct"] > core_full["compoundedReturnPct"]
                and item["excluded"]["compoundedReturnPct"] >= core_full["compoundedReturnPct"]
                and item["fullSevere"]["compoundedReturnPct"] > 0
                and item["excludedSevere"]["compoundedReturnPct"] > 0
                and item["full"]["maxDrawdownPct"] >= core_full["maxDrawdownPct"] - 2.0
                and item["full"]["observedMaxConcurrentGross"] <= TOTAL_GROSS_CAP + 1e-9
                and item["holdout"]["compoundedReturnPct"] > 0
                and item["holdoutSevere"]["compoundedReturnPct"] >= 0
                and item["holdoutExcluded"]["compoundedReturnPct"] >= 0
                and item["holdoutExcludedSevere"]["compoundedReturnPct"] >= 0
            ):
                passed.append(key)
    passed.sort(key=lambda key: (
        candidate_results[key]["excludedSevere"]["compoundedReturnPct"],
        candidate_results[key]["excluded"]["compoundedReturnPct"],
        candidate_results[key]["fullSevere"]["compoundedReturnPct"],
        candidate_results[key]["full"]["compoundedReturnPct"],
        candidate_results[key]["full"]["maxDrawdownPct"],
        -candidate_results[key]["config"]["long_scale"],
        -candidate_results[key]["config"]["short_scale"],
    ), reverse=True)
    selected_id = passed[0] if passed else None
    selected = candidate_results[selected_id] if selected_id else None

    concentration = None
    if selected:
        config = balance.BalanceConfig(**selected["config"])
        without_best, best_trade = balance.zero_best_trade(selected["trades"], FIELDS)
        without_month, best_month = balance.zero_best_month(selected["trades"], FIELDS)
        concentration = {
            "removeBestTrade": {
                "trade": best_trade,
                "result": scenario(core_normal, core_severe, pengu_rows, without_best, config, full_start, full_end),
            },
            "removeBestMonth": {
                "month": best_month,
                "result": scenario(core_normal, core_severe, pengu_rows, without_month, config, full_start, full_end),
            },
        }

    status = "V35_PENGU_BALANCED_FULL_PASS" if selected else "NO_V35_PENGU_BALANCED_PORTFOLIO"
    result = rounded({
        "version": 76,
        "strategyId": "V35_FIXED_CORE_PLUS_PENGU_BALANCED_V76",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "selected": selected_id,
        "v35CoreRobustPass": core_payload.get("robustPass", False),
        "v35Core": {"full": core_full, "fullSevere": core_severe_full},
        "pengu": {
            "confirmedLongTrades": len(long_trades),
            "v67ShortTrades": len(short_trades),
            "longStandalone": balance.trade_metrics(long_trades, "base_pct"),
            "shortStandalone": balance.trade_metrics(short_trades, "base_pct"),
        },
        "candidateCount": len(candidate_results),
        "passed": passed,
        "selectedResult": selected,
        "concentrationStress": concentration,
        "riskSpecification": {
            "portfolioGrossCap": TOTAL_GROSS_CAP,
            "cashReservePct": v75.CASH_RESERVE * 100.0,
            "core": core_payload["riskSpecification"],
            "penguLong": {
                "baseMaxGross": 0.15,
                "confirmedOnly": True,
                "unconfirmedProbe": "DISABLED",
                "hardStopAtr": 1.2,
                "partialTakeProfitAtr": 2.0,
                "trailAtr": 1.8,
                "maximumHoldHours": 24,
                "funding": "Fail closed when missing or above Long cap.",
            },
            "penguShort": {
                "distributionFloorGross": 0.10,
                "qualifyingGross": 0.30,
                "flashHardStopAtr": 3.5,
                "flashHoldHours": 36,
                "distributionHardStopAtr": 2.5,
                "distributionHoldHours": 24,
                "funding": "Independent of missing Funding.",
            },
            "conflict": "PENGU Long and Short never overlap; Short priority.",
            "grossPriority": "V35 Core receives capacity first; PENGU is clipped to total Gross <=2.0.",
            "drawdownBrake": "At selected threshold Core/PENGU scale 0.85/0.60; an additional 8% DD scales 0.65/0.35.",
            "reversal": "Close reduce-only first; open opposite direction on the next tick.",
        },
        "validation": {
            "largeWaveIncludedAndExcluded": True,
            "primaryMetric": "Large-wave-excluded Severe, then excluded normal.",
            "forwardFreeze": core_payload["forwardFreeze"],
        },
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
        "limitations": [
            "PENGU V57/V67 are historical research evidence and not pristine forward evidence.",
            "No PENGU allocation is promoted unless the fixed V35 Core passes V75 anti-overfit gates.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-pengu-balanced-v76.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# V35 Fixed Core + PENGU Balanced V76",
        "",
        f"- Status: **{status}**",
        f"- Selected: **{selected_id or 'NONE'}**",
        f"- V35 Core robust pass: **{'YES' if result['v35CoreRobustPass'] else 'NO'}**",
        f"- V35 Core: {core_full['compoundedReturnPct']}% / Severe {core_severe_full['compoundedReturnPct']}% / DD {core_full['maxDrawdownPct']}%",
    ]
    if selected:
        report.extend([
            f"- Combined: {selected['full']['compoundedReturnPct']}% / CAGR {selected['full']['cagrPct']}% / DD {selected['full']['maxDrawdownPct']}%",
            f"- Combined Severe: {selected['fullSevere']['compoundedReturnPct']}% / DD {selected['fullSevere']['maxDrawdownPct']}%",
            f"- Large-wave excluded: {selected['excluded']['compoundedReturnPct']}%",
            f"- Large-wave excluded Severe: {selected['excludedSevere']['compoundedReturnPct']}%",
            f"- Holdout: {selected['holdout']['compoundedReturnPct']}% / Severe {selected['holdoutSevere']['compoundedReturnPct']}%",
            f"- Holdout excluded: {selected['holdoutExcluded']['compoundedReturnPct']}% / Severe {selected['holdoutExcludedSevere']['compoundedReturnPct']}%",
            f"- Observed max Gross: {selected['full']['observedMaxConcurrentGross']}",
        ])
    report.extend(["", "- Production / LIVE / VPS changed: **NO**"])
    (state_dir / "v35-pengu-balanced-v76.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
