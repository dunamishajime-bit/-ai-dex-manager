"""Read-only market-data adapters with strict host, mapping, and paging rules."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
import csv
import hashlib
import io
import json
import math
import os
import re
import time
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


SUPPORTED_SOURCES = {
    "aster": "https://fapi.asterdex.com",
    "binance": "https://fapi.binance.com",
    "bybit": "https://api.bybit.com",
    "okx": "https://www.okx.com",
    "fred": "https://fred.stlouisfed.org",
    "alpaca": "https://data.alpaca.markets",
}
_ALLOWED_ROUTES = {
    "aster": ("/fapi/v3/klines", "/fapi/v3/fundingRate", "/fapi/v3/exchangeInfo"),
    "binance": ("/fapi/v1/klines", "/fapi/v1/fundingRate", "/fapi/v1/exchangeInfo"),
    "bybit": ("/v5/market/kline", "/v5/market/funding/history", "/v5/market/instruments-info"),
    "okx": ("/api/v5/market/history-candles", "/api/v5/public/funding-rate-history", "/api/v5/public/instruments"),
    "fred": ("/graph/fredgraph.csv",),
    "alpaca": ("/v2/stocks/",),
}
_SECRET_QUERY_KEY = re.compile(r"api.?key|secret|password|signature|authorization|account|wallet|^token$", re.I)
_SAFE_ROUTE = re.compile(r"^/[A-Za-z0-9._/-]+$")
_ASSET_VENUE_IDS = {
    "BTC": ("BTCUSDT", "BTC-USDT-SWAP"), "ETH": ("ETHUSDT", "ETH-USDT-SWAP"),
    "BNB": ("BNBUSDT", "BNB-USDT-SWAP"), "SOL": ("SOLUSDT", "SOL-USDT-SWAP"),
    "LINK": ("LINKUSDT", "LINK-USDT-SWAP"), "AVAX": ("AVAXUSDT", "AVAX-USDT-SWAP"),
    "DOGE": ("DOGEUSDT", "DOGE-USDT-SWAP"), "INJ": ("INJUSDT", "INJ-USDT-SWAP"),
    "XRP": ("XRPUSDT", "XRP-USDT-SWAP"), "ADA": ("ADAUSDT", "ADA-USDT-SWAP"),
    "LTC": ("LTCUSDT", "LTC-USDT-SWAP"), "ATOM": ("ATOMUSDT", "ATOM-USDT-SWAP"),
    "AAVE": ("AAVEUSDT", "AAVE-USDT-SWAP"), "NEAR": ("NEARUSDT", "NEAR-USDT-SWAP"),
    "SUI": ("SUIUSDT", "SUI-USDT-SWAP"), "SEI": ("SEIUSDT", "SEI-USDT-SWAP"),
    "APT": ("APTUSDT", "APT-USDT-SWAP"), "ARB": ("ARBUSDT", "ARB-USDT-SWAP"),
    "OP": ("OPUSDT", "OP-USDT-SWAP"), "TIA": ("TIAUSDT", "TIA-USDT-SWAP"),
    "JUP": ("JUPUSDT", "JUP-USDT-SWAP"), "ENA": ("ENAUSDT", "ENA-USDT-SWAP"),
    "ONDO": ("ONDOUSDT", "ONDO-USDT-SWAP"), "FIL": ("FILUSDT", "FIL-USDT-SWAP"),
    "RENDER": ("RENDERUSDT", "RENDER-USDT-SWAP"), "TAO": ("TAOUSDT", "TAO-USDT-SWAP"),
    "TRX": ("TRXUSDT", "TRX-USDT-SWAP"), "PENGU": ("PENGUUSDT", "PENGU-USDT-SWAP"),
    "FET": ("FETUSDT", "FET-USDT-SWAP"),
}
_CANONICAL_TO_BASE = {aster: base for base, (aster, _) in _ASSET_VENUE_IDS.items()}


@dataclass(frozen=True, slots=True)
class InstrumentMapping:
    source: str
    canonical_instrument: str
    native_instrument: str
    contract_type: str
    same_underlying: bool


@dataclass(frozen=True, slots=True)
class PageCollection:
    rows: list[Any]
    page_hashes: list[str]
    page_count: int


@dataclass(frozen=True, slots=True)
class KlineAcquisition:
    source: str
    native_instrument: str
    interval: str
    rows: list[list[Any]]
    page_hashes: list[str]
    raw_responses: list[bytes]
    requested_start_ms: int
    requested_end_ms: int
    actual_start_ms: int | None
    actual_end_ms: int | None


@dataclass(frozen=True, slots=True)
class FxAcquisition:
    observations: list[dict[str, Any]]
    response_sha256: str
    source_url: str
    raw_response: bytes


@dataclass(frozen=True, slots=True)
class QuoteAcquisition:
    source: str
    symbol: str
    feed: str
    rows: list[dict[str, Any]]
    page_hashes: list[str]
    raw_responses: list[bytes]
    requested_start: str
    requested_end: str


@dataclass(frozen=True, slots=True)
class FundingAcquisition:
    source: str
    native_instrument: str
    rows: list[dict[str, Any]]
    page_hashes: list[str]
    raw_responses: list[bytes]
    requested_start_ms: int
    requested_end_ms: int


@dataclass(frozen=True, slots=True)
class NativeInstrument:
    source: str
    native_instrument: str
    contract_type: str
    status: str
    quote_asset: str
    listed_from_ms: int
    listed_until_ms: int | None


@dataclass(frozen=True, slots=True)
class InstrumentCatalog:
    source: str
    rows: list[dict[str, Any]]
    page_hashes: list[str]
    raw_responses: list[bytes]


@dataclass(frozen=True, slots=True)
class ProxyArchiveFile:
    provider: str
    exchange_id: str
    symbol: str
    hour_utc: str
    status: str
    content_sha256: str | None
    byte_count: int
    raw_data: bytes | None
    source_url: str


_PROXY_ARCHIVE_EXCHANGES = {"binance_futures", "bybit", "okx_futures", "aster_futures"}


def fetch_crypto_hft_orderbook(
    exchange_id: str,
    symbol: str,
    hour_utc: datetime,
    *,
    fetch: Callable[[str], bytes] | None = None,
) -> ProxyArchiveFile:
    """Fetch a free-tier hourly L2 file; keep provider and underlying venue separate."""
    if exchange_id not in _PROXY_ARCHIVE_EXCHANGES:
        raise ValueError("unsupported proxy exchange")
    if not re.fullmatch(r"[A-Z0-9._-]{2,30}", symbol):
        raise ValueError("invalid native instrument")
    if hour_utc.tzinfo is None or hour_utc.utcoffset() is None:
        raise ValueError("archive hour must be timezone-aware")
    hour = hour_utc.astimezone(timezone.utc)
    if any((hour.minute, hour.second, hour.microsecond)):
        raise ValueError("archive timestamp must be on an hour boundary")
    object_path = f"{exchange_id}/{hour:%Y-%m-%d}/{hour:%H}/{symbol}_orderbook.parquet"
    url = "https://api.cryptohftdata.com/download?" + urlencode({"file": object_path})
    try:
        if fetch is not None:
            raw = fetch(url)
        else:
            with urlopen(Request(url, headers={"User-Agent": "formal-five-logic-bt/1.0"}), timeout=30.0) as response:
                raw = response.read()
    except HTTPError as error:
        if error.code == 404:
            return ProxyArchiveFile("CryptoHFTData", exchange_id, symbol, hour.isoformat(), "NOT_FOUND", None, 0, None, url)
        if error.code == 429:
            raise RuntimeError("proxy archive free-tier rate limit reached") from None
        raise RuntimeError(f"proxy archive returned HTTP {error.code}") from None
    except (URLError, TimeoutError, OSError):
        raise RuntimeError("proxy archive request failed") from None
    return ProxyArchiveFile(
        "CryptoHFTData", exchange_id, symbol, hour.isoformat(), "AVAILABLE",
        hashlib.sha256(raw).hexdigest(), len(raw), raw, url,
    )


def verify_native_instrument(source: str, native_instrument: str, raw: Mapping[str, Any]) -> NativeInstrument:
    """Require exchange metadata to verify an exact USDT linear perpetual."""
    source = source.lower()
    if source in {"aster", "binance"}:
        if raw.get("symbol") != native_instrument:
            raise ValueError("instrument metadata does not match native instrument")
        if raw.get("contractType") != "PERPETUAL" or raw.get("quoteAsset") != "USDT":
            raise ValueError("instrument is not a USDT linear perpetual")
        listed_raw = raw.get("onboardDate")
        delisted_raw = raw.get("deliveryDate") or raw.get("deliveryTime")
        status = str(raw.get("status", "unknown"))
        quote = str(raw.get("quoteAsset", ""))
    elif source == "bybit":
        if raw.get("symbol") != native_instrument:
            raise ValueError("instrument metadata does not match native instrument")
        if str(raw.get("contractType", "")).lower() != "linearperpetual" or raw.get("settleCoin") != "USDT":
            raise ValueError("instrument is not a USDT linear perpetual")
        listed_raw = raw.get("launchTime")
        delisted_raw = raw.get("deliveryTime")
        status = str(raw.get("status", "unknown"))
        quote = str(raw.get("settleCoin", ""))
    elif source == "okx":
        if raw.get("instId") != native_instrument:
            raise ValueError("instrument metadata does not match native instrument")
        if raw.get("instType") != "SWAP" or raw.get("ctType") != "linear" or raw.get("settleCcy") != "USDT":
            raise ValueError("instrument is not a USDT linear perpetual")
        listed_raw = raw.get("listTime")
        delisted_raw = raw.get("expTime")
        status = str(raw.get("state", "unknown"))
        quote = str(raw.get("settleCcy", ""))
    else:
        raise ValueError("unsupported instrument metadata source")
    try:
        listed = int(listed_raw)
    except (TypeError, ValueError):
        raise ValueError("metadata does not verify listing time") from None
    if listed <= 0:
        raise ValueError("metadata does not verify listing time")
    try:
        delisted = int(delisted_raw) if delisted_raw not in {None, "", 0, "0"} else None
    except (TypeError, ValueError):
        delisted = None
    return NativeInstrument(source, native_instrument, "linear_perpetual", status, quote, listed, delisted)


def fetch_instrument_catalog(
    source: str,
    *,
    request_json: Callable[[str, str, Mapping[str, Any]], tuple[Any, bytes]] | None = None,
    max_pages: int = 100,
) -> InstrumentCatalog:
    """Fetch current native instrument metadata from an official venue API."""
    source = source.lower()
    if source not in {"aster", "binance", "bybit", "okx"}:
        raise ValueError("unsupported instrument catalog source")
    if max_pages <= 0:
        raise ValueError("max_pages must be positive")
    call = request_json or _json_request
    if source == "aster":
        route, params = "/fapi/v3/exchangeInfo", {}
    elif source == "binance":
        route, params = "/fapi/v1/exchangeInfo", {}
    elif source == "okx":
        route, params = "/api/v5/public/instruments", {"instType": "SWAP"}
    else:
        route, params = "/v5/market/instruments-info", {"category": "linear", "limit": 1000}
    rows: list[dict[str, Any]] = []
    hashes: list[str] = []
    raw_responses: list[bytes] = []
    cursor: str | None = None
    seen: set[str] = set()
    for _ in range(max_pages):
        request_params = dict(params)
        if source == "bybit" and cursor:
            request_params["cursor"] = cursor
        payload, raw = call(source, route, request_params)
        hashes.append(hashlib.sha256(raw).hexdigest())
        raw_responses.append(raw)
        if source == "bybit":
            if payload.get("retCode") != 0:
                raise RuntimeError("Bybit rejected instrument catalog request")
            result = payload.get("result", {})
            page = result.get("list", [])
            next_cursor = result.get("nextPageCursor") or None
        elif source == "okx":
            if payload.get("code") != "0":
                raise RuntimeError("OKX rejected instrument catalog request")
            page = payload.get("data", [])
            next_cursor = None
        else:
            page = payload.get("symbols", [])
            next_cursor = None
        if not isinstance(page, list) or any(not isinstance(row, dict) for row in page):
            raise ValueError("source instrument catalog is malformed")
        rows.extend(page)
        if not next_cursor:
            break
        cursor = str(next_cursor)
        if cursor in seen:
            raise ValueError("instrument catalog cursor repeated")
        seen.add(cursor)
    else:
        raise ValueError("maximum instrument catalog page count exceeded")
    return InstrumentCatalog(source, rows, hashes, raw_responses)


def build_source_url(source: str, route: str, params: Mapping[str, Any]) -> str:
    source = source.lower()
    if source not in SUPPORTED_SOURCES or not isinstance(route, str):
        raise ValueError("unsupported source route")
    allowed = _ALLOWED_ROUTES[source]
    if not any(route == prefix if source != "alpaca" else route.startswith(prefix) for prefix in allowed):
        raise ValueError("unsupported source route")
    if not _SAFE_ROUTE.fullmatch(route) or route.startswith("//") or ".." in route.split("/"):
        raise ValueError("unsupported source route")
    if any(_SECRET_QUERY_KEY.search(str(key)) for key in params):
        raise ValueError("secret-like query field is prohibited")
    query = urlencode({key: value for key, value in params.items() if value is not None})
    base = SUPPORTED_SOURCES[source].rstrip("/")
    return f"{base}{route}" + (f"?{query}" if query else "")


def map_native_instrument(
    source: str,
    canonical_instrument: str,
    native_instrument: str,
    contract_type: str,
    *,
    equity_quote_only: bool = False,
) -> InstrumentMapping:
    source = source.lower()
    if contract_type == "stock_perpetual" or equity_quote_only:
        raise ValueError("stock perpetual listing must be independently verified")
    if source not in {"aster", "binance", "okx", "bybit"} or canonical_instrument not in _CANONICAL_TO_BASE:
        raise ValueError("unsupported cross-venue mapping")
    base = _CANONICAL_TO_BASE[canonical_instrument]
    expected = {
        "aster": _ASSET_VENUE_IDS[base][0],
        "binance": _ASSET_VENUE_IDS[base][0],
        "bybit": _ASSET_VENUE_IDS[base][0],
        "okx": _ASSET_VENUE_IDS[base][1],
    }[source]
    if contract_type != "linear_perpetual":
        raise ValueError("contract-type mismatch")
    if native_instrument != expected:
        raise ValueError("unsupported cross-venue mapping")
    return InstrumentMapping(source, canonical_instrument, native_instrument, contract_type, True)


def paginate_json(
    fetch: Callable[[str | None], tuple[dict[str, Any], bytes]],
    *,
    initial_cursor: str | None,
    rows_key: str,
    next_key: str,
    max_pages: int = 1000,
) -> PageCollection:
    """Collect cursor pages without loops; preserve immutable raw-page hashes."""
    if max_pages <= 0:
        raise ValueError("max_pages must be positive")
    rows: list[Any] = []
    hashes: list[str] = []
    seen_cursors: set[str] = set()
    cursor = initial_cursor
    if cursor is not None:
        seen_cursors.add(cursor)
    for _ in range(max_pages):
        payload, raw = fetch(cursor)
        hashes.append(hashlib.sha256(raw).hexdigest())
        page_rows = payload.get(rows_key)
        if not isinstance(page_rows, list):
            raise ValueError("response page does not contain a row list")
        rows.extend(page_rows)
        next_value = payload.get(next_key)
        if next_value is None or next_value == "":
            return PageCollection(rows, hashes, len(hashes))
        next_cursor = str(next_value)
        if next_cursor in seen_cursors:
            raise ValueError("pagination cursor repeated")
        seen_cursors.add(next_cursor)
        cursor = next_cursor
    raise ValueError("maximum page count exceeded")


def fetch_bytes(url: str, *, headers: Mapping[str, str] | None = None, timeout_seconds: float = 20.0, retries: int = 3) -> bytes:
    """GET an approved public endpoint with bounded exponential retry."""
    if retries < 0 or retries > 6:
        raise ValueError("retries must be between 0 and 6")
    for attempt in range(retries + 1):
        request = Request(url, headers={"User-Agent": "formal-five-logic-bt/1.0", **dict(headers or {})})
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                return response.read()
        except HTTPError as error:
            if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt == retries:
                raise RuntimeError(f"market-data HTTP request failed with status {error.code}") from None
        except (URLError, TimeoutError, OSError):
            if attempt == retries:
                raise RuntimeError("market-data request failed after bounded retries") from None
        time.sleep(min(0.25 * (2 ** attempt), 2.0))
    raise RuntimeError("market-data request failed after bounded retries")


def _json_request(source: str, route: str, params: Mapping[str, Any], headers: Mapping[str, str] | None = None) -> tuple[Any, bytes]:
    url = build_source_url(source, route, params)
    raw = fetch_bytes(url, headers=headers)
    try:
        return json.loads(raw), raw
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError("source returned malformed JSON") from None


def _row_time(source: str, row: list[Any]) -> int:
    return int(row[0])


def fetch_historical_funding(
    source: str,
    native_instrument: str,
    start_time_ms: int,
    end_time_ms: int,
    *,
    request_json: Callable[[str, str, Mapping[str, Any]], tuple[Any, bytes]] | None = None,
    max_pages: int = 10000,
) -> FundingAcquisition:
    """Fetch official historical perpetual funding observations with page hashes."""
    source = source.lower()
    if source not in {"aster", "binance", "bybit", "okx"}:
        raise ValueError("unsupported funding source")
    if start_time_ms < 0 or end_time_ms < start_time_ms:
        raise ValueError("invalid requested time range")
    if max_pages <= 0:
        raise ValueError("max_pages must be positive")
    call = request_json or _json_request
    cursor = end_time_ms + 1 if source == "okx" else start_time_ms
    rows_by_time: dict[int, dict[str, Any]] = {}
    hashes: list[str] = []
    raw_responses: list[bytes] = []
    for _ in range(max_pages):
        if source == "okx":
            if cursor <= start_time_ms:
                break
            route = "/api/v5/public/funding-rate-history"
            params = {"instId": native_instrument, "after": cursor, "limit": 400}
        elif source == "aster":
            if cursor > end_time_ms:
                break
            route = "/fapi/v3/fundingRate"
            params = {"symbol": native_instrument, "startTime": cursor, "endTime": end_time_ms, "limit": 1000}
        elif source == "binance":
            if cursor > end_time_ms:
                break
            route = "/fapi/v1/fundingRate"
            params = {"symbol": native_instrument, "startTime": cursor, "endTime": end_time_ms, "limit": 1000}
        else:
            if cursor > end_time_ms:
                break
            route = "/v5/market/funding/history"
            chunk_end = min(end_time_ms, cursor + 8 * 86_400_000 - 1)
            params = {"category": "linear", "symbol": native_instrument, "startTime": cursor, "endTime": chunk_end, "limit": 200}
        payload, raw = call(source, route, params)
        hashes.append(hashlib.sha256(raw).hexdigest())
        raw_responses.append(raw)
        if source == "okx":
            if payload.get("code") != "0":
                raise RuntimeError("OKX rejected funding history request")
            page = payload.get("data", [])
        elif source == "bybit":
            if payload.get("retCode") != 0:
                raise RuntimeError("Bybit rejected funding history request")
            page = payload.get("result", {}).get("list", [])
        else:
            page = payload
        if not isinstance(page, list):
            raise ValueError("source funding response is not a list")
        page_times: list[int] = []
        for row in page:
            time_key = "fundingRateTimestamp" if source == "bybit" else "fundingTime"
            try:
                ts = int(row[time_key])
                rate = float(row["fundingRate"])
            except (KeyError, TypeError, ValueError):
                raise ValueError("source returned malformed funding row") from None
            if not math.isfinite(rate):
                raise ValueError("source returned non-finite funding rate")
            if start_time_ms <= ts <= end_time_ms:
                rows_by_time[ts] = dict(row)
                page_times.append(ts)
        if source == "okx":
            if not page_times:
                break
            next_cursor = min(page_times)
            if next_cursor >= cursor:
                raise ValueError("funding pagination did not advance")
            if next_cursor <= start_time_ms:
                break
            cursor = next_cursor
        elif source == "bybit":
            chunk_end = params["endTime"]
            if chunk_end >= end_time_ms:
                break
            cursor = int(chunk_end) + 1
        else:
            if not page_times:
                break
            next_cursor = max(page_times) + 1
            if next_cursor <= cursor:
                raise ValueError("funding pagination did not advance")
            cursor = next_cursor
    else:
        raise ValueError("maximum funding page count exceeded")
    return FundingAcquisition(
        source, native_instrument, [rows_by_time[ts] for ts in sorted(rows_by_time)],
        hashes, raw_responses, start_time_ms, end_time_ms,
    )


def fetch_historical_klines(
    source: str,
    native_instrument: str,
    start_time_ms: int,
    end_time_ms: int,
    *,
    interval: str = "1h",
    request_json: Callable[[str, str, Mapping[str, Any]], tuple[Any, bytes]] | None = None,
    max_pages: int = 10000,
) -> KlineAcquisition:
    """Fetch OHLCV history from official Aster/Binance/Bybit/OKX public APIs."""
    source = source.lower()
    if source not in {"aster", "binance", "bybit", "okx"}:
        raise ValueError("unsupported kline source")
    if start_time_ms < 0 or end_time_ms < start_time_ms:
        raise ValueError("invalid requested time range")
    if interval not in {"1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"}:
        raise ValueError("unsupported kline interval")
    interval_ms = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000}[interval]
    call = request_json or _json_request
    cursor = end_time_ms + 1 if source == "okx" else start_time_ms
    limit = 300 if source == "okx" else 1000 if source == "bybit" else 1500
    all_rows: dict[int, list[Any]] = {}
    hashes: list[str] = []
    raw_responses: list[bytes] = []
    for _ in range(max_pages):
        if source == "okx" and cursor <= start_time_ms:
            break
        if source != "okx" and cursor > end_time_ms:
            break
        if source == "aster":
            route = "/fapi/v3/klines"
            params = {"symbol": native_instrument, "interval": interval, "startTime": cursor, "endTime": end_time_ms, "limit": limit}
        elif source == "binance":
            route = "/fapi/v1/klines"
            params = {"symbol": native_instrument, "interval": interval, "startTime": cursor, "endTime": end_time_ms, "limit": limit}
        elif source == "bybit":
            route = "/v5/market/kline"
            bybit_interval = {"1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "1d": "D"}[interval]
            params = {"category": "linear", "symbol": native_instrument, "interval": bybit_interval, "start": cursor, "end": end_time_ms, "limit": limit}
        else:
            route = "/api/v5/market/history-candles"
            okx_bar = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "2h": "2H", "4h": "4H", "1d": "1D"}[interval]
            params = {"instId": native_instrument, "bar": okx_bar, "after": cursor, "limit": limit}
        payload, raw = call(source, route, params)
        hashes.append(hashlib.sha256(raw).hexdigest())
        raw_responses.append(raw)
        if source == "bybit":
            if payload.get("retCode") != 0:
                raise RuntimeError("Bybit rejected historical kline request")
            rows = payload.get("result", {}).get("list", [])
        elif source == "okx":
            if payload.get("code") != "0":
                raise RuntimeError("OKX rejected historical kline request")
            rows = payload.get("data", [])
        else:
            rows = payload
        if not isinstance(rows, list):
            raise ValueError("source kline response is not a list")
        valid_times = []
        for row in rows:
            if not isinstance(row, list) or len(row) < 6:
                raise ValueError("source returned malformed kline row")
            ts = _row_time(source, row)
            if start_time_ms <= ts <= end_time_ms:
                all_rows[ts] = row
                valid_times.append(ts)
        if not valid_times:
            break
        if source == "okx":
            next_cursor = min(valid_times)
            if next_cursor >= cursor:
                raise ValueError("kline pagination did not advance")
            if next_cursor <= start_time_ms:
                break
            cursor = next_cursor
        else:
            last = max(valid_times)
            next_cursor = last + interval_ms
            if next_cursor <= cursor:
                raise ValueError("kline pagination did not advance")
            cursor = next_cursor
    else:
        raise ValueError("maximum kline page count exceeded")
    ordered = [all_rows[ts] for ts in sorted(all_rows)]
    return KlineAcquisition(
        source=source,
        native_instrument=native_instrument,
        interval=interval,
        rows=ordered,
        page_hashes=hashes,
        raw_responses=raw_responses,
        requested_start_ms=start_time_ms,
        requested_end_ms=end_time_ms,
        actual_start_ms=_row_time(source, ordered[0]) if ordered else None,
        actual_end_ms=_row_time(source, ordered[-1]) if ordered else None,
    )


def fetch_fred_dexjpus(
    start_date: date,
    end_date: date,
    *,
    fetch: Callable[[str], bytes] | None = None,
) -> FxAcquisition:
    if end_date < start_date:
        raise ValueError("end_date precedes start_date")
    query = urlencode({"id": "DEXJPUS", "cosd": start_date.isoformat(), "coed": end_date.isoformat()})
    primary = f"{SUPPORTED_SOURCES['fred']}/graph/fredgraph.csv?{query}"
    # The bounded date-query failed on GitHub Actions while the public, full
    # single-series FRED CSV and official Fed H.10 daily-rates package both
    # returned 2025/26 observations with valid headers. Use those as read-only
    # official no-key fallbacks; never fabricate or interpolate an FX rate.
    full_series = f"{SUPPORTED_SOURCES['fred']}/graph/fredgraph.csv?id=DEXJPUS"
    federal_h10 = (
        "https://www.federalreserve.gov/datadownload/Output.aspx?"
        "rel=H10&series=60f32914ab61dfab590e0e470153e3ae"
        "&lastobs=700&filetype=csv&label=include&layout=seriescolumn&type=package"
    )
    attempts = [(primary, "FRED_DEXJPUS")] if fetch is not None else [
        (full_series, "FRED_DEXJPUS"),
        (primary, "FRED_DEXJPUS"),
        (federal_h10, "FEDERAL_RESERVE_H10_REVISED"),
    ]
    for index, (url, kind) in enumerate(attempts):
        try:
            raw = (fetch or fetch_bytes)(url)
            lines = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
            if kind == "FEDERAL_RESERVE_H10_REVISED":
                headers = next((i for i, cells in enumerate(lines)
                    if cells and cells[0].strip() == "Time Period"
                    and "RXI_N.B.JA" in [cell.strip() for cell in cells]), None)
                if headers is None:
                    raise ValueError("FED_H10_JAPANESE_YEN_COLUMN_NOT_FOUND")
                names = [cell.strip() for cell in lines[headers]]
                value_column = names.index("RXI_N.B.JA")
                date_column = 0
                data = lines[headers + 1:]
            else:
                if not lines or not {"observation_date", "DEXJPUS"}.issubset(
                    {cell.strip() for cell in lines[0]}
                ):
                    raise ValueError("FRED_DEXJPUS_CSV_HEADER_MISMATCH")
                names = [cell.strip() for cell in lines[0]]
                date_column, value_column = (
                    names.index("observation_date"), names.index("DEXJPUS")
                )
                data = lines[1:]
            observations = []
            for cells in data:
                if max(date_column, value_column) >= len(cells):
                    continue
                datum, value = cells[date_column].strip(), cells[value_column].strip()
                if not value or value in {".", "ND", "N/A"}:
                    continue
                try:
                    at = date.fromisoformat(datum)
                except ValueError:
                    # FRED/H.10 release metadata is not a dated observation.
                    continue
                if not start_date <= at <= end_date:
                    continue
                rate = float(value)
                if not math.isfinite(rate) or rate <= 0:
                    raise ValueError("OFFICIAL_FX_RATE_INVALID")
                ts = int(datetime(at.year, at.month, at.day,
                                  tzinfo=timezone.utc).timestamp() * 1000) + 86_400_000 - 1
                observations.append({
                    "event_time_ms": ts, "source_time_ms": ts,
                    "rate_jpy_per_usd": rate,
                })
            if not observations:
                raise ValueError("OFFICIAL_FX_NO_OBSERVATIONS_IN_REQUESTED_RANGE")
            if any(later["event_time_ms"] <= earlier["event_time_ms"]
                   for earlier, later in zip(observations, observations[1:])):
                raise ValueError("OFFICIAL_FX_DATES_NOT_STRICTLY_INCREASING")
            return FxAcquisition(
                observations, hashlib.sha256(raw).hexdigest(), url, raw
            )
        except (RuntimeError, ValueError, UnicodeError, IndexError):
            if index == len(attempts) - 1:
                raise RuntimeError("ALL_APPROVED_OFFICIAL_USDJPY_SOURCES_UNAVAILABLE") from None
            continue
    raise RuntimeError("ALL_APPROVED_OFFICIAL_USDJPY_SOURCES_UNAVAILABLE")


def alpaca_iex_quote_headers(environ: Mapping[str, str] | None = None) -> dict[str, str]:
    """Read API credentials only into request headers; never return or log values."""
    values = os.environ if environ is None else environ
    key = values.get("ALPACA_DATA_API_KEY", "").strip()
    secret = values.get("ALPACA_DATA_API_SECRET", "").strip()
    if not key or not secret:
        raise RuntimeError("Alpaca credentials unavailable")
    if values.get("ALPACA_DATA_FEED", "iex").strip().lower() != "iex":
        raise RuntimeError("backtest stock data feed must match the audited IEX route")
    return {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret}


def _alpaca_time_ms(value: str) -> int:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("Alpaca quote timestamp is missing timezone")
    return int(parsed.astimezone(timezone.utc).timestamp() * 1000)


def fetch_alpaca_iex_quotes(
    symbol: str,
    start: datetime,
    end: datetime,
    *,
    headers: Mapping[str, str],
    feed: str = "iex",
    request: Callable[[str, Mapping[str, str]], bytes] | None = None,
    max_pages: int = 10000,
) -> QuoteAcquisition:
    """Fetch historical stock quotes using the active runtime's Alpaca IEX feed."""
    if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", symbol):
        raise ValueError("invalid stock symbol")
    if feed.lower() != "iex":
        raise ValueError("backtest stock data feed must be IEX")
    if start.tzinfo is None or end.tzinfo is None or start.utcoffset() is None or end.utcoffset() is None:
        raise ValueError("quote request times must be timezone-aware")
    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)
    if end_utc <= start_utc:
        raise ValueError("quote end must follow start")
    if not headers.get("APCA-API-KEY-ID") or not headers.get("APCA-API-SECRET-KEY"):
        raise RuntimeError("Alpaca credentials unavailable")
    fetch = request or (lambda url, request_headers: fetch_bytes(url, headers=request_headers))
    rows: list[dict[str, Any]] = []
    hashes: list[str] = []
    raw_responses: list[bytes] = []
    cursor: str | None = None
    seen: set[str] = set()
    route = f"/v2/stocks/{symbol}/quotes"
    for _ in range(max_pages):
        params = {
            "start": start_utc.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "end": end_utc.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "feed": "iex", "sort": "asc", "limit": 10000, "page_token": cursor,
        }
        url = build_source_url("alpaca", route, params)
        raw = fetch(url, headers)
        hashes.append(hashlib.sha256(raw).hexdigest())
        raw_responses.append(raw)
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("Alpaca returned malformed JSON") from None
        quote_rows = payload.get("quotes")
        if not isinstance(quote_rows, list):
            raise ValueError("Alpaca response does not include a quote list")
        for row in quote_rows:
            if not isinstance(row, dict) or not row.get("t"):
                raise ValueError("Alpaca returned malformed quote")
            event_time_ms = _alpaca_time_ms(str(row["t"]))
            canonical = json.dumps(row, sort_keys=True, separators=(",", ":")).encode("utf-8")
            rows.append({
                "event_time_ms": event_time_ms,
                "bid": float(row["bp"]), "ask": float(row["ap"]),
                "bid_size": float(row["bs"]), "ask_size": float(row["as"]),
                "content_sha256": hashlib.sha256(canonical).hexdigest(),
            })
        next_token = payload.get("next_page_token")
        if not next_token:
            break
        next_cursor = str(next_token)
        if next_cursor in seen or next_cursor == cursor:
            raise ValueError("pagination cursor repeated")
        seen.add(next_cursor)
        cursor = next_cursor
    else:
        raise ValueError("maximum quote page count exceeded")
    rows.sort(key=lambda row: row["event_time_ms"])
    return QuoteAcquisition(
        "alpaca", symbol, "iex", rows, hashes, raw_responses,
        start_utc.isoformat(), end_utc.isoformat(),
    )
