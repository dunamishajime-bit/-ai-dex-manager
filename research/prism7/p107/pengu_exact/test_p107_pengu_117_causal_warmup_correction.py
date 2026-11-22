import collections,json,unittest
from pathlib import Path
R=Path(__file__).resolve().parent
def read(name):return json.loads((R/name).read_text(encoding="utf8"))
class P107PenguPinned(unittest.TestCase):
 def test_legacy_116_exact_from_truncated_warmup(self):
  d=read("P107_PENGU_LEGACY_SEP24_TRUNCATED_1Y_116_COMPARISON_20261123.json")
  self.assertEqual((d["oldCandidateCount"],d["newBulkCandidateCount"],d["oldOnlyCount"],d["newOnlyCount"]),(116,116,0,0))
 def test_full_native_hourly_1000_and_999_complete_source(self):
  a=read("P107_PENGU_PIN_1Y_ASOF_1000_CLOSED_H1_RAW_SIGNAL_AUDIT_20261123.json")
  b=read("P107_PENGU_PIN_1Y_ASOF_999_CLOSED_H1_RAW_SIGNAL_AUDIT_20261123.json")
  self.assertEqual((a["hoursAssessed"],a["currentCandidateCount"],a["additionalCandidateCount"],a["missingOldCandidateCount"]),(8759,117,1,0))
  self.assertEqual((b["hoursAssessed"],b["currentCandidateCount"],b["additionalCandidateCount"],b["missingOldCandidateCount"]),(8759,117,1,0))
  self.assertFalse(a["sourceExceptions"])
  self.assertFalse(b["sourceExceptions"])
 def test_only_one_added_short_20251010(self):
  d=read("P107_PENGU_116_TO_117_EARLY_WARMUP_CORRECTION_VERDICT_20261123.json")
  a=d["correction"]["addedSourceNativeEvent"]
  self.assertEqual((a["signalTs"],a["entryTs"],a["route"],a["side"]),(1760061600000,1760065200000,"SHORT_V20","SHORT"))
  self.assertAlmostEqual(a["entryReferenceOpenPrice"],0.0301)
  self.assertEqual(d["correctedTape"]["byRoute"],{"LONG_V64":25,"RECOVERY_V8":51,"SHORT_V20":41})
  self.assertFalse(d["allRunnerP107FullParity"])
 def test_tape_no_mutation_or_live_fills(self):
  d=read("P107_PENGU_116_TO_117_EARLY_WARMUP_CORRECTION_VERDICT_20261123.json")
  rows=[json.loads(x) for x in (R/d["correctedTape"]["file"]).read_text(encoding="utf8").splitlines() if x.strip()]
  self.assertEqual(len(rows),117)
  self.assertEqual(len({(x["signalTs"],x["entryTs"],x["route"],x["side"]) for x in rows}),117)
  self.assertEqual(d["actualVenueOrders"],0)
  self.assertFalse(d["accountGrossSharedRiskDD21AndExitReplayPerformed"])
if __name__=="__main__":unittest.main()
