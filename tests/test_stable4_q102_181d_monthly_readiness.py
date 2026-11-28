"""Exact source-hash, 181d input integrity, partial-result boundaries."""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from scripts.research.stable4_q102_181d_monthly_readiness import verify_monthly_snapshot

ROOT=Path(__file__).resolve().parents[1]
MONTHLY=ROOT/"docs/research/STABLE4_Q102_ASTER_H1_MONTHLY_181D_READINESS_20261128.json"
INTEGRITY=ROOT/"docs/research/STABLE4_Q102_ASTER_H1_181D_ARCHIVE_SOURCE_INTEGRITY_20261128.json"


class MonthlyQ102HistoryIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.monthly=json.loads(MONTHLY.read_text(encoding="utf8"))
        self.source=json.loads(INTEGRITY.read_text(encoding="utf8"))

    def test_monthly_181d_windows_are_internally_consistent_not_trade_evidence(self):
        verify_monthly_snapshot(self.monthly,self.source)
        expected={"APT":12,"ARB":12,"BTC":6,"ENA":10,"FIL":4,"ONDO":12,"OP":12,"SEI":12,"SUI":12,"TRX":12}
        self.assertEqual({k:v["historyReadyMonths"] for k,v in self.monthly["byTicker"].items()},expected)
        self.assertFalse(self.monthly["orderAuthority"])
        self.assertFalse(self.monthly["fullQ102NativeTradeReplay"])
        btc=self.monthly["byTicker"]["BTC"]["months"]
        self.assertEqual([x["decisionMonth"] for x in btc if x["status"]=="H1_181D_CLOSED_HISTORY_ONLY"],[
            "2026-04","2026-05","2026-06","2026-07","2026-08","2026-09"])
        self.assertEqual(self.monthly["byTicker"]["ENA"]["months"][0]["status"],"H1_181D_INCOMPLETE_SOURCE")

    def test_sha_price_status_order_and_coverage_forgery_fail_closed(self):
        tests=[
            lambda x:x.__setitem__("orderAuthority",True),
            lambda x:x.__setitem__("fullSevenRunnerWalletReplay",True),
            lambda x:x["byTicker"]["BTC"].__setitem__("inputSha256","0"*64),
            lambda x:x["byTicker"]["BTC"]["months"][0].__setitem__("status","H1_181D_CLOSED_HISTORY_ONLY"),
            lambda x:x["byTicker"]["BTC"]["months"][0].__setitem__("badH1",0),
            lambda x:x["byTicker"]["FIL"].__setitem__("historyReadyMonths",12),
            lambda x:x["byTicker"]["APT"]["months"][0].__setitem__("venueEntryProven",True),
            lambda x:x["byTicker"]["APT"]["months"][0].__setitem__("missingH1",-1),
            lambda x:x["byTicker"]["APT"]["months"][0].__setitem__("decisionMonth","2026-11"),
        ]
        for mutate in tests:
            forged=copy.deepcopy(self.monthly)
            mutate(forged)
            with self.assertRaisesRegex(ValueError,"Q102_MONTHLY_HISTORY_"):
                verify_monthly_snapshot(forged,self.source)


if __name__=="__main__":
    unittest.main()
