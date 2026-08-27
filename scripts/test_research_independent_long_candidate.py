#!/usr/bin/env python3
from pathlib import Path
import re,sys
if len(sys.argv)!=3:raise SystemExit('usage: test_research_independent_long_candidate.py <version-number> <patch.py>')
n=sys.argv[1];p=Path(sys.argv[2]);v=f'V{n}';s=p.read_text()
required=[f'type {v}Family',f'{v}_NEW_LONG_GROSS',f'{v}_NEW_LONG_SLEEVE',f'{v}_FOLD_BOUNDARIES','2025-08-10T00:00:00Z','2025-12-09T16:00:00Z','2026-04-10T08:00:00Z','2026-08-10T00:00:00Z',f'{v}_MIN_TRADES_PER_FOLD','303.9903920953809','longRawForMode(row,"V64_DYNAMIC")','ordersSent:false','liveChanged:false','vpsChanged:false','productionChanged:false']
for t in required:assert t in s,f'missing fixed-contract token: {t}'
assert re.search(rf'{v}_NEW_LONG_GROSS\s*=\s*0\.25',s), 'Gross must be fixed 0.25'
assert re.search(rf'{v}_MIN_TRADES_PER_FOLD\s*=\s*2',s), 'fold minimum must be fixed 2'
assert re.search(r'assert\.equal\(incNM\.trades,\s*41',s), 'V64 41-trade identity guard missing'
for t in [f'{v}_FAMILIES','candidateCount','selectedTraining','threshold_candidates','gross_candidates','grid_search','optimize_threshold','optimize_gross','hyperopt','bayesian','random_search']:assert t not in s,f'forbidden post-hoc path: {t}'
print(f'{v}_INDEPENDENT_LONG_POLICY=PASS')
