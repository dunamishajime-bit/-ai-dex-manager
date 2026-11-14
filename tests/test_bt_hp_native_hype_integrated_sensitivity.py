"""Independent synthetic tests for native HYPE STABLE4 sensitivity wrapper."""
import tempfile,unittest,sys,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import bt_hp_native_hype_integrated_sensitivity as native

FICTITIOUS_WRAPPER="""out_name="STABLE4_OPPORTUNITY_PROD_CAPS_20261114"
gate=r'''_HYPE_REDESIGN_PATH=R/"DIRECTION_RESEARCH_20261109"
for z in old_candidates:
 raw.append(z)
# HYPE_REDESIGN_CAUSAL_H48R4_WSIG
# Q102 AVAX: local confidence hardening around QAON7.
'''
def _keep(c):
 if c["s"]=="HYPE" and c.get("route")!="HYPE_REDESIGN_CAUSAL_H48R4_WSIG":
  return False
 return True
orig=orig.replace(_hc1,'elif s=="HYPE" and used_crypto+g>CRYPTO_CAP+1e-8:reason="HYPE_REDESIGN_1P0_CRYPTO_CAP_GATE"',1)
orig=orig.replace(_hc2,'elif s=="HYPE" and used_total+g>TOTAL_CAP+1e-8:reason="HYPE_REDESIGN_1P0_TOTAL_CAP_GATE"',1)
assert "STEP=300000" in orig and "V52_STRATEGY_DAILY_LOSS_3P5_GATE" in orig
exec(compile(orig,str(SRC)+"::PRETARGET_STABLE_"+case,"exec"),{"__name__":"__main__"})
"""
class NativeHypeSensitivityTests(unittest.TestCase):
 def test_native_route_and_separate_output(self):
  a=native.transform(FICTITIOUS_WRAPPER,with_gross=False)
  self.assertIn('HYPE_TREND_LONG_PINNED',a)
  self.assertIn(native.OUTPUT_SUFFIX,a)
  self.assertNotIn("HYPE_REDESIGN_CAUSAL_H48R4_WSIG",a)
  self.assertIn("HYPE_NATIVE_CANDIDATE_CRYPTO_CAP_GATE",a)
  self.assertIn("HYPE_NATIVE_CANDIDATE_TOTAL_CAP_GATE",a)
  self.assertIn("exec(compile(orig",a)
 def test_source_gross_observer_injection(self):
  a=native.transform(FICTITIOUS_WRAPPER,with_gross=True)
  self.assertIn("orig=instrument_generated(orig)",a)
  self.assertIn("NATIVE_HYPE_GROSS_OBSERVER_SHA256",a)
 def test_absent_archived_route_refuses(self):
  c=FICTITIOUS_WRAPPER.replace("# HYPE_REDESIGN_CAUSAL_H48R4_WSIG","")
  with self.assertRaisesRegex(ValueError,"H48_SOURCE_REMOVAL_NOT_PROVEN"):
   native.transform(c,with_gross=False)
 def test_no_missing_filter(self):
  c=FICTITIOUS_WRAPPER.replace(
   'if c["s"]=="HYPE" and c.get("route")!="HYPE_REDESIGN_CAUSAL_H48R4_WSIG":',
   "if False:")
  with self.assertRaisesRegex(ValueError,"ANCHOR_DRIFT_HYPE_NATIVE_ROUTE_FILTER"):
   native.transform(c,with_gross=False)
 def test_duplicate_filter(self):
  pattern=native.OLD_HYPE_FILTER
  c=FICTITIOUS_WRAPPER+"\\n"+pattern
  with self.assertRaisesRegex(ValueError,"ANCHOR_DRIFT_HYPE_NATIVE_ROUTE_FILTER"):
   native.transform(c,with_gross=False)
 def test_existing_output_without_original_source_wont_execute(self):
  with tempfile.TemporaryDirectory() as temp:
   p=Path(temp)/"w.py";p.write_text(FICTITIOUS_WRAPPER,encoding="utf8")
   with self.assertRaisesRegex(ValueError,"BASE_WRAPPER_SHA_MISMATCH"):
    native.run(p,verify_only=False,expected_pin=p,case="STABLE3")
 def test_unknown_source_sha_rejected(self):
  self.assertEqual(len(native.EXPECTED_WRAPPER_SHA),64)
  self.assertNotEqual(hashlib.sha256(FICTITIOUS_WRAPPER.encode()).hexdigest(),
                      native.EXPECTED_WRAPPER_SHA)

if __name__=="__main__":unittest.main()
