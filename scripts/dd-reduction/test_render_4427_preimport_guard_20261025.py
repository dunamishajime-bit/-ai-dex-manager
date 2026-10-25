#!/usr/bin/env python3
"""Synthetic-only regression tests for pre-import research attestation."""
import ast
import hashlib
import tempfile
import unittest
from pathlib import Path
import importlib.util
HERE=Path(__file__).resolve().parent
SOURCE=HERE/"audit_render_4427_preimport_guard_20261025.py"
spec=importlib.util.spec_from_file_location("research_preimport",SOURCE)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class PreimportTests(unittest.TestCase):
    def test_actual_runner_static_effects(self):
        effect=mod.static_import_time((mod.WORKTREE/mod.RUNNER_REL).read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(effect["loadCallsAtModuleScope"]),2)
        self.assertTrue(any(x["save"] is True for x in effect["replayCallsAtModuleScope"]))
        self.assertGreaterEqual(len(effect["mutationsAtModuleScope"]),3)
        self.assertTrue(effect["moduleEffectsBeforeMain"])
    def test_no_root_fails_before_file_read(self):
        self.assertEqual(mod.preimport_attest(Path("C:/not-existing.py"),Path("C:/none"),None),
                         "REJECT_NO_INDEPENDENT_TRUST_ROOT")
    def test_path_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"runner.py"
            p.write_text((mod.WORKTREE/mod.RUNNER_REL).read_text(encoding="utf-8"),encoding="utf-8")
            result=mod.preimport_attest(p,mod.WORKTREE,{"independently_trusted":True})
            self.assertEqual(result,"REJECT_PREIMPORT_EXECUTION_ROOT_NOT_PINNED")
    def test_declared_runtime_root_mismatch(self):
        runner=mod.WORKTREE/mod.RUNNER_REL
        self.assertNotEqual(mod.declared_runtime_root(runner.read_text(encoding="utf-8")).resolve(),
                            mod.WORKTREE.resolve())
        pin={"independently_trusted":True}
        self.assertEqual(mod.preimport_attest(runner,mod.WORKTREE,pin),
                         "REJECT_PREIMPORT_DECLARED_ROOT_NOT_PINNED")
    def test_no_side_effect_import(self):
        with tempfile.TemporaryDirectory() as d:
            marker=Path(d)/"marker"
            runner=Path(d)/"runner.py"
            runner.write_text("from pathlib import Path\nPath("+repr(str(marker))+").write_text('RUN')\n")
            self.assertEqual(mod.preimport_attest(runner,Path(d),None),"REJECT_NO_INDEPENDENT_TRUST_ROOT")
            self.assertFalse(marker.exists())
    def test_unknown_ast_rejected(self):
        with self.assertRaises(ValueError):
            mod.static_import_time("x=1\n")
    def test_observed_sha_not_independent(self):
        self.assertEqual(mod.preimport_attest(mod.WORKTREE/mod.RUNNER_REL,mod.WORKTREE,
                                             {"runner_sha256":"a"*64}),
                         "REJECT_NO_INDEPENDENT_TRUST_ROOT")
    def test_guard_no_runner_import(self):
        text=SOURCE.read_text(encoding="utf-8")
        tree=ast.parse(text)
        imports=[x for x in ast.walk(tree) if isinstance(x,ast.ImportFrom)]
        self.assertFalse(any((x.module or "").startswith("run_render") for x in imports))
    def test_audit_deterministic(self):
        self.assertEqual(mod.audit(),mod.audit())
    def test_audit_no_live(self):
        x=mod.audit()
        self.assertFalse(x["runnerExecuted"])
        self.assertEqual(x["productionChanges"],0)
        self.assertEqual(x["liveOrders"],0)

if __name__=="__main__":
    unittest.main(verbosity=1)
