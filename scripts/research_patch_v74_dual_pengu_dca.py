#!/usr/bin/env python3
from pathlib import Path
import subprocess,sys
if len(sys.argv)!=2:raise SystemExit('usage: research_patch_v74_dual_pengu_dca.py <generated-dca.py>')
p=Path(sys.argv[1]);subprocess.run([sys.executable,'scripts/research_patch_v68_dual_pengu_dca.py',str(p)],check=True);s=p.read_text()
for a,b in [('V68_NEW_LONG_GROSS_CAP','V74_NEW_LONG_GROSS_CAP'),('V68_RESERVE_V64_GROSS','V74_RESERVE_V64_GROSS'),('V68_NEW_LONG_ENTERED','V74_NEW_LONG_ENTERED'),('V68_NEW_LONG_EXITED','V74_NEW_LONG_EXITED'),('PENGU_V68_NEW_LONG_SLEEVE','PENGU_V74_NEW_LONG_SLEEVE'),('penguV68NewLongNormalSourceMetrics','penguV74NewLongNormalSourceMetrics'),('v68NewLongGrossCap','v74NewLongGrossCap'),('v68V64ReservedGross','v74V64ReservedGross')]:s=s.replace(a,b)
for t in ['V74_NEW_LONG_GROSS_CAP','V74_RESERVE_V64_GROSS','PENGU_V74_NEW_LONG_SLEEVE','V74_NEW_LONG_ENTERED','PENGU_V64_RESERVED_CAPACITY_BLOCKED']:
 assert t in s,t
for t in ['V68_NEW_LONG_GROSS_CAP','V68_RESERVE_V64_GROSS','PENGU_V68_NEW_LONG_SLEEVE','V68_NEW_LONG_ENTERED']:assert t not in s,t
p.write_text(s);print(f'PATCHED_V74_DUAL_PENGU_DCA={p}')
