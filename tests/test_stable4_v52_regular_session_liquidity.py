"""Regression tests: a full M5 clock is not proof of stock execution."""
from __future__ import annotations

from datetime import datetime, timezone
import copy
import json
import unittest
from pathlib import Path

from scripts.research.stable4_v52_regular_session_liquidity_audit import classify, verify_report

ROOT = Path(__file__).resolve().parents[1]
LIQUIDITY = ROOT / "docs/research/STABLE4_V52_REGULAR_SESSION_LIQUIDITY_20261128.json"
COVERAGE = ROOT / "docs/research/STABLE4_V52_STOCK_ASTER5M_YAHOO1H_COVERAGE_20261128.json"


def ms(when: str) -> int:
    return int(datetime.fromisoformat(when.replace("Z", "+00:00")).timestamp() * 1000)


class V52RegularSessionLiquidityTests(unittest.TestCase):
    def setUp(self):
        self.audit = json.loads(LIQUIDITY.read_text(encoding="utf8"))
        self.coverage = json.loads(COVERAGE.read_text(encoding="utf8"))

    def test_full_actual_annual_evidence_retains_no_order_boundary(self):
        verify_report(self.audit, self.coverage)
        self.assertEqual(set(self.audit["perTicker"]), {"AMZN", "META", "MSFT", "NVDA", "TSLA"})
        self.assertTrue(all(x["regularSessionZeroVolumePct"] > 29
                            for x in self.audit["perTicker"].values()))
        self.assertFalse(self.audit["productionEligible"])

    def test_new_york_daylight_savings_accurate_clock(self):
        self.assertEqual(classify(ms("2025-11-03T14:30:00Z"), 50),
                         "REGULAR_SESSION_POSITIVE_VOLUME_NOT_FILL_CERTIFIED")
        self.assertEqual(classify(ms("2026-07-06T13:30:00Z"), 0),
                         "REGULAR_SESSION_ZERO_VOLUME_NO_EXECUTION_EVIDENCE")
        self.assertEqual(classify(ms("2026-07-06T12:30:00Z"), 5),
                         "OUTSIDE_WEEKDAY_REGULAR_SESSION_UNVERIFIED")
        self.assertEqual(classify(ms("2026-07-04T13:30:00Z"), 10),
                         "OUTSIDE_WEEKDAY_REGULAR_SESSION_UNVERIFIED")

    def test_forged_counts_sha_or_fill_permission_never_pass(self):
        for mutate in (
            lambda obj: obj.__setitem__("orderAuthority", True),
            lambda obj: obj["perTicker"]["AMZN"].__setitem__("regularSessionZeroVolumeM5", 0),
            lambda obj: obj["perTicker"]["AMZN"].__setitem__("regularSessionZeroVolumePct", 0),
            lambda obj: obj["perTicker"]["TSLA"].__setitem__("sourceSha256", "0" * 64),
            lambda obj: obj["perTicker"]["NVDA"].__setitem__("signedQuoteOrFillProven", True),
            lambda obj: obj.__setitem__("allSevenNativeReplay", True),
            lambda obj: obj["perTicker"]["MSFT"].__setitem__("regularSessionPositiveVolumeM5", 999999),
        ):
            forged = copy.deepcopy(self.audit)
            mutate(forged)
            with self.assertRaisesRegex(ValueError, "V52_LIQUIDITY_"):
                verify_report(forged, self.coverage)

    def test_invalid_volume_timestamp_fail_closed(self):
        for value in (-1.0, float("nan"), float("inf")):
            with self.assertRaisesRegex(ValueError, "V52_INVALID_M5"):
                classify(ms("2026-07-06T13:30:00Z"), value)
        with self.assertRaisesRegex(ValueError, "V52_INVALID_M5"):
            classify(ms("2026-07-06T13:30:01Z"), 3)


if __name__ == "__main__":
    unittest.main()
