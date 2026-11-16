"""Fail-closed immutable pending overlay source audit; source-only, no I/O to venue.

Seven Root-approved pending child blobs MUST match the frozen install contract.
Two Git-history recovery helpers are independently pinned. This does not attest
external Root, old/new writer isolation, Owner approval or LIVE parity.
"""
import ast
import hashlib
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
PINNED_ROOT = ROOT / "scripts/ops/root/disdex_pending_composite_upgrade.py"
HISTORICAL_READONLY_HELPERS = {
    "lib/aster-readonly-evidence-fetch.ts":
        "f2f821a53dd3f91f9ad92b6fad5196073464777887013a5070de30c7b3c76d02",
    "lib/disdex-pending-owned-venue.ts":
        "0b0bf4956b4ab147dbaf43b126dfba629f5e10e24a8f85b1348d44d74b633bb9",
}
PINNED_CHILD_PATHS = frozenset({
    "lib/disdex-pending-h48-composite.ts",
    "lib/disdex-pending-owned-witness.ts",
    "lib/disdex-pending-owner-evidence.ts",
    "lib/disdex-pending-protected-hold.ts",
    "scripts/ops/deploy/disdex_pending_maintenance.py",
    "scripts/ops/deploy/disdex_pending_refresh.py",
    "scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts",
})


def root_pinned_hashes():
    tree = ast.parse(PINNED_ROOT.read_bytes(), filename=str(PINNED_ROOT))
    literals = [ast.literal_eval(node.value)
                for node in tree.body if isinstance(node, ast.Assign)
                and any(isinstance(item, ast.Name) and item.id == "HASHES"
                        for item in node.targets)]
    if len(literals) != 1 or type(literals[0]) is not dict:
        raise ValueError("PINNED_PENDING_ROOT_HASHES_CHANGED")
    return literals[0]


def actual_hash(name):
    path = ROOT / name
    if path.is_symlink() or not path.is_file():
        raise ValueError("FROZEN_SOURCE_MISSING_OR_LINKED:" + name)
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PinnedPendingSourceClosureTests(unittest.TestCase):
    def test_seven_frozen_pending_child_blobs_match_root_exactly(self):
        expected = root_pinned_hashes()
        self.assertEqual(set(expected), PINNED_CHILD_PATHS)
        for name, expected_hash in sorted(expected.items()):
            with self.subTest(name=name):
                self.assertRegex(expected_hash, r"^[a-f0-9]{64}$")
                self.assertEqual(actual_hash(name), expected_hash)

    def test_historical_readonly_dependencies_are_exact_sha_pinned(self):
        for name, expected_hash in HISTORICAL_READONLY_HELPERS.items():
            with self.subTest(name=name):
                self.assertEqual(actual_hash(name), expected_hash)

    def test_external_root_imports_are_not_marked_production_authorized(self):
        # The local Root witness is NOT the Root installation certificate.
        # If these source-only statements disappear, require explicit review.
        source = PINNED_ROOT.read_text(encoding="utf-8")
        self.assertIn("PENDING_RECONCILE_ONLY", source)
        self.assertIn("row.get('ordersEnabled')is False", source)
        self.assertIn("from disdex_unified_root_gate import", source)
        self.assertIn("disdex_pending_maintenance_install", source)
        self.assertNotIn("sourceClosureCertified=True", source)


if __name__ == "__main__":
    unittest.main()
