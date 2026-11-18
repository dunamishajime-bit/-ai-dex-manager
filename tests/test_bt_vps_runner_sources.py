import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / "scripts" / "research" / "verify_bt_vps_runner_sources.py"
spec = importlib.util.spec_from_file_location("bt_vps_parity", MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class TestVpsRunnerParity(unittest.TestCase):
    def test_exact(self):
        self.assertEqual(mod.classify_blob(b"a\nb\n", b"a\nb\n"), "EXACT_BYTES")

    def test_line_endings_and_bom(self):
        self.assertEqual(
            mod.classify_blob(b"a\nb\n", b"\xef\xbb\xbfa\r\nb\r\n"),
            "NEWLINE_OR_BOM_ONLY",
        )

    def test_actual_code_change_is_not_normalized_away(self):
        self.assertEqual(mod.classify_blob(b"return 1;\n", b"return 2;\r\n"), "CONTENT_MISMATCH")

    def test_duplicate_active_runner_fails_closed(self):
        lines = []
        for name, (prefix, _) in mod.ENTRYPOINTS.items():
            lines.append(f"{prefix}@{'a' * 40}.service loaded active running")
        lines.append(f"disdex-v12-v4@{'b' * 40}.service loaded active running")
        with self.assertRaisesRegex(ValueError, "V4"):
            mod.selected_units("\n".join(lines))

    def test_missing_runner_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "expected exactly one"):
            mod.selected_units("disdex-v12-v4@" + "a" * 40 + ".service loaded active running")

    def test_absolute_or_relative_systemd_entrypoint(self):
        full = "/home/deploy/disdex-trading/releases/" + "a" * 40 + "/scripts/runner.ts"
        relative = "scripts/runner.ts"
        self.assertTrue(mod.entrypoint_in_execstart("argv[]=/usr/bin/node " + full + " --daemon", full, relative))
        self.assertTrue(mod.entrypoint_in_execstart("argv[]=/bin/tsx scripts/runner.ts --daemon", full, relative))
        self.assertFalse(mod.entrypoint_in_execstart("argv[]=/bin/tsx scripts/runner.ts.old --daemon", full, relative))

    def test_complete_unique_service_catalog(self):
        lines = [f"{prefix}@{'a' * 40}.service loaded active running" for prefix, _ in mod.ENTRYPOINTS.values()]
        selected = mod.selected_units("\n".join(lines))
        self.assertEqual(set(selected), set(mod.ENTRYPOINTS))


if __name__ == "__main__":
    unittest.main()
