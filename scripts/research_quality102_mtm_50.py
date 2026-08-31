from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

from research_quality102_gross_cap_sweep import capture_grosssafe_generated, patch_supplement_cap, FROZEN_SUPPLEMENT

CAP = 0.50
GENERATED = Path('scripts/.research_quality102_mtm_50.generated.py')

# Every supplement position that was resized in the verified 50% zero-PnL run is a short.
# Fail closed if the MTM run ever needs to resize an unlisted entry instead of guessing its side.
KNOWN_RESIZE_SIDES = {
    1760000400000: -1,  # FET 2025-10-09 09:00Z
    1761652800000: -1,  # TAO 2025-10-28 12:00Z
    1762966800000: -1,  # SOL 2025-11-12 17:00Z
    1763499600000: -1,  # SUI 2025-11-18 21:00Z
    1776862800000: -1,  # UNI 2026-04-22 13:00Z
    1779847200000: -1,  # SEI 2026-05-27 02:00Z
}

# Entry-price evidence from the recovered HIGH_VOL source CSVs. These are used only
# to prove the Binance USD-M 1m archive is the same price convention at entry.
KNOWN_HIGH_VOL_ENTRY_PRICES = {
    ('TAO', 1761652800000): 443.74,
    ('SUI', 1763499600000): 1.68010,
    ('SEI', 1779847200000): 0.06703,
}

# S34 rows are time exits, so entry/exit 1m opens can be checked against their
# frozen full-trade gross return reconstructed from net + fees + funding.
KNOWN_S34_TIME_EXIT_ENTRIES = {
    1760000400000,  # FET
    1762966800000,  # SOL
    1776862800000,  # UNI
}


def partial_net_return(*, side: int, entry_price: float, mark_price: float,
                       elapsed_hours: float, fee_per_side: float, funding_per_day: float) -> float:
    if entry_price <= 0 or mark_price <= 0:
        raise ValueError('prices must be positive')
    if side not in (-1, 1):
        raise ValueError('side must be -1 or 1')
    gross = (mark_price / entry_price - 1.0) if side == 1 else (1.0 - mark_price / entry_price)
    return gross - 2.0 * fee_per_side - (max(0.0, elapsed_hours) / 24.0) * funding_per_day


def remaining_limit(*, equity: float, old_supp_notional: float, mark_net_return: float,
                    existing_base_notional: float, cap: float) -> float:
    # Post-admission same-timestamp semantics: the higher-priority base order has
    # already been admitted. Solve for the largest remaining Q102 notional R such
    # that (B + R) / (E + (O-R)*r) <= cap after the trimmed amount realizes MTM PnL.
    old = max(0.0, old_supp_notional)
    c = max(0.0, cap)
    denom = 1.0 + c * mark_net_return
    if old <= 0.0 or denom <= 1e-12:
        return 0.0
    limit = (c * (equity + old * mark_net_return) - existing_base_notional) / denom
    return max(0.0, min(old, limit))


def solve_remaining_notional(*, equity: float, old_supp_notional: float, mark_net_return: float,
                             total_base_notional: float, crypto_base_notional: float,
                             total_cap: float = 2.5, crypto_cap: float = 2.0) -> float:
    return min(
        max(0.0, old_supp_notional),
        remaining_limit(equity=equity, old_supp_notional=old_supp_notional,
                        mark_net_return=mark_net_return, existing_base_notional=total_base_notional,
                        cap=total_cap),
        remaining_limit(equity=equity, old_supp_notional=old_supp_notional,
                        mark_net_return=mark_net_return, existing_base_notional=crypto_base_notional,
                        cap=crypto_cap),
    )


