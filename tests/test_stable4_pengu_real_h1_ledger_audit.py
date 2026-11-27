"""Fail-closed native PENGU source-event proof, independent of venue execution."""
from __future__ import annotations

import copy
import json
import unittest
from unittest.mock import patch

from scripts.research import stable4_pengu_native_h1_ledger_audit as audit


class PenguNativeAnnualLedgerTests(unittest.TestCase):
    def setUp(self):
        self.report = json.loads(audit.LEDGER.read_text(encoding="utf8"))

    def test_full_166_events_are_valid_source_only_not_trades(self):
        proof = audit.validate(self.report)
        self.assertEqual(proof["status"], "NATIVE_REAL_H1_SOURCE_ENTRY_ONLY_VERIFIED")
        self.assertEqual(proof["checkedTotal"], 166)
        self.assertEqual(proof["arms"]["BASE"]["events"], 54)
        self.assertEqual(proof["arms"]["V8_V64"]["events"], 112)
        self.assertTrue(proof["noOrders"])
        self.assertTrue(proof["noCumulativeDdOrPnlClaim"])

    def test_fake_order_authority_or_live_approval_cannot_pass(self):
        for field in ("orderAuthority", "productionEligible",
                      "executionParityProven", "annualProfitOrDdCertified",
                      "rootCertificateIssued"):
            bad = copy.deepcopy(self.report)
            bad[field] = True
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, "CANNOT_CLAIM_EXECUTION"):
                    audit.validate(bad)

    def test_event_time_direction_gross_or_summary_tamper_is_rejected(self):
        changes = [
            lambda x: x["rawSignalEvents"]["BASE"][0].__setitem__("entryTs", 1759276800001),
            lambda x: x["rawSignalEvents"]["BASE"][0].__setitem__("side", "INVALID"),
            lambda x: x["rawSignalEvents"]["BASE"][0].__setitem__("gross", 0),
            lambda x: x["rawSignalEvents"]["BASE"][0].__setitem__("barTs", 0),
            lambda x: x["arms"]["V8_V64"].__setitem__("checked", 111),
        ]
        for change in changes:
            bad = copy.deepcopy(self.report)
            change(bad)
            with self.assertRaises(ValueError):
                audit.validate(bad)

    def test_data_hash_or_native_pin_is_not_silently_reset(self):
        bad = copy.deepcopy(self.report)
        bad["input"]["pengu"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "INPUT_DIGEST_MISMATCH"):
            audit.validate(bad)
        with patch.object(audit, "git_blob_sha", return_value="0" * 40):
            with self.assertRaisesRegex(ValueError, "SOURCE_GIT_BLOB_PIN_MISMATCH"):
                audit.validate(self.report)


if __name__ == "__main__":
    unittest.main()
