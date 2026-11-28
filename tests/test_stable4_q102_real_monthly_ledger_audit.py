"""Q102 limited real H1 source evidence is never a release permit."""
from __future__ import annotations
import copy
import json
import unittest
from unittest.mock import patch
from scripts.research import stable4_q102_real_monthly_ledger_audit as audit

class Q102LimitedMonthlyTests(unittest.TestCase):
 def setUp(self):
  self.doc=json.loads(audit.EVIDENCE.read_text(encoding="utf8"))

 def test_exact_12_monthly_native_source_no_trade_report(self):
  r=audit.validate(self.doc)
  self.assertEqual(r["status"],"LIMITED_NATIVE_Q102_REAL_MONTHLY_H1_EVIDENCE_VERIFIED")
  self.assertEqual(r["months"],12)
  self.assertFalse(r["fullQ102UniverseCertified"])
  self.assertTrue(r["noOrders"])

 def test_source_pin_or_raw_input_digest_tamper_rejected(self):
  bad=copy.deepcopy(self.doc)
  bad["inputs"]["SOLUSDT"]["sha256"]="0"*64
  with self.assertRaisesRegex(ValueError,"DATA_DIGEST_OR_H1_COUNT_MISMATCH"):
   audit.validate(bad)
  with patch.object(audit,"blob_digest",return_value="0"*40):
   with self.assertRaisesRegex(ValueError,"SOURCE_SHA_MISMATCH"):
    audit.validate(self.doc)

 def test_future_monthly_signal_or_fake_live_claim_rejected(self):
  for field in ("orderAuthority","productionEligible","portfolioReplayComplete","rootCertificateIssued"):
   bad=copy.deepcopy(self.doc);bad[field]=True
   with self.assertRaisesRegex(ValueError,"SCOPE_OR_AUTHORITY_INVALID"):
    audit.validate(bad)
  for update in (
   lambda x:x["cases"][0].__setitem__("decisionTs",x["cases"][0]["decisionTs"]+3600000),
   lambda x:x["cases"][0]["nativeSource"].__setitem__("dataCutoffTs",x["cases"][0]["decisionTs"]),
   lambda x:x["cases"][0]["nativeSource"].__setitem__("status","RAW_H1_SIGNAL_ONLY"),
  ):
   bad=copy.deepcopy(self.doc);update(bad)
   with self.assertRaisesRegex(ValueError,"CASE_SOURCE_OR_EXECUTION_INVALID"):
    audit.validate(bad)

if __name__=="__main__":
 unittest.main()
