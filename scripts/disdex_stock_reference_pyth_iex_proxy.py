from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import signal
import threading
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional

import websocket

SYMBOLS = ("AMZN", "META", "MSFT", "NVDA", "TSLA")
UTC = dt.timezone.utc

# V52 reference-quality policy. These are ceilings, not fallbacks: every
# quote still requires both connected sources and passes all validations below.
DEFAULT_PYTH_MAX_AGE_MS = 5000
DEFAULT_IEX_MAX_AGE_MS = 5000
DEFAULT_PYTH_MAX_CONFIDENCE_BPS = 25.0
DEFAULT_REFERENCE_MAX_CROSS_SOURCE_BPS = 50.0


def now_ms() -> int:
    return int(time.time() * 1000)


def float_env(name: str, fallback: float) -> float:
    try:
        return float(os.getenv(name, str(fallback)))
    except (TypeError, ValueError):
        return fallback


def int_env(name: str, fallback: int) -> int:
    try:
        return int(float(os.getenv(name, str(fallback))))
    except (TypeError, ValueError):
        return fallback


def parse_rfc3339_ms(value: str) -> int:
    text = str(value or "").strip()
    if not text:
        raise ValueError("quote timestamp is empty")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    if "." in text:
        head, tail = text.split(".", 1)
        tz_positions = [position for position in (tail.find("+"), tail.find("-")) if position >= 0]
        tz_index = min(tz_positions) if tz_positions else -1
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


def auth_headers(api_key: str) -> Dict[str, str]:
    headers = {"User-Agent": "DisDex-Pyth-IEX-Reference/1.0"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def read_json(url: str, *, headers: Optional[Dict[str, str]] = None, timeout: float = 10.0) -> Any:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode())


@dataclass(frozen=True)
class PythQuote:
    symbol: str
    price: float
    confidence: float
    timestamp_ms: int
    received_ms: int
    feed_id: str

    @property
    def confidence_bps(self) -> float:
        return self.confidence / self.price * 10_000.0 if self.price > 0 else float("inf")

    @property
    def age_ms(self) -> int:
        return max(0, now_ms() - self.timestamp_ms)


@dataclass(frozen=True)
class IexQuote:
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
        self._pyth: Dict[str, PythQuote] = {}
        self._iex: Dict[str, IexQuote] = {}
        self._pyth_connected = False
        self._iex_connected = False
        self._pyth_error: Optional[str] = None
        self._iex_error: Optional[str] = None

    def set_connected(self, source: str, connected: bool) -> None:
        with self._lock:
            if source == "pyth":
                self._pyth_connected = connected
            else:
                self._iex_connected = connected

    def set_error(self, source: str, error: BaseException | str) -> None:
        with self._lock:
            if source == "pyth":
                self._pyth_error = str(error)
                self._pyth_connected = False
            else:
                self._iex_error = str(error)
                self._iex_connected = False

    def update_pyth(self, symbol: str, row: Dict[str, Any], feed_id: str) -> None:
        price_row = row.get("price") or {}
        exponent = int(price_row.get("expo") or 0)
        scale = 10.0 ** exponent
        price = float(price_row.get("price") or 0) * scale
        confidence = float(price_row.get("conf") or 0) * abs(scale)
        timestamp_ms = int(price_row.get("publish_time") or 0) * 1000
        if price <= 0 or confidence < 0 or timestamp_ms <= 0:
            return
        quote = PythQuote(symbol, price, confidence, timestamp_ms, now_ms(), feed_id)
        with self._lock:
            self._pyth[symbol] = quote
            self._pyth_error = None
            self._pyth_connected = True

    def update_iex(self, message: Dict[str, Any]) -> None:
        symbol = str(message.get("S") or "").upper()
        if symbol not in SYMBOLS or message.get("T") != "q":
            return
        bid = float(message.get("bp") or 0)
        ask = float(message.get("ap") or 0)
        if bid <= 0 or ask <= 0 or ask < bid:
            return
        quote = IexQuote(symbol, bid, ask, parse_rfc3339_ms(str(message.get("t") or "")), now_ms())
        with self._lock:
            self._iex[symbol] = quote
            self._iex_error = None
            self._iex_connected = True

    def validated(self, symbol: str, *, pyth_max_age_ms: int, iex_max_age_ms: int,
                  max_confidence_bps: float, max_cross_bps: float) -> tuple[Optional[dict], Optional[dict]]:
        with self._lock:
            pyth = self._pyth.get(symbol)
            iex = self._iex.get(symbol)
        if pyth is None:
            return None, {"error": "pyth_quote_unavailable", "symbol": symbol}
        if iex is None:
            return None, {"error": "iex_quote_unavailable", "symbol": symbol}
        if pyth.age_ms > pyth_max_age_ms:
            return None, {"error": "pyth_quote_stale", "symbol": symbol, "ageMs": pyth.age_ms, "maximumAgeMs": pyth_max_age_ms}
        if iex.age_ms > iex_max_age_ms:
            return None, {"error": "iex_quote_stale", "symbol": symbol, "ageMs": iex.age_ms, "maximumAgeMs": iex_max_age_ms}
        if pyth.confidence_bps > max_confidence_bps:
            return None, {"error": "pyth_confidence_too_wide", "symbol": symbol, "confidenceBps": pyth.confidence_bps, "maximumConfidenceBps": max_confidence_bps}
        cross_bps = abs(pyth.price / iex.price - 1.0) * 10_000.0
        if cross_bps > max_cross_bps:
            return None, {"error": "cross_source_divergence", "symbol": symbol, "crossSourceDifferenceBps": cross_bps, "maximumCrossSourceBps": max_cross_bps}
        return {
            "symbol": symbol,
            "price": pyth.price,
            "timestamp": pyth.timestamp_ms,
            "ageMs": pyth.age_ms,
            "confidence": pyth.confidence,
            "confidenceBps": pyth.confidence_bps,
            "validationPrice": iex.price,
            "validationTimestamp": iex.timestamp_ms,
            "validationAgeMs": iex.age_ms,
            "crossSourceDifferenceBps": cross_bps,
            "receivedAt": max(pyth.received_ms, iex.received_ms),
            "source": "pyth-core-validated-by-alpaca-iex",
            "pythFeedId": pyth.feed_id,
        }, None

    def health(self) -> dict:
        with self._lock:
            return {
                "status": "ok" if self._pyth_connected and self._iex_connected else "degraded",
                "pythConnected": self._pyth_connected,
                "iexConnected": self._iex_connected,
                "pythError": self._pyth_error,
                "iexError": self._iex_error,
                "pythSymbols": {symbol: {"price": q.price, "timestamp": q.timestamp_ms, "ageMs": q.age_ms, "confidenceBps": q.confidence_bps} for symbol, q in self._pyth.items()},
                "iexSymbols": {symbol: {"bid": q.bid, "ask": q.ask, "timestamp": q.timestamp_ms, "ageMs": q.age_ms} for symbol, q in self._iex.items()},
            }


