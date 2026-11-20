import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / "scripts/research/audit_bt_live_dependency_closure.py"
spec = importlib.util.spec_from_file_location("bt_closure", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ClosureTests(unittest.TestCase):
    def test_relative_resolution(self):
        self.assertIn("lib/engine.ts", module.candidates("scripts/main.ts", "../lib/engine"))
        self.assertIn("lib/model/index.ts", module.candidates("lib/runner.ts", "./model"))

    def test_import_escape_rejected(self):
        with self.assertRaisesRegex(ValueError, "escapes"):
            module.candidates("scripts/a.ts", "../../../outside")

    def test_transitive_dependency_and_missing_import(self):
        files = {
            "scripts/entry.ts": b'import "../lib/engine"; import "dotenv";',
            "lib/engine.ts": b'import "./model"; import "./missing";',
            "lib/model.ts": b'export const x=1;',
        }
        with patch.object(module, "git_file", side_effect=lambda sha, path, root: files.get(path)):
            result = module.closure("a"*40, "scripts/entry.ts", Path("."))
        self.assertEqual(result["resolved_repo_files"], 3)
        self.assertEqual(result["external_imports"], ["dotenv"])
        self.assertEqual(len(result["unresolved_relative_imports"]), 1)
        self.assertFalse(result["runtime_dependency_bytes_verified"])

    def test_missing_entrypoint_fails(self):
        with patch.object(module, "git_file", return_value=None):
            with self.assertRaisesRegex(ValueError, "Missing pinned"):
                module.closure("a"*40, "scripts/no.ts", Path("."))

    def test_unverified_live_evidence_fails(self):
        with self.assertRaisesRegex(ValueError, "unverified"):
            module.audit({"schema": "disdex-bt-vps-entrypoint-parity/v1", "all_entrypoints_verified": False}, Path("."))


if __name__ == "__main__":
    unittest.main()
