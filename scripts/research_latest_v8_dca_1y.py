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
]
for old,new in replacements:
    if old not in s:
        raise SystemExit(f'DCA patch marker missing: {old}')
    s=s.replace(old,new)
out_path.write_text(s)
try:
    subprocess.run([sys.executable,str(out_path),*sys.argv[1:]],check=True)
finally:
    out_path.unlink(missing_ok=True)
