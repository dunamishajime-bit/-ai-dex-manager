import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import disdex_v52_aster_only_legacy_engine as v52  # noqa: E402


class V52ReferenceScopedHoldTests(unittest.TestCase):
    def test_reference_hold_can_be_marked_v52_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            engine = object.__new__(v52.V52AsterOnlyEngine)
            engine.kill_switch_path = Path(temporary) / "kill-switch.json"
            engine._recovery_grace_ms = lambda: 600_000
            engine.log = lambda *_args, **_kwargs: None
            engine.activate_kill_switch(
                'V52 recoverable tick error: HTTP 503 http://127.0.0.1:8797/quote?symbol=TSLA: {"error":"stale_quote"}',
                action="HOLD_PROTECTED",
                recoverable=True,
                scope="V52_REFERENCE_ONLY",
            )
            payload = json.loads(engine.kill_switch_path.read_text())
            self.assertEqual(payload["scope"], "V52_REFERENCE_ONLY")
            self.assertEqual(payload["operator"], "disdex-v52-aster-only")


if __name__ == "__main__":
    unittest.main()
