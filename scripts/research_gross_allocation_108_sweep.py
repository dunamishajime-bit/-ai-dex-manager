from __future__ import annotations

import argparse
import ast
import itertools
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
import research_quality102_gross_cap_sweep as q102

PENGU_GROSS_LEVELS = (0.75, 1.0, 1.25, 1.5)
Q102_GROSS_LEVELS = (1.0, 1.25, 1.5)
STOCK_GROSS_LEVELS = (1.5, 1.75, 2.0)
SHARED_CAP_PROFILES = (
    (2.0, 2.5),
    (2.5, 3.0),
    (3.0, 3.5),
)

V12_AGGREGATE_GROSS = 1.5
V12_PER_POSITION_GROSS = 1.0
V12_MAX_POSITIONS = 2
SHARED_CRYPTO_DAILY_LOSS_LIMIT = -0.075
PENGU_BASE_GROSS = 0.75

FORMAL_BASELINE = {
    'normalEndingAssetJpy': 18442769.03585051,
    'normalProfitFactor': 3.57064393,
    'normalMaxDdPct': -14.33740242,
    'severeEndingAssetJpy': 2827282.1410372,
    'severeProfitFactor': 2.41551514,
    'severeMaxDdPct': -17.68170098,
}

GENERATED = Path('scripts/.research_gross_allocation_108.generated.py')
FROZEN_SUPPLEMENT = q102.FROZEN_SUPPLEMENT


def build_case_matrix() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for pengu, qgross, stock, shared in itertools.product(
        PENGU_GROSS_LEVELS,
        Q102_GROSS_LEVELS,
        STOCK_GROSS_LEVELS,
        SHARED_CAP_PROFILES,
    ):
        crypto, total = shared
        case_id = (
            f'p{int(round(pengu * 100)):03d}'
            f'-q{int(round(qgross * 100)):03d}'
            f'-s{int(round(stock * 100)):03d}'
            f'-c{int(round(crypto * 100)):03d}'
            f'-t{int(round(total * 100)):03d}'
        )
        is_baseline = (
            pengu == 0.75 and qgross == 1.0 and stock == 1.5
            and crypto == 2.0 and total == 2.5
        )
        cases.append({
            'caseId': case_id,
            'penguGross': pengu,
            'q102Gross': qgross,
            'stockGross': stock,
            'cryptoGrossCap': crypto,
            'totalGrossCap': total,
            'v12AggregateGross': V12_AGGREGATE_GROSS,
            'v12PerPositionGross': V12_PER_POSITION_GROSS,
            'v12MaxPositions': V12_MAX_POSITIONS,
            'sharedCryptoDailyLossLimit': SHARED_CRYPTO_DAILY_LOSS_LIMIT,
            'isBaseline': is_baseline,
        })
    return cases


def _number(node: ast.AST) -> float | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        inner = _number(node.operand)
        return -inner if inner is not None else None
    return None


def _patch_named_number(source: str, name: str, value: float) -> str:
    tree = ast.parse(source)
    hits: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            if _number(node.value) is not None:
                hits.append(node.lineno)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == name:
            if node.value is not None and _number(node.value) is not None:
                hits.append(node.lineno)
    if len(hits) != 1:
        raise RuntimeError(f'expected one numeric assignment for {name}; found lines={hits}')
    lines = source.splitlines(keepends=True)
    idx = hits[0] - 1
    numeric = format(value, '.12g')
    pattern = re.compile(r'^(\s*' + re.escape(name) + r'\s*(?::[^=]+)?=\s*)([-+]?[0-9]*\.?[0-9]+)(\s*(?:#.*)?\r?\n?)$')
    replaced, count = pattern.subn(r'\g<1>' + numeric + r'\g<3>', lines[idx], count=1)
    if count != 1:
        raise RuntimeError(f'failed to patch {name}: {lines[idx]!r}')
    lines[idx] = replaced
    return ''.join(lines)


def _patch_pengu_sizing(source: str, target_gross: float) -> str:
    source = _patch_named_number(source, 'PENGU_MAX_GROSS', target_gross)
    multiplier = target_gross / PENGU_BASE_GROSS
    marker = re.compile(r'^(\s*PENGU_MAX_GROSS\s*=\s*[-+0-9.]+.*\n)', re.M)
    source, count = marker.subn(
        r'\1PENGU_SIZE_MULTIPLIER = ' + format(multiplier, '.12g') + '\n', source, count=1
    )
    if count != 1:
        raise RuntimeError('failed to insert PENGU_SIZE_MULTIPLIER')
    old = 'requested = min(PENGU_MAX_GROSS, max(0.0, finite(trade.get("requestedGross"))))'
    new = 'requested = min(PENGU_MAX_GROSS, max(0.0, finite(trade.get("requestedGross"))) * PENGU_SIZE_MULTIPLIER)'
    if old not in source:
        raise RuntimeError('PENGU requested-gross expression not found; refusing silent sizing patch')
    return source.replace(old, new, 1)


