from __future__ import annotations

import unittest
from datetime import date, datetime, timezone
from unittest.mock import Mock
import hashlib

from research.formal_five_bt.calendars import is_nyse_core_open, nyse_close_utc
from research.formal_five_bt.sources import (
    SUPPORTED_SOURCES,
    alpaca_iex_quote_headers,
    build_source_url,
    fetch_alpaca_iex_quotes,
    fetch_fred_dexjpus,
    fetch_historical_funding,
    fetch_historical_klines,
    fetch_crypto_hft_orderbook,
    map_native_instrument,
    paginate_json,
    fetch_instrument_catalog,
    verify_native_instrument,
)


class SourceAndCalendarTests(unittest.TestCase):
    def test_source_hosts_are_allowlisted_and_secret_query_fields_are_rejected(self) -> None:
        self.assertIn("aster", SUPPORTED_SOURCES)
        url = build_source_url("aster", "/fapi/v3/klines", {"symbol": "BTCUSDT", "limit": 2})
        self.assertTrue(url.startswith("https://fapi.asterdex.com/"))
        with self.assertRaisesRegex(ValueError, "unsupported source route"):
            build_source_url("aster", "https://example.com/steal", {})
        with self.assertRaisesRegex(ValueError, "secret-like query field"):
            build_source_url("aster", "/fapi/v3/klines", {"apiKey": "must-not-appear"})

    def test_cursor_pagination_is_deterministic_and_detects_repeated_cursor(self) -> None:
        fetch = Mock(side_effect=[
            ({"rows": [1, 2], "next": "p2"}, b"page-one"),
            ({"rows": [3], "next": None}, b"page-two"),
        ])
        result = paginate_json(fetch, initial_cursor=None, rows_key="rows", next_key="next")
        self.assertEqual(result.rows, [1, 2, 3])
        self.assertEqual(len(result.page_hashes), 2)

        repeated = Mock(return_value=({"rows": [1], "next": "same"}, b"repeat"))
        with self.assertRaisesRegex(ValueError, "pagination cursor repeated"):
            paginate_json(repeated, initial_cursor="same", rows_key="rows", next_key="next", max_pages=3)

    def test_native_symbol_mapping_requires_exact_linear_perpetual_contract(self) -> None:
        mapping = map_native_instrument("okx", "BTCUSDT", "BTC-USDT-SWAP", "linear_perpetual")
        self.assertEqual(mapping.native_instrument, "BTC-USDT-SWAP")
        self.assertTrue(mapping.same_underlying)
        with self.assertRaisesRegex(ValueError, "contract-type mismatch"):
            map_native_instrument("okx", "BTCUSDT", "BTC-USDT", "spot")
        with self.assertRaisesRegex(ValueError, "unsupported cross-venue mapping"):
            map_native_instrument("okx", "BTCUSDT", "BTC-USD-SWAP", "linear_perpetual")
        with self.assertRaisesRegex(ValueError, "contract-type mismatch"):
            map_native_instrument("okx", "BTCUSDT", "BTC-USDT", "spot")

    def test_official_nyse_holidays_and_early_closes_are_applied(self) -> None:
        self.assertFalse(is_nyse_core_open(datetime(2025, 11, 27, 16, tzinfo=timezone.utc)))
        self.assertFalse(is_nyse_core_open(datetime(2026, 1, 19, 16, tzinfo=timezone.utc)))
        early_close = nyse_close_utc(date(2025, 11, 28))
        self.assertEqual(early_close.isoformat(), "2025-11-28T18:00:00+00:00")
        self.assertFalse(is_nyse_core_open(early_close))
        self.assertTrue(is_nyse_core_open(datetime(2025, 11, 28, 17, 30, tzinfo=timezone.utc)))

    def test_stock_perpetual_history_is_not_inferred_from_equity_quotes(self) -> None:
        with self.assertRaisesRegex(ValueError, "stock perpetual listing must be independently verified"):
            map_native_instrument("aster", "NVDAUSDT", "NVDAUSDT", "stock_perpetual", equity_quote_only=True)

    def test_native_contract_status_and_listing_are_independently_verified(self) -> None:
        listing = verify_native_instrument("bybit", "BTCUSDT", {
            "symbol": "BTCUSDT", "contractType": "LinearPerpetual", "settleCoin": "USDT",
            "status": "Trading", "launchTime": "1700000000000",
        })
        self.assertEqual(listing.listed_from_ms, 1_700_000_000_000)
        self.assertEqual(listing.contract_type, "linear_perpetual")
        with self.assertRaisesRegex(ValueError, "not a USDT linear perpetual"):
            verify_native_instrument("okx", "BTC-USDT-SWAP", {
                "instId": "BTC-USDT-SWAP", "ctType": "inverse", "settleCcy": "BTC",
                "state": "live", "listTime": "1700000000000",
            })
        with self.assertRaisesRegex(ValueError, "metadata does not verify listing time"):
            verify_native_instrument("binance", "BTCUSDT", {
                "symbol": "BTCUSDT", "contractType": "PERPETUAL", "quoteAsset": "USDT", "status": "TRADING",
            })

    def test_instrument_catalog_retains_hashes_and_follows_bybit_cursor(self) -> None:
        calls = []
        def request(source: str, route: str, params: dict[str, object]):
            calls.append((source, route, dict(params)))
            if params.get("cursor") is None:
                payload = {"retCode": 0, "result": {"list": [{"symbol": "BTCUSDT"}], "nextPageCursor": "next"}}
                raw = b"bybit-page-1"
            else:
                payload = {"retCode": 0, "result": {"list": [{"symbol": "ETHUSDT"}], "nextPageCursor": ""}}
                raw = b"bybit-page-2"
            return payload, raw

        catalog = fetch_instrument_catalog("bybit", request_json=request)
        self.assertEqual([row["symbol"] for row in catalog.rows], ["BTCUSDT", "ETHUSDT"])
        self.assertEqual(len(catalog.page_hashes), 2)
        self.assertEqual(calls[1][2]["cursor"], "next")

    def test_proxy_l2_archive_uses_allowlisted_contract_path_and_preserves_raw_hash(self) -> None:
        hour = datetime(2025, 8, 10, 0, tzinfo=timezone.utc)
        captured = {}
        def fetch(url: str) -> bytes:
            captured["url"] = url
            return b"sample-parquet-bytes"

        result = fetch_crypto_hft_orderbook("binance_futures", "BTCUSDT", hour, fetch=fetch)
        self.assertEqual(result.status, "AVAILABLE")
        self.assertEqual(result.content_sha256, hashlib.sha256(b"sample-parquet-bytes").hexdigest())
        self.assertIn("binance_futures%2F2025-08-10%2F00%2FBTCUSDT_orderbook.parquet", captured["url"])
        with self.assertRaisesRegex(ValueError, "unsupported proxy exchange"):
            fetch_crypto_hft_orderbook("unknown", "BTCUSDT", hour, fetch=fetch)
        with self.assertRaisesRegex(ValueError, "hour boundary"):
            fetch_crypto_hft_orderbook("binance_futures", "BTCUSDT", hour.replace(minute=1), fetch=fetch)

    def test_funding_acquisition_covers_range_without_overlapping_or_skipping_pages(self) -> None:
        hour = 3_600_000
        calls = []

        def request(source: str, route: str, params: dict[str, object]):
            calls.append((source, route, dict(params)))
            if params["startTime"] == 0:
                rows = [{"symbol": "BTCUSDT", "fundingTime": 0, "fundingRate": "0.001"}]
            else:
                rows = [{"symbol": "BTCUSDT", "fundingTime": hour, "fundingRate": "-0.001"}]
            return rows, f"page-{params['startTime']}".encode()

        result = fetch_historical_funding("aster", "BTCUSDT", 0, hour, request_json=request)
        self.assertEqual([row["fundingTime"] for row in result.rows], [0, hour])
        self.assertEqual(len(result.page_hashes), 2)
        self.assertEqual(calls[1][2]["startTime"], 1)

    def test_aster_and_okx_historical_klines_are_paginated_and_hash_raw_pages(self) -> None:
        hour = 3_600_000
        aster_fetch = Mock(side_effect=[
            ([
                [0, "10", "11", "9", "10", "1"],
                [hour, "10", "11", "9", "10", "1"],
            ], b"aster-one"),
            ([[2 * hour, "10", "11", "9", "10", "1"]], b"aster-two"),
        ])
        acquired = fetch_historical_klines(
            "aster", "BTCUSDT", 0, 2 * hour, request_json=aster_fetch,
        )
        self.assertEqual([row[0] for row in acquired.rows], [0, hour, 2 * hour])
        self.assertEqual(acquired.page_hashes, [hashlib.sha256(b"aster-one").hexdigest(), hashlib.sha256(b"aster-two").hexdigest()])
        self.assertEqual(aster_fetch.call_args_list[0].args[1], "/fapi/v3/klines")

        okx_fetch = Mock(side_effect=[
            ({"code": "0", "data": [
                [str(3 * hour), "10", "11", "9", "10", "1", "10", "10", "1"],
                [str(2 * hour), "10", "11", "9", "10", "1", "10", "10", "1"],
            ]}, b"okx-one"),
            ({"code": "0", "data": [
                [str(hour), "10", "11", "9", "10", "1", "10", "10", "1"],
                ["0", "10", "11", "9", "10", "1", "10", "10", "1"],
            ]}, b"okx-two"),
        ])
        okx = fetch_historical_klines(
            "okx", "BTC-USDT-SWAP", 0, 3 * hour, request_json=okx_fetch,
        )
        self.assertEqual([row[0] for row in okx.rows], ["0", str(hour), str(2 * hour), str(3 * hour)])
        self.assertEqual(okx_fetch.call_args_list[0].args[2]["after"], 3 * hour + 1)
        self.assertNotIn("before", okx_fetch.call_args_list[0].args[2])

    def test_official_usdjpy_full_series_fallback_is_pinned_and_asof_safe(self) -> None:
        import hashlib
        from unittest.mock import patch
        primary_urls = []
        full = b"observation_date,DEXJPUS\\n2025-08-08,147.25\\n2025-08-10,148.5\\n2026-09-01,220\\n"
        def sample(url):
            primary_urls.append(url)
            if "?id=DEXJPUS" in url:
                return full
            raise RuntimeError("BOUNDED_COSD_QUERY_FAILED")
        from research.formal_five_bt import sources
        with patch.object(sources, "fetch_bytes", side_effect=sample):
            result = sources.fetch_fred_dexjpus(date(2025, 8, 8), date(2025, 8, 11))
        self.assertEqual(len(result.observations), 2)
        self.assertEqual(result.observations[0]["rate_jpy_per_usd"], 147.25)
        self.assertEqual(result.raw_sha256, hashlib.sha256(full).hexdigest())
        self.assertIn("id=DEXJPUS", result.source_url)

    def test_official_fed_h10_last_fallback_can_supply_verified_jpy_only(self) -> None:
        import hashlib
        from unittest.mock import patch
        # The real H10 package has metadata before the Time Period header.
        package = ("Unit: ,Japanese Yen,Other\\n"
                   "Time Period,RXI_N.B.JA,RXI_N.B.AL\\n"
                   "2025-08-08,147.25,0.5\\n"
                   "2025-08-11,147.80,0.6\\n").encode("utf-8")
        from research.formal_five_bt import sources
        def only_fed(url):
            if "federalreserve.gov" not in url:
                raise RuntimeError("FRED_TRANSPORT_DOWN")
            return package
        with patch.object(sources, "fetch_bytes", side_effect=only_fed):
            result = sources.fetch_fred_dexjpus(date(2025, 8, 8), date(2025, 8, 11))
        self.assertEqual(len(result.observations), 2)
        self.assertTrue(result.source_url.startswith("https://www.federalreserve.gov"))
        self.assertEqual(result.observations[-1]["rate_jpy_per_usd"],147.8)

    def test_fred_rates_keep_response_hash_and_ignore_missing_observations(self) -> None:
        raw = b"observation_date,DEXJPUS\n2025-08-10,147.25\n2025-08-11,.\n"
        result = fetch_fred_dexjpus(date(2025, 8, 10), date(2025, 8, 11), fetch=lambda _url: raw)
        self.assertEqual(len(result.observations), 1)
        self.assertEqual(result.observations[0]["rate_jpy_per_usd"], 147.25)
        self.assertEqual(result.response_sha256, hashlib.sha256(raw).hexdigest())
        self.assertEqual(result.observations[0]["event_time_ms"] % 86_400_000, 86_399_999)

    def test_alpaca_historical_quotes_use_iex_pagination_and_header_auth(self) -> None:
        headers = alpaca_iex_quote_headers({
            "ALPACA_DATA_API_KEY": "private-test-key",
            "ALPACA_DATA_API_SECRET": "private-test-secret",
            "ALPACA_DATA_FEED": "iex",
        })
        pages = [
            b'{"quotes":[{"t":"2025-08-10T13:30:00Z","bp":100,"ap":101,"bs":2,"as":3}],"next_page_token":"page-2"}',
            b'{"quotes":[{"t":"2025-08-10T13:30:01Z","bp":101,"ap":102,"bs":3,"as":4}],"next_page_token":null}',
        ]
        seen_headers: list[dict[str, str]] = []
        seen_urls: list[str] = []

        def fetch(url: str, request_headers: dict[str, str]) -> bytes:
            seen_urls.append(url)
            seen_headers.append(dict(request_headers))
            return pages.pop(0)

        result = fetch_alpaca_iex_quotes(
            "SPY", datetime(2025, 8, 10, tzinfo=timezone.utc),
            datetime(2025, 8, 11, tzinfo=timezone.utc), headers=headers, request=fetch,
        )
        self.assertEqual(len(result.rows), 2)
        self.assertEqual(result.feed, "iex")
        self.assertEqual(len(result.page_hashes), 2)
        self.assertTrue(all("page_token" not in url.split("?")[-1] or "page_token=page-2" in url for url in seen_urls))
        self.assertEqual(seen_headers[0]["APCA-API-KEY-ID"], "private-test-key")
        self.assertNotIn("private-test-key", seen_urls[0])


if __name__ == "__main__":
    unittest.main()
