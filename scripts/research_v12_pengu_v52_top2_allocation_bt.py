from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Sequence

UTC = dt.timezone.utc
REPO_ROOT = Path(__file__).resolve().parent.parent
TOP2_ROOT = REPO_ROOT / ".v52-top2-research"
sys.path.insert(0, str(TOP2_ROOT / "scripts"))

import research_lab_v52_parallel_opportunity_v4 as top2  # noqa: E402
import research_v12_v52_pengu_v2_combined_bt as old  # noqa: E402

START = old.START
END = old.END
START_MS = old.START_MS
END_MS = old.END_MS
HOLDOUT_START = dt.datetime(2026, 5, 29, tzinfo=UTC)
HOLDOUT_START_MS = int(HOLDOUT_START.timestamp() * 1000)

TOTAL_GROSS_CAP = 2.5
STOCK_GROSS_CAP = 1.5
PENGU_PORTFOLIO_GROSS_CAP = 2.0
STOCK_DAILY_LOSS_LIMIT = -0.035
CRYPTO_DAILY_LOSS_LIMIT = -0.075
FIRST_STOCK_MIN_GROSS = 0.5
SECOND_STOCK_MIN_GROSS = 0.25
MAX_STOCK_POSITIONS = 2
V50_MAX_DAILY_TRADES = 3
PRIORITY_ORDERS = ("CRYPTO_FIRST", "STOCK_FIRST")
SCENARIOS = {
    "NORMAL": {"ledgerMode": "normal", "stockCostBps": float(top2.SCENARIOS["NORMAL"])},
    "SEVERE": {"ledgerMode": "stress", "stockCostBps": float(top2.SCENARIOS["SEVERE"])},
}
V12_CAPS = (0.75, 1.00, 1.25, 1.50)
PENGU_CAPS = (0.50, 0.75)
CRYPTO_CAPS = (1.00, 1.25, 1.50)
TOP_KS = (1, 2)
TOP2_SPEC = top2.ParallelSpec(65.0, 5.0, 2, 2, 1.0)
TOP1_SPEC = top2.ParallelSpec(65.0, 5.0, 1, 1, 1.0)


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


def load_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"Expected JSON object: {path}")
    return payload


