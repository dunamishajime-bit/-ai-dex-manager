#!/usr/bin/env python3
from pathlib import Path
import subprocess
import sys


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit('usage: research_patch_v71_dual_pengu_dca.py <generated-dca.py>')
    path = Path(sys.argv[1])
    subprocess.run([sys.executable, 'scripts/research_patch_v68_dual_pengu_dca.py', str(path)], check=True)
    s = path.read_text(encoding='utf-8')
    replacements = [
        ('V68_NEW_LONG_GROSS_CAP','V71_NEW_LONG_GROSS_CAP'),
        ('V68_RESERVE_V64_GROSS','V71_RESERVE_V64_GROSS'),
        ('V68_NEW_LONG_ENTERED','V71_NEW_LONG_ENTERED'),
        ('V68_NEW_LONG_EXITED','V71_NEW_LONG_EXITED'),
        ('PENGU_V68_NEW_LONG_SLEEVE','PENGU_V71_NEW_LONG_SLEEVE'),
        ('penguV68NewLongNormalSourceMetrics','penguV71NewLongNormalSourceMetrics'),
        ('v68NewLongGrossCap','v71NewLongGrossCap'),
        ('v68V64ReservedGross','v71V64ReservedGross'),
    ]
    for old,new in replacements:
        s = s.replace(old,new)
    required = [
        'V71_NEW_LONG_GROSS_CAP','V71_RESERVE_V64_GROSS','PENGU_V71_NEW_LONG_SLEEVE',
        'PENGU_NEW_LONG_ENTRY','PENGU_NEW_LONG_EXIT','active_pengu_new_long',
        '--pengu-new-long-ledger','V71_NEW_LONG_ENTERED','PENGU_V64_RESERVED_CAPACITY_BLOCKED'
    ]
    for token in required:
        if token not in s:
            raise SystemExit(f'missing V71 DCA token after patch: {token}')
    forbidden = ['V68_NEW_LONG_GROSS_CAP','V68_RESERVE_V64_GROSS','PENGU_V68_NEW_LONG_SLEEVE','V68_NEW_LONG_ENTERED']
    for token in forbidden:
        if token in s:
            raise SystemExit(f'stale V68 DCA token after patch: {token}')
    path.write_text(s, encoding='utf-8')
    print(f'PATCHED_V71_DUAL_PENGU_DCA={path} bytes={path.stat().st_size}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
