import importlib.util
from pathlib import Path
import unittest

p=Path(__file__).resolve().parents[1]/"scripts/research/audit_bt_hype_h48_exit_parity.py"
spec=importlib.util.spec_from_file_location("hype_exit_parity",p)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def candidate(t,reason):
 return {"entryTs":t,"exitTs":t+300000,"reason":reason}

class H48ParityTests(unittest.TestCase):
 def test_target_stops_are_distinguished_from_time(self):
  cohort=[candidate(i*3600000,"STOP" if i<6 else "TIME") for i in range(27)]
  self.assertEqual(mod.model_exit_counts(cohort),{"STOP":6,"TIME":21})
 def test_wrong_research_exit_reason_rejected(self):
  cohort=[candidate(i*3600000,"STOP" if i<6 else "TIME") for i in range(27)]
  cohort[0]["reason"]="REPAIRED"
  with self.assertRaisesRegex(ValueError,"UNSUPPORTED"):
   mod.model_exit_counts(cohort)
 def test_duplicate_target_rejected(self):
  cohort=[candidate(i*3600000,"STOP" if i<6 else "TIME") for i in range(27)]
  cohort[0]["entryTs"]=cohort[1]["entryTs"]
  cohort[0]["exitTs"] = cohort[0]["entryTs"] + 300000
  with self.assertRaisesRegex(ValueError,"DUPLICATE"):
   mod.model_exit_counts(cohort)
 def test_missing_or_ambiguous_pinned_contract_fails_closed(self):
  with self.assertRaisesRegex(ValueError,"INCOMPLETE"):
   mod.source_exit_contract({})
  with self.assertRaisesRegex(ValueError,"CHANGED"):
   mod.source_exit_contract({filename:b"invalid" for filename in mod.FILES})
 def test_unauthorized_vps_observation_rejected(self):
  with self.assertRaisesRegex(ValueError,"OBSERVED"):
   mod.build(Path("."),{}, {}, {}, {}, {}, Path("x"),{},{})

if __name__=="__main__":
 unittest.main()