def patch_engine(source: str, case: dict[str, Any]) -> str:
    out = q102.patch_supplement_cap(source, float(case['q102Gross']))
    out = _patch_pengu_sizing(out, float(case['penguGross']))
    out = _patch_named_number(out, 'STOCK_GROSS_CAP', float(case['stockGross']))
    out = _patch_named_number(out, 'CRYPTO_GROSS_CAP', float(case['cryptoGrossCap']))
    out = _patch_named_number(out, 'TOTAL_GROSS_CAP', float(case['totalGrossCap']))
    out = _patch_named_number(out, 'CRYPTO_DAILY_LOSS_LIMIT', SHARED_CRYPTO_DAILY_LOSS_LIMIT)
    return out


def _run_case(source: str, case: dict[str, Any], args: argparse.Namespace, root: Path) -> dict:
    out_dir = root / case['caseId']
    out_dir.mkdir(parents=True, exist_ok=True)
    GENERATED.write_text(patch_engine(source, case), encoding='utf-8')
    try:
        subprocess.run([
            sys.executable, str(GENERATED),
            '--stock-cache-dir', args.stock_cache_dir,
            '--v12-ledger', args.v12_ledger,
            '--pengu-ledger', args.pengu_ledger,
            '--supplement-csv', str(FROZEN_SUPPLEMENT),
            '--output-dir', str(out_dir),
        ], check=True)
    finally:
        GENERATED.unlink(missing_ok=True)
    result = json.loads((out_dir / 'result.json').read_text(encoding='utf-8'))
    if result.get('status') != 'PASS_RESEARCH_ONLY':
        raise RuntimeError(f"{case['caseId']} failed engine contract: {result.get('checks')}")
    return result


def _row(case: dict[str, Any], result: dict) -> dict[str, Any]:
    row: dict[str, Any] = dict(case)
    row['status'] = result.get('status')
    for mode in ('NORMAL', 'SEVERE'):
        r = result['results'][mode]
        g = r['grossVerification']
        prefix = mode.lower()
        row.update({
            f'{prefix}EndingAssetJpy': r['endingAssetJpy'],
            f'{prefix}ProfitFactor': r['profitFactor'],
            f'{prefix}MaxDdPct': r['maxDrawdownPctClosedEventTwr'],
            f'{prefix}Trades': r['trades'],
            f'{prefix}BySleeve': r.get('bySleeve', {}),
            f'{prefix}RoutingDiagnostics': r.get('routingDiagnostics', {}),
            f'{prefix}MaxCryptoGross': g.get('entryTimeMaxCryptoGross'),
            f'{prefix}MaxStockGross': g.get('entryTimeMaxStockGross'),
            f'{prefix}MaxTotalGross': g.get('entryTimeMaxTotalGross'),
            f'{prefix}MaxQ102Gross': g.get('entryTimeMaxSupplementGross'),
            f'{prefix}Q102ResizeCount': len(g.get('supplementGrossResizes', [])),
            f'{prefix}GrossConflictCount': len(g.get('supplementGrossConflicts', [])),
        })
    return row


def _assert_baseline(row: dict[str, Any]) -> None:
    for key, expected in FORMAL_BASELINE.items():
        actual = float(row[key])
        tolerance = 0.05 if 'AssetJpy' in key else 1e-6
        if abs(actual - expected) > tolerance:
            raise RuntimeError(f'FORMAL_BASELINE_MISMATCH {key}: actual={actual} expected={expected}')
    if int(row['normalGrossConflictCount']) != 0 or int(row['severeGrossConflictCount']) != 0:
        raise RuntimeError('FORMAL_BASELINE_GROSS_CONFLICT')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--stock-cache-dir', required=True)
    ap.add_argument('--v12-ledger', required=True)
    ap.add_argument('--pengu-ledger', required=True)
    ap.add_argument('--output-root', required=True)
    ap.add_argument('--baseline-only', action='store_true')
    ap.add_argument('--shard-index', type=int, default=0)
    ap.add_argument('--shard-count', type=int, default=1)
    args = ap.parse_args()

    if args.shard_count < 1 or not 0 <= args.shard_index < args.shard_count:
        raise SystemExit('invalid shard configuration')

    root = Path(args.output_root)
    root.mkdir(parents=True, exist_ok=True)
    base_args = [
        '--stock-cache-dir', args.stock_cache_dir,
        '--v12-ledger', args.v12_ledger,
        '--pengu-ledger', args.pengu_ledger,
        '--output-dir', str(root / '_capture'),
    ]
    source = q102.capture_grosssafe_generated(base_args)
    all_cases = build_case_matrix()
    selected = [c for c in all_cases if c['isBaseline']] if args.baseline_only else [
        c for i, c in enumerate(all_cases) if i % args.shard_count == args.shard_index
    ]

    rows = []
    for case in selected:
        row = _row(case, _run_case(source, case, args, root))
        if case['isBaseline']:
            _assert_baseline(row)
        rows.append(row)

    payload = {
        'schema': 'gross-allocation-108-sweep/v1',
        'matrixCaseCount': len(all_cases),
        'selectedCaseCount': len(selected),
        'shard': {'index': args.shard_index, 'count': args.shard_count},
        'matrixOrigin': 'reconstructed from explicit PENGU/Q102/V52 ranges plus accepted 108-case and total-gross-3.5 contract',
        'formalBaseline': FORMAL_BASELINE,
        'rows': rows,
        'safety': {'mode': 'RESEARCH_ONLY', 'ordersSent': False, 'liveChanged': False, 'vpsChanged': False, 'productionChanged': False},
    }
    (root / f'sweep-shard-{args.shard_index}.json').write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
