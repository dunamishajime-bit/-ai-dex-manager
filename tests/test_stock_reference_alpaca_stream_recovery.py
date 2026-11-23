from __future__ import annotations
import datetime as dt
import unittest
from unittest.mock import patch
from scripts import disdex_stock_reference_alpaca_proxy as proxy

class StreamRecoveryTest(unittest.TestCase):
    def test_open_session_stale_health_is_not_ready(self):
        store = proxy.QuoteStore()
        store.set_connected(True)
        with patch.object(proxy, "regular_us_equity_session", return_value=True):
            payload = store.health(30000)
        self.assertEqual(payload["status"], "degraded")
        self.assertFalse(payload["freshnessReady"])

    def test_closed_session_health_defers_without_accepting_stale(self):
        store = proxy.QuoteStore()
        store.set_connected(True)
        with patch.object(proxy, "regular_us_equity_session", return_value=False):
            payload = store.health(30000)
        self.assertEqual(payload["status"], "deferred")
        self.assertFalse(payload["freshnessReady"])

    def test_fresh_quotes_require_connection_and_all_symbols(self):
        store = proxy.QuoteStore()
        for symbol in proxy.SYMBOLS:
            store.update({"T":"q","S":symbol,"bp":100,"ap":101,
                          "t":dt.datetime.now(tz=proxy.UTC).isoformat()}, "iex")
        with patch.object(proxy, "regular_us_equity_session", return_value=True):
            self.assertFalse(store.health(30000)["freshnessReady"])
            store.set_connected(True)
            self.assertTrue(store.health(30000)["freshnessReady"])
            with patch.object(proxy, "now_ms", return_value=proxy.now_ms()+31000):
                self.assertFalse(store.health(30000)["freshnessReady"])

    def test_subscription_must_acknowledge_every_symbol(self):
        class Connection:
            def __init__(self, rows): self.rows = iter(rows)
            def recv(self): return next(self.rows)
        full = '{"T":"subscription","quotes":["AMZN","META","MSFT","NVDA","TSLA"]}'
        proxy.AlpacaStream._wait_for_subscription(Connection([full]))
        with self.assertRaisesRegex(RuntimeError, "subscription"):
            proxy.AlpacaStream._wait_for_subscription(Connection(['{"T":"subscription","quotes":["TSLA"]}']))

    def test_open_session_stall_reconnects_but_closed_session_does_not(self):
        stream = object.__new__(proxy.AlpacaStream)
        stream.store = proxy.QuoteStore()
        stream.stall_timeout_ms = 30000
        with patch.object(proxy, "now_ms", return_value=31001):
            with patch.object(proxy, "regular_us_equity_session", return_value=False):
                stream._require_quote_progress(1000)
            with patch.object(proxy, "regular_us_equity_session", return_value=True):
                with self.assertRaisesRegex(RuntimeError, "QUOTE_STREAM_STALLED"):
                    stream._require_quote_progress(1000)
                stream._require_quote_progress(2000)

    def test_http_quote_stays_fail_closed_when_market_closed(self):
        import json
        import threading
        import urllib.request
        import urllib.error
        store = proxy.QuoteStore()
        store.set_connected(True)
        store.update({"T":"q","S":"TSLA","bp":100,"ap":101,
                      "t":dt.datetime(2026,1,1,tzinfo=proxy.UTC).isoformat()}, "iex")
        server = proxy.ReferenceServer(("127.0.0.1", 0), store, 30000)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        with patch.object(proxy, "regular_us_equity_session", return_value=False):
            thread.start()
            try:
                root = "http://127.0.0.1:" + str(server.server_address[1])
                with urllib.request.urlopen(root + "/health") as response:
                    payload = json.load(response)
                self.assertEqual(payload["status"], "deferred")
                self.assertFalse(payload["freshnessReady"])
                with self.assertRaises(urllib.error.HTTPError) as raised:
                    urllib.request.urlopen(root + "/quote?symbol=TSLA")
                self.assertEqual(raised.exception.code, 503)
                self.assertEqual(json.loads(raised.exception.read())["error"], "stale_quote")
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

if __name__ == "__main__":
    unittest.main()
