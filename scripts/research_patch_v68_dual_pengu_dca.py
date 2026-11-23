#!/usr/bin/env python3
from pathlib import Path
import sys


def one(s: str, old: str, new: str, label: str) -> str:
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label} marker count={count}; refusing silent patch')
    return s.replace(old, new, 1)


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit('usage: research_patch_v68_dual_pengu_dca.py <generated-dca.py>')
    path = Path(sys.argv[1])
    s = path.read_text(encoding='utf-8')

    s = one(s, 'PENGU_MAX_GROSS = 0.9375', 'PENGU_MAX_GROSS = 0.9375\nV68_NEW_LONG_GROSS_CAP = 0.25\nV68_RESERVE_V64_GROSS = 0.9375', 'V68 constants')
    s = one(s,
        'ENTRY_PRIORITY = {"STOCK_ENTRY": 1, "PENGU_ENTRY": 2, "V12_ENTRY": 3}',
        'ENTRY_PRIORITY = {"STOCK_ENTRY": 1, "PENGU_ENTRY": 2, "V12_ENTRY": 3, "PENGU_NEW_LONG_ENTRY": 4}',
        'entry priority')
    s = one(s,
        'def simulate(v12_trades: Sequence[dict], pengu_trades: Sequence[dict], v11_rows: Sequence[dict], v50_rows: Sequence[dict], stock_cost_bps: float) -> dict:',
        'def simulate(v12_trades: Sequence[dict], pengu_trades: Sequence[dict], pengu_new_long_trades: Sequence[dict], v11_rows: Sequence[dict], v50_rows: Sequence[dict], stock_cost_bps: float) -> dict:',
        'simulate signature')

    s = one(s,
        '''    for trade in pengu_trades:
        if START_MS <= int(trade["entryTs"]) < END_MS:
            push(int(trade["entryTs"]), ENTRY_PRIORITY["PENGU_ENTRY"], {"kind": "PENGU_ENTRY", "trade": trade})
    for trade in list(v11_rows) + list(v50_rows):''',
        '''    for trade in pengu_trades:
        if START_MS <= int(trade["entryTs"]) < END_MS:
            push(int(trade["entryTs"]), ENTRY_PRIORITY["PENGU_ENTRY"], {"kind": "PENGU_ENTRY", "trade": trade})
    for trade in pengu_new_long_trades:
        if START_MS <= int(trade["entryTs"]) < END_MS:
            push(int(trade["entryTs"]), ENTRY_PRIORITY["PENGU_NEW_LONG_ENTRY"], {"kind": "PENGU_NEW_LONG_ENTRY", "trade": trade})
    for trade in list(v11_rows) + list(v50_rows):''',
        'new Long event feed')
    s = one(s,
        '    active_pengu: dict | None = None\n    active_stock: Dict[str, dict] = {}',
        '    active_pengu: dict | None = None\n    active_pengu_new_long: dict | None = None\n    active_stock: Dict[str, dict] = {}',
        'new Long active slot')
    s = one(s,
        '    max_entry_v12_gross = max_entry_pengu_gross = max_entry_stock_gross = 0.0',
        '    max_entry_v12_gross = max_entry_pengu_gross = max_entry_pengu_new_long_gross = max_entry_stock_gross = 0.0',
        'max gross init')

    gross_block = '''    def v12_gross() -> float:
        return sum(entry_allocated_gross(position) for position in active_v12.values())

    def pengu_gross() -> float:
        return entry_allocated_gross(active_pengu)

    def stock_gross() -> float:
        return sum(entry_allocated_gross(position) for position in active_stock.values())'''
    gross_new = '''    def v12_gross() -> float:
        return sum(entry_allocated_gross(position) for position in active_v12.values())

    def pengu_gross() -> float:
        return entry_allocated_gross(active_pengu)

    def pengu_new_long_gross() -> float:
        return entry_allocated_gross(active_pengu_new_long)

    def stock_gross() -> float:
        return sum(entry_allocated_gross(position) for position in active_stock.values())'''
    s = one(s, gross_block, gross_new, 'gross helpers')

    observe_old = '''    def observe_entry() -> None:
        nonlocal max_v12_positions, max_entry_v12_gross, max_entry_pengu_gross, max_entry_stock_gross, max_entry_crypto_gross, max_entry_total_gross
        vg = sum(entry_allocated_gross(position) for position in active_v12.values())
        pg = entry_allocated_gross(active_pengu)
        sg = sum(entry_allocated_gross(position) for position in active_stock.values())
        max_v12_positions = max(max_v12_positions, len(active_v12))
        max_entry_v12_gross = max(max_entry_v12_gross, vg)
        max_entry_pengu_gross = max(max_entry_pengu_gross, pg)
        max_entry_stock_gross = max(max_entry_stock_gross, sg)
        max_entry_crypto_gross = max(max_entry_crypto_gross, vg + pg)
        max_entry_total_gross = max(max_entry_total_gross, vg + pg + sg)'''
    observe_new = '''    def observe_entry() -> None:
        nonlocal max_v12_positions, max_entry_v12_gross, max_entry_pengu_gross, max_entry_pengu_new_long_gross, max_entry_stock_gross, max_entry_crypto_gross, max_entry_total_gross
        vg = sum(entry_allocated_gross(position) for position in active_v12.values())
        pg = entry_allocated_gross(active_pengu)
        ng = entry_allocated_gross(active_pengu_new_long)
        sg = sum(entry_allocated_gross(position) for position in active_stock.values())
        max_v12_positions = max(max_v12_positions, len(active_v12))
        max_entry_v12_gross = max(max_entry_v12_gross, vg)
        max_entry_pengu_gross = max(max_entry_pengu_gross, pg)
        max_entry_pengu_new_long_gross = max(max_entry_pengu_new_long_gross, ng)
        max_entry_stock_gross = max(max_entry_stock_gross, sg)
        max_entry_crypto_gross = max(max_entry_crypto_gross, vg + pg + ng)
        max_entry_total_gross = max(max_entry_total_gross, vg + pg + ng + sg)'''
    s = one(s, observe_old, observe_new, 'observe entry')

    s = one(s,
        '        if sleeve in ("V12", "PENGU_DUAL_LS_V2"):',
        '        if sleeve in ("V12", "PENGU_DUAL_LS_V2", "PENGU_V68_NEW_LONG_SLEEVE"):',
        'crypto daily loss sleeves')

    v12_old = '''            requested = min(V12_PER_POSITION_GROSS_CAP, max(0.0, finite(trade.get("requestedGross"))))
            vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
            available = min(max(0.0, V12_GROSS_CAP - vg), max(0.0, CRYPTO_GROSS_CAP - vg - pg), max(0.0, TOTAL_GROSS_CAP - vg - pg - sg))
            allocated = min(requested, available)'''
    v12_new = '''            requested = min(V12_PER_POSITION_GROSS_CAP, max(0.0, finite(trade.get("requestedGross"))))
            vg, pg, ng, sg = v12_gross(), pengu_gross(), pengu_new_long_gross(), stock_gross()
            reserve = V68_RESERVE_V64_GROSS if active_pengu_new_long is not None and active_pengu is None else 0.0
            unreserved = min(max(0.0, V12_GROSS_CAP - vg), max(0.0, CRYPTO_GROSS_CAP - vg - pg - ng), max(0.0, TOTAL_GROSS_CAP - vg - pg - ng - sg))
            available = min(max(0.0, V12_GROSS_CAP - vg), max(0.0, CRYPTO_GROSS_CAP - vg - pg - ng - reserve), max(0.0, TOTAL_GROSS_CAP - vg - pg - ng - sg - reserve))
            if reserve > 0 and available + 1e-12 < min(requested, unreserved):
                stats["PENGU_V64_RESERVED_CAPACITY_BLOCKED"] += 1
            allocated = min(requested, available)'''
    s = one(s, v12_old, v12_new, 'V12 reserve')

    pengu_old = '''            requested = min(PENGU_MAX_GROSS, max(0.0, finite(trade.get("requestedGross"))))
            vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
            available = min(PENGU_MAX_GROSS, max(0.0, CRYPTO_GROSS_CAP - vg - pg), max(0.0, TOTAL_GROSS_CAP - vg - pg - sg))
            allocated = min(requested, available)'''
    pengu_new = '''            requested = min(PENGU_MAX_GROSS, max(0.0, finite(trade.get("requestedGross"))))
            vg, pg, ng, sg = v12_gross(), pengu_gross(), pengu_new_long_gross(), stock_gross()
            available = min(PENGU_MAX_GROSS, max(0.0, CRYPTO_GROSS_CAP - vg - pg - ng), max(0.0, TOTAL_GROSS_CAP - vg - pg - ng - sg))
            allocated = min(requested, available)'''
    s = one(s, pengu_old, pengu_new, 'V64 capacity includes new Long')

    new_handler = '''        if kind == "PENGU_NEW_LONG_ENTRY":
            trade = item["trade"]
            if crypto_latched:
                stats["PENGU_NEW_LONG_ENTRY_DAILY_LOSS_BLOCKED"] += 1
                continue
            if active_pengu_new_long is not None:
                stats["PENGU_NEW_LONG_SLOT_OCCUPIED"] += 1
                continue
            requested = min(V68_NEW_LONG_GROSS_CAP, max(0.0, finite(trade.get("requestedGross"))))
            vg, pg, ng, sg = v12_gross(), pengu_gross(), pengu_new_long_gross(), stock_gross()
            reserve = 0.0 if active_pengu is not None else V68_RESERVE_V64_GROSS
            available = min(V68_NEW_LONG_GROSS_CAP, max(0.0, CRYPTO_GROSS_CAP - vg - pg - ng - reserve), max(0.0, TOTAL_GROSS_CAP - vg - pg - ng - sg - reserve))
            allocated = min(requested, available)
            if allocated <= 1e-12:
                stats["PENGU_NEW_LONG_CAPACITY_BLOCKED"] += 1
                continue
            active_pengu_new_long = {"strategy": "PENGU_V68_NEW_LONG_SLEEVE", "symbol": "PENGUUSDT", "entryNotional": equity * allocated, "allocatedGrossAtEntry": allocated, "requestedGross": requested, "netUnitReturn": finite(trade.get("netUnitReturn")), "exitReason": trade.get("exitReason")}
            if allocated < requested - 1e-12:
                stats["PENGU_NEW_LONG_GROSS_SCALED"] += 1
            push(int(trade["exitTs"]), 0, {"kind": "PENGU_NEW_LONG_EXIT"})
            stats["V68_NEW_LONG_ENTERED"] += 1
            observe_entry()
            continue
        if kind == "PENGU_NEW_LONG_EXIT":
            if active_pengu_new_long is None:
                stats["PENGU_NEW_LONG_EXIT_WITHOUT_ACTIVE"] += 1
            else:
                position = active_pengu_new_long
                active_pengu_new_long = None
                realize(ts, position, "PENGU_V68_NEW_LONG_SLEEVE")
                stats["V68_NEW_LONG_EXITED"] += 1
            continue
'''
    s = one(s, '        if kind == "STOCK_ENTRY":\n', new_handler + '        if kind == "STOCK_ENTRY":\n', 'new Long handlers')

    # research_patch_latest_v56_2y_dca.py has already converted the stock allocation block.
    stock_old = '''            vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
            available = min(requested, max(0.0, STOCK_GROSS_CAP - sg), max(0.0, TOTAL_GROSS_CAP - vg - pg - sg))
            rank = int(trade.get("rank", 1))'''
    stock_new = '''            vg, pg, ng, sg = v12_gross(), pengu_gross(), pengu_new_long_gross(), stock_gross()
            reserve = V68_RESERVE_V64_GROSS if active_pengu_new_long is not None and active_pengu is None else 0.0
            unreserved = min(requested, max(0.0, STOCK_GROSS_CAP - sg), max(0.0, TOTAL_GROSS_CAP - vg - pg - ng - sg))
            available = min(requested, max(0.0, STOCK_GROSS_CAP - sg), max(0.0, TOTAL_GROSS_CAP - vg - pg - ng - sg - reserve))
            if reserve > 0 and available + 1e-12 < unreserved:
                stats["PENGU_V64_RESERVED_CAPACITY_BLOCKED"] += 1
            rank = int(trade.get("rank", 1))'''
    s = one(s, stock_old, stock_new, 'stock reserve')

    s = one(s,
        '    if active_v12 or active_pengu or active_stock:',
        '    if active_v12 or active_pengu or active_pengu_new_long or active_stock:',
        'open positions check')
    s = one(s,
        '    for sleeve in ("V12", "PENGU_DUAL_LS_V2", "V52"):',
        '    for sleeve in ("V12", "PENGU_DUAL_LS_V2", "PENGU_V68_NEW_LONG_SLEEVE", "V52"):',
        'sleeve summary')

    gross_old = '"grossVerification": {"maxV12Positions": max_v12_positions, "entryTimeMaxV12Gross": max_entry_v12_gross, "entryTimeMaxPenguGross": max_entry_pengu_gross, "entryTimeMaxStockGross": max_entry_stock_gross, "entryTimeMaxCryptoGross": max_entry_crypto_gross, "entryTimeMaxTotalGross": max_entry_total_gross, "limits": {"v12Positions": V12_MAX_POSITIONS, "v12Gross": V12_GROSS_CAP, "penguGross": PENGU_MAX_GROSS, "cryptoGross": CRYPTO_GROSS_CAP, "stockGross": STOCK_GROSS_CAP, "totalGross": TOTAL_GROSS_CAP}}'
    gross_new = '"grossVerification": {"maxV12Positions": max_v12_positions, "entryTimeMaxV12Gross": max_entry_v12_gross, "entryTimeMaxPenguGross": max_entry_pengu_gross, "entryTimeMaxPenguNewLongGross": max_entry_pengu_new_long_gross, "entryTimeMaxStockGross": max_entry_stock_gross, "entryTimeMaxCryptoGross": max_entry_crypto_gross, "entryTimeMaxTotalGross": max_entry_total_gross, "limits": {"v12Positions": V12_MAX_POSITIONS, "v12Gross": V12_GROSS_CAP, "penguGross": PENGU_MAX_GROSS, "penguNewLongGross": V68_NEW_LONG_GROSS_CAP, "v64ReservedGross": V68_RESERVE_V64_GROSS, "cryptoGross": CRYPTO_GROSS_CAP, "stockGross": STOCK_GROSS_CAP, "totalGross": TOTAL_GROSS_CAP}}'
    s = one(s, gross_old, gross_new, 'gross verification')

    s = one(s,
        '    parser.add_argument("--pengu-ledger", default=".research-state/current-top2-dca/pengu-v2-ledger.json")',
        '    parser.add_argument("--pengu-ledger", default=".research-state/current-top2-dca/pengu-v2-ledger.json")\n    parser.add_argument("--pengu-new-long-ledger", required=True)',
        'new Long CLI')
    s = one(s,
        '    pengu = load_json(Path(args.pengu_ledger))',
        '    pengu = load_json(Path(args.pengu_ledger))\n    pengu_new_long = load_json(Path(args.pengu_new_long_ledger))',
        'new Long loader')
    s = one(s,
        '    if {k: pengu.get("period", {}).get(k) for k in expected_period} != expected_period:\n        raise RuntimeError(f"Unexpected PENGU period: {pengu.get(\'period\')}")',
        '    if {k: pengu.get("period", {}).get(k) for k in expected_period} != expected_period:\n        raise RuntimeError(f"Unexpected PENGU period: {pengu.get(\'period\')}")\n    if {k: pengu_new_long.get("period", {}).get(k) for k in expected_period} != expected_period:\n        raise RuntimeError(f"Unexpected PENGU new Long period: {pengu_new_long.get(\'period\')}")',
        'new Long period')
    s = one(s,
        '    if pengu.get("strategyId") != "PENGU_DUAL_LS_V2_FINAL":\n        raise RuntimeError("Unexpected PENGU strategy id")',
        '    if pengu.get("strategyId") != "PENGU_DUAL_LS_V2_FINAL":\n        raise RuntimeError("Unexpected PENGU strategy id")\n    if pengu_new_long.get("strategyId") != "PENGU_V68_NEW_LONG_SLEEVE":\n        raise RuntimeError("Unexpected PENGU V68 new Long strategy id")',
        'new Long strategy id')
    s = one(s,
        '        results[scenario] = simulate(v12["modes"][mode]["trades"], pengu["modes"][mode]["trades"], stock_mode["v11"], stock_mode["v50"], finite(stock_mode["stockCostBps"]))',
        '        results[scenario] = simulate(v12["modes"][mode]["trades"], pengu["modes"][mode]["trades"], pengu_new_long["modes"][mode]["trades"], stock_mode["v11"], stock_mode["v50"], finite(stock_mode["stockCostBps"]))',
        'simulate call')
    s = one(s,
        '        checks[f"{scenario}_penguGross"] = gross["entryTimeMaxPenguGross"] <= PENGU_MAX_GROSS + 1e-9',
        '        checks[f"{scenario}_penguGross"] = gross["entryTimeMaxPenguGross"] <= PENGU_MAX_GROSS + 1e-9\n        checks[f"{scenario}_penguNewLongGross"] = gross["entryTimeMaxPenguNewLongGross"] <= V68_NEW_LONG_GROSS_CAP + 1e-9',
        'new Long gross check')

    # Record V68 architecture and source metrics without changing the original safety contract.
    s = one(s,
        '"entryPriority": ["V52", "PENGU_DUAL_LS_V2", "V12"]',
        '"entryPriority": ["V52", "PENGU_DUAL_LS_V2", "V12", "PENGU_V68_NEW_LONG_SLEEVE"], "v68NewLongGrossCap": V68_NEW_LONG_GROSS_CAP, "v68V64ReservedGross": V68_RESERVE_V64_GROSS',
        'architecture metadata')
    s = one(s,
        '"penguNormalSourceMetrics": pengu["modes"]["normal"]["metrics"]',
        '"penguNormalSourceMetrics": pengu["modes"]["normal"]["metrics"], "penguV68NewLongNormalSourceMetrics": pengu_new_long["modes"]["normal"]["metrics"]',
        'data metadata')

    path.write_text(s, encoding='utf-8')
    print(f'PATCHED_V68_DUAL_PENGU_DCA={path} bytes={path.stat().st_size}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
