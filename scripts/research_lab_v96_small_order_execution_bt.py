from __future__ import annotations

import datetime as dt
import json
import math
import os
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v35_strong_growth_v86 as v86
import research_lab_v35_turnover_stabilizer_v89 as v89
import research_lab_v35_weight_band_strong_v95 as v95
import research_lab_v35_weight_band_v90 as v90

core = v69.core
SYMBOLS = tuple(core.v4.SYMBOLS)
CASH_RESERVE_PCT = 2.0
REBALANCE_TOLERANCE_PCT = 1.0
STARTING_EQUITIES = (50.0, 100.0, 250.0, 500.0, 1000.0)


@dataclass(frozen=True)
class Policy:
    policy_id: str
    minimum_order_usd: float
    use_equity_tolerance: bool = True
    residual_mode: bool = False


POLICIES = (
    Policy("CURRENT_MAX_5_OR_1PCT", 5.0, True, False),
    Policy("NET_RESIDUAL_MAX_5_OR_1PCT", 5.0, True, True),
    Policy("MAX_3_OR_1PCT", 3.0, True, False),
    Policy("MAX_2_OR_1PCT", 2.0, True, False),
    Policy("FIXED_5_NO_1PCT", 5.0, False, False),
)

SCENARIOS = {
    "NORMAL": {"delay_bars": 0, "turnover_cost_bps": 10.0, "adverse_bps_per_bucket": 0.0},
    "SEVERE": {"delay_bars": 1, "turnover_cost_bps": 50.0, "adverse_bps_per_bucket": 3.0},
}


def finite(value: object, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def gross(weights: Dict[str, float]) -> float:
    return sum(abs(finite(value)) for value in weights.values())


def build_target_series(raw: dict) -> tuple[Dict[str, Dict[int, Dict[str, float]]], dict]:
    times = raw["times"]
    targets, stabilization = v90.stabilize(raw["targets"], times, v95.TARGET_CONFIG)

    normal_core = core.v32.core_series(
        targets, times, raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0
    )
    severe_core = core.v32.core_series(
        targets, times, raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3
    )
    features = core.v34.features_with_vol(
        times, targets, raw["bars"], raw["indexes"], raw["funding"]
    )
    config = core.CoreConfig()
    normal_base_rows = core.core_rows(config, times, normal_core, features)
    severe_base_rows = core.core_rows(config, times, severe_core, features)
    context = v89.context_for(targets, raw, normal_core, features)
    normal_rows, normal_diag = v86.controlled_core(normal_base_rows, context, v95.STRONG_CONFIG)
    severe_rows, severe_diag = v86.controlled_core(severe_base_rows, context, v95.STRONG_CONFIG)
    row_maps = {
        "NORMAL": {int(row["ts"]): row for row in normal_rows},
        "SEVERE": {int(row["ts"]): row for row in severe_rows},
    }

    result: Dict[str, Dict[int, Dict[str, float]]] = {"NORMAL": {}, "SEVERE": {}}
    for scenario, settings in SCENARIOS.items():
        delay = int(settings["delay_bars"])
        for position, ts in enumerate(times):
            source = position - 1 - delay
            desired = dict(targets.get(times[source], {})) if source >= 0 else {}
            desired_gross = gross(desired)
            final_gross = finite(row_maps[scenario].get(ts, {}).get("gross"))
            scale = final_gross / desired_gross if desired_gross > 1e-12 else 0.0
            result[scenario][int(ts)] = {
                symbol: finite(weight) * scale
                for symbol, weight in desired.items()
                if abs(finite(weight) * scale) > 1e-12
            }

    return result, {
        "stabilization": stabilization,
        "normalControl": normal_diag,
        "severeControl": severe_diag,
    }


def tolerance_usd(policy: Policy, equity: float) -> float:
    if not policy.use_equity_tolerance:
        return policy.minimum_order_usd
    return max(policy.minimum_order_usd, equity * REBALANCE_TOLERANCE_PCT / 100.0)


def annual_returns(rows: List[dict]) -> Dict[str, float]:
    grouped: Dict[str, List[float]] = {}
    for row in rows:
        year = str(dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=dt.timezone.utc).year)
        grouped.setdefault(year, []).append(finite(row["return"]))
    result: Dict[str, float] = {}
    for year, values in grouped.items():
        equity = 1.0
        for value in values:
            equity *= max(0.001, 1.0 + value)
        result[year] = (equity - 1.0) * 100.0
    return result


