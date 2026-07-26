from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Sequence

import research_lab_aster_only_v47_three_window_router as v47

STRATEGY_ID = "DISDEX_ASTER_ONLY_V48_FROZEN_THREE_WINDOW_STRESS_AUDIT"
FROZEN = v47.Candidate(
    "REV_C75_H1_G0.1_SHORT_ONLY__CLOSE_CROSS_LONG__BLOCK_SAME",
    75.0,
    1,
    0.10,
    "SHORT_ONLY",
    "CROSS_LONG",
    True,
)
CUSTOM_COSTS = (50.0, 60.0)
NEIGHBOR_CANDIDATES = tuple(
    v47.Candidate(
        f"REV_C{confirm:g}_H{hours}_G{gross:g}_SHORT_ONLY__CLOSE_CROSS_LONG__BLOCK_SAME",
        confirm,
        hours,
        gross,
        "SHORT_ONLY",
        "CROSS_LONG",
        True,
    )
    for confirm in (50.0, 75.0, 100.0)
    for hours in (1, 2)
    for gross in (0.05, 0.10, 0.15)
)


def prepare(cache_root: Path) -> dict:
    v47.v39.v14.base.verify_source(v47.v39.v14.base.V11_ROOT, v47.v39.v14.base.V11_SOURCE_SHA)
    v47.v39.v14.base.verify_source(v47.v39.v14.base.V13_ROOT, v47.v39.v14.base.V13_SOURCE_SHA)
    v47.v39.v19.configure_exact_data_window()
    days, aligned, aligned_diag = v47.v39.v19.v17.load_all(cache_root / "aligned")
    warmup = [
        day for day in days
        if v47.v39.v19.WARMUP_START.date().isoformat() <= day < v47.v39.v19.BT_END_DAY_EXCLUSIVE
    ]
    market = v47.v39.v14.v11.v9.load_market(cache_root / "aster-market")
    open_rows, open_diag = v47.v39.parse_market(market, warmup)
    closing_rows, closing_diag = v47.v46.load_intraday(market, warmup)
    common = [
        day for day in warmup
        if all(day in open_rows[symbol] and day in closing_rows[symbol] for symbol in v47.v39.v14.SYMBOLS)
    ]
    funding_raw = v47.v39.v14.funding_mod.load_funding(cache_root / "funding")
    funding = {
        symbol: v47.v39.v14.funding_mod.funding_points(rows)
        for symbol, rows in funding_raw.items()
    }
    absolute_features = v47.v39.build_features(common, open_rows, funding)
    residual_features = v47.v40.build_features(common, open_rows, funding)
    core_rows = v47.v42.build_trades(v47.CORE, common, residual_features)
    target = [
        day for day in common
        if v47.v39.v19.BT_START_DAY <= day < v47.v39.v19.BT_END_DAY_EXCLUSIVE
    ]
    pre_holdout = [day for day in target if day < v47.v39.HOLDOUT_START]
    holdout = [day for day in target if day >= v47.v39.HOLDOUT_START]
    splits = v47.v39.v14.split_days(pre_holdout)
    v11_rows, v11_diag = v47.v39.v22.build_v11eq(warmup, aligned)
    v19_rows = v47.v39.v22.build_fallback(warmup, aligned)
    closing = v47.v46.build_trades(v47.CLOSING["CROSS_LONG"], common, closing_rows, funding)
    return {
        "warmup": warmup,
        "target": target,
        "holdout": holdout,
        "splits": splits,
        "v11_rows": v11_rows,
        "v19_rows": v19_rows,
        "core_rows": core_rows,
        "absolute_features": absolute_features,
        "common": common,
        "closing_rows": closing,
        "data": {
            "aligned": aligned_diag,
            "open": open_diag,
            "closing": closing_diag,
            "commonSessions": len(common),
        },
        "v11Diagnostics": v11_diag,
    }


def rows_for(candidate: v47.Candidate, prepared: dict) -> dict:
    raw = v47.v39.build_trades(
        v47.reversal_candidate(candidate),
        prepared["common"],
        prepared["absolute_features"],
    )
    reversal = v47.filter_reversal(candidate, raw)
    return {
        "v11_rows": prepared["v11_rows"],
        "v19_rows": prepared["v19_rows"],
        "core_rows": prepared["core_rows"],
        "reversal_rows": reversal,
        "closing_rows": prepared["closing_rows"],
    }


