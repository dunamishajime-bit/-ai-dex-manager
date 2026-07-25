from __future__ import annotations

import argparse
import json
import os
import signal
import threading
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlparse

import websocket

SYMBOLS = ("AMZN", "META", "MSFT", "NVDA", "TSLA")


def now_ms() -> int:
    return int(time.time() * 1000)


def normalize_unix_ms(value: Any) -> int:
    timestamp = int(float(value))
    if timestamp >= 100_000_000_000_000_000:
        return timestamp // 1_000_000
    if timestamp >= 100_000_000_000_000:
        return timestamp // 1_000
    if timestamp < 10_000_000_000:
        return timestamp * 1000
    return timestamp


@dataclass(frozen=True)
class Quote:
    symbol: str
    bid: float
    ask: float
    timestamp_ms: int
    received_ms: int

    @property
    def price(self) -> float:
        return (self.bid + self.ask) / 2.0

    @property
    def age_ms(self) -> int:
        return max(0, now_ms() - self.timestamp_ms)


class QuoteStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._quotes: Dict[str, Quote] = {}
        self._connected = False
        self._last_error: Optional[str] = None
        self._last_message_ms = 0

    def set_connected(self, connected: bool) -> None:
        with self._lock:
            self._connected = connected
            if connected:
                self._last_error = None

    def set_error(self, error: BaseException | str) -> None:
        with self._lock:
            self._last_error = str(error)
            self._connected = False

    def update(self, message: Dict[str, Any]) -> None:
        if str(message.get("ev") or "").upper() != "Q":
            return
        symbol = str(message.get("sym") or "").upper()
        if symbol not in SYMBOLS:
            return
        bid = float(message.get("bp") or 0)
        ask = float(message.get("ap") or 0)
        if bid <= 0 or ask <= 0 or ask < bid:
            return
        quote = Quote(
            symbol=symbol,
            bid=bid,
            ask=ask,
            timestamp_ms=normalize_unix_ms(message.get("t") or 0),
            received_ms=now_ms(),
        )
        with self._lock:
            self._quotes[symbol] = quote
            self._last_message_ms = quote.received_ms
            self._last_error = None

    def get(self, symbol: str) -> Optional[Quote]:
        with self._lock:
            return self._quotes.get(symbol)

    def health(self) -> Dict[str, Any]:
        with self._lock:
            quotes = {
                symbol: {
                    "timestamp": quote.timestamp_ms,
                    "receivedAt": quote.received_ms,
                    "ageMs": max(0, now_ms() - quote.timestamp_ms),
                    "bid": quote.bid,
                    "ask": quote.ask,
                }
                for symbol, quote in self._quotes.items()
            }
            return {
                "status": "ok" if self._connected else "degraded",
                "connected": self._connected,
                "lastError": self._last_error,
                "lastMessageAt": self._last_message_ms,
                "provider": "massive-stocks-nbbo",
                "symbols": quotes,
            }


class MassiveStream(threading.Thread):
    def __init__(self, store: QuoteStore, stop_event: threading.Event) -> None:
        super().__init__(name="massive-stocks-reference", daemon=True)
        self.store = store
        self.stop_event = stop_event
        self.api_key = (os.getenv("MASSIVE_STOCKS_API_KEY") or "").strip()
        self.url = (os.getenv("MASSIVE_STOCKS_WEBSOCKET_URL") or "wss://socket.massive.com/stocks").strip()
        if not self.api_key:
            raise RuntimeError("MASSIVE_STOCKS_API_KEY is required")
        if self.url != "wss://socket.massive.com/stocks":
            raise RuntimeError("LIVE stock reference requires the Massive real-time stocks WebSocket")

    @staticmethod
    def _rows(raw: str) -> list[dict[str, Any]]:
        payload = json.loads(raw)
        rows = payload if isinstance(payload, list) else [payload]
        return [row for row in rows if isinstance(row, dict)]

    @classmethod
    def _wait_status(cls, connection: websocket.WebSocket, expected: str, attempts: int = 5) -> None:
        seen: list[dict[str, Any]] = []
        for _ in range(attempts):
            rows = cls._rows(connection.recv())
            seen.extend(rows)
            if any(row.get("ev") == "status" and row.get("status") == expected for row in rows):
                return
            failure = next((
                row for row in rows
                if row.get("ev") == "status" and str(row.get("status") or "").lower() in {
                    "auth_failed", "error", "failed", "not_authorized",
                }
            ), None)
            if failure:
                raise RuntimeError(f"Massive stream rejected request: {failure}")
        raise RuntimeError(f"Massive stream did not report {expected}: {seen}")

    def run(self) -> None:
        backoff = 1.0
        subscription = ",".join(f"Q.{symbol}" for symbol in SYMBOLS)
        while not self.stop_event.is_set():
            connection = None
            try:
                connection = websocket.create_connection(self.url, timeout=10, enable_multithread=True)
                self._wait_status(connection, "connected")
                connection.send(json.dumps({"action": "auth", "params": self.api_key}))
                self._wait_status(connection, "auth_success")
                connection.send(json.dumps({"action": "subscribe", "params": subscription}))
                self.store.set_connected(True)
                backoff = 1.0
                while not self.stop_event.is_set():
                    connection.settimeout(5)
                    try:
                        raw = connection.recv()
                    except websocket.WebSocketTimeoutException:
                        continue
                    for row in self._rows(raw):
                        if row.get("ev") == "status" and str(row.get("status") or "").lower() in {
                            "auth_failed", "error", "failed", "not_authorized",
                        }:
                            raise RuntimeError(f"Massive stream error: {row}")
                        self.store.update(row)
            except Exception as error:
                self.store.set_error(error)
                if self.stop_event.wait(backoff):
                    break
                backoff = min(30.0, backoff * 2.0)
            finally:
                if connection is not None:
                    try:
                        connection.close()
                    except Exception:
                        pass