class PythStream(threading.Thread):
    def __init__(self, store: QuoteStore, stop_event: threading.Event) -> None:
        super().__init__(name="pyth-core-reference", daemon=True)
        self.store = store
        self.stop_event = stop_event
        self.base_url = (os.getenv("PYTH_HERMES_URL") or "https://hermes.pyth.network").rstrip("/")
        self.api_key = (os.getenv("PYTH_API_KEY") or "").strip()
        self.feed_ids = self._resolve_feed_ids()

    @staticmethod
    def _metadata_symbol(row: Dict[str, Any]) -> str:
        attributes = row.get("attributes") or {}
        for key in ("symbol", "display_symbol", "generic_symbol"):
            value = str(attributes.get(key) or row.get(key) or "")
            if value:
                return value.upper()
        return ""

    def _resolve_feed_ids(self) -> Dict[str, str]:
        configured = (os.getenv("PYTH_EQUITY_FEED_IDS_JSON") or "").strip()
        if configured:
            rows = json.loads(configured)
            result = {str(symbol).upper(): str(feed_id).removeprefix("0x") for symbol, feed_id in rows.items()}
            missing = [symbol for symbol in SYMBOLS if symbol not in result]
            if missing:
                raise RuntimeError(f"PYTH_EQUITY_FEED_IDS_JSON missing symbols: {missing}")
            return result
        result: Dict[str, str] = {}
        for symbol in SYMBOLS:
            query = urllib.parse.urlencode({"query": f"Equity.US.{symbol}/USD", "asset_type": "equity"})
            rows = read_json(f"{self.base_url}/v2/price_feeds?{query}", headers=auth_headers(self.api_key))
            candidates = rows if isinstance(rows, list) else []
            exact = next((row for row in candidates if self._metadata_symbol(row) == f"EQUITY.US.{symbol}/USD"), None)
            if exact is None and len(candidates) == 1:
                exact = candidates[0]
            if exact is None or not exact.get("id"):
                raise RuntimeError(f"Unable to resolve Pyth Core feed for {symbol}")
            result[symbol] = str(exact["id"]).removeprefix("0x")
        return result

    def _stream_url(self) -> str:
        pairs = [("ids[]", feed_id) for feed_id in self.feed_ids.values()]
        pairs.extend([("parsed", "true"), ("ignore_invalid_price_ids", "false")])
        return f"{self.base_url}/v2/updates/price/stream?{urllib.parse.urlencode(pairs)}"

    def run(self) -> None:
        reverse = {feed_id.lower().removeprefix("0x"): symbol for symbol, feed_id in self.feed_ids.items()}
        backoff = 1.0
        while not self.stop_event.is_set():
            try:
                request = urllib.request.Request(self._stream_url(), headers={**auth_headers(self.api_key), "Accept": "text/event-stream"})
                with urllib.request.urlopen(request, timeout=30) as response:
                    self.store.set_connected("pyth", True)
                    backoff = 1.0
                    for raw in response:
                        if self.stop_event.is_set():
                            break
                        line = raw.decode(errors="replace").strip()
                        if not line.startswith("data:"):
                            continue
                        payload = json.loads(line[5:])
                        for row in payload.get("parsed") or []:
                            feed_id = str(row.get("id") or "").lower().removeprefix("0x")
                            symbol = reverse.get(feed_id)
                            if symbol:
                                self.store.update_pyth(symbol, row, feed_id)
            except Exception as error:
                self.store.set_error("pyth", error)
                if self.stop_event.wait(backoff):
                    break
                backoff = min(30.0, backoff * 2.0)


