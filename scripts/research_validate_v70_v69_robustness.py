#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

FROZEN_FAMILY = "RALLY_FAILURE"
FROZEN_GROSS = 0.25
EXPECTED_V69_ARTIFACT_SHA256 = "f597a5ddf10963684276d814834b50b695d83dfe5537eccddb0890d4942edb5e"
EXPECTED_V69_LEDGER_SHA256 = "c23ab022d680f6468b80c387be5f701e3498060d51b74822306970f34fa4816c"
MIN_TRADES_PER_FOLD = 2
FOLD_BOUNDS_ISO = [
    "2025-08-10T00:00:00Z",
    "2025-12-09T16:00:00Z",
    "2026-04-10T08:00:00Z",
    "2026-08-10T00:00:00Z",
]


def iso_to_ms(value: str) -> int:
    from datetime import datetime
    return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)


def metrics(trades: list[dict[str, Any]]) -> dict[str, Any]:
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    gross_profit = 0.0
    gross_loss = 0.0
    wins = 0
    for trade in trades:
        r = float(trade['accountReturn'])
        equity *= 1.0 + r
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
        if r > 0:
            gross_profit += r
            wins += 1
        else:
            gross_loss -= r
    return {
        'trades': len(trades),
        'returnPct': (equity - 1.0) * 100.0,
        'profitFactor': (gross_profit / gross_loss) if gross_loss > 0 else None,
        'maxDrawdownPct': max_dd * 100.0,
        'winRatePct': (wins / len(trades) * 100.0) if trades else None,
    }


def fold_pass(m: dict[str, Any]) -> bool:
    profitFactor = m['profitFactor']
    return bool(
        m['trades'] >= MIN_TRADES_PER_FOLD
        and m['returnPct'] > 0.0
        and profitFactor is not None
        and profitFactor >= 1.0
    )


def find_ledger(root: Path) -> Path:
    candidates = list(root.rglob('new-short-sleeve-ledger.json'))
    if len(candidates) != 1:
        raise AssertionError(f'expected exactly one V69 new-short ledger, got {candidates}')
    return candidates[0]


def main() -> None:
    parser = argparse.ArgumentParser(description='V70 fixed V69 robustness audit; no tuning permitted')
    parser.add_argument('--v69-root', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()

    root = Path(args.v69_root)
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    ledger_path = find_ledger(root)
    ledger_bytes = ledger_path.read_bytes()
    ledger_sha = hashlib.sha256(ledger_bytes).hexdigest()
    assert ledger_sha == EXPECTED_V69_LEDGER_SHA256, f'V69 ledger drift: {ledger_sha}'
    ledger = json.loads(ledger_bytes)

    selectedFamily = ledger.get('selectedFamily')
    requestedGross = ledger.get('requestedGross')
    assert selectedFamily == FROZEN_FAMILY
    assert requestedGross == FROZEN_GROSS
    assert ledger.get('researchOnly') is True
    expected_safety = {'ordersSent': False, 'liveChanged': False, 'vpsChanged': False, 'productionChanged': False}
    assert ledger.get('safety') == expected_safety

    bounds = [iso_to_ms(x) for x in FOLD_BOUNDS_ISO]
    folds: list[dict[str, Any]] = []
    allFoldPass = True
    for i in range(3):
        item: dict[str, Any] = {
            'fold': i + 1,
            'startInclusive': FOLD_BOUNDS_ISO[i],
            'endExclusive': FOLD_BOUNDS_ISO[i + 1],
            'modes': {},
        }
        fold_ok = True
        for mode in ('normal', 'stress'):
            source = ledger['modes'][mode]['trades']
            selected = [t for t in source if bounds[i] <= int(t['entryTs']) < bounds[i + 1]]
            m = metrics(selected)
            passed = fold_pass(m)
            item['modes'][mode] = {'metrics': m, 'pass': passed}
            fold_ok = fold_ok and passed
        item['pass'] = fold_ok
        allFoldPass = allFoldPass and fold_ok
        folds.append(item)

    research_decision = (
        'CONFIRM_V69_ROBUSTNESS_RESEARCH_CANDIDATE'
        if allFoldPass
        else 'REJECT_V69_ROBUSTNESS_KEEP_V64'
    )
    failing = [x['fold'] for x in folds if not x['pass']]
    result = {
        'schema': 'pengu-v70-v69-robustness/v1',
        'status': 'PASS_RESEARCH_ONLY',
        'auditType': 'FROZEN_NO_TUNING_CHRONOLOGICAL_FOLDS',
        'frozenContract': {
            'family': FROZEN_FAMILY,
            'gross': FROZEN_GROSS,
            'sourceV69ArtifactSha256': EXPECTED_V69_ARTIFACT_SHA256,
            'sourceV69LedgerSha256': ledger_sha,
            'foldBounds': FOLD_BOUNDS_ISO,
            'minimumTradesPerFold': MIN_TRADES_PER_FOLD,
            'modeGate': {'returnPct': '> 0.0', 'profitFactor': '>= 1.0'},
            'parameterSearchPerformed': False,
        },
        'folds': folds,
        'allFoldPass': allFoldPass,
        'failingFolds': failing,
        'researchDecision': research_decision,
        'productionDecision': 'NO_CHANGE_V56',
        'reason': (
            'Every predeclared chronological fold passed in Normal and Stress.'
            if allFoldPass
            else f'Frozen V69 failed predeclared chronological fold(s): {failing}; no parameters were changed.'
        ),
        'safety': {
            'mode': 'RESEARCH_ONLY',
            'ordersSent': False,
            'liveChanged': False,
            'vpsChanged': False,
            'productionChanged': False,
        },
    }
    result_path = out / 'v70-result.json'
    result_path.write_text(json.dumps(result, indent=2) + '\n')
    report = [
        '# V70 Frozen V69 Robustness Audit',
        '',
        f'- Family: `{FROZEN_FAMILY}`',
        f'- Gross: `{FROZEN_GROSS}`',
        '- Parameter changes/search: **NONE**',
        f'- Decision: **{research_decision}**',
        '',
        '| Fold | Normal Return | Normal PF | Stress Return | Stress PF | Pass |',
        '|---|---:|---:|---:|---:|---|',
    ]
    for f in folds:
        n = f['modes']['normal']['metrics']
        s = f['modes']['stress']['metrics']
        report.append(
            f"| {f['fold']} | {n['returnPct']:.6f}% | {n['profitFactor']:.6f} | "
            f"{s['returnPct']:.6f}% | {s['profitFactor']:.6f} | {'PASS' if f['pass'] else 'FAIL'} |"
        )
    (out / 'report.md').write_text('\n'.join(report) + '\n')
    print('V70=' + json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    main()
