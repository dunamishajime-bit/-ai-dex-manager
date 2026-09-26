"""Source-identity tests only: standalone allocation studies CANNOT authorize a formal five-sleeve number."""
import json
import unittest
from decimal import Decimal as D
from pathlib import Path

CONTRACT = Path("scripts/research/canonical_integrated_bt/pengu_variant_comparison_contract_20260926.json")


class VerifiedPenguVariantSourceContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = json.loads(CONTRACT.read_text(encoding="utf-8"))
        cls.modes = {x["id"]: x for x in cls.c["additionalAllocationFamilySixReference"]}
        cls.arms = {x["id"]: x for x in cls.c["requiredPortfolioArms"]}

    def test_source_sha_and_real_completed_ci_are_pinned(self):
        src = self.c["basis"]["allocationSource"]
        self.assertEqual(src["commit"], "007ed8f9ccd775e5b3bb9e5348b829abc7911503")
        self.assertEqual(src["ciRunId"], 35920417464)
        self.assertEqual(src["ciJobConclusion"], "success")
        self.assertTrue(src["standaloneOnly"])
        self.assertEqual(len(self.modes), 6)

    def test_scaled_and_flat_new_penguin_are_distinct(self):
        linear = self.arms["CAP1_ALL_OLD_ORDERS_LINEAR"]
        flat = self.arms["CAP1_EVERY_ENTRY_FLAT"]
        q60 = self.arms["FLAT1_Q60_DD170_H72"]
        self.assertNotEqual(linear["entryGross"], flat["entryGross"])
        self.assertEqual(flat["entryGross"], q60["entryGross"])
        self.assertFalse(flat["q60"])
        self.assertEqual(q60["q60"]["hours"], 60)
        self.assertEqual(q60["realizedDdGovernor"]["holdNewEntryHours"], 72)
        self.assertEqual(q60["realizedDdGovernor"]["basis"], "actual portfolio-accepted PENGU closed trades ONLY")
        self.assertTrue(q60["realizedDdGovernor"]["protectiveExitsRemainEnabled"])

    def test_uniform_scale_matches_original_allocation_exactly_before_rounding(self):
        x = self.modes["CAP1_ALL_OLD_ORDERS_LINEAR"]
        for target, origin in [("v64Low", "0.1875"), ("recoveryInitial", "0.5"),
                               ("recoveryPartial", "0.25"), ("atrFloor", "0.6")]:
            self.assertLess(abs(D(x[target])-D(origin)/D("0.85")), D("0.000000000000001"))
            self.assertLessEqual(D(x[target]), 1)
        self.assertLess(abs(2*D(x["recoveryPartial"])-D(x["recoveryInitial"])), D("0.000000000000001"))

    def test_all_six_formal_references_are_standalone_not_formal_portfolio(self):
        for mode in self.modes.values():
            self.assertLessEqual(D(mode["v64Low"]), 1)
            self.assertLessEqual(D(mode["recoveryInitial"]), 1)
            self.assertLessEqual(D(mode["recoveryPartial"]), 1)
            self.assertTrue(D(mode["formalNormal"]["pf"]) > 0)
            self.assertTrue(D(mode["formalSevere"]["pf"]) > 0)
        self.assertEqual(self.modes["CAP1_ALL_OLD_ORDERS_LINEAR"]["formalNormal"]["returnPct"], "820.07")
        self.assertEqual(self.modes["CAP1_EVERY_ENTRY_FLAT"]["formalNormal"]["returnPct"], "1307.91")
        self.assertEqual(self.modes["CAP1_EVERY_ENTRY_FLAT"]["formalSevere"]["maxDdPct"], "-22.60")
        self.assertEqual(self.c["status"], "RESEARCH_SOURCE_VERIFIED_STANDALONE_ONLY")

    def test_q60_69_68_are_standalone_counts_not_integrated_predictions(self):
        q = self.c["q60StandaloneReference"]
        self.assertEqual((q["normal"]["trades"], q["severe"]["trades"]), (69, 68))
        self.assertEqual(q["normal"]["maxDdPct"], "-15.05")
        self.assertEqual(q["severe"]["maxDdPct"], "-16.99")
        self.assertTrue(self.arms["FLAT1_Q60_DD170_H72"]["sourceStandaloneOnly"])

    def test_formal_anchor_parity_remains_evidence_blocked(self):
        b = self.c["basis"]["originalFormalAnchor"]
        self.assertEqual(b["normalJpy"], "740771278.01")
        self.assertEqual(b["severeJpy"], "65669109.00")
        self.assertIsNone(b["canonicalRunId"])
        self.assertFalse(b["exactStrategyLedgersVerified"])
        self.assertFalse(self.c["formalBaselineParityVerified"])
        self.assertFalse(self.c["formalFiveStrategyComparisonVerified"])
        self.assertEqual(self.c["comparisonStatus"], "BLOCKED_MISSING_CANONICAL_SOURCE")
        self.assertTrue(self.c["noLiveChanges"])


if __name__ == "__main__":
    unittest.main()
