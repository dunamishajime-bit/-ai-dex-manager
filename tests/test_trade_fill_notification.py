import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from scripts.disdex_trade_fill_notification import enqueue_trade_fill_notification


class TradeFillNotificationProducerTest(unittest.TestCase):
    def test_only_confirmed_live_fills_are_spooled(self):
        with tempfile.TemporaryDirectory(prefix="disdex-fill-") as directory:
            path = str(Path(directory) / "inbox.jsonl")
            env = {
                "DISDEX_TRADE_FILL_NOTIFICATION_ENABLED": "true",
                "DISDEX_TRADE_FILL_NOTIFICATION_MODE": "live",
                "DISDEX_TRADE_FILL_NOTIFICATION_SPOOL_PATH": path,
            }
            fill = SimpleNamespace(
                symbol="BTCUSDT",
                side="BUY",
                status="FILLED",
                executed_qty=0.25,
                average_price=100.0,
                client_id="v52-open-1",
                order_id="42",
            )
            self.assertTrue(enqueue_trade_fill_notification(fill, strategy_id="V52", event_type="ENTRY_FILL", reason="V11_ENTRY", live=True, env=env))
            payload = json.loads(Path(path).read_text(encoding="utf-8").strip())
            self.assertEqual(payload["strategyId"], "V52")
            self.assertEqual(payload["eventType"], "ENTRY_FILL")
            self.assertEqual(payload["executedQuantity"], 0.25)
            self.assertFalse(enqueue_trade_fill_notification(fill, strategy_id="V52", event_type="ENTRY_FILL", reason="PAPER", live=False, env=env))
            self.assertFalse(enqueue_trade_fill_notification(SimpleNamespace(**{**fill.__dict__, "status": "NEW"}), strategy_id="V52", event_type="ENTRY_FILL", reason="NEW", live=True, env=env))

    def test_disabled_or_missing_fill_does_not_create_spool(self):
        with tempfile.TemporaryDirectory(prefix="disdex-fill-disabled-") as directory:
            path = str(Path(directory) / "inbox.jsonl")
            fill = SimpleNamespace(symbol="BTCUSDT", side="BUY", status="FILLED", executed_qty=1, average_price=1, client_id="id")
            self.assertFalse(enqueue_trade_fill_notification(fill, strategy_id="V52", event_type="ENTRY_FILL", reason="x", live=True, env={"DISDEX_TRADE_FILL_NOTIFICATION_SPOOL_PATH": path}))
            self.assertFalse(Path(path).exists())


if __name__ == "__main__":
    unittest.main()
