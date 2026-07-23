from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

import v96_stock_cash_perp_basis_v10 as v10
import v96_stock_cash_perp_basis_v10b as v10b
import v96_stock_intraday_theme_flow_backtest as base

UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_CASH_PERP_BASIS_V10C_PREDECLARED_GRID"


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
            "version": "10C",
            "strategyId": STRATEGY_ID,
            "status": "INSUFFICIENT_ALIGNED_CASH_PERP_HISTORY",
            "candidateCount": len(v10.CANDIDATES),
            "familyCount": 4,
            "eligibleDays": len(days),
            "safety": safety,
        })
    splits = v10.chronological_splits(days)
    candidates = []
    for candidate in v10.CANDIDATES:
        trades = [
            trade for day in days if (trade := v10.candidate_trade(candidate, day, aligned)) is not None
        ]
        scenarios = {}
        for scenario in base.SCENARIOS:
            scenarios[scenario.name] = {
                "full": v10.metrics(trades, scenario),
                "development": v10.metrics(v10.subset(trades, splits["DEVELOPMENT"]), scenario),
                "validation": v10.metrics(v10.subset(trades, splits["VALIDATION"]), scenario),
                "holdoutDiagnostic": v10.metrics(v10.subset(trades, splits["HOLDOUT"]), scenario),
                "removals": v10b.removals(trades, scenario),
            }
        candidates.append({
            "candidateId": candidate.candidate_id,
            "family": candidate.family,
            "thresholdBps": candidate.threshold_bps,
            "executionMode": trades[0]["executionMode"] if trades else None,
            "scenarios": scenarios,
            "strictValidationPass": v10.validation_pass({
                name: item["validation"] for name, item in scenarios.items()
            }),
            "p95HistoricalLead": bool(
                scenarios["NORMAL"]["full"]["compoundedReturnPct"] > 0
                and scenarios["FORWARD_P95"]["full"]["compoundedReturnPct"] > 0
                and scenarios["NORMAL"]["validation"]["compoundedReturnPct"] > 0
                and scenarios["FORWARD_P95"]["validation"]["compoundedReturnPct"] > 0
                and scenarios["NORMAL"]["holdoutDiagnostic"]["compoundedReturnPct"] > 0
                and scenarios["FORWARD_P95"]["holdoutDiagnostic"]["compoundedReturnPct"] > 0
                and scenarios["NORMAL"]["removals"]["bestMonthRemovedPct"] > 0
            ),
        })
    perp_candidates = [item for item in candidates if item["family"] == "PERP_ONLY_BASIS_FADE"]
    p95_leads = [item["candidateId"] for item in candidates if item["p95HistoricalLead"]]
    strict = [item["candidateId"] for item in candidates if item["strictValidationPass"]]
    perp_local_stability = sum(item["p95HistoricalLead"] for item in perp_candidates) >= 2
    if strict:
        status = "STRICT_VALIDATION_PASS_EXISTS"
    elif p95_leads and perp_local_stability:
        status = "P95_STABLE_HISTORICAL_LEAD_FAILS_SEVERE_SHADOW_ONLY"
    elif p95_leads:
        status = "P95_SINGLE_HISTORICAL_LEAD_FAILS_SEVERE_SHADOW_ONLY"
    else:
        status = "NO_P95_STABLE_CASH_PERP_LEAD"
    return v10.rounded({
        "version": "10C",
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "candidateCount": len(candidates),
        "familyCount": 4,
        "dataWindow": {"eligibleDays": len(days), "first": days[0], "last": days[-1]},
        "splits": splits,
        "basisDistribution": v10b.basis_distribution(days, aligned),
        "candidates": candidates,
        "strictValidationPassIds": strict,
        "p95HistoricalLeadIds": p95_leads,
        "perpFadeLocalStability": perp_local_stability,
        "cashDiagnostics": cash_diagnostics,
        "perpDiagnostics": perp_diagnostics,
        "alignmentDiagnostics": alignment,
        "classification": {
            "strictProductionEligible": False,
            "shadowEligibleWhenP95Stable": bool(p95_leads and perp_local_stability),
            "reason": "P95 leads must remain Shadow-only because Severe is negative and the history has already been inspected.",
        },
        "selectionDiscipline": {
            "candidatesWerePredeclaredInV10": True,
            "thresholdsAddedAfterSeeingV10": False,
            "holdoutRetuningAllowed": False,
        },
        "limitations": [
            "Yahoo Finance public chart responses are an unofficial research source.",
            "The final period is reused historical evidence, not an independent Holdout.",
            "Historical order-book and event gates are not reconstructed.",
            "Severe uses 50 bps per one-way Aster turnover and remains a required warning even if p95 is positive.",
        ],
        "safety": safety,
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-cash-perp-basis-v10c.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        "# V96 Stock Cash / Perp Basis V10C Predeclared Grid",
        "",
        f"- Status: **{result['status']}**",
        f"- Strict Validation pass: {', '.join(result.get('strictValidationPassIds', [])) or 'NONE'}",
        f"- P95 historical leads: {', '.join(result.get('p95HistoricalLeadIds', [])) or 'NONE'}",
        f"- Perp-Fade local stability: **{'YES' if result.get('perpFadeLocalStability') else 'NO'}**",
        "- Production / LIVE / VPS / Crypto V96 / orders changed: **NO**",
    ]
    if result.get("candidates"):
        lines += [
            "",
            "| Candidate | Normal full | P95 full | Severe full | Normal validation | P95 validation | Normal final | P95 final | Lead |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
        ]
        for item in result["candidates"]:
            s = item["scenarios"]
            lines.append(
                f"| {item['candidateId']} | {s['NORMAL']['full']['compoundedReturnPct']}% | "
                f"{s['FORWARD_P95']['full']['compoundedReturnPct']}% | {s['SEVERE']['full']['compoundedReturnPct']}% | "
                f"{s['NORMAL']['validation']['compoundedReturnPct']}% | {s['FORWARD_P95']['validation']['compoundedReturnPct']}% | "
                f"{s['NORMAL']['holdoutDiagnostic']['compoundedReturnPct']}% | {s['FORWARD_P95']['holdoutDiagnostic']['compoundedReturnPct']}% | "
                f"{'YES' if item['p95HistoricalLead'] else 'NO'} |"
            )
    (output_dir / "v96-stock-cash-perp-basis-v10c.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(v10.CANDIDATES) == 12
    assert len([item for item in v10.CANDIDATES if item.family == "PERP_ONLY_BASIS_FADE"]) == 3
    print("V96 Stock Cash / Perp Basis V10C self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cash-cache-dir", default=".cache/v96-stock-cash-yahoo-v10")
    parser.add_argument("--perp-cache-dir", default=".cache/v96-stock-basis-mature-v9")
    parser.add_argument("--funding-cache-dir", default=".cache/v96-stock-funding")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-cash-perp-basis-v10c")
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
