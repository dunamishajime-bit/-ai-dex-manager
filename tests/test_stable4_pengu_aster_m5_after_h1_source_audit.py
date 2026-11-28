"""166 genuine PENGU H1 source observations vs two SHA-pinned Aster M5 tapes.

No entry fills or profitability can be inferred from public M5 volume.
"""
from __future__ import annotations

import copy
import hashlib
import json
import unittest
from pathlib import Path

from scripts.research.stable4_pengu_aster_m5_after_h1_source_audit import verify_report
from scripts.research.stable4_pengu_native_h1_ledger_audit import validate as validate_h1

ROOT=Path(__file__).resolve().parents[1]
LEDGER=ROOT/"docs/research/STABLE4_PENGU_BINANCE_NATIVE_H1_LEDGER_20261128.json"
QUALITY=ROOT/"docs/research/STABLE4_PENGU_BINANCE_H1_ASTER_M5_CANDIDATE_QUALITY_20261128.json"


class PenguH1AsterM5TapeAuditTests(unittest.TestCase):
    def setUp(self):
        self.raw=LEDGER.read_bytes()
        self.ledger=json.loads(self.raw)
        self.report=json.loads(QUALITY.read_text(encoding="utf8"))

    def test_166_real_raw_signals_mapped_to_m5_without_venue_fills(self):
        source=validate_h1(self.ledger)
        self.assertEqual(source["checkedTotal"],166)
        self.assertEqual(hashlib.sha256(self.raw).hexdigest(),
            "d128ad78aed642b84eed105e85b73dc1856a3e657e1ad924ec17e5a9aff023fc")
        self.assertEqual(hashlib.sha256(QUALITY.read_bytes()).hexdigest(),
            "f22b0aa4d9afcde3f0336d1884be54330d9c15b7ab6a2c6281e0f11f455a6f0d")
        verify_report(self.report,self.ledger,self.raw)
        self.assertEqual(self.report["archiveClockCoverage"]["totalM5"],107136)
        self.assertEqual(self.report["archiveClockCoverage"]["invalidM5"],0)
        self.assertEqual(self.report["archiveClockCoverage"]["zeroVolumeM5"],57483)
        self.assertEqual(self.report["arms"]["BASE"]["first5mPositiveVolume"],32)
        self.assertEqual(self.report["arms"]["V8_V64"]["first5mPositiveVolume"],69)
        self.assertEqual(self.report["arms"]["BASE"]["first15mAllZero"],9)
        self.assertEqual(self.report["arms"]["V8_V64"]["first15mAllZero"],18)
        self.assertEqual(self.report["crossArmDedup"],{
            "baseline":54,"v8V64":112,"shared":54,"onlyBaseline":0,
            "onlyV8V64":58,"union":112,
            "extendedOnlyByRoute":{"LONG_V2_FINAL":10,"RECOVERY_V8":48},
            "crossArmEventsAreIndependentTrades":False,
        })
        for arm in ("BASE","V8_V64"):
            self.assertEqual(self.report["arms"][arm]["actualVenueFillsVerified"],0)
            for event in self.report["events"][arm]:
                self.assertFalse(event["entryExecuted"])
                self.assertFalse(event["nativeExitReplayed"])
        self.assertFalse(self.report["orderAuthority"])
        self.assertFalse(self.report["entryExecutionOrNativeExitCertified"])

    def test_fake_execution_volume_clock_ledger_and_source_digest_fail_closed(self):
        changes=[
            lambda r:r.__setitem__("orderAuthority",True),
            lambda r:r.__setitem__("entryExecutionOrNativeExitCertified",True),
            lambda r:r["arms"]["BASE"].__setitem__("actualVenueFillsVerified",1),
            lambda r:r["arms"]["BASE"].__setitem__("first5mPositiveVolume",54),
            lambda r:r["archiveClockCoverage"].__setitem__("zeroVolumeM5",9999999),
            lambda r:r["asterM5SourceFiles"][0].__setitem__("sha256","0"*64),
            lambda r:r["asterM5SourceFiles"][1].__setitem__("firstMs",1),
            lambda r:r["events"]["BASE"][0].__setitem__("entryExecuted",True),
            lambda r:r["events"]["BASE"][0].__setitem__("entryTs",1),
            lambda r:r["events"]["BASE"][0].__setitem__("firstM5CompleteAt",1),
            lambda r:r["events"]["BASE"][0].__setitem__("m5HasPositiveVolumeNotFillProof",False),
            lambda r:r["events"]["BASE"][0].__setitem__("status","M5_15M_ALL_ZERO_VOLUME"),
            lambda r:r.__setitem__("sourceH1LedgerSha256","0"*64),
            lambda r:r["crossArmDedup"].__setitem__("union",166),
            lambda r:r["crossArmDedup"].__setitem__("shared",0),
            lambda r:r["crossArmDedup"].__setitem__("crossArmEventsAreIndependentTrades",True),
        ]
        with self.assertRaisesRegex(ValueError,"PENGU_M5_REPORT_"):
            verify_report(self.report,self.ledger,self.raw+b" ")
        for mutate in changes:
            forged=copy.deepcopy(self.report)
            mutate(forged)
            with self.assertRaisesRegex(ValueError,"PENGU_M5_REPORT_"):
                verify_report(forged,self.ledger,self.raw)


if __name__=="__main__":
    unittest.main()
