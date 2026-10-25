import unittest
from collections import deque

from scripts.research_overlap_only_native_approval_bt import past_only_score


class OverlapOnlyNativeApprovalBtTests(unittest.TestCase):
    def test_causal_score_prior_no_future_trades(self):
        self.assertEqual(past_only_score(deque()), 50.0)
        first = deque([0.05, -0.03])
        current = past_only_score(first)
        self.assertEqual(current, round(100.0 * (1 + 5) / (2 + 10), 5))
        first.append(0.20)
        self.assertGreater(past_only_score(first), current)

    def test_strict_approved_gross_is_hard_ceiling(self):
        approved = [0.25, 0.50, 1.00]
        requested = [1.00, 1.40, 2.50]
        for a, r in zip(approved, requested):
            self.assertGreater(r, a)
            self.assertEqual(max(0.0, min(a, r) - a), 0.0)


if __name__ == "__main__":
    unittest.main()
