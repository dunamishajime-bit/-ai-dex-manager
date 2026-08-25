from __future__ import annotations

import argparse
import inspect
import json
import math
from copy import deepcopy
from pathlib import Path
from typing import Any, Callable

import research_v12_pengu_v52_top2_allocation_bt as base

LIVE_CFG = {
    "id": "LIVE_TOP2_C1.50_V121.50_P0.75",
    "topK": 2,
    "cryptoCap": 1.50,
    "v12Cap": 1.50,
    "penguCap": 0.75,
}
HOLD_HOURS = (2, 3, 4)
RANK2_SIZES = (0.25, 0.35, 0.50)
RANK2_BASIS = (65.0, 70.0, 80.0, 90.0)
RANK2_NET_EDGE = (5.0, 7.5, 10.0, 15.0)
HEADROOMS = (0.0, 0.25, 0.50, 0.75)
BASELINE_POLICY = {"name": "LIVE_FIXED_R2_050", "minBasisBps": 65.0, "minNetEdgeBps": 5.0, "fixedGross": 0.50}


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def patched_simulator() -> Callable[..., dict]:
    """Clone the locked portfolio simulator and change only rank-2 requested gross/headroom admission."""
    source = inspect.getsource(base.simulate)
    source = source.replace("def simulate(\n", "def simulate_v53(\n", 1)
    needle = (
        "            available = min(max(0.0, STOCK_GROSS_CAP - stock_gross()), "
        "max(0.0, TOTAL_GROSS_CAP - v12_gross() - pengu_gross() - stock_gross()), 1.0)\n"
        "            minimum = FIRST_STOCK_MIN_GROSS if not active_stock else SECOND_STOCK_MIN_GROSS"
    )
    replacement = (
        "            rank = int(trade.get(\"rank\", 1))\n"
        "            requested_stock = max(0.0, finite(trade.get(\"requestedGross\", 1.0), 1.0))\n"
        "            reserve_crypto = max(0.0, finite(trade.get(\"reserveCryptoHeadroom\", 0.0), 0.0)) if strategy == \"V50_POST_OPEN_BASIS\" and rank >= 2 else 0.0\n"
        "            available = min(max(0.0, STOCK_GROSS_CAP - stock_gross()), max(0.0, TOTAL_GROSS_CAP - v12_gross() - pengu_gross() - stock_gross() - reserve_crypto), requested_stock)\n"
        "            minimum = SECOND_STOCK_MIN_GROSS if strategy == \"V50_POST_OPEN_BASIS\" and rank >= 2 else (FIRST_STOCK_MIN_GROSS if not active_stock else SECOND_STOCK_MIN_GROSS)"
    )
    if source.count(needle) != 1:
        raise RuntimeError("Locked simulator stock-allocation contract changed; refusing research patch")
    source = source.replace(needle, replacement, 1)
    namespace = dict(base.__dict__)
    exec(compile(source, "<v53-patched-simulator>", "exec"), namespace)
    return namespace["simulate_v53"]


SIMULATE = None


def get_simulate() -> Callable[..., dict]:
    global SIMULATE
    if SIMULATE is None:
        SIMULATE = patched_simulator()
    return SIMULATE


def load_ledgers(v12_path: Path, pengu_path: Path) -> tuple[dict, dict]:
    v12 = base.load_json(v12_path)
    pengu = base.load_json(pengu_path)
    if v12.get("schema") != "v12-combined-bt-ledger/v1":
        raise RuntimeError("Unexpected V12 ledger schema")
    if pengu.get("strategyId") != "PENGU_DUAL_LS_V2_FINAL":
        raise RuntimeError("Unexpected PENGU ledger")
    return v12, pengu


def stock_rows(cache_root: Path, hold_hours: int) -> tuple[list[dict], list[dict], dict]:
    original = base.top2.V50_HOLD_HOURS
    try:
        base.top2.V50_HOLD_HOURS = int(hold_hours)
        v11, by_topk, diag = base.build_stock(cache_root)
    finally:
        base.top2.V50_HOLD_HOURS = original
    return list(v11), list(by_topk[2]), diag


