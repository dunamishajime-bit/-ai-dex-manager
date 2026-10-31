"""Narrow contract tests; never runs systemctl or connects to Aster."""
import hashlib
import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[2] / "scripts/ops/deploy/disdex_margin_hold_secure_state_and_ghost_guard.py"
SPEC = importlib.util.spec_from_file_location("margin_hold", MODULE)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class Contract(unittest.TestCase):
    def test_production_sha_and_known_exact_helper(self):
        self.assertEqual(m.OWNER, "7688ed7c93a1918d8b44837339b7da5584a868f5")
        self.assertEqual(m.V52, "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81")
        self.assertEqual(
            m.SOURCE_SHA,
            "dcf703f00cbbb1fc428111a105d63a966b95e8defd2a7d87773586089c5243b0",
        )

    def test_security_exception_is_only_for_known_margin_state(self):
        self.assertIn("if path == MARGIN:", m.NEW)
        self.assertIn("st.st_uid != 1000", m.NEW)
        self.assertIn("st.st_gid != 1000", m.NEW)
        self.assertIn("parent.st_uid != 1000", m.NEW)
        self.assertIn("parent.st_gid != 1000", m.NEW)
        self.assertIn("stat.S_IMODE(parent.st_mode) != 0o700", m.NEW)
        self.assertIn("stat.S_IMODE(st.st_mode) not in (0o600, 0o660)", m.NEW)
        self.assertIn("elif st.st_mode & 0o077", m.NEW)
        self.assertEqual(m.OLD.count("UNTRUSTED_STATE_FILE"), 1)

    def test_patch_roundtrip_changes_only_exact_security_check(self):
        original = ("first\n" + m.OLD + "other original lines\n").encode()
        updated = original.replace(m.OLD.encode(), m.NEW.encode(), 1)
        self.assertEqual(updated.replace(m.NEW.encode(), m.OLD.encode(), 1), original)
        self.assertEqual(updated.count(m.NEW.encode()), 1)

    def test_unknown_helper_cannot_match_exact_source_hash(self):
        self.assertNotEqual(hashlib.sha256(b"unknown contents").hexdigest(), m.SOURCE_SHA)

    def test_broken_and_canonical_guard_are_distinct_exact_units(self):
        self.assertNotEqual(m.BROKEN_GUARD, m.OLD_GUARD)
        self.assertTrue(m.BROKEN_GUARD.endswith(m.V52 + ".service"))
        self.assertTrue(m.OLD_GUARD.endswith(m.OWNER + ".service"))


if __name__ == "__main__":
    unittest.main()
