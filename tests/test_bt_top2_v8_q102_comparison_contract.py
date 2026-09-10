import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "bt_top2_v8_q102_comparison_contract_20260910.json"


class ComparisonContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_period_and_capital_are_frozen(self):
        c = self.contract
        self.assertEqual(c["period"], {
            "startInclusive": "2025-08-10T00:00:00.000Z",
            "endExclusive": "2026-08-10T00:00:00.000Z",
        })
        self.assertEqual(c["capital"]["initialJpy"], 100000)
        self.assertEqual(c["capital"]["monthlyContributionJpy"], 0)
        self.assertEqual(c["capital"]["additionalContributionCount"], 0)
        self.assertTrue(c["capital"]["compounding"])

    def test_candidate_matrix_is_exactly_six_cases(self):
        rows = self.contract["canonicalBaselines"]
        self.assertEqual(len(rows), 6)
        keys = {(r["v12"]["slots"], r["v12"]["grossCap"], r["pengu"]) for r in rows}
        self.assertEqual(keys, {
            (1, 1.0, "V20"), (1, 1.5, "V20"), (2, 1.5, "RECOVERY_V8_ON"),
            (1, 1.0, "RECOVERY_V8_ON"), (1, 1.5, "RECOVERY_V8_ON"), (2, 1.5, "V20"),
        })

    def test_known_endpoints_and_research_winner_are_frozen(self):
        by_id = {r["id"]: r for r in self.contract["canonicalBaselines"]}
        self.assertEqual(by_id["v12_1slot_1p0_v20"]["normal"]["endingAssetJpy"], 6117151)
        self.assertEqual(by_id["v12_top2_1p5_v8"]["normal"]["endingAssetJpy"], 15101400)
        self.assertEqual(self.contract["researchChampion"], "v12_top2_1p5_v8")
        self.assertFalse(self.contract["liveAdoption"]["enabled"])

    def test_semantics_prevent_leverage_misinterpretation(self):
        s = self.contract["semantics"]
        self.assertEqual(s["top2Meaning"], "SECOND_INDEPENDENT_V12_OPPORTUNITY_WITH_RESIDUAL_GROSS")
        self.assertEqual(s["oneSlot1p5Status"], "REJECTED_AS_DEFAULT_CANDIDATE")
        self.assertEqual(s["penguRecoveryCooldownHours"], 24)

    def test_all_baselines_are_research_only_and_gross_clean(self):
        for row in self.contract["canonicalBaselines"]:
            self.assertEqual(row["status"], "PASS_RESEARCH_ONLY")
            self.assertEqual(row["checksPassed"], 24)
            self.assertEqual(row["checksTotal"], 24)
            self.assertEqual(row["grossConflictCount"], 0)

    def test_historical_baseline_and_implementation_candidate_are_not_conflated(self):
        c = self.contract
        self.assertEqual(c["sharedConditions"]["quality102GrossCap"], 0.5)
        self.assertEqual(c["sharedConditions"]["quality102Slots"], 1)
        self.assertEqual(
            c["researchChampionStrategyName"],
            "V12_TOP2_1.5 + PENGU_V20_V8 + V52_TOP2 + Q102_0.5",
        )
        self.assertEqual(
            c["implementationCandidate"]["strategyName"],
            "V12_TOP2_1.5 + PENGU_V20_V8 + V52_TOP2 + Q102_1.0_1SLOT",
        )
        self.assertEqual(c["implementationCandidate"]["quality102"], {"grossCap": 1.0, "slots": 1})
        self.assertEqual(c["nextExperimentContract"]["fixedQuality102"]["grossCap"], 1.0)
        self.assertEqual(c["nextExperimentContract"]["fixedQuality102"]["slots"], 1)
        self.assertEqual(c["nextExperimentContract"]["fixedPengu"]["short"], "SHORT_V20")
        self.assertEqual(c["nextExperimentContract"]["fixedPengu"]["recovery"], "RECOVERY_V8_ON")


if __name__ == "__main__":
    unittest.main()
