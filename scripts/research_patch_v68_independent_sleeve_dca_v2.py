from pathlib import Path

TARGET = Path('scripts/.pengu_v68_1y_dca.py')
src = TARGET.read_text()


def once(old: str, new: str, label: str) -> None:
    global src
    count = src.count(old)
    if count != 1:
        raise SystemExit(f'V68 DCA v2 marker {label} count={count}')
    src = src.replace(old, new, 1)

# This patch runs AFTER research_patch_latest_v56_2y_dca.py, so it targets
# the latest 1Y contract (crypto cap 1.5x, PENGU core cap 0.9375x).
assert 'CRYPTO_GROSS_CAP = 1.5' in src
assert 'TOTAL_GROSS_CAP = 2.5' in src

once(
    'PENGU_MAX_GROSS = 0.9375\n',
    'PENGU_MAX_GROSS = 0.9375\nPENGU_NEW_LONG_MAX_GROSS = 0.375\nMATERIAL_GAIN_MULTIPLE = 1.05  # materialIntegratedGain gate\n',
    'gross constants',
)
once(
    'ENTRY_PRIORITY = {"STOCK_ENTRY": 1, "PENGU_ENTRY": 2, "V12_ENTRY": 3}',
    'ENTRY_PRIORITY = {"STOCK_ENTRY": 1, "PENGU_CORE_ENTRY": 2, "PENGU_NEW_ENTRY": 3, "V12_ENTRY": 4}',
    'priority',
)
once(
    'def simulate(v12_trades: Sequence[dict], pengu_trades: Sequence[dict], v11_rows: Sequence[dict], v50_rows: Sequence[dict], stock_cost_bps: float) -> dict:',
    'def simulate(v12_trades: Sequence[dict], pengu_trades: Sequence[dict], pengu_new_trades: Sequence[dict], v11_rows: Sequence[dict], v50_rows: Sequence[dict], stock_cost_bps: float) -> dict:',
    'simulate signature',
)
once(
    '''    for trade in pengu_trades:\n        if START_MS <= int(trade["entryTs"]) < END_MS:\n            push(int(trade["entryTs"]), ENTRY_PRIORITY["PENGU_ENTRY"], {"kind": "PENGU_ENTRY", "trade": trade})\n''',
    '''    for trade in pengu_trades:\n        if START_MS <= int(trade["entryTs"]) < END_MS:\n            push(int(trade["entryTs"]), ENTRY_PRIORITY["PENGU_CORE_ENTRY"], {"kind": "PENGU_CORE_ENTRY", "trade": trade})\n    for trade in pengu_new_trades:\n        if START_MS <= int(trade["entryTs"]) < END_MS:\n            push(int(trade["entryTs"]), ENTRY_PRIORITY["PENGU_NEW_ENTRY"], {"kind": "PENGU_NEW_ENTRY", "trade": trade})\n''',
    'timeline',
)
once(
    '    active_pengu: dict | None = None\n',
    '    active_pengu_core: dict | None = None\n    active_pengu_new: dict | None = None\n',
    'active slots',
)
once(
    '''    def pengu_gross() -> float:\n        return entry_allocated_gross(active_pengu)\n''',
    '''    def pengu_gross() -> float:\n        return entry_allocated_gross(active_pengu_core) + entry_allocated_gross(active_pengu_new)\n''',
    'gross helper',
)
once(
    '        pg = entry_allocated_gross(active_pengu)\n',
    '        pg = entry_allocated_gross(active_pengu_core) + entry_allocated_gross(active_pengu_new)\n',
    'gross observe',
)
once(
    '        if sleeve in ("V12", "PENGU_DUAL_LS_V2"):\n',
    '        if sleeve in ("V12", "PENGU_DUAL_LS_V2", "PENGU_NEW_LONG"):\n',
    'daily loss sleeve',
)