def metrics_at_cost(candidate: v47.Candidate, rows: dict, days: Sequence[str], cost_bps: float) -> dict:
    events, routing = v47.route(candidate, cost_bps=cost_bps, days=days, **rows)
    return {
        "costBps": cost_bps,
        "metrics": v47.v39.v22.metrics(events),
        "routing": routing,
    }


def filter_symbol(rows: dict, symbol: str) -> dict:
    return {
        key: [row for row in values if str(row.get("symbol")) != symbol]
        for key, values in rows.items()
    }


def component_ablation(rows: dict, component: str) -> dict:
    result = {key: list(values) for key, values in rows.items()}
    result[component] = []
    return result


def analyze(cache_root: Path) -> dict:
    prepared = prepare(cache_root)
    rows = rows_for(FROZEN, prepared)
    splits = prepared["splits"]
    base = v47.audit(
        FROZEN,
        rows,
        prepared["target"],
        splits["DEVELOPMENT"],
        splits["VALIDATION"],
        splits["FINAL_REUSED"],
        prepared["holdout"],
    )

    custom_costs = {
        str(int(cost)): metrics_at_cost(FROZEN, rows, prepared["target"], cost)
        for cost in CUSTOM_COSTS
    }
    leave_one_symbol_out = {
        symbol: {
            "NORMAL": metrics_at_cost(
                FROZEN,
                filter_symbol(rows, symbol),
                prepared["target"],
                v47.SCENARIOS["NORMAL"],
            )["metrics"],
            "P95": metrics_at_cost(
                FROZEN,
                filter_symbol(rows, symbol),
                prepared["target"],
                v47.SCENARIOS["P95"],
            )["metrics"],
        }
        for symbol in v47.v39.v14.SYMBOLS
    }
    ablations = {
        name: {
            "NORMAL": metrics_at_cost(
                FROZEN,
                component_ablation(rows, key),
                prepared["target"],
                v47.SCENARIOS["NORMAL"],
            )["metrics"],
            "P95": metrics_at_cost(
                FROZEN,
                component_ablation(rows, key),
                prepared["target"],
                v47.SCENARIOS["P95"],
            )["metrics"],
        }
        for name, key in {
            "withoutCore": "core_rows",
            "withoutReversal": "reversal_rows",
            "withoutClosing": "closing_rows",
        }.items()
    }

    neighbors: List[dict] = []
    for candidate in NEIGHBOR_CANDIDATES:
        candidate_rows = rows_for(candidate, prepared)
        normal = metrics_at_cost(
            candidate, candidate_rows, prepared["target"], v47.SCENARIOS["NORMAL"]
        )["metrics"]
        p95 = metrics_at_cost(
            candidate, candidate_rows, prepared["target"], v47.SCENARIOS["P95"]
        )["metrics"]
        neighbors.append({
            "candidate": asdict(candidate),
            "NORMAL": normal,
            "P95": p95,
            "positive": normal["compoundedReturnPct"] > 0 and p95["compoundedReturnPct"] > 0,
            "aboveFrozenLines": (
                normal["compoundedReturnPct"] > v47.v39.BASELINE_NORMAL
                and p95["compoundedReturnPct"] > v47.v39.BASELINE_P95
            ),
        })

    checks = {
        "basePassesEveryV47StrictCheck": all(base["checks"].values()),
        "baseNormalAboveFrozenLine": base["full"]["NORMAL"]["compoundedReturnPct"] > v47.v39.BASELINE_NORMAL,
        "baseP95AboveFrozenLine": base["full"]["P95"]["compoundedReturnPct"] > v47.v39.BASELINE_P95,
        "baseFallbackNormalAboveV19": base["fallbackFull"]["NORMAL"]["compoundedReturnPct"] > v47.v39.BASELINE_FALLBACK_NORMAL,
        "baseFallbackP95AboveV19": base["fallbackFull"]["P95"]["compoundedReturnPct"] > v47.v39.BASELINE_FALLBACK_P95,
        "custom50And60BpsRemainPositive": all(
            row["metrics"]["compoundedReturnPct"] > 0 for row in custom_costs.values()
        ),
        "allLeaveOneSymbolOutNormalAndP95Positive": all(
            row["NORMAL"]["compoundedReturnPct"] > 0 and row["P95"]["compoundedReturnPct"] > 0
            for row in leave_one_symbol_out.values()
        ),
        "allComponentAblationsNormalAndP95Positive": all(
            row["NORMAL"]["compoundedReturnPct"] > 0 and row["P95"]["compoundedReturnPct"] > 0
            for row in ablations.values()
        ),
        "atLeastTwoThirdsNeighborVariantsPositive": sum(row["positive"] for row in neighbors) >= 12,
        "atLeastOneThirdNeighborVariantsAboveFrozenLines": sum(row["aboveFrozenLines"] for row in neighbors) >= 6,
    }
    passed = all(checks.values())
    return v47.v39.v14.rounded({
        "version": 48,
        "strategyId": STRATEGY_ID,
        "status": (
            "ASTER_ONLY_V48_HISTORICAL_STRESS_PASS_FORWARD_SHADOW_ONLY"
            if passed else "ASTER_ONLY_V48_HISTORICAL_STRESS_DID_NOT_PASS"
        ),
        "frozenCandidate": asdict(FROZEN),
        "selectionDisclosure": {
            "selectedAfterReviewingV47Diagnostics": True,
            "independentHoldout": False,
            "productionPromotionAllowed": False,
            "allowedNextStage": "ORDERLESS_FORWARD_SHADOW_ONLY",
        },
        "baseAudit": base,
        "customCosts": custom_costs,
        "leaveOneSymbolOut": leave_one_symbol_out,
        "componentAblations": ablations,
        "neighborVariants": neighbors,
        "checks": checks,
        "allChecksPassed": passed,
        "period": {
            "startInclusiveUtc": v47.v39.v19.BT_START.isoformat(),
            "endExclusiveUtc": v47.v39.v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "targetSessions": len(prepared["target"]),
            "holdoutSessions": len(prepared["holdout"]),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "sequentialIntradayEntriesAllowed": True,
            "reversalGross": 0.10,
            "sameSymbolReuseBlocked": True,
            "v11EqPriority": True,
            "hyperliquidUsed": False,
        },
        "data": prepared["data"],
        "v11Diagnostics": prepared["v11Diagnostics"],
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v19Changed": False,
            "v13dProductionChanged": False,
        },
    })


