#!/usr/bin/env python3
"""No-venue, no-Production selftests for Q102 scoped promoter boundaries."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

FILE = Path(__file__).with_name("disdex-q102-owner-approved-promote")
spec = importlib.util.spec_from_file_location("q102_promoter", FILE)
# importlib requires a Python loader for extensionless scripts.
from importlib.machinery import SourceFileLoader
loader = SourceFileLoader("q102_promoter", str(FILE))
spec = importlib.util.spec_from_loader(loader.name, loader)
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)

OLD = "7" * 40
NEW = "e" * 40

class PromoterSafetyTests(unittest.TestCase):
    def test_sha_rejects_invalid_values_without_io(self):
        with self.assertRaisesRegex(RuntimeError, "SHA_INVALID"):
            mod.validate(False, "bad", OLD)
        with self.assertRaisesRegex(RuntimeError, "SHA_INVALID"):
            mod.validate(False, OLD, OLD)

    def test_missing_root_economic_certificate_rejects(self):
        with tempfile.TemporaryDirectory() as t:
            f = Path(t) / "absent.json"
            with self.assertRaisesRegex(RuntimeError, "JSON_MISSING"):
                mod.protected_root_file(f)

    def test_extra_environment_syntax_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            f = Path(t) / "env"
            f.write_text("EXPORTED_KEY=true\nexport BAD=true\n")
            with self.assertRaisesRegex(RuntimeError, "ENV_FORMAT_UNSUPPORTED"):
                mod.systemd_env(f)

    def test_legitimate_systemd_quote_parse(self):
        with tempfile.TemporaryDirectory() as t:
            f = Path(t) / "env"
            f.write_text('QUALITY102_LIVE_ENABLED="false"\nDISDEX_RELEASE_SHA="old"\n')
            values = mod.systemd_env(f)
            self.assertEqual(values["QUALITY102_LIVE_ENABLED"], "false")

    def test_economic_source_manifest_cannot_be_omitted(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            names = {
                "STATE": t / "state.json", "GLOBAL_APPROVAL": t / "global.json",
                "SCOPED_APPROVAL": t / "scoped.json", "ECONOMICS": t / "econ.json",
                "KILL": t / "kill.json", "RISK": t / "risk.json", "STAGING": t / "staging",
            }
            stage = names["STAGING"] / f"q102-{NEW}-20261028"
            stage.mkdir(parents=True)
            (stage / ".disdex-release-sha").write_text(NEW)
            ready = stage / "docs/production/current-implementation-readiness.json"
            ready.parent.mkdir(parents=True)
            ready.write_text(json.dumps({
                "schema":"disdex-current-implementation-readiness/v1",
                "implementationStatus":"READY",
                "blockers":["OPERATOR_LIVE_ACTIVATION_REQUIRED"],
                "target":"DD1296_FINAL_ALLIN_10BPS",
            }))
            tsx = stage / "node_modules/.bin/tsx"
            tsx.parent.mkdir(parents=True)
            tsx.write_text("test")
            names["STATE"].write_text(json.dumps({"runtimeCommitSha":OLD,"mode":"LIVE"}))
            names["KILL"].write_text(json.dumps({"active":False}))
            names["RISK"].write_text(json.dumps({
                "tripped":False,"sourceComplete":True,
                "lossPct":0.0,"maximumLossPct":7.5,
            }))
            raw_global = {"approvedSha":OLD, "approvedRunners":[mod.STRATEGY], "ordersEnabled":True}
            scoped = {
                "schema":"disdex-live-operator-activation/v1","approvedSha":NEW,
                "approvedRunners":[mod.STRATEGY],"ordersEnabled":True,
                "target":"DD1296_FINAL_ALLIN_10BPS",
                "operatorAcknowledgement":"I_ACK_REAL_MONEY_LIVE_ACTIVATION",
            }
            econ = {
                "schema":"q102-exact-eight-native-economics/v1",
                "status":"CERTIFIED_NEW_Q102_CONCURRENCY_NATIVE8",
                "targetSha":NEW,"oldQ102Sha":OLD,"sourceParity":True,
                "accounting":"PASS","deterministic":True,
                "strategies":["V12","Q102","PENGU","IDLE","RESIDUAL","V52","HYPE_LONG","FET"],
                "results":{
                    "10bps":{"accounting":"PASS","finalEquityJpy":1,"maxMtmDdPct":-10,"targetSha":NEW},
                    "30bps":{"accounting":"PASS","finalEquityJpy":1,"maxMtmDdPct":-12,"targetSha":NEW}
                }
            }
            def root_file(p):
                if p == names["GLOBAL_APPROVAL"]:return raw_global
                if p == names["SCOPED_APPROVAL"]:return scoped
                if p == names["ECONOMICS"]:return econ
                raise AssertionError(p)
            names["GLOBAL_APPROVAL"].write_text(json.dumps(raw_global))
            patches=[patch.object(mod,k,v) for k,v in names.items()]
            try:
                for x in patches:x.start()
                with patch.object(mod,"protected_root_file",side_effect=root_file),\
                     patch.object(mod,"active",side_effect=lambda unit: OLD in unit),\
                     patch.object(mod,"run",side_effect=lambda *args, **kw: types.SimpleNamespace(stdout=f"disdex-quality102-causal-v1@{OLD}.service loaded active running\\n")),\
                     patch.object(mod.os,"geteuid",return_value=0):
                    with self.assertRaisesRegex(RuntimeError,"SOURCE_HASH_MANIFEST_REQUIRED"):
                        mod.validate(True,NEW,OLD)
                    files=[
                        "lib/disdex-quality102-causal-v4-signal.ts",
                        "lib/disdex-quality102-causal-v1-runner.ts",
                        "scripts/disdex-quality102-causal-v1-live-runner.ts",
                    ]
                    manifest={}
                    for p in files:
                        f=stage/p
                        f.parent.mkdir(parents=True,exist_ok=True)
                        f.write_text("safe test fixture")
                        manifest[p]=hashlib.sha256(f.read_bytes()).hexdigest()
                    econ["sourceFileSha256"]=manifest
                    stage_found,state,digest=mod.validate(True,NEW,OLD)
                    self.assertEqual(stage_found,stage)
                    self.assertEqual(state["runtimeCommitSha"],OLD)
                    self.assertEqual(digest,hashlib.sha256(names["GLOBAL_APPROVAL"].read_bytes()).hexdigest())
                    (stage/files[0]).write_text("tampered source")
                    with self.assertRaisesRegex(RuntimeError, "EXACT_STAGED_SOURCE_HASH_MISMATCH"):
                        mod.validate(True,NEW,OLD)
            finally:
                for x in reversed(patches):x.stop()

if __name__=="__main__":
    unittest.main()
