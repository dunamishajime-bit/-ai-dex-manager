from __future__ import annotations

import argparse
import json
import os
import runpy
import subprocess
import sys
from pathlib import Path

from research_quality102_gross_cap_sweep import patch_supplement_cap

CAPS = (0.35, 0.50)
TRIM_COST_BPS = (0.0, 50.0, 100.0, 200.0, 500.0)
REQUIRED_ADVANTAGE_COST_BPS = (50.0, 100.0)
GROSSSAFE_LAUNCHER = Path('scripts/research_latest_v8_quality102_grosssafe.py')
GENERATED = Path('scripts/.research_latest_v8_quality102_dca_1y.generated.py')
FROZEN_SUPPLEMENT = Path('.research-state/quality102-frozen.csv')
BASE_ROUTING_KEYS = ('V12_ENTERED', 'PENGU_ENTERED', 'V11_EQ_ENTERED', 'V50_POST_OPEN_BASIS_ENTERED')


def capture_grosssafe_generated(base_args: list[str], trim_cost_bps: float) -> str:
    orig_run, orig_unlink, orig_argv = subprocess.run, Path.unlink, list(sys.argv)
    old_cost = os.environ.get('QUALITY102_TRIM_COST_BPS')
    captured: dict[str, list[str]] = {}

    def hold_run(args, *a, **kw):
        argv = list(args) if isinstance(args, (list, tuple)) else None
        if argv and len(argv) >= 2 and Path(str(argv[1])) == GENERATED:
            captured['argv'] = [str(x) for x in argv]
            return subprocess.CompletedProcess(argv, 0)
        return orig_run(args, *a, **kw)

    def hold_unlink(self, *a, **kw):
        return None if Path(self) == GENERATED else orig_unlink(self, *a, **kw)

    try:
        os.environ['QUALITY102_TRIM_COST_BPS'] = format(trim_cost_bps, '.12g')
        subprocess.run, Path.unlink = hold_run, hold_unlink
        sys.argv = [str(GROSSSAFE_LAUNCHER), *base_args]
        runpy.run_path(str(GROSSSAFE_LAUNCHER), run_name='__main__')
    finally:
        subprocess.run, Path.unlink, sys.argv = orig_run, orig_unlink, orig_argv
        if old_cost is None:
            os.environ.pop('QUALITY102_TRIM_COST_BPS', None)
        else:
            os.environ['QUALITY102_TRIM_COST_BPS'] = old_cost

    if not GENERATED.exists() or 'argv' not in captured:
        raise RuntimeError('failed to capture fully gross-safe generated engine')
    source = GENERATED.read_text(encoding='utf-8')
    GENERATED.unlink(missing_ok=True)
    required = (
        'BASE_IDLE_ONE_SLOT_BASE_PRIORITY_TOTAL_AND_CRYPTO_RESIDUAL_SHRINK',
        'TRIMMED_NOTIONAL_X_BPS_CHARGED_ONCE',
        'quality102CountsTowardCryptoGross',
    )
    missing = [marker for marker in required if marker not in source]
    if missing:
        raise RuntimeError(f'captured engine is missing Quality102 50 gross-safe markers: {missing}')
    if not FROZEN_SUPPLEMENT.exists():
        raise RuntimeError(f'frozen Quality102 candidate was not materialized: {FROZEN_SUPPLEMENT}')
    return source