def report(result: dict) -> str:
    base = result["baseAudit"]
    lines = [
        "# Aster-only V48 Frozen Three-Window Stress Audit",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Candidate: `{result['frozenCandidate']['candidate_id']}`",
        f"Normal: {base['full']['NORMAL']['compoundedReturnPct']:.6f}%",
        f"P95: {base['full']['P95']['compoundedReturnPct']:.6f}%",
        f"Fallback Normal: {base['fallbackFull']['NORMAL']['compoundedReturnPct']:.6f}%",
        f"Fallback P95: {base['fallbackFull']['P95']['compoundedReturnPct']:.6f}%",
        f"Validation trades: {base['validation']['NORMAL']['trades']}",
        f"Validation auxiliary trades: {base['validationAuxTrades']}",
        "",
        "This candidate was frozen after V47 diagnostics were reviewed. The audit is historical and is not an independent Holdout.",
        "",
        "## Checks",
        "",
    ]
    for key, value in result["checks"].items():
        lines.append(f"- {key}: {value}")
    lines += ["", "Research only. No Production, LIVE, VPS or order state was changed.", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "frozenCandidate": result["frozenCandidate"],
        "base": {
            "NORMAL": result["baseAudit"]["full"]["NORMAL"],
            "P95": result["baseAudit"]["full"]["P95"],
            "fallback": result["baseAudit"]["fallbackFull"],
            "validationAuxTrades": result["baseAudit"]["validationAuxTrades"],
        },
        "checks": result["checks"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
