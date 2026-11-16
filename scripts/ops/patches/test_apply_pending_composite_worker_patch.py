"""Synthetic fail-closed tests for the deterministic no-order pending overlay.

No VPS, venue credentials, running services, or source-tree mutation.
"""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name("apply_pending_composite_worker_patch.py")
spec = importlib.util.spec_from_file_location("pending_patch_review", SOURCE)
patcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)


class PendingOverlayNoOrderTests(unittest.TestCase):
    def test_real_local_research_patch_targets_match_root_contract_hashes(self):
        # CI source-only: compare the exact patch helper bytes to frozen root
        # expected SHA256 values without needing the prior Git worktree.
        root = SOURCE.parents[1] / "root" / "disdex_pending_composite_upgrade.py"
        expected = patcher._extract_reviewed_root_contract(root.read_text(encoding="utf-8"))
        for name in patcher.HELPERS:
            text = (SOURCE.parent / name).read_text(encoding="utf-8")
            self.assertEqual(patcher.digest(text), expected["lib/" + name])

    def test_source_patch_never_creates_source_with_unapproved_digest(self):
        expected = {"x": "0" * 64}
        with self.assertRaisesRegex(ValueError, "GENERATED_FILES_INCOMPLETE"):
            patcher._review_expected_outputs({"x": "hello"}, expected)

    def test_exact_pending_refresh_crlf_required(self):
        source = "x\n" * 152
        expected = patcher.digest(source.replace("\n", "\r\n"))
        self.assertEqual(patcher._normalize_pinned_refresh_newlines(source, expected),
                         source.replace("\n", "\r\n"))
        for changed in (source + "evil", source.replace("x", "y", 1),
                        source.replace("\n", "\r\n"), "x\n" * 151):
            with self.subTest(changed=changed[:5]), self.assertRaises(ValueError):
                patcher._normalize_pinned_refresh_newlines(changed, expected)

    def test_stage_writes_crlf_without_normalizing_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            stage = Path(d) / "isolated"
            payloads = {"scripts/ops/deploy/disdex_pending_refresh.py": "x\r\n" * 152,
                        "lib/helper.ts": "export const ok=true;\n"}
            patcher.write_private_review_stage(stage, payloads)
            for name, text in payloads.items():
                data = (stage / name).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), patcher.digest(text))
            with self.assertRaisesRegex(ValueError, "STAGE_ALREADY_EXISTS"):
                patcher.write_private_review_stage(stage, payloads)

    def test_stage_path_traversal_fails_without_writing_external_file(self):
        with tempfile.TemporaryDirectory() as d:
            stage = Path(d) / "new"
            escape = Path(d) / "outside.py"
            with self.assertRaisesRegex(ValueError, "ESCAPES_STAGE"):
                patcher.write_private_review_stage(stage, {"../outside.py": "x"})
            self.assertFalse(escape.exists())

    def test_stage_release_destination_refused(self):
        with tempfile.TemporaryDirectory() as d:
            stage = Path(d) / "releases" / "new"
            with self.assertRaisesRegex(ValueError, "RELEASE_PATH_DENIED"):
                patcher.write_private_review_stage(stage, {"lib/a.py": "x"})
            self.assertFalse(stage.exists())

    def test_mismatched_root_sha_and_hashes_fail_closed(self):
        source = "NEW='0'*40\nOLD='1'*40\nHASHES={}\n"
        with self.assertRaises((ValueError, TypeError)):
            patcher._extract_reviewed_root_contract(source)


if __name__ == "__main__":
    unittest.main()