def simulate(
    raw: dict,
    target_series: Dict[int, Dict[str, float]],
    policy: Policy,
    scenario: str,
    starting_equity: float,
) -> dict:
    settings = SCENARIOS[scenario]
    quantities = {symbol: 0.0 for symbol in SYMBOLS}
    equity = peak = starting_equity
    rows: List[dict] = []
    order_count = 0
    rebalance_buckets = 0
    suppressed_adjustments = 0
    target_adjustments = 0
    total_traded_usd = 0.0
    total_turnover_cost_usd = 0.0
    total_adverse_cost_usd = 0.0
    total_funding_usd = 0.0
    tracking_errors_pct: List[float] = []
    order_sizes: List[float] = []
    residuals = {symbol: 0.0 for symbol in SYMBOLS}

    for ts in raw["times"]:
        prices_open: Dict[str, float] = {}
        prices_close: Dict[str, float] = {}
        valid = True
        for symbol in SYMBOLS:
            index = raw["indexes"][symbol].get(ts)
            if index is None:
                valid = False
                break
            bar = raw["bars"][symbol][index]
            prices_open[symbol] = finite(bar["open"])
            prices_close[symbol] = finite(bar["close"])
            if prices_open[symbol] <= 0 or prices_close[symbol] <= 0:
                valid = False
                break
        if not valid or equity <= 0:
            continue

        weights = target_series.get(int(ts), {})
        investable_equity = equity * (1.0 - CASH_RESERVE_PCT / 100.0)
        threshold = tolerance_usd(policy, equity)
        bucket_traded = 0.0
        bucket_cost = 0.0

        for symbol in SYMBOLS:
            current_notional = quantities[symbol] * prices_open[symbol]
            target_notional = investable_equity * finite(weights.get(symbol, 0.0))
            gap = target_notional - current_notional
            if abs(gap) > 1e-9:
                target_adjustments += 1

            # A mathematically correct residual is the current net target gap.
            # Re-adding the same sub-threshold gap every tick would double count
            # an unchanged target and eventually overshoot it, so it is not tested.
            if policy.residual_mode:
                residuals[symbol] = gap
                candidate = residuals[symbol]
            else:
                candidate = gap

            if abs(candidate) + 1e-9 < threshold:
                if abs(candidate) > 1e-9:
                    suppressed_adjustments += 1
                continue

            order_notional = gap
            if abs(order_notional) <= 1e-9:
                continue
            quantities[symbol] += order_notional / prices_open[symbol]
            if policy.residual_mode:
                residuals[symbol] = 0.0
            order_count += 1
            order_sizes.append(abs(order_notional))
            bucket_traded += abs(order_notional)
            cost = abs(order_notional) * finite(settings["turnover_cost_bps"]) / 10_000.0
            bucket_cost += cost

        if bucket_traded > 0:
            rebalance_buckets += 1
        equity -= bucket_cost
        total_traded_usd += bucket_traded
        total_turnover_cost_usd += bucket_cost

        post_trade_error = 0.0
        gross_exposure_usd = 0.0
        pnl_usd = 0.0
        funding_usd = 0.0
        for symbol in SYMBOLS:
            open_price = prices_open[symbol]
            close_price = prices_close[symbol]
            current_notional = quantities[symbol] * open_price
            target_notional = investable_equity * finite(weights.get(symbol, 0.0))
            post_trade_error += abs(target_notional - current_notional)
            gross_exposure_usd += abs(current_notional)
            pnl_usd += quantities[symbol] * (close_price - open_price)
            funding_pct = finite(raw["funding"].get(symbol, {}).get(ts, 0.0))
            funding_usd += current_notional * funding_pct / 100.0

        adverse_cost = gross_exposure_usd * finite(settings["adverse_bps_per_bucket"]) / 10_000.0
        equity_before_return = max(1e-9, equity)
        equity += pnl_usd - funding_usd - adverse_cost
        bucket_return = equity / equity_before_return - 1.0
        peak = max(peak, equity)
        drawdown = equity / peak - 1.0 if peak > 0 else -1.0
        tracking_error_pct = post_trade_error / max(1e-9, investable_equity) * 100.0
        tracking_errors_pct.append(tracking_error_pct)
        total_adverse_cost_usd += adverse_cost
        total_funding_usd += funding_usd
        rows.append({
            "ts": int(ts),
            "return": bucket_return,
            "equity": equity,
            "drawdown": drawdown,
            "trackingErrorPct": tracking_error_pct,
        })
        if equity <= 0:
            break

    returns = [finite(row["return"]) for row in rows]
    positive = sum(value > 0 for value in returns)
    gains = sum(max(value, 0.0) for value in returns)
    losses = sum(max(-value, 0.0) for value in returns)
    elapsed_years = max(0.25, (core.CORE_END - core.CORE_START) / (365.25 * core.DAY))
    final_equity = equity
    compounded_return_pct = (final_equity / starting_equity - 1.0) * 100.0
    cagr_pct = ((max(1e-9, final_equity / starting_equity)) ** (1.0 / elapsed_years) - 1.0) * 100.0
    return {
        "policyId": policy.policy_id,
        "scenario": scenario,
        "startingEquityUsd": starting_equity,
        "finalEquityUsd": final_equity,
        "compoundedReturnPct": compounded_return_pct,
        "cagrPct": cagr_pct,
        "maxDrawdownPct": min((finite(row["drawdown"]) for row in rows), default=0.0) * 100.0,
        "bucketProfitFactor": gains / losses if losses > 0 else 999.0 if gains > 0 else None,
        "positive12hBucketRatePct": positive / len(returns) * 100.0 if returns else None,
        "completed12hBuckets": len(rows),
        "orders": order_count,
        "rebalanceBuckets": rebalance_buckets,
        "targetAdjustments": target_adjustments,
        "suppressedAdjustments": suppressed_adjustments,
        "suppressionRatePct": suppressed_adjustments / target_adjustments * 100.0 if target_adjustments else 0.0,
        "totalTradedNotionalUsd": total_traded_usd,
        "averageOrderUsd": statistics.fmean(order_sizes) if order_sizes else 0.0,
        "minimumOrderUsd": min(order_sizes) if order_sizes else 0.0,
        "turnoverCostUsd": total_turnover_cost_usd,
        "adverseCostUsd": total_adverse_cost_usd,
        "netFundingUsd": total_funding_usd,
        "averageTrackingErrorPct": statistics.fmean(tracking_errors_pct) if tracking_errors_pct else 0.0,
        "maximumTrackingErrorPct": max(tracking_errors_pct, default=0.0),
        "annualReturnsPct": annual_returns(rows),
    }


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    state_dir.mkdir(parents=True, exist_ok=True)
    raw = v89.build_raw()
    target_series, construction = build_target_series(raw)

    results: List[dict] = []
    for scenario in SCENARIOS:
        for starting_equity in STARTING_EQUITIES:
            for policy in POLICIES:
                results.append(simulate(
                    raw=raw,
                    target_series=target_series[scenario],
                    policy=policy,
                    scenario=scenario,
                    starting_equity=starting_equity,
                ))

    lookup = {
        (item["scenario"], item["startingEquityUsd"], item["policyId"]): item
        for item in results
    }
    comparisons: List[dict] = []
    for item in results:
        baseline = lookup[(item["scenario"], item["startingEquityUsd"], "CURRENT_MAX_5_OR_1PCT")]
        comparisons.append({
            **item,
            "deltaReturnPctPointsVsCurrent": item["compoundedReturnPct"] - baseline["compoundedReturnPct"],
            "deltaMaxDrawdownPctPointsVsCurrent": item["maxDrawdownPct"] - baseline["maxDrawdownPct"],
            "deltaOrdersVsCurrent": item["orders"] - baseline["orders"],
            "deltaTrackingErrorPctPointsVsCurrent": item["averageTrackingErrorPct"] - baseline["averageTrackingErrorPct"],
        })

    residual_equivalent = all(
        abs(
            lookup[(scenario, equity, "NET_RESIDUAL_MAX_5_OR_1PCT")]["compoundedReturnPct"]
            - lookup[(scenario, equity, "CURRENT_MAX_5_OR_1PCT")]["compoundedReturnPct"]
        ) < 1e-10
        and lookup[(scenario, equity, "NET_RESIDUAL_MAX_5_OR_1PCT")]["orders"]
        == lookup[(scenario, equity, "CURRENT_MAX_5_OR_1PCT")]["orders"]
        for scenario in SCENARIOS
        for equity in STARTING_EQUITIES
    )

    payload = rounded({
        "version": 1,
        "strategyId": "V96_SMALL_ORDER_EXECUTION_THRESHOLD_BT_V1",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "historicalWindow": {
            "start": dt.datetime.fromtimestamp(core.CORE_START / 1000, tz=dt.timezone.utc).isoformat(),
            "end": dt.datetime.fromtimestamp(core.CORE_END / 1000, tz=dt.timezone.utc).isoformat(),
        },
        "scope": "V96 non-PENGU Core execution tracking at account-size level",
        "residualAccumulatorEquivalentToCurrentGapTracking": residual_equivalent,
        "constructionDiagnostics": construction,
        "policies": [policy.__dict__ for policy in POLICIES],
        "scenarios": SCENARIOS,
        "results": comparisons,
        "safety": {
            "researchOnly": True,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "This test isolates the small-order execution layer for the BTC/ETH/BNB/SOL V96 Core. PENGU is excluded because the observed no-change case was an ETH Core adjustment.",
            "The test uses historical Aster 12-hour candles and Funding with the frozen V95/V96 target and control stack.",
            "A correctly netted residual accumulator equals the existing current-target gap; repeatedly adding an unchanged 0.8 USD gap would double count and overshoot the target.",
            "Thresholds below 5 USD are executable only when the exchange symbol filters permit them.",
            "Historical improvement does not authorize Production promotion.",
        ],
    })
    (state_dir / "v96-small-order-execution-bt.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    lines = [
        "# V96 Small-order Execution Threshold Backtest",
        "",
        f"- Window: {payload['historicalWindow']['start']} through {payload['historicalWindow']['end']}",
        "- Scope: BTC / ETH / BNB / SOL V96 Core",
        f"- Correct residual accumulator equals current gap tracking: **{'YES' if residual_equivalent else 'NO'}**",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "## Results",
        "",
        "| Scenario | Start USD | Policy | Return % | Delta pp | DD % | PF | Orders | Suppressed % | Avg tracking % |",
        "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in comparisons:
        lines.append(
            f"| {item['scenario']} | {item['startingEquityUsd']:.0f} | {item['policyId']} | "
            f"{item['compoundedReturnPct']:.4f} | {item['deltaReturnPctPointsVsCurrent']:.4f} | "
            f"{item['maxDrawdownPct']:.4f} | {finite(item['bucketProfitFactor']):.4f} | "
            f"{item['orders']} | {item['suppressionRatePct']:.2f} | {item['averageTrackingErrorPct']:.4f} |"
        )
    lines.extend([
        "",
        "## Interpretation guard",
        "",
        "- A net residual is already represented by target notional minus current notional.",
        "- Repeatedly adding the same unchanged sub-threshold gap is invalid because it double counts the same desired adjustment.",
        "- A lower threshold is considered only if exchange filters permit it and Severe cost/DD do not materially worsen.",
    ])
    report = "\n".join(lines)
    (state_dir / "v96-small-order-execution-bt.md").write_text(report, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + report)
    print(report)


if __name__ == "__main__":
    main()
