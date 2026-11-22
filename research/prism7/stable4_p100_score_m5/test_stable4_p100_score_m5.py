"""STABLE4/P100 source, 5m-readiness and portfolio-replay regression."""
import csv
import io
import json
import hashlib
import unittest
from pathlib import Path
import zipfile

ROOT=Path(__file__).resolve().parent
MAN=json.loads((ROOT/"STABLE4_P100_SCORE_M5_RESEARCH_MANIFEST_20261123.json").read_text(encoding="utf8"))
ZIP=ROOT/MAN["evidenceZip"]["filename"]

class ScoreM5ResearchEvidenceTests(unittest.TestCase):
 def test_evidence_zip_original_sha(self):
  self.assertEqual(hashlib.sha256(ZIP.read_bytes()).hexdigest(),MAN["evidenceZip"]["sha256"])
  with zipfile.ZipFile(ZIP) as a:
   count=0
   for folder,records in MAN["evidenceZip"]["entriesSourceSHA"].items():
    for file,meta in records.items():
     payload=a.read(folder+"/"+file)
     self.assertEqual(len(payload),meta["bytes"])
     self.assertEqual(hashlib.sha256(payload).hexdigest(),meta["sha256"])
     count+=1
   self.assertGreater(count,42)

 def test_p100_applied_partially_30bps_dd_worse(self):
  d=MAN["pairedSummaries"]
  for bps in ["10","30"]:
   b=d[bps]["PENGU_BASE"]
   s=d[bps]["P100_SCORE"]
   self.assertGreater(s["final_compounded_jpy"],b["final_compounded_jpy"])
   self.assertGreater(abs(s["max_hourly_dd_pct"]),20)
  self.assertGreater(abs(d["30"]["P100_SCORE"]["max_hourly_dd_pct"]),
                     abs(d["30"]["PENGU_BASE"]["max_hourly_dd_pct"]))
  self.assertEqual(d["30"]["PENGU_BASE"]["modeled_fills"],466)
  self.assertEqual(d["30"]["P100_SCORE"]["modeled_fills"],462)

 def test_p97_coverage_is_not_misrepresented(self):
  s=MAN["P97ScoreSourceMatching"]
  self.assertEqual((s["matched"],s["matchedQ102"],s["matchedIDLE"],s["IDLE_unmatched"]),(80,33,47,150))
  self.assertTrue(s["unmatchedScoreNotGated"])
  self.assertFalse(MAN["binanceIndependentNativeSignalsForNonPENGU"])
  self.assertTrue(MAN["fiveMinuteExecutionBTForNonPENGUPending"])
  self.assertTrue(MAN["notCurrentVPSParity"])
  self.assertTrue(MAN["noSignedExecutionEvidence"])

 def test_5m_readiness_not_fill(self):
  r=json.loads((ROOT/"STABLE4_P100_COMPOSITE_ASTERM5_FIVE_MIN_ENTRY_PRINT_READINESS_20261123.json").read_text(encoding="utf8"))
  z=r["aggregates"]
  self.assertEqual(z["ALL"]["count"],230)
  self.assertEqual(z["ALL"]["m5CompletedAvailable"],230)
  self.assertEqual(z["ALL"]["completedM5HasPrint"],137)
  self.assertEqual(z["ALL"]["nextM5HasPrintExpost"],121)
  self.assertEqual(z["SCORE_PASSED"]["count"],59)
  self.assertEqual(z["SCORE_PASSED"]["completedM5HasPrint"],36)
  self.assertEqual(z["SCORE_PASSED"]["nextM5HasPrintExpost"],31)
  self.assertFalse(r["actualSignedFills"])
  self.assertTrue(all(not c["resimulatedNativeStopAfterM5Entry"] for c in r["perCandidateEvidence"]))

 def test_wrapper_and_overlay_compile_and_copied_sha(self):
  for a in MAN["sourceCopiedFiles"].values():
   p=ROOT/a["filename"]
   self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),a["sha256"])
  script=ROOT/"portfolio_stable4_pengu_bin5_p100_composite_gate_20261123.py"
  compile(script.read_text(encoding="utf8"),str(script),"exec")

if __name__=="__main__":
 unittest.main()