def rank2_requested_gross(policy: dict, row: dict, stock_cost_bps: float) -> float | None:
    if int(row.get("rank", 1)) < 2:
        return 1.0
    basis = abs(finite(row.get("entryBasisBps")))
    net_edge = finite(row.get("edgeProxyBps")) - stock_cost_bps
    if basis + 1e-12 < finite(policy.get("minBasisBps"), 65.0):
        return None
    if net_edge + 1e-12 < finite(policy.get("minNetEdgeBps"), 5.0):
        return None
    if "tiers" not in policy:
        return finite(policy.get("fixedGross"), 0.50)
    gross = finite(policy.get("baseGross"), 0.25)
    for tier in policy["tiers"]:
        if basis + 1e-12 >= finite(tier["basisBps"]) and net_edge + 1e-12 >= finite(tier["netEdgeBps"]):
            gross = max(gross, finite(tier["gross"]))
    return gross


def prepare_v50(rows: list[dict], policy: dict, stock_cost_bps: float, headroom: float) -> list[dict]:
    prepared = []
    for raw in rows:
        row = dict(raw)
        requested = rank2_requested_gross(policy, row, stock_cost_bps)
        if requested is None:
            continue
        row["requestedGross"] = requested
        row["reserveCryptoHeadroom"] = float(headroom) if int(row.get("rank", 1)) >= 2 else 0.0
        prepared.append(row)
    return prepared


def eval_case(v12: dict, pengu: dict, v11: list[dict], v50: list[dict], policy: dict, headroom: float, start_ms: int, end_ms: int) -> dict:
    output = {}
    sim = get_simulate()
    for scenario, assumptions in base.SCENARIOS.items():
        mode = assumptions["ledgerMode"]
        stock_cost = float(assumptions["stockCostBps"])
        vt = v12["modes"]["ALL"][mode]["trades"]
        pt = pengu["modes"][mode]["trades"]
        prepared = prepare_v50(v50, policy, stock_cost, headroom)
        output[scenario] = {}
        for priority in base.PRIORITY_ORDERS:
            output[scenario][priority] = sim(
                vt, pt, v11, prepared, LIVE_CFG, stock_cost, priority, start_ms, end_ms
            )
    return output


def worst(block: dict, scenario: str, key: str, fallback: float = 0.0) -> float:
    return min(finite(block[scenario][order].get(key), fallback) for order in base.PRIORITY_ORDERS)


def maximum(block: dict, scenario: str, key: str, fallback: float = 0.0) -> float:
    return max(finite(block[scenario][order].get(key), fallback) for order in base.PRIORITY_ORDERS)


def sleeve_events(block: dict, scenario: str, sleeve: str) -> int:
    return min(int(block[scenario][order]["bySleeve"][sleeve]["events"]) for order in base.PRIORITY_ORDERS)


def robust_score(block: dict) -> float:
    normal = worst(block, "NORMAL", "compoundedReturnPct", -9999)
    severe = worst(block, "SEVERE", "compoundedReturnPct", -9999)
    dd = worst(block, "NORMAL", "maxDrawdownPctClosedEvent", -100)
    pf = worst(block, "NORMAL", "profitFactor", 0)
    priority_delta = abs(
        finite(block["NORMAL"]["CRYPTO_FIRST"].get("compoundedReturnPct"))
        - finite(block["NORMAL"]["STOCK_FIRST"].get("compoundedReturnPct"))
    )
    return normal + 0.25 * severe + 0.30 * dd + 2.0 * min(pf, 5.0) - 0.5 * priority_delta


