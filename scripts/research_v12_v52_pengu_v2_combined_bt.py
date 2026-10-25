from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

UTC = dt.timezone.utc
REPO_ROOT = Path(__file__).resolve().parent.parent
STOCK_ROOT = REPO_ROOT / ".stock-research"
sys.path.insert(0, str(STOCK_ROOT / "scripts"))

import research_lab_v96_v52_dual_slot_one_year_bt as legacy

stock = legacy.stock

START = dt.datetime(2025, 8, 10, tzinfo=UTC)
END = dt.datetime(2026, 8, 10, tzinfo=UTC)
START_MS = int(START.timestamp() * 1000)
END_MS = int(END.timestamp() * 1000)

TOTAL_GROSS_CAP = 2.5
CRYPTO_GROSS_CAP = 1.5
STOCK_GROSS_CAP = 1.5
PENGU_MAX_GROSS = 0.75
PENGU_PORTFOLIO_GROSS_CAP = 1.5
V11_GROSS_CAP = 1.0
V50_GROSS_CAP = 1.0
FIRST_STOCK_MIN_GROSS = 0.5
SECOND_STOCK_MIN_GROSS = 0.25
STOCK_DAILY_LOSS_LIMIT = -0.035
CRYPTO_DAILY_LOSS_LIMIT = -0.05

V12_MULTIPLIERS = (0.25, 0.50, 0.75, 1.00)
V12_ENTRY_POLICIES = ("ALL", "US_RTH_OFF", "JST_00_08", "JST_08_16", "JST_16_24")
PRIORITY_ORDERS = ("CRYPTO_FIRST", "STOCK_FIRST")
ROUTING_VARIANTS = PRIORITY_ORDERS + ("DYNAMIC_SCORE",)
DEFAULT_MAX_BT_BONUS = 10.0
MIN_CONFIDENT_TRADES = 50.0
FULL_OBSERVATION_DAYS = 90.0
BT_PRIOR_TABLE_VERSION = "explicit-input-only/v1"
BT_PRIOR_TRAINING_PERIOD = None
NEUTRAL_MARKET_FIT_SCORE = 0.0
NEUTRAL_MARKET_FIT_SOURCE = "neutral_fallback:ledger_missing_causal_market_fit"
SCENARIOS = {
    "NORMAL": {"ledgerMode": "normal", "stockCostBps": float(stock.SCENARIOS["NORMAL"])},
    "SEVERE": {"ledgerMode": "stress", "stockCostBps": float(stock.SCENARIOS["SEVERE"])},
}


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 8)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def normalized(value: Any) -> float:
    return min(1.0, max(0.0, finite(value)))


def calculate_bt_prior_bonus(prior: dict, max_bonus: float = DEFAULT_MAX_BT_BONUS) -> float:
    """Port Task 1's bounded prior formula without using the current trade PnL."""
    performance = (
        0.30 * normalized(finite(prior.get("returnPct")) / 50.0)
        + 0.25 * normalized((finite(prior.get("profitFactor")) - 1.0) / 2.0)
        + 0.20 * normalized((finite(prior.get("winRatePct")) - 50.0) / 30.0)
        + 0.25 * normalized(1.0 - finite(prior.get("maxDrawdownPct")) / 50.0)
    )
    trade_confidence = normalized(finite(prior.get("tradeCount")) / MIN_CONFIDENT_TRADES)
    observation_confidence = normalized(finite(prior.get("observationDays")) / FULL_OBSERVATION_DAYS)
    return max(0.0, finite(max_bonus, 0.0)) * performance * trade_confidence * observation_confidence


def score_dynamic_candidate(candidate: dict, max_bonus: float = DEFAULT_MAX_BT_BONUS) -> dict:
    prior = candidate.get("btPrior")
    bt_prior_bonus = calculate_bt_prior_bonus(prior, max_bonus) if isinstance(prior, dict) else 0.0
    final_score = (
        finite(candidate.get("marketFitScore"))
        + bt_prior_bonus
        - max(0.0, finite(candidate.get("correlationPenalty")))
        - max(0.0, finite(candidate.get("concentrationPenalty")))
        - max(0.0, finite(candidate.get("stalePenalty")))
    )
    return {"btPriorBonus": bt_prior_bonus, "finalScore": final_score}


def allocate_dynamic_gross(
    candidates: Sequence[dict],
    crypto_gross_available: float,
    stock_gross_available: float,
    total_gross_available: float,
    equity_usd: float,
    max_bt_bonus: float = DEFAULT_MAX_BT_BONUS,
) -> dict:
    """Deterministic gross-unit parity implementation of the Task 1 allocator."""
    class_capacity = {
        "CRYPTO": max(0.0, finite(crypto_gross_available)),
        "STOCK": max(0.0, finite(stock_gross_available)),
    }
    total_capacity = max(0.0, finite(total_gross_available))
    rejected: List[dict] = []
    eligible: List[dict] = []

    for candidate in candidates:
        score = score_dynamic_candidate(candidate, max_bt_bonus)
        asset_class = str(candidate.get("assetClass"))
        if asset_class not in class_capacity:
            rejected.append({"id": str(candidate.get("id")), "reason": "INVALID_ASSET_CLASS"})
            continue
        min_gross = max(0.0, finite(candidate.get("minGross")))
        max_gross = max(0.0, finite(candidate.get("maxGross")))
        min_notional = candidate.get("minNotionalUsd")
        try:
            parsed_notional = None if min_notional is None else float(min_notional)
        except (TypeError, ValueError):
            parsed_notional = math.nan
        if parsed_notional is None or parsed_notional == 0:
            notional_gross = 0.0
        elif not math.isfinite(parsed_notional) or parsed_notional < 0 or not math.isfinite(equity_usd) or equity_usd <= 0:
            notional_gross = math.inf
        else:
            notional_gross = parsed_notional / equity_usd
        minimum = max(min_gross, notional_gross)
        reason = "MIN_NOTIONAL_NOT_MET" if notional_gross > min_gross else "MIN_GROSS_NOT_MET"
        if not math.isfinite(minimum) or minimum <= 0 or max_gross < minimum or class_capacity[asset_class] <= 0 or total_capacity <= 0:
            rejected.append({"id": str(candidate.get("id")), "reason": reason})
            continue
        target = max(minimum, min(max_gross, max(0.0, finite(candidate.get("targetGross")))))
        eligible.append({
            **candidate,
            **score,
            "assetClass": asset_class,
            "minGross": minimum,
            "targetGross": target,
            "maxGross": max_gross,
            "allocatedGross": 0.0,
        })

    eligible.sort(key=lambda item: (-finite(item.get("finalScore")), str(item.get("id"))))
    total_remaining = total_capacity
    class_remaining = dict(class_capacity)
    admitted: List[dict] = []
    for item in eligible:
        asset_class = str(item["assetClass"])
        if item["minGross"] > total_remaining + 1e-12 or item["minGross"] > class_remaining[asset_class] + 1e-12:
            rejected.append({"id": str(item["id"]), "reason": "MIN_GROSS_NOT_MET"})
            continue
        item["allocatedGross"] = item["minGross"]
        total_remaining -= item["minGross"]
        class_remaining[asset_class] -= item["minGross"]
        admitted.append(item)

    for _ in range(len(admitted)):
        if total_remaining <= 1e-12:
            break
        open_items = [
            item for item in admitted
            if item["allocatedGross"] < item["targetGross"] - 1e-12
            and class_remaining[item["assetClass"]] > 1e-12
            and finite(item.get("finalScore")) > 0
        ]
        weight_sum = sum(
            finite(item.get("finalScore")) * max(0.0, item["targetGross"] - item["allocatedGross"])
            for item in open_items
        )
        if not open_items or weight_sum <= 0:
            break
        proposals = [
            (item, total_remaining * finite(item.get("finalScore")) * max(0.0, item["targetGross"] - item["allocatedGross"]) / weight_sum)
            for item in open_items
        ]
        class_proposals = {"CRYPTO": 0.0, "STOCK": 0.0}
        for item, amount in proposals:
            class_proposals[item["assetClass"]] += amount
        class_scale = {
            asset_class: class_remaining[asset_class] / class_proposals[asset_class]
            if class_proposals[asset_class] > class_remaining[asset_class] else 1.0
            for asset_class in class_remaining
        }
        distributed = 0.0
        for item, proposed in proposals:
            amount = min(
                proposed * class_scale[item["assetClass"]],
                max(0.0, item["targetGross"] - item["allocatedGross"]),
            )
            item["allocatedGross"] += amount
            class_remaining[item["assetClass"]] -= amount
            distributed += amount
        total_remaining -= distributed
        if distributed <= 1e-12:
            break

    rejected.sort(key=lambda item: str(item["id"]))
    allocations = [
        {key: value for key, value in item.items() if not key.startswith("_")}
        for item in admitted
    ]
    crypto_allocated = sum(item["allocatedGross"] for item in allocations if item["assetClass"] == "CRYPTO")
    stock_allocated = sum(item["allocatedGross"] for item in allocations if item["assetClass"] == "STOCK")
    return {
        "allocations": allocations,
        "rejected": rejected,
        "residual": {
            "cryptoGross": max(0.0, class_capacity["CRYPTO"] - crypto_allocated),
            "stockGross": max(0.0, class_capacity["STOCK"] - stock_allocated),
            "totalGross": max(0.0, total_capacity - crypto_allocated - stock_allocated),
        },
    }


