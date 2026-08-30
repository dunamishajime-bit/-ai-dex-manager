from __future__ import annotations

import runpy
import subprocess
import sys
from pathlib import Path

from quality102_rebuilt_v1_integration import patch_dca_two_year_source

INNER = Path('scripts/research_latest_v8_quality102_grosssafe.py')
GENERATED_NAME = '.research_latest_v8_quality102_dca_1y.generated.py'

orig_run = subprocess.run
patched = {'count': 0}


def intercept_run(args, *a, **kw):
    argv = list(args) if isinstance(args, (list, tuple)) else []
    if len(argv) >= 2 and Path(str(argv[1])).name == GENERATED_NAME:
        generated = Path(str(argv[1]))
        source = generated.read_text(encoding='utf-8')
        source = patch_dca_two_year_source(source)
        source = source.replace(
            'latest-v12-top2-pengu-v8-v52-dca-1y/v1',
            'latest-v12-top2-pengu-v8-v52-dca-2y/v1',
        )
        generated.write_text(source, encoding='utf-8')
        patched['count'] += 1
    return orig_run(args, *a, **kw)


try:
    subprocess.run = intercept_run
    runpy.run_path(str(INNER), run_name='__main__')
finally:
    subprocess.run = orig_run

if patched['count'] != 1:
    raise SystemExit(f'expected exactly one generated DCA two-year patch; got {patched["count"]}')