def patch_mtm_engine(source: str) -> str:
    if 'ZERO_PNL_ON_TRIMMED_NOTIONAL' not in source:
        raise RuntimeError('expected zero-PnL gross-safe source before MTM patch')

    source = source.replace('import math\n', 'import math\nimport io\nimport urllib.request\nimport zipfile\n', 1)

    helper = r'''
QUALITY102_RESIZE_SIDES = {
    1760000400000: -1,
    1761652800000: -1,
    1762966800000: -1,
    1763499600000: -1,
    1776862800000: -1,
    1779847200000: -1,
}
QUALITY102_HV_ENTRY_PRICES = {
    ("TAO", 1761652800000): 443.74,
    ("SUI", 1763499600000): 1.68010,
    ("SEI", 1779847200000): 0.06703,
}
QUALITY102_S34_TIME_EXIT_ENTRIES = {1760000400000, 1762966800000, 1776862800000}
_QUALITY102_KLINE_CACHE = {}

def quality102_exchange_symbol(symbol: str) -> str:
    return {"BONK": "1000BONKUSDT", "PEPE": "1000PEPEUSDT"}.get(symbol, f"{symbol}USDT")

def quality102_binance_vision_1m_open(symbol: str, ts: int) -> float:
    if ts % 60000 != 0:
        raise RuntimeError(f"Quality102 MTM timestamp is not minute aligned: {ts}")
    key = (symbol, ts)
    if key in _QUALITY102_KLINE_CACHE:
        return _QUALITY102_KLINE_CACHE[key]
    when = dt.datetime.fromtimestamp(ts / 1000, tz=UTC)
    ex = quality102_exchange_symbol(symbol)
    day = when.strftime("%Y-%m-%d")
    url = f"https://data.binance.vision/data/futures/um/daily/klines/{ex}/1m/{ex}-1m-{day}.zip"
    req = urllib.request.Request(url, headers={"User-Agent": "quality102-research-mtm/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read()
    except Exception as exc:
        raise RuntimeError(f"Quality102 MTM price download failed {url}: {exc}") from exc
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith('.csv')]
            if len(names) != 1:
                raise RuntimeError(f"unexpected Binance archive members: {names}")
            text = zf.read(names[0]).decode('utf-8')
    except Exception as exc:
        raise RuntimeError(f"Quality102 MTM price archive decode failed {url}: {exc}") from exc
    found = None
    for row in csv.reader(io.StringIO(text)):
        if not row or not row[0].lstrip('-').isdigit():
            continue
        raw_ts = int(row[0])
        open_ms = raw_ts // 1000 if raw_ts > 100_000_000_000_000 else raw_ts
        if open_ms == ts:
            found = float(row[1])
            break
    if found is None or found <= 0:
        raise RuntimeError(f"exact Binance 1m open missing for {symbol} at {ts} from {url}")
    _QUALITY102_KLINE_CACHE[key] = found
    return found

def quality102_partial_net_return(side: int, entry_price: float, mark_price: float, elapsed_hours: float, fee_per_side: float, funding_per_day: float) -> float:
    if side not in (-1, 1) or entry_price <= 0 or mark_price <= 0:
        raise RuntimeError("invalid Quality102 MTM return inputs")
    gross = (mark_price / entry_price - 1.0) if side == 1 else (1.0 - mark_price / entry_price)
    return gross - 2.0 * fee_per_side - (max(0.0, elapsed_hours) / 24.0) * funding_per_day

def quality102_remaining_limit(equity: float, old: float, mark_return: float, base_notional: float, cap: float) -> float:
    denom = 1.0 + cap * mark_return
    if old <= 0 or denom <= 1e-12:
        return 0.0
    return max(0.0, min(old, (cap * (equity + old * mark_return) - base_notional) / denom))

def quality102_source_evidence(position: dict, entry_price: float) -> dict:
    symbol = str(position.get("symbol"))
    entry_ts = int(position.get("entryTs"))
    exit_ts = int(position.get("exitTs"))
    key = (symbol, entry_ts)
    evidence = {"entryPrice": entry_price, "entrySource": "BINANCE_VISION_USDM_1M_OPEN"}
    if key in QUALITY102_HV_ENTRY_PRICES:
        expected = float(QUALITY102_HV_ENTRY_PRICES[key])
        tol = max(1e-10, abs(expected) * 1e-8)
        if abs(entry_price - expected) > tol:
            raise RuntimeError(f"HIGH_VOL entry source mismatch {key}: binance={entry_price} expected={expected}")
        evidence["entrySourceCrossCheck"] = {"kind": "HIGH_VOL_SOURCE_ENTRY_PRICE", "expected": expected, "absError": abs(entry_price - expected)}
    elif entry_ts in QUALITY102_S34_TIME_EXIT_ENTRIES:
        exit_price = quality102_binance_vision_1m_open(symbol, exit_ts)
        side = int(position.get("side"))
        observed_gross = (exit_price / entry_price - 1.0) if side == 1 else (1.0 - exit_price / entry_price)
        elapsed_hours = max(0.0, (exit_ts - entry_ts) / 3600000.0)
        expected_gross = finite(position.get("netUnitReturn")) + 2.0 * finite(position.get("feePerSide")) + (elapsed_hours / 24.0) * finite(position.get("fundingPerDay"))
        if abs(observed_gross - expected_gross) > 2e-6:
            raise RuntimeError(f"S34 source-price mismatch {key}: observedGross={observed_gross} expectedGross={expected_gross}")
        evidence["entrySourceCrossCheck"] = {"kind": "S34_FROZEN_GROSS_REPLAY", "exitPrice": exit_price, "observedGross": observed_gross, "expectedGross": expected_gross, "absError": abs(observed_gross - expected_gross)}
    else:
        raise RuntimeError(f"unapproved Quality102 MTM resize entry: {key}")
    return evidence
'''
    marker = 'def finite(value: Any, fallback: float = 0.0) -> float:\n'
    idx = source.find(marker)
    if idx < 0:
        raise RuntimeError('finite marker missing for MTM helper injection')
    # Insert helpers immediately before finite; they only execute later, after finite exists.
    source = source[:idx] + helper + '\n' + source[idx:]

    # Carry scenario cost parameters and known side into the frozen supplement trade rows.
    needle = '            "netUnitReturn": finite(row[supp_col]),\n'
    repl = ('            "side": QUALITY102_RESIZE_SIDES.get(iso_ms(row["entry"]), 0),\n'
            '            "feePerSide": 0.0006 if scenario == "NORMAL" else 0.0010,\n'
            '            "fundingPerDay": 0.0002 if scenario == "NORMAL" else 0.0005,\n'
            '            "netUnitReturn": finite(row[supp_col]),\n')
    if needle not in source:
        raise RuntimeError('supplement row marker missing')
    source = source.replace(needle, repl, 1)

    needle = '                "netUnitReturn": finite(trade.get("netUnitReturn")),\n'
    repl = ('                "side": int(trade.get("side", 0)),\n'
            '                "feePerSide": finite(trade.get("feePerSide")),\n'
            '                "fundingPerDay": finite(trade.get("fundingPerDay")),\n'
            '                "netUnitReturn": finite(trade.get("netUnitReturn")),\n')
    if needle not in source:
        raise RuntimeError('active supplement metadata marker missing')
    source = source.replace(needle, repl, 1)

    new_observe = r'''    def observe_entry(entered_kind: str, ts: int) -> None:
        nonlocal equity, twr_index, twr_peak, max_drawdown, max_v12_positions, max_entry_v12_gross, max_entry_pengu_gross, max_entry_stock_gross, max_entry_crypto_gross, max_entry_total_gross, max_entry_supp_gross
        vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
        if entered_kind != "SUPP_ENTRY" and active_supp is not None:
            old_notional = finite(active_supp.get("entryNotional"))
            if old_notional > 1e-9:
                entry_ts = int(active_supp.get("entryTs"))
                side = int(active_supp.get("side", 0))
                expected_side = QUALITY102_RESIZE_SIDES.get(entry_ts)
                if expected_side is None or side != expected_side:
                    raise RuntimeError(f"Quality102 MTM side evidence missing/mismatch entryTs={entry_ts} side={side} expected={expected_side}")
                entry_price = quality102_binance_vision_1m_open(str(active_supp.get("symbol")), entry_ts)
                evidence = quality102_source_evidence(active_supp, entry_price)
                mark_price = quality102_binance_vision_1m_open(str(active_supp.get("symbol")), ts)
                elapsed_hours = max(0.0, (ts - entry_ts) / 3600000.0)
                mark_return = quality102_partial_net_return(side, entry_price, mark_price, elapsed_hours, finite(active_supp.get("feePerSide")), finite(active_supp.get("fundingPerDay")))
                total_base_notional = sum(finite(p.get("entryNotional")) for p in active_v12.values()) + finite(active_pengu.get("entryNotional") if active_pengu else 0.0) + sum(finite(p.get("entryNotional")) for p in active_stock.values())
                crypto_base_notional = sum(finite(p.get("entryNotional")) for p in active_v12.values()) + finite(active_pengu.get("entryNotional") if active_pengu else 0.0)
                total_limit = quality102_remaining_limit(equity, old_notional, mark_return, total_base_notional, TOTAL_GROSS_CAP)
                crypto_limit = quality102_remaining_limit(equity, old_notional, mark_return, crypto_base_notional, CRYPTO_GROSS_CAP)
                new_notional = min(old_notional, total_limit, crypto_limit)
                if new_notional < old_notional - 1e-9:
                    trimmed = old_notional - new_notional
                    before = max(0.001, equity)
                    pnl = trimmed * mark_return
                    event_return = pnl / before
                    equity = max(0.001, equity + pnl)
                    twr_index *= max(0.000001, 1.0 + event_return)
                    twr_peak = max(twr_peak, twr_index)
                    max_drawdown = min(max_drawdown, twr_index / twr_peak - 1.0)
                    month_key = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).strftime("%Y-%m")
                    monthly_event_returns[month_key].append(event_return)
                    active_supp["entryNotional"] = max(0.0, new_notional)
                    events.append({"ts": ts, "entryTs": entry_ts, "exitTs": ts, "strategy": "SUPPLEMENT_QUALITY102_TRIM", "sleeve": "SUPPLEMENT_QUALITY102", "symbol": active_supp.get("symbol"), "layer": active_supp.get("layer"), "pnlJpy": pnl, "eventReturn": event_return, "allocatedGrossAtEntry": finite(active_supp.get("allocatedGrossAtEntry")), "requestedGross": finite(active_supp.get("requestedGross")), "exitReason": "GROSS_RESIZE_MTM"})
                    gross_resizes.append({"ts": ts, "supplementSymbol": active_supp.get("symbol"), "supplementEntryTs": entry_ts, "supplementExitTs": active_supp.get("exitTs"), "enteredKind": entered_kind, "notionalBeforeJpy": old_notional, "notionalAfterJpy": max(0.0, new_notional), "trimmedNotionalJpy": trimmed, "trimPnlJpy": pnl, "markNetUnitReturn": mark_return, "entryPrice": entry_price, "markPrice": mark_price, "priceSource": "BINANCE_VISION_USDM_1M_OPEN", "sourceEvidence": evidence, "constraintBinding": "CRYPTO" if crypto_limit <= total_limit + 1e-12 else "TOTAL"})
                    stats["SUPPLEMENT_GROSS_RESIZED"] += 1
                    stats["SUPPLEMENT_MTM_TRIM_EXECUTIONS"] += 1
        vg, pg, sg, ug = v12_gross(), pengu_gross(), stock_gross(), supp_gross()
        max_v12_positions = max(max_v12_positions, len(active_v12))
        if entered_kind == "V12_ENTRY": max_entry_v12_gross = max(max_entry_v12_gross, vg)
        elif entered_kind == "PENGU_ENTRY": max_entry_pengu_gross = max(max_entry_pengu_gross, pg)
        elif entered_kind == "STOCK_ENTRY": max_entry_stock_gross = max(max_entry_stock_gross, sg)
        elif entered_kind == "SUPP_ENTRY": max_entry_supp_gross = max(max_entry_supp_gross, ug)
        max_entry_crypto_gross = max(max_entry_crypto_gross, vg + pg + ug)
        total = vg + pg + sg + ug
        crypto = vg + pg + ug
        max_entry_total_gross = max(max_entry_total_gross, total)
        if (total > TOTAL_GROSS_CAP + 1e-9 or crypto > CRYPTO_GROSS_CAP + 1e-9) and active_supp is not None:
            gross_conflicts.append({"ts": ts, "supplementSymbol": active_supp.get("symbol"), "supplementEntryTs": active_supp.get("entryTs"), "supplementExitTs": active_supp.get("exitTs"), "enteredKind": entered_kind, "totalGross": total, "cryptoGross": crypto})

'''
    source, n = re.subn(r'    def observe_entry\(entered_kind: str, ts: int\) -> None:\n.*?(?=    def reset_day\(ts: int\) -> None:)', new_observe, source, count=1, flags=re.S)
    if n != 1:
        raise RuntimeError('MTM observe patch failed')

    source = source.replace('"resizePnlAccounting": "ZERO_PNL_ON_TRIMMED_NOTIONAL"', '"resizePnlAccounting": "MARK_TO_MARKET_BINANCE_VISION_USDM_1M_OPEN"', 1)
    source = source.replace('"entryPolicy": "BASE_IDLE_ONE_SLOT_BASE_PRIORITY_RESIDUAL_GROSS_SHRINK"', '"entryPolicy": "BASE_IDLE_ONE_SLOT_BASE_PRIORITY_CRYPTO_AND_TOTAL_RESIDUAL_GROSS_SHRINK"', 1)
    if 'ZERO_PNL_ON_TRIMMED_NOTIONAL' in source:
        raise RuntimeError('zero-PnL accounting marker survived MTM patch')
    return source


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--stock-cache-dir', required=True)
    ap.add_argument('--v12-ledger', required=True)
    ap.add_argument('--pengu-ledger', required=True)
    ap.add_argument('--output-dir', required=True)
    args = ap.parse_args()

    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    base_args = [
        '--stock-cache-dir', args.stock_cache_dir,
        '--v12-ledger', args.v12_ledger,
        '--pengu-ledger', args.pengu_ledger,
        '--output-dir', str(out / '_capture'),
    ]
    source = capture_grosssafe_generated(base_args)
    source = patch_supplement_cap(source, CAP)
    source = patch_mtm_engine(source)
    GENERATED.write_text(source, encoding='utf-8')
    try:
        subprocess.run([
            sys.executable, str(GENERATED),
            '--stock-cache-dir', args.stock_cache_dir,
            '--v12-ledger', args.v12_ledger,
            '--pengu-ledger', args.pengu_ledger,
            '--supplement-csv', str(FROZEN_SUPPLEMENT),
            '--output-dir', str(out),
        ], check=True)
    finally:
        GENERATED.unlink(missing_ok=True)

    result_path = out / 'result.json'
    p = json.loads(result_path.read_text(encoding='utf-8'))
    if p.get('status') != 'PASS_RESEARCH_ONLY':
        raise RuntimeError(f'MTM engine contract failed: {p.get("checks")}')
    modes = {}
    for mode in ('NORMAL', 'SEVERE'):
        r = p['results'][mode]
        g = r['grossVerification']
        resizes = g.get('supplementGrossResizes', [])
        if g['entryTimeMaxTotalGross'] > 2.5 + 1e-9:
            raise RuntimeError(f'{mode} total gross violation: {g}')
        if g['entryTimeMaxCryptoGross'] > 2.0 + 1e-9:
            raise RuntimeError(f'{mode} crypto gross violation: {g}')
        if g['entryTimeMaxSupplementGross'] > CAP + 1e-9:
            raise RuntimeError(f'{mode} supplement gross violation: {g}')
        if g.get('supplementGrossConflicts'):
            raise RuntimeError(f'{mode} gross conflict: {g["supplementGrossConflicts"]}')
        if any(not bool(v) for k, v in p.get('checks', {}).items() if k.startswith(mode + '_baseParity_')):
            raise RuntimeError(f'{mode} base parity failed')
        trim_pnl = sum(float(x.get('trimPnlJpy', 0.0)) for x in resizes)
        modes[mode] = {
            'endingAssetJpy': r['endingAssetJpy'],
            'maxDrawdownPctClosedEventTwr': r['maxDrawdownPctClosedEventTwr'],
            'profitFactorRealizedExecutions': r['profitFactor'],
            'executionCountIncludingMtmTrims': r['trades'],
            'mtmTrimExecutionCount': len(resizes),
            'episodeCountExcludingMtmTrims': r['trades'] - len(resizes),
            'mtmTrimPnlJpy': trim_pnl,
            'maxTotalGross': g['entryTimeMaxTotalGross'],
            'maxCryptoGrossIncludingQuality102': g['entryTimeMaxCryptoGross'],
            'maxSupplementGross': g['entryTimeMaxSupplementGross'],
            'grossConflictCount': len(g.get('supplementGrossConflicts', [])),
            'resizes': resizes,
        }
    summary = {
        'schema': 'quality102-mtm-50/v1',
        'cap': CAP,
        'resizePnlAccounting': 'MARK_TO_MARKET_BINANCE_VISION_USDM_1M_OPEN',
        'grossPolicy': 'BASE_PRIORITY_CRYPTO_AND_TOTAL_RESIDUAL_GROSS_SHRINK',
        'sourceValidation': 'HIGH_VOL_ENTRY_PRICE_AND_S34_FROZEN_GROSS_FAIL_CLOSED',
        'modes': modes,
        'safety': {'mode': 'RESEARCH_ONLY', 'ordersSent': False, 'liveChanged': False, 'vpsChanged': False, 'productionChanged': False},
    }
    (out / 'mtm-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = [
        '# Quality102 50% exact MTM resize backtest', '',
        f'- Accounting: {summary["resizePnlAccounting"]}',
        f'- Gross policy: {summary["grossPolicy"]}',
    ]
    for mode in ('NORMAL', 'SEVERE'):
        m = modes[mode]
        lines += ['', f'## {mode}', f'- Ending asset: JPY {m["endingAssetJpy"]:.2f}', f'- DD: {m["maxDrawdownPctClosedEventTwr"]:.4f}%', f'- PF (realized executions): {m["profitFactorRealizedExecutions"]}', f'- MTM trim executions: {m["mtmTrimExecutionCount"]}', f'- MTM trim PnL: JPY {m["mtmTrimPnlJpy"]:.2f}', f'- Max total Gross: {m["maxTotalGross"]:.6f}x', f'- Max crypto Gross incl. Quality102: {m["maxCryptoGrossIncludingQuality102"]:.6f}x']
    lines += ['', 'Research only. No LIVE/VPS/production/order changes.']
    (out / 'mtm-report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
