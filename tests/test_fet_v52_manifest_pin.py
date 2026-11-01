import importlib.util
import json
import unittest
from pathlib import Path

SCRIPT=Path(__file__).resolve().parents[1]/"scripts/ops/root/disdex-fet-preemption-readiness-guard.py"
spec=importlib.util.spec_from_file_location("fet_guard",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class ManifestPinTests(unittest.TestCase):
    def fixture(self):
        return {
          "schema":"disdex-runner-pin-manifest/v2",
          "target":"professional-dismanager.net",
          "operatorTarget":"DD1296_FINAL_ALLIN_10BPS",
          "runners":{
            "V52":{
              "sha":"4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81",
              "releaseRoot":"/home/deploy/disdex-trading/releases/4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81",
              "serviceUnit":"disdex-v52-aster-only@4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81.service",
              "evidenceMode":"legacy-state-v1",
              "healthPath":"/var/lib/disdex/v52-aster-only/runner-live.json",
              "tickPath":"/var/lib/disdex/runner-health/ticks/v52.json",
              "stopOwner":"V52"
            }
          }
        }

    def test_parse_v52_manifest_pin_exact(self):
        pin=m.parse_v52_manifest_pin(self.fixture())
        self.assertEqual(pin["sha"],"4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81")
        self.assertEqual(pin["serviceUnit"],"disdex-v52-aster-only@4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81.service")

    def test_wrong_service_and_root_fail_closed(self):
        for field,value in [
            ("releaseRoot","/tmp/wrong"),
            ("serviceUnit","disdex-v52-aster-only@"+"a"*40+".service"),
        ]:
            doc=self.fixture();doc["runners"]["V52"][field]=value
            with self.assertRaises((RuntimeError,ValueError)):
                m.parse_v52_manifest_pin(doc)

if __name__=="__main__":
    unittest.main()
