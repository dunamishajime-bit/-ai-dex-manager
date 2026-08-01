from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import hashlib
import json
import math
import os
import signal
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Deque, Dict, Iterable, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

UTC = dt.timezone.utc
NY = ZoneInfo("America/New_York")
SYMBOLS = ("AMZN", "META", "MSFT", "NVDA", "TSLA")
ASTER_SYMBOL = {symbol: f"{symbol}USDT" for symbol in SYMBOLS}
XYZ_SYMBOL = {symbol: f"xyz:{symbol}" for symbol in SYMBOLS}
STRATEGY_ID = "DISDEX_V13D_V11EQ_STOCK_ROUTER_PLUS_CRYPTO_V96"
V96_KILL_SWITCH_STRATEGY_ID = "DISDEX_V35_STRONG_RESERVED_PENGU_V96"
LIVE_ACK = "I_ACCEPT_REAL_MONEY_V13D_V11EQ_V96"
SCHEMA_VERSION = 2

V13D_MIN_BASIS_BPS = 20.0
V13D_MAX_QUEUE_USD = 250.0
V13D_MIN_HEDGE_TOP_USD = 100.0
V13D_MAX_BOOK_AGE_MS = 1500
V13D_HEDGE_DELAY_MS = 250
V13D_MAX_REFERENCE_MOVE_BPS = 4.0
V13D_MIN_PROJECTED_NET_BPS = 2.0
V13D_MAX_ADVERSE_IMBALANCE = 0.65
V13D_MAKER_TTL_MS = 3000
V13D_MIN_MAKER_FILL_RATIO = 0.90
V13D_MIN_HEDGE_FILL_RATIO = 0.99
V13D_TP_GROSS_BPS = 30.0

V11_MIN_BASIS_BPS = 50.0
V11_MAX_ROUND_TRIP_COST_BPS = 60.0
V11_MAX_COST_BASIS_RATIO = 0.75
V11_MIN_NET_EDGE_BPS = 10.0
V11_CONVERGENCE_BPS = 15.0
V11_MIN_DEPTH_MULTIPLE = 2.0
V11_MAX_SPREAD_BPS = 20.0
V11_MAX_SPREAD_MEDIAN_MULTIPLE = 2.0
# Pyth Core publishes equity reference updates on a slower cadence than the
# crypto book. Keep the source-timestamp fail-closed check, but allow the
# validated reference stream up to five seconds before treating it as stale.
V11_MAX_DATA_AGE_MS = 5000
V11_MAX_SOURCE_CLOCK_DIFF_MS = 1500
V11_MAX_ADVERSE_TWO_SECOND_BPS = 5.0
V11_MAX_ADVERSE_BASIS_MOVE_BPS = 10.0
V11_ENTRY_TTL_MS = 10_000
V11_MIN_FILL_RATIO = 0.90
V11_BASIS_STOP_MULTIPLE = 1.5
EMERGENCY_EXIT_REASONS = {"BASIS_STOP", "MISSED_CHECKPOINT_FAIL_CLOSED", "FINAL_1530", "V96_MARGIN_PRIORITY", "DAILY_LOSS", "KILL_SWITCH", "FATAL_TICK_ERROR", "STATE_INCONSISTENCY"}

