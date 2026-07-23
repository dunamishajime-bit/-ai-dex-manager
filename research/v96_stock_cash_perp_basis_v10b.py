from __future__ import annotations

import argparse
import datetime as dt
import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Iterable, Sequence

import v96_stock_cash_perp_basis_v10 as v10
import v96_stock_intraday_theme_flow_backtest as base

UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_CASH_PERP_BASIS_V10B_FIXED_DIAGNOSTIC"


def net_value(trade: dict, scenario: base.CostScenario, multiplier: float = 1.0) -> float:
    perp_cost = 2.0 * trade["perpGross"] * scenario.turnover_bps / 10000.0
    cash_cost = 2.0 * trade["cashGross"] * v10.CASH_ONE_WAY_BPS[scenario.name] / 10000.0
    return multiplier * (trade["grossReturn"] - perp_cost - cash_cost)


def product(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
    return equity - 1.0


def removals(trades: Sequence[dict], scenario: base.CostScenario) -> dict:
    if not trades:
        return {
            "bestTradeRemovedPct": 0.0,
            "bestMonth": None,
            "bestMonthRemovedPct": 0.0,
        }
    values = [net_value(trade, scenario) for trade in trades]
    best_index = max(range(len(values)), key=values.__getitem__)
    months = defaultdict(list)
    for trade, value in zip(trades, values):
        months[trade["exitDay"][:7]].append(value)
    best_month = max(months, key=lambda month: product(months[month]))
    return {
        "bestTradeRemovedPct": product(value for index, value in enumerate(values) if index != best_index) * 100.0,
        "bestMonth": best_month,
        "bestMonthRemovedPct": product(
            value for trade, value in zip(trades, values) if trade["exitDay"][:7] != best_month
        ) * 100.0,
    }


def basis_distribution(days: Sequence[str], aligned: dict) -> dict:
    values = [aligned[symbol][day]["basisBps"] for symbol in v10.SYMBOL_MAP for day in days]
    absolute = sorted(abs(value) for value in values)
    if not absolute:
        return {"observations": 0}
    def percentile(q: float) -> float:
        index = min(len(absolute) - 1, max(0, round((len(absolute) - 1) * q)))
        return absolute[index]
    return {
        "observations": len(values),
        "signedMeanBps": statistics.mean(values),
        "signedMedianBps": statistics.median(values),
        "absoluteMedianBps": statistics.median(absolute),
        "absoluteP75Bps": percentile(0.75),
        "absoluteP90Bps": percentile(0.90),
        "absoluteP95Bps": percentile(0.95),
        "absoluteMaxBps": max(absolute),
    }


def analyze(cash_cache: Path, perp_cache: Path, funding_cache: Path) -> dict:
    cash, cash_diagnostics = v10.load_cash(cash_cache)
    perp, perp_diagnostics = v10.load_perp(perp_cache, funding_cache)
    days, aligned, alignment = v10.align(cash, perp)
    safety = {
        "mode": "RESEARCH_ONLY",
        "orderSubmissionAllowed": False,
        "productionChanged": False,
        "liveChanged": False,
        "vpsChanged": False,
        "cryptoV96Changed": False,
    }
    if len(days) < 30:
        return v10.rounded({
            "version": "10B",
            "strategyId": STRATEGY_ID,
            "status": "INSUFFICIENT_ALIGNED_CASH_PERP_HISTORY",
            "candidateCount": len(v10.CANDIDATES),
            "familyCount": 4,
            "eligibleDays": len(days),
            "cashDiagnostics": cash_diagnostics,
            "perpDiagnostics": perp_diagnostics,
            "alignmentDiagnostics": alignment,
            "safety": safety,
        })
    splits = v10.chronological_splits(days)
    all_trades = {
        candidate.candidate_id: [
            trade for day in days if (trade := v10.candidate_trade(candidate, day, aligned)) is not None
        ] for candidate in v10.CANDIDATES
    }
    families = {}
    validation_passing = []
    for family in sorted({candidate.family for candidate in v10.CANDIDATES}):
        candidate_rows = []
        for candidate in [item for item in v10.CANDIDATES if item.family == family]:
            development = {
                scenario.name: v10.metrics(
                    v10.subset(all_trades[candidate.candidate_id], splits["DEVELOPMENT"]), scenario
                ) for scenario in base.SCENARIOS
            }
            candidate_rows.append({
                "candidate": {
                    "candidateId": candidate.candidate_id,
                    "thresholdBps": candidate.threshold_bps,
                },
                "development": development,
                "score": v10.score(development),
            })
        eligible = [row for row in candidate_rows if row["development"]["FORWARD_MEDIAN"]["trades"] >= 8]
        winner = max(eligible or candidate_rows, key=lambda row: (row["score"], row["candidate"]["candidateId"]))
        winner_id = winner["candidate"]["candidateId"]
        trades = all_trades[winner_id]
        period_metrics = {}
        for scenario in base.SCENARIOS:
            period_metrics[scenario.name] = {
                "full": v10.metrics(trades, scenario),
                "development": v10.metrics(v10.subset(trades, splits["DEVELOPMENT"]), scenario),
                "validation": v10.metrics(v10.subset(trades, splits["VALIDATION"]), scenario),
                "holdoutDiagnostic": v10.metrics(v10.subset(trades, splits["HOLDOUT"]), scenario),
                "removals": removals(trades, scenario),
            }
        validation = {name: item["validation"] for name, item in period_metrics.items()}
        passed = v10.validation_pass(validation)
        if passed:
            validation_passing.append(winner_id)
        families[family] = {
            "developmentCandidates": candidate_rows,
            "winnerId": winner_id,
            "executionMode": trades[0]["executionMode"] if trades else None,
            "periodMetrics": period_metrics,
            "validationPass": passed,
        }
    return v10.rounded({
        "version": "10B",
        "strategyId": STRATEGY_ID,
        "status": (
            "CASH_PERP_FIXED_DIAGNOSTIC_VALIDATION_PASS_EXISTS"
            if validation_passing else "CASH_PERP_FIXED_DIAGNOSTIC_NO_VALIDATION_PASS"
        ),
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "candidateCount": len(v10.CANDIDATES),
        "familyCount": 4,
        "dataWindow": {"eligibleDays": len(days), "first": days[0], "last": days[-1]},
        "splits": splits,
        "basisDistribution": basis_distribution(days, aligned),
        "families": families,
        "validationPassingWinnerIds": validation_passing,
        "cashDiagnostics": cash_diagnostics,
        "perpDiagnostics": perp_diagnostics,
        "alignmentDiagnostics": alignment,
        "diagnosticPolicy": {
            "candidateRulesChangedAfterV10": False,
            "thresholdsRetuned": False,
            "holdoutUsedForSelection": False,
            "holdoutPurpose": "diagnostic reporting only after Development selection and Validation failure",
        },
        "limitations": [
            "Yahoo Finance public chart responses are an unofficial research source.",
            "Cash-hedged returns are theoretical and require a separate equity broker and synchronized execution.",
            "Cash borrow fees and historical short availability are not reconstructed.",
            "The final period is reused historical evidence, not an independent Holdout.",
        ],
        "safety": safety,
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-cash-perp-basis-v10b.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        "# V96 Stock Cash / Perp Basis V10B Fixed Diagnostic",
        "",
        f"- Status: **{result['status']}**",
        f"- Eligible aligned days: {result.get('dataWindow', {}).get('eligibleDays', result.get('eligibleDays', 0))}",
        f"- Validation passing: {', '.join(result.get('validationPassingWinnerIds', [])) or 'NONE'}",
        "- Threshold retuning: **NO**",
        "- Production / LIVE / VPS / Crypto V96 / orders changed: **NO**",
    ]
    if result.get("families"):
        lines += [
            "",
            "| Family | Winner | Normal full | Normal validation | Normal final | Severe full | Severe validation | Severe final |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
        for family, item in result["families"].items():
            normal = item["periodMetrics"]["NORMAL"]
            severe = item["periodMetrics"]["SEVERE"]
            lines.append(
                f"| {family} | {item['winnerId']} | {normal['full']['compoundedReturnPct']}% | "
                f"{normal['validation']['compoundedReturnPct']}% | {normal['holdoutDiagnostic']['compoundedReturnPct']}% | "
                f"{severe['full']['compoundedReturnPct']}% | {severe['validation']['compoundedReturnPct']}% | "
                f"{severe['holdoutDiagnostic']['compoundedReturnPct']}% |"
            )
    (output_dir / "v96-stock-cash-perp-basis-v10b.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(v10.CANDIDATES) == 12
    assert product([0.1, -0.05]) == 0.04499999999999993
    print("V96 Stock Cash / Perp Basis V10B self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cash-cache-dir", default=".cache/v96-stock-cash-yahoo-v10")
    parser.add_argument("--perp-cache-dir", default=".cache/v96-stock-basis-mature-v9")
    parser.add_argument("--funding-cache-dir", default=".cache/v96-stock-funding")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-cash-perp-basis-v10b")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return 0
    result = analyze(Path(args.cash_cache_dir), Path(args.perp_cache_dir), Path(args.funding_cache_dir))
    write_report(result, Path(args.output_dir))
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
