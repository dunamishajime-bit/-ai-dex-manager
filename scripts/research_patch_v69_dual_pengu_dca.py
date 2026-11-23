#!/usr/bin/env python3
from pathlib import Path
import subprocess
import sys


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit('usage: research_patch_v69_dual_pengu_dca.py <generated-dca.py>')
    path = Path(sys.argv[1])
    subprocess.run([sys.executable, 'scripts/research_patch_v68_dual_pengu_dca.py', str(path)], check=True)
    s = path.read_text(encoding='utf-8')
    replacements = [
        ('V68_NEW_LONG_GROSS_CAP','V69_NEW_SHORT_GROSS_CAP'),
        ('V68_RESERVE_V64_GROSS','V69_RESERVE_V64_GROSS'),
        ('V68_NEW_LONG_ENTERED','V69_NEW_SHORT_ENTERED'),
        ('V68_NEW_LONG_EXITED','V69_NEW_SHORT_EXITED'),
        ('PENGU_V68_NEW_LONG_SLEEVE','PENGU_V69_NEW_SHORT_SLEEVE'),
        ('PENGU_NEW_LONG_ENTRY','PENGU_NEW_SHORT_ENTRY'),
        ('PENGU_NEW_LONG_EXIT','PENGU_NEW_SHORT_EXIT'),
        ('PENGU_NEW_LONG_','PENGU_NEW_SHORT_'),
        ('active_pengu_new_long','active_pengu_new_short'),
        ('pengu_new_long_gross','pengu_new_short_gross'),
        ('max_entry_pengu_new_long_gross','max_entry_pengu_new_short_gross'),
        ('--pengu-new-long-ledger','--pengu-new-short-ledger'),
        ('pengu_new_long','pengu_new_short'),
        ('penguV68NewLongNormalSourceMetrics','penguV69NewShortNormalSourceMetrics'),
        ('v68NewLongGrossCap','v69NewShortGrossCap'),
        ('v68V64ReservedGross','v69V64ReservedGross'),
    ]
    for old,new in replacements:
        s = s.replace(old,new)
    required = ['V69_RESERVE_V64_GROSS','PENGU_NEW_SHORT_ENTRY','PENGU_NEW_SHORT_EXIT','active_pengu_new_short','--pengu-new-short-ledger','V69_NEW_SHORT_ENTERED','PENGU_V69_NEW_SHORT_SLEEVE']
    for token in required:
        if token not in s:
            raise SystemExit(f'missing V69 DCA token after patch: {token}')
    forbidden = ['PENGU_NEW_LONG_ENTRY','PENGU_NEW_LONG_EXIT','active_pengu_new_long','--pengu-new-long-ledger','PENGU_V68_NEW_LONG_SLEEVE']
    for token in forbidden:
        if token in s:
            raise SystemExit(f'stale V68 DCA token after patch: {token}')
    path.write_text(s, encoding='utf-8')
    print(f'PATCHED_V69_DUAL_PENGU_DCA={path} bytes={path.stat().st_size}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
