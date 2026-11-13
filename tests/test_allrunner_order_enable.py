import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "scripts/ops/deploy/disdex_allrunner_order_enable.py"
PLAN = ROOT / "config/disdex-allrunner-order-enable-DD1296_FINAL_ALLIN_10BPS.json"

def load_module():
    spec = importlib.util.spec_from_file_location("allrunner_order_enable", MODULE)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module

class AllRunnerOrderEnableTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()
        self.plan = self.m.load_plan(PLAN)

    def test_exact_runner_map_and_targets(self):
        self.assertEqual(self.plan["operation"], "ALL_RUNNERS_ORDER_ENABLE")
        self.assertEqual(self.plan["scope"], "FULL_PROJECT")
        self.assertIs(self.plan["ordersEnabled"], True)
        self.assertEqual(self.plan["runnerShaByRunner"], {
            "V12_V4": "53a0be396719f0284af4e11b35c66a4ac7d58f79",
            "PENGU_V8": "7688ed7c93a1918d8b44837339b7da5584a868f5",
            "QUALITY102_CAUSAL_V1": "ef1ab178e26a7bf5bddb6473467765edba242e1d",
            "V52": "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81",
            "FET_BRK48_RESIDUAL": "7688ed7c93a1918d8b44837339b7da5584a868f5",
            "HYPE_TREND_LONG": "7688ed7c93a1918d8b44837339b7da5584a868f5",
            "IDLE_PRIORITY_SHORT": "7688ed7c93a1918d8b44837339b7da5584a868f5",
        })
        self.assertEqual(self.plan["runtimeTargets"]["V12_V4"], "V12_V4_V2_M150_D05_CORE_NATIVE")
        for runner in ("PENGU_V8","QUALITY102_CAUSAL_V1","V52","FET_BRK48_RESIDUAL","HYPE_TREND_LONG","IDLE_PRIORITY_SHORT"):
            self.assertEqual(self.plan["runtimeTargets"][runner], "DD1296_FINAL_ALLIN_10BPS")

    def test_activation_artifacts_preserve_per_runner_sha(self):
        artifacts = self.m.build_activation_artifacts(self.plan, "2026-11-02T00:00:00Z")
        self.assertEqual(artifacts["global"]["approvedSha"], self.plan["runnerShaByRunner"]["PENGU_V8"])
        self.assertEqual(artifacts["v4"]["approvedSha"], self.plan["runnerShaByRunner"]["V12_V4"])
        self.assertEqual(artifacts["q102"]["approvedSha"], self.plan["runnerShaByRunner"]["QUALITY102_CAUSAL_V1"])
        self.assertEqual(artifacts["v52"]["approvedSha"], self.plan["runnerShaByRunner"]["V52"])
        for artifact in artifacts.values():
            self.assertIs(artifact["ordersEnabled"], True)
            self.assertEqual(artifact["activationClass"], "FULL_LIVE")
            self.assertEqual(artifact["operatorAcknowledgement"], "I_ACK_REAL_MONEY_LIVE_ACTIVATION")
            self.assertEqual(artifact["approvedShaByRunner"], self.plan["runnerShaByRunner"])
        self.assertEqual(artifacts["v4"]["target"], "V12_V4_V2_M150_D05_CORE_NATIVE")
        self.assertEqual(artifacts["q102"]["approvedRunners"], ["QUALITY102_CAUSAL_V1"])
        self.assertEqual(set(artifacts["v52"]["approvedRunners"]), {"V52","FET_BRK48_RESIDUAL"})
        self.assertIs(artifacts["global"]["fetCorePreemptionReady"], True)

    def test_pin_manifest_mismatch_fails_closed(self):
        pins = {
            "schema": "disdex-runner-pin-manifest/v2",
            "target": "DD1296_FINAL_ALLIN_10BPS",
            "runners": {
                k: {"sha": v, "serviceUnit": "x@"+v+".service", "releaseRoot": "/home/deploy/disdex-trading/releases/"+v}
                for k,v in self.plan["runnerShaByRunner"].items()
            },
        }
        self.m.validate_pin_manifest(pins, self.plan)
        pins["runners"]["V52"]["sha"] = "0"*40
        with self.assertRaisesRegex(ValueError, "PIN_SHA_MISMATCH:V52"):
            self.m.validate_pin_manifest(pins, self.plan)

    def test_q102_or_v52_global_activation_wiring_is_rejected(self):
        units = {}
        for runner,path in self.plan["activationPathsByRunner"].items():
            units[runner] = "ExecStartPre=/usr/bin/node gate --activation-path " + path
        self.m.validate_activation_wiring(units, self.plan)
        units["QUALITY102_CAUSAL_V1"] = units["QUALITY102_CAUSAL_V1"].replace(
            self.plan["activationPathsByRunner"]["QUALITY102_CAUSAL_V1"],
            self.plan["activationPaths"]["global"],
        )
        with self.assertRaisesRegex(ValueError, "ACTIVATION_PATH_MISMATCH:QUALITY102_CAUSAL_V1"):
            self.m.validate_activation_wiring(units, self.plan)

    def test_publish_rolls_back_if_global_switch_fails(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            paths = {
                name: base / (name + ".json")
                for name in ("v4","q102","v52","global")
            }
            for name,path in paths.items():
                path.write_text(json.dumps({"old": name}), encoding="utf-8")
            artifacts = self.m.build_activation_artifacts(self.plan, "2026-11-02T00:00:00Z")
            calls = []
            def writer(path, value):
                calls.append(path.name)
                if path == paths["global"]:
                    raise RuntimeError("injected global switch failure")
                path.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "injected global switch failure"):
                self.m.publish_activation_transaction(paths, artifacts, writer=writer)
            for name,path in paths.items():
                self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"old": name})
            self.assertEqual(calls[:3], ["v4.json","q102.json","v52.json"])
            self.assertEqual(calls[3], "global.json")

    def test_post_publish_validation_failure_rolls_back_all_artifacts(self):
        with tempfile.TemporaryDirectory() as td:
            base=Path(td)
            paths={name:base/(name+".json") for name in ("v4","q102","v52","global")}
            for name,path in paths.items():
                path.write_text(json.dumps({"old":name}),encoding="utf-8")
            artifacts=self.m.build_activation_artifacts(self.plan,"2026-11-02T00:00:00Z")
            with self.assertRaisesRegex(RuntimeError,"post validation failed"):
                self.m.publish_activation_transaction(
                    paths, artifacts,
                    post_validate=lambda: (_ for _ in ()).throw(RuntimeError("post validation failed")),
                )
            for name,path in paths.items():
                self.assertEqual(json.loads(path.read_text(encoding="utf-8")),{"old":name})

    def test_plan_hash_is_file_sha256(self):
        import hashlib
        self.assertEqual(self.m.plan_sha256(PLAN), hashlib.sha256(PLAN.read_bytes()).hexdigest())

if __name__ == "__main__":
    unittest.main()
