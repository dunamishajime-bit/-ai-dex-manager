from __future__ import annotations

import unittest

from research.formal_five_bt.runtime_source import _internal_imports, _valid_source_path


class RuntimeSourceClosureTests(unittest.TestCase):
    def test_typescript_alias_and_relative_imports_are_resolved_only_to_repo_sources(self) -> None:
        available = {
            "scripts/runner.ts",
            "lib/live-decision.ts",
            "config/runtime.json",
            "data/symbols.json",
            "node_modules/dotenv/config.js",
            "config/.env",
        }
        source = '''
            import { decision } from "@/lib/live-decision";
            import settings from "../config/runtime.json";
            import "dotenv/config";
        '''
        self.assertEqual(_internal_imports("scripts/runner.ts", source, available), {
            "lib/live-decision.ts", "config/runtime.json",
        })

    def test_python_local_imports_are_scoped_to_scripts_and_env_files_are_rejected(self) -> None:
        available = {"scripts/legacy_engine.py", "scripts/strict_planner.py", "lib/not_a_python_module.py"}
        source = "import legacy_engine\nfrom strict_planner import plan\nimport os\n"
        self.assertEqual(_internal_imports("scripts/runner.py", source, available), {
            "scripts/legacy_engine.py", "scripts/strict_planner.py",
        })
        self.assertIsNone(_valid_source_path(".env"))
        self.assertIsNone(_valid_source_path("scripts/../.env"))
        self.assertIsNone(_valid_source_path("config/.env"))


if __name__ == "__main__":
    unittest.main()
