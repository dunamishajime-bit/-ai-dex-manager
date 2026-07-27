from __future__ import annotations

import argparse
import copy
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
V11_MAX_DATA_AGE_MS = 1500
V11_MAX_SOURCE_CLOCK_DIFF_MS = 1500
V11_MAX_ADVERSE_TWO_SECOND_BPS = 5.0
V11_MAX_ADVERSE_BASIS_MOVE_BPS = 10.0
V11_ENTRY_TTL_MS = 10_000
V11_MIN_FILL_RATIO = 0.90
V11_BASIS_STOP_MULTIPLE = 1.5


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


ASTER_BOOK_CACHE_MS = max(250, int_env("DISDEX_ASTER_BOOK_CACHE_MS", 750))
ASTER_ACCOUNT_CACHE_MS = max(1_000, int_env("DISDEX_ASTER_ACCOUNT_CACHE_MS", 5_000))
ASTER_EXCHANGE_INFO_CACHE_MS = max(60_000, int_env("DISDEX_ASTER_EXCHANGE_INFO_CACHE_MS", 21_600_000))
ASTER_429_COOLDOWN_MS = max(5_000, int_env("DISDEX_ASTER_429_COOLDOWN_MS", 30_000))
_API_COOLDOWN_UNTIL_MS = {"ASTER_PUBLIC": 0, "REFERENCE": 0, "ASTER_SIGNED": 0}
_ASTER_RATE_LIMIT_LOCK = threading.Lock()

def api_category(url: str, headers: Optional[Dict[str, str]]) -> str:
    host = urllib.parse.urlparse(url).netloc.lower()
    if headers and any(key.lower() in {"x-mbx-apikey", "x-api-key", "authorization"} for key in headers):
        return "ASTER_SIGNED"
    return "ASTER_PUBLIC" if "asterdex" in host else "REFERENCE"

def transient_error_class(category: str, status: Optional[int] = None) -> str:
    if status in {408, 429, 500, 502, 503, 504}:
        return {"ASTER_PUBLIC": "TRANSIENT_PUBLIC_DATA", "REFERENCE": "TRANSIENT_REFERENCE_DATA"}.get(category, "SIGNED_API_FAILURE")
    return "SIGNED_API_FAILURE" if category == "ASTER_SIGNED" else category

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
) -> Any:
    category = api_category(url, headers)
    with _ASTER_RATE_LIMIT_LOCK:
        if now_ms() < _API_COOLDOWN_UNTIL_MS[category]:
            remaining = _API_COOLDOWN_UNTIL_MS[category] - now_ms()
            raise RuntimeError(f"{transient_error_class(category, 429)} cooldown active ({remaining}ms remaining)")
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
        if error.code == 429:
            retry_after = finite(error.headers.get("Retry-After"), ASTER_429_COOLDOWN_MS / 1000.0)
            cooldown = max(ASTER_429_COOLDOWN_MS, int(retry_after * 1000))
            with _ASTER_RATE_LIMIT_LOCK:
                _API_COOLDOWN_UNTIL_MS[category] = max(_API_COOLDOWN_UNTIL_MS[category], now_ms() + cooldown)
        kind = transient_error_class(category, error.code)
        raise RuntimeError(f"{kind}: HTTP {error.code} {target}: {body[:500]}") from error


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


def passive_exit_price(book: "Book", close_side: str) -> float:
    return book.ask if close_side == "SELL" else book.bid

def urgent_exit_reason(reason: str) -> bool:
    return reason in {"BASIS_STOP", "MISSED_CHECKPOINT_FAIL_CLOSED", "FINAL_1530", "V96_MARGIN_PRIORITY", "DAILY_LOSS", "KILL_SWITCH", "FATAL_TICK_ERROR"} or reason.startswith("STATE_INCONSISTENCY")

def bps_change(current: float, previous: float) -> float:
    return (current / previous - 1.0) * 10_000.0 if current > 0 and previous > 0 else 0.0


def ny_seconds(value: Optional[dt.datetime] = None) -> int:
    local = value or dt.datetime.now(tz=NY)
    return local.hour * 3600 + local.minute * 60 + local.second


