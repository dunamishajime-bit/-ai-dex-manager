import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scripts" / "ops" / "root" / "disdex-runner-pin-manifest.mjs"


class RunnerPinManifestContractTest(unittest.TestCase):
    def test_root_manifest_module_exposes_file_loader_and_schema(self):
        source = MANIFEST.read_text(encoding="utf-8")
        self.assertIn('\"disdex-runner-pin-manifest/v2\"', source)\n        self.assertIn('healthPath', source)\n        self.assertIn('tickPath', source)
        self.assertIn("export async function loadRunnerPinManifestFromFile", source)
        self.assertIn("readFile", source)


if __name__ == "__main__":
    unittest.main()
