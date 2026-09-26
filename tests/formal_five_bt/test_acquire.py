import unittest

from research.formal_five_bt.acquire import END_DATE, START_DATE, WARMUP_START, extract_universes


class AcquisitionContractTests(unittest.TestCase):
    def test_universes_are_extracted_from_the_audited_runtime_config(self):
        result = extract_universes()
        self.assertEqual(len(result["V12"]), 14)
        self.assertIn("PENGUUSDT", result["PENGU"])
        self.assertGreaterEqual(len(result["Q102"]), 20)
        self.assertEqual(result["FET"], ["FETUSDT"])
        self.assertEqual(len(result["crypto_union"]), len(set(result["crypto_union"])))

    def test_acquisition_dates_cover_q102_warmup_and_complete_bt_year(self):
        self.assertLess(WARMUP_START, START_DATE)
        self.assertEqual(START_DATE.isoformat(), "2025-08-10")
        self.assertEqual(END_DATE.isoformat(), "2026-08-11")


if __name__ == "__main__":
    unittest.main()
