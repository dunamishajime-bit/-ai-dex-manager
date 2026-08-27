from pathlib import Path
import subprocess
import sys

src_path=Path('scripts/research_current_top2_pengu_v52_dca.py')
out_path=Path('scripts/.research_latest_v8_dca_1y.generated.py')
s=src_path.read_text()
replacements=[
    ('START = dt.datetime(2025, 8, 1, tzinfo=UTC)','START = dt.datetime(2025, 8, 10, tzinfo=UTC)'),
    ('END = dt.datetime(2026, 8, 1, tzinfo=UTC)','END = dt.datetime(2026, 8, 10, tzinfo=UTC)'),
    ('expected_period = {"startInclusive": "2025-08-01T00:00:00.000Z", "endExclusive": "2026-08-01T00:00:00.000Z"}','expected_period = {"startInclusive": "2025-08-10T00:00:00.000Z", "endExclusive": "2026-08-10T00:00:00.000Z"}'),
    ('if pengu.get("strategyId") != "PENGU_DUAL_LS_V2_FINAL":','if pengu.get("strategyId") != "PENGU_DUAL_LS_V2_RECOVERY_V8":'),
    ('120_000.0','130_000.0'),
    ('"schema": "current-v12-top2-pengu-v2-v52-dca-1y/v1"','"schema": "latest-v12-top2-pengu-v8-v52-dca-1y/v1"'),
    ('"penguProductionReplay": "PENGU_DUAL_LS_V2_FINAL"','"penguProductionReplay": "PENGU_DUAL_LS_V2_RECOVERY_V8"'),
    ('# Current V12 Top2 + PENGU V2 + V52 — 1Y monthly DCA backtest','# Latest V12 Top2 + PENGU DUAL LS V2 / Recovery V8 + V52 — 1Y monthly DCA backtest'),
    ('- Monthly contribution: JPY 10,000 at each month-start after inception (11 additions; total contributed JPY 120,000)','- Monthly contribution: JPY 10,000 at each month-start after inception (12 additions; total contributed JPY 130,000)'),
    ('- Entry priority: V52 -> PENGU V2 -> V12','- Entry priority: V52 -> PENGU DUAL LS V2 / Recovery V8 -> V12'),
]
for old,new in replacements:
    if old not in s:
        raise SystemExit(f'DCA patch marker missing: {old}')
    s=s.replace(old,new)

old_observe='''    def observe_entry() -> None:
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
'''
new_observe='''    def observe_entry(entered_kind: str) -> None:
        nonlocal max_v12_positions, max_entry_v12_gross, max_entry_pengu_gross, max_entry_stock_gross, max_entry_crypto_gross, max_entry_total_gross
        # Shared caps are checked on the same current-equity basis used by capacity gates.
        # Sleeve caps are audited only when that sleeve itself enters, because a later
        # unrelated realized PnL can mechanically revalue an existing position's gross.
        vg = v12_gross()
        pg = pengu_gross()
        sg = stock_gross()
        max_v12_positions = max(max_v12_positions, len(active_v12))
        if entered_kind == "V12_ENTRY":
            max_entry_v12_gross = max(max_entry_v12_gross, vg)
        elif entered_kind == "PENGU_ENTRY":
            max_entry_pengu_gross = max(max_entry_pengu_gross, pg)
        elif entered_kind == "STOCK_ENTRY":
            max_entry_stock_gross = max(max_entry_stock_gross, sg)
        max_entry_crypto_gross = max(max_entry_crypto_gross, vg + pg)
        max_entry_total_gross = max(max_entry_total_gross, vg + pg + sg)
'''
if old_observe not in s:
    raise SystemExit('DCA gross verification marker missing')
s=s.replace(old_observe,new_observe,1)
if s.count('            observe_entry()') != 3:
    raise SystemExit(f'Unexpected observe_entry call count: {s.count("            observe_entry()") }')
s=s.replace('            observe_entry()','            observe_entry(kind)')

out_path.write_text(s)
try:
    subprocess.run([sys.executable,str(out_path),*sys.argv[1:]],check=True)
finally:
    out_path.unlink(missing_ok=True)