class AlpacaIexStream(threading.Thread):
    def __init__(self, store: QuoteStore, stop_event: threading.Event) -> None:
        super().__init__(name="alpaca-iex-validator", daemon=True)
        self.store = store
        self.stop_event = stop_event
        self.key = (os.getenv("ALPACA_DATA_API_KEY") or "").strip()
        self.secret = (os.getenv("ALPACA_DATA_API_SECRET") or "").strip()
        if not self.key or not self.secret:
            raise RuntimeError("ALPACA_DATA_API_KEY and ALPACA_DATA_API_SECRET are required")
        if (os.getenv("ALPACA_DATA_FEED") or "iex").strip().lower() != "iex":
            raise RuntimeError("Free reference mode requires ALPACA_DATA_FEED=iex")
        self.url = "wss://stream.data.alpaca.markets/v2/iex"

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
                raise RuntimeError(f"Alpaca IEX stream error while waiting for {message}: {error}")
        raise RuntimeError(f"Alpaca IEX stream did not confirm {message}: {seen}")

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
                self.store.set_connected("iex", True)
                backoff = 1.0
                while not self.stop_event.is_set():
                    connection.settimeout(5)
                    try:
                        raw = connection.recv()
                    except websocket.WebSocketTimeoutException:
                        continue
                    for row in self._rows(raw):
                        self.store.update_iex(row)
            except Exception as error:
                self.store.set_error("iex", error)
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
    server_version = "DisDexPythIexReference/1.0"

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

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            self._json(HTTPStatus.OK, self.server.quote_store.health())  # type: ignore[attr-defined]
            return
        if parsed.path != "/quote":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        symbol = str((urllib.parse.parse_qs(parsed.query).get("symbol") or [""])[0]).upper()
        if symbol not in SYMBOLS:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "unsupported_symbol", "symbol": symbol})
            return
        payload, error = self.server.quote_store.validated(  # type: ignore[attr-defined]
            symbol,
            pyth_max_age_ms=self.server.pyth_max_age_ms,  # type: ignore[attr-defined]
            iex_max_age_ms=self.server.iex_max_age_ms,  # type: ignore[attr-defined]
            max_confidence_bps=self.server.max_confidence_bps,  # type: ignore[attr-defined]
            max_cross_bps=self.server.max_cross_bps,  # type: ignore[attr-defined]
        )
        if error:
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, error)
            return
        self._json(HTTPStatus.OK, payload or {})


class ReferenceServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], store: QuoteStore):
        super().__init__(address, Handler)
        self.quote_store = store
        self.pyth_max_age_ms = int_env("DISDEX_PYTH_MAX_AGE_MS", DEFAULT_PYTH_MAX_AGE_MS)
        self.iex_max_age_ms = int_env("DISDEX_IEX_MAX_AGE_MS", DEFAULT_IEX_MAX_AGE_MS)
        self.max_confidence_bps = float_env("DISDEX_PYTH_MAX_CONFIDENCE_BPS", DEFAULT_PYTH_MAX_CONFIDENCE_BPS)
        self.max_cross_bps = float_env("DISDEX_REFERENCE_MAX_CROSS_SOURCE_BPS", DEFAULT_REFERENCE_MAX_CROSS_SOURCE_BPS)


