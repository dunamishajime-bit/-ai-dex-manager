import unittest

from scripts.disdex_aster_rate_budget_policy import classify_aster_rate_budget_failure


class AsterRateBudgetPolicyTests(unittest.TestCase):
    def test_classifies_only_known_pre_request_budget_failures(self):
        self.assertEqual(
            classify_aster_rate_budget_failure("ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005"),
            {
                "kind": "RATE_BUDGET_DEFERRED",
                "reason": "ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005",
                "waitMs": 5005,
            },
        )
        self.assertEqual(
            classify_aster_rate_budget_failure("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT"),
            {"kind": "RATE_BUDGET_DEFERRED", "reason": "ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT"},
        )
        for message in ("ASTER_GLOBAL_RATE_BUDGET_MALFORMED", "HTTP 429", "ECONNRESET", "UNKNOWN"):
            self.assertIsNone(classify_aster_rate_budget_failure(message), message)


if __name__ == "__main__":
    unittest.main()