def build_stock(cache_root: Path) -> tuple[list[dict], dict[int, list[dict]], dict]:
    v19 = top2.x.base.v19
    v19.BT_START = START
    v19.BT_END_EXCLUSIVE = END
    v19.WARMUP_START = START - dt.timedelta(days=40)
    v19.BT_START_DAY = START.date().isoformat()
    v19.BT_END_DAY_EXCLUSIVE = END.date().isoformat()
    v19.configure_exact_data_window()
    days, aligned, data_diag = v19.v17.load_all(cache_root / "aligned")
    warmup = [day for day in days if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    v11_rows = top2.x.build_v11_rows(top2.BASELINE_V11, warmup, aligned)
    top1_rows = top2.build_parallel_v50_rows(TOP1_SPEC, target, aligned)
    top2_rows = top2.build_parallel_v50_rows(TOP2_SPEC, target, aligned)
    return v11_rows, {1: top1_rows, 2: top2_rows}, {
        "market": data_diag,
        "targetSessions": len(target),
        "v11RawTrades": len(v11_rows),
        "v50Top1RawTrades": len(top1_rows),
        "v50Top2RawTrades": len(top2_rows),
    }


def metrics(events: Sequence[dict], equity_path: Sequence[float], ending_equity: float) -> dict:
    values = [finite(row.get("eventReturn")) for row in events]
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    peak = 1.0
    max_dd = 0.0
    for equity in equity_path:
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    by_sleeve: Dict[str, dict] = {}
    for sleeve in ("V12", "PENGU_DUAL_LS_V2", "V11_EQ", "V50_POST_OPEN_BASIS"):
        rows = [row for row in events if row["strategy"] == sleeve]
        by_sleeve[sleeve] = {
            "events": len(rows),
            "pnlPctOfInitialEquity": sum(finite(row.get("pnl")) for row in rows) * 100.0,
            "wins": sum(finite(row.get("pnl")) > 0 for row in rows),
        }
    return {
        "events": len(events),
        "endingEquity": ending_equity,
        "compoundedReturnPct": (ending_equity - 1.0) * 100.0,
        "profitFactor": gains / losses if losses > 0 else (999.0 if gains > 0 else None),
        "maxDrawdownPctClosedEvent": max_dd * 100.0,
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else None,
        "bySleeve": by_sleeve,
    }


def simulate(
    v12_trades: Sequence[dict],
    pengu_trades: Sequence[dict],
    v11_rows: Sequence[dict],
    v50_rows: Sequence[dict],
    config: dict,
    stock_cost_bps: float,
    priority_order: str,
    start_ms: int,
    end_ms: int,
) -> dict:
    entry_priority = {
        "CRYPTO_FIRST": {"PENGU_ENTRY": 1, "V12_ENTRY": 2, "STOCK_ENTRY": 3},
        "STOCK_FIRST": {"STOCK_ENTRY": 1, "PENGU_ENTRY": 2, "V12_ENTRY": 3},
    }[priority_order]
    timeline: List[dict] = []
    for trade in v12_trades:
        if start_ms <= int(trade["entryTs"]) and int(trade["exitTs"]) < end_ms:
            timeline.append({"kind": "V12_ENTRY", "ts": int(trade["entryTs"]), "trade": trade, "priority": entry_priority["V12_ENTRY"]})
    for trade in pengu_trades:
        if start_ms <= int(trade["entryTs"]) and int(trade["exitTs"]) < end_ms:
            timeline.append({"kind": "PENGU_ENTRY", "ts": int(trade["entryTs"]), "trade": trade, "priority": entry_priority["PENGU_ENTRY"]})
    for trade in list(v11_rows) + list(v50_rows):
        if start_ms <= int(trade["entryTs"]) and int(trade["exitTs"]) < end_ms:
            timeline.append({"kind": "STOCK_ENTRY", "ts": int(trade["entryTs"]), "trade": trade, "priority": entry_priority["STOCK_ENTRY"]})
    timeline.sort(key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"]), int(row.get("trade", {}).get("rank", 1))))

    active_v12: dict | None = None
    active_pengu: dict | None = None
    active_stock: Dict[str, dict] = {}
    events: List[dict] = []
    stats: Counter[str] = Counter()
    equity = 1.0
    equity_path = [1.0]
    current_day: str | None = None
    day_start_equity = 1.0
    stock_day_pnl = 0.0
    crypto_day_pnl = 0.0
    stock_latched = False
    crypto_latched = False
    v50_daily_trades = 0
    max_v12 = max_pengu = max_crypto = max_stock = max_total = 0.0
    max_v50_concurrent = 0

    def v12_gross() -> float:
        return finite(active_v12.get("allocatedGross")) if active_v12 else 0.0

    def pengu_gross() -> float:
        return finite(active_pengu.get("allocatedGross")) if active_pengu else 0.0

    def stock_gross() -> float:
        return sum(finite(row.get("allocatedGross")) for row in active_stock.values())

    def observe() -> None:
        nonlocal max_v12, max_pengu, max_crypto, max_stock, max_total, max_v50_concurrent
        vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
        max_v12 = max(max_v12, vg)
        max_pengu = max(max_pengu, pg)
        max_crypto = max(max_crypto, vg + pg)
        max_stock = max(max_stock, sg)
        max_total = max(max_total, vg + pg + sg)
        max_v50_concurrent = max(max_v50_concurrent, sum(row["strategy"] == "V50_POST_OPEN_BASIS" for row in active_stock.values()))

    def reset_day(ts: int) -> None:
        nonlocal current_day, day_start_equity, stock_day_pnl, crypto_day_pnl, stock_latched, crypto_latched, v50_daily_trades
        day = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).date().isoformat()
        if day != current_day:
            current_day = day
            day_start_equity = equity
            stock_day_pnl = 0.0
            crypto_day_pnl = 0.0
            stock_latched = False
            crypto_latched = False
            v50_daily_trades = 0

    def add_exit(kind: str, ts: int, **extra: Any) -> None:
        timeline.append({"kind": kind, "ts": ts, "priority": 0, **extra})
        timeline.sort(key=lambda row: (int(row["ts"]), int(row["priority"]), str(row["kind"])))

    def realize(ts: int, position: dict, strategy: str) -> None:
        nonlocal equity, stock_day_pnl, crypto_day_pnl, stock_latched, crypto_latched
        pnl = finite(position["entryNotional"]) * finite(position["netUnitReturn"])
        before = max(0.001, equity)
        equity = max(0.001, equity + pnl)
        events.append({
            "ts": ts,
            "strategy": strategy,
            "symbol": position.get("symbol"),
            "pnl": pnl,
            "eventReturn": pnl / before,
            "allocatedGross": finite(position.get("allocatedGross")),
            "rank": position.get("rank"),
        })
        equity_path.append(equity)
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
            if crypto_latched or active_v12 is not None:
                stats["V12_ENTRY_BLOCKED"] += 1
                index += 1
                continue
            requested = min(finite(config["v12Cap"]), max(0.0, finite(trade.get("requestedGross"))))
            available = min(max(0.0, finite(config["cryptoCap"]) - pengu_gross()), max(0.0, TOTAL_GROSS_CAP - pengu_gross() - stock_gross()))
            allocated = min(requested, available)
            if allocated <= 1e-12:
                stats["V12_CAPACITY_BLOCKED"] += 1
                index += 1
                continue
            active_v12 = {"symbol": trade.get("symbol"), "allocatedGross": allocated, "entryNotional": equity * allocated, "netUnitReturn": finite(trade.get("netUnitReturn"))}
            add_exit("V12_EXIT", int(trade["exitTs"]))
            stats["V12_ENTERED"] += 1
            observe()
            index += 1
            continue

        if kind == "V12_EXIT":
            if active_v12 is not None:
                position = active_v12
                active_v12 = None
                realize(ts, position, "V12")
                stats["V12_EXITED"] += 1
                observe()
            index += 1
            continue

        if kind == "PENGU_ENTRY":
            trade = item["trade"]
            if crypto_latched or active_pengu is not None:
                stats["PENGU_ENTRY_BLOCKED"] += 1
                index += 1
                continue
            requested = min(finite(config["penguCap"]), max(0.0, finite(trade.get("requestedGross"))))
            other = v12_gross() + stock_gross()
            available = min(
                max(0.0, finite(config["cryptoCap"]) - v12_gross()),
                max(0.0, TOTAL_GROSS_CAP - other),
                max(0.0, PENGU_PORTFOLIO_GROSS_CAP - other),
            )
            allocated = min(requested, available)
            if allocated <= 1e-12:
                stats["PENGU_CAPACITY_BLOCKED"] += 1
                index += 1
                continue
            active_pengu = {"symbol": "PENGUUSDT", "allocatedGross": allocated, "entryNotional": equity * allocated, "netUnitReturn": finite(trade.get("netUnitReturn"))}
            add_exit("PENGU_EXIT", int(trade["exitTs"]))
            stats["PENGU_ENTERED"] += 1
            observe()
            index += 1
            continue

        if kind == "PENGU_EXIT":
            if active_pengu is not None:
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
                stats["STOCK_DAILY_LOSS_BLOCKED"] += 1
                index += 1
                continue
            if len(active_stock) >= MAX_STOCK_POSITIONS:
                stats["STOCK_SLOT_CAP_BLOCKED"] += 1
                index += 1
                continue
            if any(str(row["symbol"]) == str(trade["symbol"]) for row in active_stock.values()):
                stats["SAME_STOCK_SYMBOL_BLOCKED"] += 1
                index += 1
                continue
            if strategy == "V11_EQ" and any(row["strategy"] == "V11_EQ" for row in active_stock.values()):
                stats["V11_SLOT_OCCUPIED"] += 1
                index += 1
                continue
            if strategy == "V50_POST_OPEN_BASIS":
                active_v50 = sum(row["strategy"] == "V50_POST_OPEN_BASIS" for row in active_stock.values())
                if active_v50 >= int(config["topK"]):
                    stats["V50_SLOT_CAP_BLOCKED"] += 1
                    index += 1
                    continue
                if v50_daily_trades >= V50_MAX_DAILY_TRADES:
                    stats["V50_DAILY_CAP_BLOCKED"] += 1
                    index += 1
                    continue
            unit = top2.trade_value(trade, stock_cost_bps, 5.0)
            if unit is None:
                stats[f"{strategy}_COST_EDGE_REJECTED"] += 1
                index += 1
                continue
            available = min(max(0.0, STOCK_GROSS_CAP - stock_gross()), max(0.0, TOTAL_GROSS_CAP - v12_gross() - pengu_gross() - stock_gross()), 1.0)
            minimum = FIRST_STOCK_MIN_GROSS if not active_stock else SECOND_STOCK_MIN_GROSS
            if available + 1e-12 < minimum:
                stats["STOCK_CAPACITY_BLOCKED"] += 1
                index += 1
                continue
            allocated = available
            pid = f"{strategy}:{trade['symbol']}:{int(trade['entryTs'])}:{int(trade['exitTs'])}:{int(trade.get('rank', 1))}"
            active_stock[pid] = {
                "strategy": strategy,
                "symbol": str(trade["symbol"]),
                "rank": int(trade.get("rank", 1)),
                "allocatedGross": allocated,
                "entryNotional": equity * allocated,
                "netUnitReturn": finite(unit),
            }
            add_exit("STOCK_EXIT", int(trade["exitTs"]), positionId=pid)
            stats[f"{strategy}_ENTERED"] += 1
            if strategy == "V50_POST_OPEN_BASIS":
                v50_daily_trades += 1
                stats[f"V50_RANK_{int(trade.get('rank', 1))}_ENTERED"] += 1
            observe()
            index += 1
            continue

        if kind == "STOCK_EXIT":
            position = active_stock.pop(str(item["positionId"]), None)
            if position is not None:
                realize(ts, position, str(position["strategy"]))
                stats[f"{position['strategy']}_EXITED"] += 1
                observe()
            index += 1
            continue

        raise RuntimeError(f"Unknown event kind: {kind}")

    return rounded({
        **metrics(events, equity_path, equity),
        "observedMaximumV12Gross": max_v12,
        "observedMaximumPenguGross": max_pengu,
        "observedMaximumCryptoGross": max_crypto,
        "observedMaximumStockGross": max_stock,
        "observedMaximumTotalGross": max_total,
        "observedMaximumV50Concurrent": max_v50_concurrent,
        "routingDiagnostics": dict(stats),
    })


def configs() -> list[dict]:
    rows = []
    for top_k in TOP_KS:
        for crypto_cap in CRYPTO_CAPS:
            for v12_cap in V12_CAPS:
                if v12_cap > crypto_cap + 1e-12:
                    continue
                for pengu_cap in PENGU_CAPS:
                    if pengu_cap > crypto_cap + 1e-12:
                        continue
                    rows.append({
                        "id": f"TOP{top_k}_C{crypto_cap:.2f}_V12{v12_cap:.2f}_P{pengu_cap:.2f}",
                        "topK": top_k,
                        "cryptoCap": crypto_cap,
                        "v12Cap": v12_cap,
                        "penguCap": pengu_cap,
                    })
    return rows


def worst(rows: Dict[str, dict], key: str, default: float = 0.0) -> float:
    return min(finite(rows[order].get(key), default) for order in PRIORITY_ORDERS)


def best_candidate(selection: dict, baseline_id: str) -> tuple[dict | None, list[dict]]:
    baseline_n = selection["NORMAL"][baseline_id]
    baseline_s = selection["SEVERE"][baseline_id]
    baseline_normal = worst(baseline_n, "compoundedReturnPct")
    baseline_severe = worst(baseline_s, "compoundedReturnPct")
    summary = []
    for cfg in configs():
        row_n = selection["NORMAL"][cfg["id"]]
        row_s = selection["SEVERE"][cfg["id"]]
        normal_return = worst(row_n, "compoundedReturnPct")
        severe_return = worst(row_s, "compoundedReturnPct")
        severe_pf = worst(row_s, "profitFactor")
        severe_dd = worst(row_s, "maxDrawdownPctClosedEvent")
        max_total = max(row_n[order]["observedMaximumTotalGross"] for order in PRIORITY_ORDERS)
        max_stock = max(row_n[order]["observedMaximumStockGross"] for order in PRIORITY_ORDERS)
        max_crypto = max(row_n[order]["observedMaximumCryptoGross"] for order in PRIORITY_ORDERS)
        priority_delta = abs(row_n["CRYPTO_FIRST"]["compoundedReturnPct"] - row_n["STOCK_FIRST"]["compoundedReturnPct"])
        gate = bool(
            cfg["topK"] == 2
            and normal_return > baseline_normal
            and severe_return >= baseline_severe
            and severe_pf >= 1.20
            and severe_dd >= -25.0
            and max_total <= TOTAL_GROSS_CAP + 1e-9
            and max_stock <= STOCK_GROSS_CAP + 1e-9
            and max_crypto <= cfg["cryptoCap"] + 1e-9
        )
        score = normal_return + severe_return + 0.35 * severe_dd - 0.5 * priority_delta
        summary.append(rounded({**cfg, "gatePass": gate, "worstNormalReturnPct": normal_return, "worstSevereReturnPct": severe_return, "worstSeverePf": severe_pf, "worstSevereDdPct": severe_dd, "priorityDeltaPctPoint": priority_delta, "robustScore": score}))
    summary.sort(key=lambda row: (not row["gatePass"], -row["robustScore"], row["id"]))
    eligible = [row for row in summary if row["gatePass"]]
    return (eligible[0] if eligible else None), summary


def run_set(v12: dict, pengu: dict, v11_rows: list[dict], v50_by_topk: dict[int, list[dict]], start_ms: int, end_ms: int) -> dict:
    output: Dict[str, dict] = {}
    all_configs = configs()
    for scenario, assumptions in SCENARIOS.items():
        mode = assumptions["ledgerMode"]
        v12_trades = v12["modes"]["ALL"][mode]["trades"]
        pengu_trades = pengu["modes"][mode]["trades"]
        output[scenario] = {}
        for cfg in all_configs:
            output[scenario][cfg["id"]] = {
                order: simulate(v12_trades, pengu_trades, v11_rows, v50_by_topk[int(cfg["topK"])], cfg, finite(assumptions["stockCostBps"]), order, start_ms, end_ms)
                for order in PRIORITY_ORDERS
            }
    return output


def analyze(stock_cache: Path, v12_path: Path, pengu_path: Path, output_dir: Path) -> dict:
    v12 = load_json(v12_path)
    pengu = load_json(pengu_path)
    if v12.get("schema") != "v12-combined-bt-ledger/v1":
        raise RuntimeError("Unexpected V12 ledger schema")
    if pengu.get("strategyId") != "PENGU_DUAL_LS_V2_FINAL":
        raise RuntimeError("Unexpected PENGU ledger")
    v11_rows, v50_by_topk, stock_diag = build_stock(stock_cache)
    baseline_id = "TOP1_C1.50_V121.50_P0.75"

    selection = run_set(v12, pengu, v11_rows, v50_by_topk, START_MS, HOLDOUT_START_MS)
    winner, summary = best_candidate(selection, baseline_id)
    chosen_id = winner["id"] if winner else baseline_id
    chosen_cfg = next(row for row in configs() if row["id"] == chosen_id)
    baseline_cfg = next(row for row in configs() if row["id"] == baseline_id)

    def eval_pair(start_ms: int, end_ms: int) -> dict:
        result: Dict[str, dict] = {}
        for scenario, assumptions in SCENARIOS.items():
            mode = assumptions["ledgerMode"]
            vt = v12["modes"]["ALL"][mode]["trades"]
            pt = pengu["modes"][mode]["trades"]
            result[scenario] = {}
            for name, cfg in (("BASELINE", baseline_cfg), ("WINNER", chosen_cfg)):
                result[scenario][name] = {
                    "config": cfg,
                    **{order: simulate(vt, pt, v11_rows, v50_by_topk[int(cfg["topK"])], cfg, finite(assumptions["stockCostBps"]), order, start_ms, end_ms) for order in PRIORITY_ORDERS},
                }
        return result

    full = eval_pair(START_MS, END_MS)
    holdout = eval_pair(HOLDOUT_START_MS, END_MS)
    winner_full = full["NORMAL"]["WINNER"]
    baseline_full = full["NORMAL"]["BASELINE"]
    winner_holdout = holdout["NORMAL"]["WINNER"]
    full_v50_winner = min(winner_full[order]["bySleeve"]["V50_POST_OPEN_BASIS"]["events"] for order in PRIORITY_ORDERS)
    full_v50_baseline = min(baseline_full[order]["bySleeve"]["V50_POST_OPEN_BASIS"]["events"] for order in PRIORITY_ORDERS)
    final_checks = {
        "selectionWinnerFound": winner is not None,
        "winnerIsTop2": chosen_cfg["topK"] == 2,
        "fullNormalReturnNotLower": worst(winner_full, "compoundedReturnPct") >= worst(baseline_full, "compoundedReturnPct"),
        "fullSevereReturnNotLower": worst(full["SEVERE"]["WINNER"], "compoundedReturnPct") >= worst(full["SEVERE"]["BASELINE"], "compoundedReturnPct"),
        "holdoutNormalPositive": worst(winner_holdout, "compoundedReturnPct") > 0,
        "holdoutNormalPfAtLeast1_2": worst(winner_holdout, "profitFactor") >= 1.20,
        "v50TradesIncreaseAtLeast10Pct": full_v50_winner >= math.ceil(full_v50_baseline * 1.10),
        "totalGrossCapRespected": max(winner_full[order]["observedMaximumTotalGross"] for order in PRIORITY_ORDERS) <= TOTAL_GROSS_CAP + 1e-9,
        "stockGrossCapRespected": max(winner_full[order]["observedMaximumStockGross"] for order in PRIORITY_ORDERS) <= STOCK_GROSS_CAP + 1e-9,
        "v50ConcurrentAtMost2": max(winner_full[order]["observedMaximumV50Concurrent"] for order in PRIORITY_ORDERS) <= 2,
    }
    passed = all(final_checks.values())
    result = rounded({
        "schema": "v12-pengu-v52-top2-allocation-bt/v1",
        "status": "V52_TOP2_ALLOCATION_PASS_RESEARCH_ONLY" if passed else "V52_TOP2_ALLOCATION_NO_PROMOTION",
        "period": {"startInclusive": START.isoformat(), "endExclusive": END.isoformat(), "holdoutStart": HOLDOUT_START.isoformat()},
        "sourceLineage": {
            "liveBaseSha": "ef91f81e86f819ba1e37ff9325e8972489e1544f",
            "v12FrozenSha": "27f023a37d08b71c6e59b797fdc03c20d6032da2",
            "v52Top2ResearchSha": "2ca2faf08653e0a7e1f230af0e9d57bc12710065",
            "v52Thresholds": {"basisBps": 65.0, "netEdgeBps": 5.0, "topK": 2, "maxV50Slots": 2, "maxDailyV50Trades": 3},
        },
        "architecture": {
            "totalGrossCap": TOTAL_GROSS_CAP,
            "stockGrossCap": STOCK_GROSS_CAP,
            "penguPortfolioGrossCap": PENGU_PORTFOLIO_GROSS_CAP,
            "stockDailyLossPct": abs(STOCK_DAILY_LOSS_LIMIT) * 100.0,
            "cryptoDailyLossPct": abs(CRYPTO_DAILY_LOSS_LIMIT) * 100.0,
            "maxStockPositions": MAX_STOCK_POSITIONS,
            "prioritySensitivity": list(PRIORITY_ORDERS),
        },
        "data": {"stocks": stock_diag, "v12NormalTrades": v12["lineage"]["normal"]["tradeCount"], "penguNormalTrades": pengu["modes"]["normal"]["metrics"]["trades"]},
        "selection": {"periodEndExclusive": HOLDOUT_START.isoformat(), "baselineId": baseline_id, "winner": winner, "summary": summary},
        "full": full,
        "holdout": holdout,
        "finalChecks": final_checks,
        "recommendation": chosen_cfg if passed else None,
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
        "limitations": [
            "Selection and holdout are chronological slices of a historical period that overlaps prior strategy research; this is not an untouched market holdout.",
            "Drawdown uses closed-event equity because synchronized intratrade mark-to-market paths across all sleeves are unavailable.",
            "The V52 historical proxy cannot reconstruct sub-second queue position, partial fills or transient live data-quality rejects.",
            "The new LIVE 20-second bounded retry improves execution opportunity capture but is not credited with synthetic extra fills in this backtest.",
        ],
    })
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "winner": result["recommendation"], "checks": result["finalChecks"], "baselineFullNormal": result["full"]["NORMAL"]["BASELINE"], "winnerFullNormal": result["full"]["NORMAL"]["WINNER"], "winnerHoldoutNormal": result["holdout"]["NORMAL"]["WINNER"]}, indent=2, ensure_ascii=False))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--v12-ledger", default=".research-state/v12-pengu-v52-top2/v12-ledgers.json")
    parser.add_argument("--pengu-ledger", default=".research-state/v12-pengu-v52-top2/pengu-v2-ledgers.json")
    parser.add_argument("--output-dir", default=".research-state/v12-pengu-v52-top2")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        assert TOP2_SPEC.minimum_basis_bps == 65.0
        assert TOP2_SPEC.minimum_net_edge_bps == 5.0
        assert TOP2_SPEC.top_k == TOP2_SPEC.maximum_v50_slots == 2
        assert TOTAL_GROSS_CAP == 2.5 and STOCK_GROSS_CAP == 1.5
        assert PENGU_PORTFOLIO_GROSS_CAP == 2.0 and CRYPTO_DAILY_LOSS_LIMIT == -0.075
        assert any(row["id"] == "TOP1_C1.50_V121.50_P0.75" for row in configs())
        print("V12/PENGU/V52 Top2 allocation self-test: PASS")
        return 0
    analyze(Path(args.stock_cache_dir), Path(args.v12_ledger), Path(args.pengu_ledger), Path(args.output_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
