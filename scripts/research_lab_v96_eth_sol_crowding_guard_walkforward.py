from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_v96_basis_alpha_screen as basis
import research_lab_v96_core_profit_capture_screen as r1
import research_lab_v96_symbol_role_engine_screen as roles

core = roles.core
BAR = roles.BAR
GROSS_CAP = roles.GROSS_CAP


@dataclass(frozen=True)
class GuardConfig:
    name: str
    family: str
    role_name: str
    funding_cap_bps: float
    premium_cap_z: float


CANDIDATES = (
    GuardConfig("ETH_REL_L40_CROWD_F1_P1", "ETH_REL_L40_CROWD", "ETH_REL_L40", 1.0, 1.0),
    GuardConfig("ETH_REL_L40_CROWD_F1P5_P1P5", "ETH_REL_L40_CROWD", "ETH_REL_L40", 1.5, 1.5),
    GuardConfig("ETH_REL_L40_CROWD_F2_P2", "ETH_REL_L40_CROWD", "ETH_REL_L40", 2.0, 2.0),
    GuardConfig("SOL_FAST_EXIT3_CROWD_F1_P1", "SOL_FAST_EXIT3_CROWD", "SOL_FAST_EXIT3", 1.0, 1.0),
    GuardConfig("SOL_FAST_EXIT3_CROWD_F1P5_P1P5", "SOL_FAST_EXIT3_CROWD", "SOL_FAST_EXIT3", 1.5, 1.5),
    GuardConfig("SOL_FAST_EXIT3_CROWD_F2_P2", "SOL_FAST_EXIT3_CROWD", "SOL_FAST_EXIT3", 2.0, 2.0),
)


def finite(value: object, fallback: float = 0.0) -> float:
    return roles.finite(value, fallback)


def guard_state(
    config: GuardConfig,
    role: roles.RoleEngineConfig,
    side: int,
    raw: dict,
    premiums: Dict[str, Dict[int, float]],
    times: List[int],
    position: int,
) -> dict:
    ts = int(times[position])
    premium_z = basis.premium_z(premiums, role.symbol, times, position, 60)
    funding_bps = r1.funding_rate(raw, role.symbol, ts) * 10_000.0
    eligible = bool(
        side != 0
        and premium_z is not None
        and side * funding_bps <= config.funding_cap_bps
        and side * premium_z <= config.premium_cap_z
    )
    return {
        "eligible": eligible,
        "fundingBps": funding_bps,
        "premiumZ": premium_z,
        "signedFundingBps": side * funding_bps,
        "signedPremiumZ": side * premium_z if premium_z is not None else None,
    }


def guarded_signal_series(
    config: GuardConfig,
    role: roles.RoleEngineConfig,
    raw: dict,
    premiums: Dict[str, Dict[int, float]],
    times: List[int],
) -> tuple[List[int], dict]:
    base = roles.signal_series(role, raw, times)
    current = 0
    result: List[int] = []
    diagnostics = {
        "baseActiveBars": 0,
        "guardedActiveBars": 0,
        "entryAttempts": 0,
        "entryAccepted": 0,
        "entryRejected": 0,
        "missingPremium": 0,
        "fundingRejected": 0,
        "premiumRejected": 0,
    }
    for position, desired in enumerate(base):
        desired = int(desired)
        diagnostics["baseActiveBars"] += int(desired != 0)
        if desired == current:
            pass
        elif desired == 0:
            current = 0
        else:
            # A reversal always exits the old side first. The new side must independently pass the
            # completed-bar crowding guard; this prevents a failed guard from preserving stale risk.
            current = 0
            diagnostics["entryAttempts"] += 1
            state = guard_state(config, role, desired, raw, premiums, times, position)
            if state["premiumZ"] is None:
                diagnostics["missingPremium"] += 1
            if state["signedFundingBps"] > config.funding_cap_bps:
                diagnostics["fundingRejected"] += 1
            if state["signedPremiumZ"] is None or state["signedPremiumZ"] > config.premium_cap_z:
                diagnostics["premiumRejected"] += 1
            if state["eligible"]:
                current = desired
                diagnostics["entryAccepted"] += 1
            else:
                diagnostics["entryRejected"] += 1
        result.append(current)
        diagnostics["guardedActiveBars"] += int(current != 0)
    return result, diagnostics


