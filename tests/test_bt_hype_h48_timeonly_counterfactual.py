import importlib.util
from pathlib import Path
import unittest

p=Path(__file__).resolve().parents[1]/"scripts/research/audit_bt_hype_h48_timeonly_counterfactual.py"
spec=importlib.util.spec_from_file_location("h48counter",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def cohort():
 return [{"entryTs":i*60*m.HOUR,
          "exitTs":i*60*m.HOUR+m.HOUR,
          "entryPrice":100,
          "exitPrice":94 if i<6 else 110,
          "reason":"STOP" if i<6 else "TIME"} for i in range(27)]
def prices():
 return {r["entryTs"]+48*m.HOUR:85 if i<6 else 110 for i,r in enumerate(cohort())}

class H48CounterfactualTests(unittest.TestCase):
 def test_only_true_27_candidate_standalone(self):
  x=m.evaluate(cohort(),prices(),10)
  self.assertEqual(x["research_model_candidates"],27)
  self.assertEqual(x["old_model_stop_count"],6)
  self.assertLess(x["hypothetical_time_only_worst_trade_return_net_pct"],
                  x["old_standalone_worst_trade_return_net_pct"])
 def test_absent_future_open_fails_closed(self):
  with self.assertRaisesRegex(ValueError,"MISSING"):
   m.evaluate(cohort(),{},10)
 def test_duplicate_entry_fails_closed(self):
  rows=cohort()
  rows[1]["entryTs"]=rows[0]["entryTs"]
  with self.assertRaisesRegex(ValueError,"DUPLICATE"):
   m.evaluate(rows,prices(),10)
 def test_nonfinite_entry_rejected(self):
  rows=cohort()
  rows[0]["entryPrice"]=float("nan")
  with self.assertRaisesRegex(ValueError,"INVALID_MODELED"):
   m.evaluate(rows,prices(),30)
 def test_fee_model_scope_fail_closed(self):
  with self.assertRaisesRegex(ValueError,"ONLY"):
   m.evaluate(cohort(),prices(),25)

if __name__=="__main__":
 unittest.main()