class Handler(BaseHTTPRequestHandler):
    server_version = "DisDexMassiveReference/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @property
    def quote_store(self) -> QuoteStore:
        return self.server.quote_store  # type: ignore[attr-defined]

    @property
    def max_age_ms(self) -> int:
        return self.server.max_age_ms  # type: ignore[attr-defined]

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            health = self.quote_store.health()
            status = HTTPStatus.OK if health["connected"] else HTTPStatus.SERVICE_UNAVAILABLE
            self._json(status, health)
            return
        if parsed.path != "/quote":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        symbol = str((parse_qs(parsed.query).get("symbol") or [""])[0]).upper()
        if symbol not in SYMBOLS:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "unsupported_symbol", "symbol": symbol})
            return
        quote = self.quote_store.get(symbol)
        if quote is None:
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "quote_unavailable", "symbol": symbol})
            return
        if quote.age_ms > self.max_age_ms:
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                "error": "stale_quote",
                "symbol": symbol,
                "ageMs": quote.age_ms,
                "maximumAgeMs": self.max_age_ms,
            })
            return
        self._json(HTTPStatus.OK, {
            "symbol": quote.symbol,
            "price": quote.price,
            "timestamp": quote.timestamp_ms,
            "bid": quote.bid,
            "ask": quote.ask,
            "ageMs": quote.age_ms,
            "receivedAt": quote.received_ms,
            "source": "massive-sip-nbbo-mid",
        })


class ReferenceServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], store: QuoteStore, max_age_ms: int):
        super().__init__(address, Handler)
        self.quote_store = store
        self.max_age_ms = max_age_ms


def self_test() -> None:
    assert normalize_unix_ms(1_534_036_818_784) == 1_534_036_818_784
    assert normalize_unix_ms(1_534_036_818_784_000_000) == 1_534_036_818_784
    assert MassiveStream._rows('[{"ev":"status","status":"connected"}]')[0]["status"] == "connected"
    store = QuoteStore()
    store.update({
        "ev": "Q",
        "sym": "NVDA",
        "bp": 120.10,
        "ap": 120.14,
        "t": now_ms(),
    })
    quote = store.get("NVDA")
    assert quote is not None
    assert abs(quote.price - 120.12) < 1e-9
    assert quote.age_ms < 1000
    print("Massive Stock reference proxy self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    host = os.getenv("DISDEX_STOCK_REFERENCE_BIND", "127.0.0.1")
    port = int(os.getenv("DISDEX_STOCK_REFERENCE_PORT", "8797"))
    max_age_ms = int(os.getenv("DISDEX_STOCK_REFERENCE_PROXY_MAX_AGE_MS", "1400"))
    stop_event = threading.Event()
    store = QuoteStore()
    stream = MassiveStream(store, stop_event)
    server = ReferenceServer((host, port), store, max_age_ms)

    def stop(*_: Any) -> None:
        stop_event.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    stream.start()
    print(json.dumps({
        "event": "massive-stock-reference-start",
        "bind": host,
        "port": port,
        "websocket": stream.url,
        "symbols": SYMBOLS,
        "maximumQuoteAgeMs": max_age_ms,
    }), flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        stop_event.set()
        server.server_close()
        stream.join(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
