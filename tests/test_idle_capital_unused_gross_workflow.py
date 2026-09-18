from __future__ import annotations

import json
import io
import sys
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from research_flat_boost_preemption_20260918 import (  # noqa: E402
    required_preemption_gross,
    build_blocked_result,
    validate_formal_artifact,
    validate_q102_lineage,
    main,
)


def formal_fixture() -> dict:
    return {
        "baseCommit": "bd5c731c966f41c38748433156062d579e45b6fc",
        "finalArchitecture": {
            "v12": {"slots": 2, "perPositionGrossCap": 1.0, "aggregateGrossCap": 1.5},
            "pengu": {"allocationGrossCap": 0.85, "hardStopCooldownHours": 24},
            "quality102": {"productionTarget": "Q102_CAUSAL_V4", "maximumGross": 1.5, "maximumPositions": 1},
            "v52": {
                "v50MinimumEntryBasisBps": 60.0,
                "v50ConvergenceBps": 20.0,
                "v50BasisStopMultiple": 1.75,
                "v50MinimumNetEdgeBps": 7.5,
            },
            "portfolio": {
                "cryptoGrossCap": 3.0,
                "stockGrossCap": 1.5,
                "totalGrossCap": 3.5,
                "sharedCryptoDailyLossPct": 7.5,
                "venueMargin": "5x Cross",
            },
        },
        "period": {
            "startInclusive": "2025-08-10T00:00:00.000Z",
            "endExclusive": "2026-08-10T00:00:00.000Z",
        },
        "finalCombined": {
            "NORMAL": {"asset": 69373656.13931108, "pf": 3.70258068, "dd": -17.59935397, "trades": 1165, "v52Events": 143},
            "SEVERE": {"asset": 8729157.74295382, "pf": 2.62470185, "dd": -19.24473938, "trades": 1023, "v52Events": 0},
        },
    }


