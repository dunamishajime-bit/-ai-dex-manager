#!/usr/bin/env python3
"""Research-only tests for strict runner-root identity and static path parsing."""
from __future__ import annotations
import importlib.util
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
P = Path(__file__).with_name("audit_render_4427_runtime_root_binding_20261025.py")
spec = importlib.util.spec_from_file_location("render4427_runtime_root_audit", P)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
SOURCE = (audit.REPO / "scripts/dd-reduction" / audit.RUNNER).read_text(encoding="utf8")

class RuntimeRootTests(unittest.TestCase):
    def test_root_mismatch_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "execution root not identical"):
            audit.require_isolated_root(audit.EXEC_ROOT, audit.REPO)

    def test_root_identity_accepted(self):
        self.assertTrue(audit.require_isolated_root(audit.REPO, audit.REPO))

    def test_bindings_resolve(self):
        x = audit.resolve_paths(SOURCE)
        self.assertEqual(x["REPO"], "C:/tmp/render-multiregime-study-20261024")

    def test_changed_repo_suffix_rejected(self):
        changed = SOURCE.replace("render-multiregime-study-20261024", "other-research-checkout", 1)
        with self.assertRaisesRegex(RuntimeError, "unexpected REPO root"):
            audit.resolve_paths(changed)

    def test_changed_dd_suffix_rejected(self):
        changed = SOURCE.replace("DD=REPO/'scripts/dd-reduction'", "DD=REPO/'other-scripts'", 1)
        with self.assertRaisesRegex(RuntimeError, "unexpected DD root"):
            audit.resolve_paths(changed)

    def test_changed_brain_root_rejected(self):
        changed = SOURCE.replace("HERE=ROOT/'render-mtf-study-20261024'", "HERE=ROOT/'other-brain'", 1)
        with self.assertRaisesRegex(RuntimeError, "unexpected external brain root"):
            audit.resolve_paths(changed)

    def test_changed_brain_filename_rejected(self):
        changed = SOURCE.replace("HERE/'render_4427_independent_rolling_profit_gate_20261024.py'",
                                 "HERE/'wrong_brain.py'", 1)
        with self.assertRaisesRegex(RuntimeError, "unexpected load path brain"):
            audit.resolve_paths(changed)

    def test_changed_base_filename_rejected(self):
        changed = SOURCE.replace("DD/'run-render-4427-native8-shared-wallet-20261024.py'",
                                 "DD/'wrong_base.py'", 1)
        with self.assertRaisesRegex(RuntimeError, "unexpected load path base"):
            audit.resolve_paths(changed)

    def test_dynamic_root_expression_rejected(self):
        changed = SOURCE.replace("ROOT=Path('C:/tmp')", "ROOT=Path(str(123))", 1)
        with self.assertRaises(RuntimeError):
            audit.resolve_paths(changed)

    def test_missing_binding_rejected(self):
        changed = SOURCE.replace("HERE=ROOT/'render-mtf-study-20261024'", "MISSING=ROOT/'render-mtf-study-20261024'", 1)
        with self.assertRaisesRegex(RuntimeError, "assignment missing"):
            audit.resolve_paths(changed)

    def test_crlf_only_parity(self):
        self.assertTrue(audit.equal_source_bytes(b"abc\r\ndef\r\n", b"abc\ndef\n"))

    def test_content_drift_rejected(self):
        self.assertFalse(audit.equal_source_bytes(b"abc\n", b"abX\n"))

    def test_graph_overapprox_unchanged(self):
        names, edges = audit.graph(audit.REPO / "scripts/dd-reduction")
        self.assertEqual((len(names), len(edges)), (47, 69))

    def test_external_digest_fixed(self):
        brain = audit.BRAIN_ROOT / "render_4427_independent_rolling_profit_gate_20261024.py"
        bank = audit.BRAIN_ROOT / "RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz"
        self.assertEqual(audit.sha(brain.read_bytes()), audit.EXPECTED_BRAIN)
        self.assertEqual(audit.sha(bank.read_bytes()), audit.EXPECTED_BANK)

    def test_result_not_native_authorization(self):
        result = audit.scan()
        self.assertFalse(result["nativeOwnerRegistered"])
        self.assertFalse(result["thirteenGateProofsCertified"])
        self.assertEqual(result["liveChanges"], 0)
        self.assertEqual(result["literalLinkedGitObjectBytesVerified"], 47)

if __name__ == "__main__":
    unittest.main(verbosity=1)
