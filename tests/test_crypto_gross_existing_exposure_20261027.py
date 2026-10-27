import unittest

from scripts.disdex_strict_portfolio_planner import (
    STRICT_CAPS,
    plan_crypto_entry_capacity,
    plan_v52_stock_capacity,
    validate_gross_snapshot,
)


class CryptoGrossExistingExposureTest(unittest.TestCase):
    BOUNDARIES = (2.99, 3.00, 3.01, 3.25, 3.50, 3.51)

    @staticmethod
    def snapshot(crypto_gross: float, stock_gross: float = 0.0) -> dict:
        return {
            "equityUsd": 1_000.0,
            "cryptoGross": crypto_gross,
            "stockGross": stock_gross,
            "totalGross": crypto_gross + stock_gross,
        }

    def test_existing_exposure_is_managed_separately_from_new_risk(self):
        for current in self.BOUNDARIES:
            with self.subTest(current=current):
                snapshot = validate_gross_snapshot(self.snapshot(current))
                self.assertEqual(snapshot["cryptoGross"], current)
                plan = plan_crypto_entry_capacity(snapshot, requested_gross=0.25)
                expected_increment = max(0.0, min(0.25, STRICT_CAPS.crypto_gross - current))
                self.assertAlmostEqual(plan["acceptedGross"], expected_increment)
                self.assertEqual(plan["newRiskAllowed"], expected_increment > 1e-9)
                self.assertTrue(plan["existingExposureManaged"])
                self.assertTrue(plan["protectedExitAllowed"])
                if current >= STRICT_CAPS.crypto_gross:
                    self.assertEqual(plan["entryCapForNewRisk"], current)

    def test_v52_stock_capacity_does_not_fail_on_crypto_overage(self):
        plan = plan_v52_stock_capacity(self.snapshot(3.25), requested_gross=0.50, slot_cap=0.50)
        self.assertEqual(plan["status"], "planned")
        self.assertAlmostEqual(plan["acceptedGross"], 0.50)
        self.assertTrue(plan["existingExposureManaged"])
        self.assertTrue(plan["protectedExitAllowed"])

    def test_above_3p5_rejects_new_stock_without_blocking_exit(self):
        snapshot = validate_gross_snapshot(self.snapshot(3.51))
        self.assertTrue(snapshot["cryptoGrossControl"]["protectedExitAllowed"])
        stock = plan_v52_stock_capacity(snapshot, requested_gross=0.25, slot_cap=0.25)
        self.assertEqual(stock["acceptedGross"], 0)
        self.assertEqual(stock["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
