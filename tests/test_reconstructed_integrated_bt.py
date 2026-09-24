import unittest

from scripts.research.reconstructed_integrated_bt.engine import deposits, is_gross_conflict


class ReconstructedIntegratedBtContractTests(unittest.TestCase):
    def test_stock_entry_does_not_count_as_crypto_cap_conflict(self):
        self.assertFalse(
            is_gross_conflict(
                strategy="V52",
                crypto_after=4.06,
                total_after=6.06,
                crypto_cap=4.0,
                total_cap=7.0,
            )
        )

    def test_crypto_entry_still_counts_against_crypto_cap(self):
        self.assertTrue(
            is_gross_conflict(
                strategy="V12",
                crypto_after=4.06,
                total_after=6.06,
                crypto_cap=4.0,
                total_cap=7.0,
            )
        )

    def test_one_year_schedule_has_initial_plus_twelve_monthly_deposits(self):
        schedule = deposits()
        self.assertEqual(len(schedule), 13)
        self.assertEqual(sum(amount for _, amount in schedule), 130_000.0)


if __name__ == "__main__":
    unittest.main()
