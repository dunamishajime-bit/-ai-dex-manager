#!/usr/bin/env python3
from pathlib import Path
import subprocess,sys

def main():
    if len(sys.argv)!=2: raise SystemExit('usage: research_patch_v73_dual_pengu_dca.py <generated-dca.py>')
    path=Path(sys.argv[1])
    subprocess.run([sys.executable,'scripts/research_patch_v68_dual_pengu_dca.py',str(path)],check=True)
    s=path.read_text()
    for old,new in [('V68_NEW_LONG_GROSS_CAP','V73_NEW_LONG_GROSS_CAP'),('V68_RESERVE_V64_GROSS','V73_RESERVE_V64_GROSS'),('V68_NEW_LONG_ENTERED','V73_NEW_LONG_ENTERED'),('V68_NEW_LONG_EXITED','V73_NEW_LONG_EXITED'),('PENGU_V68_NEW_LONG_SLEEVE','PENGU_V73_NEW_LONG_SLEEVE'),('penguV68NewLongNormalSourceMetrics','penguV73NewLongNormalSourceMetrics'),('v68NewLongGrossCap','v73NewLongGrossCap'),('v68V64ReservedGross','v73V64ReservedGross')]: s=s.replace(old,new)
    for token in ['V73_NEW_LONG_GROSS_CAP','V73_RESERVE_V64_GROSS','PENGU_V73_NEW_LONG_SLEEVE','PENGU_NEW_LONG_ENTRY','PENGU_NEW_LONG_EXIT','active_pengu_new_long','--pengu-new-long-ledger','V73_NEW_LONG_ENTERED','PENGU_V64_RESERVED_CAPACITY_BLOCKED']:
        if token not in s: raise SystemExit(f'missing V73 DCA token: {token}')
    for token in ['V68_NEW_LONG_GROSS_CAP','V68_RESERVE_V64_GROSS','PENGU_V68_NEW_LONG_SLEEVE','V68_NEW_LONG_ENTERED']:
        if token in s: raise SystemExit(f'stale V68 token: {token}')
    path.write_text(s)
    print(f'PATCHED_V73_DUAL_PENGU_DCA={path} bytes={path.stat().st_size}')
if __name__=='__main__': main()
