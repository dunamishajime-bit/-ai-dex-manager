import unittest,json,hashlib,gzip
from pathlib import Path
R=Path(__file__).resolve().parent
def get(n):return json.loads((R/n).read_text(encoding="utf8"))
class TestFETOfficialBinanceHybrid(unittest.TestCase):
 def test_monthly_checksum_and_coverage(self):
  d=get("P107_FET_OFFICIAL_BINANCE_H1_SOURCE_MANIFEST_20261123.json")
  self.assertEqual(len(d["monthlyInputs"]),11)
  self.assertTrue(all(x["archive_integrity"]=="OFFICIAL_SHA256_CHECKSUM_VERIFIED" for x in d["monthlyInputs"]))
  self.assertEqual((d["uniqueHourBars"],d["hourlyMissingGaps"]),(8088,0))
 def test_stitched_provenance_and_price_difference(self):
  x=get("P107_FET_BINANCE_ASTERV3_CROSSVENUE_OVERLAP_AND_HYBRID_MANIFEST_20261123.json")
  self.assertEqual((x["binanceUsedForHoursBeforeCutover"],x["asterUsedAtOrAfterCutover"],x["sourceOverlapCount"]),(7554,6342,534))
  self.assertEqual((x["combinedTotalHours"],x["combinedHourGaps"]),(13896,0))
  self.assertGreater(x["absClosePriceCrossVenueDifferencePct"]["max"],4)
  p=R/x["mixedDataset"]["filename"]
  self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),x["mixedDataset"]["sha256"])
  self.assertTrue(x["notAsterExecutionBeforeFirstAsterFETCandle"])
 def test_six_aster_nonexecutable_and_11_matches(self):
  x=get("P107_FET_BINANCE_WARMUP_ASTERV3_ENTRY_NATIVE_SIGNAL_COMPARISON_20261123.json")
  self.assertEqual((x["newNativeCount"],x["oldCount"],x["oldOnly"],x["newOnly"],x["featuresPriceMismatches"]),(17,11,0,6,0))
  self.assertEqual((x["binanceOnlyBeforeFirstAsterSignals"],x["mixedWarmupAsterVenueCandidateSignals"],x["pureAsterVenueCandidateSignals"]),(6,0,11))
  self.assertEqual(x["simulatedVenueOrders"],0)
  self.assertTrue(all(not y["historicalAsterExecutable"] for y in x["newOnlyExamples"]))
 def test_q102_49_remains_raw_source_only(self):
  x=get("P107_Q102_NATIVE_FET_BINANCE_BACKFILL_FULL_UNIVERSE_COMPARISON_20261123.json")
  self.assertEqual((x["gridTotal"],x["sourceEvaluated"],x["preflightBlocked"],x["selectedUnconstrainedCandidateCount"]),(2190,499,1691,49))
  self.assertFalse(x["fullSTABLE4AccountBT"])
if __name__=="__main__":unittest.main()