def summarize(case_id: str, block: dict, **extra: Any) -> dict:
    return {
        "caseId": case_id,
        **extra,
        "score": robust_score(block),
        "normalWorstReturnPct": worst(block, "NORMAL", "compoundedReturnPct"),
        "normalWorstPf": worst(block, "NORMAL", "profitFactor"),
        "normalWorstDdPct": worst(block, "NORMAL", "maxDrawdownPctClosedEvent"),
        "normalWorstWinRatePct": worst(block, "NORMAL", "winRatePct"),
        "severeWorstReturnPct": worst(block, "SEVERE", "compoundedReturnPct"),
        "severeWorstPf": worst(block, "SEVERE", "profitFactor"),
        "events": min(int(block["NORMAL"][o]["events"]) for o in base.PRIORITY_ORDERS),
        "v50Events": sleeve_events(block, "NORMAL", "V50_POST_OPEN_BASIS"),
        "maxTotalGross": maximum(block, "NORMAL", "observedMaximumTotalGross"),
        "maxStockGross": maximum(block, "NORMAL", "observedMaximumStockGross"),
        "maxV50Concurrent": maximum(block, "NORMAL", "observedMaximumV50Concurrent"),
        "routing": {o: block["NORMAL"][o].get("routingDiagnostics", {}) for o in base.PRIORITY_ORDERS},
    }


def fixed_policies() -> list[dict]:
    rows = []
    for gross in RANK2_SIZES:
        for basis in RANK2_BASIS:
            for edge in RANK2_NET_EDGE:
                rows.append({
                    "name": f"FIXED_G{gross:.2f}_B{int(basis)}_E{edge:g}",
                    "minBasisBps": basis,
                    "minNetEdgeBps": edge,
                    "fixedGross": gross,
                })
    rows += [
        {
            "name": "DYNAMIC_BALANCED",
            "minBasisBps": 65.0, "minNetEdgeBps": 5.0, "baseGross": 0.25,
            "tiers": [
                {"basisBps": 70.0, "netEdgeBps": 7.5, "gross": 0.35},
                {"basisBps": 80.0, "netEdgeBps": 10.0, "gross": 0.50},
            ],
        },
        {
            "name": "DYNAMIC_CONSERVATIVE",
            "minBasisBps": 65.0, "minNetEdgeBps": 5.0, "baseGross": 0.25,
            "tiers": [
                {"basisBps": 80.0, "netEdgeBps": 10.0, "gross": 0.35},
                {"basisBps": 90.0, "netEdgeBps": 15.0, "gross": 0.50},
            ],
        },
        {
            "name": "DYNAMIC_AGGRESSIVE",
            "minBasisBps": 65.0, "minNetEdgeBps": 5.0, "baseGross": 0.35,
            "tiers": [{"basisBps": 80.0, "netEdgeBps": 10.0, "gross": 0.50}],
        },
    ]
    return rows


