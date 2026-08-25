from __future__ import annotations

import argparse
import csv
import datetime as dt
import heapq
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Sequence

import research_v12_v52_pengu_v2_combined_bt as base

UTC = dt.timezone.utc
START = dt.datetime(2024, 8, 10, tzinfo=UTC)
END = dt.datetime(2026, 8, 10, tzinfo=UTC)
START_MS = int(START.timestamp() * 1000)
END_MS = int(END.timestamp() * 1000)

INITIAL_JPY = 10_000.0
MONTHLY_JPY = 10_000.0

TOTAL_GROSS_CAP = 2.5
CRYPTO_GROSS_CAP = 2.0
V12_GROSS_CAP = 1.5
V12_PER_POSITION_GROSS_CAP = 1.0
V12_MAX_POSITIONS = 2
PENGU_MAX_GROSS = 0.75
STOCK_GROSS_CAP = 1.5
V11_GROSS_CAP = 1.0
V50_GROSS_CAP = 1.0
FIRST_STOCK_MIN_GROSS = 0.5
SECOND_STOCK_MIN_GROSS = 0.25
CRYPTO_DAILY_LOSS_LIMIT = -0.075
STOCK_DAILY_LOSS_LIMIT = -0.035

ENTRY_PRIORITY = {"STOCK_ENTRY": 1, "PENGU_ENTRY": 2, "V12_ENTRY": 3}
SCENARIOS = {
    "NORMAL": {"ledgerMode": "normal", "stockCostBps": float(base.stock.SCENARIOS["NORMAL"])},
    "SEVERE": {"ledgerMode": "stress", "stockCostBps": float(base.stock.SCENARIOS["SEVERE"])},
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


def load_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"Expected JSON object: {path}")
    return payload


def month_keys() -> List[str]:
    out: List[str] = []
    cur = START
    while cur < END:
        out.append(cur.strftime("%Y-%m"))
        cur = dt.datetime(cur.year + (cur.month == 12), 1 if cur.month == 12 else cur.month + 1, 1, tzinfo=UTC)
    return out


def contribution_points() -> List[tuple[int, float]]:
    points: List[tuple[int, float]] = []
    cur = dt.datetime(2024, 9, 1, tzinfo=UTC)
    while cur < END:
        points.append((int(cur.timestamp() * 1000), MONTHLY_JPY))
        cur = dt.datetime(cur.year + (cur.month == 12), 1 if cur.month == 12 else cur.month + 1, 1, tzinfo=UTC)
    return points


def configure_stock_period() -> None:
    base.START = START
    base.END = END
    base.START_MS = START_MS
    base.END_MS = END_MS
    base.legacy.PERIOD_START = START
    base.legacy.PERIOD_END = END
    base.legacy.START_MS = START_MS
    base.legacy.END_MS = END_MS
    base.legacy.base.PERIOD_START = START
    base.legacy.base.PERIOD_END = END
    base.legacy.base.START_MS = START_MS
    base.legacy.base.END_MS = END_MS


def build_stock(cache_root: Path):
    configure_stock_period()
    v11_rows, v50_rows, target_days, diagnostics = base.legacy.build_stock(cache_root)
    v11 = [row for row in v11_rows if START_MS <= int(row["entryTs"]) < END_MS]
    v50 = [row for row in v50_rows if START_MS <= int(row["entryTs"]) < END_MS]
    return v11, v50, target_days, diagnostics


def profit_factor(values: Sequence[float]) -> float | None:
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    if losses > 0:
        return gains / losses
    return 999.0 if gains > 0 else None


def xirr(cashflows: Sequence[tuple[dt.datetime, float]]) -> float | None:
    if not cashflows or not any(v < 0 for _, v in cashflows) or not any(v > 0 for _, v in cashflows):
        return None
    t0 = cashflows[0][0]

    def npv(rate: float) -> float:
        total = 0.0
        for when, value in cashflows:
            years = (when - t0).total_seconds() / (365.25 * 86400)
            total += value / ((1.0 + rate) ** years)
        return total

    lo, hi = -0.9999, 10.0
    f_lo, f_hi = npv(lo), npv(hi)
    while f_lo * f_hi > 0 and hi < 1_000_000:
        hi *= 10
        f_hi = npv(hi)
    if f_lo * f_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv(mid)
        if abs(f_mid) < 1e-10:
            return mid
        if f_lo * f_mid <= 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2


