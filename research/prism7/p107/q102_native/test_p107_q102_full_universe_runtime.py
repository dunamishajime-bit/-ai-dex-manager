import json,collections,datetime,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def read(name):
    return json.loads((ROOT/name).read_text(encoding="utf8"))
class Q102ExactPINRawScan(unittest.TestCase):
    def test_universe_exact_pinned_plus_real_process(self):
        d=read("P107_Q102_PIN_21_SYMBOL_1Y_RAW_SIGNAL_AUDIT_20261123_V2.json")
        a=read("P107_Q102_PROCESS_FILE_SOURCE_RUNTIME_ATTESTATION_20261123.json")
        hv=set(a["processEnvironmentWhitelisted"]["QUALITY102_CAUSAL_V1_SYMBOLS"].split(","))
        self.assertEqual(hv,set(d["highVolUniverseFromActualRunningProcess"]))
        self.assertEqual(len(d["s34UniverseFromPinnedSource"]),11)
        self.assertEqual(len(d["sourceInputUniverse"]),20)
        self.assertEqual(set(d["sourceInputUniverse"]),hv|set(d["s34UniverseFromPinnedSource"])|{"BTCUSDT"})
    def test_one_year_partition_and_native_decision_counts(self):
        d=read("P107_Q102_PIN_21_SYMBOL_1Y_RAW_SIGNAL_AUDIT_20261123_V2.json")
        self.assertEqual((d["gridTotal"],d["sourceEvaluated"],d["preflightBlocked"]),(2190,499,1691))
        self.assertEqual(sum(d["reasonCounts"].values()),499)
        self.assertEqual(d["reasonCounts"]["QUALITY102_CAUSAL_V4_NATURAL_SIGNAL"],49)
        self.assertFalse(any(k.startswith("SOURCE_THROW") for k in d["reasonCounts"]))
        self.assertEqual(len(d["selectedUnconstrainedSignalCandidates"]),49)
        self.assertFalse(d["fullSTABLE4AccountBT"])
        self.assertEqual(d["signedVenueFills"],0)
    def test_candidates_are_source_native_not_order_fills(self):
        d=read("P107_Q102_PIN_21_SYMBOL_1Y_RAW_SIGNAL_AUDIT_20261123_V2.json")
        fills=d["selectedUnconstrainedSignalCandidates"]
        self.assertEqual(collections.Counter(x["symbol"] for x in fills),{
          "FETUSDT":19,"AVAXUSDT":8,"UNIUSDT":8,"DOGEUSDT":5,"NEARUSDT":4,"RENDERUSDT":3,"APTUSDT":2
        })
        self.assertTrue(all(x["requestedGross"]>0 and x["requestedGross"]<=3 and x["effectiveGross"]==x["requestedGross"] for x in fills))
        self.assertTrue(all(x["dataCutoffTs"]<x["decisionTs"] for x in fills))
        self.assertTrue(all(x["sourceRuntimeGrossLimit"]==3 for x in fills))
        self.assertEqual(len({x["decisionTs"] for x in fills}),len(fills))
    def test_runtime_env_file_mismatch_and_disarmed_live_pid(self):
        a=read("P107_Q102_PROCESS_FILE_SOURCE_RUNTIME_ATTESTATION_20261123.json")
        p=a["processEnvironmentWhitelisted"];u=a["systemdUnitEnvironmentWhitelisted"];f=a["environmentFilesWhitelisted"]
        self.assertEqual(p["QUALITY102_CAUSAL_V1_MAX_GROSS"],"3.0")
        self.assertEqual(u["QUALITY102_CAUSAL_V1_MAX_GROSS"],"3.0")
        self.assertEqual(f["QUALITY102_CAUSAL_V1_MAX_GROSS"],"0.50")
        self.assertTrue(a["processVsEnvironmentFilesGrossDiffer"])
        for k in ["QUALITY102_CAUSAL_V1_ENABLED","QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED","QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED","QUALITY102_CAUSAL_V1_OPERATOR_ARMED"]:
            self.assertEqual(p[k],"false")
            self.assertEqual(u[k],"false")
            self.assertEqual(f[k],"true")
    def test_pinned_source_policy_3_not_0p5(self):
        x=read("P107_Q102_EFFECTIVE_PROCESS_POLICY_RECONCILIATION_20261123.json")
        self.assertEqual(x["sourcePolicyQ102MaximumGross"],3.0)
        self.assertEqual(x["sourceResolvedRuntime"]["maximumGross"],3.0)
        self.assertEqual(x["old_0p5_sensitivityResolvedRuntime"]["maximumGross"],0.5)
        self.assertTrue(x["sourceAndLiveGrossMatch"])
        self.assertFalse(x["realExecutionEnabled"])
    def test_early_bad_h1_and_later_valid_sample_on_runtime3(self):
        d=read("P107_Q102_NATIVE_SAMPLE_GROSS3P0_NEGATIVE_POSITIVE_20261123.json")
        self.assertTrue(d["expectedNegativeAndPositiveControlsPass"])
        self.assertEqual(d["results"][0]["error"],"QUALITY102_INVALID_CANDLE")
        self.assertEqual(d["results"][1]["status"],"PIN_SOURCE_CALLED")
        self.assertFalse(d["p107FullParity"])
if __name__=="__main__":unittest.main()