class IdleCapitalWorkflowTests(unittest.TestCase):
    def test_formal_artifact_accepts_only_c735_integrated_rows(self) -> None:
        self.assertTrue(validate_formal_artifact(formal_fixture())["allPass"])

    def test_old_102_row_fixture_is_not_a_causal_v4_lineage(self) -> None:
        result = validate_q102_lineage({"path": "research/quality102_mtm_entry_evidence.csv", "rowCount": 102})
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "OLD_102_ROW_FIXTURE_FORBIDDEN")

    def test_causal_v4_manifest_accepts_recovered_90_to_69_routing(self) -> None:
        result = validate_q102_lineage({
            "path": "external/candidate-1slot.csv",
            "rowCount": 90,
            "sourceKind": "dynamic-causal-v4",
            "upstreamCandidates": 90,
            "integratedFills": 69,
            "sourceSha": "832f9a723fbb95b8a57201f67e51687bb07b33120851940328de1b3ba0e9567b",
        })
        self.assertTrue(result["accepted"])

    def test_required_preemption_trims_only_the_capacity_deficit(self) -> None:
        self.assertAlmostEqual(
            required_preemption_gross(
                overlay_gross=2.5,
                core_gross=1.2,
                crypto_cap=3.0,
                total_cap=3.5,
                core_is_crypto=True,
            ),
            0.7,
        )
        self.assertAlmostEqual(
            required_preemption_gross(
                overlay_gross=0.5,
                core_gross=1.0,
                crypto_cap=3.0,
                total_cap=3.5,
                core_is_crypto=True,
            ),
            0.0,
        )

    def test_missing_causal_input_builds_blocked_no_uplift_result(self) -> None:
        result = build_blocked_result({"q102": "MISSING_CAUSAL_V4_90_CANDIDATE_PAYLOAD"})
        self.assertEqual(result["status"], "BLOCKED_MISSING_FORMAL_LINEAGE")
        self.assertEqual(result["cases"], [])
        self.assertFalse(result["upliftAccepted"])
        self.assertEqual(result["safety"], {
            "mode": "RESEARCH_ONLY",
            "ordersSent": False,
            "liveChanged": False,
            "vpsChanged": False,
            "productionChanged": False,
        })

    def test_cli_missing_recovered_inputs_fails_closed(self) -> None:
        output = self._tmp_dir
        command = [
            str(ROOT / "scripts" / "research_flat_boost_preemption_20260918.py"),
            "--formal-json",
            str(ROOT / "docs" / "research-results" / "v52-final-validated-logic-20260917.json"),
            "--v12-ledger", str(output / "missing-v12.json"),
            "--pengu-ledger", str(output / "missing-pengu.json"),
            "--q102-csv", str(output / "missing-candidates.csv"),
            "--q102-evidence", str(output / "missing-evidence.csv"),
            "--stock-cache-dir", str(output / "missing-cache"),
            "--stock-backbone", str(output / "missing-backbone.py"),
            "--output-root",
            str(output),
        ]
        with mock.patch.object(sys, "argv", command), mock.patch("sys.stdout", new_callable=io.StringIO):
            with self.assertRaises(SystemExit) as raised:
                main()
        self.assertEqual(raised.exception.code, 2)
        result_path = output / "idle-capital-unused-gross-20260918.json"
        self.assertTrue(result_path.exists())
        result = json.loads(result_path.read_text(encoding="utf-8"))
        self.assertEqual(result["status"], "BLOCKED_MISSING_FORMAL_LINEAGE")
        self.assertEqual(result["cases"], [])

    def test_workflow_does_not_download_old_102_input(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "research-flat-boost-preemption.yml").read_text(encoding="utf-8")
        self.assertNotIn("latest-v12-pengu-v8-v52-dca-1y-33257164125", workflow)
        self.assertNotIn("quality102-frozen.csv", workflow)
        self.assertNotIn("  push:", workflow)
        self.assertIn("--formal-json", workflow)
        self.assertIn("--q102-csv", workflow)
        self.assertIn("--q102-evidence", workflow)
        self.assertIn("--stock-backbone", workflow)

    def test_completed_artifact_has_exact_current_parity_and_primary_targets(self) -> None:
        artifact = json.loads((ROOT / "docs" / "research-results" / "idle-capital-unused-gross-20260918.json").read_text(encoding="utf-8"))
        self.assertEqual(artifact["status"], "PASS_RESEARCH_ONLY")
        self.assertTrue(artifact["currentParity"]["allPass"])
        self.assertFalse(artifact["upliftAccepted"])
        primary = [row for row in artifact["cases"] if row["comparisonTier"] == "PRIMARY"]
        self.assertEqual({row["targetGross"] for row in primary}, {1.5, 2.0, 2.5, 3.0})
        self.assertEqual({row["caseId"] for row in primary if row["targetGross"] == 1.5}, {"CURRENT"})
        for mode, expected in {
            "NORMAL": {"asset": 69373656.13931108, "pf": 3.70258068, "dd": -17.59935397, "trades": 1165, "v52Events": 143},
            "SEVERE": {"asset": 8729157.74295382, "pf": 2.62470185, "dd": -19.24473938, "trades": 1023, "v52Events": 0},
        }.items():
            current = next(row for row in primary if row["mode"] == mode and row["caseId"] == "CURRENT")
            for key, value in expected.items():
                if isinstance(value, float):
                    self.assertAlmostEqual(current[key], value, places=8)
                else:
                    self.assertEqual(current[key], value)
            self.assertTrue(current["assetIsAuthoritative"])
            self.assertTrue(current["coreFillParity"])
            self.assertEqual(current["grossConflicts"], 0)
            self.assertEqual(current["causalEligibleCandidates"], 69)
            self.assertFalse(current["causalRouting"]["manualTruncation"])
    def setUp(self) -> None:
        import tempfile
        test_root = ROOT / ".research-state" / "idle-capital-test-output"
        test_root.mkdir(parents=True, exist_ok=True)
        self._tmp_dir = test_root


if __name__ == "__main__":
    unittest.main()
