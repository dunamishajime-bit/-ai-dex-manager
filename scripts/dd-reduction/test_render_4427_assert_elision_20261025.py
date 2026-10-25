#!/usr/bin/env python3
"""Synthetic and static tests only; never imports the research trading runner."""
import importlib.util
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("render4427_assert_audit", HERE / "audit_render_4427_assert_elision_20261025.py")
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


class TestAssertElision(unittest.TestCase):
    def test_static_assert_count(self):
        self.assertEqual([mod.scan_source(mod.HERE / name)["assert_count"] for name, _ in mod.TARGETS], [9, 9, 8])

    def test_normal_bytecode_keeps_asserts(self):
        for name, count in mod.TARGETS:
            self.assertEqual(mod.scan_source(mod.HERE / name)["bytecode_assertion_counts"]["0"], count)

    def test_optimize_one_removes_asserts(self):
        for name, _ in mod.TARGETS:
            self.assertEqual(mod.scan_source(mod.HERE / name)["bytecode_assertion_counts"]["1"], 0)

    def test_optimize_two_removes_asserts(self):
        for name, _ in mod.TARGETS:
            self.assertEqual(mod.scan_source(mod.HERE / name)["bytecode_assertion_counts"]["2"], 0)

    def test_synthetic_assert_normal_rejects(self):
        self.assertEqual(mod.synthetic_assert_semantics(0), "REJECT_ASSERTION")

    def test_synthetic_assert_optimized_passes(self):
        self.assertEqual(mod.synthetic_assert_semantics(1), "PASSED")
        self.assertEqual(mod.synthetic_assert_semantics(2), "PASSED")

    def test_no_trusted_root(self):
        self.assertEqual(mod.direct_python_launch_policy([sys.executable, "x.py"], {}, trusted_root=False),
                         "REJECT_NO_INDEPENDENT_TRUST_ROOT")

    def test_flag_O(self):
        self.assertEqual(mod.direct_python_launch_policy([sys.executable, "-O", "x.py"], {}, trusted_root=True),
                         "REJECT_OPTIMIZED_INTERPRETER")

    def test_flag_OO(self):
        self.assertEqual(mod.direct_python_launch_policy([sys.executable, "-OO", "x.py"], {}, trusted_root=True),
                         "REJECT_OPTIMIZED_INTERPRETER")

    def test_env_optimize(self):
        self.assertEqual(mod.direct_python_launch_policy([sys.executable, "x.py"], {"PYTHONOPTIMIZE": "1"}, trusted_root=True),
                         "REJECT_PYTHONOPTIMIZE_ENV")

    def test_import_env(self):
        self.assertEqual(mod.direct_python_launch_policy([sys.executable, "x.py"], {"PYTHONPATH": "x"}, trusted_root=True),
                         "REJECT_UNPINNED_IMPORT_ENVIRONMENT")

    def test_actual_optimized_guard_process(self):
        import subprocess
        code = (
            "import importlib.util,sys;"
            "p=r'%s';"
            "s=importlib.util.spec_from_file_location('audit',p);"
            "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
            "print(m.direct_python_launch_policy([sys.executable,'x.py'],{},trusted_root=True))"
        ) % str(HERE / "audit_render_4427_assert_elision_20261025.py")
        result = subprocess.run([sys.executable, "-O", "-c", code],
                                capture_output=True, text=True, timeout=20, check=True)
        self.assertEqual(result.stdout.strip(), "REJECT_RUNNING_INTERPRETER_OPTIMIZED")

    def test_unknown_interpreter(self):
        self.assertEqual(mod.direct_python_launch_policy(["python-unknown", "x.py"], {}, trusted_root=True),
                         "REJECT_UNKNOWN_PYTHON_INTERPRETER")

    def test_unknown_flag(self):
        self.assertEqual(mod.direct_python_launch_policy([sys.executable, "-c", "x.py"], {}, trusted_root=True),
                         "REJECT_UNKNOWN_INTERPRETER_ARGUMENT")

    def test_no_script(self):
        self.assertEqual(mod.direct_python_launch_policy([sys.executable], {}, trusted_root=True),
                         "REJECT_NO_SCRIPT")

    def test_synthetic_clean_is_not_order_permission(self):
        script = str(mod.HERE / mod.TARGETS[0][0])
        self.assertEqual(mod.direct_python_launch_policy([sys.executable, script], {}, trusted_root=True),
                         "RESEARCH_PRELAUNCH_INTERPRETER_ONLY_NOT_AUTHORIZED")

    def test_real_audit_no_runner_execution(self):
        result = mod.audit()
        self.assertEqual(result["total_assertions"], 26)
        self.assertFalse(result["runner_imported_or_executed"])
        self.assertFalse(result["native8_owner_registered"])
        self.assertFalse(result["trusted_root_available"])
        self.assertEqual(result["actual_orders"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
