from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_v35_weight_band_strong_v95 as v95
import research_lab_v96_core_profit_capture_screen as r1

core = v95.core
SYMBOLS = r1.SYMBOLS
BAR = r1.BAR
DEV_END = r1.DEV_END
VALIDATION_END = r1.VALIDATION_END
NORMAL_COST_BPS = 10.0
SEVERE_COST_BPS = 50.0
HORIZONS = (1, 2, 4, 7, 14)
MIN_TREND_BARS = 2
LOW_SIZE_RATIO = 0.75


def side_of(value: float) -> int:
    return 1 if value > 1e-12 else -1 if value < -1e-12 else 0


def compounded_signed(returns: List[float], side: int) -> float:
    equity = 1.0
    for value in returns:
        equity *= max(0.001, 1.0 + side * float(value))
    return equity - 1.0


def period_name(ts: int) -> str:
    if ts < DEV_END:
        return "development2023_2024"
    if ts < VALIDATION_END:
        return "validation2025"
    return "diagnostic2026H1"


def safe_mean(values: List[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def safe_median(values: List[float]) -> float:
    return statistics.median(values) if values else 0.0


def build_exact_baseline(raw: dict) -> dict:
    times = list(raw["times"])
    targets, target_diag = v95.v90.stabilize(raw["targets"], times, v95.TARGET_CONFIG)
    base_core = core.v32.core_series(
        targets, times, raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0
    )
    severe_core = core.v32.core_series(
        targets, times, raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3
    )
    features = core.v34.features_with_vol(
        times, targets, raw["bars"], raw["indexes"], raw["funding"]
    )
    base_rows = core.core_rows(core.CoreConfig(), times, base_core, features)
    severe_rows = core.core_rows(core.CoreConfig(), times, severe_core, features)
    context = v95.v89.context_for(targets, raw, base_core, features)
    normal_controlled, normal_diag = v95.v86.controlled_core(
        base_rows, context, v95.STRONG_CONFIG
    )
    severe_controlled, severe_diag = v95.v86.controlled_core(
        severe_rows, context, v95.STRONG_CONFIG
    )
    normal_map = {int(row["ts"]): row for row in normal_controlled}
    severe_map = {int(row["ts"]): row for row in severe_controlled}

    normal_weights: Dict[int, Dict[str, float]] = {}
    severe_weights: Dict[int, Dict[str, float]] = {}
    raw_targets: Dict[int, Dict[str, float]] = {}
    for position, ts in enumerate(times):
        normal_weights[ts] = r1.baseline_weights(
            targets, times, position, base_core, features, normal_map, 0
        )
        severe_weights[ts] = r1.baseline_weights(
            targets, times, position, severe_core, features, severe_map, 1
        )
        source = position - 1
        raw_targets[ts] = dict(targets.get(times[source], {})) if source >= 0 else {}

    max_normal_diff = 0.0
    max_severe_diff = 0.0
    previous_normal: Dict[str, float] = {}
    previous_severe: Dict[str, float] = {}
    for ts in times:
        normal_recon = r1.reconstructed_return(
            normal_weights[ts], previous_normal, raw, ts, NORMAL_COST_BPS, 0.0
        )
        severe_recon = r1.reconstructed_return(
            severe_weights[ts], previous_severe, raw, ts, SEVERE_COST_BPS, 3.0
        )
        max_normal_diff = max(
            max_normal_diff,
            abs(normal_recon - float(normal_map.get(ts, {}).get("return", 0.0))),
        )
        max_severe_diff = max(
            max_severe_diff,
            abs(severe_recon - float(severe_map.get(ts, {}).get("return", 0.0))),
        )
        previous_normal = dict(normal_weights[ts])
        previous_severe = dict(severe_weights[ts])

    return {
        "times": times,
        "targets": targets,
        "rawTargets": raw_targets,
        "baseCore": base_core,
        "severeCore": severe_core,
        "features": features,
        "context": context,
        "normalControlled": normal_controlled,
        "severeControlled": severe_controlled,
        "normalWeights": normal_weights,
        "severeWeights": severe_weights,
        "targetDiagnostics": target_diag,
        "controlDiagnostics": {"normal": normal_diag, "severe": severe_diag},
        "baselineParity": {
            "maximumNormalBarDifference": max_normal_diff,
            "maximumSevereBarDifference": max_severe_diff,
        },
    }


def symbol_bars(raw: dict, baseline: dict, symbol: str) -> List[dict]:
    rows: List[dict] = []
    previous_normal = 0.0
    previous_severe = 0.0
    for ts in baseline["times"]:
        normal_weight = float(baseline["normalWeights"][ts].get(symbol, 0.0))
        severe_weight = float(baseline["severeWeights"][ts].get(symbol, 0.0))
        raw_target = float(baseline["rawTargets"][ts].get(symbol, 0.0))
        price_return = r1.price_return(raw, symbol, ts)
        funding = r1.funding_rate(raw, symbol, ts)
        normal_turnover = abs(normal_weight - previous_normal)
        severe_turnover = abs(severe_weight - previous_severe)
        rows.append({
            "ts": ts,
            "iso": dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).isoformat(),
            "period": period_name(ts),
            "priceReturn": price_return,
            "normalWeight": normal_weight,
            "severeWeight": severe_weight,
            "rawTargetWeight": raw_target,
            "normalPriceContribution": normal_weight * price_return,
            "severePriceContribution": severe_weight * price_return,
            "normalFundingContribution": -normal_weight * funding,
            "severeFundingContribution": -severe_weight * funding,
            "normalTurnoverCost": -normal_turnover * NORMAL_COST_BPS / 10_000.0,
            "severeTurnoverCost": -severe_turnover * SEVERE_COST_BPS / 10_000.0,
            "normalAdverseCost": 0.0,
            "severeAdverseCost": -abs(severe_weight) * 3.0 / 10_000.0,
        })
        previous_normal = normal_weight
        previous_severe = severe_weight
    return rows


def build_trend_runs(rows: List[dict], median_active_weight: float) -> List[dict]:
    runs: List[dict] = []
    start = 0
    while start < len(rows):
        side = side_of(float(rows[start]["priceReturn"]))
        if side == 0:
            start += 1
            continue
        end = start + 1
        while end < len(rows) and side_of(float(rows[end]["priceReturn"])) == side:
            end += 1
        chunk = rows[start:end]
        if len(chunk) >= MIN_TREND_BARS:
            returns = [float(row["priceReturn"]) for row in chunk]
            opportunity = compounded_signed(returns, side)
            states = []
            aligned_indices = []
            opposed_indices = []
            flat_indices = []
            aligned_weights = []
            for index, row in enumerate(chunk):
                weight_side = side_of(float(row["normalWeight"]))
                if weight_side == side:
                    state = "ALIGNED"
                    aligned_indices.append(index)
                    aligned_weights.append(abs(float(row["normalWeight"])))
                elif weight_side == 0:
                    state = "FLAT"
                    flat_indices.append(index)
                else:
                    state = "OPPOSED"
                    opposed_indices.append(index)
                states.append(state)

            first_aligned: Optional[int] = min(aligned_indices) if aligned_indices else None
            last_aligned: Optional[int] = max(aligned_indices) if aligned_indices else None
            delayed = first_aligned is not None and first_aligned > 0
            early = last_aligned is not None and last_aligned < len(chunk) - 1
            avg_aligned_weight = safe_mean(aligned_weights)

            if not aligned_indices and opposed_indices:
                primary = "WRONG_DIRECTION"
            elif not aligned_indices:
                primary = "COMPLETELY_MISSED"
            elif len(opposed_indices) >= len(aligned_indices):
                primary = "WRONG_DIRECTION_MIXED"
            elif delayed and early:
                primary = "ENTRY_DELAY_AND_EARLY_EXIT"
            elif delayed:
                primary = "ENTRY_DELAY"
            elif early:
                primary = "EARLY_EXIT"
            elif opposed_indices:
                primary = "MIXED_DIRECTION"
            elif (
                median_active_weight > 0
                and avg_aligned_weight < median_active_weight * LOW_SIZE_RATIO
            ):
                primary = "LOW_SIZE"
            else:
                primary = "ALIGNED"

            normal_price = sum(float(row["normalPriceContribution"]) for row in chunk)
            severe_price = sum(float(row["severePriceContribution"]) for row in chunk)
            aligned_abs_capture = sum(
                abs(float(row["normalWeight"])) * abs(float(row["priceReturn"]))
                for row, state in zip(chunk, states)
                if state == "ALIGNED"
            )
            size_shortfall = sum(
                max(0.0, median_active_weight - abs(float(row["normalWeight"])))
                * abs(float(row["priceReturn"]))
                for row, state in zip(chunk, states)
                if state == "ALIGNED"
            )
            periods = sorted(set(str(row["period"]) for row in chunk))
            runs.append({
                "startTs": int(chunk[0]["ts"]),
                "endTs": int(chunk[-1]["ts"]) + BAR,
                "startIso": str(chunk[0]["iso"]),
                "endIso": dt.datetime.fromtimestamp(
                    (int(chunk[-1]["ts"]) + BAR) / 1000, tz=dt.timezone.utc
                ).isoformat(),
                "entryPeriod": str(chunk[0]["period"]),
                "periods": periods,
                "side": side,
                "bars": len(chunk),
                "opportunityPct": opportunity * 100.0,
                "primaryCause": primary,
                "alignedBars": len(aligned_indices),
                "flatBars": len(flat_indices),
                "opposedBars": len(opposed_indices),
                "entryDelayBars": first_aligned if first_aligned is not None else len(chunk),
                "earlyExitBars": (
                    len(chunk) - 1 - last_aligned if last_aligned is not None else len(chunk)
                ),
                "averageAlignedWeight": avg_aligned_weight,
                "medianActiveWeightReference": median_active_weight,
                "normalWeightedPriceContributionPct": normal_price * 100.0,
                "severeWeightedPriceContributionPct": severe_price * 100.0,
                "alignedAbsoluteCapturePct": aligned_abs_capture * 100.0,
                "sizeShortfallVsMedianPct": size_shortfall * 100.0,
                "flags": {
                    "entryDelay": bool(first_aligned is None or first_aligned > 0),
                    "earlyExit": bool(last_aligned is None or last_aligned < len(chunk) - 1),
                    "wrongDirection": bool(opposed_indices),
                    "flatDuringTrend": bool(flat_indices),
                    "lowSize": bool(
                        aligned_indices
                        and median_active_weight > 0
                        and avg_aligned_weight < median_active_weight * LOW_SIZE_RATIO
                    ),
                },
            })
        start = end
    return runs


def build_episodes(rows: List[dict]) -> List[dict]:
    episodes: List[dict] = []
    index = 0
    while index < len(rows):
        side = side_of(float(rows[index]["normalWeight"]))
        if side == 0:
            index += 1
            continue
        start = index
        end = start + 1
        while end < len(rows) and side_of(float(rows[end]["normalWeight"])) == side:
            end += 1
        chunk = rows[start:end]
        item = {
            "side": side,
            "startIndex": start,
            "endIndexExclusive": end,
            "entryTs": int(chunk[0]["ts"]),
            "exitTs": int(chunk[-1]["ts"]) + BAR,
            "entryIso": str(chunk[0]["iso"]),
            "exitIso": dt.datetime.fromtimestamp(
                (int(chunk[-1]["ts"]) + BAR) / 1000, tz=dt.timezone.utc
            ).isoformat(),
            "entryPeriod": str(chunk[0]["period"]),
            "bars": len(chunk),
            "holdingMovePct": compounded_signed(
                [float(row["priceReturn"]) for row in chunk], side
            ) * 100.0,
            "normalWeightedPriceContributionPct": sum(
                float(row["normalPriceContribution"]) for row in chunk
            ) * 100.0,
            "averageWeight": safe_mean(
                [abs(float(row["normalWeight"])) for row in chunk]
            ),
            "preEntry": {},
            "postExit": {},
        }
        for horizon in HORIZONS:
            prior = rows[max(0, start - horizon):start]
            after = rows[end:min(len(rows), end + horizon)]
            item["preEntry"][str(horizon)] = (
                compounded_signed([float(row["priceReturn"]) for row in prior], side) * 100.0
                if prior else 0.0
            )
            item["postExit"][str(horizon)] = (
                compounded_signed([float(row["priceReturn"]) for row in after], side) * 100.0
                if after else 0.0
            )
        episodes.append(item)
        index = end
    return episodes


def aggregate_episode_edges(episodes: List[dict]) -> dict:
    result = {"preEntry": {}, "postExit": {}}
    for field in ("preEntry", "postExit"):
        for horizon in HORIZONS:
            key = str(horizon)
            values = [float(item[field][key]) for item in episodes]
            positive = [value for value in values if value > 0]
            by_period = defaultdict(list)
            for item in episodes:
                value = float(item[field][key])
                if value > 0:
                    by_period[str(item["entryPeriod"])].append(value)
            result[field][key] = {
                "events": len(values),
                "positiveEvents": len(positive),
                "positiveRatePct": len(positive) / len(values) * 100.0 if values else 0.0,
                "sumPositiveMovePct": sum(positive),
                "medianPositiveMovePct": safe_median(positive),
                "periodPositiveMovePct": {
                    period: sum(period_values)
                    for period, period_values in sorted(by_period.items())
                },
            }
    return result


def aggregate_runs(runs: List[dict]) -> dict:
    by_cause = defaultdict(list)
    by_period_cause = defaultdict(list)
    by_side_cause = defaultdict(list)
    flag_totals = defaultdict(float)
    for run in runs:
        cause = str(run["primaryCause"])
        by_cause[cause].append(run)
        by_period_cause[(str(run["entryPeriod"]), cause)].append(run)
        by_side_cause[(str(run["side"]), cause)].append(run)
        for flag, active in run["flags"].items():
            if active:
                flag_totals[flag] += float(run["opportunityPct"])

    cause_rows = []
    for cause, items in by_cause.items():
        periods = sorted(set(str(item["entryPeriod"]) for item in items))
        cause_rows.append({
            "cause": cause,
            "runs": len(items),
            "periods": periods,
            "totalOpportunityPct": sum(float(item["opportunityPct"]) for item in items),
            "normalWeightedPriceContributionPct": sum(
                float(item["normalWeightedPriceContributionPct"]) for item in items
            ),
            "severeWeightedPriceContributionPct": sum(
                float(item["severeWeightedPriceContributionPct"]) for item in items
            ),
            "sizeShortfallVsMedianPct": sum(
                float(item["sizeShortfallVsMedianPct"]) for item in items
            ),
            "medianOpportunityPct": safe_median(
                [float(item["opportunityPct"]) for item in items]
            ),
            "structural": bool(len(items) >= 3 and len(periods) >= 2),
        })
    cause_rows.sort(
        key=lambda item: (
            item["cause"] != "ALIGNED",
            item["structural"],
            item["totalOpportunityPct"],
        ),
        reverse=True,
    )
    period_rows = [
        {
            "period": period,
            "cause": cause,
            "runs": len(items),
            "totalOpportunityPct": sum(float(item["opportunityPct"]) for item in items),
        }
        for (period, cause), items in sorted(by_period_cause.items())
    ]
    side_rows = [
        {
            "side": int(side),
            "cause": cause,
            "runs": len(items),
            "totalOpportunityPct": sum(float(item["opportunityPct"]) for item in items),
        }
        for (side, cause), items in sorted(by_side_cause.items())
    ]
    return {
        "byCause": cause_rows,
        "byPeriodCause": period_rows,
        "bySideCause": side_rows,
        "flagOpportunityPct": dict(sorted(flag_totals.items())),
    }


def bar_state_summary(rows: List[dict]) -> dict:
    states = defaultdict(lambda: {"bars": 0, "absoluteMove": 0.0, "weightedPrice": 0.0})
    for row in rows:
        return_side = side_of(float(row["priceReturn"]))
        weight_side = side_of(float(row["normalWeight"]))
        if return_side == 0:
            state = "ZERO_MOVE"
        elif weight_side == 0:
            state = "FLAT"
        elif weight_side == return_side:
            state = "ALIGNED"
        else:
            state = "OPPOSED"
        states[state]["bars"] += 1
        states[state]["absoluteMove"] += abs(float(row["priceReturn"]))
        states[state]["weightedPrice"] += float(row["normalPriceContribution"])
    return {
        state: {
            "bars": item["bars"],
            "absoluteMovePct": item["absoluteMove"] * 100.0,
            "normalWeightedPriceContributionPct": item["weightedPrice"] * 100.0,
        }
        for state, item in sorted(states.items())
    }


def choose_research_priority(run_summary: dict, edge_summary: dict) -> dict:
    candidates = []
    for row in run_summary["byCause"]:
        if row["cause"] == "ALIGNED":
            continue
        candidates.append({
            "family": row["cause"],
            "score": float(row["totalOpportunityPct"]),
            "structural": bool(row["structural"]),
            "evidence": {
                "runs": int(row["runs"]),
                "periods": list(row["periods"]),
                "totalOpportunityPct": float(row["totalOpportunityPct"]),
            },
        })
    pre = edge_summary["preEntry"]["4"]
    post = edge_summary["postExit"]["4"]
    candidates.extend([
        {
            "family": "EPISODE_PRE_ENTRY_48H",
            "score": float(pre["sumPositiveMovePct"]),
            "structural": len(pre["periodPositiveMovePct"]) >= 2 and int(pre["positiveEvents"]) >= 3,
            "evidence": pre,
        },
        {
            "family": "EPISODE_POST_EXIT_48H",
            "score": float(post["sumPositiveMovePct"]),
            "structural": len(post["periodPositiveMovePct"]) >= 2 and int(post["positiveEvents"]) >= 3,
            "evidence": post,
        },
    ])
    candidates.sort(
        key=lambda item: (item["structural"], item["score"]),
        reverse=True,
    )
    selected = candidates[0] if candidates else None
    return {
        "selected": selected,
        "ranking": candidates[:8],
        "interpretation": (
            "Diagnostic priority only. Future prices are used to attribute missed opportunity; "
            "this is not a tradable signal and does not authorize parameter selection."
        ),
    }


def main() -> None:
    state_dir = Path(
        os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")
    ).resolve()
    raw = v95.v89.build_raw()
    baseline = build_exact_baseline(raw)

    symbols = {}
    for symbol in SYMBOLS:
        rows = symbol_bars(raw, baseline, symbol)
        active_weights = [
            abs(float(row["normalWeight"]))
            for row in rows
            if abs(float(row["normalWeight"])) > 1e-12
        ]
        median_active_weight = safe_median(active_weights)
        runs = build_trend_runs(rows, median_active_weight)
        episodes = build_episodes(rows)
        run_summary = aggregate_runs(runs)
        edge_summary = aggregate_episode_edges(episodes)
        symbols[symbol] = {
            "medianActiveWeight": median_active_weight,
            "activeBars": len(active_weights),
            "barStateSummary": bar_state_summary(rows),
            "trendRunCount": len(runs),
            "trendRunSummary": run_summary,
            "topTrendRuns": sorted(
                runs, key=lambda item: float(item["opportunityPct"]), reverse=True
            )[:20],
            "episodeCount": len(episodes),
            "episodeEdgeSummary": edge_summary,
            "topPostExitContinuations": sorted(
                episodes,
                key=lambda item: float(item["postExit"]["4"]),
                reverse=True,
            )[:15],
            "topPreEntryMisses": sorted(
                episodes,
                key=lambda item: float(item["preEntry"]["4"]),
                reverse=True,
            )[:15],
            "researchPriority": choose_research_priority(run_summary, edge_summary),
        }

    result = core.rounded({
        "strategyId": "V96_SYMBOL_MISSED_PROFIT_ATTRIBUTION",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": "DIAGNOSTIC_COMPLETE_NOT_A_STRATEGY",
        "method": {
            "symbols": SYMBOLS,
            "barHours": 12,
            "trendDefinition": (
                "Maximal consecutive completed 12h bars with the same price-return sign; "
                f"runs shorter than {MIN_TREND_BARS} bars are excluded from trend attribution."
            ),
            "causes": [
                "COMPLETELY_MISSED",
                "WRONG_DIRECTION",
                "WRONG_DIRECTION_MIXED",
                "ENTRY_DELAY",
                "EARLY_EXIT",
                "ENTRY_DELAY_AND_EARLY_EXIT",
                "MIXED_DIRECTION",
                "LOW_SIZE",
                "ALIGNED",
            ],
            "episodeHorizonsBars": HORIZONS,
            "lowSizeDefinition": (
                f"Average aligned weight below {LOW_SIZE_RATIO:.0%} of that symbol's "
                "historical median active V96 weight."
            ),
            "futureInformationUse": (
                "Future completed price bars are used only to diagnose missed opportunity. "
                "They are never used as an entry or exit signal."
            ),
        },
        "baselineParity": baseline["baselineParity"],
        "symbols": symbols,
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "parameterSearchPerformed": False,
            "promotionAllowed": False,
        },
        "limitations": [
            "Opportunity percentages are hindsight diagnostics and cannot be added together as a realizable portfolio return.",
            "Consecutive same-sign bar runs are an attribution lens, not a proposed trading rule.",
            "The analysis covers the frozen historical Aster V96 Core data and reused 2026H1; it is not pristine Forward evidence.",
            "PENGU is excluded because the question concerns BTC, ETH, BNB and SOL Core behavior.",
        ],
    })

    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-symbol-missed-profit-attribution.json"
    md_path = state_dir / "v96-symbol-missed-profit-attribution.md"
    json_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    lines = [
        "# V96 Symbol Missed-Profit Attribution",
        "",
        f"- Status: **{result['status']}**",
        f"- Baseline parity Normal / Severe: "
        f"{result['baselineParity']['maximumNormalBarDifference']} / "
        f"{result['baselineParity']['maximumSevereBarDifference']}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "## Per-symbol diagnosis",
        "",
        "| Symbol | Active bars | Trend runs | Top structural cause | Opportunity % | 48h pre-entry +% | 48h post-exit +% |",
        "| --- | ---: | ---: | --- | ---: | ---: | ---: |",
    ]
    for symbol in SYMBOLS:
        item = result["symbols"][symbol]
        selected = item["researchPriority"]["selected"] or {
            "family": "NONE", "score": 0.0
        }
        pre = item["episodeEdgeSummary"]["preEntry"]["4"]
        post = item["episodeEdgeSummary"]["postExit"]["4"]
        lines.append(
            f"| {symbol} | {item['activeBars']} | {item['trendRunCount']} | "
            f"{selected['family']} | {selected['score']} | "
            f"{pre['sumPositiveMovePct']} | {post['sumPositiveMovePct']} |"
        )

    for symbol in SYMBOLS:
        item = result["symbols"][symbol]
        lines.extend([
            "",
            f"## {symbol}",
            "",
            "| Cause | Runs | Periods | Opportunity % | Normal weighted price % | Structural |",
            "| --- | ---: | --- | ---: | ---: | --- |",
        ])
        for row in item["trendRunSummary"]["byCause"][:8]:
            lines.append(
                f"| {row['cause']} | {row['runs']} | {','.join(row['periods'])} | "
                f"{row['totalOpportunityPct']} | "
                f"{row['normalWeightedPriceContributionPct']} | "
                f"{'YES' if row['structural'] else 'NO'} |"
            )
        lines.extend([
            "",
            f"- 48h positive move before entries: "
            f"{item['episodeEdgeSummary']['preEntry']['4']['sumPositiveMovePct']}% "
            f"across {item['episodeEdgeSummary']['preEntry']['4']['positiveEvents']} episodes",
            f"- 48h positive continuation after exits: "
            f"{item['episodeEdgeSummary']['postExit']['4']['sumPositiveMovePct']}% "
            f"across {item['episodeEdgeSummary']['postExit']['4']['positiveEvents']} episodes",
            f"- Research priority: **"
            f"{(item['researchPriority']['selected'] or {'family': 'NONE'})['family']}**",
        ])

    lines.extend([
        "",
        "This report is diagnostic only. Hindsight opportunity is not a tradable return estimate.",
    ])
    markdown = "\n".join(lines) + "\n"
    md_path.write_text(markdown, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n" + markdown)
    print(markdown)


if __name__ == "__main__":
    main()