def run_one(source: str, cap: float, cost_bps: float, args: argparse.Namespace, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    generated = Path(f'scripts/.research_q102_cost_{int(round(cost_bps))}_cap_{int(round(cap * 10000))}.generated.py')
    generated.write_text(patch_supplement_cap(source, cap), encoding='utf-8')
    try:
        subprocess.run([
            sys.executable, str(generated),
            '--stock-cache-dir', args.stock_cache_dir,
            '--v12-ledger', args.v12_ledger,
            '--pengu-ledger', args.pengu_ledger,
            '--supplement-csv', str(FROZEN_SUPPLEMENT),
            '--output-dir', str(out_dir),
        ], check=True)
    finally:
        generated.unlink(missing_ok=True)
    result_path = out_dir / 'result.json'
    if not result_path.exists():
        raise RuntimeError(f'missing engine result for cap={cap} cost={cost_bps}: {result_path}')
    return json.loads(result_path.read_text(encoding='utf-8'))


def routing_parity(mode: str, p: dict) -> tuple[bool, dict]:
    actual = p['results'][mode].get('routingDiagnostics', {})
    baseline = p['baselineResults'][mode].get('routingDiagnostics', {})
    detail = {}
    ok = True
    for key in BASE_ROUTING_KEYS:
        av = int(actual.get(key, 0))
        bv = int(baseline.get(key, 0))
        same = av == bv
        ok = ok and same
        detail[key] = {'actual': av, 'baseline': bv, 'same': same}
    return ok, detail


def metric_row(cap: float, cost_bps: float, p: dict) -> dict:
    row: dict[str, object] = {
        'cap': cap,
        'trimCostBps': cost_bps,
        'status': p.get('status'),
        'allChecksPass': all(bool(v) for v in p.get('checks', {}).values()),
    }
    all_routing_parity = True
    for mode in ('NORMAL', 'SEVERE'):
        r = p['results'][mode]
        g = r['grossVerification']
        sleeve = r.get('bySleeve', {}).get('SUPPLEMENT_QUALITY102', {})
        parity_ok, parity_detail = routing_parity(mode, p)
        all_routing_parity = all_routing_parity and parity_ok
        prefix = mode.lower()
        trim_cost = float(g.get('trimExecutionCostJpy', 0.0))
        sleeve_pnl = sleeve.get('pnlJpy')
        sleeve_net = None if sleeve_pnl is None else float(sleeve_pnl) - trim_cost
        resizes = g.get('supplementGrossResizes', [])
        row.update({
            f'{prefix}EndingAssetJpy': r['endingAssetJpy'],
            f'{prefix}NetProfitJpy': r['netProfitJpy'],
            f'{prefix}ReturnOnContributedPct': r['returnOnContributedCapitalPct'],
            f'{prefix}XirrPct': r['moneyWeightedReturnXirrPct'],
            f'{prefix}TwrPct': r['timeWeightedReturnPct'],
            f'{prefix}MaxDdPct': r['maxDrawdownPctClosedEventTwr'],
            f'{prefix}Trades': r['trades'],
            f'{prefix}WinRatePct': r['winRatePct'],
            f'{prefix}ProfitFactor': r['profitFactor'],
            f'{prefix}SupplementPnlJpyBeforeTrimCost': sleeve_pnl,
            f'{prefix}SupplementPnlJpyAfterTrimCost': sleeve_net,
            f'{prefix}SupplementProfitFactor': sleeve.get('profitFactor'),
            f'{prefix}SupplementWinRatePct': sleeve.get('winRatePct'),
            f'{prefix}MaxTotalGross': g['entryTimeMaxTotalGross'],
            f'{prefix}MaxCryptoGross': g['entryTimeMaxCryptoGross'],
            f'{prefix}MaxSupplementGross': g['entryTimeMaxSupplementGross'],
            f'{prefix}ResizeCount': len(resizes),
            f'{prefix}TrimmedNotionalJpy': sum(float(x.get('trimmedNotionalJpy', 0.0)) for x in resizes),
            f'{prefix}TrimExecutionCostJpy': trim_cost,
            f'{prefix}GrossConflictCount': len(g.get('supplementGrossConflicts', [])),
            f'{prefix}GrossBasis': g.get('grossBasis'),
            f'{prefix}QualityCountsTowardCryptoGross': bool(g.get('quality102CountsTowardCryptoGross')),
            f'{prefix}BaselineRoutingParity': parity_ok,
            f'{prefix}BaselineRoutingDetail': parity_detail,
        })
    row['baselineFiringsPreserved'] = all_routing_parity
    row['sizingGrossChecksPass'] = all(
        float(row[f'{prefix}MaxTotalGross']) <= 2.5 + 1e-9
        and float(row[f'{prefix}MaxCryptoGross']) <= 2.0 + 1e-9
        and float(row[f'{prefix}MaxSupplementGross']) <= cap + 1e-9
        and int(row[f'{prefix}GrossConflictCount']) == 0
        and row[f'{prefix}GrossBasis'] == 'PRE_TRIM_EXECUTION_COST_EQUITY'
        and row[f'{prefix}QualityCountsTowardCryptoGross'] is True
        for prefix in ('normal', 'severe')
    )
    row['costAccountingPass'] = all(
        abs(float(row[f'{prefix}TrimExecutionCostJpy']) - float(row[f'{prefix}TrimmedNotionalJpy']) * cost_bps / 10_000.0) <= 1e-6 * max(1.0, abs(float(row[f'{prefix}TrimExecutionCostJpy'])))
        for prefix in ('normal', 'severe')
    )
    return row


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--stock-cache-dir', required=True)
    ap.add_argument('--v12-ledger', required=True)
    ap.add_argument('--pengu-ledger', required=True)
    ap.add_argument('--output-root', required=True)
    args = ap.parse_args()

    root = Path(args.output_root)
    root.mkdir(parents=True, exist_ok=True)
    base_args = [
        '--stock-cache-dir', args.stock_cache_dir,
        '--v12-ledger', args.v12_ledger,
        '--pengu-ledger', args.pengu_ledger,
        '--output-dir', str(root / '_capture'),
    ]

    rows: list[dict] = []
    for cost_bps in TRIM_COST_BPS:
        source = capture_grosssafe_generated(base_args, cost_bps)
        for cap in CAPS:
            out_dir = root / f'cost-{cost_bps:.0f}bp' / f'cap-{cap:.2f}'
            rows.append(metric_row(cap, cost_bps, run_one(source, cap, cost_bps, args, out_dir)))

    all_engine = all(row['status'] == 'PASS_RESEARCH_ONLY' and row['allChecksPass'] is True for row in rows)
    all_gross = all(row['sizingGrossChecksPass'] is True for row in rows)
    all_cost = all(row['costAccountingPass'] is True for row in rows)
    baseline_preserved = all(row['baselineFiringsPreserved'] is True for row in rows)

    row_by_key = {(float(row['trimCostBps']), float(row['cap'])): row for row in rows}
    required_advantage_detail = {}
    fifty_beats = True
    for cost_bps in REQUIRED_ADVANTAGE_COST_BPS:
        r35 = row_by_key[(cost_bps, 0.35)]
        r50 = row_by_key[(cost_bps, 0.50)]
        detail = {}
        for prefix in ('normal', 'severe'):
            a35 = float(r35[f'{prefix}EndingAssetJpy'])
            a50 = float(r50[f'{prefix}EndingAssetJpy'])
            beats = a50 > a35
            fifty_beats = fifty_beats and beats
            detail[prefix] = {'cap35EndingAssetJpy': a35, 'cap50EndingAssetJpy': a50, 'advantageJpy': a50 - a35, 'cap50BeatsCap35': beats}
        required_advantage_detail[str(cost_bps)] = detail

    monotone_cost = True
    monotone_detail = {}
    for cap in CAPS:
        cap_detail = {}
        for prefix in ('normal', 'severe'):
            values = [(cost, float(row_by_key[(cost, cap)][f'{prefix}EndingAssetJpy'])) for cost in TRIM_COST_BPS]
            ok = all(values[i + 1][1] <= values[i][1] + 1e-8 for i in range(len(values) - 1))
            monotone_cost = monotone_cost and ok
            cap_detail[prefix] = {'pass': ok, 'values': [{'costBps': c, 'endingAssetJpy': v} for c, v in values]}
        monotone_detail[str(cap)] = cap_detail

    summary = {
        'schema': 'quality102-trim-cost-validation/v1',
        'caps': list(CAPS),
        'trimCostBps': list(TRIM_COST_BPS),
        'requiredAdvantageCostBps': list(REQUIRED_ADVANTAGE_COST_BPS),
        'grossPolicy': 'BASE_PRIORITY_TOTAL_AND_CRYPTO_RESIDUAL_SHRINK',
        'grossSizingBasis': 'PRE_TRIM_EXECUTION_COST_EQUITY',
        'costPolicy': 'TRIMMED_NOTIONAL_X_BPS_CHARGED_ONCE',
        'quality102CountsTowardCryptoGross': True,
        'rows': rows,
        'requiredAdvantage': required_advantage_detail,
        'costSensitivityMonotone': {'pass': monotone_cost, 'detail': monotone_detail},
        'acceptance': {
            'allEngineChecksPass': all_engine,
            'allSizingGrossChecksPass': all_gross,
            'allCostAccountingChecksPass': all_cost,
            'baselineFiringsPreserved': baseline_preserved,
            'fiftyBeatsThirtyFiveAtRequiredCosts': fifty_beats,
        },
        'safety': {'mode': 'RESEARCH_ONLY', 'ordersSent': False, 'liveChanged': False, 'vpsChanged': False, 'productionChanged': False},
    }
    summary_path = root / 'summary.json'
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    required = summary['acceptance']
    if not all(bool(v) for v in required.values()):
        raise RuntimeError(f'Quality102 trim-cost acceptance failed: {required}')


if __name__ == '__main__':
    main()
