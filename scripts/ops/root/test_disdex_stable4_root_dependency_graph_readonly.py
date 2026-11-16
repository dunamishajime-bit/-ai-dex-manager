import hashlib
from pathlib import Path
import tempfile
import unittest

from disdex_stable4_root_dependency_graph_readonly import dependency_names, scan


class RootGraphReadOnlyTests(unittest.TestCase):
    def test_static_module_graph_is_observed_not_approved(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p / "disdex_a.py").write_text("from disdex_b import x\n")
            (p / "disdex_b.py").write_text("x=1\n")
            observed = scan(p, seeds=["disdex_a"], enforce_root_ownership=False)
            self.assertEqual(observed["moduleCount"], 2)
            self.assertFalse(observed["missing"])
            self.assertEqual(observed["status"], "INSTALLED_ROOT_GRAPH_OBSERVED_REVIEW_REQUIRED")
            self.assertIs(observed["sourceClosureCertified"], False)
            self.assertIs(observed["deploymentAuthorized"], False)

    def test_missing_and_dynamic_dependencies_block(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p / "disdex_a.py").write_text(
                "from disdex_absent import x\nfrom importlib import import_module\n"
                "dynamic = 'disdex_elsewhere'\nimport_module(dynamic)\n")
            result = scan(p, seeds=["disdex_a"], enforce_root_ownership=False)
            self.assertEqual(result["status"], "BLOCKED_MISSING_OR_DYNAMIC_ROOT_MODULES")
            self.assertEqual(result["missing"], ["disdex_absent"])
            self.assertEqual(len(result["dynamicImports"]), 1)

    def test_independent_hash_mismatch_fails_before_approval(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p / "disdex_a.py").write_text("x=1\n")
            with self.assertRaisesRegex(ValueError, "HASH_CHANGED"):
                scan(p, seeds=["disdex_a"], enforce_root_ownership=False,
                     expected_sha256_by_name={"disdex_a": "0" * 64})

    def test_symlink_module_cannot_escape_source_root(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p / "disdex_a.py").write_text("x=1\n")
            try:
                (p / "disdex_b.py").symlink_to("disdex_a.py")
            except OSError:
                self.skipTest("Windows symlink privileges absent")
            result = scan(p, seeds=["disdex_b"], enforce_root_ownership=False)
            self.assertEqual(result["missing"], ["disdex_b"])

    def test_static_import_module_and_dynamic_builtin(self):
        deps, dynamic = dependency_names(
            b"import importlib\na=importlib.import_module('disdex_fixed')\n"
            b"b=__import__(name)\n", name="disdex_a")
        self.assertEqual(deps, ["disdex_fixed"])
        self.assertEqual(len(dynamic), 1)

    def test_dynamic_external_python_loader_is_never_silent(self):
        deps, dynamic = dependency_names(
            b"import importlib.util\nspec=importlib.util.spec_from_file_location(name,path)\n"
            b"spec.loader.exec_module(module)\n", name="disdex_a")
        self.assertEqual(deps, [])
        self.assertEqual(len(dynamic), 2)
        self.assertTrue(all(r["kind"] == "EXTERNAL_CODE_LOADER_REQUIRES_REVIEW" for r in dynamic))
    def test_path_traversal_and_missing_root_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            with self.assertRaisesRegex(ValueError, "MODULE_NAME"):
                scan(p, seeds=["../disdex_escape"], enforce_root_ownership=False)
            with self.assertRaisesRegex(ValueError, "DIR_MISSING"):
                scan(p / "missing", seeds=["disdex_a"], enforce_root_ownership=False)


if __name__ == "__main__":
    unittest.main()