def year_ranges(times: List[int]) -> dict:
    start = int(times[0])
    end = int(times[-1]) + BAR
    y2024 = int(dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    y2025 = int(dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    y2026 = int(dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    return {
        "2023": (start, y2024),
        "2024": (y2024, y2025),
        "2025": (y2025, y2026),
        "2026H1": (y2026, end),
    }


def evaluate_candidate(
    config: GuardConfig,
    role: roles.RoleEngineConfig,
    raw: dict,
    baseline: dict,
    premiums: Dict[str, Dict[int, float]],
    coverage: dict,
) -> dict:
    times = list(baseline["times"])
    series, diagnostics = guarded_signal_series(config, role, raw, premiums, times)
    original_signal_series = roles.signal_series

    def fixed_series(_role, _raw, _times):
        if _role.name != role.name or list(_times) != times:
            raise RuntimeError("guarded series called with unexpected role or timeline")
        return list(series)

    roles.signal_series = fixed_series
    try:
        normal = roles.simulate([role], raw, baseline, "normal")
        severe = roles.simulate([role], raw, baseline, "severe")
    finally:
        roles.signal_series = original_signal_series

    periods = roles.period_ranges(times)
    baseline_normal = baseline["normalControlled"]
    baseline_severe = baseline["severeControlled"]
    period_result = {}
    for name, (start, end) in periods.items():
        candidate_n = r1.metrics(normal["rows"], start, end)
        candidate_s = r1.metrics(severe["rows"], start, end)
        base_n = r1.metrics(baseline_normal, start, end)
        base_s = r1.metrics(baseline_severe, start, end)
        period_result[name] = {
            "normal": candidate_n,
            "severe": candidate_s,
            "normalDeltaPctPoints": candidate_n["compoundedReturnPct"] - base_n["compoundedReturnPct"],
            "severeDeltaPctPoints": candidate_s["compoundedReturnPct"] - base_s["compoundedReturnPct"],
            "drawdownDeltaPctPoints": candidate_n["maxDrawdownPct"] - base_n["maxDrawdownPct"],
        }

    annual = {}
    for name, (start, end) in year_ranges(times).items():
        candidate_n = r1.metrics(normal["rows"], start, end)
        candidate_s = r1.metrics(severe["rows"], start, end)
        base_n = r1.metrics(baseline_normal, start, end)
        base_s = r1.metrics(baseline_severe, start, end)
        annual[name] = {
            "normalDeltaPctPoints": candidate_n["compoundedReturnPct"] - base_n["compoundedReturnPct"],
            "severeDeltaPctPoints": candidate_s["compoundedReturnPct"] - base_s["compoundedReturnPct"],
        }

    full_start, full_end = periods["full"]
    removed_n = r1.metrics(roles.remove_best_event(normal), full_start, full_end)
    removed_s = r1.metrics(roles.remove_best_event(severe), full_start, full_end)
    base_full_n = r1.metrics(baseline_normal, full_start, full_end)
    base_full_s = r1.metrics(baseline_severe, full_start, full_end)
    normal_summary = normal["summary"]
    severe_summary = severe["summary"]
    symbol_coverage = coverage.get(role.symbol, {})

    development_pass = bool(
        period_result["development2023_2024"]["normalDeltaPctPoints"] >= 0.0
        and period_result["development2023_2024"]["severeDeltaPctPoints"] >= 0.0
        and annual["2023"]["normalDeltaPctPoints"] >= 0.0
        and annual["2023"]["severeDeltaPctPoints"] >= 0.0
        and annual["2024"]["normalDeltaPctPoints"] >= 0.0
        and annual["2024"]["severeDeltaPctPoints"] >= 0.0
    )
    locked_validation_pass = bool(
        development_pass
        and period_result["validation2025"]["normalDeltaPctPoints"] >= 0.0
        and period_result["validation2025"]["severeDeltaPctPoints"] >= 0.0
    )
    diagnostic_support = bool(
        period_result["diagnostic2026H1"]["normalDeltaPctPoints"] >= 0.0
        and period_result["diagnostic2026H1"]["severeDeltaPctPoints"] >= 0.0
    )
    concentration_pass = bool(
        int(normal_summary["count"]) >= 10
        and len(normal_summary["years"]) >= 3
        and finite(normal_summary["topPositiveEventShare"]) <= 0.35
        and removed_n["compoundedReturnPct"] >= base_full_n["compoundedReturnPct"]
        and removed_s["compoundedReturnPct"] >= base_full_s["compoundedReturnPct"]
    )
    full_pass = bool(
        period_result["full"]["normalDeltaPctPoints"] > 0.0
        and period_result["full"]["severeDeltaPctPoints"] > 0.0
        and period_result["full"]["drawdownDeltaPctPoints"] >= -1.5
        and finite(normal_summary["maxObservedGross"]) <= GROSS_CAP + 1e-9
        and finite(symbol_coverage.get("coveragePct")) >= 95.0
    )
    screen_pass = bool(
        locked_validation_pass
        and diagnostic_support
        and concentration_pass
        and full_pass
    )
    return {
        "config": asdict(config),
        "role": asdict(role),
        "developmentPass": development_pass,
        "lockedValidationPass": locked_validation_pass,
        "diagnosticSupport": diagnostic_support,
        "concentrationPass": concentration_pass,
        "screenPass": screen_pass,
        "periods": period_result,
        "annual": annual,
        "normalSummary": normal_summary,
        "severeSummary": severe_summary,
        "removeBestEvent": {
            "normalDeltaPctPoints": removed_n["compoundedReturnPct"] - base_full_n["compoundedReturnPct"],
            "severeDeltaPctPoints": removed_s["compoundedReturnPct"] - base_full_s["compoundedReturnPct"],
        },
        "guardDiagnostics": diagnostics,
        "premiumCoverage": symbol_coverage,
    }


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = roles.v95.v89.build_raw()
    baseline = roles.audit.build_exact_baseline(raw)
    times = list(baseline["times"])
    premiums, coverage = basis.build_premiums(times)
    roles_by_name = {config.name: config for config in roles.CANDIDATES}

    evaluations = [
        evaluate_candidate(config, roles_by_name[config.role_name], raw, baseline, premiums, coverage)
        for config in CANDIDATES
    ]
    family_summary = []
    for family in sorted(set(config.family for config in CANDIDATES)):
        members = [item for item in evaluations if item["config"]["family"] == family]
        passes = sum(bool(item["screenPass"]) for item in members)
        development_passes = sum(bool(item["developmentPass"]) for item in members)
        validation_passes = sum(bool(item["lockedValidationPass"]) for item in members)
        family_summary.append({
            "family": family,
            "members": [item["config"]["name"] for item in members],
            "developmentPasses": development_passes,
            "lockedValidationPasses": validation_passes,
            "screenPasses": passes,
            "neighborStablePass": bool(passes >= 2),
        })
    robust_families = [row["family"] for row in family_summary if row["neighborStablePass"]]
    status = "CROWDING_GUARD_ROBUST_FAMILY" if robust_families else "NO_ROBUST_ETH_SOL_CROWDING_GUARD"

    result = core.rounded({
        "strategyId": "V96_ETH_SOL_CROWDING_GUARD_WALKFORWARD",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "robustFamilies": robust_families,
        "baselineParity": baseline["baselineParity"],
        "candidateCount": len(CANDIDATES),
        "families": family_summary,
        "evaluations": evaluations,
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "promotionAllowed": False,
            "developmentUsedForEligibility": "2023 and 2024 must each be non-negative under Normal and Severe",
            "validationLocked": "2025 is evaluated only after the fixed family is declared",
            "diagnosticOnly": "2026H1 cannot rescue a failed Development or 2025 result",
            "neighborRule": "At least two of three adjacent crowding caps must pass the complete screen",
            "futurePricesUsed": False,
        },
        "limitations": [
            "The underlying ETH and SOL role engines were designed after observing reused historical data.",
            "Mark-index premium and Funding are exchange-specific; this is not pristine Forward evidence.",
            "Even a historical family pass would remain Shadow-only until a new untouched Forward clock completes.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-eth-sol-crowding-guard-walkforward.json"
    md_path = state_dir / "v96-eth-sol-crowding-guard-walkforward.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# V96 ETH / SOL Crowding Guard Walk-Forward",
        "",
        f"- Status: **{status}**",
        f"- Robust families: {', '.join(robust_families) if robust_families else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Candidate | Dev | 2025 lock | 2026 support | Screen | Full N | Full S | DD | 2023 N/S | 2024 N/S | 2025 N/S | 2026 N/S | Events | Top share | Best removed N/S |",
        "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in result["evaluations"]:
        full = item["periods"]["full"]
        a23 = item["annual"]["2023"]
        a24 = item["annual"]["2024"]
        a25 = item["annual"]["2025"]
        a26 = item["annual"]["2026H1"]
        removed = item["removeBestEvent"]
        lines.append(
            f"| {item['config']['name']} | {'YES' if item['developmentPass'] else 'NO'} | "
            f"{'YES' if item['lockedValidationPass'] else 'NO'} | {'YES' if item['diagnosticSupport'] else 'NO'} | "
            f"{'YES' if item['screenPass'] else 'NO'} | {full['normalDeltaPctPoints']} | "
            f"{full['severeDeltaPctPoints']} | {full['drawdownDeltaPctPoints']} | "
            f"{a23['normalDeltaPctPoints']} / {a23['severeDeltaPctPoints']} | "
            f"{a24['normalDeltaPctPoints']} / {a24['severeDeltaPctPoints']} | "
            f"{a25['normalDeltaPctPoints']} / {a25['severeDeltaPctPoints']} | "
            f"{a26['normalDeltaPctPoints']} / {a26['severeDeltaPctPoints']} | "
            f"{item['normalSummary']['count']} | {item['normalSummary']['topPositiveEventShare']} | "
            f"{removed['normalDeltaPctPoints']} / {removed['severeDeltaPctPoints']} |"
        )
    lines.extend([
        "",
        "The family was fixed before this run. A single winning cap is not accepted; at least two adjacent caps must pass every gate.",
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
