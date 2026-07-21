from __future__ import annotations

import datetime as dt
import json
import math
import os
import random
import statistics
from pathlib import Path
from typing import Dict, List, Sequence

import research_lab_v96_eth_sol_crowding_guard_walkforward as guarded
import research_lab_v96_symbol_role_engine_screen as roles

r1 = guarded.r1
core = guarded.core
BAR = guarded.BAR
BOOTSTRAP_DRAWS = 2000
BLOCK_LENGTHS = (28, 60, 120)  # 14, 30 and 60 calendar days on completed 12h bars.
SEED = 960622


def finite(value: object, fallback: float = 0.0) -> float:
    return roles.finite(value, fallback)


def simulate_candidate(
    config: guarded.GuardConfig,
    role: roles.RoleEngineConfig,
    raw: dict,
    baseline: dict,
    premiums: Dict[str, Dict[int, float]],
    scenario: str,
) -> dict:
    times = list(baseline["times"])
    series, diagnostics = guarded.guarded_signal_series(
        config, role, raw, premiums, times
    )
    original_signal_series = roles.signal_series

    def fixed_series(_role, _raw, _times):
        if _role.name != role.name or list(_times) != times:
            raise RuntimeError("unexpected role or timeline in reality-check replay")
        return list(series)

    roles.signal_series = fixed_series
    try:
        simulation = roles.simulate([role], raw, baseline, scenario)
    finally:
        roles.signal_series = original_signal_series
    simulation["guardDiagnostics"] = diagnostics
    return simulation


def period_indexes(times: Sequence[int]) -> dict:
    ranges = roles.period_ranges(list(times))
    result = {}
    for name, (start, end) in ranges.items():
        result[name] = [index for index, ts in enumerate(times) if start <= int(ts) < end]
    return result


def block_sums(values: Sequence[float], block_length: int) -> List[float]:
    n = len(values)
    if n == 0:
        return []
    extended = list(values) + list(values[: max(0, block_length - 1)])
    prefix = [0.0]
    for value in extended:
        prefix.append(prefix[-1] + finite(value))
    return [prefix[start + block_length] - prefix[start] for start in range(n)]


def bootstrap_means(
    matrix: List[List[float]],
    block_length: int,
    draws: int,
    seed: int,
    center: bool,
) -> List[List[float]]:
    if not matrix or not matrix[0]:
        return [[] for _ in matrix]
    n = len(matrix[0])
    if any(len(row) != n for row in matrix):
        raise RuntimeError("bootstrap matrix rows have different lengths")
    prepared = []
    for row in matrix:
        mean = statistics.fmean(row)
        values = [finite(value) - mean for value in row] if center else list(row)
        prepared.append(block_sums(values, block_length))
    blocks_per_draw = max(1, math.ceil(n / block_length))
    denominator = blocks_per_draw * block_length
    rng = random.Random(seed)
    outputs = [[] for _ in matrix]
    for _ in range(draws):
        starts = [rng.randrange(n) for _ in range(blocks_per_draw)]
        for row_index, sums in enumerate(prepared):
            outputs[row_index].append(sum(sums[start] for start in starts) / denominator)
    return outputs


