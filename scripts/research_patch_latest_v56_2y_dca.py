#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path


def one(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label} marker count={count}; refusing silent patch")
    return text.replace(old, new, 1)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    s = Path(args.source).read_text(encoding="utf-8")

    s = one(s, "START = dt.datetime(2025, 8, 1, tzinfo=UTC)", "START = dt.datetime(2024, 8, 10, tzinfo=UTC)", "start")
    s = one(s, "END = dt.datetime(2026, 8, 1, tzinfo=UTC)", "END = dt.datetime(2026, 8, 10, tzinfo=UTC)", "end")
    s = one(s, "CRYPTO_GROSS_CAP = 2.0", "CRYPTO_GROSS_CAP = 1.5", "crypto gross")
    s = one(s, "PENGU_MAX_GROSS = 0.75", "PENGU_MAX_GROSS = 0.9375", "pengu gross")
    s = one(s, "V11_GROSS_CAP = 1.0", "V11_GROSS_CAP = 1.5", "v11 gross")
    s = one(s, "V50_GROSS_CAP = 1.0", "V50_GROSS_CAP = 1.25", "v50 gross")

    s = one(
        s,
        "    current_day: str | None = None\n    day_start_equity = equity",
        "    current_day: str | None = None\n    v50_daily_trades = 0\n    day_start_equity = equity",
        "v50 daily init",
    )
    s = one(
        s,
        "        nonlocal current_day, day_start_equity, crypto_day_pnl, stock_day_pnl, crypto_latched, stock_latched",
        "        nonlocal current_day, day_start_equity, crypto_day_pnl, stock_day_pnl, crypto_latched, stock_latched, v50_daily_trades",
        "v50 daily nonlocal",
    )
    s = one(
        s,
        "            crypto_day_pnl = stock_day_pnl = 0.0\n            crypto_latched = stock_latched = False",
        "            crypto_day_pnl = stock_day_pnl = 0.0\n            crypto_latched = stock_latched = False\n            v50_daily_trades = 0",
        "v50 daily reset",
    )

    old_slot = '''            if any(str(position["strategy"]) == strategy for position in active_stock.values()):
                stats[f"{strategy}_SLOT_OCCUPIED"] += 1
                continue
            if any(str(position["symbol"]) == str(trade["symbol"]) for position in active_stock.values()):'''
    new_slot = '''            if strategy == "V11_EQ" and any(str(position["strategy"]) == "V11_EQ" for position in active_stock.values()):
                stats["V11_EQ_SLOT_OCCUPIED"] += 1
                continue
            if strategy == "V50_POST_OPEN_BASIS":
                active_v50 = sum(str(position["strategy"]) == "V50_POST_OPEN_BASIS" for position in active_stock.values())
                if active_v50 >= 2:
                    stats["V50_SLOT_CAP_BLOCKED"] += 1
                    continue
                if v50_daily_trades >= 3:
                    stats["V50_DAILY_CAP_BLOCKED"] += 1
                    continue
            if any(str(position["symbol"]) == str(trade["symbol"]) for position in active_stock.values()):'''
    s = one(s, old_slot, new_slot, "stock slots")

    old_alloc = '''            unit_return = base.stock.unit_trade_value(trade, stock_cost_bps)
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
            observe_entry()'''
    new_alloc = '''            unit_return = finite(trade.get("netUnitReturn"), float("nan"))
            if not math.isfinite(unit_return):
                stats[f"{strategy}_COST_EDGE_REJECTED"] += 1
                continue
            slot_cap = V11_GROSS_CAP if strategy == "V11_EQ" else V50_GROSS_CAP
            requested = min(slot_cap, max(0.0, finite(trade.get("requestedGross"), slot_cap)))
            vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
            available = min(requested, max(0.0, STOCK_GROSS_CAP - sg), max(0.0, TOTAL_GROSS_CAP - vg - pg - sg))
            rank = int(trade.get("rank", 1))
            minimum = SECOND_STOCK_MIN_GROSS if strategy == "V50_POST_OPEN_BASIS" and rank >= 2 else (FIRST_STOCK_MIN_GROSS if not active_stock else SECOND_STOCK_MIN_GROSS)
            if available + 1e-12 < minimum:
                stats["STOCK_CAPACITY_BLOCKED"] += 1
                continue
            allocated = available
            pid = f"{strategy}:{trade['symbol']}:{int(trade['entryTs'])}:{int(trade.get('rank', 1))}"
            active_stock[pid] = {"strategy": strategy, "symbol": trade["symbol"], "entryNotional": equity * allocated, "allocatedGrossAtEntry": allocated, "requestedGross": requested, "netUnitReturn": unit_return, "exitReason": trade.get("exitReason")}
            if allocated < requested - 1e-12:
                stats[f"{strategy}_GROSS_SCALED"] += 1
            push(int(trade["exitTs"]), 0, {"kind": "STOCK_EXIT", "positionId": pid})
            stats[f"{strategy}_ENTERED"] += 1
            if strategy == "V50_POST_OPEN_BASIS":
                v50_daily_trades += 1
                stats[f"V50_RANK_{rank}_ENTERED"] += 1
            observe_entry()'''
    s = one(s, old_alloc, new_alloc, "stock allocation")

    s = one(
        s,
        '    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")',
        '    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")\n    parser.add_argument("--stock-ledger", required=True)',
        "stock ledger arg",
    )
    s = one(
        s,
        '    expected_period = {"startInclusive": "2025-08-01T00:00:00.000Z", "endExclusive": "2026-08-01T00:00:00.000Z"}',
        '    expected_period = {"startInclusive": "2024-08-10T00:00:00.000Z", "endExclusive": "2026-08-10T00:00:00.000Z"}',
        "period contract",
    )
    s = one(s, '    if v12.get("period") != expected_period:', '    if {k: v12.get("period", {}).get(k) for k in expected_period} != expected_period:', "v12 period check")
    s = one(s, '    if pengu.get("period") != expected_period:', '    if {k: pengu.get("period", {}).get(k) for k in expected_period} != expected_period:', "pengu period check")
    s = one(
        s,
        '    v11_rows, v50_rows, target_days, stock_diagnostics = build_stock(Path(args.stock_cache_dir))\n    results: Dict[str, dict] = {}',
        '    stock_payload = load_json(Path(args.stock_ledger))\n    stock_diagnostics = stock_payload["dataQuality"]\n    target_days = [None] * int(stock_diagnostics["targetSessions"])\n    results: Dict[str, dict] = {}',
        "stock loader",
    )
    s = one(
        s,
        '        results[scenario] = simulate(v12["modes"][mode]["trades"], pengu["modes"][mode]["trades"], v11_rows, v50_rows, finite(assumptions["stockCostBps"]))',
        '        stock_mode = stock_payload["modes"][mode]\n        results[scenario] = simulate(v12["modes"][mode]["trades"], pengu["modes"][mode]["trades"], stock_mode["v11"], stock_mode["v50"], finite(stock_mode["stockCostBps"]))',
        "scenario stock mode",
    )
    s = one(s, '        checks[f"{scenario}_contributions"] = abs(row["totalContributedJpy"] - 120_000.0) < 1e-6', '        checks[f"{scenario}_contributions"] = abs(row["totalContributedJpy"] - 250_000.0) < 1e-6', "contribution check")
    s = one(
        s,
        '    result = rounded({',
        '    checks["NORMAL_v52TradesPositive"] = results["NORMAL"]["bySleeve"]["V52"]["trades"] > 0\n    checks["stockDecisionWindowCoverage"] = finite(stock_diagnostics.get("decisionWindowCoveragePct")) >= 99.9\n    result = rounded({',
        "data checks",
    )
    s = one(s, '"schema": "current-v12-top2-pengu-v2-v52-dca-1y/v1"', '"schema": "latest-v56-v12-pengu-v20-v52-dca-2y/v1"', "schema")
    s = one(s, '"totalContributedJpy": 120_000.0', '"totalContributedJpy": 250_000.0', "capital total")
    s = one(
        s,
        '"architecture": {"v12Slots": V12_MAX_POSITIONS, "v12GrossCap": V12_GROSS_CAP, "v12PerPositionGrossCap": V12_PER_POSITION_GROSS_CAP, "penguGrossCap": PENGU_MAX_GROSS, "sharedCryptoGrossCap": CRYPTO_GROSS_CAP, "stockGrossCap": STOCK_GROSS_CAP, "totalGrossCap": TOTAL_GROSS_CAP, "entryPriority": ["V52", "PENGU_DUAL_LS_V2", "V12"], "cryptoDailyLossLimitPct": CRYPTO_DAILY_LOSS_LIMIT * 100, "stockDailyLossLimitPct": STOCK_DAILY_LOSS_LIMIT * 100}',
        '"architecture": {"v12Slots": V12_MAX_POSITIONS, "v12GrossCap": V12_GROSS_CAP, "v12PerPositionGrossCap": V12_PER_POSITION_GROSS_CAP, "penguLongGrossMax": 0.9375, "penguShortGrossMax": 0.75, "penguGrossCap": PENGU_MAX_GROSS, "sharedCryptoGrossCap": CRYPTO_GROSS_CAP, "stockGrossCap": STOCK_GROSS_CAP, "totalGrossCap": TOTAL_GROSS_CAP, "v50ConcurrentMax": 2, "v50DailyMax": 3, "entryPriority": ["V52", "PENGU_DUAL_LS_V2", "V12"], "cryptoDailyLossLimitPct": CRYPTO_DAILY_LOSS_LIMIT * 100, "stockDailyLossLimitPct": STOCK_DAILY_LOSS_LIMIT * 100, "v56StockPolicy": stock_payload["policy"]}',
        "architecture",
    )
    old_source = '"source": {"productionGrossCommit": "ac254e897b7514d14c3a34c0679388978b5c3d32", "v12Top2ResearchCommit": "fea641f3097c2faa32db59338381b45a99edc6e0", "penguProductionReplay": "PENGU_DUAL_LS_V2_FINAL", "v52StockResearch": "04c1a369223bd27e9e42bc93604b3777b9230d92"}'
    new_source = '"source": {"v12CurrentProductionSha": "a81dd2eae17422f7d9a4354460aa2692317ba082", "v12Top2ResearchCommit": "fea641f3097c2faa32db59338381b45a99edc6e0", "penguCurrentProductionSha": "a76fd7aaa0788209532a5a2c6489135dd8e4a27e", "penguProductionReplay": "PENGU_DUAL_LS_V2_FINAL + SHORT_V20 + V56_SIDE_AWARE", "v52CurrentProductionSha": "239982a73daed630a88b466404af43483aea8a10", "v52V56PolicyMergeSha": "84aff956d2b45937a17622f960dee5374f2f261a", "v56ResearchHarnessSha": "0f392207f3ba7b3b8e6a2fe706bff6f454e51c2d", "v52StockResearch": "04c1a369223bd27e9e42bc93604b3777b9230d92"}'
    s = one(s, old_source, new_source, "source lineage")
    old_data = '"data": {"stockTargetSessions": len(target_days), "v11RawTrades": len(v11_rows), "v50RawTrades": len(v50_rows), "stockDiagnostics": stock_diagnostics, "v12NormalSourceMetrics": v12["modes"]["normal"]["metrics"], "penguNormalSourceMetrics": pengu["modes"]["normal"]["metrics"]}'
    new_data = '"data": {"stockTargetSessions": len(target_days), "v11PreparedNormalTrades": len(stock_payload["modes"]["normal"]["v11"]), "v50PreparedNormalTrades": len(stock_payload["modes"]["normal"]["v50"]), "stockDiagnostics": stock_diagnostics, "v12NormalSourceMetrics": v12["modes"]["normal"]["metrics"], "penguNormalSourceMetrics": pengu["modes"]["normal"]["metrics"], "penguData": pengu.get("data")}'
    s = one(s, old_data, new_data, "data block")

    s = one(s, "# Current V12 Top2 + PENGU V2 + V52 — 1Y monthly DCA backtest", "# Latest V56 V12 Top2 + PENGU V20 + V52 — 2Y monthly DCA backtest", "report title")
    s = one(s, "11 additions; total contributed JPY 120,000", "24 additions; total contributed JPY 250,000", "report contributions")
    s = one(s, "Shared crypto gross <= 2.0x", "Shared crypto gross <= 1.5x", "report crypto cap")
    s = one(
        s,
        '    lines += ["", "## Gross / slot verification", "",',
        '    lines += ["", "## V52 detail", "", "| Strategy | Trades | PnL | Win rate | PF |", "|---|---:|---:|---:|---:|"]\n    for strategy, row in normal["v52Detail"].items():\n        win = "-" if row["winRatePct"] is None else f"{row[\'winRatePct\']:.2f}%"\n        pf = "-" if row["profitFactor"] is None else f"{row[\'profitFactor\']:.3f}"\n        lines.append(f"| {strategy} | {row[\'trades\']} | ¥{row[\'pnlJpy\']:,.0f} | {win} | {pf} |")\n    dq = result["data"]["stockDiagnostics"]\n    lines += ["", "## V52 stock data quality", "", f"- Provider: {dq.get(\'provider\')}", f"- Target sessions: {dq.get(\'targetSessions\')}", f"- Decision-window coverage: {dq.get(\'decisionWindowCoveragePct\'):.2f}%", f"- Minimum aligned days: {dq.get(\'minimumAlignedDays\')}", "", "## Gross / slot verification", "",',
        "report v52 detail",
    )

    Path(args.output).write_text(s, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
