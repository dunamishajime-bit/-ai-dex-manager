import tempfile
import unittest
from pathlib import Path

from scripts.disdex_runner_tick_heartbeat import write_runner_tick_heartbeat


class RunnerTickHeartbeatContractTest(unittest.TestCase):
    def test_writes_atomic_marker_with_identity_and_status(self):
        sha = "b" * 40
        with tempfile.TemporaryDirectory(prefix="disdex-runner-tick-") as root:
            marker = write_runner_tick_heartbeat(
                runner_id="V52",
                runtime_sha=sha,
                service_unit=f"disdex-v52-aster-only@{sha}.service",
                tick_started_at=1000,
                tick_completed_at=1250,
                status="held",
                reason="MARKET_CLOSED_REFERENCE_DEFERRED",
                counters={"ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0},
                root=Path(root),
            )
            self.assertEqual(marker["schema"], "disdex-runner-tick-heartbeat/v1")
            self.assertEqual(marker["runnerId"], "V52")
            self.assertEqual(marker["runtimeSha"], sha)
            self.assertEqual(marker["tickCompletedAt"], 1250)
            self.assertEqual(sorted((Path(root) / "ticks").iterdir()), [Path(root) / "ticks" / "V52.json"])

    def test_rejects_invalid_identity_and_negative_counter(self):
        with tempfile.TemporaryDirectory(prefix="disdex-runner-tick-") as root:
            with self.assertRaises(ValueError):
                write_runner_tick_heartbeat(
                    runner_id="V52",
                    runtime_sha="bad",
                    service_unit="bad.service",
                    tick_started_at=1000,
                    tick_completed_at=1250,
                    status="held",
                    reason="x",
                    counters={"ordersSent": 0, "cancelsSent": -1, "positionChangesSent": 0},
                    root=Path(root),
                )
            with self.assertRaises(ValueError):
                write_runner_tick_heartbeat(
                    runner_id="V52",
                    runtime_sha="b" * 40,
                    service_unit=f"disdex-v52-aster-only@{'b' * 40}.service",
                    tick_started_at=0,
                    tick_completed_at=1250,
                    status="held",
                    reason="x",
                    counters={"ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0},
                    root=Path(root),
                )

    def test_v52_live_entrypoint_records_completed_cycles(self):
        source = (Path(__file__).resolve().parents[1] / "scripts" / "disdex_v52_aster_only_legacy_engine.py").read_text(encoding="utf-8")
        self.assertIn("write_runner_tick_heartbeat", source)
        self.assertIn("tick_started_at", source)
        self.assertIn("tick_completed_at", source)


if __name__ == "__main__":
    unittest.main()
