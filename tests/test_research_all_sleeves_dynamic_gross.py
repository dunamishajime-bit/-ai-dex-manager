from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import research_all_sleeves_dynamic_gross_20260918 as sweep


class AllSleevesDynamicGrossTests(unittest.TestCase):
    def setUp(self) -> None:
        self.artifact = json.loads(
            (ROOT / "docs" / "research-results" / "all-sleeves-dynamic-gross-20260918.json")
            .read_text(encoding="utf-8")
        )

    def row(self, name: str, scenario: str) -> dict:
        return next(
            row for row in self.artifact["rows"]
            if row["name"] == name and row["scenario"] == scenario
        )

    def test_q102_frontier_is_frozen(self) -> None:
        self.assertEqual(
            sweep.Q102_FRONTIER,
            {"HIGH_VOL": 1.665, "MR": 1.0, "BRK": 2.475, "REV": 2.5, "PB": 2.5},
        )
    def test_config_names_are_unique(self) -> None:
        configs = sweep.configs()
        names = [row["name"] for row in configs]
        self.assertEqual(len(names), len(set(names)))
        self.assertIn("V52_FINE_G1.98_S1.64", names)
        self.assertIn("V52_CORNER_G1.9834_S1.6498", names)

    def test_buffered_v52_candidate_passes_contract(self) -> None:
        for scenario in ("NORMAL", "SEVERE"):
            row = self.row("V52_FINE_G1.98_S1.64", scenario)
            self.assertTrue(row["coreFillParity"])
            self.assertEqual(row["grossConflicts"], 0)
            self.assertGreaterEqual(row["maxDrawdownPct"], -20.0)
            self.assertLessEqual(row["maxCryptoGross"], 3.0 + 1e-9)
            self.assertLessEqual(row["maxTotalGross"], 3.5 + 1e-9)
        normal = self.row("V52_FINE_G1.98_S1.64", "NORMAL")
        self.assertAlmostEqual(normal["endingAssetJpy"], 258717730.6803819, places=2)
        self.assertAlmostEqual(normal["maxDrawdownPct"], -19.64868214, places=6)

    def test_edge_frontier_is_recorded_but_neighbor_fails(self) -> None:
        edge = self.row("V52_CORNER_G1.9834_S1.6498", "NORMAL")
        fail = self.row("V52_EDGE_G1.9836_S1.645", "NORMAL")
        self.assertTrue(edge["coreFillParity"])
        self.assertFalse(fail["coreFillParity"])
        self.assertEqual(fail["routing"]["V12_ENTERED"], 873)
    def test_v12_and_pengu_increases_are_rejected(self) -> None:
        v12 = self.row("V12_1.525", "SEVERE")
        self.assertLess(v12["maxDrawdownPct"], -20.0)
        pengu = self.row("PENGU_0.875", "SEVERE")
        self.assertFalse(pengu["coreFillParity"])
        self.assertEqual(pengu["routing"]["V12_ENTERED"], 869)

    def test_artifact_is_research_only(self) -> None:
        self.assertTrue(self.artifact["researchOnly"])
        safety = self.artifact["safety"]
        self.assertFalse(safety["ordersSent"])
        self.assertFalse(safety["liveChanged"])
        self.assertFalse(safety["vpsChanged"])
        self.assertFalse(safety["productionChanged"])


if __name__ == "__main__":
    unittest.main()
