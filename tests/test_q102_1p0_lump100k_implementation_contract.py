import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULT = ROOT / "research" / "q102_1p0_1slot_lump100k_1y_20260911.json"
CONTRACT = ROOT / "research" / "bt_top2_v8_q102_comparison_contract_20260910.json"

class Q102OnePointZeroImplementationContractTest(unittest.TestCase):
    def test_research_result_is_the_implementation_baseline(self):
        result = json.loads(RESULT.read_text(encoding="utf-8"))
        self.assertEqual(result["strategy"], "V12_TOP2_1.5 + PENGU_V20_V8 + V52_TOP2 + Q102_1.0_1SLOT")
        self.assertEqual(result["capital"], {"initialJpy": 100000, "monthlyContributionJpy": 0, "totalContributedJpy": 100000, "compounding": True})
        self.assertEqual(result["status"], "PASS_RESEARCH_ONLY")
        self.assertTrue(all(result["checks"].values()))
        self.assertEqual(len(result["checks"]), 28)
        self.assertEqual(result["results"]["NORMAL"]["maxQ102Gross"], 1.0)
        self.assertEqual(result["results"]["NORMAL"]["grossConflicts"], 0)
        self.assertLessEqual(abs(result["results"]["SEVERE"]["DDPct"]), 20.0)
        self.assertAlmostEqual(result["results"]["NORMAL"]["endingAssetJpy"], 63349871.26015618, places=4)

    def test_comparison_contract_points_to_validated_handoff(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        candidate = contract["implementationCandidate"]
        self.assertEqual(candidate["strategyName"], "V12_TOP2_1.5 + PENGU_V20_V8 + V52_TOP2 + Q102_1.0_1SLOT")
        self.assertEqual(candidate["status"], "RESEARCH_VALIDATED_FOR_IMPLEMENTATION_HANDOFF")
        self.assertEqual(candidate["evidence"], "research/q102_1p0_1slot_lump100k_1y_20260911.json")
        self.assertFalse(contract["liveAdoption"]["enabled"])

if __name__ == "__main__":
    unittest.main()
