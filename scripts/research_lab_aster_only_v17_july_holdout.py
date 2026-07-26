from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Sequence

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v15_intraday_shock_tournament as v15
import research_lab_aster_only_v16_relative_value_pair as v16

STRATEGY_ID = "DISDEX_ASTER_ONLY_V17_JULY_UNTOUCHED_HOLDOUT"
HOLDOUT_START = "2026-07-01"
HOLDOUT_END_EXCLUSIVE = "2026-07-23"
V13D_NORMAL_BPS_PER_CAPITAL_HOUR = 2.969653
SCENARIOS = v14.SCENARIOS

V14_CANDIDATE = v14.Candidate(
    candidate_id="ZSCORE_RESIDUAL_FADE__T2.5__H3__NONE",
    family="ZSCORE_RESIDUAL_FADE",
    threshold=2.5,
    maximum_holding_hours=3,
    previous_symbol_cooldown=False,
)
V15_CANDIDATE = v15.Candidate(
    candidate_id="TIME_SLOT_ZSCORE_FADE__T2__SLOT_1230__H2__NONE",
    family="TIME_SLOT_ZSCORE_FADE",
    threshold=2.0,
    entry_policy="SLOT_1230",
    maximum_holding_hours=2,
    previous_symbol_cooldown=False,
)
V16_CANDIDATE = v16.Candidate(
    candidate_id="ZSCORE_PAIR__T3__SLOT_1130__H2__CONVERGENCE_50",
    family="ZSCORE_PAIR",
    threshold=3.0,
    entry_policy="SLOT_1130",
    maximum_holding_hours=2,
    exit_mode="CONVERGENCE_50",
)


def rounded(value: Any):
    return v14.rounded(value)


def load_all(cache_root: Path):
    cash, cash_diag = v14.v11.load_cash_intraday(cache_root / "v11-cash")
    perp, perp_diag = v14.v11.load_perp_intraday(cache_root / "v11-perp", cache_root / "v11-funding")
    days, aligned, alignment = v14.v11.align_intraday(cash, perp)
    return days, aligned, {"cash": cash_diag, "perp": perp_diag, "alignment": alignment}


def holdout_trades(trades: Sequence[dict]) -> List[dict]:
    return [trade for trade in trades if HOLDOUT_START <= trade["day"] < HOLDOUT_END_EXCLUSIVE]


def scenario_metrics(trades: Sequence[dict]) -> dict:
    return {name: v14.metrics(trades, cost) for name, cost in SCENARIOS.items()}


