import importlib.util
from pathlib import Path
import unittest

p=Path(__file__).resolve().parents[1]/"scripts/research/audit_bt_hype_early_cooldown.py"
spec=importlib.util.spec_from_file_location("hype_early_cooldown",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class EarlyCooldownTests(unittest.TestCase):
 def test_early_cooldown_consumed_by_signal_that_fails_rel_gate(self):
  base=[{"ts":0,"rel24":0.04},{"ts":6*m.HOUR,"rel24":0.01}]
  result=m.apply_ordering(base,0.02)
  self.assertEqual(result["historical_selected_times"],[])
  self.assertEqual(result["independently_qualified_times"],[6*m.HOUR])
  self.assertEqual(result["signature_first_then_cooldown_count"],1)
  self.assertFalse(result["suppressed_base"][0]["prior_base_rel24_passes"])
 def test_early_cooldown_reproduces_time_first_semantics(self):
  base=[{"ts":0,"rel24":0.01},{"ts":6*m.HOUR,"rel24":0.01},{"ts":48*m.HOUR,"rel24":0.01}]
  result=m.apply_ordering(base,0.02)
  self.assertEqual(result["historical_selected_times"],[0,48*m.HOUR])
  self.assertEqual(len(result["suppressed_base"]),1)
 def test_unsorted_base_fails_closed(self):
  with self.assertRaisesRegex(ValueError,"UNSORTED"):
   m.apply_ordering([{"ts":6,"rel24":0},{"ts":5,"rel24":0}],0.02)
 def test_generator_unknown_order_fails_closed(self):
  with self.assertRaisesRegex(ValueError,"UNKNOWN"):
   m.check_generator("return [x for x in base if x['rel24']<.02]")

if __name__=="__main__":
 unittest.main()
