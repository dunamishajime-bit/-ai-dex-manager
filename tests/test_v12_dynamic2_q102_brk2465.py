from __future__ import annotations
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULT = ROOT / "docs" / "research-results" / "v12-dynamic2-q102-brk2465-20260919.json"

class V12Dynamic2Q102Brk2465Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.payload = json.loads(RESULT.read_text(encoding="utf-8"))

    def test_research_contract_passes(self) -> None:
        self.assertEqual(self.payload["status"], "PASS_RESEARCH_ONLY")
        self.assertEqual(self.payload["schema"], "v12-dynamic2-q102-brk2465/v1")
        self.assertFalse(self.payload["safety"]["ordersSent"])
        self.assertFalse(self.payload["safety"]["liveChanged"])
        self.assertFalse(self.payload["safety"]["vpsChanged"])
        self.assertFalse(self.payload["safety"]["productionChanged"])

    def test_configuration_is_frozen(self) -> None:
        cfg = self.payload["configuration"]
        self.assertEqual(cfg["v12BaseAggregateGross"], 1.5)
        self.assertEqual(cfg["v12DynamicAggregateGrossCap"], 2.0)
        self.assertEqual(cfg["v12PerPositionGrossCap"], 1.0)
        self.assertEqual(cfg["penguGross"], 0.85)
        self.assertEqual(cfg["q102FamilyCaps"],
            {"HIGH_VOL": 1.665, "MR": 1.0, "BRK": 2.465, "REV": 2.5, "PB": 2.5})
        self.assertEqual(cfg["v52StockGross"], 1.98)
        self.assertEqual(cfg["v52SlotGross"], 1.64)
        self.assertEqual(cfg["cryptoGrossCap"], 3.0)
        self.assertEqual(cfg["totalGrossCap"], 3.5)

    def test_normal_result(self) -> None:
        row = next(r for r in self.payload["results"] if r["scenario"] == "NORMAL")
        self.assertTrue(row["strictPass"])
        self.assertTrue(row["coreFillParity"])
        self.assertEqual(row["grossConflicts"], 0)
        self.assertAlmostEqual(row["endingAssetJpy"], 270126566.3772751, places=2)
        self.assertAlmostEqual(row["maxDrawdownPct"], -19.72421906, places=7)
        self.assertEqual(row["routing"]["V12_ENTERED"], 874)
        self.assertEqual(row["routing"]["SUPPLEMENT_ENTERED"], 69)

    def test_severe_result(self) -> None:
        row = next(r for r in self.payload["results"] if r["scenario"] == "SEVERE")
        self.assertTrue(row["strictPass"])
        self.assertTrue(row["coreFillParity"])
        self.assertEqual(row["grossConflicts"], 0)
        self.assertAlmostEqual(row["endingAssetJpy"], 24184641.27364947, places=2)
        self.assertAlmostEqual(row["maxDrawdownPct"], -19.97886021, places=7)
        self.assertEqual(row["routing"]["V12_ENTERED"], 871)
        self.assertEqual(row["routing"]["SUPPLEMENT_ENTERED"], 69)

if __name__ == "__main__":
    unittest.main()
