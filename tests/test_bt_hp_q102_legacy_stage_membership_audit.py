"""BT-481-K: disallow promotion of legacy Q102 selected fixture to upstream S1/S2 IDs."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from bt_hp_q102_legacy_stage_membership_audit import (
    EXPECTED_SOURCE_SHA256, RESULT, audit_legacy_stage_fixture
)

SOURCE = Path(__file__).resolve().parents[1] / (
    "lib/bt-verification/pinned-native-q102/disdex-quality102-causal-pipeline.ts"
)
HEADER = "layer,symbol,signal_timestamp_ms,entry_timestamp_ms,side\n"
H = 3_600_000


class Q102LegacyFixture(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        root = Path(self.work.name)
        self.fixture = root / "fixture.csv"
        self.script = root / "reconstruction.py"
        self.source = SOURCE
        self.rows = []
        t = (1_700_000_000_000 // H) * H
        for i in range(18):
            stage = "S1" if i < 8 else "S2"
            ts = t + i * 5 * H
            self.rows.append(f"{stage},TAO,{ts},{ts+H},-1\n")
        self.save_rows()
        self.script.write_text(
            "ORIGINAL_RAW_GENERATOR_PROVEN = False\nRESEARCH_ONLY = True\n",
            encoding="utf-8",
        )

    def save_rows(self):
        self.fixture.write_text(HEADER + "".join(self.rows), encoding="utf-8")

    def audit(self):
        return audit_legacy_stage_fixture(self.fixture, self.source, self.script)

    def test_research_fixture_never_becomes_production_membership(self):
        result = self.audit()
        self.assertEqual(result["sourceSha256"], EXPECTED_SOURCE_SHA256)
        self.assertEqual(result["outcome"], RESULT)
        self.assertEqual(result["historicSelectedStageCounts"], {"S1": 8, "S2": 10})
        self.assertEqual(result["historicSelectedRows"], 18)
        self.assertEqual(result["upstreamExpandedExpected"], 30)
        self.assertFalse(result["verifiedStageMembership"])
        self.assertFalse(result["upstreamExpandedIdsSupplied"])
        self.assertEqual(result["approvedNativeS1S2Entries"], 0)
        self.assertEqual(result, self.audit())

    def test_missing_row(self):
        self.rows.pop()
        self.save_rows()
        with self.assertRaisesRegex(ValueError, "ROW_COUNT_CHANGED"):
            self.audit()

    def test_changed_stage_count(self):
        self.rows[0] = self.rows[0].replace("S1,", "S2,", 1)
        self.save_rows()
        with self.assertRaisesRegex(ValueError, "STAGE_COUNTS_CHANGED"):
            self.audit()

    def test_future_entry_not_one_hour(self):
        self.rows[0] = self.rows[0].replace(",TAO,", ",TAO,", 1)
        fields = self.rows[0].strip().split(",")
        fields[3] = str(int(fields[2])+2*H)
        self.rows[0] = ",".join(fields)+"\n"
        self.save_rows()
        with self.assertRaisesRegex(ValueError, "TIME_CAUSALITY"):
            self.audit()

    def test_out_of_order(self):
        self.rows[0], self.rows[1] = self.rows[1], self.rows[0]
        self.save_rows()
        with self.assertRaisesRegex(ValueError, "TIME_CAUSALITY"):
            self.audit()

    def test_invalid_side(self):
        self.rows[0] = self.rows[0].replace(",-1\n", ",0\n")
        self.save_rows()
        with self.assertRaisesRegex(ValueError, "TIME_CAUSALITY"):
            self.audit()

    def test_columns_changed(self):
        self.fixture.write_text("layer,symbol,signal_timestamp_ms\n" +
                                "".join(self.rows),encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "COLUMNS_CHANGED"):
            self.audit()

    def test_provenance_becomes_falsely_proven(self):
        self.script.write_text(
            "ORIGINAL_RAW_GENERATOR_PROVEN = True\nRESEARCH_ONLY = True\n",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "PROVENANCE_NOT_EXPLICIT"):
            self.audit()

    def test_source_tampering(self):
        bad = Path(self.work.name) / "source.ts"
        bad.write_bytes(SOURCE.read_bytes()+b"tampered")
        self.source = bad
        with self.assertRaisesRegex(ValueError, "SOURCE_PIN_MISMATCH"):
            self.audit()


if __name__ == "__main__":
    unittest.main()
