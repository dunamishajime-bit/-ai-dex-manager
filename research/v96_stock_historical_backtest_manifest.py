from __future__ import annotations

import json
from pathlib import Path

from v96_stock_historical_backtest_policy import (
    BACKTEST_POLICY_ID,
    HistoricalBacktestPolicy,
    interpretation,
    required_outputs,
)


def build_manifest() -> dict:
    policy = HistoricalBacktestPolicy()
    return {
        "backtestPolicyId": BACKTEST_POLICY_ID,
        "status": "READY_AFTER_FORWARD_RULE_FREEZE",
        "policy": policy.to_dict(),
        "requiredOutputs": list(required_outputs()),
        "interpretation": interpretation(),
        "productionApproval": False,
    }


def write_manifest(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = build_manifest()
    (output_dir / "stock-historical-backtest-policy.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        "# Stock historical backtest policy",
        "",
        f"Policy: **{BACKTEST_POLICY_ID}**",
        "",
        "- Status: ready after Forward entry/exit/execution rules are frozen",
        "- Stock Gross: 1.00",
        "- Normal cost: 20 bps turnover",
        "- Severe cost: 50 bps turnover",
        "- Forward-observed cost model: required",
        "- Walk-forward and untouched Holdout: required",
        "- Historical BT is not Production approval",
    ]
    (output_dir / "stock-historical-backtest-policy.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def self_test() -> None:
    manifest = build_manifest()
    assert manifest["policy"]["stock_gross_cap"] == 1.0
    assert manifest["policy"]["prohibit_lookahead"] is True
    assert manifest["productionApproval"] is False
    assert "profitFactor" in manifest["requiredOutputs"]


if __name__ == "__main__":
    self_test()
    write_manifest(Path(".research-state/v96-stock-historical-backtest-policy"))
    print("Stock historical backtest manifest: PASS")
