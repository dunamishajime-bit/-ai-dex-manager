"""HYPE Layer2 strictly historical prequential probability scoring tests."""
import math,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_hype_native_layer2_prequential_eval import metrics,evaluate
class HypePrequentialMetricsTests(unittest.TestCase):
 def test_forecast_brier_and_log_loss(self):
    x=metrics([.75,.25],[1,0])
    self.assertEqual(x["n"],2)
    self.assertAlmostEqual(x["brierScore"],.0625)
    self.assertGreater(x["meanLogLoss"],0)
 def test_reversed_predictions_have_worse_score(self):
    correct=metrics([.8,.2],[1,0])
    wrong=metrics([.2,.8],[1,0])
    self.assertLess(correct["brierScore"],wrong["brierScore"])
 def test_no_nonfinite_or_hard_one_probabilities(self):
    for p in (math.nan,math.inf,-.1,0.,1.,1.1):
      with self.subTest(p=p),self.assertRaisesRegex(ValueError,"PROBABILITY_OR_TARGET_INVALID"):
       metrics([p],[1])
 def test_no_fabricated_binary_outcomes(self):
    with self.assertRaisesRegex(ValueError,"PROBABILITY_OR_TARGET_INVALID"):
      metrics([.5],[2])
 def test_no_missing_or_mismatched_samples(self):
    with self.assertRaisesRegex(ValueError,"SAMPLE_COHORT_INVALID"):
      metrics([],[])
    with self.assertRaisesRegex(ValueError,"SAMPLE_COHORT_INVALID"):
      metrics([.5,.5],[1])
 def test_replay_shadow_schema_matters_before_outcomes(self):
    with self.assertRaisesRegex(ValueError,"SHADOW_SCOPING_UNKNOWN"):
      evaluate({"schema":"dummy"},{"schema":"bad"},[])
 def test_hype_native_cohort_must_have_78_signals(self):
    with self.assertRaisesRegex(ValueError,"NATIVE_CANDIDATES_78_REQUIRED"):
      evaluate({},{"schema":"disdex-bt-hype-native-layer2-3-asof-shadow/v1",
                   "candidateCount":77},[])
if __name__=="__main__":unittest.main()
