"""STABLE4 research-only V4-DD21 -> DD30 sensitivity evidence checks."""
import hashlib
import json
from pathlib import Path
import unittest
import zipfile

ROOT=Path(__file__).resolve().parent
M=json.loads((ROOT/"STABLE4_DD21_VS_DD30_RESEARCH_MANIFEST_20261123.json").read_text(encoding="utf8"))
Z=ROOT/M["ledgerZip"]["name"]

class Stable4Dd30ResearchTests(unittest.TestCase):
 def test_30_gate_changes_only_v4_new_admission_threshold(self):
  for key,info in M["runScripts"].items():
   p=ROOT/info["file"]
   raw=p.read_bytes()
   self.assertEqual(hashlib.sha256(raw).hexdigest(),info["sha256"])
   code=raw.decode("utf8")
   self.assertIn('assert orig.count("v4_max_dd<=0.21+1e-12")==2',code)
   self.assertIn('assert orig.count("v4_max_dd>0.21+1e-12")==1',code)
   self.assertIn('orig=orig.replace("v4_max_dd<=0.21+1e-12","v4_max_dd<=0.30+1e-12")',code)
   self.assertIn('orig=orig.replace("v4_max_dd>0.21+1e-12","v4_max_dd>0.30+1e-12")',code)
   self.assertIn('V4_MAX_DRAWDOWN_30PCT_HOLD',code)
   compile(code,str(p),"exec")

 def test_63_outputs_sha_and_zip_integrity(self):
  self.assertEqual(hashlib.sha256(Z.read_bytes()).hexdigest(),M["ledgerZip"]["sha256"])
  with zipfile.ZipFile(Z) as z:
   files=M["ledgerZip"]["files"]
   self.assertEqual(set(files),{"BASE","PENGU","P100_SCORE"})
   for grp,records in files.items():
    self.assertEqual(len(records),21)
    for name,meta in records.items():
     b=z.read(grp+"/"+name)
     self.assertEqual(len(b),meta["bytes"],name)
     self.assertEqual(hashlib.sha256(b).hexdigest(),meta["sha256"],name)
   self.assertEqual(len(z.namelist()),63)

 def test_original_stable4_dominates_at_dd30(self):
  s=M["scenarios"]
  for fee in ("10","30"):
   base=s["BASE_30"][fee];new=s["PENGU_30"][fee];score=s["SCORE_30"][fee]
   self.assertGreater(base["finalJPY"],score["finalJPY"])
   self.assertGreater(score["finalJPY"],new["finalJPY"])
   self.assertGreater(base["finalJPY"],s["BASE_21"][fee]["finalJPY"])
   self.assertGreater(base["maxDDPct"],30)
   self.assertGreater(base["maxDDPct"],s["BASE_21"][fee]["maxDDPct"])
   self.assertGreater(base["runnerFills"]["V4"],s["BASE_21"][fee]["runnerFills"]["V4"])
   self.assertLess(base["holdReasons"]["V4_MAX_DRAWDOWN_30PCT_HOLD"],
                   s["BASE_21"][fee]["holdReasons"]["V4_MAX_DRAWDOWN_21PCT_HOLD"])

 def test_full_account_dd_over30_and_first_breach(self):
  d=json.loads((ROOT/"STABLE4_DD21_VS_30_FIRST_THRESHOLD_BREACH_20261123.json").read_text(encoding="utf8"))
  self.assertEqual(d["BASE30"]["10"]["firstDDAboveUTC"]["30"],"2026-07-15T12:50:00Z")
  self.assertEqual(d["BASE30"]["30"]["firstDDAboveUTC"]["30"],"2026-07-15T14:10:00Z")
  for variant in ("BASE30","PENGU30","SCORE30"):
   for fee in ("10","30"):
    self.assertEqual(d[variant][fee]["equityRows"],105121)
    self.assertGreater(d[variant][fee]["maxDDPct"],30)
  self.assertTrue(M["otherRiskAndStopsUnchanged"])
  self.assertTrue(M["researchOnlyNoProductionMutation"])
  self.assertFalse(M["nonPenguEntriesAllRepricedAtAsterM5"])

if __name__=="__main__":
 unittest.main()
