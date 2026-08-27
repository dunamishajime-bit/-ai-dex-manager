#!/usr/bin/env python3
from pathlib import Path
import subprocess,sys
if len(sys.argv)!=3:raise SystemExit('usage: research_patch_independent_long_dual_pengu_dca.py <version-number> <generated-dca.py>')
n=sys.argv[1]
if not n.isdigit():raise SystemExit('version-number must be digits')
v=f'V{n}'
p=Path(sys.argv[2])
subprocess.run([sys.executable,'scripts/research_patch_v68_dual_pengu_dca.py',str(p)],check=True)
s=p.read_text()
for a,b in [('V68_NEW_LONG_GROSS_CAP',f'{v}_NEW_LONG_GROSS_CAP'),('V68_RESERVE_V64_GROSS',f'{v}_RESERVE_V64_GROSS'),('V68_NEW_LONG_ENTERED',f'{v}_NEW_LONG_ENTERED'),('V68_NEW_LONG_EXITED',f'{v}_NEW_LONG_EXITED'),('PENGU_V68_NEW_LONG_SLEEVE',f'PENGU_{v}_NEW_LONG_SLEEVE'),('penguV68NewLongNormalSourceMetrics',f'pengu{v.title()}NewLongNormalSourceMetrics'),('v68NewLongGrossCap',f'v{n}NewLongGrossCap'),('v68V64ReservedGross',f'v{n}V64ReservedGross')]:s=s.replace(a,b)
for t in [f'{v}_NEW_LONG_GROSS_CAP',f'{v}_RESERVE_V64_GROSS',f'PENGU_{v}_NEW_LONG_SLEEVE',f'{v}_NEW_LONG_ENTERED','PENGU_V64_RESERVED_CAPACITY_BLOCKED']:assert t in s,t
for t in ['V68_NEW_LONG_GROSS_CAP','V68_RESERVE_V64_GROSS','PENGU_V68_NEW_LONG_SLEEVE','V68_NEW_LONG_ENTERED']:assert t not in s,t
p.write_text(s)
print(f'PATCHED_{v}_DUAL_PENGU_DCA={p}')
