from __future__ import annotations

import argparse
import datetime as dt
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

try:
    from disdex_us_equity_calendar import regular_us_equity_session
except ModuleNotFoundError:  # package import in tests/tools
    from scripts.disdex_us_equity_calendar import regular_us_equity_session

SYMBOLS = ("AMZN", "META", "MSFT", "NVDA", "TSLA")
UTC = dt.timezone.utc


def now_ms() -> int:
    return int(time.time() * 1000)


def parse_rfc3339_ms(value: str) -> int:
    text = str(value or "").strip()
    if not text:
        raise ValueError("quote timestamp is empty")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    if "." in text:
        head, tail = text.split(".", 1)
        tz_index = max(tail.find("+"), tail.find("-"))
        if tz_index >= 0:
            fraction, suffix = tail[:tz_index], tail[tz_index:]
        else:
            fraction, suffix = tail, ""
        fraction = (fraction + "000000")[:6]
        text = f"{head}.{fraction}{suffix}"
    parsed = dt.datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return int(parsed.timestamp() * 1000)


@dataclass(frozen=True)
class Quote:
    symbol: str
    bid: float
    ask: float
    timestamp_ms: int
    received_ms: int
    feed: str

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

    def set_error(self, error: BaseException | str) -> None:
        with self._lock:
            self._last_error = str(error)
            self._connected = False

    def update(self, message: Dict[str, Any], feed: str) -> None:
        symbol = str(message.get("S") or "").upper()
        if symbol not in SYMBOLS or message.get("T") != "q":
            return
        bid = float(message.get("bp") or 0)
        ask = float(message.get("ap") or 0)
        if bid <= 0 or ask <= 0 or ask < bid:
            return
        quote = Quote(
            symbol=symbol,
            bid=bid,
            ask=ask,
            timestamp_ms=parse_rfc3339_ms(str(message.get("t") or "")),
            received_ms=now_ms(),
            feed=feed,
        )
        with self._lock:
            self._quotes[symbol] = quote
            self._last_message_ms = quote.received_ms
            self._last_error = None

    def get(self, symbol: str) -> Optional[Quote]:
        with self._lock:
            return self._quotes.get(symbol)

    def last_quote_received_ms(self) -> int:
        with self._lock:
            return self._last_message_ms

    def health(self, max_age_ms: int = 30000) -> Dict[str, Any]:
        with self._lock:
            rows = {
                symbol: {
                    "timestamp": quote.timestamp_ms,
                    "receivedAt": quote.received_ms,
                    "ageMs": max(0, now_ms() - quote.timestamp_ms),
                    "bid": quote.bid,
                    "ask": quote.ask,
                }
                for symbol, quote in self._quotes.items()
            }
            market_open = regular_us_equity_session()
            freshness_ready = self._connected and all(
                symbol in rows and rows[symbol]["ageMs"] <= max_age_ms
                for symbol in SYMBOLS
            )
            status = "ok" if freshness_ready else "deferred" if self._connected and not market_open else "degraded"
            return {
                "status": status,
                "freshnessReady": freshness_ready,
                "maximumQuoteAgeMs": max_age_ms,
                "healthReason": "READY" if freshness_ready else "MARKET_CLOSED_REFERENCE_DEFERRED" if status == "deferred" else "REFERENCE_SOURCE_OR_QUOTE_QUALITY_NOT_READY",
                "connected": self._connected,
                "lastError": self._last_error,
                "lastMessageAt": self._last_message_ms,
                "marketOpen": market_open,
                "symbols": rows,
            }


