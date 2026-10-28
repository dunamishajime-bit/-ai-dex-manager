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


if __name__ == "__main__":
    unittest.main()
