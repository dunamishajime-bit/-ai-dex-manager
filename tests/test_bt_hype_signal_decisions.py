import importlib.util
from pathlib import Path
import unittest

p=Path(__file__).resolve().parents[1]/"scripts/research/audit_bt_hype_signal_decisions.py"
spec=importlib.util.spec_from_file_location("bt_hype_decisions",p)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class DecisionTests(unittest.TestCase):
 def test_model_and_block_both_reconcile(self):
  out=mod.compare({"a","b","c"},[
   {"utc":"a","decision":"MODEL_ENTER"},
   {"utc":"b","decision":"BLOCK"},
  ])
  self.assertEqual(out["historical_modeled_enters"],1)
  self.assertEqual(out["historical_blocks"],1)
  self.assertEqual(out["pure_signals_without_hype_decision"],["c"])
  self.assertFalse(out["cause_of_unlogged_pure_candidates_verified"])
 def test_duplicate_decision_fails_closed(self):
  with self.assertRaisesRegex(ValueError,"Duplicate"):
   mod.compare({"a"},[{"utc":"a","decision":"BLOCK"},{"utc":"a","decision":"BLOCK"}])
 def test_decision_outside_pure_candidate_fails(self):
  with self.assertRaisesRegex(ValueError,"absent"):
   mod.compare({"a"},[{"utc":"b","decision":"MODEL_ENTER"}])
 def test_unexpected_decision_class_fails(self):
  with self.assertRaisesRegex(ValueError,"Unexpected"):
   mod.compare({"a"},[{"utc":"a","decision":"LIVE_ORDER"}])

if __name__=="__main__":
 unittest.main()