class AlpacaStream(threading.Thread):
    def __init__(self, store: QuoteStore, stop_event: threading.Event) -> None:
        super().__init__(name="alpaca-sip-reference", daemon=True)
        self.store = store
        self.stop_event = stop_event
        self.key = (os.getenv("ALPACA_DATA_API_KEY") or "").strip()
        self.secret = (os.getenv("ALPACA_DATA_API_SECRET") or "").strip()
        self.feed = (os.getenv("ALPACA_DATA_FEED") or "sip").strip().lower()
        self.url = f"wss://stream.data.alpaca.markets/v2/{self.feed}"
        # Reconnect a silently stalled socket; never make cached quotes executable.
        self.stall_timeout_ms = max(30000, int(os.getenv("DISDEX_STOCK_REFERENCE_STREAM_STALL_MS", "30000")))
        if not self.key or not self.secret:
            raise RuntimeError("ALPACA_DATA_API_KEY and ALPACA_DATA_API_SECRET are required")
        if self.feed not in {"sip", "iex"}:
            raise RuntimeError("ALPACA_DATA_FEED must be sip or iex")

    @staticmethod
    def _rows(raw: str) -> list[dict[str, Any]]:
        payload = json.loads(raw)
        rows = payload if isinstance(payload, list) else [payload]
        return [row for row in rows if isinstance(row, dict)]

    @classmethod
    def _wait_for_success(cls, connection: websocket.WebSocket, message: str, attempts: int = 4) -> None:
        seen: list[dict[str, Any]] = []
        for _ in range(attempts):
            rows = cls._rows(connection.recv())
            seen.extend(rows)
            if any(row.get("T") == "success" and row.get("msg") == message for row in rows):
                return
            error = next((row for row in rows if row.get("T") == "error"), None)
            if error:
                raise RuntimeError(f"Alpaca stream error while waiting for {message}: {error}")
        raise RuntimeError(f"Alpaca stream did not confirm {message}: {seen}")

    @classmethod
    def _wait_for_subscription(cls, connection: websocket.WebSocket, attempts: int = 4) -> None:
        for _ in range(attempts):
            rows = cls._rows(connection.recv())
            for row in rows:
                if row.get("T") == "error":
                    raise RuntimeError(f"Alpaca subscription rejected: {row}")
                if row.get("T") == "subscription":
                    if set(SYMBOLS).issubset(set(row.get("quotes") or [])):
                        return
                    raise RuntimeError("Alpaca subscription missing required quote symbols")
        raise RuntimeError("Alpaca subscription acknowledgement missing")

    def _require_quote_progress(self, connected_at_ms: int) -> None:
        last_progress = max(connected_at_ms, self.store.last_quote_received_ms())
        if regular_us_equity_session() and now_ms() - last_progress > self.stall_timeout_ms:
            raise RuntimeError("ALPACA_QUOTE_STREAM_STALLED")

    def run(self) -> None:
        backoff = 1.0
        while not self.stop_event.is_set():
            connection = None
            try:
                connection = websocket.create_connection(self.url, timeout=10, enable_multithread=True)
                self._wait_for_success(connection, "connected")
                connection.send(json.dumps({"action": "auth", "key": self.key, "secret": self.secret}))
                self._wait_for_success(connection, "authenticated")
                connection.send(json.dumps({"action": "subscribe", "quotes": list(SYMBOLS)}))
                self._wait_for_subscription(connection)
                self.store.set_connected(True)
                connected_at_ms = now_ms()
                backoff = 1.0
                while not self.stop_event.is_set():
                    connection.settimeout(5)
                    try:
                        raw = connection.recv()
                    except websocket.WebSocketTimeoutException:
                        self._require_quote_progress(connected_at_ms)
                        continue
                    if not raw:
                        raise RuntimeError("ALPACA_QUOTE_STREAM_CLOSED")
                    for row in self._rows(raw):
                        if row.get("T") == "error":
                            raise RuntimeError(f"Alpaca stream error: {row}")
                        self.store.update(row, self.feed)
                    self._require_quote_progress(connected_at_ms)
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
    server_version = "DisDexAlpacaReference/1.0"

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
            self._json(HTTPStatus.OK, self.quote_store.health(self.max_age_ms))
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
            "source": f"alpaca-{quote.feed}-nbbo-mid",
        })


class ReferenceServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], store: QuoteStore, max_age_ms: int):
        super().__init__(address, Handler)
        self.quote_store = store
        self.max_age_ms = max_age_ms


def self_test() -> None:
    assert parse_rfc3339_ms("2026-07-25T01:02:03.123456789Z") == 1784941323123
    assert AlpacaStream._rows('[{"T":"success","msg":"connected"}]')[0]["msg"] == "connected"
    store = QuoteStore()
    store.update({
        "T": "q",
        "S": "NVDA",
        "bp": 120.10,
        "ap": 120.14,
        "t": dt.datetime.now(tz=UTC).isoformat().replace("+00:00", "Z"),
    }, "sip")
    quote = store.get("NVDA")
    assert quote is not None
    assert abs(quote.price - 120.12) < 1e-9
    assert quote.age_ms < 1000
    print("Alpaca Stock reference proxy self-test: PASS")


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
    stream = AlpacaStream(store, stop_event)
    server = ReferenceServer((host, port), store, max_age_ms)

    def stop(*_: Any) -> None:
        stop_event.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    stream.start()
    print(json.dumps({
        "event": "alpaca-stock-reference-start",
        "bind": host,
        "port": port,
        "feed": stream.feed,
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