def simulate(v12_trades: Sequence[dict], pengu_trades: Sequence[dict], v11_rows: Sequence[dict], v50_rows: Sequence[dict], stock_cost_bps: float) -> dict:
    heap: list[tuple[int, int, int, dict]] = []
    seq = 0

    def push(ts: int, priority: int, item: dict) -> None:
        nonlocal seq
        heapq.heappush(heap, (ts, priority, seq, item))
        seq += 1

    for ts, amount in contribution_points():
        push(ts, -1, {"kind": "CONTRIBUTION", "amount": amount})
    for trade in sorted(v12_trades, key=lambda row: (int(row["entryTs"]), int(row.get("rank", 1)), str(row.get("symbol", "")))):
        if START_MS <= int(trade["entryTs"]) < END_MS:
            push(int(trade["entryTs"]), ENTRY_PRIORITY["V12_ENTRY"], {"kind": "V12_ENTRY", "trade": trade})
    for trade in pengu_trades:
        if START_MS <= int(trade["entryTs"]) < END_MS:
            push(int(trade["entryTs"]), ENTRY_PRIORITY["PENGU_ENTRY"], {"kind": "PENGU_ENTRY", "trade": trade})
    for trade in list(v11_rows) + list(v50_rows):
        if START_MS <= int(trade["entryTs"]) < END_MS:
            push(int(trade["entryTs"]), ENTRY_PRIORITY["STOCK_ENTRY"], {"kind": "STOCK_ENTRY", "trade": trade})

    equity = INITIAL_JPY
    contributed = INITIAL_JPY
    active_v12: Dict[str, dict] = {}
    active_pengu: dict | None = None
    active_stock: Dict[str, dict] = {}
    stats: Counter[str] = Counter()
    events: List[dict] = []
    current_day: str | None = None
    day_start_equity = equity
    crypto_day_pnl = stock_day_pnl = 0.0
    crypto_latched = stock_latched = False
    twr_index = twr_peak = 1.0
    max_drawdown = 0.0
    monthly_event_returns: Dict[str, List[float]] = defaultdict(list)
    months = month_keys()
    monthly_open: Dict[str, float] = {months[0]: equity}
    monthly_deposit: Dict[str, float] = {key: 0.0 for key in months}
    max_v12_positions = 0
    max_entry_v12_gross = max_entry_pengu_gross = max_entry_stock_gross = 0.0
    max_entry_crypto_gross = max_entry_total_gross = 0.0

    def position_gross(position: dict | None) -> float:
        return 0.0 if not position else finite(position.get("entryNotional")) / max(0.001, equity)

    def entry_allocated_gross(position: dict | None) -> float:
        """Return the contract allocation captured when this position entered.

        Capacity gates use current equity, but entry-time contract verification
        must not revalue an old allocation after later PnL changes equity.
        Otherwise a compliant 0.75x PENGU entry can be reported above its cap.
        """
        return 0.0 if not position else max(0.0, finite(position.get("allocatedGrossAtEntry")))

    def v12_gross() -> float:
        return sum(position_gross(position) for position in active_v12.values())

    def pengu_gross() -> float:
        return position_gross(active_pengu)

    def stock_gross() -> float:
        return sum(position_gross(position) for position in active_stock.values())

    def observe_entry() -> None:
        nonlocal max_v12_positions, max_entry_v12_gross, max_entry_pengu_gross, max_entry_stock_gross, max_entry_crypto_gross, max_entry_total_gross
        vg = sum(entry_allocated_gross(position) for position in active_v12.values())
        pg = entry_allocated_gross(active_pengu)
        sg = sum(entry_allocated_gross(position) for position in active_stock.values())
        max_v12_positions = max(max_v12_positions, len(active_v12))
        max_entry_v12_gross = max(max_entry_v12_gross, vg)
        max_entry_pengu_gross = max(max_entry_pengu_gross, pg)
        max_entry_stock_gross = max(max_entry_stock_gross, sg)
        max_entry_crypto_gross = max(max_entry_crypto_gross, vg + pg)
        max_entry_total_gross = max(max_entry_total_gross, vg + pg + sg)

    def reset_day(ts: int) -> None:
        nonlocal current_day, day_start_equity, crypto_day_pnl, stock_day_pnl, crypto_latched, stock_latched
        day = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).date().isoformat()
        if day != current_day:
            current_day = day
            day_start_equity = equity
            crypto_day_pnl = stock_day_pnl = 0.0
            crypto_latched = stock_latched = False

    def realize(ts: int, position: dict, strategy: str) -> None:
        nonlocal equity, crypto_day_pnl, stock_day_pnl, crypto_latched, stock_latched, twr_index, twr_peak, max_drawdown
        pnl = finite(position["entryNotional"]) * finite(position["netUnitReturn"])
        before = max(0.001, equity)
        event_return = pnl / before
        equity = max(0.001, equity + pnl)
        twr_index *= max(0.000001, 1.0 + event_return)
        twr_peak = max(twr_peak, twr_index)
        max_drawdown = min(max_drawdown, twr_index / twr_peak - 1.0)
        key = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).strftime("%Y-%m")
        monthly_event_returns[key].append(event_return)
        sleeve = "V52" if strategy in ("V11_EQ", "V50_POST_OPEN_BASIS") else strategy
        events.append({"ts": ts, "strategy": strategy, "sleeve": sleeve, "symbol": position.get("symbol"), "pnlJpy": pnl, "eventReturn": event_return, "allocatedGrossAtEntry": finite(position.get("allocatedGrossAtEntry")), "requestedGross": finite(position.get("requestedGross")), "exitReason": position.get("exitReason")})
        if sleeve in ("V12", "PENGU_DUAL_LS_V2"):
            crypto_day_pnl += pnl
            if not crypto_latched and crypto_day_pnl / max(0.001, day_start_equity) <= CRYPTO_DAILY_LOSS_LIMIT:
                crypto_latched = True
                stats["CRYPTO_DAILY_LOSS_LATCHES"] += 1
        else:
            stock_day_pnl += pnl
            if not stock_latched and stock_day_pnl / max(0.001, day_start_equity) <= STOCK_DAILY_LOSS_LIMIT:
                stock_latched = True
                stats["STOCK_DAILY_LOSS_LATCHES"] += 1

    while heap:
        ts, _priority, _seq, item = heapq.heappop(heap)
        if ts > END_MS:
            continue
        reset_day(ts)
        kind = str(item["kind"])
        if kind == "CONTRIBUTION":
            amount = finite(item["amount"])
            key = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).strftime("%Y-%m")
            monthly_open[key] = equity
            monthly_deposit[key] = monthly_deposit.get(key, 0.0) + amount
            equity += amount
            contributed += amount
            day_start_equity += amount
            stats["CONTRIBUTIONS"] += 1
            continue
        if kind == "V12_ENTRY":
            trade = item["trade"]
            if crypto_latched:
                stats["V12_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                continue
            if len(active_v12) >= V12_MAX_POSITIONS:
                stats["V12_SLOT_OCCUPIED"] += 1
                continue
            symbol = str(trade.get("symbol"))
            if any(str(position.get("symbol")) == symbol for position in active_v12.values()):
                stats["V12_SAME_SYMBOL_BLOCKED"] += 1
                continue
            requested = min(V12_PER_POSITION_GROSS_CAP, max(0.0, finite(trade.get("requestedGross"))))
            vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
            available = min(max(0.0, V12_GROSS_CAP - vg), max(0.0, CRYPTO_GROSS_CAP - vg - pg), max(0.0, TOTAL_GROSS_CAP - vg - pg - sg))
            allocated = min(requested, available)
            if allocated <= 1e-12:
                stats["V12_CAPACITY_BLOCKED"] += 1
                continue
            pid = f"V12:{symbol}:{int(trade['entryTs'])}:{int(trade.get('rank', 1))}"
            active_v12[pid] = {"strategy": "V12", "symbol": symbol, "entryNotional": equity * allocated, "allocatedGrossAtEntry": allocated, "requestedGross": requested, "netUnitReturn": finite(trade.get("netUnitReturn")), "exitReason": trade.get("exitReason")}
            if allocated < requested - 1e-12:
                stats["V12_GROSS_SCALED"] += 1
            push(int(trade["exitTs"]), 0, {"kind": "V12_EXIT", "positionId": pid})
            stats["V12_ENTERED"] += 1
            observe_entry()
            continue
        if kind == "V12_EXIT":
            position = active_v12.pop(str(item["positionId"]), None)
            if position is None:
                stats["V12_EXIT_WITHOUT_ACTIVE"] += 1
            else:
                realize(ts, position, "V12")
                stats["V12_EXITED"] += 1
            continue
        if kind == "PENGU_ENTRY":
            trade = item["trade"]
            if crypto_latched:
                stats["PENGU_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                continue
            if active_pengu is not None:
                stats["PENGU_SLOT_OCCUPIED"] += 1
                continue
            requested = min(PENGU_MAX_GROSS, max(0.0, finite(trade.get("requestedGross"))))
            vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
            available = min(PENGU_MAX_GROSS, max(0.0, CRYPTO_GROSS_CAP - vg - pg), max(0.0, TOTAL_GROSS_CAP - vg - pg - sg))
            allocated = min(requested, available)
            if allocated <= 1e-12:
                stats["PENGU_CAPACITY_BLOCKED"] += 1
                continue
            active_pengu = {"strategy": "PENGU_DUAL_LS_V2", "symbol": "PENGUUSDT", "entryNotional": equity * allocated, "allocatedGrossAtEntry": allocated, "requestedGross": requested, "netUnitReturn": finite(trade.get("netUnitReturn")), "exitReason": trade.get("exitReason")}
            if allocated < requested - 1e-12:
                stats["PENGU_GROSS_SCALED"] += 1
            push(int(trade["exitTs"]), 0, {"kind": "PENGU_EXIT"})
            stats["PENGU_ENTERED"] += 1
            observe_entry()
            continue
        if kind == "PENGU_EXIT":
            if active_pengu is None:
                stats["PENGU_EXIT_WITHOUT_ACTIVE"] += 1
            else:
                position = active_pengu
                active_pengu = None
                realize(ts, position, "PENGU_DUAL_LS_V2")
                stats["PENGU_EXITED"] += 1
            continue
        if kind == "STOCK_ENTRY":
            trade = item["trade"]
            strategy = str(trade["strategy"])
            if stock_latched:
                stats["STOCK_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                continue
            if any(str(position["strategy"]) == strategy for position in active_stock.values()):
                stats[f"{strategy}_SLOT_OCCUPIED"] += 1
                continue
            if any(str(position["symbol"]) == str(trade["symbol"]) for position in active_stock.values()):
                stats["SAME_STOCK_SYMBOL_BLOCKED"] += 1
                continue
            unit_return = base.stock.unit_trade_value(trade, stock_cost_bps)
            if unit_return is None:
                stats[f"{strategy}_COST_EDGE_REJECTED"] += 1
                continue
            slot_cap = V11_GROSS_CAP if strategy == "V11_EQ" else V50_GROSS_CAP
            vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
            available = min(slot_cap, max(0.0, STOCK_GROSS_CAP - sg), max(0.0, TOTAL_GROSS_CAP - vg - pg - sg))
            minimum = FIRST_STOCK_MIN_GROSS if not active_stock else SECOND_STOCK_MIN_GROSS
            if available + 1e-12 < minimum:
                stats["STOCK_CAPACITY_BLOCKED"] += 1
                continue
            allocated = available
            pid = f"{strategy}:{trade['symbol']}:{int(trade['entryTs'])}"
            active_stock[pid] = {"strategy": strategy, "symbol": trade["symbol"], "entryNotional": equity * allocated, "allocatedGrossAtEntry": allocated, "requestedGross": slot_cap, "netUnitReturn": finite(unit_return), "exitReason": trade.get("exitReason")}
            if allocated < slot_cap - 1e-12:
                stats[f"{strategy}_GROSS_SCALED"] += 1
            push(int(trade["exitTs"]), 0, {"kind": "STOCK_EXIT", "positionId": pid})
            stats[f"{strategy}_ENTERED"] += 1
            observe_entry()
            continue
        if kind == "STOCK_EXIT":
            position = active_stock.pop(str(item["positionId"]), None)
            if position is None:
                stats["STOCK_EXIT_WITHOUT_ACTIVE"] += 1
            else:
                realize(ts, position, str(position["strategy"]))
                stats[f"{position['strategy']}_EXITED"] += 1
            continue
        raise RuntimeError(f"Unknown timeline kind: {kind}")

    if active_v12 or active_pengu or active_stock:
        raise RuntimeError("Open positions remained at END; source ledgers must close at window end")

    monthly: List[dict] = []
    for idx, key in enumerate(months):
        opening = monthly_open.get(key)
        if opening is None:
            raise RuntimeError(f"Missing month opening: {key}")
        closing = monthly_open[months[idx + 1]] if idx + 1 < len(months) else equity
        deposit = monthly_deposit.get(key, 0.0)
        pnl = closing - opening - deposit
        factor = 1.0
        for event_return in monthly_event_returns.get(key, []):
            factor *= max(0.000001, 1.0 + event_return)
        monthly.append({"month": key, "openingAssetJpy": opening, "depositJpy": deposit, "closingAssetJpy": closing, "tradingPnlJpy": pnl, "timeWeightedReturnPct": (factor - 1.0) * 100.0})

    cashflows: List[tuple[dt.datetime, float]] = [(START, -INITIAL_JPY)]
    for ts, amount in contribution_points():
        cashflows.append((dt.datetime.fromtimestamp(ts / 1000, tz=UTC), -amount))
    cashflows.append((END, equity))
    irr = xirr(cashflows)
    event_returns = [finite(row["eventReturn"]) for row in events]
    by_sleeve: Dict[str, dict] = {}
    for sleeve in ("V12", "PENGU_DUAL_LS_V2", "V52"):
        rows = [row for row in events if row["sleeve"] == sleeve]
        values = [finite(row["eventReturn"]) for row in rows]
        by_sleeve[sleeve] = {"trades": len(rows), "pnlJpy": sum(finite(row["pnlJpy"]) for row in rows), "winRatePct": (sum(value > 0 for value in values) / len(values) * 100.0) if values else None, "profitFactor": profit_factor(values)}
    v52_detail: Dict[str, dict] = {}
    for strategy in ("V11_EQ", "V50_POST_OPEN_BASIS"):
        rows = [row for row in events if row["strategy"] == strategy]
        values = [finite(row["eventReturn"]) for row in rows]
        v52_detail[strategy] = {"trades": len(rows), "pnlJpy": sum(finite(row["pnlJpy"]) for row in rows), "winRatePct": (sum(value > 0 for value in values) / len(values) * 100.0) if values else None, "profitFactor": profit_factor(values)}

    return rounded({
        "initialCapitalJpy": INITIAL_JPY,
        "monthlyContributionJpy": MONTHLY_JPY,
        "contributionCountAfterStart": len(contribution_points()),
        "totalContributedJpy": contributed,
        "endingAssetJpy": equity,
        "netProfitJpy": equity - contributed,
        "returnOnContributedCapitalPct": (equity / contributed - 1.0) * 100.0,
        "timeWeightedReturnPct": (twr_index - 1.0) * 100.0,
        "moneyWeightedReturnXirrPct": irr * 100.0 if irr is not None else None,
        "maxDrawdownPctClosedEventTwr": max_drawdown * 100.0,
        "trades": len(events),
        "winRatePct": (sum(value > 0 for value in event_returns) / len(event_returns) * 100.0) if event_returns else None,
        "profitFactor": profit_factor(event_returns),
        "monthly": monthly,
        "bySleeve": by_sleeve,
        "v52Detail": v52_detail,
        "routingDiagnostics": dict(stats),
        "grossVerification": {"maxV12Positions": max_v12_positions, "entryTimeMaxV12Gross": max_entry_v12_gross, "entryTimeMaxPenguGross": max_entry_pengu_gross, "entryTimeMaxStockGross": max_entry_stock_gross, "entryTimeMaxCryptoGross": max_entry_crypto_gross, "entryTimeMaxTotalGross": max_entry_total_gross, "limits": {"v12Positions": V12_MAX_POSITIONS, "v12Gross": V12_GROSS_CAP, "penguGross": PENGU_MAX_GROSS, "cryptoGross": CRYPTO_GROSS_CAP, "stockGross": STOCK_GROSS_CAP, "totalGross": TOTAL_GROSS_CAP}},
    })


def write_report(output: Path, result: dict) -> None:
    normal = result["results"]["NORMAL"]
    severe = result["results"]["SEVERE"]
    lines = [
        "# Current V12 Top2 + PENGU V2 + V52 — 1Y monthly DCA backtest", "",
        f"- Period: `{result['period']['startInclusive']}` to `{result['period']['endExclusive']}`",
        "- Initial capital: JPY 10,000", "- Monthly contribution: JPY 10,000 at each month-start after inception (24 additions; total contributed JPY 250,000)",
        "- Compounding: all realized PnL retained and used for subsequent position sizing", "- Entry priority: V52 -> PENGU V2 -> V12",
        "- V12: Top2, max 2 simultaneous positions, own gross <= 1.5x, each <= 1.0x", "- Shared crypto gross <= 2.0x; stock gross <= 1.5x; total gross <= 2.5x",
        "- Shared crypto daily-loss gate: -7.5%; stock daily-loss gate: -3.5%", "",
        "| Scenario | Ending asset | Net profit | Return vs contributed | TWR | XIRR | Max DD | Trades | Win rate | PF |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name, row in (("NORMAL", normal), ("SEVERE", severe)):
        lines.append(f"| {name} | ¥{row['endingAssetJpy']:,.0f} | ¥{row['netProfitJpy']:,.0f} | {row['returnOnContributedCapitalPct']:.2f}% | {row['timeWeightedReturnPct']:.2f}% | {row['moneyWeightedReturnXirrPct']:.2f}% | {row['maxDrawdownPctClosedEventTwr']:.2f}% | {row['trades']} | {row['winRatePct']:.2f}% | {row['profitFactor']:.3f} |")
    lines += ["", "## NORMAL monthly", "", "| Month | Opening | Deposit | Trading PnL | Closing | TWR |", "|---|---:|---:|---:|---:|---:|"]
    for row in normal["monthly"]:
        lines.append(f"| {row['month']} | ¥{row['openingAssetJpy']:,.0f} | ¥{row['depositJpy']:,.0f} | ¥{row['tradingPnlJpy']:,.0f} | ¥{row['closingAssetJpy']:,.0f} | {row['timeWeightedReturnPct']:.2f}% |")
    lines += ["", "## NORMAL sleeve contribution", "", "| Sleeve | Trades | PnL | Win rate | PF |", "|---|---:|---:|---:|---:|"]
    for sleeve, row in normal["bySleeve"].items():
        win = "-" if row["winRatePct"] is None else f"{row['winRatePct']:.2f}%"
        pf = "-" if row["profitFactor"] is None else f"{row['profitFactor']:.3f}"
        lines.append(f"| {sleeve} | {row['trades']} | ¥{row['pnlJpy']:,.0f} | {win} | {pf} |")
    lines += ["", "## Gross / slot verification", "", f"- max V12 positions: {normal['grossVerification']['maxV12Positions']} / {V12_MAX_POSITIONS}", f"- entry-time max V12 gross: {normal['grossVerification']['entryTimeMaxV12Gross']:.6f}x / {V12_GROSS_CAP:.2f}x", f"- entry-time max crypto gross: {normal['grossVerification']['entryTimeMaxCryptoGross']:.6f}x / {CRYPTO_GROSS_CAP:.2f}x", f"- entry-time max stock gross: {normal['grossVerification']['entryTimeMaxStockGross']:.6f}x / {STOCK_GROSS_CAP:.2f}x", f"- entry-time max total gross: {normal['grossVerification']['entryTimeMaxTotalGross']:.6f}x / {TOTAL_GROSS_CAP:.2f}x", "", "Research only. No LIVE order, VPS mutation, or production change."]
    output.joinpath("report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    with output.joinpath("monthly-normal.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["month", "openingAssetJpy", "depositJpy", "tradingPnlJpy", "closingAssetJpy", "timeWeightedReturnPct"])
        writer.writeheader()
        writer.writerows(normal["monthly"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--v12-ledger", default=".research-state/current-top2-dca/v12-top2-ledger.json")
    parser.add_argument("--pengu-ledger", default=".research-state/current-top2-dca/pengu-v2-ledger.json")
    parser.add_argument("--output-dir", default=".research-state/current-top2-dca")
    args = parser.parse_args()
    v12 = load_json(Path(args.v12_ledger))
    pengu = load_json(Path(args.pengu_ledger))
    expected_period = {"startInclusive": "2024-08-10T00:00:00.000Z", "endExclusive": "2026-08-10T00:00:00.000Z"}
    if v12.get("period") != expected_period:
        raise RuntimeError(f"Unexpected V12 period: {v12.get('period')}")
    if pengu.get("period") != expected_period:
        raise RuntimeError(f"Unexpected PENGU period: {pengu.get('period')}")
    if v12.get("strategyId") != "V12_X1.00_ALL_TOP2_RESIDUAL_GROSS15":
        raise RuntimeError("Unexpected V12 strategy id")
    if pengu.get("strategyId") != "PENGU_DUAL_LS_V2_FINAL":
        raise RuntimeError("Unexpected PENGU strategy id")
    v11_rows, v50_rows, target_days, stock_diagnostics = build_stock(Path(args.stock_cache_dir))
    results: Dict[str, dict] = {}
    for scenario, assumptions in SCENARIOS.items():
        mode = str(assumptions["ledgerMode"])
        results[scenario] = simulate(v12["modes"][mode]["trades"], pengu["modes"][mode]["trades"], v11_rows, v50_rows, finite(assumptions["stockCostBps"]))
    checks = {}
    for scenario, row in results.items():
        gross = row["grossVerification"]
        checks[f"{scenario}_v12Positions"] = gross["maxV12Positions"] <= V12_MAX_POSITIONS
        checks[f"{scenario}_v12Gross"] = gross["entryTimeMaxV12Gross"] <= V12_GROSS_CAP + 1e-9
        checks[f"{scenario}_penguGross"] = gross["entryTimeMaxPenguGross"] <= PENGU_MAX_GROSS + 1e-9
        checks[f"{scenario}_cryptoGross"] = gross["entryTimeMaxCryptoGross"] <= CRYPTO_GROSS_CAP + 1e-9
        checks[f"{scenario}_stockGross"] = gross["entryTimeMaxStockGross"] <= STOCK_GROSS_CAP + 1e-9
        checks[f"{scenario}_totalGross"] = gross["entryTimeMaxTotalGross"] <= TOTAL_GROSS_CAP + 1e-9
        checks[f"{scenario}_contributions"] = abs(row["totalContributedJpy"] - 250_000.0) < 1e-6
    result = rounded({
    "schema": "current-v12-top2-pengu-v2-v52-dca-2y/v1",
        "status": "PASS_RESEARCH_ONLY" if all(checks.values()) else "FAIL_RESEARCH_VALIDATION",
        "period": expected_period,
        "architecture": {"v12Slots": V12_MAX_POSITIONS, "v12GrossCap": V12_GROSS_CAP, "v12PerPositionGrossCap": V12_PER_POSITION_GROSS_CAP, "penguGrossCap": PENGU_MAX_GROSS, "sharedCryptoGrossCap": CRYPTO_GROSS_CAP, "stockGrossCap": STOCK_GROSS_CAP, "totalGrossCap": TOTAL_GROSS_CAP, "entryPriority": ["V52", "PENGU_DUAL_LS_V2", "V12"], "cryptoDailyLossLimitPct": CRYPTO_DAILY_LOSS_LIMIT * 100, "stockDailyLossLimitPct": STOCK_DAILY_LOSS_LIMIT * 100},
        "capital": {"initialJpy": INITIAL_JPY, "monthlyContributionJpy": MONTHLY_JPY, "contributionCountAfterStart": len(contribution_points()), "totalContributedJpy": 250_000.0, "compounding": True},
        "source": {"productionGrossCommit": "ac254e897b7514d14c3a34c0679388978b5c3d32", "v12Top2ResearchCommit": "fea641f3097c2faa32db59338381b45a99edc6e0", "penguProductionReplay": "PENGU_DUAL_LS_V2_FINAL", "v52ProductionCommit": "52a9c35863b992b55e9d429f1790890c5116f465", "v52StockResearch": "04c1a369223bd27e9e42bc93604b3777b9230d92"},
        "data": {"stockTargetSessions": len(target_days), "v11RawTrades": len(v11_rows), "v50RawTrades": len(v50_rows), "stockDiagnostics": stock_diagnostics, "v12NormalSourceMetrics": v12["modes"]["normal"]["metrics"], "penguNormalSourceMetrics": pengu["modes"]["normal"]["metrics"]},
        "results": results, "checks": checks,
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    })
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    output.joinpath("result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_report(output, result)
    print(json.dumps({"status": result["status"], "period": result["period"], "architecture": result["architecture"], "capital": result["capital"], "normal": result["results"]["NORMAL"], "severe": result["results"]["SEVERE"], "checks": result["checks"], "safety": result["safety"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