start = src.index('        if kind == "PENGU_ENTRY":')
end = src.index('        if kind == "STOCK_ENTRY":', start)
block = '''        if kind == "PENGU_CORE_ENTRY":\n            trade = item["trade"]\n            if crypto_latched:\n                stats["PENGU_CORE_ENTRY_DAILY_LOSS_BLOCKED"] += 1\n                continue\n            if active_pengu_core is not None:\n                stats["PENGU_CORE_SLOT_OCCUPIED"] += 1\n                continue\n            requested = min(PENGU_MAX_GROSS, max(0.0, finite(trade.get("requestedGross"))))\n            vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()\n            available = min(PENGU_MAX_GROSS, max(0.0, CRYPTO_GROSS_CAP - vg - pg), max(0.0, TOTAL_GROSS_CAP - vg - pg - sg))\n            allocated = min(requested, available)\n            if allocated <= 1e-12:\n                stats["PENGU_CORE_CAPACITY_BLOCKED"] += 1\n                continue\n            active_pengu_core = {"strategy": "PENGU_DUAL_LS_V2", "symbol": "PENGUUSDT", "entryNotional": equity * allocated, "allocatedGrossAtEntry": allocated, "requestedGross": requested, "netUnitReturn": finite(trade.get("netUnitReturn")), "exitReason": trade.get("exitReason")}\n            if allocated < requested - 1e-12:\n                stats["PENGU_CORE_GROSS_SCALED"] += 1\n            push(int(trade["exitTs"]), 0, {"kind": "PENGU_CORE_EXIT"})\n            stats["PENGU_CORE_ENTERED"] += 1\n            observe_entry()\n            continue\n        if kind == "PENGU_CORE_EXIT":\n            if active_pengu_core is None:\n                stats["PENGU_CORE_EXIT_WITHOUT_ACTIVE"] += 1\n            else:\n                position = active_pengu_core\n                active_pengu_core = None\n                realize(ts, position, "PENGU_DUAL_LS_V2")\n                stats["PENGU_CORE_EXITED"] += 1\n            continue\n        if kind == "PENGU_NEW_ENTRY":\n            trade = item["trade"]\n            if crypto_latched:\n                stats["PENGU_NEW_ENTRY_DAILY_LOSS_BLOCKED"] += 1\n                continue\n            if active_pengu_new is not None:\n                stats["PENGU_NEW_SLOT_OCCUPIED"] += 1\n                continue\n            requested = min(PENGU_NEW_LONG_MAX_GROSS, max(0.0, finite(trade.get("requestedGross"))))\n            vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()\n            core_reserve = PENGU_MAX_GROSS if active_pengu_core is None else 0.0\n            available = min(PENGU_NEW_LONG_MAX_GROSS, max(0.0, CRYPTO_GROSS_CAP - vg - pg - core_reserve), max(0.0, TOTAL_GROSS_CAP - vg - pg - sg - core_reserve))\n            allocated = min(requested, available)\n            if allocated <= 1e-12:\n                stats["PENGU_NEW_CAPACITY_BLOCKED"] += 1\n                continue\n            active_pengu_new = {"strategy": "PENGU_NEW_LONG", "symbol": "PENGUUSDT", "entryNotional": equity * allocated, "allocatedGrossAtEntry": allocated, "requestedGross": requested, "netUnitReturn": finite(trade.get("netUnitReturn")), "exitReason": trade.get("exitReason")}\n            if allocated < requested - 1e-12:\n                stats["PENGU_NEW_GROSS_SCALED"] += 1\n            push(int(trade["exitTs"]), 0, {"kind": "PENGU_NEW_EXIT"})\n            stats["PENGU_NEW_ENTERED"] += 1\n            observe_entry()\n            continue\n        if kind == "PENGU_NEW_EXIT":\n            if active_pengu_new is None:\n                stats["PENGU_NEW_EXIT_WITHOUT_ACTIVE"] += 1\n            else:\n                position = active_pengu_new\n                active_pengu_new = None\n                realize(ts, position, "PENGU_NEW_LONG")\n                stats["PENGU_NEW_EXITED"] += 1\n            continue\n'''
src = src[:start] + block + src[end:]

