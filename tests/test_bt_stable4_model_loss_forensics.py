import importlib.util
from pathlib import Path
import unittest

file=Path(__file__).resolve().parents[1]/"scripts/research/audit_bt_stable4_model_loss_forensics.py"
spec=importlib.util.spec_from_file_location("bt_loss_forensics",file)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
def base(side="LONG",exit_price="90",pnl="-12"):
 return {"trade_id":"sample","strategy":"V4","source_runtime_sha":"a"*40,
 "entry_utc":"2025-10-02T00:00:00Z","exit_utc":"2025-10-03T00:00:00Z",
 "actual_venue_order_id":"","signed_execution_verified":"False",
 "net_pnl_jpy":pnl,"model_entry_price":"100","model_exit_price":exit_price,
 "side":side,"exit_model_reason":"TIME","model_class":"MODELED","route":"route-a","symbol":"BTCUSDT"}
def study():
 return {"modeled_exits":1,"models":[
  {"model":"V4","source_shas":["a"*40],"observed_live_sha":"b"*40,"source_sha_matches_live":False},
  {"model":"HYPE","source_shas":["c"*40],"observed_live_sha":"d"*40,"source_sha_matches_live":False}
 ]}
class LossTests(unittest.TestCase):
 def test_adverse_direction_is_not_signal_misclassification(self):
  x=m.aggregate([base()],study(),study())["V4"]["total"]
  self.assertEqual((x["exits"],x["net_losses"],x["adverse_price_exits"]),(1,1,1))
  self.assertEqual(x["win_rate_pct"],0)
 def test_short_adverse_price(self):
  x=m.aggregate([base("SHORT","101","-7")],study(),study())["V4"]["total"]
  self.assertEqual(x["adverse_price_exits"],1)
 def test_model_source_mismatch_blocks(self):
  row=base()
  row["source_runtime_sha"]="0"*40
  with self.assertRaisesRegex(ValueError,"source SHA"):
   m.aggregate([row],study(),study())
 def test_suspect_real_execution_evidence_blocks(self):
  row=base()
  row["signed_execution_verified"]="True"
  with self.assertRaisesRegex(ValueError,"actual execution"):
   m.aggregate([row],study(),study())
 def test_duplicate_model_trade_id_blocks(self):
  with self.assertRaisesRegex(ValueError,"Duplicate"):
   m.aggregate([base(),base()],{"modeled_exits":2},study())
 def test_independent_source_sha_mismatch_rejected(self):
  source={"schema":"disdex-bt-stable4-research-source-audit/v1",
   "scenarios":{bps:{"fills_file_sha256":"trusted","modeled_exits":0} for bps in ("10","30")}}
  report={"scenarios":{bps:{"fills_source_sha256":"tampered","source_modeled_exits":0,
   "by_model":{name:{"total":{"exits":0}} for name in m.TARGETS}} for bps in ("10","30")}}
  study_data={"scenarios":{bps:{"models":[{"model":name,"modeled_exits":0} for name in m.TARGETS]} for bps in ("10","30")}}
  with self.assertRaisesRegex(ValueError,"SHA256"):
   m.verify_source_integrity(report,source,study_data)
 def test_outside_period_rejected(self):
  row=base()
  row["entry_utc"]="2026-10-01T00:00:00Z"
  with self.assertRaisesRegex(ValueError,"Out-of-range"):
   m.aggregate([row],study(),study())
if __name__=="__main__":
 unittest.main()
