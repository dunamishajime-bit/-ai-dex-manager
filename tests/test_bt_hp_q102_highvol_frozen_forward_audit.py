"""Q102 HIGH_VOL frozen pretarget proof/one-shot fail closed tests."""
import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_q102_highvol_frozen_forward_audit import source_case,check_stats
HASH={"pre":"a"*64,"target":"b"*64}
def perf(n,win=.4,mean=.01,pf=1.2):
 return {"n":n,"wr":win,"mean":mean,"sum":n*mean,"pf":pf}
def source():
 case={
  "status":"Q102_HIGHVOL_GENERIC_PRETARGET_FROZEN_ONLINE_SHADOW_HEALTH_RESEARCH_ONLY",
  "frozenPolicy":{"lookbackDays":90,"minN":5,"pfMax":0.6},
  "hashes":copy.deepcopy(HASH),
  "pretarget":{"baseline":perf(202,.49),"admitted":perf(138,.44),
    "blockedShadow":perf(64,.59),"admittedN":138,"blockedN":64},
  "targetOneShot":{"baseline":perf(18,.33),"admitted":perf(15,.2),
    "blockedShadow":perf(3,1.0),"admittedN":15,"blockedN":3},
  "targetBlocked":[
   {"id":f"HIGH_VOL:ONDOUSDT:{1784368800000+i*3600000}",
    "entryTs":1784372400000+i*3600000,"symbol":"ONDOUSDT",
    "side":1,"health":{"n":5,"pf":.07}}
    for i in range(3)]}
 context={
  "status":"Q102_HIGHVOL_PREDEFINED_STRUCTURAL_HYPOTHESIS_FALSIFICATION",
  "hashes":copy.deepcopy(HASH),"costBps":30,
  "qualifiedPretarget":["PULLBACK_IN_14D_TREND"],
  "hypotheses":[{"name":"PULLBACK_IN_14D_TREND","qualifiesPretarget":True,
                  "targetOneShot":{"n":0}}]+[
    {"name":f"OTHER_{i}","qualifiesPretarget":False} for i in range(3)]
 }
 structure={
  "status":"Q102_HIGHVOL_STRUCTURAL_PRETARGET_TRAIN_VALID_PREHOLD_ONE_SHOT_TARGET",
  "hashes":copy.deepcopy(HASH),"costBps":30,
  "candidateRules":150,"robustRules":0,
  "selectedPretargetOnly":None,"targetOneShot":None
 }
 return case,context,structure
class Q102HighVolFrozenTests(unittest.TestCase):
 def test_source_frozen_semantics_preserved(self):
  s=source_case(*source())
  self.assertEqual(s["cohorts"]["targetOneShot"]["baseline"]["n"],18)
  self.assertFalse(s["onlineFrozenPolicyImprovesBaselineOnTarget"])
  self.assertEqual(s["structuralRulesSurvivedPretarget"],0)
 def test_future_population_not_claimed(self):
  s=source_case(*source())
  self.assertEqual(s["qualifyingContextTargetOneShotSignals"],0)
 def test_bad_source_status_fails(self):
  x,y,z=source();x["status"]="LIVE_CONFIRMED"
  with self.assertRaisesRegex(ValueError,"ONLINE_SOURCE_STATUS_DRIFT"):
   source_case(x,y,z)
 def test_pretarget_frozen_pf_changes_fail(self):
  x,y,z=source();x["frozenPolicy"]["pfMax"]=.5
  with self.assertRaisesRegex(ValueError,"FROZEN_POLICY_DRIFT"):
   source_case(x,y,z)
 def test_independent_input_hash_mismatch_fails(self):
  x,y,z=source();y["hashes"]["target"]="c"*64
  with self.assertRaisesRegex(ValueError,"SOURCE_HASH_DRIFT"):
   source_case(x,y,z)
 def test_target_18_population_not_19(self):
  x,y,z=source();x["targetOneShot"]["baseline"]["n"]=19
  with self.assertRaisesRegex(ValueError,"COHORT_BREAKDOWN_BROKEN"):
   source_case(x,y,z)
 def test_shadow_blocked_id_duplicates_fail(self):
  x,y,z=source();x["targetBlocked"][1]["id"]=x["targetBlocked"][0]["id"]
  with self.assertRaisesRegex(ValueError,"ID_DUPLICATE"):
   source_case(x,y,z)
 def test_unfrozen_post_target_block_fails(self):
  x,y,z=source();x["targetBlocked"][0]["entryTs"]=1790902800000
  with self.assertRaisesRegex(ValueError,"OUTSIDE_FROZEN_POLICY"):
   source_case(x,y,z)
 def test_structural_robust_result_not_fit_to_target(self):
  x,y,z=source();z["robustRules"]=1
  with self.assertRaisesRegex(ValueError,"NO_SURVIVING_STRUCTURAL_GATE_NOT_PROVEN"):
   source_case(x,y,z)
 def test_cost_or_nonfinite_return_fails(self):
  x,y,z=source();z["costBps"]=10
  with self.assertRaisesRegex(ValueError,"NOT_30BPS"):
   source_case(x,y,z)
  with self.assertRaisesRegex(ValueError,"RETURN_SUM_INCONSISTENT"):
   check_stats(perf(10,mean=.01)|{"sum":.11},10,"a")
if __name__=="__main__":unittest.main()
