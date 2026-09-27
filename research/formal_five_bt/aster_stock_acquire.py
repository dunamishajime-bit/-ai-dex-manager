"""Historical Aster stock-perpetual OHLC acquisition; no order books or LIVE access.

The V52 basis signal needs both an equity reference (Yahoo) and Aster stock
perpetual prices. Only official public market-data endpoints are used; every
available historical interval is labeled with the verified listing timestamp.
Raw and normalized price records remain in the caller's local-only data root.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, time, timezone
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Callable, Mapping

from . import sources
from .acquire import _normalize_klines
from .yahoo_v52 import STOCKS

START = date(2025, 8, 10)
END_EXCLUSIVE = date(2026, 8, 11)


def _ms(day: date) -> int:
    return int(datetime.combine(day, time.min, timezone.utc).timestamp() * 1000)


def acquire_aster_stock(
    root: Path,
    *,
    start: date = START,
    end_exclusive: date = END_EXCLUSIVE,
    get_catalog: Callable[[], Any] = lambda: sources.fetch_instrument_catalog("aster"),
    get_klines: Callable[[str, int, int], Any] = lambda symbol, start_ms, end_ms:
        sources.fetch_historical_klines("aster", symbol, start_ms, end_ms),
    get_funding: Callable[[str, int, int], Any] | None = None,
) -> dict[str, Any]:
    """Acquire only verified, already-listed stock perpetuals and hash every page."""
    if start >= end_exclusive:
        raise ValueError("ASTER_STOCK_BAD_PERIOD")
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    catalog = get_catalog()
    by_symbol = {str(row.get("symbol")): row for row in catalog.rows
                 if isinstance(row, dict) and row.get("symbol")}
    record: dict[str, Any] = {
        "provider": "ASTER_OFFICIAL_PUBLIC_FUTURES_V3", "interval": "1h",
        "period_start": start.isoformat(), "end_exclusive": end_exclusive.isoformat(),
        "catalog_sha256": list(catalog.page_hashes), "symbols": {},
        "note": "Historical stock perpetual price only; no historical book depth or verified execution",
    }
    end_ms = _ms(end_exclusive) - 1
    for ticker in sorted(STOCKS):
        native = ticker + "USDT"
        item: dict[str, Any] = {"native_instrument": native, "reference_ticker": ticker,
                                "status": "NOT_VERIFIABLE", "first_bar_ms": None,
                                "last_bar_ms": None, "bars": 0, "missing_hours_after_listing": None}
        raw = by_symbol.get(native)
        if raw is None:
            item.update(status="INSTRUMENT_NOT_IN_CURRENT_CATALOG")
            record["symbols"][ticker] = item
            continue
        try:
            verified = sources.verify_native_instrument("aster", native, raw)
        except ValueError as exc:
            item.update(status="INSTRUMENT_METADATA_UNVERIFIED", reason=str(exc)[:150])
            record["symbols"][ticker] = item
            continue
        item.update(listed_from_ms=verified.listed_from_ms,
                    listed_until_ms=verified.listed_until_ms,
                    market_status_now=verified.status)
        period_begin = max(_ms(start), verified.listed_from_ms)
        period_end = min(end_ms, (verified.listed_until_ms or end_ms))
        if period_begin > period_end:
            item["status"] = "NOT_LISTED_DURING_BACKTEST_PERIOD"
            record["symbols"][ticker] = item
            continue
        try:
            data = get_klines(native, period_begin, period_end)
            if data.source != "aster" or data.native_instrument != native or data.interval != "1h":
                raise ValueError("ASTER_STOCK_WRONG_SOURCE_OR_INSTRUMENT")
            normalized = _normalize_klines("aster", native, data.rows)
            previous_ts = -1
            for row in normalized:
                ts = int(row["event_time_ms"])
                if (ts <= previous_ts or ts < period_begin - 3_600_000 or ts > period_end
                        or row["high"] < max(row["open"], row["close"])
                        or row["low"] > min(row["open"], row["close"])
                        or min(row["open"], row["high"], row["low"], row["close"]) <= 0):
                    raise ValueError("ASTER_STOCK_INVALID_OR_NONCAUSAL_PRICE_HISTORY")
                previous_ts = ts
            raw_hashes = list(data.page_hashes)
            if len(raw_hashes) != len(data.raw_responses) or any(
                hashlib.sha256(page).hexdigest() != digest
                for page, digest in zip(data.raw_responses, raw_hashes)
            ):
                raise ValueError("ASTER_STOCK_RAW_RESPONSE_HASH_MISMATCH")
            target = root / "normalized" / "aster_stock" / "klines" / f"{native}.jsonl"
            target.parent.mkdir(parents=True, exist_ok=True)
            payload = b"".join(
                (json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
                for row in normalized
            )
            target.write_bytes(payload)
            gaps = sum((int(b["event_time_ms"]) - int(a["event_time_ms"])) // 3_600_000 - 1
                       for a, b in zip(normalized, normalized[1:]))
            item.update(
                status="AVAILABLE_WITH_GAPS" if gaps else "AVAILABLE_REQUIRES_SIGNAL_ALIGNMENT",
                bars=len(normalized),
                first_bar_ms=normalized[0]["event_time_ms"] if normalized else None,
                last_bar_ms=normalized[-1]["event_time_ms"] if normalized else None,
                missing_hours_after_listing=gaps, raw_page_hashes=raw_hashes,
                normalized_sha256=hashlib.sha256(payload).hexdigest(),
            )
            item["funding_status"] = "NOT_ACQUIRED"
            if get_funding is not None:
                try:
                    funding = get_funding(native, period_begin, period_end)
                    if funding.source != "aster" or funding.native_instrument != native:
                        raise ValueError("ASTER_STOCK_FUNDING_NATIVE_SOURCE_MISMATCH")
                    if len(funding.page_hashes) != len(funding.raw_responses) or any(
                        hashlib.sha256(raw).hexdigest() != page_sha
                        for raw, page_sha in zip(funding.raw_responses, funding.page_hashes)
                    ):
                        raise ValueError("ASTER_STOCK_FUNDING_RAW_PAGE_HASH_MISMATCH")
                    funded = []
                    prior_funding_ts = -1
                    for observed in sorted(funding.rows, key=lambda row: int(row["fundingTime"])):
                        event_ts = int(observed["fundingTime"])
                        rate = float(observed["fundingRate"])
                        if (event_ts <= prior_funding_ts or not period_begin <= event_ts <= period_end
                                or not math.isfinite(rate)):
                            raise ValueError("ASTER_STOCK_FUNDING_ROW_INVALID")
                        funded.append({
                            "source": "aster", "exchange": "ASTER", "instrument": native,
                            "event_time_ms": event_ts, "funding_rate": rate,
                        })
                        prior_funding_ts = event_ts
                    if not funded:
                        raise ValueError("ASTER_STOCK_FUNDING_HISTORY_EMPTY")
                    funding_path = root / "normalized" / "aster_stock" / "funding" / f"{native}.jsonl"
                    funding_path.parent.mkdir(parents=True, exist_ok=True)
                    funding_bytes = ("".join(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n"
                                             for row in funded)).encode()
                    funding_path.write_bytes(funding_bytes)
                    item.update(
                        funding_status="ACQUIRED_PRICE_MODEL_ONLY",
                        funding_count=len(funded),
                        funding_normalized_sha256=hashlib.sha256(funding_bytes).hexdigest(),
                        funding_raw_page_hashes=list(funding.page_hashes),
                    )
                except Exception as error:
                    item.update(funding_status="NOT_VERIFIABLE", funding_error_type=type(error).__name__)
            if not normalized:
                item["status"] = "NO_HISTORICAL_BARS"
        except Exception as exc:
            item.update(status="ACQUISITION_OR_VALIDATION_FAILED", reason=str(exc)[:180])
        record["symbols"][ticker] = item
    manifest = root / "aster-stock-hourly-coverage.json"
    manifest.write_text(json.dumps(record, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--start", type=date.fromisoformat, default=START)
    parser.add_argument("--end-exclusive", type=date.fromisoformat, default=END_EXCLUSIVE)
    args = parser.parse_args()
    result = acquire_aster_stock(
        args.data_root, start=args.start, end_exclusive=args.end_exclusive,
        get_funding=lambda symbol, start_ms, end_ms: sources.fetch_historical_funding(
            "aster", symbol, start_ms, end_ms),
    )
    print(json.dumps({"symbols": {k: {"status": v["status"], "bars": v["bars"],
                                      "listed_from_ms": v.get("listed_from_ms"),
                                      "funding_status": v.get("funding_status")}
                                  for k, v in result["symbols"].items()}}, sort_keys=True))


if __name__ == "__main__":
    main()
