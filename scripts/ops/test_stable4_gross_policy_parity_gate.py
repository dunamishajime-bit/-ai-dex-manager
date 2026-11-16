import unittest
from stable4_gross_policy_parity_gate import source_policy, compare_manifest


CANDIDATE = b"""const productionRisk = Object.freeze({
 cryptoGrossCap: 3.0, stockGrossCap: 4.0, totalGrossCap: 4.25,
 v4TotalGrossCap: 4.75, sharedDailyLossPct: 7.5
});"""


def example_manifest(stock=1.5, total=3.5, v4=None):
    row = {
        "crypto_cap": 3.0, "stock_cap": stock, "total_cap": total,
        "initial_jpy": 10000, "max_hourly_dd_pct": -22,
    }
    if v4 is not None:
        row["v4_total_cap"] = v4
    return {
        "period": ["2025-10-01T00:00:00Z", "2026-10-01T00:00:00Z"],
        "status": "MODEL_RESEARCH_ONLY_NOT_PRODUCTION_PARITY",
        "results": [{**row, "cost_bps_roundtrip": bps} for bps in (10, 30)],
    }


class GrossSourceParityTests(unittest.TestCase):
    def test_static_exact_candidate_policy(self):
        self.assertEqual(source_policy(CANDIDATE), {
            "cryptoGrossCap": 3.0, "stockGrossCap": 4.0,
            "totalGrossCap": 4.25, "v4TotalGrossCap": 4.75,
        })

    def test_stock_total_delta_and_missing_v4_exception_block(self):
        rows = compare_manifest(source_policy(CANDIDATE), example_manifest())
        self.assertEqual([len(r["capMismatches"]) for r in rows], [3, 3])
        self.assertEqual({v["cap"] for v in rows[0]["capMismatches"]},
                         {"stockGrossCap", "totalGrossCap", "v4TotalGrossCap"})
        self.assertFalse(rows[0]["candidateSourceAndVenueParityVerified"])

    def test_all_numeric_caps_still_not_source_parity(self):
        rows = compare_manifest(source_policy(CANDIDATE),
                                example_manifest(stock=4, total=4.25, v4=4.75))
        self.assertTrue(all(v["numericGrossContractMatched"] for v in rows))
        self.assertTrue(all(not v["eligibleForLiveCutover"] for v in rows))

    def test_missing_or_duplicate_candidate_caps_are_rejected(self):
        for src in (
            CANDIDATE.replace(b"stockGrossCap: 4.0,", b""),
            CANDIDATE.replace(b"stockGrossCap: 4.0", b"stockGrossCap: 4.0, stockGrossCap: 1.5"),
            CANDIDATE.replace(b"v4TotalGrossCap: 4.75", b"v4TotalGrossCap: process.env.CAP"),
        ):
            with self.assertRaisesRegex(ValueError, "CAP_MISSING_OR_AMBIGUOUS"):
                source_policy(src)

    def test_manifest_costs_and_period_cannot_be_ambiguous(self):
        caps = source_policy(CANDIDATE)
        wrong = example_manifest()
        wrong["results"][1]["cost_bps_roundtrip"] = 10
        with self.assertRaisesRegex(ValueError, "BPS_CASES"):
            compare_manifest(caps, wrong)
        wrong = example_manifest()
        wrong["status"] = "CERTIFIED_LIVE"
        with self.assertRaisesRegex(ValueError, "RESEARCH_ONLY"):
            compare_manifest(caps, wrong)


if __name__ == "__main__":
    unittest.main()