def analyze(stock_cache: Path, v12_path: Path, pengu_path: Path, output_dir: Path) -> dict:
    v12, pengu = load_ledgers(v12_path, pengu_path)
    selection_start, selection_end = base.START_MS, base.HOLDOUT_START_MS
    holdout_start, holdout_end = base.HOLDOUT_START_MS, base.END_MS

    stock_by_hold = {}
    for hold in HOLD_HOURS:
        v11, v50, diag = stock_rows(stock_cache, hold)
        stock_by_hold[hold] = (v11, v50, diag)

    # Phase 1: freeze exit horizon using only pre-holdout selection data.
    phase1 = []
    for hold in HOLD_HOURS:
        v11, v50, _ = stock_by_hold[hold]
        block = eval_case(v12, pengu, v11, v50, BASELINE_POLICY, 0.0, selection_start, selection_end)
        phase1.append(summarize(f"HOLD_{hold}H", block, holdHours=hold, policy=BASELINE_POLICY))
    phase1.sort(key=lambda r: (-r["score"], r["caseId"]))
    hold_winner = int(phase1[0]["holdHours"])

    # Phase 2: freeze rank-2 quality/sizing policy; no holdout access.
    v11, v50, stock_diag = stock_by_hold[hold_winner]
    phase2 = []
    for policy in fixed_policies():
        block = eval_case(v12, pengu, v11, v50, policy, 0.0, selection_start, selection_end)
        phase2.append(summarize(policy["name"], block, policy=policy, holdHours=hold_winner))
    phase2.sort(key=lambda r: (-r["score"], r["caseId"]))
    policy_winner = deepcopy(phase2[0]["policy"])

    # Phase 3: freeze a rank-2-only crypto headroom reserve.
    phase3 = []
    for headroom in HEADROOMS:
        block = eval_case(v12, pengu, v11, v50, policy_winner, headroom, selection_start, selection_end)
        phase3.append(summarize(f"HEADROOM_{headroom:.2f}", block, policy=policy_winner, holdHours=hold_winner, reserveCryptoHeadroom=headroom))
    phase3.sort(key=lambda r: (-r["score"], r["caseId"]))
    headroom_winner = float(phase3[0]["reserveCryptoHeadroom"])

    # Winner is now locked. Only now open the holdout once.
    baseline_v11, baseline_v50, _ = stock_by_hold[3]
    selection_baseline = eval_case(v12, pengu, baseline_v11, baseline_v50, BASELINE_POLICY, 0.0, selection_start, selection_end)
    holdout_baseline = eval_case(v12, pengu, baseline_v11, baseline_v50, BASELINE_POLICY, 0.0, holdout_start, holdout_end)
    full_baseline = eval_case(v12, pengu, baseline_v11, baseline_v50, BASELINE_POLICY, 0.0, base.START_MS, base.END_MS)

    selection_winner = eval_case(v12, pengu, v11, v50, policy_winner, headroom_winner, selection_start, selection_end)
    holdout_winner = eval_case(v12, pengu, v11, v50, policy_winner, headroom_winner, holdout_start, holdout_end)
    full_winner = eval_case(v12, pengu, v11, v50, policy_winner, headroom_winner, base.START_MS, base.END_MS)

    baseline_full_summary = summarize("CURRENT_LIVE_BASELINE", full_baseline, holdHours=3, policy=BASELINE_POLICY, reserveCryptoHeadroom=0.0)
    winner_full_summary = summarize("V53_WINNER", full_winner, holdHours=hold_winner, policy=policy_winner, reserveCryptoHeadroom=headroom_winner)
    baseline_holdout_summary = summarize("CURRENT_LIVE_BASELINE_HOLDOUT", holdout_baseline)
    winner_holdout_summary = summarize("V53_WINNER_HOLDOUT", holdout_winner)

    checks = {
        "selectionImproves": robust_score(selection_winner) > robust_score(selection_baseline),
        "fullReturnImproves": winner_full_summary["normalWorstReturnPct"] > baseline_full_summary["normalWorstReturnPct"],
        "normalPfAtLeast3": winner_full_summary["normalWorstPf"] >= 3.0,
        "ddNoWorseThan1pp": winner_full_summary["normalWorstDdPct"] >= baseline_full_summary["normalWorstDdPct"] - 1.0,
        "severePositive": winner_full_summary["severeWorstReturnPct"] > 0,
        "holdoutPositive": winner_holdout_summary["normalWorstReturnPct"] > 0,
        "holdoutPfAtLeast1_5": winner_holdout_summary["normalWorstPf"] >= 1.5,
        "globalGrossAtMost2_5": winner_full_summary["maxTotalGross"] <= 2.5 + 1e-9,
        "stockGrossAtMost1_5": winner_full_summary["maxStockGross"] <= 1.5 + 1e-9,
        "v50ConcurrentAtMost2": winner_full_summary["maxV50Concurrent"] <= 2,
    }
    status = "V53_PROFIT_EFFICIENCY_PASS_RESEARCH_ONLY" if all(checks.values()) else "V53_PROFIT_EFFICIENCY_NO_PROMOTION"

    payload = {
        "schema": "disdex-v53-profit-efficiency/v1",
        "status": status,
        "selectionDiscipline": {
            "selectionStartMs": selection_start,
            "selectionEndMs": selection_end,
            "holdoutStartMs": holdout_start,
            "holdoutEndMs": holdout_end,
            "holdoutOpenedOnlyAfterWinnerLocked": True,
        },
        "phase1Exit": {"winnerHoldHours": hold_winner, "ranking": phase1},
        "phase2Rank2Sizing": {"winnerPolicy": policy_winner, "testedCases": len(phase2), "top": phase2[:12]},
        "phase3OpportunityCost": {"winnerReserveCryptoHeadroom": headroom_winner, "ranking": phase3},
        "baseline": {
            "selection": summarize("BASELINE_SELECTION", selection_baseline),
            "holdout": baseline_holdout_summary,
            "full": baseline_full_summary,
        },
        "winner": {
            "holdHours": hold_winner,
            "rank2Policy": policy_winner,
            "reserveCryptoHeadroom": headroom_winner,
            "selection": summarize("WINNER_SELECTION", selection_winner),
            "holdout": winner_holdout_summary,
            "full": winner_full_summary,
        },
        "checks": checks,
        "stockDiagnostics": stock_diag,
        "sourceLineage": {
            "researchParentSha": "1971c17ca7e72ff2a00d472db277ca4650531030",
            "liveUiSha": "fde79e3345d67c20375d3ff365cd5cc12de91065",
            "liveLogicBaseSha": "ef91f81e86f819ba1e37ff9325e8972489e1544f",
            "freshLedgerRunId": 32783392588,
            "freshLedgerArtifactId": 9540872862,
            "v52Top2ResearchSha": "2ca2faf08653e0a7e1f230af0e9d57bc12710065",
        },
        "safety": {
            "mode": "RESEARCH_ONLY",
            "ordersSent": False,
            "liveChanged": False,
            "vpsChanged": False,
            "productionChanged": False,
            "globalGrossCap": 2.5,
            "stockGrossCap": 1.5,
            "maxStockPositions": 2,
            "v50DailyMax": 3,
            "secondStockMinimumGross": 0.25,
        },
        "notes": [
            "Phase 1, 2, and 3 use only the pre-holdout selection interval; holdout is opened once after all parameters are frozen.",
            "Rank 1 remains 1.00 gross and the validated 65 bps / 5 bps contract; only Rank 2 sizing/quality and headroom are researched.",
            "The portfolio simulator is cloned from the locked integrated BT and patched only at stock requested-gross/headroom admission.",
            "No synthetic credit is added for the LIVE retry-aware path.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "result.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    concise = {
        "status": status,
        "phase1HoldHours": hold_winner,
        "phase2Policy": policy_winner,
        "phase3ReserveCryptoHeadroom": headroom_winner,
        "baselineFull": baseline_full_summary,
        "winnerFull": winner_full_summary,
        "baselineHoldout": baseline_holdout_summary,
        "winnerHoldout": winner_holdout_summary,
        "checks": checks,
    }
    print("FINAL_SUMMARY_JSON=" + json.dumps(concise, separators=(",", ":"), ensure_ascii=False))
    return payload


def self_test() -> None:
    sim = patched_simulator()
    assert callable(sim)
    assert min(RANK2_SIZES) >= base.SECOND_STOCK_MIN_GROSS
    assert BASELINE_POLICY["fixedGross"] == 0.50
    assert BASELINE_POLICY["minBasisBps"] == 65.0
    assert BASELINE_POLICY["minNetEdgeBps"] == 5.0
    assert LIVE_CFG["topK"] == 2
    assert base.TOTAL_GROSS_CAP == 2.5
    assert base.STOCK_GROSS_CAP == 1.5
    assert base.MAX_STOCK_POSITIONS == 2
    assert base.V50_MAX_DAILY_TRADES == 3
    print("V53 profit-efficiency self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--v12-ledger", default=".research-state/v12-pengu-v52-top2/v12-ledgers.json")
    parser.add_argument("--pengu-ledger", default=".research-state/v12-pengu-v52-top2/pengu-v2-ledgers.json")
    parser.add_argument("--output-dir", default=".research-state/v53-profit-efficiency")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    analyze(Path(args.stock_cache_dir), Path(args.v12_ledger), Path(args.pengu_ledger), Path(args.output_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
