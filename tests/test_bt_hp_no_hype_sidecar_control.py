"""No-HYPE matched-portfolio ablation is only a research control, never LIVE."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_no_hype_sidecar_control import make_ablation,NO_HYPE_SUFFIX
from test_bt_hp_native_hype_integrated_sensitivity import FICTITIOUS_WRAPPER

class NoHypeControlTests(unittest.TestCase):
 def test_entire_hype_candidate_population_disallowed(self):
  s=make_ablation(FICTITIOUS_WRAPPER)
  self.assertIn('if c["s"]=="HYPE":',s)
  self.assertIn(NO_HYPE_SUFFIX,s)
  self.assertNotIn("HYPE_REDESIGN_CAUSAL_H48R4_WSIG",s)
  self.assertIn("orig=instrument_generated(orig)",s)
 def test_source_gross_unchanged(self):
  s=make_ablation(FICTITIOUS_WRAPPER)
  self.assertIn("NATIVE_HYPE_GROSS_OBSERVER_SHA256",s)
 def test_noninterchangeable_hype_filter_refused(self):
  with self.assertRaisesRegex(ValueError,"ANCHOR_DRIFT_HYPE_NATIVE_ROUTE_FILTER"):
   make_ablation(FICTITIOUS_WRAPPER.replace(
       'if c["s"]=="HYPE" and c.get("route")!="HYPE_REDESIGN_CAUSAL_H48R4_WSIG":',
       'if c["s"]=="HYPE" or True:'))
if __name__=="__main__":unittest.main()