def quantile(values: Sequence[float], probability: float) -> float:
    ordered = sorted(finite(value) for value in values)
    if not ordered:
        return 0.0
    position = (len(ordered) - 1) * probability
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def evaluate_period(
    candidate_names: List[str],
    alpha_matrix: List[List[float]],
    block_length: int,
    seed: int,
) -> dict:
    actual_means = [statistics.fmean(row) if row else 0.0 for row in alpha_matrix]
    raw_draws = bootstrap_means(
        alpha_matrix, block_length, BOOTSTRAP_DRAWS, seed, center=False
    )
    centered_draws = bootstrap_means(
        alpha_matrix, block_length, BOOTSTRAP_DRAWS, seed + 1, center=True
    )
    observed_max = max(actual_means, default=0.0)
    bootstrap_max = [
        max(centered_draws[candidate][draw] for candidate in range(len(candidate_names)))
        for draw in range(BOOTSTRAP_DRAWS)
    ] if candidate_names else []
    reality_p = (
        (1 + sum(value >= observed_max for value in bootstrap_max))
        / (BOOTSTRAP_DRAWS + 1)
        if bootstrap_max else 1.0
    )
    candidates = []
    for index, name in enumerate(candidate_names):
        draws = raw_draws[index]
        lower = quantile(draws, 0.025)
        median = quantile(draws, 0.50)
        upper = quantile(draws, 0.975)
        candidates.append({
            "candidate": name,
            "meanAlphaPerBar": actual_means[index],
            "annualizedAdditiveAlphaPct": actual_means[index] * 730.0 * 100.0,
            "bootstrap95MeanAlphaPerBar": [lower, upper],
            "bootstrapMedianMeanAlphaPerBar": median,
            "positiveLowerBound": bool(lower > 0.0),
        })
    return {
        "blockLengthBars": block_length,
        "blockLengthDays": block_length / 2.0,
        "draws": BOOTSTRAP_DRAWS,
        "observedBestCandidate": (
            candidate_names[max(range(len(candidate_names)), key=lambda index: actual_means[index])]
            if candidate_names else None
        ),
        "observedMaxMeanAlphaPerBar": observed_max,
        "whiteRealityCheckApproxPValue": reality_p,
        "multipleTestingPass": bool(reality_p < 0.05 and observed_max > 0.0),
        "candidates": candidates,
    }


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = roles.v95.v89.build_raw()
    baseline = roles.audit.build_exact_baseline(raw)
    times = list(baseline["times"])
    premiums, coverage = guarded.basis.build_premiums(times)
    role_by_name = {config.name: config for config in roles.CANDIDATES}
    names = [config.name for config in guarded.CANDIDATES]

    simulations = {"normal": {}, "severe": {}}
    for config in guarded.CANDIDATES:
        role = role_by_name[config.role_name]
        simulations["normal"][config.name] = simulate_candidate(
            config, role, raw, baseline, premiums, "normal"
        )
        simulations["severe"][config.name] = simulate_candidate(
            config, role, raw, baseline, premiums, "severe"
        )

    indexes = period_indexes(times)
    results = {}
    for scenario in ("normal", "severe"):
        baseline_rows = baseline["normalControlled" if scenario == "normal" else "severeControlled"]
        results[scenario] = {}
        for period, selected_indexes in indexes.items():
            matrix = []
            for name in names:
                rows = simulations[scenario][name]["rows"]
                matrix.append([
                    finite(rows[index]["return"]) - finite(baseline_rows[index]["return"])
                    for index in selected_indexes
                ])
            results[scenario][period] = [
                evaluate_period(
                    names,
                    matrix,
                    block_length,
                    SEED + block_length + (0 if scenario == "normal" else 10000),
                )
                for block_length in BLOCK_LENGTHS
            ]

    development_significant = {
        scenario: bool(all(
            item["multipleTestingPass"]
            for item in results[scenario]["development2023_2024"]
        ))
        for scenario in ("normal", "severe")
    }
    full_significant = {
        scenario: bool(all(
            item["multipleTestingPass"]
            for item in results[scenario]["full"]
        ))
        for scenario in ("normal", "severe")
    }
    status = (
        "REALITY_CHECK_SIGNIFICANT_BOTH_SCENARIOS"
        if all(development_significant.values()) and all(full_significant.values())
        else "NO_MULTIPLE_TESTING_ROBUST_EDGE"
    )
    result = core.rounded({
        "strategyId": "V96_ETH_SOL_FIXED_FAMILY_REALITY_CHECK",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "candidateCount": len(names),
        "candidateNames": names,
        "bootstrapDraws": BOOTSTRAP_DRAWS,
        "blockLengthsBars": BLOCK_LENGTHS,
        "developmentSignificant": development_significant,
        "fullSignificant": full_significant,
        "results": results,
        "premiumCoverage": coverage,
        "evaluationPathParity": {
            "normal": 0.0,
            "severe": 0.0,
        },
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "promotionAllowed": False,
            "candidateFamilyFrozenBeforeTest": True,
            "multipleTestingAdjusted": True,
            "commonBlockResamplingPreservesCrossCandidateDependence": True,
            "realityCheckType": "White-Reality-Check-style centered circular block bootstrap",
        },
        "limitations": [
            "This is an approximate White Reality Check, not a formal econometric proof.",
            "The candidate families were historically designed and remain reused evidence.",
            "A statistical pass would still require untouched Forward Shadow evidence.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-eth-sol-reality-check.json"
    md_path = state_dir / "v96-eth-sol-reality-check.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# V96 ETH / SOL Fixed-Family Reality Check",
        "",
        f"- Status: **{status}**",
        f"- Candidates: {len(names)} fixed before the test",
        f"- Bootstrap draws: {BOOTSTRAP_DRAWS}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Scenario | Period | Block days | Best | Mean/bar | Reality p | Adjusted pass |",
        "| --- | --- | ---: | --- | ---: | ---: | --- |",
    ]
    for scenario in ("normal", "severe"):
        for period in ("development2023_2024", "validation2025", "diagnostic2026H1", "full"):
            for item in result["results"][scenario][period]:
                lines.append(
                    f"| {scenario} | {period} | {item['blockLengthDays']} | "
                    f"{item['observedBestCandidate']} | {item['observedMaxMeanAlphaPerBar']} | "
                    f"{item['whiteRealityCheckApproxPValue']} | "
                    f"{'YES' if item['multipleTestingPass'] else 'NO'} |"
                )
    lines.extend([
        "",
        "A candidate family is not accepted from a single block length or a single execution scenario.",
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
