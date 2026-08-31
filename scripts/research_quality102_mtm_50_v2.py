from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

import research_quality102_mtm_50 as legacy

_LEGACY_PATCH_MTM_ENGINE = legacy.patch_mtm_engine
EVIDENCE_PATH = Path(__file__).resolve().parents[1] / 'research' / 'quality102_mtm_entry_evidence.csv'


def _load_frozen_entry_evidence() -> dict[tuple[str, int], tuple[int, float]]:
    out: dict[tuple[str, int], tuple[int, float]] = {}
    with EVIDENCE_PATH.open(newline='', encoding='utf-8') as fh:
        for row in csv.DictReader(fh):
            key = (str(row['symbol']), int(row['entry_ts_ms']))
            value = (int(row['side']), float(row['entry_price']))
            if key in out:
                raise RuntimeError(f'duplicate Quality102 MTM evidence: {key}')
            if value[0] not in (-1, 1) or value[1] <= 0:
                raise RuntimeError(f'invalid Quality102 MTM evidence: {key}={value}')
            out[key] = value
    if len(out) != 102:
        raise RuntimeError(f'expected 102 Quality102 MTM evidence rows, found {len(out)}')
    return out


FROZEN_ENTRY_EVIDENCE = _load_frozen_entry_evidence()


def partial_net_return(**kwargs):
    return legacy.partial_net_return(**kwargs)


def remaining_limit(**kwargs):
    return legacy.remaining_limit(**kwargs)


def solve_remaining_notional(**kwargs):
    return legacy.solve_remaining_notional(**kwargs)


def patch_mtm_engine(source: str) -> str:
    patched = _LEGACY_PATCH_MTM_ENGINE(source)

    side_map = {entry_ts: side for (_symbol, entry_ts), (side, _price) in FROZEN_ENTRY_EVIDENCE.items()}
    constants = (
        f'QUALITY102_RESIZE_SIDES = {side_map!r}\n'
        f'QUALITY102_FROZEN_ENTRY_EVIDENCE = {FROZEN_ENTRY_EVIDENCE!r}\n'
        '_QUALITY102_KLINE_CACHE = {}\n'
    )
    patched, count = re.subn(
        r'QUALITY102_RESIZE_SIDES = \{.*?_QUALITY102_KLINE_CACHE = \{\}\n',
        constants,
        patched,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError('failed to replace limited Quality102 MTM evidence constants')

    generic_source_evidence = r'''def quality102_source_evidence(position: dict, entry_price: float) -> dict:
    symbol = str(position.get("symbol"))
    entry_ts = int(position.get("entryTs"))
    key = (symbol, entry_ts)
    expected = QUALITY102_FROZEN_ENTRY_EVIDENCE.get(key)
    if expected is None:
        raise RuntimeError(f"unapproved Quality102 MTM entry: {key}")
    expected_side, expected_price = int(expected[0]), float(expected[1])
    side = int(position.get("side", 0))
    if side != expected_side:
        raise RuntimeError(f"Quality102 MTM side mismatch {key}: side={side} expected={expected_side}")
    tol = max(1e-10, abs(expected_price) * 1e-8)
    error = abs(entry_price - expected_price)
    if error > tol:
        raise RuntimeError(f"Quality102 frozen entry-source mismatch {key}: binance1m={entry_price} frozen1h={expected_price} error={error} tol={tol}")
    return {
        "entryPrice": entry_price,
        "entrySource": "BINANCE_VISION_USDM_1M_OPEN",
        "entrySourceCrossCheck": {
            "kind": "FROZEN_RESEARCH_1H_OPEN",
            "expected": expected_price,
            "absError": error,
            "side": expected_side,
        },
    }
'''
    patched, count = re.subn(
        r'def quality102_source_evidence\(position: dict, entry_price: float\) -> dict:\n.*?(?=\ndef finite\()',
        generic_source_evidence,
        patched,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError('failed to replace Quality102 MTM source-evidence validator')

    if 'QUALITY102_FROZEN_ENTRY_EVIDENCE' not in patched:
        raise RuntimeError('all-entry Quality102 MTM evidence marker missing after patch')
    return patched


def _argv_value(flag: str) -> str:
    try:
        return sys.argv[sys.argv.index(flag) + 1]
    except (ValueError, IndexError) as exc:
        raise RuntimeError(f'missing required argument {flag}') from exc


def main() -> None:
    legacy.patch_mtm_engine = patch_mtm_engine
    legacy.main()

    output_dir = Path(_argv_value('--output-dir'))
    summary_path = output_dir / 'mtm-summary.json'
    summary = json.loads(summary_path.read_text(encoding='utf-8'))
    summary['sourceValidation'] = 'ALL_102_FROZEN_RESEARCH_1H_OPEN_CROSSCHECK_FAIL_CLOSED'
    summary['frozenEntryEvidenceCount'] = len(FROZEN_ENTRY_EVIDENCE)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
