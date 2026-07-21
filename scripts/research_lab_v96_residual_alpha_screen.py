from __future__ import annotations

import datetime as dt
import json
import math
import os
import statistics
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

import research_lab_v96_funding_alpha_screen as fund
import research_lab_v96_independent_alpha_screen as base
import research_lab_v35_weight_band_strong_v95 as v95

BAR = 12 * v95.core.HOUR
START_2025 = v95.core.v4.START_2025
START_2026 = v95.core.v4.START_2026
ALTS = fund.SYMBOLS

CANDIDATES = (
    fund.FundingConfig("RESID_REV_W60_R2_Z1P5_H2", "RESID_REV", "RESID_REV", 60, 2, 150.0, momentum_bars=2),
    fund.FundingConfig("RESID_REV_W60_R2_Z1P5_H4", "RESID_REV", "RESID_REV", 60, 4, 150.0, momentum_bars=2),
    fund.FundingConfig("RESID_REV_W60_R2_Z2_H2", "RESID_REV", "RESID_REV", 60, 2, 200.0, momentum_bars=2),
    fund.FundingConfig("RESID_REV_W60_R2_Z2_H4", "RESID_REV", "RESID_REV", 60, 4, 200.0, momentum_bars=2),
    fund.FundingConfig("RESID_REV_W60_R4_Z1P5_H2", "RESID_REV", "RESID_REV", 60, 2, 150.0, momentum_bars=4),
    fund.FundingConfig("RESID_REV_W60_R4_Z1P5_H4", "RESID_REV", "RESID_REV", 60, 4, 150.0, momentum_bars=4),
    fund.FundingConfig("RESID_REV_W120_R4_Z1P5_H2", "RESID_REV", "RESID_REV", 120, 2, 150.0, momentum_bars=4),
    fund.FundingConfig("RESID_REV_W120_R4_Z1P5_H4", "RESID_REV", "RESID_REV", 120, 4, 150.0, momentum_bars=4),
    fund.FundingConfig("RESID_MOM_W60_R2_Z1P5_H4", "RESID_MOM", "RESID_MOM", 60, 4, 150.0, momentum_bars=2),
    fund.FundingConfig("RESID_MOM_W60_R2_Z1P5_H8", "RESID_MOM", "RESID_MOM", 60, 8, 150.0, momentum_bars=2),
    fund.FundingConfig("RESID_MOM_W60_R4_Z1P5_H4", "RESID_MOM", "RESID_MOM", 60, 4, 150.0, momentum_bars=4),
    fund.FundingConfig("RESID_MOM_W60_R4_Z1P5_H8", "RESID_MOM", "RESID_MOM", 60, 8, 150.0, momentum_bars=4),
    fund.FundingConfig("RESID_MOM_W60_R4_Z2_H4", "RESID_MOM", "RESID_MOM", 60, 4, 200.0, momentum_bars=4),
    fund.FundingConfig("RESID_MOM_W60_R4_Z2_H8", "RESID_MOM", "RESID_MOM", 60, 8, 200.0, momentum_bars=4),
    fund.FundingConfig("RESID_MOM_W120_R4_Z1P5_H4", "RESID_MOM", "RESID_MOM", 120, 4, 150.0, momentum_bars=4),
    fund.FundingConfig("RESID_MOM_W120_R4_Z1P5_H8", "RESID_MOM", "RESID_MOM", 120, 8, 150.0, momentum_bars=4),
)


def close_return(raw: dict, symbol: str, ts: int) -> Optional[float]:
    index = raw["indexes"][symbol].get(ts)
    if index is None or index < 1:
        return None
    rows = raw["bars"][symbol]
    previous = fund.finite(rows[index - 1]["close"])
    current = fund.finite(rows[index]["close"])
    return current / previous - 1.0 if previous > 0 else None


def residual_state(
    raw: dict,
    symbol: str,
    times: Sequence[int],
    position: int,
    window: int,
    horizon: int,
) -> Optional[Tuple[float, float]]:
    if position - window + 1 < 1 or horizon < 1:
        return None
    alt_returns: List[float] = []
    btc_returns: List[float] = []
    for index in range(position - window + 1, position + 1):
        alt = close_return(raw, symbol, int(times[index]))
        btc = close_return(raw, "BTC", int(times[index]))
        if alt is None or btc is None:
            return None
        alt_returns.append(alt)
        btc_returns.append(btc)
    btc_mean = statistics.fmean(btc_returns)
    alt_mean = statistics.fmean(alt_returns)
    variance = sum((value - btc_mean) ** 2 for value in btc_returns)
    if variance <= 1e-12:
        return None
    covariance = sum(
        (btc - btc_mean) * (alt - alt_mean)
        for btc, alt in zip(btc_returns, alt_returns)
    )
    beta = covariance / variance
    if not math.isfinite(beta) or beta <= 0:
        return None
    beta = min(2.0, max(0.2, beta))
    residuals = [alt - beta * btc for alt, btc in zip(alt_returns, btc_returns)]
    if len(residuals) < horizon + 20:
        return None
    sums = [sum(residuals[index - horizon + 1:index + 1]) for index in range(horizon - 1, len(residuals))]
    deviation = statistics.pstdev(sums)
    if deviation <= 1e-12:
        return None
    z = (sums[-1] - statistics.fmean(sums)) / deviation
    return z, beta


def residual_signal(
    config: fund.FundingConfig,
    raw: dict,
    times: Sequence[int],
    position: int,
    excluded: Set[str],
) -> Optional[Dict[str, float]]:
    candidates: List[Tuple[str, float, float]] = []
    for symbol in ALTS:
        if symbol in excluded:
            continue
        state = residual_state(
            raw,
            symbol,
            times,
            position,
            config.funding_lookback,
            config.momentum_bars,
        )
        if state is not None:
            candidates.append((symbol, state[0], state[1]))
    if not candidates:
        return None
    symbol, z_value, beta = max(candidates, key=lambda item: abs(item[1]))
    threshold = config.threshold_bps / 100.0
    if abs(z_value) < threshold:
        return None
    residual_direction = 1.0 if z_value > 0 else -1.0
    alt_direction = -residual_direction if config.mode == "RESID_REV" else residual_direction
    alt_abs = config.gross / (1.0 + beta)
    alt_weight = alt_direction * alt_abs
    btc_weight = -alt_direction * alt_abs * beta
    return {symbol: alt_weight, "BTC": btc_weight}


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
    fund.funding_signal = residual_signal
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
        "strategyId": "V96_BETA_NEUTRAL_RESIDUAL_ALPHA_SCREEN",
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
            "Rolling beta neutrality is estimated from completed 12-hour closes and is not exact intrabar neutrality.",
            "2025 and 2026H1 remain reused historical evidence.",
            "No candidate changes Production or submits orders.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-residual-alpha-screen.json"
    md_path = state_dir / "v96-residual-alpha-screen.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# V96 Beta-Neutral Residual Alpha Screen",
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
