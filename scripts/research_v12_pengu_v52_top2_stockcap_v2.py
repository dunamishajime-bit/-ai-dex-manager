from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import research_v12_pengu_v52_top2_allocation_bt as base

STOCK_CAPS = (1.25, 1.35, 1.50)
RANK2_MIN_BASIS = (65.0, 70.0, 75.0, 80.0)
CURRENT_STOCK_CAP = 1.50
CURRENT_RANK2_BASIS = 65.0


def finite(value, fallback=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def worst(block: dict, key: str, fallback: float = 0.0) -> float:
    return min(finite(block[order].get(key), fallback) for order in base.PRIORITY_ORDERS)


def sleeve_events(block: dict, sleeve: str) -> int:
    return min(int(block[order]["bySleeve"][sleeve]["events"]) for order in base.PRIORITY_ORDERS)


def analyze(stock_cache: Path, v12_path: Path, pengu_path: Path, output_dir: Path) -> dict:
    original_build_stock = base.build_stock
    original_stock_cap = base.STOCK_GROSS_CAP
    v11_rows, v50_by_topk, stock_diag = original_build_stock(stock_cache)

    def filtered_build_stock(_cache_root: Path):
        threshold = float(filtered_build_stock.rank2_min_basis)
        top2_rows = [
            row for row in v50_by_topk[2]
            if int(row.get("rank", 1)) == 1 or abs(finite(row.get("entryBasisBps"))) >= threshold
        ]
        diag = {
            **stock_diag,
            "rank2MinimumBasisBps": threshold,
            "v50Top2FilteredRawTrades": len(top2_rows),
            "v50Top2FilteredRank2Trades": sum(int(row.get("rank", 1)) == 2 for row in top2_rows),
        }
        return list(v11_rows), {1: list(v50_by_topk[1]), 2: top2_rows}, diag

    filtered_build_stock.rank2_min_basis = CURRENT_RANK2_BASIS
    base.build_stock = filtered_build_stock

    runs = []
    current_result = None
    try:
        for stock_cap in STOCK_CAPS:
            for rank2_basis in RANK2_MIN_BASIS:
                base.STOCK_GROSS_CAP = float(stock_cap)
                filtered_build_stock.rank2_min_basis = float(rank2_basis)
                case_id = f"S{stock_cap:.2f}_R2B{int(rank2_basis)}"
                case_dir = output_dir / "cases" / case_id
                result = base.analyze(stock_cache, v12_path, pengu_path, case_dir)
                if stock_cap == CURRENT_STOCK_CAP and rank2_basis == CURRENT_RANK2_BASIS:
                    current_result = result
                runs.append({"caseId": case_id, "stockCap": stock_cap, "rank2MinBasisBps": rank2_basis, "result": result})
    finally:
        base.STOCK_GROSS_CAP = original_stock_cap
        base.build_stock = original_build_stock

    if current_result is None:
        raise RuntimeError("current baseline case missing")

    baseline_full_n = current_result["full"]["NORMAL"]["BASELINE"]
    baseline_full_s = current_result["full"]["SEVERE"]["BASELINE"]
    baseline_v50 = sleeve_events(baseline_full_n, "V50_POST_OPEN_BASIS")
    baseline_normal = worst(baseline_full_n, "compoundedReturnPct")
    baseline_severe = worst(baseline_full_s, "compoundedReturnPct")

    candidates = []
    for run in runs:
        result = run["result"]
        if result.get("recommendation") is None:
            continue
        full_n = result["full"]["NORMAL"]["WINNER"]
        full_s = result["full"]["SEVERE"]["WINNER"]
        hold_n = result["holdout"]["NORMAL"]["WINNER"]
        v50_events = sleeve_events(full_n, "V50_POST_OPEN_BASIS")
        checks = {
            "top2": int(result["recommendation"]["topK"]) == 2,
            "fullNormalBeatsCurrent": worst(full_n, "compoundedReturnPct") > baseline_normal,
            "fullSevereNotWorseThanCurrent": worst(full_s, "compoundedReturnPct") >= baseline_severe,
            "holdoutPositive": worst(hold_n, "compoundedReturnPct") > 0,
            "holdoutPfAtLeast1_2": worst(hold_n, "profitFactor") >= 1.20,
            "v50TradesIncreaseAtLeast10Pct": v50_events >= math.ceil(baseline_v50 * 1.10),
            "totalGrossAtMost2_5": max(full_n[order]["observedMaximumTotalGross"] for order in base.PRIORITY_ORDERS) <= 2.5 + 1e-9,
            "stockGrossAtMostConfigured": max(full_n[order]["observedMaximumStockGross"] for order in base.PRIORITY_ORDERS) <= float(run["stockCap"]) + 1e-9,
            "v50ConcurrentAtMost2": max(full_n[order]["observedMaximumV50Concurrent"] for order in base.PRIORITY_ORDERS) <= 2,
        }
        priority_delta = abs(full_n["CRYPTO_FIRST"]["compoundedReturnPct"] - full_n["STOCK_FIRST"]["compoundedReturnPct"])
        score = worst(full_n, "compoundedReturnPct") + worst(full_s, "compoundedReturnPct") + 0.35 * worst(full_n, "maxDrawdownPctClosedEvent") - 0.5 * priority_delta
        candidates.append({
            "caseId": run["caseId"],
            "stockCap": run["stockCap"],
            "rank2MinBasisBps": run["rank2MinBasisBps"],
            "allocation": result["recommendation"],
            "checks": checks,
            "pass": all(checks.values()),
            "score": score,
            "fullNormalWorstReturnPct": worst(full_n, "compoundedReturnPct"),
            "fullNormalWorstPf": worst(full_n, "profitFactor"),
            "fullNormalWorstDdPct": worst(full_n, "maxDrawdownPctClosedEvent"),
            "fullSevereWorstReturnPct": worst(full_s, "compoundedReturnPct"),
            "holdoutNormalWorstReturnPct": worst(hold_n, "compoundedReturnPct"),
            "holdoutNormalWorstPf": worst(hold_n, "profitFactor"),
            "v50Events": v50_events,
            "full": result["full"],
            "holdout": result["holdout"],
        })

    candidates.sort(key=lambda row: (not row["pass"], -finite(row["score"]), row["caseId"]))
    eligible = [row for row in candidates if row["pass"]]
    winner = eligible[0] if eligible else None
    payload = {
        "schema": "v12-pengu-v52-top2-stockcap-v2/v1",
        "status": "V52_TOP2_PORTFOLIO_REFINEMENT_PASS_RESEARCH_ONLY" if winner else "V52_TOP2_PORTFOLIO_REFINEMENT_NO_PROMOTION",
        "currentBaseline": {
            "stockCap": CURRENT_STOCK_CAP,
            "rank2MinBasisBps": CURRENT_RANK2_BASIS,
            "allocation": current_result["full"]["NORMAL"]["BASELINE"]["config"],
            "fullNormal": baseline_full_n,
            "fullSevere": baseline_full_s,
            "v50Events": baseline_v50,
        },
        "search": {
            "stockCaps": list(STOCK_CAPS),
            "rank2MinBasisBps": list(RANK2_MIN_BASIS),
            "cases": len(runs),
            "candidateCases": len(candidates),
            "eligibleCases": len(eligible),
        },
        "topCandidates": candidates[:12],
        "winner": winner,
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
        "sourceLineage": {
            "liveBaseSha": "ef91f81e86f819ba1e37ff9325e8972489e1544f",
            "freshLedgerRunId": 32783392588,
            "freshLedgerArtifactId": 9540872862,
            "v52Top2ResearchSha": "2ca2faf08653e0a7e1f230af0e9d57bc12710065",
        },
        "notes": [
            "Rank-2 minimum basis is a portfolio admission overlay only; rank-1 retains the validated 65 bps / 5 bps V50 signal contract.",
            "Reducing stock gross cap reduces second-slot size while preserving the first stock slot target of up to 1.0 gross.",
            "The new LIVE bounded retry is not credited with synthetic fills in this historical backtest.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "meta-result.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": payload["status"], "winner": winner, "topCandidates": [{k: row[k] for k in ("caseId", "stockCap", "rank2MinBasisBps", "allocation", "pass", "score", "fullNormalWorstReturnPct", "fullNormalWorstPf", "fullNormalWorstDdPct", "fullSevereWorstReturnPct", "holdoutNormalWorstReturnPct", "holdoutNormalWorstPf", "v50Events")} for row in candidates[:8]]}, indent=2, ensure_ascii=False))
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--v12-ledger", default=".research-state/v12-pengu-v52-top2/v12-ledgers.json")
    parser.add_argument("--pengu-ledger", default=".research-state/v12-pengu-v52-top2/pengu-v2-ledgers.json")
    parser.add_argument("--output-dir", default=".research-state/v12-pengu-v52-top2-v2")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        assert min(STOCK_CAPS) >= base.SECOND_STOCK_MIN_GROSS + 1.0
        assert CURRENT_STOCK_CAP in STOCK_CAPS
        assert CURRENT_RANK2_BASIS in RANK2_MIN_BASIS
        print("V52 Top2 stock-cap refinement self-test: PASS")
        return 0
    analyze(Path(args.stock_cache_dir), Path(args.v12_ledger), Path(args.pengu_ledger), Path(args.output_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
