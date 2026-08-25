from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

import research_v12_pengu_v52_top2_allocation_bt as base
import research_v53_profit_efficiency_bt as v53

UTC = dt.timezone.utc

# This study deliberately keeps the portfolio-level safety envelope unchanged.
TOTAL_GROSS_CAP = 2.5
STOCK_GROSS_CAP = 1.5
CRYPTO_GROSS_CAP = 1.5
MAX_STOCK_POSITIONS = 2
V50_MAX_DAILY_TRADES = 3

# V53 winner is the hurdle, not the older Top2 baseline.
V53_EXPECTED_FULL_RETURN = 588.30805676
V53_EXPECTED_HOLDOUT_RETURN = 21.73659103
SIGNIFICANT_FULL_GAIN_PCT_POINT = 30.0

WINDOW_SETS = ("POST_EARLY3", "POST_ALL4", "POST_LATE3")
HOLD_HOURS = (3, 4, 5, 6)
DIRECTIONS = ("BOTH", "PREMIUM_SHORT_ONLY", "DISCOUNT_LONG_ONLY")
SELECTION_DEPTHS = (2, 3, 4)
RANK_MODES = ("ENTRY_ABS", "SIGNAL_ABS", "STABILITY")
CONVERGENCE_RATIOS = (None, 0.75, 0.50, 0.35)
STOP_MULTIPLES = (1.25, 1.50, 1.75, 2.00)
ADVERSE_LIMITS = (5.0, 10.0, 15.0)
ENTRY_BASIS_FLOORS = (50.0, 65.0, 80.0)
PENGU_MULTIPLIERS = (1.00, 1.25, 1.50, 1.75, 2.00)

LIVE_CFG = {
    "id": "V54_RESEARCH_TOP2_C1.50_V121.50",
    "topK": 2,
    "cryptoCap": CRYPTO_GROSS_CAP,
    "v12Cap": 1.50,
    "penguCap": 0.75,
}

@dataclass(frozen=True)
class StructureSpec:
    window_set: str = "POST_EARLY3"
    hold_hours: int = 4
    direction: str = "BOTH"
    selection_depth: int = 2
    rank_mode: str = "ENTRY_ABS"
    convergence_ratio: float | None = None
    stop_multiple: float = 1.50
    maximum_adverse_bps: float = 10.0
    minimum_basis_bps: float = 65.0

BASELINE_STRUCTURE = StructureSpec()

V53_STOCK_POLICY = {
    "name": "V53_R1_1.00_R2_0.25_B80_E10",
    "rank1Tiers": [
        {"minBasisBps": 65.0, "minNetEdgeBps": 5.0, "gross": 1.00},
    ],
    "secondaryTiers": [
        {"minBasisBps": 80.0, "minNetEdgeBps": 10.0, "gross": 0.25},
    ],
    "v11Tiers": [
        {"minBasisBps": 0.0, "minNetEdgeBps": -999.0, "gross": 1.00},
    ],
}

def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback

def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 8)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value

def direction_allowed(mode: str, entry_basis_bps: float) -> bool:
    if mode == "PREMIUM_SHORT_ONLY":
        return entry_basis_bps > 0
    if mode == "DISCOUNT_LONG_ONLY":
        return entry_basis_bps < 0
    return True

def rank_score(mode: str, signal_basis: float, entry_basis: float, adverse: float) -> float:
    if mode == "SIGNAL_ABS":
        return abs(signal_basis)
    if mode == "STABILITY":
        return min(abs(signal_basis), abs(entry_basis)) - 2.0 * adverse
    return abs(entry_basis)

