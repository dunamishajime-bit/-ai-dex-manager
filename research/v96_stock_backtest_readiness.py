from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BacktestReadinessInputs:
    entry_rules_frozen: bool
    exit_rules_frozen: bool
    holding_period_frozen: bool
    universe_frozen: bool
    session_rules_frozen: bool
    normal_cost_model_frozen: bool
    severe_cost_model_frozen: bool
    forward_execution_quality_reviewed: bool
    lookahead_controls_ready: bool


def readiness(inputs: BacktestReadinessInputs) -> dict:
    checks = {
        "entryRulesFrozen": inputs.entry_rules_frozen,
        "exitRulesFrozen": inputs.exit_rules_frozen,
        "holdingPeriodFrozen": inputs.holding_period_frozen,
        "universeFrozen": inputs.universe_frozen,
        "sessionRulesFrozen": inputs.session_rules_frozen,
        "normalCostModelFrozen": inputs.normal_cost_model_frozen,
        "severeCostModelFrozen": inputs.severe_cost_model_frozen,
        "forwardExecutionQualityReviewed": inputs.forward_execution_quality_reviewed,
        "lookaheadControlsReady": inputs.lookahead_controls_ready,
    }
    missing = [name for name, passed in checks.items() if not passed]
    return {
        "ready": not missing,
        "checks": checks,
        "missing": missing,
        "meaning": (
            "Historical profitability estimation may begin" if not missing
            else "Historical profitability estimation must wait until the missing rules are frozen"
        ),
    }


def self_test() -> None:
    result = readiness(BacktestReadinessInputs(*([True] * 9)))
    assert result["ready"] is True
    assert result["missing"] == []


if __name__ == "__main__":
    self_test()
    print("Stock backtest readiness self-test: PASS")
