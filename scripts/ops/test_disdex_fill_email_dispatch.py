"""No-network, no-order tests for durable confirmed-fill email notification."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent / "deploy"))
import disdex_fill_email_dispatch as mail


def filled(order="1001", event_type="ENTRY_FILL", status="FILLED"):
    return {
        "schemaVersion": 1, "eventType": event_type, "status": status,
        "orderId": order, "clientOrderId": "v12-test", "symbol": "DOGEUSDT",
        "strategyId": "V12_V4", "side": "BUY", "executedQuantity": 250.0,
        "averagePrice": 0.08, "quoteQuantity": 20.0,
        "executedAt": "2026-11-18T01:23:45Z", "reason": "TEST_REPLAY_NOT_A_REAL_ORDER",
    }


class FillEmailDispatcherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.inbox = root / "inbox.jsonl"
        self.state = root / "email-dispatch-state.json"
        self.inbox.write_bytes(mail.canonical(filled("1001")) + mail.canonical(filled("1002")))
        self.sent = []

    def fake_send(self, event):
        self.sent.append(event["orderId"])
        return mail.fill_key(event)

    def test_bootstrap_does_not_send_historical_fills(self):
        result = mail.bootstrap(self.inbox, self.state)
        self.assertEqual(result["emailsSent"], 0)
        row = json.loads(self.state.read_text())
        self.assertEqual(row["sentCount"], 0)
        self.assertEqual(len(row["sentKeys"]), 2)
        self.assertEqual(row["cursor"], self.inbox.stat().st_size)
        next_cycle = mail.run_once(self.inbox, self.state, self.fake_send)
        self.assertEqual(next_cycle["emailsSent"], 0)
        self.assertEqual(self.sent, [])
        with self.assertRaises(ValueError):
            mail.bootstrap(self.inbox, self.state)

    def test_new_confirmed_fill_sends_once_and_persists_ack(self):
        mail.bootstrap(self.inbox, self.state)
        with self.inbox.open("ab") as out:
            out.write(mail.canonical(filled("1003")))
        first = mail.run_once(self.inbox, self.state, self.fake_send)
        self.assertEqual(first["emailsSent"], 1)
        self.assertEqual(self.sent, ["1003"])
        second = mail.run_once(self.inbox, self.state, self.fake_send)
        self.assertEqual(second["emailsSent"], 0)
        self.assertEqual(self.sent, ["1003"])
        self.assertEqual(json.loads(self.state.read_text())["sentCount"], 1)

    def test_duplicate_appended_event_does_not_resend(self):
        mail.bootstrap(self.inbox, self.state)
        with self.inbox.open("ab") as out:
            out.write(mail.canonical(filled("1001")))
        self.assertEqual(mail.run_once(self.inbox, self.state, self.fake_send)["emailsSent"], 0)
        self.assertEqual(self.sent, [])

    def test_smtp_failure_does_not_advance_cursor(self):
        mail.bootstrap(self.inbox, self.state)
        baseline = json.loads(self.state.read_text())["cursor"]
        with self.inbox.open("ab") as out:
            out.write(mail.canonical(filled("1004")))
        def fail(_event):
            raise RuntimeError("SMTP_FAIL_FOR_TEST")
        with self.assertRaises(RuntimeError):
            mail.run_once(self.inbox, self.state, fail)
        self.assertEqual(json.loads(self.state.read_text())["cursor"], baseline)
        self.assertEqual(mail.run_once(self.inbox, self.state, self.fake_send)["emailsSent"], 1)
        self.assertEqual(self.sent, ["1004"])

    def test_partial_or_corrupt_event_does_not_silently_skip_confirmed_fill(self):
        mail.bootstrap(self.inbox, self.state)
        baseline = json.loads(self.state.read_text())["cursor"]
        with self.inbox.open("ab") as out:
            out.write(b"not-a-json\n")
        with self.assertRaises(ValueError):
            mail.run_once(self.inbox, self.state, self.fake_send)
        self.assertEqual(json.loads(self.state.read_text())["cursor"], baseline)

    def test_unconfirmed_order_is_not_treated_as_a_fill(self):
        for status in ("NEW", "PARTIALLY_FILLED", "CANCELED", None):
            with self.subTest(status=status), self.assertRaises(ValueError):
                mail.parse_fill(mail.canonical(filled(status=status)))

    def test_entry_and_exit_are_distinct_fills(self):
        a, b = filled("2001", "ENTRY_FILL"), filled("2001", "EXIT_FILL")
        self.assertNotEqual(mail.fill_key(a), mail.fill_key(b))
        self.assertEqual(mail.parse_fill(mail.canonical(a))["eventType"], "ENTRY_FILL")
        self.assertEqual(mail.parse_fill(mail.canonical(b))["eventType"], "EXIT_FILL")

    def test_real_email_template_contains_confirmed_fill_but_never_creates_order(self):
        with patch.dict(os.environ, {"GMAIL_USER": "example@example.com"}):
            msg, digest = mail.mail_message(filled("1007"), "recipient@example.com")
        self.assertIn("約定通知", str(msg["Subject"]))
        self.assertIn("DOGEUSDT", msg.get_content())
        self.assertIn("FILLED", msg.get_content())
        self.assertIn(digest[:32], msg["Message-ID"])
        self.assertEqual(len(digest), 64)

    def test_worker_has_no_trading_client_or_order_mutation(self):
        text = Path(mail.__file__).read_text(encoding="utf8")
        for forbidden in ("ASTER_API_PRIVATE_KEY", "cancelOrder", "placeOrder",
                          "KillSwitch.clear", "systemctl start", "systemctl stop",
                          "reduceOnlyOrder"):
            self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
