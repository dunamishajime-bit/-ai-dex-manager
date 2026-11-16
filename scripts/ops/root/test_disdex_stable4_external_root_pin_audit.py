"""Synthetic Root pin drift and no-promotion tests; no external Root import/execute."""
import hashlib
from pathlib import Path
import tempfile
import unittest

from disdex_stable4_root_dependency_graph_readonly import ROOTS
from disdex_stable4_external_root_pin_audit import (
    PIN_FILE, PIN_SCHEMA, PRODUCTION_ROOT, PRODUCTION_ROOT_POSIX, assess, read_pin_file, strict_json, validate_pins,
)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def manifest(pins, sites=None):
    return {
        "schema": PIN_SCHEMA, "rootPath": PRODUCTION_ROOT_POSIX,
        "observedSource": "OWNER_PC_PRIVATE_ROOT_SNAPSHOT_NOT_VPS_LIVE",
        "moduleSha256ByName": pins,
        "expectedDynamicImports": sites or [],
        "sourceClosureCertified": False, "productionReady": False,
        "ownerActivationAuthorized": False,
    }


class RootExternalPinTests(unittest.TestCase):
    def fixture(self, root):
        expected = {}
        for module in ROOTS:
            raw = b"# read-only fixture\nFIXTURE=1\n"
            (root / (module + ".py")).write_bytes(raw)
            expected[module] = digest(raw)
        return manifest(expected)

    def test_real_snapshot_declaration_is_review_only_and_has_full_21_module_scope(self):
        declaration = strict_json(PIN_FILE.read_bytes())
        modules, sites = validate_pins(declaration)
        self.assertEqual(len(modules), 21)
        self.assertEqual(len(sites), 4)
        self.assertFalse(declaration["sourceClosureCertified"])
        self.assertFalse(declaration["ownerActivationAuthorized"])

    def test_exact_synthetic_root_matches_but_never_certifies(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            observed = assess(root=root, declaration=self.fixture(root), offline_snapshot=True)
            self.assertEqual(observed["moduleCount"], len(ROOTS))
            self.assertFalse(observed["rootOwnershipChecked"])
            self.assertFalse(observed["sourceClosureCertified"])
            self.assertFalse(observed["deploymentAuthorized"])
            self.assertFalse(observed["productionReady"])

    def test_any_source_hash_drift_blocks(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            pinned = self.fixture(root)
            (root / (ROOTS[0] + ".py")).write_text("tampered=1\n")
            with self.assertRaisesRegex(ValueError, "INDEPENDENT_HASH_CHANGED"):
                assess(root=root, declaration=pinned, offline_snapshot=True)

    def test_missing_source_and_new_transitive_import_block(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            pinned = self.fixture(root)
            (root / (ROOTS[1] + ".py")).unlink()
            with self.assertRaisesRegex(ValueError, "MODULE_GRAPH_NOT_EXACT"):
                assess(root=root, declaration=pinned, offline_snapshot=True)
            (root / (ROOTS[1] + ".py")).write_text("import disdex_external_dynamic\n")
            pinned["moduleSha256ByName"][ROOTS[1]] = digest(
                (root / (ROOTS[1] + ".py")).read_bytes())
            with self.assertRaisesRegex(ValueError, "MODULE_GRAPH_NOT_EXACT"):
                assess(root=root, declaration=pinned, offline_snapshot=True)

    def test_new_loader_site_is_not_silently_approved(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            pinned = self.fixture(root)
            name = ROOTS[-1]
            raw = b"from importlib import util\nutil.spec_from_file_location('x','/tmp/y')\n"
            (root / (name + ".py")).write_bytes(raw)
            pinned["moduleSha256ByName"][name] = digest(raw)
            with self.assertRaisesRegex(ValueError, "DYNAMIC_LOADER_DRIFT"):
                assess(root=root, declaration=pinned, offline_snapshot=True)
            pinned["expectedDynamicImports"] = [
                {"kind": "EXTERNAL_CODE_LOADER_REQUIRES_REVIEW", "line": 2, "module": name}]
            observed = assess(root=root, declaration=pinned, offline_snapshot=True)
            self.assertEqual(observed["dynamicSiteCount"], 1)
            self.assertFalse(observed["externalRootIndependentlyReviewed"])

    def test_pin_json_and_self_authorization_rejected(self):
        for raw in [b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}']:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                strict_json(raw)
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            pinned = self.fixture(root)
            pinned["productionReady"] = True
            with self.assertRaisesRegex(ValueError, "UNTRUSTED_DECLARATION"):
                assess(root=root, declaration=pinned, offline_snapshot=True)

    def test_pin_document_must_be_canonical_root_owned_outside_offline_review(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "pins.json"
            path.write_bytes(PIN_FILE.read_bytes())
            self.assertEqual(len(read_pin_file(path, offline_snapshot=True)["moduleSha256ByName"]), 21)
            with self.assertRaisesRegex(ValueError, "ROOT_PIN_SOURCE_NOT_CANONICAL"):
                read_pin_file(path, offline_snapshot=False)

    def test_nonproduction_path_requires_explicit_offline_flag(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            pinned = self.fixture(root)
            with self.assertRaisesRegex(ValueError, "PRODUCTION_PATH_MISMATCH"):
                assess(root=root, declaration=pinned, offline_snapshot=False)


if __name__ == "__main__":
    unittest.main()
