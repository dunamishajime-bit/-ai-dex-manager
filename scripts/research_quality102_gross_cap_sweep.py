from __future__ import annotations

import argparse
import ast
import json
import re
import runpy
import subprocess
import sys
from pathlib import Path

CAPS = (0.15, 0.175, 0.20, 0.225, 0.25, 0.275, 0.30, 0.325, 0.35, 0.40, 0.45, 0.50)
GROSSSAFE_LAUNCHER = Path('scripts/research_latest_v8_quality102_grosssafe.py')
GENERATED = Path('scripts/.research_latest_v8_quality102_dca_1y.generated.py')
FROZEN_SUPPLEMENT = Path('.research-state/quality102-frozen.csv')


def _float_constant(node: ast.AST) -> float | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    return None


def _target_names(node: ast.AST) -> list[str]:
    if isinstance(node, ast.Name):
        return [node.id]
    if isinstance(node, (ast.Tuple, ast.List)):
        out: list[str] = []
        for elt in node.elts:
            out.extend(_target_names(elt))
        return out
    return []


def patch_supplement_cap(source: str, cap: float) -> str:
    tree = ast.parse(source)
    matches: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        value = None
        names: list[str] = []
        if isinstance(node, ast.Assign):
            value = _float_constant(node.value)
            for target in node.targets:
                names.extend(_target_names(target))
        elif isinstance(node, ast.AnnAssign):
            value = _float_constant(node.value) if node.value is not None else None
            names.extend(_target_names(node.target))
        if value is None or abs(value - 0.15) > 1e-12:
            continue
        for name in names:
            upper = name.upper()
            if 'SUPP' in upper and 'GROSS' in upper:
                matches.append((node.lineno, name))
    if len(matches) != 1:
        raise RuntimeError(f'expected exactly one frozen supplement gross-cap assignment at 0.15; found {matches}')

    lineno, name = matches[0]
    lines = source.splitlines(keepends=True)
    original = lines[lineno - 1]
    numeric = format(cap, '.12g')
    pattern = re.compile(r'(\b' + re.escape(name) + r'\b\s*(?::[^=]+)?=\s*)0\.15\b')
    replaced, count = pattern.subn(r'\g<1>' + numeric, original, count=1)
    if count != 1:
        raise RuntimeError(f'failed to patch gross-cap line {lineno}: {original!r}')
    lines[lineno - 1] = replaced
    out = ''.join(lines)
    return out.replace('"grossCap": 0.15', f'"grossCap": {numeric}')


def capture_grosssafe_generated(base_args: list[str]) -> str:
    orig_run, orig_unlink, orig_argv = subprocess.run, Path.unlink, list(sys.argv)
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
        subprocess.run, Path.unlink = hold_run, hold_unlink
        sys.argv = [str(GROSSSAFE_LAUNCHER), *base_args]
        runpy.run_path(str(GROSSSAFE_LAUNCHER), run_name='__main__')
    finally:
        subprocess.run, Path.unlink, sys.argv = orig_run, orig_unlink, orig_argv

    if not GENERATED.exists() or 'argv' not in captured:
        raise RuntimeError('failed to capture fully gross-safe generated engine')
    source = GENERATED.read_text(encoding='utf-8')
    GENERATED.unlink(missing_ok=True)
    if 'BASE_IDLE_ONE_SLOT_BASE_PRIORITY_RESIDUAL_GROSS_SHRINK' not in source:
        raise RuntimeError('captured engine is missing gross-safe residual-shrink policy')
    if not FROZEN_SUPPLEMENT.exists():
        raise RuntimeError(f'frozen Quality102 candidate was not materialized: {FROZEN_SUPPLEMENT}')
    return source


def _run_one(source: str, cap: float, args: argparse.Namespace, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    generated = Path(f'scripts/.research_q102_cap_{int(round(cap * 10000))}.generated.py')
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

    p = json.loads((out_dir / 'result.json').read_text(encoding='utf-8'))
    if p.get('status') != 'PASS_RESEARCH_ONLY':
        raise RuntimeError(f'cap {cap} failed engine contract: {p.get("checks")}')
    return p


def _metric_row(cap: float, p: dict) -> dict:
    row: dict[str, object] = {'cap': cap, 'status': p.get('status'), 'allChecksPass': all(bool(v) for v in p.get('checks', {}).values())}
    for mode in ('NORMAL', 'SEVERE'):
        r = p['results'][mode]
        g = r['grossVerification']
        sleeve = r.get('bySleeve', {}).get('SUPPLEMENT_QUALITY102', {})
        prefix = mode.lower()
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
            f'{prefix}SupplementPnlJpy': sleeve.get('pnlJpy'),
            f'{prefix}SupplementProfitFactor': sleeve.get('profitFactor'),
            f'{prefix}SupplementWinRatePct': sleeve.get('winRatePct'),
            f'{prefix}MaxTotalGross': g['entryTimeMaxTotalGross'],
            f'{prefix}MaxSupplementGross': g['entryTimeMaxSupplementGross'],
            f'{prefix}ResizeCount': len(g.get('supplementGrossResizes', [])),
            f'{prefix}GrossConflictCount': len(g.get('supplementGrossConflicts', [])),
        })
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
    source = capture_grosssafe_generated(base_args)

    rows = []
    for cap in CAPS:
        out_dir = root / f'cap-{cap:.3f}'.rstrip('0').rstrip('.')
        rows.append(_metric_row(cap, _run_one(source, cap, args, out_dir)))

    for row in rows:
        cap = float(row['cap'])
        if not row['allChecksPass']:
            raise RuntimeError(f'base parity/check failure at cap {cap}: {row}')
        for prefix in ('normal', 'severe'):
            if float(row[f'{prefix}MaxTotalGross']) > 2.5 + 1e-9:
                raise RuntimeError(f'total gross violation at cap {cap}: {row}')
            if float(row[f'{prefix}MaxSupplementGross']) > cap + 1e-9:
                raise RuntimeError(f'supplement gross violation at cap {cap}: {row}')
            if int(row[f'{prefix}GrossConflictCount']) != 0:
                raise RuntimeError(f'gross conflict at cap {cap}: {row}')

    anchor = rows[0]
    if abs(float(anchor['normalEndingAssetJpy']) - 1662215.64514461) > 0.05:
        raise RuntimeError(f'15% NORMAL regression mismatch: {anchor["normalEndingAssetJpy"]}')
    if abs(float(anchor['severeEndingAssetJpy']) - 521109.41606506) > 0.05:
        raise RuntimeError(f'15% SEVERE regression mismatch: {anchor["severeEndingAssetJpy"]}')

    summary = {
        'schema': 'quality102-gross-cap-sweep/v1',
        'caps': list(CAPS),
        'resizePnlAccounting': 'ZERO_PNL_ON_TRIMMED_NOTIONAL',
        'grossPolicy': 'BASE_PRIORITY_RESIDUAL_GROSS_SHRINK',
        'rows': rows,
        'bestNormalByEndingAsset': max(rows, key=lambda x: float(x['normalEndingAssetJpy'])),
        'bestSevereByEndingAsset': max(rows, key=lambda x: float(x['severeEndingAssetJpy'])),
        'safety': {'mode': 'RESEARCH_ONLY', 'ordersSent': False, 'liveChanged': False, 'vpsChanged': False, 'productionChanged': False},
    }
    (root / 'sweep-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