def load_stock_state(cache_root: Path) -> tuple[list[dict], list[str], dict[str, dict[str, dict]], dict]:
    v19 = base.top2.x.base.v19
    v19.BT_START = base.START
    v19.BT_END_EXCLUSIVE = base.END
    v19.WARMUP_START = base.START - dt.timedelta(days=40)
    v19.BT_START_DAY = base.START.date().isoformat()
    v19.BT_END_DAY_EXCLUSIVE = base.END.date().isoformat()
    v19.configure_exact_data_window()
    days, aligned, data_diag = v19.v17.load_all(cache_root / "aligned")
    warmup = [
        day for day in days
        if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE
    ]
    target = [day for day in warmup if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    v11 = base.top2.x.build_v11_rows(base.top2.BASELINE_V11, warmup, aligned)
    return list(v11), target, aligned, {
        "market": data_diag,
        "targetSessions": len(target),
        "v11RawTrades": len(v11),
    }

def build_v50_trade(day: str, window_name: str, state: dict, rank: int, spec: StructureSpec) -> dict | None:
    entry_basis = finite(state["entryBasisBps"])
    side = -1 if entry_basis > 0 else 1
    future = list(state["futureCheckpoints"])
    if not future:
        return None
    maximum_index = min(len(future) - 1, int(spec.hold_hours) - 1)
    chosen = future[maximum_index]
    exit_reason = f"TIME_{spec.hold_hours}H"
    best_abs_basis = abs(entry_basis)
    for checkpoint in future[: maximum_index + 1]:
        current_basis = finite(checkpoint["basisBps"])
        current_abs = abs(current_basis)
        best_abs_basis = min(best_abs_basis, current_abs)
        hard_converged = current_abs <= base.top2.x.base.v50.CONVERGENCE_BPS or current_basis * entry_basis <= 0
        partial_converged = (
            spec.convergence_ratio is not None
            and current_abs <= float(spec.convergence_ratio) * abs(entry_basis)
        )
        stopped = current_abs >= float(spec.stop_multiple) * abs(entry_basis)
        if stopped or hard_converged or partial_converged:
            chosen = checkpoint
            if stopped:
                exit_reason = f"BASIS_STOP_{spec.stop_multiple:g}X"
            elif hard_converged:
                exit_reason = "BASIS_CONVERGED"
            else:
                exit_reason = f"PARTIAL_CONVERGENCE_{spec.convergence_ratio:g}"
            break

    entry_price = finite(state["entryPrice"])
    exit_price = finite(chosen["exit"])
    entry_ts = int(state["entryTs"])
    exit_ts = int(chosen["exitTs"])
    price_return = side * (exit_price / entry_price - 1.0)
    funding_return = (-side) * base.top2.x.base.v14.funding_mod.funding_between(
        state["row"]["perp"]["fundingPoints"], entry_ts, exit_ts
    )
    return {
        "strategy": "V50_POST_OPEN_BASIS",
        "route": f"POST_{window_name}",
        "day": day,
        "symbol": str(state["symbol"]),
        "rank": int(rank),
        "side": int(side),
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "signalBasisBps": finite(state["signalBasisBps"]),
        "entryBasisBps": entry_basis,
        "adverseBasisMoveBps": finite(state["adverseBasisMoveBps"]),
        "edgeProxyBps": abs(entry_basis) - base.top2.x.base.v50.CONVERGENCE_BPS,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "exitReason": exit_reason,
        "bestAbsBasisSeenBps": best_abs_basis,
    }

def build_v50_rows(
    spec: StructureSpec,
    target_days: Iterable[str],
    aligned: dict[str, dict[str, dict]],
) -> list[dict]:
    allowed_indices = set(base.top2.x.base.v50.WINDOW_SETS[spec.window_set])
    rows: list[dict] = []
    for day in target_days:
        for window_name, checkpoint_index in base.top2.x.base.v50.WINDOWS:
            if checkpoint_index not in allowed_indices:
                continue
            states = base.top2.x.base.v50.window_state(aligned, day, checkpoint_index)
            eligible: list[tuple[float, str, dict]] = []
            for symbol, raw in states.items():
                signal_basis = finite(raw["signalBasisBps"])
                entry_basis = finite(raw["entryBasisBps"])
                if abs(entry_basis) + 1e-12 < spec.minimum_basis_bps:
                    continue
                if signal_basis * entry_basis <= 0:
                    continue
                if not direction_allowed(spec.direction, entry_basis):
                    continue
                adverse = max(0.0, abs(entry_basis) - abs(signal_basis))
                if adverse > spec.maximum_adverse_bps + 1e-12:
                    continue
                state = {**raw, "symbol": symbol, "adverseBasisMoveBps": adverse}
                score = rank_score(spec.rank_mode, signal_basis, entry_basis, adverse)
                eligible.append((score, symbol, state))
            eligible.sort(key=lambda node: (-node[0], node[1]))
            for rank, (_score, _symbol, state) in enumerate(eligible[: spec.selection_depth], start=1):
                trade = build_v50_trade(day, window_name, state, rank, spec)
                if trade is not None:
                    rows.append(trade)
    return sorted(
        rows,
        key=lambda row: (str(row["day"]), int(row["entryTs"]), int(row.get("rank", 1)), str(row["symbol"])),
    )

def choose_gross(tiers: list[dict], basis: float, net_edge: float) -> float | None:
    selected = None
    for tier in tiers:
        if basis + 1e-12 >= finite(tier.get("minBasisBps")) and net_edge + 1e-12 >= finite(tier.get("minNetEdgeBps"), -999):
            selected = finite(tier.get("gross"))
    return selected

def prepare_v50(rows: list[dict], policy: dict, stock_cost_bps: float) -> list[dict]:
    prepared = []
    for raw in rows:
        row = dict(raw)
        basis = abs(finite(row.get("entryBasisBps")))
        net_edge = finite(row.get("edgeProxyBps")) - stock_cost_bps
        tiers = policy["rank1Tiers"] if int(row.get("rank", 1)) == 1 else policy["secondaryTiers"]
        gross = choose_gross(tiers, basis, net_edge)
        if gross is None or gross <= 0:
            continue
        row["requestedGross"] = min(STOCK_GROSS_CAP, gross)
        row["reserveCryptoHeadroom"] = 0.0
        prepared.append(row)
    return prepared

def prepare_v11(rows: list[dict], policy: dict, stock_cost_bps: float) -> list[dict]:
    prepared = []
    for raw in rows:
        row = dict(raw)
        basis = abs(finite(row.get("entryBasisBps")))
        net_edge = finite(row.get("edgeProxyBps")) - stock_cost_bps
        gross = choose_gross(policy["v11Tiers"], basis, net_edge)
        if gross is None or gross <= 0:
            continue
        row["requestedGross"] = min(STOCK_GROSS_CAP, gross)
        prepared.append(row)
    return prepared

def scale_pengu_trades(rows: list[dict], long_mult: float, short_mult: float) -> list[dict]:
    out = []
    for raw in rows:
        row = dict(raw)
        mult = long_mult if str(row.get("side")) == "L" else short_mult
        row["requestedGross"] = min(CRYPTO_GROSS_CAP, max(0.0, finite(row.get("requestedGross")) * mult))
        out.append(row)
    return out

def eval_case(
    v12: dict,
    pengu: dict,
    v11_rows: list[dict],
    v50_rows: list[dict],
    stock_policy: dict,
    long_mult: float,
    short_mult: float,
    start_ms: int,
    end_ms: int,
) -> dict:
    sim = v53.get_simulate()
    output: dict[str, dict] = {}
    cfg = {
        **LIVE_CFG,
        "penguCap": min(CRYPTO_GROSS_CAP, 0.75 * max(long_mult, short_mult)),
    }
    for scenario, assumptions in base.SCENARIOS.items():
        mode = assumptions["ledgerMode"]
        stock_cost = float(assumptions["stockCostBps"])
        vt = v12["modes"]["ALL"][mode]["trades"]
        pt = scale_pengu_trades(pengu["modes"][mode]["trades"], long_mult, short_mult)
        pv11 = prepare_v11(v11_rows, stock_policy, stock_cost)
        pv50 = prepare_v50(v50_rows, stock_policy, stock_cost)
        output[scenario] = {}
        for priority in base.PRIORITY_ORDERS:
            output[scenario][priority] = sim(
                vt, pt, pv11, pv50, cfg, stock_cost, priority, start_ms, end_ms
            )
    return output

def worst(block: dict, scenario: str, key: str, fallback: float = 0.0) -> float:
    return min(finite(block[scenario][order].get(key), fallback) for order in base.PRIORITY_ORDERS)

def maximum(block: dict, scenario: str, key: str, fallback: float = 0.0) -> float:
    return max(finite(block[scenario][order].get(key), fallback) for order in base.PRIORITY_ORDERS)

def robust_score(block: dict) -> float:
    normal = worst(block, "NORMAL", "compoundedReturnPct", -9999)
    severe = worst(block, "SEVERE", "compoundedReturnPct", -9999)
    dd = worst(block, "NORMAL", "maxDrawdownPctClosedEvent", -100)
    pf = worst(block, "NORMAL", "profitFactor", 0)
    return normal + 0.20 * severe + 0.25 * dd + 2.0 * min(pf, 5.0)

def summarize(case_id: str, block: dict, **extra: Any) -> dict:
    by_sleeve = {
        sleeve: min(
            int(block["NORMAL"][order]["bySleeve"][sleeve]["events"])
            for order in base.PRIORITY_ORDERS
        )
        for sleeve in ("V12", "PENGU_DUAL_LS_V2", "V11_EQ", "V50_POST_OPEN_BASIS")
    }
    return rounded({
        "caseId": case_id,
        **extra,
        "score": robust_score(block),
        "normalWorstReturnPct": worst(block, "NORMAL", "compoundedReturnPct"),
        "normalWorstPf": worst(block, "NORMAL", "profitFactor"),
        "normalWorstDdPct": worst(block, "NORMAL", "maxDrawdownPctClosedEvent"),
        "normalWorstWinRatePct": worst(block, "NORMAL", "winRatePct"),
        "severeWorstReturnPct": worst(block, "SEVERE", "compoundedReturnPct"),
        "severeWorstPf": worst(block, "SEVERE", "profitFactor"),
        "events": min(int(block["NORMAL"][order]["events"]) for order in base.PRIORITY_ORDERS),
        "bySleeveEvents": by_sleeve,
        "maxTotalGross": maximum(block, "NORMAL", "observedMaximumTotalGross"),
        "maxStockGross": maximum(block, "NORMAL", "observedMaximumStockGross"),
        "maxCryptoGross": maximum(block, "NORMAL", "observedMaximumCryptoGross"),
        "maxV50Concurrent": maximum(block, "NORMAL", "observedMaximumV50Concurrent"),
    })

def fold_bounds(start_ms: int, end_ms: int, count: int = 4) -> list[tuple[int, int]]:
    span = end_ms - start_ms
    out = []
    for i in range(count):
        left = start_ms + span * i // count
        right = start_ms + span * (i + 1) // count
        out.append((left, right))
    return out

def fold_diagnostics(
    v12: dict,
    pengu: dict,
    v11_rows: list[dict],
    v50_rows: list[dict],
    policy: dict,
    long_mult: float,
    short_mult: float,
    baseline_fold_blocks: list[dict],
    bounds: list[tuple[int, int]],
) -> dict:
    rows = []
    wins = 0
    nonnegative = 0
    for index, ((left, right), baseline_block) in enumerate(zip(bounds, baseline_fold_blocks), start=1):
        block = eval_case(v12, pengu, v11_rows, v50_rows, policy, long_mult, short_mult, left, right)
        ret = worst(block, "NORMAL", "compoundedReturnPct")
        pf = worst(block, "NORMAL", "profitFactor")
        base_ret = worst(baseline_block, "NORMAL", "compoundedReturnPct")
        base_pf = worst(baseline_block, "NORMAL", "profitFactor")
        beat = ret > base_ret and pf >= 0.85 * base_pf
        if beat:
            wins += 1
        if ret >= 0:
            nonnegative += 1
        rows.append({
            "fold": index,
            "returnPct": ret,
            "profitFactor": pf,
            "baselineReturnPct": base_ret,
            "baselineProfitFactor": base_pf,
            "beatsBaseline": beat,
        })
    return {"wins": wins, "nonnegativeFolds": nonnegative, "folds": rounded(rows)}

def stock_policies() -> list[dict]:
    policies = [V53_STOCK_POLICY]
    policies += [
        {
            "name": "R1_STRONG_1.25",
            "rank1Tiers": [
                {"minBasisBps": 65, "minNetEdgeBps": 5, "gross": 1.0},
                {"minBasisBps": 95, "minNetEdgeBps": 15, "gross": 1.25},
            ],
            "secondaryTiers": [{"minBasisBps": 80, "minNetEdgeBps": 10, "gross": 0.25}],
            "v11Tiers": [{"minBasisBps": 0, "minNetEdgeBps": -999, "gross": 1.0}],
        },
        {
            "name": "R1_STRONG_1.50",
            "rank1Tiers": [
                {"minBasisBps": 65, "minNetEdgeBps": 5, "gross": 1.0},
                {"minBasisBps": 110, "minNetEdgeBps": 20, "gross": 1.50},
            ],
            "secondaryTiers": [{"minBasisBps": 85, "minNetEdgeBps": 10, "gross": 0.25}],
            "v11Tiers": [{"minBasisBps": 0, "minNetEdgeBps": -999, "gross": 1.0}],
        },
        {
            "name": "R1_TIERED_R2_SMALL",
            "rank1Tiers": [
                {"minBasisBps": 65, "minNetEdgeBps": 5, "gross": 0.75},
                {"minBasisBps": 80, "minNetEdgeBps": 10, "gross": 1.00},
                {"minBasisBps": 100, "minNetEdgeBps": 15, "gross": 1.25},
                {"minBasisBps": 120, "minNetEdgeBps": 20, "gross": 1.50},
            ],
            "secondaryTiers": [
                {"minBasisBps": 80, "minNetEdgeBps": 10, "gross": 0.25},
                {"minBasisBps": 110, "minNetEdgeBps": 20, "gross": 0.35},
            ],
            "v11Tiers": [{"minBasisBps": 0, "minNetEdgeBps": -999, "gross": 1.0}],
        },
        {
            "name": "R1_TIERED_R2_STRONG",
            "rank1Tiers": [
                {"minBasisBps": 65, "minNetEdgeBps": 5, "gross": 1.00},
                {"minBasisBps": 90, "minNetEdgeBps": 10, "gross": 1.25},
                {"minBasisBps": 115, "minNetEdgeBps": 20, "gross": 1.50},
            ],
            "secondaryTiers": [
                {"minBasisBps": 90, "minNetEdgeBps": 10, "gross": 0.25},
                {"minBasisBps": 110, "minNetEdgeBps": 20, "gross": 0.35},
                {"minBasisBps": 130, "minNetEdgeBps": 30, "gross": 0.50},
            ],
            "v11Tiers": [{"minBasisBps": 0, "minNetEdgeBps": -999, "gross": 1.0}],
        },
        {
            "name": "R1_CONCENTRATED",
            "rank1Tiers": [
                {"minBasisBps": 80, "minNetEdgeBps": 10, "gross": 1.00},
                {"minBasisBps": 100, "minNetEdgeBps": 20, "gross": 1.25},
                {"minBasisBps": 120, "minNetEdgeBps": 30, "gross": 1.50},
            ],
            "secondaryTiers": [
                {"minBasisBps": 100, "minNetEdgeBps": 20, "gross": 0.25},
                {"minBasisBps": 130, "minNetEdgeBps": 30, "gross": 0.50},
            ],
            "v11Tiers": [{"minBasisBps": 0, "minNetEdgeBps": -999, "gross": 1.0}],
        },
        {
            "name": "V11_TIERED",
            "rank1Tiers": [
                {"minBasisBps": 65, "minNetEdgeBps": 5, "gross": 1.00},
                {"minBasisBps": 100, "minNetEdgeBps": 15, "gross": 1.25},
            ],
            "secondaryTiers": [{"minBasisBps": 85, "minNetEdgeBps": 10, "gross": 0.25}],
            "v11Tiers": [
                {"minBasisBps": 0, "minNetEdgeBps": -999, "gross": 0.75},
                {"minBasisBps": 80, "minNetEdgeBps": 10, "gross": 1.00},
                {"minBasisBps": 110, "minNetEdgeBps": 20, "gross": 1.25},
                {"minBasisBps": 140, "minNetEdgeBps": 30, "gross": 1.50},
            ],
        },
        {
            "name": "V11_STRONG_ONLY",
            "rank1Tiers": [
                {"minBasisBps": 65, "minNetEdgeBps": 5, "gross": 1.00},
                {"minBasisBps": 100, "minNetEdgeBps": 15, "gross": 1.25},
            ],
            "secondaryTiers": [{"minBasisBps": 85, "minNetEdgeBps": 10, "gross": 0.25}],
            "v11Tiers": [
                {"minBasisBps": 65, "minNetEdgeBps": 10, "gross": 0.75},
                {"minBasisBps": 90, "minNetEdgeBps": 15, "gross": 1.00},
                {"minBasisBps": 120, "minNetEdgeBps": 25, "gross": 1.25},
            ],
        },
        {
            "name": "FULL_QUALITY_CONCENTRATION",
            "rank1Tiers": [
                {"minBasisBps": 75, "minNetEdgeBps": 10, "gross": 1.00},
                {"minBasisBps": 95, "minNetEdgeBps": 15, "gross": 1.25},
                {"minBasisBps": 115, "minNetEdgeBps": 25, "gross": 1.50},
            ],
            "secondaryTiers": [
                {"minBasisBps": 95, "minNetEdgeBps": 15, "gross": 0.25},
                {"minBasisBps": 125, "minNetEdgeBps": 30, "gross": 0.50},
            ],
            "v11Tiers": [
                {"minBasisBps": 60, "minNetEdgeBps": 10, "gross": 0.75},
                {"minBasisBps": 90, "minNetEdgeBps": 15, "gross": 1.00},
                {"minBasisBps": 120, "minNetEdgeBps": 25, "gross": 1.25},
            ],
        },
    ]
    return policies

def load_ledgers(v12_path: Path, pengu_path: Path) -> tuple[dict, dict]:
    v12 = base.load_json(v12_path)
    pengu = base.load_json(pengu_path)
    if v12.get("schema") != "v12-combined-bt-ledger/v1":
        raise RuntimeError("Unexpected V12 ledger schema")
    if pengu.get("strategyId") != "PENGU_DUAL_LS_V2_FINAL":
        raise RuntimeError("Unexpected PENGU ledger")
    return v12, pengu

def evaluate_with_folds(
    case_id: str,
    v12: dict,
    pengu: dict,
    v11: list[dict],
    v50: list[dict],
    policy: dict,
    long_mult: float,
    short_mult: float,
    baseline_fold_blocks: list[dict],
    bounds: list[tuple[int, int]],
    selection_start: int,
    selection_end: int,
    **meta: Any,
) -> dict:
    overall = eval_case(v12, pengu, v11, v50, policy, long_mult, short_mult, selection_start, selection_end)
    summary = summarize(case_id, overall, **meta)
    summary["foldDiagnostics"] = fold_diagnostics(
        v12, pengu, v11, v50, policy, long_mult, short_mult, baseline_fold_blocks, bounds
    )
    return summary

def analyze(stock_cache: Path, v12_path: Path, pengu_path: Path, output_dir: Path) -> dict:
    v12, pengu = load_ledgers(v12_path, pengu_path)
    v11, target_days, aligned, stock_diag = load_stock_state(stock_cache)
    selection_start = base.START_MS
    selection_end = base.HOLDOUT_START_MS
    holdout_start = base.HOLDOUT_START_MS
    holdout_end = base.END_MS
    folds = fold_bounds(selection_start, selection_end, 4)

    baseline_v50 = build_v50_rows(BASELINE_STRUCTURE, target_days, aligned)
    baseline_selection = eval_case(
        v12, pengu, v11, baseline_v50, V53_STOCK_POLICY, 1.0, 1.0, selection_start, selection_end
    )
    baseline_fold_blocks = [
        eval_case(v12, pengu, v11, baseline_v50, V53_STOCK_POLICY, 1.0, 1.0, left, right)
        for left, right in folds
    ]
    baseline_full = eval_case(
        v12, pengu, v11, baseline_v50, V53_STOCK_POLICY, 1.0, 1.0, base.START_MS, base.END_MS
    )
    baseline_holdout = eval_case(
        v12, pengu, v11, baseline_v50, V53_STOCK_POLICY, 1.0, 1.0, holdout_start, holdout_end
    )
    baseline_full_summary = summarize(
        "V53_WINNER_REFERENCE", baseline_full, structure=asdict(BASELINE_STRUCTURE),
        stockPolicy=V53_STOCK_POLICY, penguLongMultiplier=1.0, penguShortMultiplier=1.0
    )
    baseline_holdout_summary = summarize("V53_WINNER_REFERENCE_HOLDOUT", baseline_holdout)
    reproduction = {
        "fullReturnDeltaVsV53ReportedPctPoint": baseline_full_summary["normalWorstReturnPct"] - V53_EXPECTED_FULL_RETURN,
        "holdoutReturnDeltaVsV53ReportedPctPoint": baseline_holdout_summary["normalWorstReturnPct"] - V53_EXPECTED_HOLDOUT_RETURN,
    }

    # Phase A: broad structural search. Cheap overall screen first; folds only for leaders.
    phase_a_screen = []
    phase_a_cache: dict[str, tuple[StructureSpec, list[dict]]] = {}
    for window_set in WINDOW_SETS:
        for hold in HOLD_HOURS:
            for direction in DIRECTIONS:
                for depth in SELECTION_DEPTHS:
                    for rank_mode in RANK_MODES:
                        spec = StructureSpec(
                            window_set=window_set, hold_hours=hold, direction=direction,
                            selection_depth=depth, rank_mode=rank_mode,
                        )
                        cid = f"A_{window_set}_H{hold}_{direction}_D{depth}_{rank_mode}"
                        rows = build_v50_rows(spec, target_days, aligned)
                        phase_a_cache[cid] = (spec, rows)
                        block = eval_case(
                            v12, pengu, v11, rows, V53_STOCK_POLICY, 1.0, 1.0,
                            selection_start, selection_end
                        )
                        phase_a_screen.append(summarize(cid, block, structure=asdict(spec)))
    phase_a_screen.sort(key=lambda row: (-finite(row["score"]), row["caseId"]))
    phase_a = []
    for row in phase_a_screen[:30]:
        spec, rows = phase_a_cache[row["caseId"]]
        detailed = evaluate_with_folds(
            row["caseId"], v12, pengu, v11, rows, V53_STOCK_POLICY, 1.0, 1.0,
            baseline_fold_blocks, folds, selection_start, selection_end,
            structure=asdict(spec)
        )
        detailed["eligible"] = bool(
            detailed["foldDiagnostics"]["wins"] >= 3
            and detailed["foldDiagnostics"]["nonnegativeFolds"] >= 3
            and detailed["normalWorstReturnPct"] >= worst(baseline_selection, "NORMAL", "compoundedReturnPct")
            and detailed["severeWorstReturnPct"] > 0
        )
        phase_a.append(detailed)
    phase_a.sort(key=lambda row: (not row["eligible"], -finite(row["score"]), row["caseId"]))
    phase_a_winner = phase_a[0]
    if not phase_a_winner["eligible"]:
        phase_a_winner = evaluate_with_folds(
            "A_BASELINE", v12, pengu, v11, baseline_v50, V53_STOCK_POLICY, 1.0, 1.0,
            baseline_fold_blocks, folds, selection_start, selection_end,
            structure=asdict(BASELINE_STRUCTURE)
        )
    struct_a = StructureSpec(**phase_a_winner["structure"])

    # Phase B: exit/risk geometry around the best structure.
    phase_b_screen = []
    phase_b_cache: dict[str, tuple[StructureSpec, list[dict]]] = {}
    for ratio in CONVERGENCE_RATIOS:
        for stop in STOP_MULTIPLES:
            for adverse in ADVERSE_LIMITS:
                for basis_floor in ENTRY_BASIS_FLOORS:
                    spec = StructureSpec(
                        window_set=struct_a.window_set,
                        hold_hours=struct_a.hold_hours,
                        direction=struct_a.direction,
                        selection_depth=struct_a.selection_depth,
                        rank_mode=struct_a.rank_mode,
                        convergence_ratio=ratio,
                        stop_multiple=stop,
                        maximum_adverse_bps=adverse,
                        minimum_basis_bps=basis_floor,
                    )
                    ratio_id = "BASE" if ratio is None else str(ratio).replace(".", "p")
                    cid = f"B_R{ratio_id}_S{stop:g}_A{adverse:g}_B{basis_floor:g}"
                    rows = build_v50_rows(spec, target_days, aligned)
                    phase_b_cache[cid] = (spec, rows)
                    block = eval_case(
                        v12, pengu, v11, rows, V53_STOCK_POLICY, 1.0, 1.0,
                        selection_start, selection_end
                    )
                    phase_b_screen.append(summarize(cid, block, structure=asdict(spec)))
    phase_b_screen.sort(key=lambda row: (-finite(row["score"]), row["caseId"]))
    phase_b = []
    for row in phase_b_screen[:30]:
        spec, rows = phase_b_cache[row["caseId"]]
        detailed = evaluate_with_folds(
            row["caseId"], v12, pengu, v11, rows, V53_STOCK_POLICY, 1.0, 1.0,
            baseline_fold_blocks, folds, selection_start, selection_end,
            structure=asdict(spec)
        )
        detailed["eligible"] = bool(
            detailed["foldDiagnostics"]["wins"] >= 3
            and detailed["foldDiagnostics"]["nonnegativeFolds"] >= 3
            and detailed["normalWorstReturnPct"] >= worst(baseline_selection, "NORMAL", "compoundedReturnPct")
            and detailed["severeWorstReturnPct"] > 0
        )
        phase_b.append(detailed)
    phase_b.sort(key=lambda row: (not row["eligible"], -finite(row["score"]), row["caseId"]))
    phase_b_winner = phase_b[0]
    if not phase_b_winner["eligible"]:
        phase_b_winner = phase_a_winner
    struct_b = StructureSpec(**phase_b_winner["structure"])
    locked_v50 = build_v50_rows(struct_b, target_days, aligned)

    # Phase C: concentrate stock gross only when ex-ante quality is stronger.
    phase_c = []
    for policy in stock_policies():
        cid = f"C_{policy['name']}"
        detailed = evaluate_with_folds(
            cid, v12, pengu, v11, locked_v50, policy, 1.0, 1.0,
            baseline_fold_blocks, folds, selection_start, selection_end,
            structure=asdict(struct_b), stockPolicy=policy
        )
        detailed["eligible"] = bool(
            detailed["foldDiagnostics"]["wins"] >= 3
            and detailed["foldDiagnostics"]["nonnegativeFolds"] >= 3
            and detailed["normalWorstReturnPct"] >= worst(baseline_selection, "NORMAL", "compoundedReturnPct")
            and detailed["severeWorstReturnPct"] > 0
            and detailed["maxStockGross"] <= STOCK_GROSS_CAP + 1e-9
        )
        phase_c.append(detailed)
    phase_c.sort(key=lambda row: (not row["eligible"], -finite(row["score"]), row["caseId"]))
    phase_c_winner = phase_c[0]
    locked_policy = phase_c_winner.get("stockPolicy", V53_STOCK_POLICY)

    # Phase D: reallocate the fixed crypto envelope toward PENGU by side.
    phase_d = []
    for long_mult in PENGU_MULTIPLIERS:
        for short_mult in PENGU_MULTIPLIERS:
            cid = f"D_PL{long_mult:g}_PS{short_mult:g}"
            detailed = evaluate_with_folds(
                cid, v12, pengu, v11, locked_v50, locked_policy, long_mult, short_mult,
                baseline_fold_blocks, folds, selection_start, selection_end,
                structure=asdict(struct_b), stockPolicy=locked_policy,
                penguLongMultiplier=long_mult, penguShortMultiplier=short_mult
            )
            detailed["eligible"] = bool(
                detailed["foldDiagnostics"]["wins"] >= 3
                and detailed["foldDiagnostics"]["nonnegativeFolds"] >= 3
                and detailed["normalWorstReturnPct"] >= worst(baseline_selection, "NORMAL", "compoundedReturnPct")
                and detailed["severeWorstReturnPct"] > 0
                and detailed["maxCryptoGross"] <= CRYPTO_GROSS_CAP + 1e-9
            )
            phase_d.append(detailed)
    phase_d.sort(key=lambda row: (not row["eligible"], -finite(row["score"]), row["caseId"]))
    phase_d_winner = phase_d[0]
    long_winner = finite(phase_d_winner.get("penguLongMultiplier"), 1.0)
    short_winner = finite(phase_d_winner.get("penguShortMultiplier"), 1.0)

    # Candidate now frozen. Reused holdout is opened only after all selection phases.
    winner_selection = eval_case(
        v12, pengu, v11, locked_v50, locked_policy, long_winner, short_winner,
        selection_start, selection_end
    )
    winner_holdout = eval_case(
        v12, pengu, v11, locked_v50, locked_policy, long_winner, short_winner,
        holdout_start, holdout_end
    )
    winner_full = eval_case(
        v12, pengu, v11, locked_v50, locked_policy, long_winner, short_winner,
        base.START_MS, base.END_MS
    )
    winner_full_summary = summarize(
        "V54_WINNER", winner_full, structure=asdict(struct_b), stockPolicy=locked_policy,
        penguLongMultiplier=long_winner, penguShortMultiplier=short_winner
    )
    winner_holdout_summary = summarize("V54_WINNER_REUSED_HOLDOUT", winner_holdout)

    fold_diag_final = fold_diagnostics(
        v12, pengu, v11, locked_v50, locked_policy, long_winner, short_winner,
        baseline_fold_blocks, folds
    )
    full_gain = winner_full_summary["normalWorstReturnPct"] - baseline_full_summary["normalWorstReturnPct"]
    checks = {
        "v53ReferenceReproducedWithin0_1pp": abs(reproduction["fullReturnDeltaVsV53ReportedPctPoint"]) <= 0.1,
        "selectionFoldWinsAtLeast3of4": fold_diag_final["wins"] >= 3,
        "significantFullGainAtLeast30pp": full_gain >= SIGNIFICANT_FULL_GAIN_PCT_POINT,
        "fullPfNotWorse": winner_full_summary["normalWorstPf"] >= baseline_full_summary["normalWorstPf"],
        "fullDdNoWorseThan3pp": winner_full_summary["normalWorstDdPct"] >= baseline_full_summary["normalWorstDdPct"] - 3.0,
        "severeReturnAtLeast90PctOfV53": winner_full_summary["severeWorstReturnPct"] >= 0.90 * baseline_full_summary["severeWorstReturnPct"],
        "reusedHoldoutPositive": winner_holdout_summary["normalWorstReturnPct"] > 0,
        "reusedHoldoutPfAtLeast1_5": winner_holdout_summary["normalWorstPf"] >= 1.50,
        "globalGrossAtMost2_5": winner_full_summary["maxTotalGross"] <= TOTAL_GROSS_CAP + 1e-9,
        "stockGrossAtMost1_5": winner_full_summary["maxStockGross"] <= STOCK_GROSS_CAP + 1e-9,
        "cryptoGrossAtMost1_5": winner_full_summary["maxCryptoGross"] <= CRYPTO_GROSS_CAP + 1e-9,
        "v50ConcurrentAtMost2": winner_full_summary["maxV50Concurrent"] <= MAX_STOCK_POSITIONS,
    }
    status = (
        "V54_STRUCTURAL_ALPHA_SIGNIFICANT_PASS_RESEARCH_ONLY"
        if all(checks.values())
        else "V54_STRUCTURAL_ALPHA_NO_SIGNIFICANT_PROMOTION"
    )

    payload = {
        "schema": "v54-structural-alpha/v1",
        "status": status,
        "hurdle": {
            "reference": "V53 research winner",
            "minimumFullGainPctPoint": SIGNIFICANT_FULL_GAIN_PCT_POINT,
            "reportedV53FullReturnPct": V53_EXPECTED_FULL_RETURN,
            "reportedV53ReusedHoldoutReturnPct": V53_EXPECTED_HOLDOUT_RETURN,
        },
        "baseline": {
            "full": baseline_full_summary,
            "reusedHoldout": baseline_holdout_summary,
            "reproduction": rounded(reproduction),
        },
        "phaseA": {
            "purpose": "window / hold / direction / selection-depth / ranking structure",
            "searchedCases": len(phase_a_screen),
            "topScreen": phase_a_screen[:15],
            "foldValidated": phase_a[:10],
            "winner": phase_a_winner,
        },
        "phaseB": {
            "purpose": "partial-convergence exit / stop / adverse / entry basis geometry",
            "searchedCases": len(phase_b_screen),
            "topScreen": phase_b_screen[:15],
            "foldValidated": phase_b[:10],
            "winner": phase_b_winner,
        },
        "phaseC": {
            "purpose": "quality-tiered V50/V11 stock sizing under unchanged stock gross cap",
            "cases": phase_c,
            "winner": phase_c_winner,
        },
        "phaseD": {
            "purpose": "PENGU side-specific gross reallocation under unchanged 1.5 crypto cap",
            "cases": phase_d[:15],
            "winner": phase_d_winner,
        },
        "winner": {
            "structure": asdict(struct_b),
            "stockPolicy": locked_policy,
            "penguLongMultiplier": long_winner,
            "penguShortMultiplier": short_winner,
            "selection": summarize("V54_WINNER_SELECTION", winner_selection),
            "full": winner_full_summary,
            "reusedHoldout": winner_holdout_summary,
            "selectionFoldDiagnostics": fold_diag_final,
            "fullGainVsV53PctPoint": round(full_gain, 8),
        },
        "checks": checks,
        "stockDiagnostics": stock_diag,
        "sourceLineage": {
            "liveBaseSha": "ef91f81e86f819ba1e37ff9325e8972489e1544f",
            "v53ResearchSha": "77b94d55903c9cd40a11a7fdb8fb5aa7f16d94a5",
            "freshLedgerRunId": 32783392588,
            "freshLedgerArtifactId": 9540872862,
            "v52Top2ResearchSha": "2ca2faf08653e0a7e1f230af0e9d57bc12710065",
        },
        "selectionDiscipline": {
            "searchUsesOnlyPreHoldoutPeriod": True,
            "selectionFolds": 4,
            "reusedHoldoutIndependentClaim": False,
            "note": "The 2026-05-29 onward segment has been viewed in prior V53 research, so it is confirmation-only, not an untouched holdout.",
        },
        "safety": {
            "mode": "RESEARCH_ONLY",
            "ordersSent": False,
            "liveChanged": False,
            "vpsChanged": False,
            "productionChanged": False,
            "globalGrossCap": TOTAL_GROSS_CAP,
            "stockGrossCap": STOCK_GROSS_CAP,
            "cryptoGrossCap": CRYPTO_GROSS_CAP,
            "maxStockPositions": MAX_STOCK_POSITIONS,
            "v50MaxDailyTrades": V50_MAX_DAILY_TRADES,
        },
        "limitations": [
            "PENGU multipliers above 1.0 are research-only synthetic sizing changes and are not authorized by the current production maximumGross=0.75 contract.",
            "The confirmation segment is reused history and cannot support an untouched-holdout claim.",
            "Historical stock/perp checkpoints do not prove live fill quality; production promotion requires a separate implementation and safety review.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "result.json").write_text(json.dumps(rounded(payload), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    summary = {
        "status": status,
        "baselineFullReturnPct": baseline_full_summary["normalWorstReturnPct"],
        "winnerFullReturnPct": winner_full_summary["normalWorstReturnPct"],
        "fullGainVsV53PctPoint": full_gain,
        "baselinePf": baseline_full_summary["normalWorstPf"],
        "winnerPf": winner_full_summary["normalWorstPf"],
        "baselineDdPct": baseline_full_summary["normalWorstDdPct"],
        "winnerDdPct": winner_full_summary["normalWorstDdPct"],
        "winnerStructure": asdict(struct_b),
        "winnerStockPolicy": locked_policy["name"],
        "penguLongMultiplier": long_winner,
        "penguShortMultiplier": short_winner,
        "reusedHoldoutReturnPct": winner_holdout_summary["normalWorstReturnPct"],
        "reusedHoldoutPf": winner_holdout_summary["normalWorstPf"],
        "checks": checks,
    }
    print("FINAL_SUMMARY_JSON=" + json.dumps(rounded(summary), separators=(",", ":"), ensure_ascii=False))
    return payload

def self_test() -> None:
    assert TOTAL_GROSS_CAP == 2.5
    assert STOCK_GROSS_CAP == 1.5
    assert CRYPTO_GROSS_CAP == 1.5
    assert BASELINE_STRUCTURE.window_set == "POST_EARLY3"
    assert BASELINE_STRUCTURE.hold_hours == 4
    assert V53_STOCK_POLICY["secondaryTiers"][0]["gross"] == 0.25
    assert max(PENGU_MULTIPLIERS) == 2.0
    test_tiers = [
        {"minBasisBps": 65, "minNetEdgeBps": 5, "gross": 1.0},
        {"minBasisBps": 100, "minNetEdgeBps": 10, "gross": 1.25},
    ]
    assert choose_gross(test_tiers, 110, 20) == 1.25
    assert choose_gross(test_tiers, 60, 20) is None
    assert len(fold_bounds(0, 100, 4)) == 4
    print("V54 structural alpha self-test: PASS")

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--v12-ledger", default=".research-state/v12-pengu-v52-top2/v12-ledgers.json")
    parser.add_argument("--pengu-ledger", default=".research-state/v12-pengu-v52-top2/pengu-v2-ledgers.json")
    parser.add_argument("--output-dir", default=".research-state/v54-structural-alpha")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    analyze(Path(args.stock_cache_dir), Path(args.v12_ledger), Path(args.pengu_ledger), Path(args.output_dir))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
