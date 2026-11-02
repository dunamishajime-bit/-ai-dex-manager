import os
import shutil
import tempfile
import unittest
import uuid
from contextlib import contextmanager
from pathlib import Path

from scripts.disdex_runner_tick_heartbeat import write_runner_tick_heartbeat


@contextmanager
def _portable_temporary_directory(prefix: str = "disdex-runner-tick-"):
    """Avoid restrictive mode-0700 ACLs from Microsoft Store Python."""
    if os.name != "nt":
        with tempfile.TemporaryDirectory(prefix=prefix) as td:
            yield Path(td)
        return

    root = Path(tempfile.gettempdir()) / f"{prefix}{uuid.uuid4().hex}"
    root.mkdir(mode=0o755)
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=False)


class RunnerTickHeartbeatContractTest(unittest.TestCase):
    def test_writes_atomic_marker_with_identity_and_status(self):
        sha = "b" * 40
        with _portable_temporary_directory() as root:
            marker = write_runner_tick_heartbeat(
                runner_id="V52",
                runtime_sha=sha,
                service_unit=f"disdex-v52-aster-only@{sha}.service",
                tick_started_at=1000,
                tick_completed_at=1250,
                status="held",
                reason="MARKET_CLOSED_REFERENCE_DEFERRED",
                counters={"ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0},
                root=root,
            )
            self.assertEqual(marker["schema"], "disdex-runner-tick/v1")
            self.assertEqual(marker["expectedSha"], sha)
            self.assertEqual(marker["mainPid"], os.getpid())
            self.assertEqual(marker["workingDirectory"], str(Path.cwd().resolve()))
            self.assertEqual(marker["outcome"], "held")
            self.assertIs(marker["newOrdersAllowed"], False)
            self.assertEqual(marker["runnerId"], "V52")
            self.assertEqual(marker["runtimeSha"], sha)
            self.assertEqual(marker["tickCompletedAt"], 1250)
            self.assertEqual(sorted((root / "ticks").iterdir()), [root / "ticks" / "v52.json"])

    def test_rejects_invalid_identity_and_negative_counter(self):
        with _portable_temporary_directory() as root:
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
                    root=root,
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
                    root=root,
                )

    def test_v52_live_entrypoint_records_completed_cycles(self):
        source = (Path(__file__).resolve().parents[1] / "scripts" / "disdex_v52_aster_only_legacy_engine.py").read_text(encoding="utf-8")
        self.assertIn("write_runner_tick_heartbeat", source)
        self.assertIn("tick_started_at", source)
        self.assertIn("tick_completed_at", source)


    def test_three_cycles_replace_one_canonical_v52_tick_atomically(self):
        sha = "c" * 40
        with _portable_temporary_directory() as root:
            for index, outcome in enumerate(("no-change", "completed", "held"), start=1):
                marker = write_runner_tick_heartbeat(
                    runner_id="V52",
                    runtime_sha=sha,
                    service_unit=f"disdex-v52-aster-only@{sha}.service",
                    tick_started_at=1000 * index,
                    tick_completed_at=1000 * index + 250,
                    status=outcome,
                    reason=f"cycle-{index}",
                    new_orders_allowed=outcome == "completed",
                    root=root,
                )
                self.assertEqual(marker["tickCompletedAt"], 1000 * index + 250)
            files = sorted((root / "ticks").iterdir())
            self.assertEqual(files, [root / "ticks" / "v52.json"])
            payload = __import__("json").loads(files[0].read_text(encoding="utf-8"))
            self.assertEqual(payload["tickCompletedAt"], 3250)
            self.assertEqual(payload["outcome"], "held")
            self.assertIs(payload["newOrdersAllowed"], False)
            self.assertEqual(list((root / "ticks").glob("*.tmp")), [])

    def test_v52_writer_source_supplies_runtime_identity_and_order_permission(self):
        source = (Path(__file__).resolve().parents[1] / "scripts" / "disdex_v52_aster_only_legacy_engine.py").read_text(encoding="utf-8")
        self.assertIn("new_orders_allowed", source)
        self.assertIn("_tick_new_orders_allowed", source)

    def test_python_writer_uses_exclusive_random_temp_and_atomic_replace(self):
        source = (Path(__file__).resolve().parents[1] / "scripts" / "disdex_runner_tick_heartbeat.py").read_text(encoding="utf-8")
        self.assertIn("tempfile.mkstemp", source)
        self.assertIn("os.replace", source)
        self.assertNotIn("process.pid", source)
        self.assertNotIn("Date.now", source)


if __name__ == "__main__":
    unittest.main()
