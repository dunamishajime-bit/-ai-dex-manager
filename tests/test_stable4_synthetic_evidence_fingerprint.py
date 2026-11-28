"""Offline synthetic fingerprints must ignore timing but preserve trading evidence."""
from __future__ import annotations

import copy
import json
import math
import unittest

from scripts.stable4_synthetic_evidence_fingerprint import (
    canonical_result_bytes,
    canonical_result_sha256,
)


class Stable4ResearchFingerprintTests(unittest.TestCase):
    def setUp(self):
        self.sample = {
            "status": "PARTIAL_RESEARCH_ONLY",
            "cases": [{
                "regime": "SQUEEZE",
                "seed": 2026112801,
                "hype": {
                    "runtimeMs": 150,
                    "signals": 7,
                    "opened": 2,
                    "maxDD": 29.33,
                    "terminal": 8689.65,
                    "exits": {"STOP": 1, "TIME": 1},
                },
            }],
        }

    def test_runtime_profiling_does_not_change_trading_evidence_hash(self):
        a = self.sample
        b = copy.deepcopy(a)
        b["cases"][0]["hype"]["runtimeMs"] = 2150
        self.assertNotEqual(json.dumps(a), json.dumps(b))
        self.assertEqual(canonical_result_sha256(a), canonical_result_sha256(b))

    def test_price_profit_dd_exit_seed_and_case_order_remain_bound(self):
        baseline = canonical_result_sha256(self.sample)
        for mutate in (
            lambda s: s["cases"][0]["hype"].__setitem__("terminal", 8690),
            lambda s: s["cases"][0]["hype"].__setitem__("maxDD", 29.34),
            lambda s: s["cases"][0]["hype"]["exits"].__setitem__("STOP", 2),
            lambda s: s["cases"][0].__setitem__("seed", 2026112802),
        ):
            b = copy.deepcopy(self.sample)
            mutate(b)
            self.assertNotEqual(canonical_result_sha256(b), baseline)
        self.assertNotIn(b"runtimeMs", canonical_result_bytes(self.sample))

    def test_invalid_nan_or_infinite_metrics_never_have_digest(self):
        for number in (math.nan, math.inf, -math.inf):
            x = copy.deepcopy(self.sample)
            x["cases"][0]["hype"]["terminal"] = number
            with self.assertRaises(ValueError):
                canonical_result_sha256(x)


if __name__ == "__main__":
    unittest.main()
