import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "ops" / "root" / "disdex-current-runtime-wiring"


class RuntimeWiringV52CapsTest(unittest.TestCase):
    def test_v52_strict_caps_override_legacy_environment(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("DISDEX_V52_CRYPTO_GROSS_CAP=2.0", source)
        self.assertIn("DISDEX_V52_STOCK_GROSS_CAP=1.5", source)
        self.assertIn("DISDEX_V52_PORTFOLIO_GROSS_CAP=2.5", source)


if __name__ == "__main__":
    unittest.main()
