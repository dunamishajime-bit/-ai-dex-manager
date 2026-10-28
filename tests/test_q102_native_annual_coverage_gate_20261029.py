import json
import subprocess
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"scripts/research/validate-q102-native-annual-coverage-20261029.py"
class NativeCoverageProof(unittest.TestCase):
 def test_exact_annual_gate_must_block(self):
  p=subprocess.run([sys.executable,str(SCRIPT)],capture_output=True,text=True,timeout=20)
  self.assertEqual(p.returncode,2,p.stderr)
  row=json.loads(p.stdout)
  self.assertEqual(row["status"],"BLOCKED_MISSING_NATIVE_181DAY_WARMUP")
  self.assertFalse(row["annualEconomicBTCertified"])
  self.assertEqual(row["symbolsChecked"],23)
  self.assertEqual(row["missingWarmupCount"],8)
  self.assertEqual(set(x["symbol"] for x in row["missingWarmupSymbols"]),{
   "ENAUSDT","FETUSDT","FILUSDT","JUPUSDT","LDOUSDT","RENDERUSDT","TAOUSDT","TIAUSDT"
  })
  self.assertEqual(row["requiredNativeWarmupStartsUtc"],"2025-02-10T00:00:00+00:00")
  self.assertEqual(row["earliestPossibleAll23Utc"],"2026-07-09T18:00:00+00:00")
  self.assertEqual(row["tradingOrdersSent"],0)
if __name__=="__main__":
 unittest.main()