once('    if active_v12 or active_pengu or active_stock:\n', '    if active_v12 or active_pengu_core or active_pengu_new or active_stock:\n', 'open positions')
once('    for sleeve in ("V12", "PENGU_DUAL_LS_V2", "V52"):\n', '    for sleeve in ("V12", "PENGU_DUAL_LS_V2", "PENGU_NEW_LONG", "V52"):\n', 'report sleeves')
once('"penguGross": PENGU_MAX_GROSS, "cryptoGross": CRYPTO_GROSS_CAP,', '"penguGross": PENGU_MAX_GROSS + PENGU_NEW_LONG_MAX_GROSS, "penguCoreGross": PENGU_MAX_GROSS, "penguNewLongGross": PENGU_NEW_LONG_MAX_GROSS, "cryptoGross": CRYPTO_GROSS_CAP,', 'verification limits')
once('    parser.add_argument("--pengu-ledger", default=".research-state/current-top2-dca/pengu-v2-ledger.json")\n', '    parser.add_argument("--pengu-ledger", default=".research-state/current-top2-dca/pengu-v2-ledger.json")\n    parser.add_argument("--pengu-new-long-ledger", default=None)\n', 'new arg')
once('    pengu = load_json(Path(args.pengu_ledger))\n', '    pengu = load_json(Path(args.pengu_ledger))\n    pengu_new = load_json(Path(args.pengu_new_long_ledger)) if args.pengu_new_long_ledger else None\n', 'new load')
once(
    '    if {k: v12.get("period", {}).get(k) for k in expected_period} != expected_period:\n',
    '    if pengu_new is not None and {k: pengu_new.get("period", {}).get(k) for k in expected_period} != expected_period:\n        raise RuntimeError(f"Unexpected PENGU new Long period: {pengu_new.get(\'period\')}")\n    if pengu_new is not None and pengu_new.get("strategyId") != "PENGU_V68_NEW_LONG_SLEEVE":\n        raise RuntimeError("Unexpected PENGU new Long strategy id")\n    if {k: v12.get("period", {}).get(k) for k in expected_period} != expected_period:\n',
    'new validation',
)
once(
    '        stock_mode = stock_payload["modes"][mode]\n        results[scenario] = simulate(v12["modes"][mode]["trades"], pengu["modes"][mode]["trades"], stock_mode["v11"], stock_mode["v50"], finite(stock_mode["stockCostBps"]))\n',
    '        stock_mode = stock_payload["modes"][mode]\n        new_trades = [] if pengu_new is None else pengu_new["modes"][mode]["trades"]\n        results[scenario] = simulate(v12["modes"][mode]["trades"], pengu["modes"][mode]["trades"], new_trades, stock_mode["v11"], stock_mode["v50"], finite(stock_mode["stockCostBps"]))\n',
    'scenario simulate',
)
once('        checks[f"{scenario}_penguGross"] = gross["entryTimeMaxPenguGross"] <= PENGU_MAX_GROSS + 1e-9\n', '        checks[f"{scenario}_penguGross"] = gross["entryTimeMaxPenguGross"] <= PENGU_MAX_GROSS + PENGU_NEW_LONG_MAX_GROSS + 1e-9\n', 'gross check')
once('"penguGrossCap": PENGU_MAX_GROSS, "sharedCryptoGrossCap": CRYPTO_GROSS_CAP,', '"penguGrossCap": PENGU_MAX_GROSS, "penguNewLongGrossCap": PENGU_NEW_LONG_MAX_GROSS, "sharedCryptoGrossCap": CRYPTO_GROSS_CAP,', 'architecture cap')
once('"entryPriority": ["V52", "PENGU_DUAL_LS_V2", "V12"],', '"entryPriority": ["V52", "PENGU_DUAL_LS_V2", "PENGU_NEW_LONG", "V12"],', 'architecture priority')
once('"penguData": pengu.get("data")}', '"penguData": pengu.get("data"), "penguNewLongNormalSourceMetrics": None if pengu_new is None else pengu_new["modes"]["normal"]["metrics"]}', 'data new sleeve')

src += '\n# V68_INDEPENDENT_SLEEVE: materialIntegratedGain requires MATERIAL_GAIN_MULTIPLE (1.05).\n'
TARGET.write_text(src)
print(f'PATCHED_V68_DCA_V2={TARGET} bytes={TARGET.stat().st_size}')
