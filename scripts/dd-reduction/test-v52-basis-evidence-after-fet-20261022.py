#!/usr/bin/env python3
"""V52 basis-source certification never silently falls back to token M5."""
import importlib.util
import unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location(
 "audit_v52_after_fet84", HERE/"audit-v52-basis-evidence-after-fet-20261022.py")
assert spec and spec.loader
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class V52AuditTests(unittest.TestCase):
 def trade(self):
  return {"entry_ts_ms":0,"exit_ts_ms":5*m.M5,"entry_price":100,
          "side":"SHORT","exit_reason_actual":"TIME_OR_SESSION_FLAT",
          "modeled_realized_pnl_jpy_at_exit_fx":-100}
 def bars(self):
  return [(i*m.M5,100.,101.,99.,100.,10.) for i in range(7)]
 def test_complete_token_alone_does_not_certify_reference(self):
  bars=self.bars()
  r=m.token_coverage(self.trade(),bars,[x[0] for x in bars])
  self.assertTrue(r["hasEntry"])
  self.assertTrue(r["fullWindow"])
  self.assertFalse(r["validBasis"])
  self.assertEqual(r["entryErrorBps"],0)
 def test_no_token_window_fails(self):
  bars=[(10*m.M5,100.,101.,99.,100.,10.)]
  r=m.token_coverage(self.trade(),bars,[x[0] for x in bars])
  self.assertFalse(r["hasEntry"])
  self.assertFalse(r["fullWindow"])
  self.assertFalse(r["validBasis"])
 def test_internal_bar_gap_fails(self):
  bars=[x for x in self.bars() if x[0]!=2*m.M5]
  r=m.token_coverage(self.trade(),bars,[x[0] for x in bars])
  self.assertFalse(r["fullWindow"])
  self.assertFalse(r["validBasis"])
 def test_early_series_end_fails(self):
  bars=self.bars()[:4]
  r=m.token_coverage(self.trade(),bars,[x[0] for x in bars])
  self.assertFalse(r["fullWindow"])
 def test_token_price_error_cannot_be_yahoo_basis(self):
  bars=self.bars()
  bars[0]=(0,99.,100.,98.,99.,10.)
  r=m.token_coverage(self.trade(),bars,[x[0] for x in bars])
  self.assertGreater(r["entryErrorBps"],25)
  self.assertFalse(r["validBasis"])
 def test_pnl_separated_per_side_and_reason(self):
  a=dict(self.trade(),side="SHORT",modeled_realized_pnl_jpy_at_exit_fx=-100)
  b=dict(self.trade(),side="LONG",modeled_realized_pnl_jpy_at_exit_fx=300,exit_reason_actual="BASIS_CONVERGED")
  c=dict(self.trade(),side="SHORT",modeled_realized_pnl_jpy_at_exit_fx=70,exit_reason_actual="BASIS_CONVERGED")
  stats=m.side_stats([a,b,c])
  self.assertEqual(stats["SHORT|ALL"]["losses"],1)
  self.assertEqual(stats["SHORT|ALL"]["wins"],1)
  self.assertEqual(stats["SHORT|ALL"]["pnlJpy"],-30)
  self.assertEqual(stats["LONG|BASIS_CONVERGED"]["pnlJpy"],300)
 def test_model_unchanged_25bps_token_mismatch_risk(self):
  self.assertEqual(m.TICKERS,("TSLAUSDT","NVDAUSDT","METAUSDT","MSFTUSDT","AMZNUSDT"))
  self.assertEqual(m.M5,300000)
 def test_user_adopted_anchor_contract_visible(self):
  cfg=m.readjson(m.REPO/"config/v52V50Runtime.json")
  self.assertEqual(cfg["basisStopMultiple"],1.75)
  self.assertEqual(cfg["convergenceBps"],20)

if __name__=="__main__":unittest.main()