def clock(value: str) -> int:
    hour, minute, *rest = [int(item) for item in value.split(":")]
    second = rest[0] if rest else 0
    return hour * 3600 + minute * 60 + second


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
        self._exchange_info_loaded_at = 0
        self._cache: Dict[str, Tuple[int, Any]] = {}
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
        )

    def ping(self) -> Any:
        return http_json(f"{self.base_url}/fapi/v3/ping", timeout=self.timeout)

    def exchange_info(self) -> dict:
        if self._rules and now_ms() - self._exchange_info_loaded_at < ASTER_EXCHANGE_INFO_CACHE_MS:
            cached = self._cache.get("exchangeInfo")
            if cached:
                return copy.deepcopy(cached[1])
        payload = http_json(f"{self.base_url}/fapi/v3/exchangeInfo", timeout=self.timeout)
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
        self._exchange_info_loaded_at = now_ms()
        self._cache["exchangeInfo"] = (self._exchange_info_loaded_at + ASTER_EXCHANGE_INFO_CACHE_MS, payload)
        return payload

    def rules(self, symbol: str) -> dict:
        if symbol not in self._rules:
            self.exchange_info()
        row = self._rules.get(symbol)
        if not row or row.get("status") != "TRADING":
            raise RuntimeError(f"Aster symbol is unavailable: {symbol}")
        return row

    def normalize(self, symbol: str, quantity: float, price: float, side: str, *, reduce_only: bool = False) -> Tuple[float, float]:
        row = self.rules(symbol)
        normalized_qty = floor_step(min(quantity, row["maxQty"]), row["step"])
        normalized_price = round_tick(price, row["tick"], side)
        if normalized_qty < row["minQty"] or normalized_qty <= 0:
            raise RuntimeError(f"Aster quantity below minimum for {symbol}")
        if not reduce_only and row["minNotional"] > 0 and normalized_qty * normalized_price < row["minNotional"]:
            raise RuntimeError(f"Aster notional below minimum for {symbol}")
        return normalized_qty, normalized_price

    def book(self, symbol: str, limit: int = 20) -> Book:
        key = f"book:{symbol}:{limit}"
        cached = self._cache.get(key)
        if cached and now_ms() < cached[0]:
            return copy.deepcopy(cached[1])
        received = now_ms()
        payload = http_json(
            f"{self.public_url}/fapi/v1/depth",
            params={"symbol": symbol, "limit": limit},
            timeout=self.timeout,
        )
        bids = [(finite(row[0]), finite(row[1])) for row in payload.get("bids", [])]
        asks = [(finite(row[0]), finite(row[1])) for row in payload.get("asks", [])]
        if not bids or not asks or min(bids[0] + asks[0]) <= 0 or asks[0][0] <= bids[0][0]:
            raise RuntimeError(f"Invalid Aster depth for {symbol}")
        event = int(payload.get("E") or payload.get("T") or received)
        result = Book("ASTER", symbol, bids[0][0], bids[0][1], asks[0][0], asks[0][1], bids, asks, event, received)
        self._cache[key] = (received + ASTER_BOOK_CACHE_MS, result)
        return copy.deepcopy(result)

    def adverse_imbalance(self, symbol: str, maker_side: str) -> Optional[float]:
        end = now_ms()
        try:
            rows = http_json(
                f"{self.public_url}/fapi/v1/aggTrades",
                params={"symbol": symbol, "limit": 200},
                timeout=self.timeout,
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

    def balances(self) -> List[dict]:
        return self._account_cached("balances", lambda: self._signed("GET", "/fapi/v3/balance", {}))

    def positions(self) -> List[dict]:
        return self._account_cached("positions", lambda: self._signed("GET", "/fapi/v3/positionRisk", {}))

    def open_orders(self, symbol: Optional[str] = None) -> List[dict]:
        key = f"openOrders:{symbol or '*'}"
        return self._account_cached(key, lambda: self._signed("GET", "/fapi/v3/openOrders", {"symbol": symbol} if symbol else {}))

    def _account_cached(self, key: str, loader: Any) -> Any:
        cached = self._cache.get(key)
        if cached and now_ms() < cached[0]:
            return copy.deepcopy(cached[1])
        value = loader()
        self._cache[key] = (now_ms() + ASTER_ACCOUNT_CACHE_MS, value)
        return copy.deepcopy(value)

    def _invalidate_account_cache(self) -> None:
        for key in ("balances", "positions"):
            self._cache.pop(key, None)
        for key in list(self._cache):
            if key.startswith("openOrders:"):
                self._cache.pop(key, None)

    def get_order(self, symbol: str, client_id: str) -> dict:
        return self._signed("GET", "/fapi/v3/order", {"symbol": symbol, "origClientOrderId": client_id})

    def cancel(self, symbol: str, client_id: str) -> dict:
        if not self.live:
            return {"symbol": symbol, "clientOrderId": client_id, "status": "CANCELED"}
        result = self._signed("DELETE", "/fapi/v3/order", {"symbol": symbol, "origClientOrderId": client_id})
        self._invalidate_account_cache()
        return result

    def cancel_all(self, symbol: str) -> Any:
        if not self.live:
            return {"symbol": symbol, "status": "CANCELED"}
        result = self._signed("DELETE", "/fapi/v3/allOpenOrders", {"symbol": symbol})
        self._invalidate_account_cache()
        return result

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
    ) -> Fill:
        quantity, price = self.normalize(symbol, quantity, price, side, reduce_only=reduce_only)
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
        self._invalidate_account_cache()
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
    ) -> Fill:
        quantity, _ = self.normalize(symbol, quantity, expected_price, side, reduce_only=reduce_only)
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
        self._invalidate_account_cache()
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
            raw = self.get_order(symbol, client_id)
            last = self._fill(raw, requested, side, client_id)
            if last.status in {"FILLED", "CANCELED", "REJECTED", "EXPIRED"}:
                return last
            time.sleep(0.1)
        try:
            self.cancel(symbol, client_id)
        finally:
            raw = self.get_order(symbol, client_id)
            return self._fill(raw, requested, side, client_id)

    def account_summary(self) -> dict:
        if not self.live:
            equity = float_env("DISDEX_STOCK_PAPER_ASTER_EQUITY_USD", 1000.0)
            return {"equityUsd": equity, "availableBalanceUsd": equity, "crossWalletBalanceUsd": equity, "unrealizedPnlUsd": 0.0}
        balances = self.balances()
        usdt = next((row for row in balances if str(row.get("asset", "")).upper() == "USDT"), None) or {}
        unrealized = sum(finite(row.get("unRealizedProfit") or row.get("unrealizedProfit")) for row in self.positions())
        wallet = finite(usdt.get("balance") or usdt.get("crossWalletBalance"))
        available = finite(usdt.get("availableBalance") or usdt.get("maxWithdrawAmount"), wallet)
        cross = finite(usdt.get("crossWalletBalance") or usdt.get("balance"), wallet)
        return {"equityUsd": wallet + unrealized, "availableBalanceUsd": available, "crossWalletBalanceUsd": cross, "unrealizedPnlUsd": unrealized}

    def equity(self) -> float:
        return float(self.account_summary()["equityUsd"])


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
        self.last_timestamp_fallback = False
        if live and self.mode != "external":
            raise RuntimeError("Live Stock engine requires DISDEX_STOCK_REFERENCE_MODE=external")
        if self.mode == "external" and "{symbol}" not in self.template:
            raise RuntimeError("DISDEX_STOCK_REFERENCE_URL_TEMPLATE must include {symbol}")

    def quote(self, symbol: str) -> ReferenceQuote:
        received = now_ms()
        if self.mode == "external":
            url = self.template.format(symbol=symbol, unix_ms=received)
            payload = http_json(url, headers=self.headers, timeout=self.timeout)
            price = finite(get_path(payload, self.price_path))
            try:
                timestamp = int(finite(get_path(payload, self.timestamp_path), 0))
                if timestamp <= 0:
                    raise ValueError("missing source timestamp")
            except (KeyError, TypeError, ValueError):
                timestamp = received
                self.last_timestamp_fallback = True
            if timestamp < 10_000_000_000:
                timestamp *= 1000
            source = url.split("?", 1)[0] + (" [timestamp-fallback]" if self.last_timestamp_fallback else "")
        elif self.mode == "yahoo":
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1m&range=1d"
            payload = http_json(url, timeout=self.timeout)
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
        return ReferenceQuote(symbol, price, timestamp, received, source)


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
        self.last_book_event = {symbol: 0 for symbol in SYMBOLS}
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

    def managed_aster_positions(self) -> Dict[str, float]:
        if not self.live:
            position = self.state.get("position") or {}
            if not position:
                return {}
            side = 1 if position.get("asterOpenSide") == "BUY" else -1
            return {ASTER_SYMBOL[position["symbol"]]: side * finite(position.get("asterQty"))}
        result = {}
        for row in self.aster.positions():
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

    def books_and_refs(self) -> Dict[str, Tuple[Book, Book, ReferenceQuote]]:
        result = {}
        with ThreadPoolExecutor(max_workers=10) as pool:
            jobs = {}
            for symbol in SYMBOLS:
                jobs[(symbol, "aster")] = pool.submit(self.aster.book, ASTER_SYMBOL[symbol], 20)
                jobs[(symbol, "xyz")] = pool.submit(self.xyz.book, XYZ_SYMBOL[symbol])
                jobs[(symbol, "ref")] = pool.submit(self.reference.quote, symbol)
            for symbol in SYMBOLS:
                result[symbol] = (
                    jobs[(symbol, "aster")].result(),
                    jobs[(symbol, "xyz")].result(),
                    jobs[(symbol, "ref")].result(),
                )
        return result

    def update_history(self) -> None:
        received = now_ms()
        for symbol in SYMBOLS:
            try:
                book = self.aster.book(ASTER_SYMBOL[symbol], 20)
            except Exception as error:
                self.log("history-book-error", symbol=symbol, error=str(error))
                continue
            if book.event_ms == self.last_book_event[symbol]:
                continue
            self.last_book_event[symbol] = book.event_ms
            self.spreads[symbol].append((book.event_ms, book.spread_bps))
            self.mids[symbol].append((book.event_ms, book.mid))
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
        two_second_mid = next((value for timestamp, value in reversed(self.mids[selected]) if timestamp <= now - 2000), aster.mid)
        adverse_two_second = max(0.0, bps_change(aster.mid, two_second_mid) * (1 if side == "BUY" else -1))
        signal_value = finite(signal_basis.get(selected), basis)
        adverse_basis = max(0.0, abs(basis) - abs(signal_value))
        reasons = []
        if abs(basis) < V11_MIN_BASIS_BPS:
            reasons.append("BASIS_BELOW_50")
        if selected != top1:
            reasons.append("NO_LONGER_TOP1")
        if now - aster.received_ms > V11_MAX_DATA_AGE_MS or now - reference.timestamp_ms > V11_MAX_DATA_AGE_MS:
            reasons.append("STALE_DATA")
        if reference.timestamp_ms > now + 250:
            reasons.append("REFERENCE_FUTURE_TIMESTAMP")
        if reference.timestamp_ms <= 0:
            reasons.append("REFERENCE_TIMESTAMP_MISSING")
        if abs(aster.event_ms - reference.timestamp_ms) > V11_MAX_SOURCE_CLOCK_DIFF_MS:
            reasons.append("SOURCE_CLOCK_MISMATCH")
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

    def recheck_entry_conditions(self, candidate: dict) -> None:
        symbol = str(candidate["symbol"])
        book = self.aster.book(ASTER_SYMBOL[symbol], 20)
        quote = self.reference.quote(symbol)
        now = now_ms()
        if quote.timestamp_ms <= 0 or quote.timestamp_ms > now + 250 or now - quote.timestamp_ms > V11_MAX_DATA_AGE_MS:
            raise RuntimeError("TRANSIENT_REFERENCE_DATA: entry reference is stale or invalid")
        basis = (book.mid / quote.price - 1.0) * 10_000.0
        expected = finite(candidate.get("basisBps"))
        if abs(basis) < V11_MIN_BASIS_BPS or basis * expected <= 0:
            raise RuntimeError("ENTRY_RECHECK_FAILED: basis threshold or sign changed")
        cost, _ = self.estimate_v11_cost(book, "BUY" if candidate.get("side") == "SELL" else "SELL", max(1.0, finite(candidate.get("notionalUsd"), self.v11_notional)))
        net_edge = abs(basis) - V11_CONVERGENCE_BPS - cost
        if net_edge < V11_MIN_NET_EDGE_BPS:
            raise RuntimeError("ENTRY_RECHECK_FAILED: net edge below 10bps")

    def open_v11(self, candidate: dict) -> bool:
        self.recheck_entry_conditions(candidate)
        symbol = candidate["symbol"]
        aster_symbol = ASTER_SYMBOL[symbol]
        quantity = self.v11_notional / candidate["entryPrice"]
        client_id = self.client_id("V11EQ", symbol, "OPEN")
        normalized_quantity, normalized_price = self.aster.normalize(aster_symbol, quantity, candidate["entryPrice"], candidate["side"])
        initial = self.aster.place_limit(
            symbol=aster_symbol,
            side=candidate["side"],
            quantity=normalized_quantity,
            price=normalized_price,
            client_id=client_id,
            post_only=True,
        )
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
        book = self.aster.book(aster_symbol, 20)
        expected = book.bid if close_side == "SELL" else book.ask
        fill = self.aster.place_market(
            symbol=aster_symbol,
            side=close_side,
            quantity=quantity,
            expected_price=expected,
            client_id=self.client_id("FLAT", symbol, reason + "-A"),
            reduce_only=True,
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
        book = self.aster.book(ASTER_SYMBOL[symbol], 20)
        price = passive_exit_price(book, close_side)
        client_id = self.client_id("V11EQ", symbol, "CLOSE-LIMIT")
        urgent = urgent_exit_reason(reason)
        try:
            initial = self.aster.place_market(symbol=ASTER_SYMBOL[symbol], side=close_side, quantity=quantity, expected_price=book.ask if close_side == "BUY" else book.bid, client_id=client_id, reduce_only=True) if urgent else self.aster.place_limit(symbol=ASTER_SYMBOL[symbol], side=close_side, quantity=quantity, price=price, client_id=client_id, reduce_only=True, post_only=True)
        except RuntimeError as error:
            if urgent or "GTX" not in str(error).upper():
                raise
            self.log("post-only-exit-rejected-fallback", symbol=symbol, reason=reason, error=str(error))
            initial = Fill("ASTER", ASTER_SYMBOL[symbol], close_side, quantity, 0.0, 0.0, "REJECTED", client_id, error=str(error))
        fill = initial if not self.live else self.aster.poll_fill(ASTER_SYMBOL[symbol], client_id, quantity, close_side, 2000)
        remaining = max(0.0, quantity - fill.executed_qty)
        if remaining > quantity * 0.01:
            market_fill = self.flatten_aster_leg(symbol, open_side, remaining, reason + "-TAKER")
            if market_fill.fill_ratio < 0.99:
                self.activate_kill_switch("V11-EQ close did not fully complete")
                raise RuntimeError("V11-EQ close did not fully complete")
        self.state["position"] = None
        self.save()
        self.log("v11eq-position-closed", symbol=symbol, reason=reason)

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
                book = self.aster.book(symbol, 20)
                self.aster.place_market(
                    symbol=symbol,
                    side=side,
                    quantity=abs(qty),
                    expected_price=book.ask if side == "BUY" else book.bid,
                    client_id=self.client_id("RECOVERY", base_symbol, "ASTER"),
                    reduce_only=True,
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
        self.update_history()
        local = dt.datetime.now(tz=NY)
        if local.weekday() >= 5:
            return
        sec = ny_seconds(local)
        need_rows = self.state.get("position") is not None or clock("09:59:55") <= sec <= clock("15:30:30")
        if not need_rows:
            return
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
                interval = 250 if active else int_env("DISDEX_STOCK_IDLE_INTERVAL_MS", 5000)
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
    assert LIVE_ACK == "I_ACCEPT_REAL_MONEY_V13D_V11EQ_V96"
    assert V13D_MIN_BASIS_BPS == 20.0
    assert V11_MAX_ROUND_TRIP_COST_BPS == 60.0
    assert passive_exit_price(book, "SELL") == book.ask
    assert passive_exit_price(book, "BUY") == book.bid
    assert urgent_exit_reason("BASIS_STOP") and urgent_exit_reason("FINAL_1530")
    assert not urgent_exit_reason("BASIS_CONVERGED")
    assert api_category("https://fapi.asterdex.com/fapi/v3/depth", None) == "ASTER_PUBLIC"
    assert api_category("https://query.example.test/quote", None) == "REFERENCE"
    assert transient_error_class("REFERENCE", 429) == "TRANSIENT_REFERENCE_DATA"
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
