import unittest

from scripts.disdex_strict_portfolio_planner import STRICT_CAPS, assert_strict_live_configuration


class FinalDynamicGrossStrictCapsTest(unittest.TestCase):
    def test_final_runtime_caps(self):
        self.assertEqual(STRICT_CAPS.v12_base_gross, 2.0)
        self.assertEqual(STRICT_CAPS.v12_gross, 2.0)
        self.assertEqual(STRICT_CAPS.stock_gross, 4.0)
        self.assertEqual(STRICT_CAPS.stock_slot_gross, 2.0)
        self.assertEqual(STRICT_CAPS.crypto_gross, 3.0)
        self.assertEqual(STRICT_CAPS.total_gross, 4.25)

    def test_runtime_environment_matches_final_contract(self):
        caps = assert_strict_live_configuration({
            "STRICT_PORTFOLIO_PLANNER_ACTIVE": "true",
            "V12_BASE_GROSS_CAP": "2.0",
            "V12_DYNAMIC_GROSS_CAP": "2.0",
            "V12_GROSS_CAP": "2.0",
            "PENGU_GROSS_CAP": "1.0",
            "STOCK_GROSS_CAP": "4.0",
            "CRYPTO_GROSS_CAP": "3.0",
            "TOTAL_GROSS_CAP": "4.25",
            "DISDEX_V52_STOCK_GROSS_CAP": "4.0",
            "DISDEX_V52_V11_GROSS_CAP": "2.0",
            "DISDEX_V52_V50_GROSS_CAP": "2.0",
            "DISDEX_V52_CRYPTO_GROSS_CAP": "3.0",
            "DISDEX_V52_PORTFOLIO_GROSS_CAP": "4.25",
            "QUALITY102_LIVE_ENABLED": "false",
            "QUALITY102_LIVE_SELECTOR_PARITY": "false",
        })
        self.assertEqual(caps.total_gross, 4.25)


if __name__ == "__main__":
    unittest.main()
