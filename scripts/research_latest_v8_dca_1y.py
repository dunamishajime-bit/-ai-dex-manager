from pathlib import Path
import subprocess
import sys

src_path=Path('scripts/research_current_top2_pengu_v52_dca.py')
out_path=Path('scripts/.research_latest_v8_dca_1y.generated.py')
s=src_path.read_text()
old_start='START = dt.datetime(2025, 8, 1, tzinfo=UTC)'
old_end='END = dt.datetime(2026, 8, 1, tzinfo=UTC)'
if old_start not in s or old_end not in s:
    raise SystemExit('DCA period markers missing')
s=s.replace(old_start,'START = dt.datetime(2025, 8, 10, tzinfo=UTC)',1)
s=s.replace(old_end,'END = dt.datetime(2026, 8, 10, tzinfo=UTC)',1)
out_path.write_text(s)
try:
    subprocess.run([sys.executable,str(out_path),*sys.argv[1:]],check=True)
finally:
    out_path.unlink(missing_ok=True)
