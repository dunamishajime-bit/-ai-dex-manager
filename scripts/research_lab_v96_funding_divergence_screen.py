from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

import research_lab_v96_funding_alpha_screen as fund
import research_lab_v96_independent_alpha_screen as base
import research_lab_v35_weight_band_strong_v95 as v95

BAR = 12 * v95.core.HOUR
START_2025 = v95.core.v4.START_2025
START_2026 = v95.core.v4.START_2026
SYMBOLS = fund.SYMBOLS

CANDIDATES = (
    fund.FundingConfig("FUND_DIVERGE_L2_T1_H2", "DIVERGENCE", "DIVERGENCE", 2, 2, 1.0),
    fund.FundingConfig("FUND_DIVERGE_L2_T1_H4", "DIVERGENCE", "DIVERGENCE", 2, 4, 1.0),
    fund.FundingConfig("FUND_DIVERGE_L2_T2_H2", "DIVERGENCE", "DIVERGENCE", 2, 2, 2.0),
    fund.FundingConfig("FUND_DIVERGE_L2_T2_H4", "DIVERGENCE", "DIVERGENCE", 2, 4, 2.0),
    fund.FundingConfig("FUND_DIVERGE_L4_T1_H2", "DIVERGENCE", "DIVERGENCE", 4, 2, 1.0),
    fund.FundingConfig("FUND_DIVERGE_L4_T1_H4", "DIVERGENCE", "DIVERGENCE", 4, 4, 1.0),
    fund.FundingConfig("FUND_DIVERGE_L4_T2_H2", "DIVERGENCE", "DIVERGENCE", 4, 2, 2.0),
    fund.FundingConfig("FUND_DIVERGE_L4_T2_H4", "DIVERGENCE", "DIVERGENCE", 4, 4, 2.0),
    fund.FundingConfig("FUND_ACCEL_SPREAD_L2_T2_H2", "ACCEL_SPREAD", "ACCEL_SPREAD", 2, 2, 2.0),
    fund.FundingConfig("FUND_ACCEL_SPREAD_L2_T2_H4", "ACCEL_SPREAD", "ACCEL_SPREAD", 2, 4, 2.0),
    fund.FundingConfig("FUND_ACCEL_SPREAD_L2_T4_H2", "ACCEL_SPREAD", "ACCEL_SPREAD", 2, 2, 4.0),
    fund.FundingConfig("FUND_ACCEL_SPREAD_L2_T4_H4", "ACCEL_SPREAD", "ACCEL_SPREAD", 2, 4, 4.0),
    fund.FundingConfig("FUND_ACCEL_SPREAD_L4_T2_H2", "ACCEL_SPREAD", "ACCEL_SPREAD", 4, 2, 2.0),
    fund.FundingConfig("FUND_ACCEL_SPREAD_L4_T2_H4", "ACCEL_SPREAD", "ACCEL_SPREAD", 4, 4, 2.0),
    fund.FundingConfig("FUND_ACCEL_SPREAD_L4_T4_H2", "ACCEL_SPREAD", "ACCEL_SPREAD", 4, 2, 4.0),
    fund.FundingConfig("FUND_ACCEL_SPREAD_L4_T4_H4", "ACCEL_SPREAD", "ACCEL_SPREAD", 4, 4, 4.0),
)


def funding_acceleration(
    raw: dict,
    symbol: str,
    times: Sequence[int],
    position: int,
    lookback: int,
) -> Optional[float]:
    previous_position = position - lookback
    current = fund.rolling_funding(raw, symbol, times, position, lookback)
    previous = fund.rolling_funding(raw, symbol, times, previous_position, lookback)
    if current is None or previous is None:
        return None
    return current - previous