def _market_fit_fields(trade: dict) -> tuple[float, str]:
    raw = trade.get("marketFitScore", trade.get("market_fit_score"))
    score = finite(raw, math.nan)
    if math.isfinite(score):
        return score, str(trade.get("marketFitScoreSource") or trade.get("scoreSource") or "ledger:marketFitScore")
    return NEUTRAL_MARKET_FIT_SCORE, NEUTRAL_MARKET_FIT_SOURCE


def _prior_for(strategy: str, trade: dict, prior_table: dict | None) -> dict | None:
    explicit = trade.get("btPrior")
    if isinstance(explicit, dict):
        return explicit
    if not isinstance(prior_table, dict):
        return None
    strategies = prior_table.get("strategies") if isinstance(prior_table.get("strategies"), dict) else prior_table
    row = strategies.get(strategy)
    if isinstance(row, dict) and isinstance(row.get("metrics"), dict):
        return row["metrics"]
    return row if isinstance(row, dict) else None


def _dynamic_candidate(kind: str, trade: dict, v12_multiplier: float, active_stock_count: int, prior_table: dict | None) -> dict | None:
    market_fit_score, score_source = _market_fit_fields(trade)
    strategy = "V12" if kind == "V12_ENTRY" else "PENGU_DUAL_LS_V2" if kind == "PENGU_ENTRY" else str(trade["strategy"])
    if kind == "V12_ENTRY":
        requested = max(0.0, finite(trade.get("requestedGross")) * v12_multiplier)
        asset_class = "CRYPTO"
        default_minimum = min(requested, 0.01)
        default_maximum = min(requested, CRYPTO_GROSS_CAP)
        symbol = str(trade.get("symbol") or "V12")
    elif kind == "PENGU_ENTRY":
        requested = min(PENGU_MAX_GROSS, max(0.0, finite(trade.get("requestedGross"))))
        asset_class = "CRYPTO"
        default_minimum = min(requested, 0.05)
        default_maximum = min(requested, PENGU_MAX_GROSS)
        symbol = str(trade.get("symbol") or "PENGUUSDT")
    else:
        requested = V11_GROSS_CAP if strategy == "V11_EQ" else V50_GROSS_CAP
        asset_class = "STOCK"
        default_minimum = FIRST_STOCK_MIN_GROSS if active_stock_count == 0 else SECOND_STOCK_MIN_GROSS
        default_maximum = requested
        symbol = str(trade["symbol"])
    if requested <= 0:
        return None
    return {
        "id": str(trade.get("dynamicId") or f"{strategy}:{symbol}"),
        "strategy": strategy,
        "symbol": symbol,
        "assetClass": asset_class,
        "marketFitScore": market_fit_score,
        "scoreSource": score_source,
        "targetGross": finite(trade.get("targetGross"), requested),
        "minGross": finite(trade.get("minGross"), default_minimum),
        "maxGross": finite(trade.get("maxGross"), default_maximum),
        "minNotionalUsd": trade.get("minNotionalUsd"),
        "btPrior": _prior_for(strategy, trade, prior_table),
        "correlationPenalty": trade.get("correlationPenalty"),
        "concentrationPenalty": trade.get("concentrationPenalty"),
        "stalePenalty": trade.get("stalePenalty"),
        "requestedGross": requested,
    }