def forward_signal_pass(result: dict) -> bool:
    normal = result["NORMAL"]
    p95 = result["P95"]
    severe = result["SEVERE"]
    return bool(
        normal["trades"] >= 3
        and normal["compoundedReturnPct"] > 0
        and p95["compoundedReturnPct"] > 0
        and (normal["profitFactor"] or 0.0) > 1.10
        and normal["maxDrawdownPct"] >= -2.0
        and normal["netBpsPerCapitalHour"] > V13D_NORMAL_BPS_PER_CAPITAL_HOUR
        and severe["compoundedReturnPct"] >= 0
    )


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    days, aligned, diagnostics = load_all(cache_root)
    history_days = [day for day in days if day < HOLDOUT_START]
    holdout_days = [day for day in days if HOLDOUT_START <= day < HOLDOUT_END_EXCLUSIVE]
    if len(history_days) < 20:
        raise RuntimeError("Insufficient pre-holdout history")

    features_v14 = v14.build_features(days, aligned)
    features_v15 = v15.build_slot_features(days, aligned)

    candidates = [
        {
            "version": 14,
            "candidate": asdict(V14_CANDIDATE),
            "trades": holdout_trades(v14.build_candidate_trades(V14_CANDIDATE, days, features_v14)),
        },
        {
            "version": 15,
            "candidate": asdict(V15_CANDIDATE),
            "trades": holdout_trades(v15.build_trades(V15_CANDIDATE, days, features_v15)),
        },
        {
            "version": 16,
            "candidate": asdict(V16_CANDIDATE),
            "trades": holdout_trades(v16.build_trades(V16_CANDIDATE, days, features_v15)),
        },
    ]

    results = []
    for row in candidates:
        metrics = scenario_metrics(row["trades"])
        results.append({
            "version": row["version"],
            "candidate": row["candidate"],
            "rawTradeCountBeforeCostGate": len(row["trades"]),
            "metrics": metrics,
            "forwardSignalPass": forward_signal_pass(metrics),
            "tradeAudit": row["trades"],
        })

    passing = [row for row in results if row["forwardSignalPass"]]
    status = "JULY_FORWARD_SIGNAL_FOUND_SHADOW_ONLY" if passing else "NO_JULY_FORWARD_SIGNAL_FROM_FROZEN_CANDIDATES"
    return rounded({
        "version": 17,
        "strategyId": STRATEGY_ID,
        "status": status,
        "period": {
            "historyFirst": days[0] if days else None,
            "historyLast": days[-1] if days else None,
            "preHoldoutSessions": len(history_days),
            "holdoutStartInclusive": HOLDOUT_START,
            "holdoutEndExclusive": HOLDOUT_END_EXCLUSIVE,
            "holdoutSessions": len(holdout_days),
            "holdoutFirst": holdout_days[0] if holdout_days else None,
            "holdoutLast": holdout_days[-1] if holdout_days else None,
        },
        "frozenCandidateCount": 3,
        "results": results,
        "passingCandidateIds": [row["candidate"]["candidate_id"] for row in passing],
        "passRule": {
            "minimumNormalTrades": 3,
            "normalPositive": True,
            "p95Positive": True,
            "minimumNormalProfitFactor": 1.10,
            "minimumNormalMaxDrawdownPct": -2.0,
            "minimumNormalNetBpsPerCapitalHourExclusive": V13D_NORMAL_BPS_PER_CAPITAL_HOUR,
            "severeNonnegativeThroughFailClosed": True,
            "productionAuthorization": False,
        },
        "selectionDiscipline": {
            "candidateIdsFrozenBeforeHoldout": True,
            "julyParameterRetuningAllowed": False,
            "bestCandidateSelectionFromJulyAllowed": False,
            "independentOfV14V15V16SelectionPeriod": True,
            "shortWindowOnly": True,
            "productionPromotionAllowed": False,
        },
        "data": diagnostics,
        "limitations": [
            "July contains only a short number of U.S. sessions.",
            "Cash history is Yahoo 60-minute data, not Pyth tick history.",
            "Aster history is candle-based and cannot reproduce exact queue, spread, depth or post-only fills.",
            "A July pass is only a Forward-Shadow lead and is not evidence of guaranteed future profit.",
        ],
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v13dProductionChanged": False,
        },
    })


def report(result: dict) -> str:
    lines = [
        "# Aster-only V17 July Untouched Holdout",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Holdout: {result['period']['holdoutFirst']} through {result['period']['holdoutLast']} ({result['period']['holdoutSessions']} sessions)",
        "",
    ]
    for row in result["results"]:
        normal = row["metrics"]["NORMAL"]
        p95 = row["metrics"]["P95"]
        lines += [
            f"## {row['candidate']['candidate_id']}",
            "",
            f"- pass: {row['forwardSignalPass']}",
            f"- Normal: {normal['compoundedReturnPct']:.4f}% / PF {normal['profitFactor']} / {normal['trades']} trades / DD {normal['maxDrawdownPct']:.4f}%",
            f"- P95: {p95['compoundedReturnPct']:.4f}% / {p95['trades']} trades",
            f"- Normal capital efficiency: {normal['netBpsPerCapitalHour']:.4f} bps/hour",
            "",
        ]
    lines += [
        "No July result authorizes Production. Exact Pyth/IEX and Aster order-book Forward Shadow evidence remains required.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "period": result["period"],
        "passingCandidateIds": result["passingCandidateIds"],
        "results": [
            {
                "candidateId": row["candidate"]["candidate_id"],
                "pass": row["forwardSignalPass"],
                "normal": row["metrics"]["NORMAL"],
                "p95": row["metrics"]["P95"],
            }
            for row in result["results"]
        ],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
