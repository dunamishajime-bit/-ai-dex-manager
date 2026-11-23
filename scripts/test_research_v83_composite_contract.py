#!/usr/bin/env python3
from pathlib import Path
import re

p = Path('scripts/research_patch_v83_independent_long_sleeve.py')
assert p.exists(), 'V83 implementation must exist'
s = p.read_text()
required = [
    'type V83Family',
    'V83_NEW_LONG_GROSS = 0.25',
    'V83_MIN_TRADES_PER_FOLD = 2',
    'V83_NEW_LONG_SLEEVE',
    '2025-08-10T00:00:00Z',
    '2025-12-09T16:00:00Z',
    '2026-04-10T08:00:00Z',
    '2026-08-10T00:00:00Z',
    'assert.equal(incNM.trades,41',
    'longRawForMode(row,"V64_DYNAMIC")',
    'V83State',
    'DISCOVERY',
    'ARMED',
    'TRIGGERED',
    'btcTrendPass',
    'penguStructurePass',
    'lagSetupPass',
    'reaccelerationPass',
    'setupLow',
    'relativeFailure',
    'ordersSent:false',
    'liveChanged:false',
    'vpsChanged:false',
    'productionChanged:false',
]
for token in required:
    assert token in s, f'missing V83 composite-contract token: {token}'
for forbidden in [
    'RegimeScore', 'SetupScore', 'TriggerScore', 'candidateCount',
    'threshold_candidates', 'gross_candidates', 'grid_search',
    'optimize_threshold', 'optimize_gross', 'hyperopt', 'bayesian', 'random_search'
]:
    assert forbidden not in s, f'forbidden score/tuning path present: {forbidden}'
assert re.search(r'V83_NEW_LONG_GROSS\s*=\s*0\.25', s)
assert re.search(r'V83_MIN_TRADES_PER_FOLD\s*=\s*2', s)
print('V83_COMPOSITE_CONTRACT=PASS')