class HttpRequestError(RuntimeError):
    """A non-transient HTTP failure with a safe, bounded error message."""

    def __init__(self, message: str, *, status_code: Optional[int] = None, body: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class TransientDataError(RuntimeError):
    """A temporary market/reference/account read failure.

    Temporary read failures skip the affected decision and retry on the next tick;
    they are not equivalent to an unknown order or state reconciliation failure.
    """

    def __init__(self, message: str, *, category: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.category = category
        self.status_code = status_code


class OrderExecutionUnknownError(RuntimeError):
    """The exchange may have accepted an order but its result is unknown."""


_HTTP_COOLDOWN_UNTIL: Dict[str, int] = {}
_HTTP_COOLDOWN_LOCK = threading.RLock()


def _configured_cooldown_ms(category: str) -> int:
    defaults = {
        "TRANSIENT_PUBLIC_DATA": 1_000,
        "TRANSIENT_REFERENCE_DATA": 1_000,
        # Signed failures are classified independently but are not globally
        # throttled: an account-data failure must not block reduce-only safety.
        "SIGNED_API_FAILURE": 0,
    }
    env_names = {
        "TRANSIENT_PUBLIC_DATA": "DISDEX_ASTER_PUBLIC_COOLDOWN_MS",
        "TRANSIENT_REFERENCE_DATA": "DISDEX_REFERENCE_DATA_COOLDOWN_MS",
        "SIGNED_API_FAILURE": "DISDEX_SIGNED_API_COOLDOWN_MS",
    }
    raw = os.getenv(env_names.get(category, "")) if category in env_names else None
    try:
        return max(0, int(float(raw))) if raw is not None else defaults.get(category, 500)
    except (TypeError, ValueError):
        return defaults.get(category, 500)


def _request_cooldown_remaining(category: str) -> int:
    now = int(time.time() * 1000)
    with _HTTP_COOLDOWN_LOCK:
        return max(0, _HTTP_COOLDOWN_UNTIL.get(category, 0) - now)


def _set_request_cooldown(category: str) -> None:
    duration = _configured_cooldown_ms(category)
    if duration <= 0:
        return
    with _HTTP_COOLDOWN_LOCK:
        _HTTP_COOLDOWN_UNTIL[category] = int(time.time() * 1000) + duration

def is_post_only_rejection(error: HttpRequestError) -> bool:
    text = f"{error} {error.body}".lower()
    return error.status_code in {400, 409} and any(marker in text for marker in ("post only", "post-only", "post_only", "gtx", "maker", "would trade", "would immediately match"))


def source_timestamp_ms(value: Any, fallback: int = 0) -> int:
    """Return a source timestamp, never silently using receipt time."""

    parsed = int(finite(value, float(fallback)))
    return parsed if parsed > 0 else int(fallback)


def passive_exit_price(book: "Book", close_side: str) -> float:
    """Return the non-marketable side for a post-only reduce-only exit."""

    return book.ask if close_side == "SELL" else book.bid


def market_data_freshness_reasons(aster: "Book", reference: "ReferenceQuote", now: int) -> Tuple[List[str], int, int]:
    """Validate source timestamps independently from local receipt time."""
    book_ts = source_timestamp_ms(aster.event_ms, aster.received_ms)
    reference_ts = source_timestamp_ms(reference.timestamp_ms, reference.received_ms if reference.timestamp_fallback else 0)
    reasons: List[str] = []
    if reference.timestamp_fallback:
        reasons.append("REFERENCE_TIMESTAMP_FALLBACK")
    if book_ts > now + 5_000 or reference_ts > now + 5_000:
        reasons.append("FUTURE_DATA")
    if now - book_ts > V11_MAX_DATA_AGE_MS or now - reference_ts > V11_MAX_DATA_AGE_MS:
        reasons.append("STALE_DATA")
    if abs(book_ts - reference_ts) > V11_MAX_SOURCE_CLOCK_DIFF_MS:
        reasons.append("SOURCE_CLOCK_MISMATCH")
    return reasons, book_ts, reference_ts


def now_ms() -> int:
    return int(time.time() * 1000)


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def bool_env(name: str, fallback: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return fallback
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def float_env(name: str, fallback: float) -> float:
    return finite(os.getenv(name), fallback)


def int_env(name: str, fallback: int) -> int:
    value = finite(os.getenv(name), float(fallback))
    return int(value) if math.isfinite(value) else fallback


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as writer:
            json.dump(payload, writer, ensure_ascii=False, indent=2, sort_keys=True)
            writer.write("\n")
            writer.flush()
            os.fsync(writer.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def append_jsonl(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as writer:
        writer.write(canonical_json(payload) + "\n")
        writer.flush()


def http_json(
    url: str,
    *,
    method: str = "GET",
    params: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 10.0,
    transient_category: str = "TRANSIENT_DATA",
) -> Any:
    cooldown_remaining = _request_cooldown_remaining(transient_category)
    if cooldown_remaining > 0:
        raise TransientDataError(
            f"{transient_category} cooldown active for {cooldown_remaining}ms",
            category=transient_category,
        )
    encoded = None
    target = url
    if params:
        data = urllib.parse.urlencode({key: str(value) for key, value in params.items() if value is not None})
        if method.upper() == "GET":
            target = f"{url}{'&' if '?' in url else '?'}{data}"
        else:
            encoded = data.encode()
    request = urllib.request.Request(
        target,
        data=encoded,
        method=method.upper(),
        headers={"User-Agent": "DisDex-V13D-V11EQ-Live/1.0", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode()
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        message = f"HTTP {error.code} {target}: {body[:500]}"
        if error.code == 429 or error.code >= 500:
            _set_request_cooldown(transient_category)
            if method.upper() in {"POST", "DELETE"} and transient_category == "SIGNED_API_FAILURE":
                raise OrderExecutionUnknownError(message) from error
            raise TransientDataError(message, category=transient_category, status_code=error.code) from error
        raise HttpRequestError(message, status_code=error.code, body=body[:500]) from error
    except (TimeoutError, urllib.error.URLError) as error:
        _set_request_cooldown(transient_category)
        message = f"Transient request failure {target}: {error}"
        if method.upper() in {"POST", "DELETE"} and transient_category == "SIGNED_API_FAILURE":
            raise OrderExecutionUnknownError(message) from error
        raise TransientDataError(message, category=transient_category) from error





def get_path(payload: Any, path: str) -> Any:
    value = payload
    for part in [item for item in path.split(".") if item]:
        if isinstance(value, list):
            value = value[int(part)]
        elif isinstance(value, dict):
            value = value[part]
        else:
            raise KeyError(path)
    return value


def decimal_places(value: float) -> int:
    text = f"{value:.16f}".rstrip("0")
    return len(text.split(".", 1)[1]) if "." in text else 0


def floor_step(value: float, step: float) -> float:
    if step <= 0:
        return value
    return math.floor((value + 1e-12) / step) * step


def round_tick(value: float, tick: float, side: str) -> float:
    if tick <= 0:
        return value
    scaled = value / tick
    units = math.floor(scaled + 1e-12) if side == "BUY" else math.ceil(scaled - 1e-12)
    return units * tick


def bps_change(current: float, previous: float) -> float:
    return (current / previous - 1.0) * 10_000.0 if current > 0 and previous > 0 else 0.0


def ny_seconds(value: Optional[dt.datetime] = None) -> int:
    local = value or dt.datetime.now(tz=NY)
    return local.hour * 3600 + local.minute * 60 + local.second


def clock(value: str) -> int:
    hour, minute, *rest = [int(item) for item in value.split(":")]
    second = rest[0] if rest else 0
    return hour * 3600 + minute * 60 + second


def is_equity_market_open(value: Optional[dt.datetime] = None) -> bool:
    """Return whether the US regular equity session is open in New York time."""

    local = (value or dt.datetime.now(tz=NY)).astimezone(NY)
    if local.weekday() >= 5:
        return False
    seconds = ny_seconds(local)
    return clock("09:30:00") <= seconds < clock("16:00:00")


@dataclasses.dataclass
class Book:
    venue: str
    symbol: str
    bid: float
    bid_qty: float
    ask: float
    ask_qty: float
    levels_bid: List[Tuple[float, float]]
    levels_ask: List[Tuple[float, float]]
    event_ms: int
    received_ms: int

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2.0

    @property
    def spread_bps(self) -> float:
        return (self.ask - self.bid) / self.mid * 10_000.0 if self.mid > 0 else float("inf")

    def top_usd(self, action: str) -> float:
        return self.ask * self.ask_qty if action == "BUY" else self.bid * self.bid_qty

    def depth_usd(self, action: str) -> float:
        rows = self.levels_ask if action == "BUY" else self.levels_bid
        return sum(price * quantity for price, quantity in rows)

    def simulated_vwap(self, action: str, notional: float) -> Tuple[float, float]:
        rows = self.levels_ask if action == "BUY" else self.levels_bid
        remaining = notional
        quote = quantity = 0.0
        for price, available in rows:
            take_quantity = min(available, remaining / price)
            quote += take_quantity * price
            quantity += take_quantity
            remaining -= take_quantity * price
            if remaining <= 1e-9:
                break
        if remaining > max(0.01, notional * 1e-6) or quantity <= 0:
            return float("inf"), 0.0
        return quote / quantity, quantity


@dataclasses.dataclass
class ReferenceQuote:
    symbol: str
    price: float
    timestamp_ms: int
    received_ms: int
    source: str
    timestamp_fallback: bool = False


@dataclasses.dataclass
class Fill:
    venue: str
    symbol: str
    side: str
    requested_qty: float
    executed_qty: float
    average_price: float
    status: str
    client_id: str
    order_id: Optional[str] = None
    error: Optional[str] = None

    @property
    def fill_ratio(self) -> float:
        return self.executed_qty / self.requested_qty if self.requested_qty > 0 else 0.0


class FileLock:
    def __init__(self, path: Path, stale_ms: int = 15 * 60_000):
        self.path = path
        self.stale_ms = stale_ms
        self.held = False

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = canonical_json({"pid": os.getpid(), "createdAt": now_ms()})
        for _ in range(2):
            try:
                descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.write(descriptor, payload.encode())
                os.close(descriptor)
                self.held = True
                return
            except FileExistsError:
                row = read_json(self.path, {}) or {}
                created = int(row.get("createdAt") or 0)
                if created and now_ms() - created > self.stale_ms:
                    self.path.unlink(missing_ok=True)
                    continue
                raise RuntimeError(f"Stock runner lock is already held: {self.path}")
        raise RuntimeError(f"Unable to acquire stock runner lock: {self.path}")

    def release(self) -> None:
        if self.held:
            self.path.unlink(missing_ok=True)
            self.held = False


class AsterClient:
    def __init__(self, live: bool):
        self.live = live
        self.base_url = os.getenv("ASTER_FUTURES_BASE_URL", "https://fapi3.asterdex.com").rstrip("/")
        self.public_url = os.getenv("ASTER_PUBLIC_FUTURES_BASE_URL", "https://fapi.asterdex.com").rstrip("/")
        self.user_address = (os.getenv("ASTER_USER_ADDRESS") or "").strip()
        self.private_key = (os.getenv("ASTER_API_PRIVATE_KEY") or "").strip()
        if self.private_key and not self.private_key.startswith("0x"):
            self.private_key = "0x" + self.private_key
        self.recv_window = int_env("ASTER_RECV_WINDOW_MS", 5000)
        self.timeout = float_env("ASTER_REQUEST_TIMEOUT_MS", 10_000) / 1000.0
        self._nonce = 0
        self._rules: Dict[str, dict] = {}
        self.book_cache_ttl_ms = max(250, int_env("DISDEX_ASTER_BOOK_CACHE_TTL_MS", 1000))
        self._book_cache: Dict[Tuple[str, int], Book] = {}
        self._book_cache_lock = threading.RLock()
        self.account_cache_ttl_ms = max(500, int_env("DISDEX_ASTER_ACCOUNT_CACHE_TTL_MS", 1000))
        self._balances_cache: Tuple[int, Optional[List[dict]]] = (0, None)
        self._positions_cache: Tuple[int, Optional[List[dict]]] = (0, None)
        self._signer = None
        if live:
            if not self.user_address or not self.private_key:
                raise RuntimeError("Live Stock engine requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY")
            from eth_account import Account
            self._signer = Account.from_key(self.private_key)

    def _next_nonce(self) -> int:
        value = int(time.time() * 1_000_000)
        self._nonce = max(value, self._nonce + 1)
        return self._nonce

    def _signed(self, method: str, path: str, params: Dict[str, Any]) -> Any:
        if self._signer is None:
            raise RuntimeError("Aster signed method called without live credentials")
        signed = {
            **params,
            "recvWindow": params.get("recvWindow", self.recv_window),
            "nonce": self._next_nonce(),
            "user": self.user_address,
            "signer": self._signer.address,
        }
        message = urllib.parse.urlencode({key: str(value).lower() if isinstance(value, bool) else str(value) for key, value in signed.items() if value is not None})
        from eth_account.messages import encode_typed_data
        signable = encode_typed_data(full_message={
            "domain": {
                "name": "AsterSignTransaction",
                "version": "1",
                "chainId": 1666,
                "verifyingContract": "0x0000000000000000000000000000000000000000",
            },
            "types": {
                "EIP712Domain": [
                    {"name": "name", "type": "string"},
                    {"name": "version", "type": "string"},
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"},
                ],
                "Message": [{"name": "msg", "type": "string"}],
            },
            "primaryType": "Message",
            "message": {"msg": message},
        })
        signature = self._signer.sign_message(signable).signature.hex()
        return http_json(
            f"{self.base_url}{path}",
            method=method,
            params={**signed, "signature": signature},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=self.timeout,
            transient_category="SIGNED_API_FAILURE",
        )

    def ping(self) -> Any:
        return http_json(f"{self.base_url}/fapi/v3/ping", timeout=self.timeout, transient_category="TRANSIENT_PUBLIC_DATA")

    def exchange_info(self) -> dict:
        payload = http_json(f"{self.base_url}/fapi/v3/exchangeInfo", timeout=self.timeout, transient_category="TRANSIENT_PUBLIC_DATA")
        for row in payload.get("symbols", []):
            filters = {item.get("filterType"): item for item in row.get("filters", [])}
            lot = filters.get("MARKET_LOT_SIZE") or filters.get("LOT_SIZE") or {}
            price_filter = filters.get("PRICE_FILTER") or {}
            minimum = filters.get("MIN_NOTIONAL") or {}
            self._rules[str(row.get("symbol"))] = {
                "status": row.get("status"),
                "step": finite(lot.get("stepSize")),
                "minQty": finite(lot.get("minQty")),
                "maxQty": finite(lot.get("maxQty"), 1e18),
                "tick": finite(price_filter.get("tickSize")),
                "minNotional": finite(minimum.get("notional")),
            }
        return payload

    def rules(self, symbol: str) -> dict:
        if symbol not in self._rules:
            self.exchange_info()
        row = self._rules.get(symbol)
        if not row or row.get("status") != "TRADING":
            raise RuntimeError(f"Aster symbol is unavailable: {symbol}")
        return row

    def normalize(self, symbol: str, quantity: float, price: float, side: str, *, reduce_only: bool = False, position_quantity: Optional[float] = None) -> Tuple[float, float]:
        row = self.rules(symbol)
        maximum = min(quantity, row["maxQty"])
        if position_quantity is not None:
            maximum = min(maximum, max(0.0, position_quantity))
        normalized_qty = floor_step(maximum, row["step"])
        normalized_price = round_tick(price, row["tick"], side)
        if normalized_qty < row["minQty"] or normalized_qty <= 0:
            raise RuntimeError(f"Aster quantity below minimum for {symbol}")
        if not reduce_only and row["minNotional"] > 0 and normalized_qty * normalized_price < row["minNotional"]:
            raise RuntimeError(f"Aster notional below minimum for {symbol}")
        return normalized_qty, normalized_price

    def book(self, symbol: str, limit: int = 20, *, force_refresh: bool = False) -> Book:
        cache_key = (symbol, limit)
        received = now_ms()
        if not force_refresh:
            with self._book_cache_lock:
                cached = self._book_cache.get(cache_key)
                if cached and received - cached.received_ms <= self.book_cache_ttl_ms:
                    return cached
        # cache miss: fetch a new source snapshot
        payload = http_json(
            f"{self.public_url}/fapi/v1/depth",
            params={"symbol": symbol, "limit": limit},
            transient_category="TRANSIENT_PUBLIC_DATA",
            timeout=self.timeout,
        )
        bids = [(finite(row[0]), finite(row[1])) for row in payload.get("bids", [])]
        asks = [(finite(row[0]), finite(row[1])) for row in payload.get("asks", [])]
        if not bids or not asks or min(bids[0] + asks[0]) <= 0 or asks[0][0] <= bids[0][0]:
            raise RuntimeError(f"Invalid Aster depth for {symbol}")
        event = int(payload.get("E") or payload.get("T") or received)
        result = Book("ASTER", symbol, bids[0][0], bids[0][1], asks[0][0], asks[0][1], bids, asks, event, received)
        with self._book_cache_lock:
            self._book_cache[cache_key] = result
        return result

    def adverse_imbalance(self, symbol: str, maker_side: str) -> Optional[float]:
        end = now_ms()
        try:
            rows = http_json(
                f"{self.public_url}/fapi/v1/aggTrades",
                params={"symbol": symbol, "limit": 200},
                timeout=self.timeout,
                transient_category="TRANSIENT_PUBLIC_DATA",
            )
        except Exception:
            return None
        buys = sells = 0.0
        for row in rows if isinstance(rows, list) else []:
            timestamp = int(row.get("T") or 0)
            if timestamp < end - 2000:
                continue
            notional = finite(row.get("p")) * finite(row.get("q"))
            buyer_is_maker = bool(row.get("m"))
            if buyer_is_maker:
                sells += notional
            else:
                buys += notional
        if buys + sells <= 0:
            return None
        imbalance = (buys - sells) / (buys + sells)
        return -imbalance if maker_side == "BUY" else imbalance

    def balances(self, *, force_refresh: bool = False) -> List[dict]:
        received = now_ms()
        cached_at, cached = self._balances_cache
        if not force_refresh and cached is not None and received - cached_at <= self.account_cache_ttl_ms:
            return list(cached)
        payload = self._signed("GET", "/fapi/v3/balance", {})
        result = list(payload) if isinstance(payload, list) else []
        self._balances_cache = (received, result)
        return list(result)

    def positions(self, *, force_refresh: bool = False) -> List[dict]:
        received = now_ms()
        cached_at, cached = self._positions_cache
        if not force_refresh and cached is not None and received - cached_at <= self.account_cache_ttl_ms:
            return list(cached)
        payload = self._signed("GET", "/fapi/v3/positionRisk", {})
        result = list(payload) if isinstance(payload, list) else []
        self._positions_cache = (received, result)
        return list(result)

    def open_orders(self, symbol: Optional[str] = None) -> List[dict]:
        return self._signed("GET", "/fapi/v3/openOrders", {"symbol": symbol} if symbol else {})

    def get_order(self, symbol: str, client_id: str) -> dict:
        return self._signed("GET", "/fapi/v3/order", {"symbol": symbol, "origClientOrderId": client_id})

    def cancel(self, symbol: str, client_id: str) -> dict:
        if not self.live:
            return {"symbol": symbol, "clientOrderId": client_id, "status": "CANCELED"}
        return self._signed("DELETE", "/fapi/v3/order", {"symbol": symbol, "origClientOrderId": client_id})

    def cancel_all(self, symbol: str) -> Any:
        if not self.live:
            return {"symbol": symbol, "status": "CANCELED"}
        return self._signed("DELETE", "/fapi/v3/allOpenOrders", {"symbol": symbol})

    def place_limit(
        self,
        *,
        symbol: str,
        side: str,
        quantity: float,
        price: float,
        client_id: str,
        reduce_only: bool = False,
        post_only: bool = True,
        position_quantity: Optional[float] = None,
    ) -> Fill:
        quantity, price = self.normalize(symbol, quantity, price, side, reduce_only=reduce_only, position_quantity=position_quantity)
        if not self.live:
            return Fill("ASTER", symbol, side, quantity, quantity, price, "FILLED", client_id, "paper")
        raw = self._signed("POST", "/fapi/v3/order", {
            "symbol": symbol,
            "side": side,
            "type": "LIMIT",
            "timeInForce": "GTX" if post_only else "GTC",
            "quantity": format(quantity, ".12f").rstrip("0").rstrip("."),
            "price": format(price, ".12f").rstrip("0").rstrip("."),
            "positionSide": "BOTH",
            "reduceOnly": "true" if reduce_only else "false",
            "newClientOrderId": client_id[:36],
            "newOrderRespType": "RESULT",
        })
        return self._fill(raw, quantity, side, client_id)

    def place_market(
        self,
        *,
        symbol: str,
        side: str,
        quantity: float,
        expected_price: float,
        client_id: str,
        reduce_only: bool = False,
        position_quantity: Optional[float] = None,
    ) -> Fill:
        quantity, _ = self.normalize(symbol, quantity, expected_price, side, reduce_only=reduce_only, position_quantity=position_quantity)
        if not self.live:
            return Fill("ASTER", symbol, side, quantity, quantity, expected_price, "FILLED", client_id, "paper")
        raw = self._signed("POST", "/fapi/v3/order", {
            "symbol": symbol,
            "side": side,
            "type": "MARKET",
            "quantity": format(quantity, ".12f").rstrip("0").rstrip("."),
            "positionSide": "BOTH",
            "reduceOnly": "true" if reduce_only else "false",
            "newClientOrderId": client_id[:36],
            "newOrderRespType": "RESULT",
        })
        return self._fill(raw, quantity, side, client_id)

    def _fill(self, raw: dict, requested: float, side: str, client_id: str) -> Fill:
        executed = finite(raw.get("executedQty"))
        average = finite(raw.get("avgPrice"))
        status = str(raw.get("status") or "UNKNOWN").upper()
        return Fill(
            "ASTER",
            str(raw.get("symbol") or ""),
            str(raw.get("side") or side),
            requested,
            executed,
            average,
            status,
            str(raw.get("clientOrderId") or client_id),
            str(raw.get("orderId")) if raw.get("orderId") is not None else None,
            str(raw.get("msg")) if raw.get("msg") else None,
        )

    def poll_fill(self, symbol: str, client_id: str, requested: float, side: str, ttl_ms: int) -> Fill:
        if not self.live:
            raise RuntimeError("poll_fill is not needed in paper mode")
        deadline = now_ms() + ttl_ms
        last = Fill("ASTER", symbol, side, requested, 0.0, 0.0, "NEW", client_id)
        while now_ms() < deadline:
            try:
                raw = self.get_order(symbol, client_id)
            except TransientDataError as error:
                raise OrderExecutionUnknownError(f"Order status became unknown for {client_id}: {error}") from error
            last = self._fill(raw, requested, side, client_id)
            if last.status in {"FILLED", "CANCELED", "REJECTED", "EXPIRED"}:
                return last
            time.sleep(0.1)
        try:
            try:
                self.cancel(symbol, client_id)
            except TransientDataError as error:
                raise OrderExecutionUnknownError(f"Order cancel became unknown for {client_id}: {error}") from error
        except OrderExecutionUnknownError:
            raise
        finally:
            try:
                raw = self.get_order(symbol, client_id)
            except TransientDataError as error:
                raise OrderExecutionUnknownError(f"Final order status became unknown for {client_id}: {error}") from error
            return self._fill(raw, requested, side, client_id)

    def equity(self, *, force_refresh: bool = False) -> float:
        if not self.live:
            return float_env("DISDEX_STOCK_PAPER_ASTER_EQUITY_USD", 1000.0)
        balances = self.balances(force_refresh=force_refresh)
        usdt = next((row for row in balances if str(row.get("asset", "")).upper() == "USDT"), None)
        wallet = finite((usdt or {}).get("balance") or (usdt or {}).get("crossWalletBalance"))
        unrealized = sum(finite(row.get("unRealizedProfit") or row.get("unrealizedProfit")) for row in self.positions(force_refresh=force_refresh))
        return wallet + unrealized


class HyperliquidXYZClient:
    def __init__(self, live: bool):
        self.live = live
        self.base_url = os.getenv("HYPERLIQUID_API_URL", "https://api.hyperliquid.xyz").rstrip("/")
        self.account_address = (os.getenv("HYPERLIQUID_ACCOUNT_ADDRESS") or "").strip()
        self.private_key = (os.getenv("HYPERLIQUID_API_PRIVATE_KEY") or "").strip()
        self._info = None
        self._exchange = None
        self._cloid = None
        if live and (not self.account_address or not self.private_key):
            raise RuntimeError("Live Stock engine requires HYPERLIQUID_ACCOUNT_ADDRESS and HYPERLIQUID_API_PRIVATE_KEY")

    def connect(self) -> None:
        from hyperliquid.info import Info
        self._info = Info(self.base_url, skip_ws=True, perp_dexs=["xyz"])
        if self.live:
            from eth_account import Account
            from hyperliquid.exchange import Exchange
            from hyperliquid.utils.types import Cloid
            wallet = Account.from_key(self.private_key)
            self._exchange = Exchange(
                wallet,
                self.base_url,
                account_address=self.account_address,
                perp_dexs=["xyz"],
                timeout=float_env("HYPERLIQUID_REQUEST_TIMEOUT_SECONDS", 10.0),
            )
            self._cloid = Cloid

    @property
    def info(self):
        if self._info is None:
            self.connect()
        return self._info

    def book(self, symbol: str) -> Book:
        received = now_ms()
        payload = self.info.l2_snapshot(symbol)
        levels = payload.get("levels") or [[], []]
        bids = [(finite(row.get("px")), finite(row.get("sz"))) for row in levels[0]]
        asks = [(finite(row.get("px")), finite(row.get("sz"))) for row in levels[1]]
        if not bids or not asks or min(bids[0] + asks[0]) <= 0 or asks[0][0] <= bids[0][0]:
            raise RuntimeError(f"Invalid Hyperliquid xyz book for {symbol}")
        event = int(payload.get("time") or received)
        return Book("XYZ", symbol, bids[0][0], bids[0][1], asks[0][0], asks[0][1], bids, asks, event, received)

    def positions(self) -> List[dict]:
        if not self.account_address:
            return []
        state = self.info.user_state(self.account_address, "xyz")
        return [row.get("position", {}) for row in state.get("assetPositions", [])]

    def open_orders(self) -> List[dict]:
        if not self.account_address:
            return []
        return self.info.open_orders(self.account_address, "xyz")

    def equity(self) -> float:
        if not self.live:
            return float_env("DISDEX_STOCK_PAPER_XYZ_EQUITY_USD", 1000.0)
        state = self.info.user_state(self.account_address, "xyz")
        summary = state.get("marginSummary") or state.get("crossMarginSummary") or {}
        return finite(summary.get("accountValue"))

    def cancel_all(self) -> None:
        if not self.live:
            return
        assert self._exchange is not None
        for row in self.open_orders():
            coin = str(row.get("coin") or "")
            oid = row.get("oid")
            if coin.startswith("xyz:") and oid is not None:
                self._exchange.cancel(coin, int(oid))

    def ioc(
        self,
        *,
        symbol: str,
        side: str,
        quantity: float,
        limit_price: float,
        client_id: str,
        reduce_only: bool,
    ) -> Fill:
        if not self.live:
            return Fill("XYZ", symbol, side, quantity, quantity, limit_price, "FILLED", client_id, "paper")
        assert self._exchange is not None and self._cloid is not None
        raw_cloid = "0x" + hashlib.sha256(client_id.encode()).hexdigest()[:32]
        response = self._exchange.order(
            symbol,
            side == "BUY",
            quantity,
            limit_price,
            {"limit": {"tif": "Ioc"}},
            reduce_only=reduce_only,
            cloid=self._cloid.from_str(raw_cloid),
        )
        statuses = (((response or {}).get("response") or {}).get("data") or {}).get("statuses") or []
        status = statuses[0] if statuses else {}
        if "filled" in status:
            filled = status["filled"]
            return Fill("XYZ", symbol, side, quantity, finite(filled.get("totalSz"), quantity), finite(filled.get("avgPx"), limit_price), "FILLED", client_id, str(filled.get("oid")))
        if "resting" in status:
            resting = status["resting"]
            return Fill("XYZ", symbol, side, quantity, 0.0, 0.0, "NEW", client_id, str(resting.get("oid")))
        error = str(status.get("error") or response)
        return Fill("XYZ", symbol, side, quantity, 0.0, 0.0, "REJECTED", client_id, error=error)


class ReferenceProvider:
    def __init__(self, live: bool):
        self.live = live
        self.mode = (os.getenv("DISDEX_STOCK_REFERENCE_MODE") or ("external" if live else "yahoo")).lower()
        self.template = os.getenv("DISDEX_STOCK_REFERENCE_URL_TEMPLATE", "")
        self.price_path = os.getenv("DISDEX_STOCK_REFERENCE_PRICE_PATH", "price")
        self.timestamp_path = os.getenv("DISDEX_STOCK_REFERENCE_TIMESTAMP_PATH", "timestamp")
        self.timeout = float_env("DISDEX_STOCK_REFERENCE_TIMEOUT_MS", 5000) / 1000.0
        headers_raw = os.getenv("DISDEX_STOCK_REFERENCE_HEADERS_JSON", "{}")
        self.headers = json.loads(headers_raw)
        self.reference_cache_ttl_ms = max(250, int_env("DISDEX_STOCK_REFERENCE_CACHE_TTL_MS", 1000))
        self._quote_cache: Dict[str, ReferenceQuote] = {}
        self._quote_cache_lock = threading.RLock()
        if live and self.mode != "external":
            raise RuntimeError("Live Stock engine requires DISDEX_STOCK_REFERENCE_MODE=external")
        if self.mode == "external" and "{symbol}" not in self.template:
            raise RuntimeError("DISDEX_STOCK_REFERENCE_URL_TEMPLATE must include {symbol}")

    def quote(self, symbol: str, *, force_refresh: bool = False) -> ReferenceQuote:
        received = now_ms()
        if not force_refresh:
            with self._quote_cache_lock:
                cached = self._quote_cache.get(symbol)
                if cached and received - cached.received_ms <= self.reference_cache_ttl_ms:
                    return cached
        timestamp_fallback = False
        if self.mode == "external":
            url = self.template.format(symbol=symbol, unix_ms=received)
            payload = http_json(url, headers=self.headers, timeout=self.timeout, transient_category="TRANSIENT_REFERENCE_DATA")
            price = finite(get_path(payload, self.price_path))
            try:
                timestamp_value = get_path(payload, self.timestamp_path)
            except (KeyError, IndexError, TypeError, ValueError):
                timestamp_value = None
            timestamp_fallback = timestamp_value is None or finite(timestamp_value, 0.0) <= 0
            timestamp = int(finite(timestamp_value, received))
            if timestamp < 10_000_000_000:
                timestamp *= 1000
            source = url.split("?", 1)[0]
        elif self.mode == "yahoo":
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1m&range=1d"
            payload = http_json(url, timeout=self.timeout, transient_category="TRANSIENT_REFERENCE_DATA")
            result = payload["chart"]["result"][0]
            timestamps = result.get("timestamp") or []
            closes = ((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
            valid = [(ts, px) for ts, px in zip(timestamps, closes) if px is not None]
            if not valid:
                raise RuntimeError(f"Yahoo reference missing for {symbol}")
            timestamp, price = valid[-1]
            timestamp = int(timestamp) * 1000
            price = finite(price)
            source = "Yahoo public chart (paper only)"
        else:
            raise RuntimeError(f"Unsupported reference mode: {self.mode}")
        if price <= 0:
            raise RuntimeError(f"Invalid reference price for {symbol}")
        result = ReferenceQuote(symbol, price, timestamp, received, source, timestamp_fallback)
        with self._quote_cache_lock:
            self._quote_cache[symbol] = result
        return result


class StockEngine:
    def __init__(self, mode: str):
        self.mode = mode
        self.live = mode == "live"
        self.state_root = Path(os.getenv("DISDEX_V13D_V11EQ_V96_STATE_DIR", ".runtime-state/disdex-v13d-v11eq-v96")).resolve()
        self.state_path = self.state_root / f"stock-runner-{mode}.json"
        self.audit_path = self.state_root / f"stock-audit-{mode}.jsonl"
        self.kill_switch_path = Path(os.getenv("DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE", str(self.state_root / "kill-switch.json"))).resolve()
        self.lock = FileLock(self.state_root / f"stock-runner-{mode}.lock", int_env("DISDEX_STOCK_LOCK_STALE_MS", 15 * 60_000))
        self.aster = AsterClient(self.live)
        self.xyz = HyperliquidXYZClient(self.live)
        self.reference = ReferenceProvider(self.live)
        self.stock_capital = float_env("DISDEX_STOCK_SLEEVE_CAPITAL_USD", 200.0)
        self.v13_leg_notional = float_env("DISDEX_V13D_LEG_NOTIONAL_USD", self.stock_capital / 2.0)
        self.v11_notional = float_env("DISDEX_V11EQ_NOTIONAL_USD", self.stock_capital)
        self.max_daily_loss_pct = float_env("DISDEX_V13D_V11EQ_V96_MAX_DAILY_LOSS_PCT", 2.0)
        self.aster_maker_fee_bps = float_env("ASTER_STOCK_MAKER_FEE_BPS", 0.0)
        self.aster_taker_fee_bps = float_env("ASTER_STOCK_TAKER_FEE_BPS", 6.0)
        self.v11_safety_buffer_bps = float_env("DISDEX_V11EQ_COST_SAFETY_BUFFER_BPS", 5.0)
        self.xyz_slippage_bps = float_env("DISDEX_V13D_XYZ_MAX_SLIPPAGE_BPS", 20.0)
        self.aster_market_slippage_bps = float_env("DISDEX_STOCK_ASTER_MAX_SLIPPAGE_BPS", 25.0)
        self.state = read_json(self.state_path, {}) or {}
        self.spreads: Dict[str, Deque[Tuple[int, float]]] = {symbol: deque() for symbol in SYMBOLS}
        self.mids: Dict[str, Deque[Tuple[int, float]]] = {symbol: deque() for symbol in SYMBOLS}
        self.last_book_event_ms: Dict[str, int] = {symbol: 0 for symbol in SYMBOLS}
        self.data_unavailable_since_ms: Optional[int] = None
        self.active_interval_ms = max(750, int_env("DISDEX_STOCK_ACTIVE_INTERVAL_MS", 1000))
        self.exit_data_grace_ms = max(5_000, int_env("DISDEX_STOCK_EXIT_DATA_GRACE_MS", 30_000))
        self.stop_requested = False

    def log(self, event: str, **fields: Any) -> None:
        row = {"timestamp": dt.datetime.now(tz=UTC).isoformat(), "event": event, "mode": self.mode, **fields}
        append_jsonl(self.audit_path, row)
        print(canonical_json(row), flush=True)

    def save(self) -> None:
        self.state["schemaVersion"] = SCHEMA_VERSION
        self.state["updatedAt"] = now_ms()
        atomic_write_json(self.state_path, self.state)

    def kill_switch(self) -> Optional[dict]:
        payload = read_json(self.kill_switch_path, None)
        if not payload or payload.get("active") is not True:
            return None
        if payload.get("strategyId") != V96_KILL_SWITCH_STRATEGY_ID or payload.get("action") != "FLATTEN_MANAGED":
            raise RuntimeError("Shared Kill Switch is active but invalid")
        return payload

    def activate_kill_switch(self, reason: str) -> None:
        payload = {
            "active": True,
            "strategyId": V96_KILL_SWITCH_STRATEGY_ID,
            "action": "FLATTEN_MANAGED",
            "reason": reason,
            "operator": "disdex-v13d-v11eq-stock-engine",
            "activatedAt": dt.datetime.now(tz=UTC).isoformat(),
            "combinedStrategyId": STRATEGY_ID,
        }
        atomic_write_json(self.kill_switch_path, payload)
        self.log("kill-switch-activated", reason=reason)

    def reset_days(self) -> None:
        utc_day = dt.datetime.now(tz=UTC).date().isoformat()
        ny_day = dt.datetime.now(tz=NY).date().isoformat()
        if self.state.get("utcDay") != utc_day:
            equity = self.portfolio_equity()
            self.state.update({"utcDay": utc_day, "dayStartEquity": equity, "dailyLossTripped": False})
        if self.state.get("nyDay") != ny_day:
            self.state.update({
                "nyDay": ny_day,
                "v13Attempted": False,
                "v11Attempted": False,
                "v11SignalBasis": {},
                "v11SignalSelectedSymbol": None,
                "v11SignalAt": None,
            })
        self.save()

    def portfolio_equity(self) -> float:
        return self.aster.equity() + self.xyz.equity()

    def enforce_daily_loss(self) -> None:
        current = self.portfolio_equity()
        start = finite(self.state.get("dayStartEquity"), current)
        loss_pct = max(0.0, (start - current) / start * 100.0) if start > 0 else 0.0
        self.state["lastEquity"] = current
        self.state["dailyLossPct"] = loss_pct
        if loss_pct >= self.max_daily_loss_pct:
            self.state["dailyLossTripped"] = True
            self.save()
            self.activate_kill_switch(f"Combined daily loss reached {loss_pct:.4f}%")
        self.save()

    def _handle_transient_data_error(self, error: TransientDataError) -> None:
        """Keep transient market/reference outages separate from fatal safety failures."""
        now = now_ms()
        if self.data_unavailable_since_ms is None:
            self.data_unavailable_since_ms = now
        elapsed = now - self.data_unavailable_since_ms
        self.state["dataUnavailableSinceMs"] = self.data_unavailable_since_ms
        self.state["lastTransientDataCategory"] = error.category
        self.save()
        self.log("stock-transient-data-error", category=error.category, elapsedMs=elapsed, error=str(error))
        if not self.state.get("position") or elapsed < self.exit_data_grace_ms:
            return
        try:
            self.flatten_all("DATA_UNAVAILABLE_FAIL_CLOSED")
        except Exception as flatten_error:
            self.state["manualReviewReason"] = f"Transient data grace expired: {flatten_error}"
            self.save()
            self.stop_requested = True
            return
        self.data_unavailable_since_ms = None
        self.state.pop("dataUnavailableSinceMs", None)
        self.save()

    def managed_aster_positions(self, *, force_refresh: bool = False) -> Dict[str, float]:
        if not self.live:
            position = self.state.get("position") or {}
            if not position:
                return {}
            side = 1 if position.get("asterOpenSide") == "BUY" else -1
            return {ASTER_SYMBOL[position["symbol"]]: side * finite(position.get("asterQty"))}
        result = {}
        for row in self.aster.positions(force_refresh=force_refresh):
            symbol = str(row.get("symbol") or "")
            quantity = finite(row.get("positionAmt"))
            if symbol in ASTER_SYMBOL.values() and abs(quantity) > 1e-12:
                result[symbol] = quantity
        return result

    def managed_xyz_positions(self) -> Dict[str, float]:
        if not self.live:
            position = self.state.get("position") or {}
            if not position or position.get("strategy") != "V13D":
                return {}
            side = 1 if position.get("xyzOpenSide") == "BUY" else -1
            return {XYZ_SYMBOL[position["symbol"]]: side * finite(position.get("xyzQty"))}
        result = {}
        for row in self.xyz.positions():
            symbol = str(row.get("coin") or "")
            quantity = finite(row.get("szi"))
            if symbol in XYZ_SYMBOL.values() and abs(quantity) > 1e-12:
                result[symbol] = quantity
        return result

    def reconcile(self) -> None:
        if not self.live:
            return
        position = self.state.get("position")
        aster_positions = self.managed_aster_positions()
        xyz_positions = self.managed_xyz_positions()
        if not position and (aster_positions or xyz_positions):
            self.activate_kill_switch("Managed Stock positions exist without runner state")
            raise RuntimeError("Managed Stock positions exist without runner state")
        if position:
            expected_a = ASTER_SYMBOL[position["symbol"]]
            expected_x = XYZ_SYMBOL[position["symbol"]] if position.get("strategy") == "V13D" else None
            expected_a_qty = finite(position.get("asterQty")) * (1 if position.get("asterOpenSide") == "BUY" else -1)
            actual_a_qty = finite(aster_positions.get(expected_a))
            mismatch = abs(expected_a_qty - actual_a_qty) > max(1e-8, abs(expected_a_qty) * 0.02)
            if expected_x:
                expected_x_qty = finite(position.get("xyzQty")) * (1 if position.get("xyzOpenSide") == "BUY" else -1)
                actual_x_qty = finite(xyz_positions.get(expected_x))
                mismatch = mismatch or abs(expected_x_qty - actual_x_qty) > max(1e-8, abs(expected_x_qty) * 0.02)
            if mismatch:
                self.activate_kill_switch("Managed Stock position reconciliation mismatch")
                raise RuntimeError("Managed Stock position reconciliation mismatch")
        for symbol in ASTER_SYMBOL.values():
            for order in self.aster.open_orders(symbol):
                client = str(order.get("clientOrderId") or "")
                if client.startswith("stock-v13d-v11eq-"):
                    self.aster.cancel(symbol, client)
        self.xyz.cancel_all()

    def books_and_refs(self, *, force_refresh: bool = False) -> Dict[str, Tuple[Book, Book, ReferenceQuote]]:
        result = {}
        with ThreadPoolExecutor(max_workers=10) as pool:
            jobs = {}
            for symbol in SYMBOLS:
                jobs[(symbol, "aster")] = pool.submit(self.aster.book, ASTER_SYMBOL[symbol], 20, force_refresh=force_refresh)
                jobs[(symbol, "xyz")] = pool.submit(self.xyz.book, XYZ_SYMBOL[symbol])
                jobs[(symbol, "ref")] = pool.submit(self.reference.quote, symbol, force_refresh=force_refresh)
            for symbol in SYMBOLS:
                result[symbol] = (
                    jobs[(symbol, "aster")].result(),
                    jobs[(symbol, "xyz")].result(),
                    jobs[(symbol, "ref")].result(),
                )
        return result

    def update_history(self) -> None:
        for symbol in SYMBOLS:
            try:
                book = self.aster.book(ASTER_SYMBOL[symbol], 20)
            except TransientDataError as error:
                self.log("history-book-transient-error", symbol=symbol, category=error.category, error=str(error))
                continue
            except Exception as error:
                self.log("history-book-error", symbol=symbol, error=str(error))
                continue
            observation_ms = source_timestamp_ms(book.event_ms, book.received_ms)
            if observation_ms <= self.last_book_event_ms[symbol]:
                continue
            self.last_book_event_ms[symbol] = observation_ms
            self.spreads[symbol].append((observation_ms, book.spread_bps))
            self.mids[symbol].append((observation_ms, book.mid))
            received = now_ms()
            while self.spreads[symbol] and self.spreads[symbol][0][0] < received - 30_000:
                self.spreads[symbol].popleft()
            while self.mids[symbol] and self.mids[symbol][0][0] < received - 5000:
                self.mids[symbol].popleft()

    def record_v11_signal(self, rows: Dict[str, Tuple[Book, Book, ReferenceQuote]]) -> None:
        signal_basis = {}
        for symbol, (aster, _xyz, reference) in rows.items():
            signal_basis[symbol] = (aster.mid / reference.price - 1.0) * 10_000.0
        selected = sorted(SYMBOLS, key=lambda symbol: (-abs(signal_basis[symbol]), symbol))[0]
        self.state["v11SignalBasis"] = signal_basis
        self.state["v11SignalSelectedSymbol"] = selected
        self.state["v11SignalAt"] = now_ms()
        self.save()
        self.log("v11-signal-recorded", basis=signal_basis, selectedSymbol=selected)

    def candidate_v13d(self, rows: Dict[str, Tuple[Book, Book, ReferenceQuote]]) -> Optional[dict]:
        candidates = []
        blocked = self.state.get("previousCompletedV13dSymbol")
        for symbol, (aster, xyz, _reference) in rows.items():
            if symbol == blocked:
                continue
            if max(now_ms() - aster.received_ms, now_ms() - xyz.received_ms) > V13D_MAX_BOOK_AGE_MS:
                continue
            basis = (aster.mid / xyz.mid - 1.0) * 10_000.0
            if abs(basis) < V13D_MIN_BASIS_BPS:
                continue
            maker_side = "SELL" if basis > 0 else "BUY"
            hedge_side = "BUY" if maker_side == "SELL" else "SELL"
            maker_price = aster.ask if maker_side == "SELL" else aster.bid
            maker_queue = aster.ask * aster.ask_qty if maker_side == "SELL" else aster.bid * aster.bid_qty
            hedge_price = xyz.ask if hedge_side == "BUY" else xyz.bid
            quantity = self.v13_leg_notional / maker_price
            hedge_required = quantity * hedge_price
            hedge_top = xyz.top_usd(hedge_side)
            gross = (
                (maker_price / hedge_price - 1.0) * 10_000.0
                if maker_side == "SELL"
                else (hedge_price / maker_price - 1.0) * 10_000.0
            )
            projected = gross - float_env("DISDEX_V13D_NORMAL_CYCLE_COST_BPS", 10.0)
            adverse = self.aster.adverse_imbalance(ASTER_SYMBOL[symbol], maker_side)
            reasons = []
            if maker_queue > V13D_MAX_QUEUE_USD:
                reasons.append("QUEUE_TOO_LARGE")
            if hedge_top < max(V13D_MIN_HEDGE_TOP_USD, hedge_required):
                reasons.append("HEDGE_DEPTH")
            if projected < V13D_MIN_PROJECTED_NET_BPS:
                reasons.append("PROJECTED_NET")
            if adverse is not None and adverse > V13D_MAX_ADVERSE_IMBALANCE:
                reasons.append("ADVERSE_FLOW")
            if not reasons:
                candidates.append({
                    "symbol": symbol,
                    "basisBps": basis,
                    "makerSide": maker_side,
                    "hedgeSide": hedge_side,
                    "makerPrice": maker_price,
                    "hedgePrice": hedge_price,
                    "quantity": quantity,
                    "grossBps": gross,
                    "projectedNetBps": projected,
                    "makerQueueUsd": maker_queue,
                    "hedgeTopUsd": hedge_top,
                    "adverseImbalance": adverse,
                })
        if not candidates:
            return None
        return sorted(candidates, key=lambda row: (-abs(row["basisBps"]), row["symbol"]))[0]

    def client_id(self, strategy: str, symbol: str, action: str) -> str:
        digest = hashlib.sha256(f"{strategy}|{symbol}|{action}|{self.state.get('nyDay')}".encode()).hexdigest()[:12]
        return f"stock-v13d-v11eq-{digest}"[:36]

    def open_v13d(self, candidate: dict) -> bool:
        symbol = candidate["symbol"]
        aster_symbol = ASTER_SYMBOL[symbol]
        xyz_symbol = XYZ_SYMBOL[symbol]
        client_id = self.client_id("V13D", symbol, "OPEN-ASTER")
        quantity, maker_price = self.aster.normalize(aster_symbol, candidate["quantity"], candidate["makerPrice"], candidate["makerSide"])
        initial = self.aster.place_limit(
            symbol=aster_symbol,
            side=candidate["makerSide"],
            quantity=quantity,
            price=maker_price,
            client_id=client_id,
            post_only=True,
        )
        maker_fill = initial if not self.live else self.aster.poll_fill(aster_symbol, client_id, quantity, candidate["makerSide"], V13D_MAKER_TTL_MS)
        self.log("v13d-maker-result", candidate=candidate, fill=dataclasses.asdict(maker_fill))
        if maker_fill.fill_ratio < V13D_MIN_MAKER_FILL_RATIO:
            if maker_fill.executed_qty > 0:
                self.flatten_aster_leg(symbol, candidate["makerSide"], maker_fill.executed_qty, "V13D_LOW_MAKER_FILL")
            return False
        time.sleep(V13D_HEDGE_DELAY_MS / 1000.0)
        xyz_book = self.xyz.book(xyz_symbol)
        reference_move = abs(bps_change(xyz_book.mid, candidate["hedgePrice"]))
        if reference_move > V13D_MAX_REFERENCE_MOVE_BPS:
            self.flatten_aster_leg(symbol, candidate["makerSide"], maker_fill.executed_qty, "V13D_REFERENCE_MOVE")
            return False
        hedge_limit = xyz_book.ask * (1 + self.xyz_slippage_bps / 10_000.0) if candidate["hedgeSide"] == "BUY" else xyz_book.bid * (1 - self.xyz_slippage_bps / 10_000.0)
        hedge_fill = self.xyz.ioc(
            symbol=xyz_symbol,
            side=candidate["hedgeSide"],
            quantity=maker_fill.executed_qty,
            limit_price=hedge_limit,
            client_id=self.client_id("V13D", symbol, "OPEN-XYZ"),
            reduce_only=False,
        )
        self.log("v13d-hedge-result", fill=dataclasses.asdict(hedge_fill), referenceMoveBps=reference_move)
        if hedge_fill.fill_ratio < V13D_MIN_HEDGE_FILL_RATIO:
            if hedge_fill.executed_qty > 0:
                self.flatten_xyz_leg(symbol, candidate["hedgeSide"], hedge_fill.executed_qty, "V13D_INCOMPLETE_HEDGE")
            self.flatten_aster_leg(symbol, candidate["makerSide"], maker_fill.executed_qty, "V13D_INCOMPLETE_HEDGE")
            self.activate_kill_switch("V13D hedge did not fully complete")
            return False
        self.state["position"] = {
            "strategy": "V13D",
            "symbol": symbol,
            "openedAt": now_ms(),
            "entryBasisBps": candidate["basisBps"],
            "asterOpenSide": candidate["makerSide"],
            "asterQty": maker_fill.executed_qty,
            "asterEntryPrice": maker_fill.average_price or maker_price,
            "xyzOpenSide": candidate["hedgeSide"],
            "xyzQty": hedge_fill.executed_qty,
            "xyzEntryPrice": hedge_fill.average_price or candidate["hedgePrice"],
            "lateTpChecked": False,
        }
        self.save()
        self.log("v13d-position-open", position=self.state["position"])
        return True

    def estimate_v11_cost(self, book: Book, exit_action: str, notional: float) -> Tuple[float, dict]:
        vwap, _quantity = book.simulated_vwap(exit_action, notional)
        top = book.ask if exit_action == "BUY" else book.bid
        slippage = abs(vwap / top - 1.0) * 10_000.0 if vwap > 0 and top > 0 else float("inf")
        round_trip = self.aster_maker_fee_bps + self.aster_taker_fee_bps + book.spread_bps + slippage + self.v11_safety_buffer_bps
        return round_trip, {"spreadBps": book.spread_bps, "exitSlippageBps": slippage, "safetyBufferBps": self.v11_safety_buffer_bps}

    def v11_candidates(self, rows: Dict[str, Tuple[Book, Book, ReferenceQuote]]) -> Tuple[Optional[dict], Dict[str, List[str]]]:
        signal_basis: Dict[str, float] = self.state.get("v11SignalBasis") or {}
        current = {}
        rejections: Dict[str, List[str]] = {}
        for symbol, (aster, _xyz, reference) in rows.items():
            basis = (aster.mid / reference.price - 1.0) * 10_000.0
            current[symbol] = basis
        top1 = sorted(SYMBOLS, key=lambda symbol: (-abs(current[symbol]), symbol))[0]
        selected = str(self.state.get("v11SignalSelectedSymbol") or "")
        if selected not in SYMBOLS:
            return None, {"ROUTER": ["SIGNAL_CANDIDATE_MISSING"]}
        aster, _xyz, reference = rows[selected]
        basis = current[selected]
        side = "SELL" if basis > 0 else "BUY"
        exit_action = "BUY" if side == "SELL" else "SELL"
        cost, cost_detail = self.estimate_v11_cost(aster, exit_action, self.v11_notional)
        ratio = cost / abs(basis) if abs(basis) > 0 else float("inf")
        net_edge = abs(basis) - V11_CONVERGENCE_BPS - cost
        depth = aster.depth_usd(exit_action)
        depth_multiple = depth / self.v11_notional if self.v11_notional > 0 else 0.0
        now = now_ms()
        spread_values = [value for timestamp, value in self.spreads[selected] if timestamp >= now - 30_000]
        median = sorted(spread_values)[len(spread_values) // 2] if spread_values else 0.0
        two_second_mid = next((value for timestamp, value in reversed(self.mids[selected]) if timestamp <= now - 2000), None)
        adverse_two_second = 0.0 if two_second_mid is None else max(0.0, bps_change(aster.mid, two_second_mid) * (1 if side == "BUY" else -1))
        signal_value = finite(signal_basis.get(selected), basis)
        adverse_basis = max(0.0, abs(basis) - abs(signal_value))
        reasons = []
        freshness_reasons, _book_ts, _reference_ts = market_data_freshness_reasons(aster, reference, now)
        reasons.extend(freshness_reasons)
        if two_second_mid is None:
            reasons.append("ADVERSE_HISTORY_INSUFFICIENT")
        if abs(basis) < V11_MIN_BASIS_BPS:
            reasons.append("BASIS_BELOW_50")
        if selected != top1:
            reasons.append("NO_LONGER_TOP1")
        if cost > V11_MAX_ROUND_TRIP_COST_BPS:
            reasons.append("ROUND_TRIP_COST_OVER_60")
        if ratio > V11_MAX_COST_BASIS_RATIO:
            reasons.append("COST_BASIS_RATIO_OVER_75PCT")
        if net_edge < V11_MIN_NET_EDGE_BPS:
            reasons.append("NET_EDGE_BELOW_10")
        if depth_multiple < V11_MIN_DEPTH_MULTIPLE:
            reasons.append("DEPTH_BELOW_2X")
        if aster.spread_bps > V11_MAX_SPREAD_BPS:
            reasons.append("SPREAD_OVER_20")
        if len(spread_values) < 5:
            reasons.append("SPREAD_HISTORY_INSUFFICIENT")
        elif median > 0 and aster.spread_bps / median > V11_MAX_SPREAD_MEDIAN_MULTIPLE:
            reasons.append("SPREAD_EXPANSION_OVER_2X")
        if adverse_two_second > V11_MAX_ADVERSE_TWO_SECOND_BPS:
            reasons.append("ADVERSE_TWO_SECOND_MOVE")
        if adverse_basis > V11_MAX_ADVERSE_BASIS_MOVE_BPS:
            reasons.append("ADVERSE_BASIS_MOVE")
        rejections[selected] = reasons
        if reasons:
            return None, rejections
        return {
            "symbol": selected,
            "basisBps": basis,
            "signalBasisBps": signal_value,
            "side": side,
            "entryPrice": aster.bid if side == "BUY" else aster.ask,
            "estimatedRoundTripCostBps": cost,
            "costToBasisRatio": ratio,
            "estimatedNetEdgeBps": net_edge,
            "depthMultiple": depth_multiple,
            "spreadToMedianMultiple": aster.spread_bps / median if median > 0 else float("inf"),
            "adverseTwoSecondMoveBps": adverse_two_second,
            "adverseBasisMoveBps": adverse_basis,
            "costDetail": cost_detail,
        }, rejections

    def recheck_entry_candidate(self, candidate: dict, notional: float, *, minimum_basis_bps: float, maximum_cost_bps: float, minimum_net_edge_bps: float, maximum_cost_ratio: Optional[float] = None) -> Tuple[Optional[dict], List[str]]:
        symbol = str(candidate["symbol"])
        aster_symbol = ASTER_SYMBOL[symbol]
        latest_book = self.aster.book(aster_symbol, 20, force_refresh=True)
        latest_reference = self.reference.quote(symbol, force_refresh=True)
        basis = (latest_book.mid / latest_reference.price - 1.0) * 10_000.0
        side = str(candidate["side"])
        exit_action = "BUY" if side == "SELL" else "SELL"
        cost, cost_detail = self.estimate_v11_cost(latest_book, exit_action, notional)
        net_edge = abs(basis) - V11_CONVERGENCE_BPS - cost
        ratio = cost / abs(basis) if abs(basis) > 0 else float("inf")
        reasons, _book_ts, _reference_ts = market_data_freshness_reasons(latest_book, latest_reference, now_ms())
        signal_basis = finite(candidate.get("signalBasisBps"), basis)
        if abs(basis) < minimum_basis_bps:
            reasons.append("BASIS_BELOW_ENTRY_THRESHOLD")
        if signal_basis * basis <= 0:
            reasons.append("SIGN_CHANGED")
        if cost > maximum_cost_bps:
            reasons.append("ROUND_TRIP_COST_OVER_LIMIT")
        if maximum_cost_ratio is not None and ratio > maximum_cost_ratio:
            reasons.append("COST_BASIS_RATIO_OVER_LIMIT")
        if net_edge < minimum_net_edge_bps:
            reasons.append("NET_EDGE_BELOW_LIMIT")
        if latest_book.depth_usd(exit_action) < 2.0 * notional:
            reasons.append("DEPTH_BELOW_2X")
        if latest_book.spread_bps > V11_MAX_SPREAD_BPS:
            reasons.append("SPREAD_OVER_LIMIT")
        if reasons:
            return None, reasons
        updated = dict(candidate)
        updated.update({
            "basisBps": basis,
            "entryPrice": latest_book.bid if side == "BUY" else latest_book.ask,
            "estimatedRoundTripCostBps": cost,
            "estimatedNetEdgeBps": net_edge,
            "costToBasisRatio": ratio,
            "costDetail": cost_detail,
        })
        return updated, []
    def open_v11(self, candidate: dict) -> bool:
        symbol = candidate["symbol"]
        aster_symbol = ASTER_SYMBOL[symbol]
        candidate, reasons = self.recheck_entry_candidate(
            candidate, self.v11_notional, minimum_basis_bps=V11_MIN_BASIS_BPS,
            maximum_cost_bps=V11_MAX_ROUND_TRIP_COST_BPS,
            minimum_net_edge_bps=V11_MIN_NET_EDGE_BPS,
            maximum_cost_ratio=V11_MAX_COST_BASIS_RATIO,
        )
        if candidate is None:
            self.log("v11eq-entry-recheck-rejected", symbol=symbol, reasons=reasons)
            return False
        quantity = self.v11_notional / candidate["entryPrice"]
        client_id = self.client_id("V11EQ", symbol, "OPEN")
        normalized_quantity, normalized_price = self.aster.normalize(aster_symbol, quantity, candidate["entryPrice"], candidate["side"])
        try:
            initial = self.aster.place_limit(
            symbol=aster_symbol,
            side=candidate["side"],
            quantity=normalized_quantity,
            price=normalized_price,
            client_id=client_id,
            post_only=True,
            )
        except HttpRequestError as error:
            if not is_post_only_rejection(error):
                raise
            self.log("v11eq-entry-post-only-rejected", symbol=symbol, error=str(error))
            return False
        fill = initial if not self.live else self.aster.poll_fill(aster_symbol, client_id, normalized_quantity, candidate["side"], V11_ENTRY_TTL_MS)
        self.log("v11eq-entry-result", candidate=candidate, fill=dataclasses.asdict(fill))
        if fill.fill_ratio < V11_MIN_FILL_RATIO:
            if fill.executed_qty > 0:
                self.flatten_aster_leg(symbol, candidate["side"], fill.executed_qty, "V11EQ_LOW_FILL")
            return False
        self.state["position"] = {
            "strategy": "V11_EQ",
            "symbol": symbol,
            "openedAt": now_ms(),
            "entryBasisBps": candidate["basisBps"],
            "asterOpenSide": candidate["side"],
            "asterQty": fill.executed_qty,
            "asterEntryPrice": fill.average_price or normalized_price,
        }
        self.save()
        self.log("v11eq-position-open", position=self.state["position"])
        return True

    def flatten_aster_leg(self, symbol: str, open_side: str, quantity: float, reason: str) -> Fill:
        aster_symbol = ASTER_SYMBOL[symbol]
        close_side = "SELL" if open_side == "BUY" else "BUY"
        book = self.aster.book(aster_symbol, 20, force_refresh=True)
        expected = book.bid if close_side == "SELL" else book.ask
        fill = self.aster.place_market(
            symbol=aster_symbol,
            side=close_side,
            quantity=quantity,
            expected_price=expected,
            client_id=self.client_id("FLAT", symbol, reason + "-A"),
            reduce_only=True,
            position_quantity=quantity,
        )
        self.log("aster-leg-flat", symbol=symbol, reason=reason, fill=dataclasses.asdict(fill))
        return fill

    def flatten_xyz_leg(self, symbol: str, open_side: str, quantity: float, reason: str) -> Fill:
        book = self.xyz.book(XYZ_SYMBOL[symbol])
        close_side = "SELL" if open_side == "BUY" else "BUY"
        limit_price = book.bid * (1 - self.xyz_slippage_bps / 10_000.0) if close_side == "SELL" else book.ask * (1 + self.xyz_slippage_bps / 10_000.0)
        fill = self.xyz.ioc(
            symbol=XYZ_SYMBOL[symbol],
            side=close_side,
            quantity=quantity,
            limit_price=limit_price,
            client_id=self.client_id("FLAT", symbol, reason + "-X"),
            reduce_only=True,
        )
        self.log("xyz-leg-flat", symbol=symbol, reason=reason, fill=dataclasses.asdict(fill))
        return fill

    def close_v13d(self, reason: str) -> None:
        position = self.state.get("position") or {}
        symbol = position["symbol"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            aster_future = pool.submit(self.flatten_aster_leg, symbol, position["asterOpenSide"], finite(position["asterQty"]), reason)
            xyz_future = pool.submit(self.flatten_xyz_leg, symbol, position["xyzOpenSide"], finite(position["xyzQty"]), reason)
            aster_fill = aster_future.result()
            xyz_fill = xyz_future.result()
        if aster_fill.fill_ratio < 0.99 or xyz_fill.fill_ratio < 0.99:
            self.activate_kill_switch("V13D close did not fully complete")
            raise RuntimeError("V13D close did not fully complete")
        self.state["previousCompletedV13dSymbol"] = symbol
        self.state["position"] = None
        self.save()
        self.log("v13d-position-closed", symbol=symbol, reason=reason)

    def close_v11(self, reason: str) -> None:
        position = self.state.get("position") or {}
        symbol = position["symbol"]
        open_side = position["asterOpenSide"]
        close_side = "SELL" if open_side == "BUY" else "BUY"
        quantity = finite(position["asterQty"])
        client_id = self.client_id("V11EQ", symbol, "CLOSE-LIMIT")
        maker_fill = Fill("ASTER", ASTER_SYMBOL[symbol], close_side, quantity, 0.0, 0.0, "NOT_SENT", client_id)
        if reason in EMERGENCY_EXIT_REASONS:
            market_fill = self.flatten_aster_leg(symbol, open_side, quantity, reason)
        else:
            book = self.aster.book(ASTER_SYMBOL[symbol], 20, force_refresh=True)
            price = passive_exit_price(book, close_side)
            try:
                maker_fill = self.aster.place_limit(symbol=ASTER_SYMBOL[symbol], side=close_side, quantity=quantity, price=price, client_id=client_id, reduce_only=True, post_only=True, position_quantity=quantity)
            except HttpRequestError as error:
                if not is_post_only_rejection(error):
                    raise
                maker_fill = Fill("ASTER", ASTER_SYMBOL[symbol], close_side, quantity, 0.0, price, "POST_ONLY_REJECTED", client_id, error=str(error))
            if self.live and maker_fill.status not in {"POST_ONLY_REJECTED", "REJECTED", "EXPIRED", "CANCELED"}:
                maker_fill = self.aster.poll_fill(ASTER_SYMBOL[symbol], client_id, quantity, close_side, 2000)
            remaining = max(0.0, quantity - maker_fill.executed_qty)
            market_fill = self.flatten_aster_leg(symbol, open_side, remaining, reason + "-TAKER") if remaining > 0 else Fill("ASTER", ASTER_SYMBOL[symbol], close_side, 0.0, 0.0, 0.0, "NOT_SENT", client_id + "-TAKER")
        executed = maker_fill.executed_qty + market_fill.executed_qty
        if executed < quantity * 0.999:
            self.state["manualReviewReason"] = f"V11-EQ close incomplete: {executed:.12f}/{quantity:.12f}"
            self.save()
            raise RuntimeError("V11-EQ close did not fully complete")
        if self.live and self.managed_aster_positions(force_refresh=True).get(ASTER_SYMBOL[symbol], 0.0):
            self.state["manualReviewReason"] = "V11-EQ close reconciliation mismatch"
            self.save()
            raise RuntimeError("V11-EQ close left an Aster position")
        self.state["position"] = None
        self.save()
        self.log("v11eq-position-closed", symbol=symbol, reason=reason, makerFill=dataclasses.asdict(maker_fill), takerFill=dataclasses.asdict(market_fill))

    def flatten_all(self, reason: str) -> None:
        try:
            for symbol in ASTER_SYMBOL.values():
                self.aster.cancel_all(symbol)
            self.xyz.cancel_all()
        except Exception as error:
            self.log("cancel-all-error", error=str(error))
        position = self.state.get("position")
        if position:
            try:
                if position.get("strategy") == "V13D":
                    self.close_v13d(reason)
                else:
                    self.close_v11(reason)
            except Exception as error:
                self.log("managed-flat-error", error=str(error), reason=reason)
                raise
        elif self.live:
            for symbol, qty in self.managed_aster_positions().items():
                base_symbol = symbol.removesuffix("USDT")
                side = "BUY" if qty < 0 else "SELL"
                book = self.aster.book(symbol, 20, force_refresh=True)
                self.aster.place_market(
                    symbol=symbol,
                    side=side,
                    quantity=abs(qty),
                    expected_price=book.ask if side == "BUY" else book.bid,
                    client_id=self.client_id("RECOVERY", base_symbol, "ASTER"),
                    reduce_only=True,
                    position_quantity=abs(qty),
                )
            for symbol, qty in self.managed_xyz_positions().items():
                base_symbol = symbol.split(":", 1)[1]
                open_side = "BUY" if qty > 0 else "SELL"
                self.flatten_xyz_leg(base_symbol, open_side, abs(qty), "RECOVERY")

    def manage_position(self, rows: Dict[str, Tuple[Book, Book, ReferenceQuote]]) -> None:
        position = self.state.get("position")
        if not position:
            return
        sec = ny_seconds()
        symbol = position["symbol"]
        if position["strategy"] == "V13D":
            if sec >= clock("15:10:00"):
                self.close_v13d("HARD_FLAT_1510")
                return
            if sec >= clock("15:00:00"):
                self.close_v13d("FINAL_1500")
                return
            if sec >= clock("14:30:00") and not position.get("lateTpChecked"):
                aster, xyz, _reference = rows[symbol]
                aster_close = aster.bid if position["asterOpenSide"] == "BUY" else aster.ask
                xyz_close = xyz.bid if position["xyzOpenSide"] == "BUY" else xyz.ask
                quantity = min(finite(position["asterQty"]), finite(position["xyzQty"]))
                if position["asterOpenSide"] == "BUY":
                    pnl = quantity * ((aster_close - finite(position["asterEntryPrice"])) + (finite(position["xyzEntryPrice"]) - xyz_close))
                else:
                    pnl = quantity * ((finite(position["asterEntryPrice"]) - aster_close) + (xyz_close - finite(position["xyzEntryPrice"])))
                gross = pnl / self.v13_leg_notional * 10_000.0 if self.v13_leg_notional > 0 else 0.0
                position["lateTpChecked"] = True
                self.save()
                self.log("v13d-late-tp-check", symbol=symbol, grossBps=gross)
                if gross >= V13D_TP_GROSS_BPS:
                    self.close_v13d("LATE_TP30")
        else:
            aster, _xyz, reference = rows[symbol]
            basis = (aster.mid / reference.price - 1.0) * 10_000.0
            entry_basis = finite(position["entryBasisBps"])
            if abs(basis) <= V11_CONVERGENCE_BPS or basis * entry_basis <= 0:
                self.close_v11("BASIS_CONVERGED")
            elif abs(basis) >= V11_BASIS_STOP_MULTIPLE * abs(entry_basis):
                self.close_v11("BASIS_STOP")
            elif sec >= clock("15:30:00"):
                self.close_v11("FINAL_1530")

    def tick(self) -> None:
        self.reset_days()
        kill = self.kill_switch()
        if kill:
            self.flatten_all(str(kill.get("reason") or "KILL_SWITCH"))
            return
        self.enforce_daily_loss()
        if self.kill_switch():
            self.flatten_all("DAILY_LOSS")
            return
        local = dt.datetime.now(tz=NY)
        if local.weekday() >= 5:
            return
        if not is_equity_market_open(local) and not self.state.get("position"):
            return
        sec = ny_seconds(local)
        need_rows = bool(self.state.get("position")) or clock("09:59:55") <= sec <= clock("15:30:30")
        if not need_rows:
            return
        self.update_history()
        rows = self.books_and_refs()
        if not self.state.get("v11SignalBasis") and clock("09:59:55") <= sec <= clock("10:00:20"):
            self.record_v11_signal(rows)
        if self.state.get("position"):
            self.manage_position(rows)
            return
        if not self.state.get("v13Attempted") and clock("10:00:00") <= sec <= clock("10:00:20"):
            self.state["v13Attempted"] = True
            self.save()
            candidate = self.candidate_v13d(rows)
            self.log("v13d-decision", candidate=candidate)
            if candidate:
                self.open_v13d(candidate)
            return
        if not self.state.get("v11Attempted") and clock("10:30:00") <= sec <= clock("10:30:20"):
            self.state["v11Attempted"] = True
            self.save()
            candidate, rejections = self.v11_candidates(rows)
            self.log("v11eq-decision", candidate=candidate, rejections=rejections)
            if candidate:
                self.open_v11(candidate)

    def preflight(self) -> dict:
        checks: Dict[str, Any] = {}
        if self.live:
            if not bool_env("DISDEX_V13D_V11EQ_V96_LIVE_EXECUTION_ENABLED", False):
                raise RuntimeError("Live execution requires DISDEX_V13D_V11EQ_V96_LIVE_EXECUTION_ENABLED=true")
            if os.getenv("DISDEX_V13D_V11EQ_V96_LIVE_ACKNOWLEDGEMENT") != LIVE_ACK:
                raise RuntimeError(f"Live execution requires acknowledgement {LIVE_ACK}")
        self.state_root.mkdir(parents=True, exist_ok=True)
        probe = self.state_root / ".write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        checks["stateWritable"] = True
        if self.kill_switch():
            raise RuntimeError("Kill Switch is active")
        checks["killSwitchInactive"] = True
        checks["asterPing"] = self.aster.ping()
        self.aster.exchange_info()
        missing = [symbol for symbol in ASTER_SYMBOL.values() if symbol not in self.aster._rules]
        if missing:
            raise RuntimeError(f"Aster Stock symbols missing: {missing}")
        checks["asterSymbols"] = list(ASTER_SYMBOL.values())
        self.xyz.connect()
        xyz_meta = self.xyz.info.meta(dex="xyz")
        xyz_names = [row.get("name") for row in xyz_meta.get("universe", [])]
        missing_xyz = [symbol for symbol in XYZ_SYMBOL.values() if symbol not in xyz_names]
        if missing_xyz:
            raise RuntimeError(f"Hyperliquid xyz symbols missing: {missing_xyz}")
        checks["xyzSymbols"] = list(XYZ_SYMBOL.values())
        for symbol in SYMBOLS:
            reference = self.reference.quote(symbol)
            if now_ms() - reference.timestamp_ms > V11_MAX_DATA_AGE_MS:
                raise RuntimeError(f"Reference quote stale for {symbol}: {now_ms() - reference.timestamp_ms}ms")
        checks["referenceQuotesFresh"] = True
        if self.live:
            checks["asterEquity"] = self.aster.equity()
            checks["xyzEquity"] = self.xyz.equity()
            if checks["asterEquity"] <= 0 or checks["xyzEquity"] <= 0:
                raise RuntimeError("Live venue equity must be positive")
            checks["managedAsterPositions"] = self.managed_aster_positions()
            checks["managedXyzPositions"] = self.managed_xyz_positions()
        checks["stockCapitalUsd"] = self.stock_capital
        checks["v13LegNotionalUsd"] = self.v13_leg_notional
        checks["v11NotionalUsd"] = self.v11_notional
        checks["mode"] = self.mode
        return checks

    def run(self, daemon: bool) -> None:
        self.lock.acquire()
        try:
            self.xyz.connect()
            self.reset_days()
            self.reconcile()
            self.log("stock-runner-start", strategyId=STRATEGY_ID, stockCapitalUsd=self.stock_capital)
            while not self.stop_requested:
                started = now_ms()
                try:
                    self.tick()
                    if self.data_unavailable_since_ms is not None:
                        self.data_unavailable_since_ms = None
                        self.state.pop("dataUnavailableSinceMs", None)
                        self.save()
                except OrderExecutionUnknownError as error:
                    self.state["manualReviewReason"] = f"Order status unknown: {error}"
                    self.save()
                    self.log("stock-order-execution-unknown", error=str(error))
                    self.stop_requested = True
                    raise
                except TransientDataError as error:
                    self._handle_transient_data_error(error)
                    if self.stop_requested:
                        raise
                except Exception as error:
                    self.log("stock-runner-tick-error", error=str(error))
                    if self.live:
                        self.activate_kill_switch(f"Stock engine fatal tick error: {error}")
                        try:
                            self.flatten_all("FATAL_TICK_ERROR")
                        except Exception as flatten_error:
                            self.log("stock-runner-fatal-flat-error", error=str(flatten_error))
                        raise
                if not daemon:
                    break
                local_sec = ny_seconds()
                active = clock("09:59:50") <= local_sec <= clock("10:30:30") or self.state.get("position") is not None
                interval = self.active_interval_ms if active else int_env("DISDEX_STOCK_IDLE_INTERVAL_MS", 5000)
                delay = max(0, interval - (now_ms() - started))
                time.sleep(delay / 1000.0)
        finally:
            self.lock.release()


def self_test() -> None:
    book = Book("ASTER", "AMZNUSDT", 99.9, 10, 100.1, 10, [(99.9, 10)], [(100.1, 10)], 1, 1)
    assert round(book.spread_bps, 6) == 20.0
    assert round(book.depth_usd("BUY"), 6) == 1001.0
    assert floor_step(1.2345, 0.01) == 1.23
    assert round_tick(100.001, 0.01, "BUY") == 100.0
    assert round_tick(100.001, 0.01, "SELL") == 100.01
    assert clock("10:30:00") == 37_800
    assert is_equity_market_open(dt.datetime(2026, 7, 31, 14, 0, tzinfo=UTC))
    assert not is_equity_market_open(dt.datetime(2026, 7, 31, 13, 29, tzinfo=UTC))
    assert not is_equity_market_open(dt.datetime(2026, 7, 31, 20, 0, tzinfo=UTC))
    assert not is_equity_market_open(dt.datetime(2026, 8, 1, 14, 0, tzinfo=UTC))
    assert LIVE_ACK == "I_ACCEPT_REAL_MONEY_V13D_V11EQ_V96"
    assert V13D_MIN_BASIS_BPS == 20.0
    assert V11_MAX_ROUND_TRIP_COST_BPS == 60.0
    assert V11_MAX_DATA_AGE_MS == 5000
    print("V13D + V11-EQ Stock live engine self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("paper", "live"), default=os.getenv("DISDEX_V13D_V11EQ_V96_RUNNER_MODE", "paper"))
    parser.add_argument("--daemon", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    engine = StockEngine(args.mode)
    def stop(_signum, _frame):
        engine.stop_requested = True
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    if args.preflight:
        print(json.dumps({"status": "READY", "checks": engine.preflight()}, ensure_ascii=False, indent=2))
        return 0
    engine.run(daemon=args.daemon and not args.once)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