def self_test() -> None:
    assert DEFAULT_PYTH_MAX_AGE_MS == 5000
    assert DEFAULT_IEX_MAX_AGE_MS == 5000
    assert DEFAULT_PYTH_MAX_CONFIDENCE_BPS == 25.0
    assert DEFAULT_REFERENCE_MAX_CROSS_SOURCE_BPS == 50.0
    assert parse_rfc3339_ms("2026-07-25T01:02:03.123456789Z") == 1784941323123
    store = QuoteStore()
    now_seconds = int(time.time())
    store.update_pyth("NVDA", {"price": {"price": "1201200", "conf": "200", "expo": -4, "publish_time": now_seconds}}, "feed")
    store.update_iex({"T": "q", "S": "NVDA", "bp": 120.10, "ap": 120.14, "t": dt.datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")})
    payload, error = store.validated("NVDA", pyth_max_age_ms=5000, iex_max_age_ms=5000, max_confidence_bps=25, max_cross_bps=50)
    assert error is None and payload is not None
    assert abs(payload["price"] - 120.12) < 1e-9
    assert payload["source"] == "pyth-core-validated-by-alpaca-iex"

    stale_pyth = QuoteStore()
    stale_pyth._pyth["NVDA"] = PythQuote("NVDA", 120.12, 0.2, now_ms() - 5001, now_ms(), "feed")
    stale_pyth._iex["NVDA"] = IexQuote("NVDA", 120.10, 120.14, now_ms(), now_ms())
    bad, error = stale_pyth.validated("NVDA", pyth_max_age_ms=5000, iex_max_age_ms=5000, max_confidence_bps=25, max_cross_bps=50)
    assert bad is None and error and error["error"] == "pyth_quote_stale"

    stale_iex = QuoteStore()
    stale_iex._pyth["NVDA"] = PythQuote("NVDA", 120.12, 0.2, now_ms(), now_ms(), "feed")
    stale_iex._iex["NVDA"] = IexQuote("NVDA", 120.10, 120.14, now_ms() - 5001, now_ms())
    bad, error = stale_iex.validated("NVDA", pyth_max_age_ms=5000, iex_max_age_ms=5000, max_confidence_bps=25, max_cross_bps=50)
    assert bad is None and error and error["error"] == "iex_quote_stale"

    wide_confidence = QuoteStore()
    wide_confidence._pyth["NVDA"] = PythQuote("NVDA", 120.12, 120.12 * 26 / 10_000, now_ms(), now_ms(), "feed")
    wide_confidence._iex["NVDA"] = IexQuote("NVDA", 120.10, 120.14, now_ms(), now_ms())
    bad, error = wide_confidence.validated("NVDA", pyth_max_age_ms=5000, iex_max_age_ms=5000, max_confidence_bps=25, max_cross_bps=50)
    assert bad is None and error and error["error"] == "pyth_confidence_too_wide"

    divergent = QuoteStore()
    divergent._pyth["NVDA"] = PythQuote("NVDA", 120.12, 0.2, now_ms(), now_ms(), "feed")
    divergent._iex["NVDA"] = IexQuote("NVDA", 121.00, 121.04, now_ms(), now_ms())
    bad, error = divergent.validated("NVDA", pyth_max_age_ms=5000, iex_max_age_ms=5000, max_confidence_bps=25, max_cross_bps=50)
    assert bad is None and error and error["error"] == "cross_source_divergence"

    missing = QuoteStore()
    bad, error = missing.validated("NVDA", pyth_max_age_ms=5000, iex_max_age_ms=5000, max_confidence_bps=25, max_cross_bps=50)
    assert bad is None and error and error["error"] == "pyth_quote_unavailable"
    print("Pyth Core + Alpaca IEX reference proxy self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    host = os.getenv("DISDEX_STOCK_REFERENCE_BIND", "127.0.0.1")
    port = int_env("DISDEX_STOCK_REFERENCE_PORT", 8797)
    stop_event = threading.Event()
    store = QuoteStore()
    pyth = PythStream(store, stop_event)
    iex = AlpacaIexStream(store, stop_event)
    server = ReferenceServer((host, port), store)

    def stop(*_: Any) -> None:
        stop_event.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    pyth.start()
    iex.start()
    print(json.dumps({
        "event": "pyth-iex-stock-reference-start",
        "bind": host,
        "port": port,
        "symbols": SYMBOLS,
        "pythHermes": pyth.base_url,
        "pythApiKeyConfigured": bool(pyth.api_key),
        "pythMaximumAgeMs": server.pyth_max_age_ms,
        "iexMaximumAgeMs": server.iex_max_age_ms,
        "maximumConfidenceBps": server.max_confidence_bps,
        "maximumCrossSourceBps": server.max_cross_bps,
    }), flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        stop_event.set()
        server.server_close()
        pyth.join(timeout=5)
        iex.join(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
