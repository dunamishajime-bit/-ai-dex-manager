"""Strict verification of model pin identity; never asserts V4 LIVE from a pin."""
import copy,csv,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_runtime_pin_manifest_gate import (
    compare,PIN_MAP,SUPERVISORS,validate_manifest,source_shas,
)
SHA1="1"*40;SHA2="2"*40
def manifest():
    return {"schema":"disdex-bt-readonly-runner-pins/v1",
      "sourceType":"read_only_vps_runner_pin_manifest",
      "observedAtUtc":"2026-11-15T02:00:00Z",
      "runnerPins":{x:SHA1 for x in (*PIN_MAP.values(),*SUPERVISORS)},
      "activeUnitStatusProven":False,"venueEconomicsCertified":False}
def model():
    return {x:{SHA1} for x in PIN_MAP}
class RuntimePinManifestTests(unittest.TestCase):
 def test_all_matching_only_version_not_live(self):
    x=compare(manifest(),model(),model())
    self.assertEqual(x["status"],"PINS_MATCH_ONLY_NOT_ECONOMIC_PARITY")
    self.assertFalse(x["activeUnitStatusProven"])
    self.assertFalse(x["signedVenueFillsCertified"])
 def test_v4_new_pin_requires_model_replay(self):
    m=manifest();m["runnerPins"]["V12_V4"]=SHA2
    x=compare(m,model(),model())
    self.assertEqual(x["status"],"BLOCKED_REPLAY_REQUIRED")
    self.assertTrue(x["needsV4CodexReleaseIntegration"])
 def test_other_runner_mismatch_also_fails(self):
    m=manifest();m["runnerPins"]["PENGU_V8"]=SHA2
    x=compare(m,model(),model())
    self.assertEqual(x["strategies"]["PENGU"]["status"],
                     "MODEL_SOURCE_PIN_MISMATCH_REQUIRE_REPLAY")
 def test_economics_claim_not_allowed_from_manifest(self):
    m=manifest();m["venueEconomicsCertified"]=True
    with self.assertRaisesRegex(ValueError,"UNSUPPORTED_RUNTIME_CERTIFICATION"):
        validate_manifest(m)
 def test_active_unit_claim_must_be_verified_separately(self):
    m=manifest();m["activeUnitStatusProven"]=True
    with self.assertRaisesRegex(ValueError,"UNSUPPORTED_RUNTIME_CERTIFICATION"):
        validate_manifest(m)
 def test_missing_critical_supervisor_pin_rejected(self):
    m=manifest();m["runnerPins"].pop("SHARED_CRYPTO_RISK")
    with self.assertRaisesRegex(ValueError,"ALL_NINE_PINS_REQUIRED"):
        validate_manifest(m)
 def test_unknown_pin_or_bad_sha_refused(self):
    m=manifest();m["runnerPins"]["V12_V4"]="last-release"
    with self.assertRaisesRegex(ValueError,"MALFORMED_PIN_SHA"):
        validate_manifest(m)
 def test_model_costs_source_pin_mismatch_refused(self):
    b=model();b["Q102"]={SHA2}
    with self.assertRaisesRegex(ValueError,"COST_CASE_PIN_POPULATION_DRIFT"):
        compare(manifest(),model(),b)
 def test_duplicate_source_ids_refused(self):
    with tempfile.TemporaryDirectory() as d:
        p=Path(d)/"source.csv"
        fields=["trade_id","logic","source_runtime_sha"]
        with p.open("w",encoding="utf8",newline="") as f:
            w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
            w.writerow({"trade_id":"one","logic":"V4","source_runtime_sha":SHA1})
            w.writerow({"trade_id":"one","logic":"Q102","source_runtime_sha":SHA1})
        with self.assertRaisesRegex(ValueError,"MODEL_DUPLICATE_OR_INVALID_SOURCE_SHA"):
            source_shas(p)
 def test_missing_logic_family_refused(self):
    with tempfile.TemporaryDirectory() as d:
        p=Path(d)/"source.csv"
        with p.open("w",encoding="utf8",newline="") as f:
            w=csv.DictWriter(f,fieldnames=["trade_id","logic","source_runtime_sha"]);w.writeheader()
            w.writerow({"trade_id":"one","logic":"V4","source_runtime_sha":SHA1})
        with self.assertRaisesRegex(ValueError,"SEVEN_STRATEGY_FAMILIES_INCOMPLETE"):
            source_shas(p)
if __name__=="__main__":unittest.main()
