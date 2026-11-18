"""Q102 AVAX/UNI forward source: no target fitting and numerical parity guards."""
import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_q102_avax_uni_forward_evidence_audit import (
    compare_fast_shadow_numerics,validate_structured,validate_online,build,COUNT_POLICY,
)
def agg(n=2,value=.01):
    return {"n":n,"mean":value,"sum":n*value,"wr":.5,"pf":1.2}
def structured():
    d={"status":"RESEARCH_ONLY_Q102_STRUCTURED_REDESIGN_FORWARD_UNSEEN",
       "selectionUsesForward":False,"assets":{}}
    for sym,count in (("AVAXUSDT",3),("UNIUSDT",9)):
      x={"splitCounts":COUNT_POLICY.copy(),"qualifyingDev":count,
         "topDevFrozen":[]}
      for i in range(count):
        x["topDevFrozen"].append({"structure":"REV_LONG","side":"LONG",
            "score":.001,"family":"H12S5",
            "dev30":{"DEV_TRAIN":agg(),"DEV_VALID":agg(),"DEV_HOLD":agg()},
            "FORWARD30":agg(3,.005)})
      d["assets"][sym]=x
    return d
def online():
    x={"status":"RESEARCH_ONLY_Q102_ONLINE_REGIME_SHADOW_SAFE5",
       "selectionUsesTarget":False,"assets":{}}
    for sym,count in (("AVAXUSDT",3),("UNIUSDT",0)):
      rows=[]
      for i in range(count):
       rows.append({"pre30":{"E1":agg(),"E2":agg(),"E3":agg()},
                  "TARGET30":agg(5,-.004),
                  "score":.01})
      x["assets"][sym]={"rowsN":2383,"qualifyingPretarget":count,
                         "topPretargetFrozen":rows}
    fast=copy.deepcopy(x)
    fast["status"]="RESEARCH_ONLY_Q102_ONLINE_REGIME_SHADOW_SAFE5_FAST_EQUIVALENT"
    return x,fast
class AvaxUniForwardTests(unittest.TestCase):
 def test_dev_rules_keep_unseen_forward_separate(self):
    x=validate_structured(structured())
    self.assertEqual(x["AVAXUSDT"]["pretargQualified"],3)
    self.assertEqual(x["UNIUSDT"]["pretargQualified"],9)
    self.assertEqual(x["AVAXUSDT"]["forwardPositiveMean"],3)
 def test_selection_cannot_use_forward(self):
    x=structured();x["selectionUsesForward"]=True
    with self.assertRaisesRegex(ValueError,"FORWARD_SELECTION_CONTAMINATED"):
       validate_structured(x)
 def test_forward_outcomes_not_pretty_optimized(self):
    x=structured();x["assets"]["UNIUSDT"]["topDevFrozen"][1]["FORWARD30"]["mean"]=-.01
    with self.assertRaisesRegex(ValueError,"METRIC_ARITHMETIC_DRIFT"):
       validate_structured(x)
 def test_online_reference_numeric_roundoff_is_tolerated_not_claimed_byteexact(self):
    x,y=online();y["assets"]["AVAXUSDT"]["topPretargetFrozen"][0]["pre30"]["E1"]["mean"]+=1e-15
    result=validate_online(x,y)
    self.assertFalse(result["AVAXUSDT"]["fastReferenceNumericalComparison"]["byteExact"])
    self.assertTrue(result["AVAXUSDT"]["sourceFastEquivalentWithinFloatTolerance"])
 def test_fast_shadow_numeric_economic_drift_rejected(self):
    x,y=online();y["assets"]["AVAXUSDT"]["topPretargetFrozen"][0]["pre30"]["E1"]["mean"]+=.00001
    with self.assertRaisesRegex(ValueError,"FAST_SHADOW_NUMERIC_DRIFT"):
       validate_online(x,y)
 def test_non_numeric_rule_mismatch_rejected(self):
    x,y=online();y["assets"]["AVAXUSDT"]["topPretargetFrozen"][0]["score"]="tampered"
    with self.assertRaisesRegex(ValueError,"FAST_SHADOW_NON_NUMERIC_DRIFT"):
       validate_online(x,y)
 def test_online_avalanche_target_bad_outcome_is_not_promoted(self):
    x,y=online();v=build(structured(),x,y)
    self.assertTrue(v["onlineShadow"]["AVAXUSDT"]["frozenRulesTargetAllNegativeMean"])
    self.assertEqual(v["onlineShadow"]["UNIUSDT"]["preTargetQualified"],0)
    self.assertFalse(v["forwardBestRuleSelectionPermitted"])
    self.assertEqual(v["productionMutations"],0)
 def test_target_outcome_now_positive_requires_new_audit(self):
    x,y=online()
    for doc in (x,y):
      doc["assets"]["AVAXUSDT"]["topPretargetFrozen"][0]["TARGET30"]=agg(5,.01)
    with self.assertRaisesRegex(ValueError,"TARGET_FALSIFICATION_CHANGED"):
       validate_online(x,y)
 def test_structured_asset_count_drift_rejected(self):
    x=structured();x["assets"]["UNIUSDT"]["qualifyingDev"]=8
    with self.assertRaisesRegex(ValueError,"FROZEN_COHORT_DRIFT"):
       validate_structured(x)
if __name__=="__main__":unittest.main()