def divergence_signal(
    config: fund.FundingConfig,
    raw: dict,
    times: Sequence[int],
    position: int,
    excluded: Set[str],
) -> Optional[Dict[str, float]]:
    ts = times[position]
    values: List[Tuple[str, float, float]] = []
    for symbol in SYMBOLS:
        if symbol in excluded:
            continue
        acceleration = funding_acceleration(raw, symbol, times, position, config.funding_lookback)
        momentum = fund.close_momentum(raw, symbol, ts, config.momentum_bars)
        if acceleration is None or momentum is None:
            continue
        values.append((symbol, acceleration, momentum))
    threshold = config.threshold_bps / 10_000.0
    if config.mode == "DIVERGENCE":
        eligible = [
            item for item in values
            if (item[1] >= threshold and item[2] <= 0)
            or (item[1] <= -threshold and item[2] >= 0)
        ]
        if not eligible:
            return None
        symbol, acceleration, _ = max(eligible, key=lambda item: abs(item[1]))
        return {symbol: -config.gross if acceleration > 0 else config.gross}
    if config.mode == "ACCEL_SPREAD":
        if len(values) < 2:
            return None
        low = min(values, key=lambda item: item[1])
        high = max(values, key=lambda item: item[1])
        if high[1] - low[1] < threshold:
            return None
        each = config.gross / 2.0
        return {low[0]: each, high[0]: -each}
    raise ValueError(f"unknown divergence mode: {config.mode}")


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v95.v89.build_raw()
    baseline = base.build_baseline(raw)
    times = baseline["times"]
    periods = {
        "development2023_2024": (times[0], START_2025),
        "validation2025": (START_2025, START_2026),
        "diagnostic2026H1": (START_2026, times[-1] + BAR),
        "full": (times[0], times[-1] + BAR),
    }
    original_signal = fund.funding_signal
    fund.funding_signal = divergence_signal
    try:
        evaluations = [fund.evaluate(config, raw, baseline, periods) for config in CANDIDATES]
    finally:
        fund.funding_signal = original_signal
    family_passes: Dict[str, int] = {}
    for item in evaluations:
        family = str(item["config"]["family"])
        family_passes[family] = family_passes.get(family, 0) + int(bool(item["screenPass"]))
    for item in evaluations:
        family = str(item["config"]["family"])
        item["neighborFamilyPass"] = bool(item["screenPass"] and family_passes.get(family, 0) >= 2)
    evaluations.sort(key=lambda item: (
        item["neighborFamilyPass"],
        item["screenPass"],
        item["fullSevereDeltaPctPoints"],
        item["fullNormalDeltaPctPoints"],
    ), reverse=True)
    result = fund.rounded({
        "strategyId": "V96_FUNDING_DIVERGENCE_ALPHA_SCREEN",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "ordersSent": False,
            "parameterFamilyPredeclared": True,
            "promotionAllowed": False,
        },
        "candidateCount": len(CANDIDATES),
        "screenPassedCount": sum(bool(item["screenPass"]) for item in evaluations),
        "neighborFamilyPassedCount": sum(bool(item["neighborFamilyPass"]) for item in evaluations),
        "evaluations": evaluations,
        "limitations": [
            "Funding acceleration is exchange-specific and 2025/2026H1 remain reused evidence.",
            "No candidate changes Production or submits orders.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-funding-divergence-screen.json"
    md_path = state_dir / "v96-funding-divergence-screen.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# V96 Funding Divergence Alpha Screen",
        "",
        f"- Candidates: {result['candidateCount']}",
        f"- Screen passes: {result['screenPassedCount']}",
        f"- Neighbor-family passes: {result['neighborFamilyPassedCount']}",
        "- Production changed: **NO**",
        "",
        "| Candidate | Pass | Neighbor | Full N | Full S | 2025 N | 2025 S | 2026 N | 2026 S | Events | Corr |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in result["evaluations"]:
        report.append(
            f"| {item['config']['name']} | {'YES' if item['screenPass'] else 'NO'} | "
            f"{'YES' if item['neighborFamilyPass'] else 'NO'} | "
            f"{item['fullNormalDeltaPctPoints']} | {item['fullSevereDeltaPctPoints']} | "
            f"{item['validationNormalDeltaPctPoints']} | {item['validationSevereDeltaPctPoints']} | "
            f"{item['diagnosticNormalDeltaPctPoints']} | {item['diagnosticSevereDeltaPctPoints']} | "
            f"{item['summary']['count']} | {item['summary']['alphaBaselineCorrelation']} |"
        )
    md_path.write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
