import datetime as dt
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import disdex_v52_aster_only_legacy_engine as legacy  # noqa: E402
import disdex_v52_aster_only_live_engine as live  # noqa: E402


class V52SafetyRegressionTests(unittest.TestCase):
    def test_string_state_path_from_environment_is_read_as_a_path(self):
        with tempfile.TemporaryDirectory(
            prefix="v52-v12-state-",
            dir=Path(__file__).resolve().parents[1],
        ) as directory:
            state_path = Path(directory) / "v12-state.json"
            state_path.write_text(
                json.dumps({
                    "strategyId": "V12_X1.00_ALL",
                    "pending": None,
                    "activePositions": [],
                }),
                encoding="utf-8",
            )
            previous = os.environ.get("V12_X1_ALL_STATE_PATH")
            os.environ["V12_X1_ALL_STATE_PATH"] = str(state_path)
            try:
                engine = object.__new__(live.V52AsterOnlyEngine)
                engine.live = True

                class ReadOnlyVenue:
                    def positions(self):
                        return []

                engine.aster = ReadOnlyVenue()
                self.assertEqual(
                    engine._v12_dynamic_marked_gross({"equityUsd": 100.0}),
                    0.0,
                )
            finally:
                if previous is None:
                    os.environ.pop("V12_X1_ALL_STATE_PATH", None)
                else:
                    os.environ["V12_X1_ALL_STATE_PATH"] = previous

    def test_successful_managed_tick_keeps_recoverable_kill_switch_active(self):
        with tempfile.TemporaryDirectory(
            prefix="v52-soft-hold-",
            dir=Path(__file__).resolve().parents[1],
        ) as directory:
            engine = object.__new__(legacy.V52AsterOnlyEngine)
            engine.kill_switch_path = Path(directory) / "kill-switch.json"
            events = []
            engine.log = lambda event, **fields: events.append((event, fields))
            engine._recovery_grace_ms = lambda: 10 * 60_000
            engine.activate_kill_switch(
                "temporary V52 tick error",
                action="HOLD_PROTECTED",
                recoverable=True,
            )
            before = engine.kill_switch()
            self.assertIsNotNone(before)

            engine.live = False
            engine.state = {}
            engine.reset_days = lambda: None
            engine.enforce_daily_loss = lambda: False
            engine.positions = lambda: {"V11_EQ": {"symbol": "TEST"}}
            engine.update_history = lambda: None
            engine.v96_requires_margin = lambda: False
            engine.manage_positions = lambda _rows: None
            local = dt.datetime(2026, 9, 25, 12, 0, tzinfo=ZoneInfo("America/New_York"))

            with patch.object(legacy, "regular_us_equity_session", return_value=True):
                engine.tick({"local": local, "rows": []})

            after = engine.kill_switch()
            self.assertIsNotNone(after)
            self.assertTrue(after["active"])
            self.assertEqual(after["reason"], before["reason"])
            self.assertNotIn("recoveredAt", after)
            review_fields = [
                fields
                for event, fields in events
                if event == "v52-recoverable-hold-requires-manual-review"
            ]
            self.assertEqual(len(review_fields), 1)
            self.assertIs(review_fields[0]["newOrdersAllowed"], False)

    def test_expired_recovery_hold_requires_review_without_flattening(self):
        with tempfile.TemporaryDirectory(
            prefix="v52-expired-hold-",
            dir=Path(__file__).resolve().parents[1],
        ) as directory:
            engine = object.__new__(legacy.V52AsterOnlyEngine)
            engine.kill_switch_path = Path(directory) / "kill-switch.json"
            events = []
            engine.log = lambda event, **fields: events.append((event, fields))
            engine._recovery_grace_ms = lambda: 10 * 60_000
            engine.activate_kill_switch(
                "expired V52 recovery hold",
                action="HOLD_PROTECTED",
                recoverable=True,
            )
            engine._recoverable_hold_expired = lambda _hold=None: True

            def forbidden_activation(*_args, **_kwargs):
                self.fail("expired recovery must not activate FLATTEN_MANAGED")

            class Lock:
                def acquire(self):
                    return True

                def release(self):
                    return None

            engine.activate_kill_switch = forbidden_activation
            engine.flatten_all = lambda *_args, **_kwargs: self.fail("expired recovery must not flatten")
            engine.live = True
            engine.stop_requested = False
            engine._upstream_fail_closed_hold = False
            engine.lock = Lock()
            engine.prepare_tick_inputs = lambda: {"local": None, "rows": []}
            engine.reset_days = lambda: None
            engine.reconcile = lambda: None
            engine.tick = lambda _prepared: (_ for _ in ()).throw(RuntimeError("repeat tick error"))
            engine.crypto_gross_cap = 3.0
            engine.stock_gross_cap = 1.5
            engine.portfolio_gross_cap = 3.5
            engine.v11_gross_cap = 1.0
            engine.v50_gross_cap = 1.0

            engine.run(daemon=False)

            hold = engine.kill_switch()
            self.assertIsNotNone(hold)
            self.assertTrue(hold["active"])
            self.assertEqual(hold["action"], "HOLD_PROTECTED")
            review_fields = [
                fields
                for event, fields in events
                if event == "v52-recovery-grace-expired-manual-review"
            ]
            self.assertEqual(len(review_fields), 1)
            self.assertIs(review_fields[0]["newOrdersAllowed"], False)


if __name__ == "__main__":
    unittest.main()