def simulate_dynamic_score(
    v12_trades: Sequence[dict],
    pengu_trades: Sequence[dict],
    v11_rows: Sequence[dict],
    v50_rows: Sequence[dict],
    v12_multiplier: float,
    stock_cost_bps: float,
    prior_table: dict | None = None,
) -> dict:
    timeline: List[dict] = []
    sequence = 0

    def add_entry(kind: str, trade: dict) -> None:
        nonlocal sequence
        if START_MS <= int(trade["entryTs"]) < END_MS:
            timeline.append({"kind": kind, "ts": int(trade["entryTs"]), "trade": trade, "priority": 1, "sequence": sequence})
            sequence += 1

    if v12_multiplier > 0:
        for trade in v12_trades:
            add_entry("V12_ENTRY", trade)
    for trade in pengu_trades:
        add_entry("PENGU_ENTRY", trade)
    for trade in list(v11_rows) + list(v50_rows):
        add_entry("STOCK_ENTRY", trade)
    timeline.sort(key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"]), str(row.get("trade", {}).get("symbol", "")), int(row.get("sequence", 0))))

    active_v12: dict | None = None
    active_pengu: dict | None = None
    active_stock: Dict[str, dict] = {}
    events: List[dict] = []
    equity_path: List[dict] = [{"ts": START_MS, "equity": 1.0}]
    stats: Counter[str] = Counter()
    equity = 1.0
    current_day: str | None = None
    day_start_equity = 1.0
    stock_day_pnl = crypto_day_pnl = 0.0
    stock_latched = crypto_latched = False
    max_v12 = max_pengu = max_stock = max_crypto = max_total = 0.0
    candidate_snapshots: List[dict] = []
    allocation_snapshots: List[dict] = []
    rejection_snapshots: List[dict] = []
    sleeve_totals = {
        "V12": {"candidates": 0, "accepted": 0, "allocatedGross": 0.0, "requestedGross": 0.0, "btPriorBonus": 0.0, "capacityBlocks": 0},
        "PENGU": {"candidates": 0, "accepted": 0, "allocatedGross": 0.0, "requestedGross": 0.0, "btPriorBonus": 0.0, "capacityBlocks": 0},
        "STOCK": {"candidates": 0, "accepted": 0, "allocatedGross": 0.0, "requestedGross": 0.0, "btPriorBonus": 0.0, "capacityBlocks": 0},
    }

    def v12_gross() -> float:
        return finite(active_v12.get("allocatedGross")) if active_v12 else 0.0

    def pengu_gross() -> float:
        return finite(active_pengu.get("allocatedGross")) if active_pengu else 0.0

    def stock_gross() -> float:
        return sum(finite(position.get("allocatedGross")) for position in active_stock.values())

    def observe() -> None:
        nonlocal max_v12, max_pengu, max_stock, max_crypto, max_total
        vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
        max_v12 = max(max_v12, vg)
        max_pengu = max(max_pengu, pg)
        max_stock = max(max_stock, sg)
        max_crypto = max(max_crypto, vg + pg)
        max_total = max(max_total, vg + pg + sg)

    def reset_day(ts: int) -> None:
        nonlocal current_day, day_start_equity, stock_day_pnl, crypto_day_pnl, stock_latched, crypto_latched
        day = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).date().isoformat()
        if day != current_day:
            current_day = day
            day_start_equity = equity
            stock_day_pnl = 0.0
            crypto_day_pnl = 0.0
            stock_latched = False
            crypto_latched = False

    def realize(ts: int, position: dict, strategy: str) -> None:
        nonlocal equity, stock_day_pnl, crypto_day_pnl, stock_latched, crypto_latched
        pnl = finite(position["entryNotional"]) * finite(position["netUnitReturn"])
        before = max(0.001, equity)
        equity = max(0.001, equity + pnl)
        event_return = pnl / before
        events.append({
            "ts": ts,
            "strategy": strategy,
            "symbol": position.get("symbol"),
            "pnl": pnl,
            "eventReturn": event_return,
            "allocatedGross": finite(position.get("allocatedGross")),
            "requestedGross": finite(position.get("requestedGross")),
            "exitReason": position.get("exitReason"),
        })
        equity_path.append({"ts": ts, "equity": equity})
        if strategy in ("V12", "PENGU_DUAL_LS_V2"):
            crypto_day_pnl += pnl
            if not crypto_latched and crypto_day_pnl / max(0.001, day_start_equity) <= CRYPTO_DAILY_LOSS_LIMIT:
                crypto_latched = True
                stats["CRYPTO_DAILY_LOSS_LATCHES"] += 1
        else:
            stock_day_pnl += pnl
            if not stock_latched and stock_day_pnl / max(0.001, day_start_equity) <= STOCK_DAILY_LOSS_LIMIT:
                stock_latched = True
                stats["STOCK_DAILY_LOSS_LATCHES"] += 1

    def sort_future(start: int) -> None:
        timeline[start:] = sorted(
            timeline[start:],
            key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"]), str(row.get("positionId", "")), int(row.get("sequence", 0))),
        )

    def per_sleeve(strategy: str) -> str:
        return "V12" if strategy == "V12" else "PENGU" if strategy == "PENGU_DUAL_LS_V2" else "STOCK"

    index = 0
    while index < len(timeline):
        ts = int(timeline[index]["ts"])
        reset_day(ts)

        while index < len(timeline) and int(timeline[index]["ts"]) == ts and str(timeline[index]["kind"]).endswith("_EXIT"):
            item = timeline[index]
            kind = str(item["kind"])
            if kind == "V12_EXIT":
                if active_v12 is None:
                    stats["V12_EXIT_WITHOUT_ACTIVE"] += 1
                else:
                    position = active_v12
                    active_v12 = None
                    realize(ts, position, "V12")
                    stats["V12_EXITED"] += 1
                    observe()
            elif kind == "PENGU_EXIT":
                if active_pengu is None:
                    stats["PENGU_EXIT_WITHOUT_ACTIVE"] += 1
                else:
                    position = active_pengu
                    active_pengu = None
                    realize(ts, position, "PENGU_DUAL_LS_V2")
                    stats["PENGU_EXITED"] += 1
                    observe()
            elif kind == "STOCK_EXIT":
                position = active_stock.pop(str(item["positionId"]), None)
                if position is None:
                    stats["STOCK_EXIT_WITHOUT_ACTIVE"] += 1
                else:
                    realize(ts, position, str(position["strategy"]))
                    stats[f"{position['strategy']}_EXITED"] += 1
                    observe()
            index += 1

        entries: List[dict] = []
        while index < len(timeline) and int(timeline[index]["ts"]) == ts and not str(timeline[index]["kind"]).endswith("_EXIT"):
            entries.append(timeline[index])
            index += 1
        if not entries:
            continue

        candidates: List[dict] = []
        candidate_trades: Dict[str, dict] = {}
        for item in entries:
            kind = str(item["kind"])
            trade = item["trade"]
            strategy = "V12" if kind == "V12_ENTRY" else "PENGU_DUAL_LS_V2" if kind == "PENGU_ENTRY" else str(trade["strategy"])
            sleeve = per_sleeve(strategy)
            if kind in ("V12_ENTRY", "PENGU_ENTRY") and crypto_latched:
                stats[f"{('V12' if kind == 'V12_ENTRY' else 'PENGU')}_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                continue
            if kind == "V12_ENTRY" and active_v12 is not None:
                stats["V12_SLOT_OCCUPIED"] += 1
                continue
            if kind == "PENGU_ENTRY" and active_pengu is not None:
                stats["PENGU_SLOT_OCCUPIED"] += 1
                continue
            if kind == "STOCK_ENTRY":
                if stock_latched:
                    stats["STOCK_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                    continue
                if any(str(position["strategy"]) == str(trade["strategy"]) for position in active_stock.values()):
                    stats[f"{strategy}_SLOT_OCCUPIED"] += 1
                    continue
                if any(str(position["symbol"]) == str(trade["symbol"]) for position in active_stock.values()):
                    stats["SAME_STOCK_SYMBOL_BLOCKED"] += 1
                    continue
                if stock.unit_trade_value(trade, stock_cost_bps) is None:
                    stats[f"{strategy}_COST_EDGE_REJECTED"] += 1
                    continue
            candidate = _dynamic_candidate(kind, trade, v12_multiplier, len(active_stock), prior_table)
            if candidate is None:
                stats[f"{strategy}_CAPACITY_BLOCKED"] += 1
                continue
            candidate["_kind"] = kind
            candidate["_trade"] = trade
            candidates.append(candidate)
            candidate_trades[str(candidate["id"])] = trade
            sleeve_totals[sleeve]["candidates"] += 1
            sleeve_totals[sleeve]["requestedGross"] += finite(candidate.get("requestedGross"))

        stats["DYNAMIC_SCORE_CANDIDATES"] += len(candidates)
        for candidate in candidates:
            score = score_dynamic_candidate(candidate)
            candidate_snapshots.append({
                "id": candidate["id"],
                "strategy": candidate["strategy"],
                "symbol": candidate["symbol"],
                "marketFitScore": candidate["marketFitScore"],
                "scoreSource": candidate["scoreSource"],
                "btPriorBonus": score["btPriorBonus"],
                "finalScore": score["finalScore"],
                "minGross": candidate["minGross"],
                "targetGross": candidate["targetGross"],
                "maxGross": candidate["maxGross"],
            })

        current_crypto = v12_gross() + pengu_gross()
        current_total = current_crypto + stock_gross()
        crypto_available = max(0.0, CRYPTO_GROSS_CAP - current_crypto)
        stock_available = max(0.0, STOCK_GROSS_CAP - stock_gross())
        total_available = max(0.0, TOTAL_GROSS_CAP - current_total)
        if active_pengu is not None or any(candidate["strategy"] == "PENGU_DUAL_LS_V2" for candidate in candidates):
            total_available = min(total_available, max(0.0, PENGU_PORTFOLIO_GROSS_CAP - current_total))
        allocation = allocate_dynamic_gross(
            candidates,
            crypto_available,
            stock_available,
            total_available,
            equity,
        )
        rejection_snapshots.extend(allocation["rejected"])
        stats["DYNAMIC_SCORE_REJECTED"] += len(allocation["rejected"])
        stats["DYNAMIC_SCORE_CAPACITY_BLOCKED"] += len(allocation["rejected"])
        for rejected in allocation["rejected"]:
            candidate = next((row for row in candidates if str(row["id"]) == str(rejected["id"])), None)
            if candidate is not None:
                sleeve_totals[per_sleeve(str(candidate["strategy"]))]["capacityBlocks"] += 1

        for allocated in allocation["allocations"]:
            candidate_id = str(allocated["id"])
            candidate = next(row for row in candidates if str(row["id"]) == candidate_id)
            trade = candidate_trades[candidate_id]
            strategy = str(candidate["strategy"])
            sleeve = per_sleeve(strategy)
            amount = finite(allocated.get("allocatedGross"))
            if amount <= 1e-12:
                sleeve_totals[sleeve]["capacityBlocks"] += 1
                stats["DYNAMIC_SCORE_CAPACITY_BLOCKED"] += 1
                continue
            if strategy == "V12" and active_v12 is not None:
                stats["V12_SLOT_OCCUPIED"] += 1
                stats["DYNAMIC_SCORE_POST_ALLOCATION_BLOCKED"] += 1
                continue
            if strategy == "PENGU_DUAL_LS_V2" and active_pengu is not None:
                stats["PENGU_SLOT_OCCUPIED"] += 1
                stats["DYNAMIC_SCORE_POST_ALLOCATION_BLOCKED"] += 1
                continue
            if sleeve == "STOCK" and (
                any(str(position["strategy"]) == strategy for position in active_stock.values())
                or any(str(position["symbol"]) == str(candidate["symbol"]) for position in active_stock.values())
            ):
                if any(str(position["strategy"]) == strategy for position in active_stock.values()):
                    stats[f"{strategy}_SLOT_OCCUPIED"] += 1
                else:
                    stats["SAME_STOCK_SYMBOL_BLOCKED"] += 1
                stats["DYNAMIC_SCORE_POST_ALLOCATION_BLOCKED"] += 1
                continue
            position = {
                "strategy": strategy,
                "symbol": candidate["symbol"],
                "allocatedGross": amount,
                "requestedGross": finite(candidate.get("requestedGross")),
                "entryNotional": equity * amount,
                "netUnitReturn": finite(trade.get("netUnitReturn")),
                "exitReason": trade.get("exitReason"),
            }
            if strategy == "V12":
                active_v12 = position
                exit_kind = "V12_EXIT"
                stats["V12_ENTERED"] += 1
            elif strategy == "PENGU_DUAL_LS_V2":
                active_pengu = position
                exit_kind = "PENGU_EXIT"
                stats["PENGU_ENTERED"] += 1
            else:
                position_id = f"{strategy}:{candidate['symbol']}:{int(trade['entryTs'])}:{int(trade['exitTs'])}"
                active_stock[position_id] = position
                exit_kind = "STOCK_EXIT"
                stats[f"{strategy}_ENTERED"] += 1
            if amount < finite(candidate.get("requestedGross")) - 1e-12:
                stats[f"{strategy}_GROSS_SCALED"] += 1
            sleeve_totals[sleeve]["accepted"] += 1
            sleeve_totals[sleeve]["allocatedGross"] += amount
            sleeve_totals[sleeve]["btPriorBonus"] += finite(allocated.get("btPriorBonus"))
            allocation_snapshots.append({
                "id": candidate_id,
                "strategy": strategy,
                "symbol": candidate["symbol"],
                "marketFitScore": finite(candidate.get("marketFitScore")),
                "scoreSource": candidate.get("scoreSource"),
                "btPriorBonus": finite(allocated.get("btPriorBonus")),
                "finalScore": finite(allocated.get("finalScore")),
                "minGross": finite(allocated.get("minGross")),
                "targetGross": finite(allocated.get("targetGross")),
                "maxGross": finite(allocated.get("maxGross")),
                "allocatedGross": amount,
            })
            exit_row = {"kind": exit_kind, "ts": int(trade["exitTs"]), "priority": 0, "sequence": sequence}
            sequence += 1
            if exit_kind == "STOCK_EXIT":
                exit_row["positionId"] = position_id
            timeline.append(exit_row)
            sort_future(index)
            observe()

    metrics = event_metrics(events, equity_path, equity)
    per_sleeve = {
        "V12": {**sleeve_totals["V12"]},
        "PENGU": {**sleeve_totals["PENGU"]},
        "STOCK": {**sleeve_totals["STOCK"]},
    }
    return rounded({
        **metrics,
        "observedMaximumV12Gross": max_v12,
        "observedMaximumPenguGross": max_pengu,
        "observedMaximumCryptoGross": max_crypto,
        "observedMaximumStockGross": max_stock,
        "observedMaximumTotalGross": max_total,
        "perSleeveAllocation": per_sleeve,
        "dynamicScoreDiagnostics": {
            "candidates": candidate_snapshots,
            "allocations": allocation_snapshots,
            "rejected": rejection_snapshots,
            "perSleeve": {
                "V12": per_sleeve["V12"],
                "PENGU": per_sleeve["PENGU"],
                "CRYPTO": {
                    "allocatedGross": per_sleeve["V12"]["allocatedGross"] + per_sleeve["PENGU"]["allocatedGross"],
                    "candidates": per_sleeve["V12"]["candidates"] + per_sleeve["PENGU"]["candidates"],
                    "accepted": per_sleeve["V12"]["accepted"] + per_sleeve["PENGU"]["accepted"],
                    "capacityBlocks": per_sleeve["V12"]["capacityBlocks"] + per_sleeve["PENGU"]["capacityBlocks"],
                },
                "STOCK": per_sleeve["STOCK"],
            },
            "residual": {
                "cryptoGross": max(0.0, CRYPTO_GROSS_CAP - per_sleeve["V12"]["allocatedGross"] - per_sleeve["PENGU"]["allocatedGross"]),
                "stockGross": max(0.0, STOCK_GROSS_CAP - per_sleeve["STOCK"]["allocatedGross"]),
                "totalGross": max(0.0, TOTAL_GROSS_CAP - per_sleeve["V12"]["allocatedGross"] - per_sleeve["PENGU"]["allocatedGross"] - per_sleeve["STOCK"]["allocatedGross"]),
            },
            "marketFit": {"field": "marketFitScore", "neutralFallback": NEUTRAL_MARKET_FIT_SOURCE},
            "btPrior": {"version": BT_PRIOR_TABLE_VERSION, "trainingPeriod": BT_PRIOR_TRAINING_PERIOD},
        },
        "routingDiagnostics": dict(stats),
    })


def configure_stock_period() -> None:
    legacy.PERIOD_START = START
    legacy.PERIOD_END = END
    legacy.START_MS = START_MS
    legacy.END_MS = END_MS
    legacy.base.PERIOD_START = START
    legacy.base.PERIOD_END = END
    legacy.base.START_MS = START_MS
    legacy.base.END_MS = END_MS


def build_stock(cache_root: Path):
    configure_stock_period()
    v11_rows, v50_rows, target_days, diagnostics = legacy.build_stock(cache_root)
    v11 = [row for row in v11_rows if START_MS <= int(row["entryTs"]) < END_MS]
    v50 = [row for row in v50_rows if START_MS <= int(row["entryTs"]) < END_MS]
    return v11, v50, target_days, diagnostics


def load_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"Expected JSON object: {path}")
    return payload


def month_keys(start: dt.datetime, end: dt.datetime) -> List[str]:
    current = dt.datetime(start.year, start.month, 1, tzinfo=UTC)
    keys: List[str] = []
    while current < end:
        keys.append(current.strftime("%Y-%m"))
        current = dt.datetime(current.year + (current.month == 12), 1 if current.month == 12 else current.month + 1, 1, tzinfo=UTC)
    return keys


def pf_without_best(values: Sequence[float]) -> float | None:
    if not values:
        return None
    remaining = list(values)
    remaining.pop(remaining.index(max(remaining)))
    gains = sum(value for value in remaining if value > 0)
    losses = -sum(value for value in remaining if value < 0)
    return gains / losses if losses > 0 else (999.0 if gains > 0 else None)


def event_metrics(events: Sequence[dict], equity_path: Sequence[dict], ending_equity: float) -> dict:
    returns = [finite(event.get("eventReturn")) for event in events]
    gains = sum(value for value in returns if value > 0)
    losses = -sum(value for value in returns if value < 0)
    peak = 1.0
    max_dd = 0.0
    for row in equity_path:
        equity = finite(row.get("equity"), 1.0)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    by_month: Dict[str, List[float]] = defaultdict(list)
    for event in events:
        key = dt.datetime.fromtimestamp(int(event["ts"]) / 1000, tz=UTC).strftime("%Y-%m")
        by_month[key].append(finite(event.get("eventReturn")))
    monthly: Dict[str, float] = {}
    for key in month_keys(START, END):
        equity = 1.0
        for value in by_month.get(key, []):
            equity *= max(0.001, 1.0 + value)
        monthly[key] = (equity - 1.0) * 100.0
    worst_month_key = min(monthly, key=monthly.get) if monthly else None
    years = (END_MS - START_MS) / (365.25 * 86_400_000)
    by_sleeve: Dict[str, dict] = {}
    for sleeve in ("V12", "PENGU_DUAL_LS_V2", "V11_EQ", "V50_POST_OPEN_BASIS"):
        rows = [event for event in events if event["strategy"] == sleeve]
        by_sleeve[sleeve] = {
            "events": len(rows),
            "contributionPctOfInitialEquity": sum(finite(row.get("pnl")) for row in rows) * 100.0,
            "wins": sum(finite(row.get("pnl")) > 0 for row in rows),
        }
    return {
        "events": len(events),
        "endingEquity": ending_equity,
        "compoundedReturnPct": (ending_equity - 1.0) * 100.0,
        "cagrPct": (ending_equity ** (1.0 / years) - 1.0) * 100.0 if ending_equity > 0 else -100.0,
        "profitFactor": gains / losses if losses > 0 else (999.0 if gains > 0 else None),
        "profitFactorWithoutBest": pf_without_best(returns),
        "maxDrawdownPctClosedEvent": max_dd * 100.0,
        "winRatePct": sum(value > 0 for value in returns) / len(returns) * 100.0 if returns else None,
        "positiveMonthRatePct": sum(value > 0 for value in monthly.values()) / len(monthly) * 100.0 if monthly else None,
        "worstMonth": {"month": worst_month_key, "returnPct": monthly.get(worst_month_key) if worst_month_key else None},
        "monthlyReturnPct": monthly,
        "bySleeve": by_sleeve,
    }


def simulate(
    v12_trades: Sequence[dict],
    pengu_trades: Sequence[dict],
    v11_rows: Sequence[dict],
    v50_rows: Sequence[dict],
    v12_multiplier: float,
    stock_cost_bps: float,
    priority_order: str,
    prior_table: dict | None = None,
) -> dict:
    if priority_order == "DYNAMIC_SCORE":
        return simulate_dynamic_score(
            v12_trades=v12_trades,
            pengu_trades=pengu_trades,
            v11_rows=v11_rows,
            v50_rows=v50_rows,
            v12_multiplier=v12_multiplier,
            stock_cost_bps=stock_cost_bps,
            prior_table=prior_table,
        )
    if priority_order not in PRIORITY_ORDERS:
        raise RuntimeError(f"Unknown priority order: {priority_order}")
    entry_priority = {
        "CRYPTO_FIRST": {"PENGU_ENTRY": 1, "V12_ENTRY": 2, "STOCK_ENTRY": 3},
        "STOCK_FIRST": {"STOCK_ENTRY": 1, "PENGU_ENTRY": 2, "V12_ENTRY": 3},
    }[priority_order]
    timeline: List[dict] = []
    if v12_multiplier > 0:
        for trade in v12_trades:
            if START_MS <= int(trade["entryTs"]) < END_MS:
                timeline.append({"kind": "V12_ENTRY", "ts": int(trade["entryTs"]), "trade": trade, "priority": entry_priority["V12_ENTRY"]})
    for trade in pengu_trades:
        if START_MS <= int(trade["entryTs"]) < END_MS:
            timeline.append({"kind": "PENGU_ENTRY", "ts": int(trade["entryTs"]), "trade": trade, "priority": entry_priority["PENGU_ENTRY"]})
    for trade in list(v11_rows) + list(v50_rows):
        if START_MS <= int(trade["entryTs"]) < END_MS:
            timeline.append({"kind": "STOCK_ENTRY", "ts": int(trade["entryTs"]), "trade": trade, "priority": entry_priority["STOCK_ENTRY"]})
    timeline.sort(key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"]), str(row.get("trade", {}).get("strategy", ""))))

    active_v12: dict | None = None
    active_pengu: dict | None = None
    active_stock: Dict[str, dict] = {}
    events: List[dict] = []
    equity_path: List[dict] = [{"ts": START_MS, "equity": 1.0}]
    stats: Counter[str] = Counter()
    equity = 1.0
    current_day: str | None = None
    day_start_equity = 1.0
    stock_day_pnl = crypto_day_pnl = 0.0
    stock_latched = crypto_latched = False
    max_v12 = max_pengu = max_stock = max_crypto = max_total = 0.0

    def v12_gross() -> float:
        return finite(active_v12.get("allocatedGross")) if active_v12 else 0.0

    def pengu_gross() -> float:
        return finite(active_pengu.get("allocatedGross")) if active_pengu else 0.0

    def stock_gross() -> float:
        return sum(finite(position.get("allocatedGross")) for position in active_stock.values())

    def observe() -> None:
        nonlocal max_v12, max_pengu, max_stock, max_crypto, max_total
        vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
        max_v12 = max(max_v12, vg)
        max_pengu = max(max_pengu, pg)
        max_stock = max(max_stock, sg)
        max_crypto = max(max_crypto, vg + pg)
        max_total = max(max_total, vg + pg + sg)

    def reset_day(ts: int) -> None:
        nonlocal current_day, day_start_equity, stock_day_pnl, crypto_day_pnl, stock_latched, crypto_latched
        day = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).date().isoformat()
        if day != current_day:
            current_day = day
            day_start_equity = equity
            stock_day_pnl = 0.0
            crypto_day_pnl = 0.0
            stock_latched = False
            crypto_latched = False

    def realize(ts: int, position: dict, strategy: str) -> None:
        nonlocal equity, stock_day_pnl, crypto_day_pnl, stock_latched, crypto_latched
        pnl = finite(position["entryNotional"]) * finite(position["netUnitReturn"])
        before = max(0.001, equity)
        equity = max(0.001, equity + pnl)
        event_return = pnl / before
        events.append({
            "ts": ts,
            "strategy": strategy,
            "symbol": position.get("symbol"),
            "pnl": pnl,
            "eventReturn": event_return,
            "allocatedGross": finite(position.get("allocatedGross")),
            "requestedGross": finite(position.get("requestedGross")),
            "exitReason": position.get("exitReason"),
        })
        equity_path.append({"ts": ts, "equity": equity})
        if strategy in ("V12", "PENGU_DUAL_LS_V2"):
            crypto_day_pnl += pnl
            if not crypto_latched and crypto_day_pnl / max(0.001, day_start_equity) <= CRYPTO_DAILY_LOSS_LIMIT:
                crypto_latched = True
                stats["CRYPTO_DAILY_LOSS_LATCHES"] += 1
        else:
            stock_day_pnl += pnl
            if not stock_latched and stock_day_pnl / max(0.001, day_start_equity) <= STOCK_DAILY_LOSS_LIMIT:
                stock_latched = True
                stats["STOCK_DAILY_LOSS_LATCHES"] += 1

    index = 0
    while index < len(timeline):
        item = timeline[index]
        ts = int(item["ts"])
        reset_day(ts)
        kind = str(item["kind"])

        if kind == "V12_ENTRY":
            trade = item["trade"]
            if crypto_latched:
                stats["V12_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                index += 1
                continue
            if active_v12 is not None:
                stats["V12_SLOT_OCCUPIED"] += 1
                index += 1
                continue
            requested = max(0.0, finite(trade.get("requestedGross")) * v12_multiplier)
            available = min(
                max(0.0, CRYPTO_GROSS_CAP - pengu_gross()),
                max(0.0, TOTAL_GROSS_CAP - pengu_gross() - stock_gross()),
            )
            allocated = min(requested, available)
            if allocated <= 1e-12:
                stats["V12_CAPACITY_BLOCKED"] += 1
                index += 1
                continue
            active_v12 = {
                "symbol": trade.get("symbol"),
                "allocatedGross": allocated,
                "requestedGross": requested,
                "entryNotional": equity * allocated,
                "netUnitReturn": finite(trade.get("netUnitReturn")),
                "exitReason": trade.get("exitReason"),
            }
            if allocated < requested - 1e-12:
                stats["V12_GROSS_SCALED"] += 1
            timeline.append({"kind": "V12_EXIT", "ts": int(trade["exitTs"]), "priority": 0})
            timeline[index + 1:] = sorted(timeline[index + 1:], key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"])))
            stats["V12_ENTERED"] += 1
            observe()
            index += 1
            continue

        if kind == "V12_EXIT":
            if active_v12 is None:
                stats["V12_EXIT_WITHOUT_ACTIVE"] += 1
            else:
                position = active_v12
                active_v12 = None
                realize(ts, position, "V12")
                stats["V12_EXITED"] += 1
                observe()
            index += 1
            continue

        if kind == "PENGU_ENTRY":
            trade = item["trade"]
            if crypto_latched:
                stats["PENGU_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                index += 1
                continue
            if active_pengu is not None:
                stats["PENGU_SLOT_OCCUPIED"] += 1
                index += 1
                continue
            requested = min(PENGU_MAX_GROSS, max(0.0, finite(trade.get("requestedGross"))))
            other_gross = v12_gross() + stock_gross()
            available = min(
                max(0.0, CRYPTO_GROSS_CAP - v12_gross()),
                max(0.0, TOTAL_GROSS_CAP - other_gross),
                max(0.0, PENGU_PORTFOLIO_GROSS_CAP - other_gross),
            )
            allocated = min(requested, available)
            if allocated <= 1e-12:
                stats["PENGU_PORTFOLIO_CAP_BLOCKED"] += 1
                index += 1
                continue
            active_pengu = {
                "symbol": "PENGUUSDT",
                "allocatedGross": allocated,
                "requestedGross": requested,
                "entryNotional": equity * allocated,
                "netUnitReturn": finite(trade.get("netUnitReturn")),
                "exitReason": trade.get("exitReason"),
            }
            if allocated < requested - 1e-12:
                stats["PENGU_GROSS_SCALED"] += 1
            timeline.append({"kind": "PENGU_EXIT", "ts": int(trade["exitTs"]), "priority": 0})
            timeline[index + 1:] = sorted(timeline[index + 1:], key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"])))
            stats["PENGU_ENTERED"] += 1
            observe()
            index += 1
            continue

        if kind == "PENGU_EXIT":
            if active_pengu is None:
                stats["PENGU_EXIT_WITHOUT_ACTIVE"] += 1
            else:
                position = active_pengu
                active_pengu = None
                realize(ts, position, "PENGU_DUAL_LS_V2")
                stats["PENGU_EXITED"] += 1
                observe()
            index += 1
            continue

        if kind == "STOCK_ENTRY":
            trade = item["trade"]
            strategy = str(trade["strategy"])
            if stock_latched:
                stats["STOCK_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                index += 1
                continue
            if any(str(position["strategy"]) == strategy for position in active_stock.values()):
                stats[f"{strategy}_SLOT_OCCUPIED"] += 1
                index += 1
                continue
            if any(str(position["symbol"]) == str(trade["symbol"]) for position in active_stock.values()):
                stats["SAME_STOCK_SYMBOL_BLOCKED"] += 1
                index += 1
                continue
            unit_return = stock.unit_trade_value(trade, stock_cost_bps)
            if unit_return is None:
                stats[f"{strategy}_COST_EDGE_REJECTED"] += 1
                index += 1
                continue
            slot_cap = V11_GROSS_CAP if strategy == "V11_EQ" else V50_GROSS_CAP
            available = min(
                slot_cap,
                max(0.0, STOCK_GROSS_CAP - stock_gross()),
                max(0.0, TOTAL_GROSS_CAP - v12_gross() - pengu_gross() - stock_gross()),
            )
            minimum = FIRST_STOCK_MIN_GROSS if not active_stock else SECOND_STOCK_MIN_GROSS
            if available + 1e-12 < minimum:
                stats["STOCK_CAPACITY_BLOCKED"] += 1
                index += 1
                continue
            allocated = available
            pid = f"{strategy}:{trade['symbol']}:{int(trade['entryTs'])}:{int(trade['exitTs'])}"
            active_stock[pid] = {
                "strategy": strategy,
                "symbol": str(trade["symbol"]),
                "allocatedGross": allocated,
                "requestedGross": slot_cap,
                "entryNotional": equity * allocated,
                "netUnitReturn": finite(unit_return),
                "exitReason": trade.get("exitReason"),
            }
            if allocated < slot_cap - 1e-12:
                stats[f"{strategy}_GROSS_SCALED"] += 1
            timeline.append({"kind": "STOCK_EXIT", "ts": int(trade["exitTs"]), "priority": 0, "positionId": pid})
            timeline[index + 1:] = sorted(timeline[index + 1:], key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"])))
            stats[f"{strategy}_ENTERED"] += 1
            observe()
            index += 1
            continue

        if kind == "STOCK_EXIT":
            position = active_stock.pop(str(item["positionId"]), None)
            if position is None:
                stats["STOCK_EXIT_WITHOUT_ACTIVE"] += 1
            else:
                realize(ts, position, str(position["strategy"]))
                stats[f"{position['strategy']}_EXITED"] += 1
                observe()
            index += 1
            continue

        raise RuntimeError(f"Unknown event kind: {kind}")

    metrics = event_metrics(events, equity_path, equity)
    per_sleeve_allocated = {
        "V12": sum(finite(event.get("allocatedGross")) for event in events if event.get("strategy") == "V12"),
        "PENGU": sum(finite(event.get("allocatedGross")) for event in events if event.get("strategy") == "PENGU_DUAL_LS_V2"),
        "STOCK": sum(finite(event.get("allocatedGross")) for event in events if event.get("strategy") in ("V11_EQ", "V50_POST_OPEN_BASIS")),
    }
    return rounded({
        **metrics,
        "observedMaximumV12Gross": max_v12,
        "observedMaximumPenguGross": max_pengu,
        "observedMaximumCryptoGross": max_crypto,
        "observedMaximumStockGross": max_stock,
        "observedMaximumTotalGross": max_total,
        "perSleeveAllocation": {key: {"allocatedGross": value} for key, value in per_sleeve_allocated.items()},
        "routingDiagnostics": dict(stats),
    })


def variant_rows(results: dict) -> List[dict]:
    rows: List[dict] = []
    baseline_normal = results["NORMAL"]["BASELINE_PENGU_STOCK"]["CRYPTO_FIRST"]
    baseline_severe = results["SEVERE"]["BASELINE_PENGU_STOCK"]["CRYPTO_FIRST"]
    for variant_id in results["NORMAL"]:
        config = results["NORMAL"][variant_id]["config"]
        normal = results["NORMAL"][variant_id]
        severe = results["SEVERE"][variant_id]
        normal_returns = [normal[order]["compoundedReturnPct"] for order in PRIORITY_ORDERS]
        severe_returns = [severe[order]["compoundedReturnPct"] for order in PRIORITY_ORDERS]
        severe_pfs = [finite(severe[order]["profitFactor"]) for order in PRIORITY_ORDERS]
        severe_pfwb = [finite(severe[order]["profitFactorWithoutBest"]) for order in PRIORITY_ORDERS]
        severe_dd = [finite(severe[order]["maxDrawdownPctClosedEvent"]) for order in PRIORITY_ORDERS]
        dynamic_normal = normal["DYNAMIC_SCORE"]
        dynamic_severe = severe["DYNAMIC_SCORE"]
        max_total = max(normal[order]["observedMaximumTotalGross"] for order in ROUTING_VARIANTS)
        row = {
            "variantId": variant_id,
            **config,
            "normalReturnPct": normal["CRYPTO_FIRST"]["compoundedReturnPct"],
            "normalPf": normal["CRYPTO_FIRST"]["profitFactor"],
            "normalPfWithoutBest": normal["CRYPTO_FIRST"]["profitFactorWithoutBest"],
            "normalDdPct": normal["CRYPTO_FIRST"]["maxDrawdownPctClosedEvent"],
            "severeReturnPct": severe["CRYPTO_FIRST"]["compoundedReturnPct"],
            "severePf": severe["CRYPTO_FIRST"]["profitFactor"],
            "severePfWithoutBest": severe["CRYPTO_FIRST"]["profitFactorWithoutBest"],
            "severeDdPct": severe["CRYPTO_FIRST"]["maxDrawdownPctClosedEvent"],
            "dynamicNormalReturnPct": dynamic_normal["compoundedReturnPct"],
            "dynamicNormalPf": dynamic_normal["profitFactor"],
            "dynamicSevereReturnPct": dynamic_severe["compoundedReturnPct"],
            "dynamicSeverePf": dynamic_severe["profitFactor"],
            "dynamicSevereDdPct": dynamic_severe["maxDrawdownPctClosedEvent"],
            "worstPriorityNormalReturnPct": min(normal_returns),
            "worstPrioritySevereReturnPct": min(severe_returns),
            "worstPrioritySeverePf": min(severe_pfs),
            "worstPrioritySeverePfWithoutBest": min(severe_pfwb),
            "worstPrioritySevereDdPct": min(severe_dd),
            "normalPriorityDeltaPctPoint": abs(normal_returns[0] - normal_returns[1]),
            "normalGainVsBaselinePctPoint": normal["CRYPTO_FIRST"]["compoundedReturnPct"] - baseline_normal["compoundedReturnPct"],
            "severeGainVsBaselinePctPoint": severe["CRYPTO_FIRST"]["compoundedReturnPct"] - baseline_severe["compoundedReturnPct"],
            "maxObservedTotalGross": max_total,
        }
        row["gatePass"] = bool(
            config["v12Multiplier"] > 0
            and row["normalGainVsBaselinePctPoint"] > 0
            and row["severeGainVsBaselinePctPoint"] > 0
            and row["worstPrioritySeverePf"] >= 1.20
            and row["worstPrioritySeverePfWithoutBest"] >= 1.0
            and row["worstPrioritySevereDdPct"] >= -25.0
            and all(normal[order]["observedMaximumTotalGross"] <= TOTAL_GROSS_CAP + 1e-9 for order in ROUTING_VARIANTS)
            and all(severe[order]["observedMaximumTotalGross"] <= TOTAL_GROSS_CAP + 1e-9 for order in ROUTING_VARIANTS)
        )
        row["robustScore"] = row["worstPrioritySevereReturnPct"] + 0.35 * row["worstPrioritySevereDdPct"] - 0.25 * row["normalPriorityDeltaPctPoint"]
        rows.append(rounded(row))
    return sorted(rows, key=lambda row: (bool(row["gatePass"]), finite(row["robustScore"])), reverse=True)


def write_report(output: Path, result: dict) -> None:
    rows = result["variantSummary"]
    top = [row for row in rows if row["variantId"] != "BASELINE_PENGU_STOCK"][:10]
    recommended = result.get("provisionalRecommendation")
    lines = [
        "# V12 + PENGU V2 + V52 Stocks — latest one-year unified backtest",
        "",
        f"- Period: `{result['period']['startInclusive']}` to `{result['period']['endExclusive']}`",
        f"- Status: `{result['status']}`",
        f"- Provisional candidate: `{recommended['variantId'] if recommended else 'NONE'}`",
        "- V12 time controls gate new entries only; exits and venue-resident stops remain active 24/7.",
        "",
        "| Rank | Variant | V12 × | Entry policy | Normal return | Severe return | Dynamic normal | Dynamic severe | Dynamic PF | Dynamic DD | Gate |",
        "|---:|---|---:|---|---:|---:|---:|---:|---:|---:|:---:|",
    ]
    for rank, row in enumerate(top, 1):
        lines.append(
            f"| {rank} | {row['variantId']} | {row['v12Multiplier']:.2f} | {row['entryPolicy']} | "
            f"{row['normalReturnPct']:.2f}% | {row['severeReturnPct']:.2f}% | {row['dynamicNormalReturnPct']:.2f}% | "
            f"{row['dynamicSevereReturnPct']:.2f}% | {finite(row['dynamicSeverePf']):.3f} | "
            f"{row['dynamicSevereDdPct']:.2f}% | {'PASS' if row['gatePass'] else 'FAIL'} |"
        )
    lines += [
        "",
        "## Interpretation",
        "",
        "The ranking is a one-year portfolio-routing comparison, not an independent untouched holdout. The selected row is therefore a shadow/paper candidate only; it is not marked LIVE eligible.",
        "",
        "## Key limitations",
        "",
    ]
    lines.extend(f"- {item}" for item in result["limitations"])
    output.joinpath("report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def load_bt_prior_table(path: Path | None = None) -> dict:
    if path is None:
        return {"version": BT_PRIOR_TABLE_VERSION, "trainingPeriod": BT_PRIOR_TRAINING_PERIOD, "sourceShas": {}, "strategies": {}}
    payload = load_json(path)
    if not str(payload.get("version", "")).strip() or not isinstance(payload.get("strategies"), dict):
        raise RuntimeError("BT prior table requires version and strategies")
    return payload


def analyze(stock_cache: Path, v12_path: Path, pengu_path: Path, output: Path, bt_prior_table: dict | None = None) -> dict:
    v12 = load_json(v12_path)
    pengu = load_json(pengu_path)
    if v12.get("schema") != "v12-combined-bt-ledger/v1":
        raise RuntimeError("Unexpected V12 ledger schema")
    if pengu.get("strategyId") != "PENGU_DUAL_LS_V2_FINAL":
        raise RuntimeError("Unexpected PENGU strategy")
    if v12["period"]["startInclusive"] != START.isoformat().replace("+00:00", ".000Z") or v12["period"]["endExclusive"] != END.isoformat().replace("+00:00", ".000Z"):
        raise RuntimeError("V12 ledger period mismatch")
    if pengu["period"] != v12["period"]:
        raise RuntimeError("PENGU/V12 period mismatch")
    prior_table = bt_prior_table or load_bt_prior_table()
    v11_rows, v50_rows, target_days, stock_diagnostics = build_stock(stock_cache)
    variants = [{"variantId": "BASELINE_PENGU_STOCK", "v12Multiplier": 0.0, "entryPolicy": "NONE"}]
    variants.extend(
        {"variantId": f"V12_X{multiplier:.2f}_{policy}", "v12Multiplier": multiplier, "entryPolicy": policy}
        for policy in V12_ENTRY_POLICIES for multiplier in V12_MULTIPLIERS
    )
    results: Dict[str, dict] = {}
    for scenario, assumptions in SCENARIOS.items():
        mode = str(assumptions["ledgerMode"])
        results[scenario] = {}
        pengu_trades = pengu["modes"][mode]["trades"]
        for variant in variants:
            policy = str(variant["entryPolicy"])
            v12_trades = [] if policy == "NONE" else v12["modes"][policy][mode]["trades"]
            row: Dict[str, Any] = {"config": variant}
            for order in ROUTING_VARIANTS:
                row[order] = simulate(
                    v12_trades=v12_trades,
                    pengu_trades=pengu_trades,
                    v11_rows=v11_rows,
                    v50_rows=v50_rows,
                    v12_multiplier=finite(variant["v12Multiplier"]),
                    stock_cost_bps=finite(assumptions["stockCostBps"]),
                    priority_order=order,
                    prior_table=prior_table,
                )
            results[scenario][str(variant["variantId"])] = row
    summary = variant_rows(results)
    eligible = [row for row in summary if row["gatePass"]]
    recommendation = eligible[0] if eligible else None
    checks = {
        "v12LineageNormal223Trades": int(v12["lineage"]["normal"]["tradeCount"]) == 223,
        "v12LineageNormalReturnParity": abs(finite(v12["lineage"]["normal"]["returnPct"]) - 110.517) <= 0.20,
        "v12LineageStressParity": abs(finite(v12["lineage"]["stress"]["returnPct"]) - 58.230) <= 0.30,
        "penguAsterProductionReplayPlausible": 25 <= int(pengu["modes"]["normal"]["metrics"]["trades"]) <= 40,
        "penguNoOverlap": bool(pengu["integrity"]["noOverlap"]),
        "variantCount21": len(variants) == 21,
        "allNormalGrossWithinCap": all(
            results["NORMAL"][variant["variantId"]][order]["observedMaximumTotalGross"] <= TOTAL_GROSS_CAP + 1e-9
            for variant in variants for order in ROUTING_VARIANTS
        ),
        "allSevereGrossWithinCap": all(
            results["SEVERE"][variant["variantId"]][order]["observedMaximumTotalGross"] <= TOTAL_GROSS_CAP + 1e-9
            for variant in variants for order in ROUTING_VARIANTS
        ),
        "dynamicScoreRoutingPresent": all(
            "DYNAMIC_SCORE" in results[scenario][variant["variantId"]]
            for scenario in SCENARIOS for variant in variants
        ),
    }
    result = rounded({
        "schema": "v12-v52-pengu-v2-combined-bt/v1",
        "strategyId": "V12_PLUS_PENGU_DUAL_LS_V2_PLUS_V52_STOCKS",
        "status": "PASS_RESEARCH_ONLY" if all(checks.values()) else "DIAGNOSTIC_RESEARCH_ONLY",
        "generatedAt": dt.datetime.now(tz=UTC).isoformat(),
        "period": {"startInclusive": START.isoformat(), "endExclusive": END.isoformat(), "calendarDays": (END - START).days},
        "sourceLineage": {
            "deployedVpsSha": "6f4d06fd990e5e847895b59c4890bb80335ff03e",
            "v12Sha": "27f023a37d08b71c6e59b797fdc03c20d6032da2",
            "stockResearchSha": "04c1a369223bd27e9e42bc93604b3777b9230d92",
            "v11DependencySha": "0fad24c105a7f0f61af6042ba04a8b1386ffec7c",
            "v13DependencySha": "dbfd7e026a81343a23ab97d202761f7f9bbe5755",
            "btPriorTableSourceShas": prior_table.get("sourceShas", {}),
        },
        "architecture": {
            "v96Included": False,
            "v12Multipliers": list(V12_MULTIPLIERS),
            "v12EntryPolicies": list(V12_ENTRY_POLICIES),
            "entryPolicyAffectsNewEntriesOnly": True,
            "residentStopsAndExitsAlwaysActive": True,
            "penguVersion": "PENGU_DUAL_LS_V2_FINAL",
            "v52Stocks": ["V11_EQ", "V50_POST_OPEN_BASIS"],
            "totalGrossCap": TOTAL_GROSS_CAP,
            "cryptoGrossCap": CRYPTO_GROSS_CAP,
            "stockGrossCap": STOCK_GROSS_CAP,
            "penguMaxGross": PENGU_MAX_GROSS,
            "penguPortfolioGrossCapIncludesOtherAsterPositions": PENGU_PORTFOLIO_GROSS_CAP,
            "stockDailyLossPct": abs(STOCK_DAILY_LOSS_LIMIT) * 100,
            "cryptoDailyLossPctConservativeModel": abs(CRYPTO_DAILY_LOSS_LIMIT) * 100,
            "prioritySensitivity": list(PRIORITY_ORDERS),
            "routingVariants": list(ROUTING_VARIANTS),
            "dynamicScorePrimary": "marketFitScore",
            "dynamicScoreBtBonusCap": DEFAULT_MAX_BT_BONUS,
            "dynamicScoreConfidenceTradeFloor": MIN_CONFIDENT_TRADES,
            "dynamicScoreObservationHorizonDays": FULL_OBSERVATION_DAYS,
        },
        "dynamicAllocation": {
            "mode": "RESEARCH_ONLY",
            "routingVariant": "DYNAMIC_SCORE",
            "marketFit": {"field": "marketFitScore", "fallback": NEUTRAL_MARKET_FIT_SOURCE, "futurePnlUsed": False},
            "btPrior": {
                "version": prior_table.get("version", BT_PRIOR_TABLE_VERSION),
                "trainingPeriod": prior_table.get("trainingPeriod"),
                "sourceShas": prior_table.get("sourceShas", {}),
            },
            "compatibilityVariants": list(PRIORITY_ORDERS),
        },
        "costScenarios": {
            "NORMAL": {"v12": "5 bps fee/side, zero slippage", "pengu": "6 bps fee/side plus actual Aster funding", "stockRoundTripBps": SCENARIOS["NORMAL"]["stockCostBps"]},
            "SEVERE": {"v12": "10 bps fee + 5 bps slippage/side, 5% deterministic claimed-owner entry loss seed d, one 2h resident-stop update lag", "pengu": "normal plus 35 bps adverse/side, actual Aster funding", "stockRoundTripBps": SCENARIOS["SEVERE"]["stockCostBps"]},
        },
        "data": {
            "v12": {"source": v12["source"], "lineageNormal": {key: value for key, value in v12["lineage"]["normal"].items() if key != "trades"}, "lineageStress": {key: value for key, value in v12["lineage"]["stress"].items() if key != "trades"}},
            "pengu": {"source": pengu["source"], "data": pengu["data"], "researchCheckpoint": pengu["researchCheckpoint"], "normalMetrics": pengu["modes"]["normal"]["metrics"], "stressMetrics": pengu["modes"]["stress"]["metrics"]},
            "stocks": {"targetSessions": len(target_days), "v11RawTrades": len(v11_rows), "v50RawTrades": len(v50_rows), "diagnostics": stock_diagnostics},
        },
        "variantSummary": summary,
        "provisionalRecommendation": recommendation,
        "selectionRule": {
            "status": "PROVISIONAL_ONE_YEAR_ONLY",
            "gate": "positive normal and severe gain vs no-V12 baseline; worst-priority severe PF >=1.20; PF without best >=1.0; closed-event DD <=25%; gross cap respected",
            "ranking": "worst-priority severe return + 0.35*severe DD - 0.25*normal priority-order delta",
        },
        "results": results,
        "checks": checks,
        "limitations": [
            "The latest year overlaps strategy research and is not an untouched independent holdout; the recommendation is for shadow/paper validation only.",
            "Combined drawdown is measured on completed events because synchronized mark-to-market paths for all three sleeves are unavailable; intratrade drawdown can be worse.",
            "V52 stock execution is an observable historical proxy and cannot reconstruct queue position, partial fills, spread, or sub-second slippage.",
            "US_RTH_OFF uses New York weekday/time boundaries; US exchange holidays are not separately removed from the V12 time gate.",
            "The crypto 5% daily latch is modeled conservatively. The deployed PENGU runner only consumes a portfolio daily-loss file when that VPS environment path is configured.",
            "The shared kill switch and exogenous operational failures cannot be reconstructed from market history.",
        ],
        "dataQualityWarnings": [
            {
                "code": "PENGU_ASTER_FROZEN_RESEARCH_CHECKPOINT_DRIFT",
                "active": not bool(pengu["researchCheckpoint"]["matched"]),
                "detail": pengu["researchCheckpoint"]["interpretation"],
                "frozenReference": pengu["researchCheckpoint"]["frozenReference"],
                "currentProductionReplay": pengu["modes"]["normal"]["metrics"],
            }
        ],
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False, "liveEligible": False},
    })
    output.mkdir(parents=True, exist_ok=True)
    output.joinpath("result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with output.joinpath("variant-summary.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(summary[0].keys()))
        writer.writeheader()
        writer.writerows(summary)
    write_report(output, result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--v12-ledger", default=".research-state/v12-v52-pengu-v2-combined/v12-ledgers.json")
    parser.add_argument("--pengu-ledger", default=".research-state/v12-v52-pengu-v2-combined/pengu-v2-ledgers.json")
    parser.add_argument("--bt-prior-table", default=None)
    parser.add_argument("--output-dir", default=".research-state/v12-v52-pengu-v2-combined")
    args = parser.parse_args()
    result = analyze(
        Path(args.stock_cache_dir),
        Path(args.v12_ledger),
        Path(args.pengu_ledger),
        Path(args.output_dir),
        load_bt_prior_table(Path(args.bt_prior_table)) if args.bt_prior_table else None,
    )
    print(json.dumps({
        "status": result["status"],
        "period": result["period"],
        "provisionalRecommendation": result["provisionalRecommendation"],
        "topFive": [row for row in result["variantSummary"] if row["variantId"] != "BASELINE_PENGU_STOCK"][:5],
        "checks": result["checks"],
        "safety": result["safety"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
