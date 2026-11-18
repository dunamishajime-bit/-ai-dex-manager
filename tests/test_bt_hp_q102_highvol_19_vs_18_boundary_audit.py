"""Q102 19 signals vs 18 closed + right-censored SUI source boundary."""
import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_q102_highvol_19_vs_18_boundary_audit import (
 verify,signal_bucket,END_MS,EXPECTED_OPEN_ID,EXPECTED_ENTRY_MS,
)
PIN="ef1ab178e26a7bf5bddb6473467765edba242e1d"
def fixture():
 sig=[];out=[];base=[]
 for i in range(19):
  symbol="ONDOUSDT" if i<10 else "ARBUSDT" if i<12 else "SUIUSDT"
  entry=1782946800000+i*3600000
  ident=f"HIGH_VOL:{symbol}:{entry-3600000}"
  if i==18:entry=EXPECTED_ENTRY_MS;ident=EXPECTED_OPEN_ID
  end=entry+72*3600000
  s={"id":ident,"symbol":symbol,"side":1,"family":"HIGH_VOL",
     "layer":"S1","entryTs":entry,"dataCutoffTs":entry-3600000,
     "requestedGross":1.0}
  o={**s,"exitTs":end,"exitPrice":2.,"exitReason":"72h_time"}
  b={**s,"sourceRuntimeSha":PIN}
  if i!=18:b.update({"exitTs":end,"exitPrice":2.})
  else:b.update({"status":"RIGHT_CENSORED_PERIOD_END"})
  sig.append(s);out.append(o);base.append(b)
 study={"targetOneShot":{"baseline":{"n":18},"admittedN":15,"blockedN":3},
    "targetBlocked":[{"id":sig[i]["id"]} for i in range(3)]}
 return sig,out,base,study
class NativeClosedBoundaryTests(unittest.TestCase):
 def test_signal_before_end_exits_after_is_open(self):
  self.assertEqual(signal_bucket(0,END_MS,EXPECTED_ENTRY_MS,END_MS+3600000),"OPEN_AT_END")
 def test_exit_at_exclusive_end_remains_open(self):
  self.assertEqual(signal_bucket(0,END_MS,EXPECTED_ENTRY_MS,END_MS),"OPEN_AT_END")
 def test_closed_before_end_is_completed(self):
  self.assertEqual(signal_bucket(0,END_MS,EXPECTED_ENTRY_MS,END_MS-1),"CLOSED_BEFORE_END")
 def test_empty_or_nonchronological_signal_rejected(self):
  with self.assertRaisesRegex(ValueError,"BOUNDS_INVALID"):
   signal_bucket(0,END_MS,EXPECTED_ENTRY_MS,EXPECTED_ENTRY_MS)
 def test_19_covers_18_closed_and_one_open(self):
  d=verify(*fixture())
  self.assertEqual((d["totalNativeSignals"],d["nativeClosedExitsBeforeStudyEnd"],d["nativeOpenAtStudyEnd"]),(19,18,1))
  self.assertFalse(d["shadowAll15AdmittedIdsMemberwiseProven"])
 def test_right_censored_cannot_be_fake_fill(self):
  x,y,z,s=fixture()
  z[-1]["exitTs"]=y[-1]["exitTs"]
  with self.assertRaisesRegex(ValueError,"RIGHT_CENSORED_NATIVE_EXIT_WRONGLY_REALIZED"):
   verify(x,y,z,s)
 def test_bad_frozen_runtime_pin_rejected(self):
  x,y,z,s=fixture()
  z[2]["sourceRuntimeSha"]="0"*40
  with self.assertRaisesRegex(ValueError,"RELEASE_PIN_CHANGED"):
   verify(x,y,z,s)
 def test_target_shadow_blocked_must_be_in_native_closed(self):
  x,y,z,s=fixture();s["targetBlocked"][0]["id"]=EXPECTED_OPEN_ID
  with self.assertRaisesRegex(ValueError,"BLOCKED_ROWS_NOT_CLOSED_NATIVE_IDS"):
   verify(x,y,z,s)
 def test_target_baseline_not_18_fails_closed(self):
  x,y,z,s=fixture();s["targetOneShot"]["baseline"]["n"]=19
  with self.assertRaisesRegex(ValueError,"TARGET_SHADOW_18_COHORT_DRIFT"):
   verify(x,y,z,s)
 def test_source_duplicate_ids_rejected(self):
  x,y,z,s=fixture();x[1]["id"]=x[0]["id"]
  with self.assertRaisesRegex(ValueError,"DUPLICATE_NATIVE_HIGHVOL_SIGNAL_ID"):
   verify(x,y,z,s)
if __name__=="__main__":unittest.main()
