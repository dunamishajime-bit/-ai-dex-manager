import dataclasses
import unittest

from research.formal_five_bt.execution import (
    HistoricalBook,
    funding_cashflow,
    limit_order_fill,
    market_order_fill,
    resolve_ohlc_exit,
)


class ExecutionModelTests(unittest.TestCase):
    def setUp(self):
        self.book = HistoricalBook(
            source="Aster archived L2", exchange="ASTER", instrument_id="BTCUSDT",
            event_time_ms=10_000, received_time_ms=10_001,
            bids=((99.0, 1.0), (98.0, 2.0)), asks=((101.0, 0.5), (102.0, 2.0)),
            sequence_verified=True, snapshot_verified=True, content_sha256="a" * 64,
        )

    def test_market_buy_walks_visible_depth_and_reports_slippage(self):
        result = market_order_fill("BUY", 1.0, self.book, decision_time_ms=10_002,
                                   expected_instrument="BTCUSDT", max_age_ms=10)
        self.assertEqual(result.status, "FILLED")
        self.assertAlmostEqual(result.average_price, 101.5)
        self.assertAlmostEqual(result.slippage_bps, (101.5 / 100 - 1) * 10_000)

    def test_missing_stale_future_mismatched_and_unseeded_books_never_fill(self):
        args = dict(decision_time_ms=20_000, expected_instrument="BTCUSDT", max_age_ms=100)
        cases = [
            (None, "BOOK_MISSING"),
            (dataclasses.replace(self.book, event_time_ms=19_000), "BOOK_STALE"),
            (dataclasses.replace(self.book, event_time_ms=20_001), "BOOK_LOOKAHEAD"),
            (dataclasses.replace(self.book, instrument_id="ETHUSDT"), "BOOK_INSTRUMENT_MISMATCH"),
            (dataclasses.replace(self.book, snapshot_verified=False), "BOOK_SNAPSHOT_OR_SEQUENCE_UNVERIFIED"),
        ]
        for book, reason in cases:
            with self.subTest(reason=reason):
                result = market_order_fill("BUY", 0.1, book, **args)
                self.assertEqual(result.status, "BLOCKED")
                self.assertEqual(result.reason, reason)

    def test_insufficient_depth_blocks_complete_fill(self):
        result = market_order_fill("SELL", 4.0, self.book, decision_time_ms=10_002,
                                   expected_instrument="BTCUSDT", max_age_ms=10)
        self.assertEqual(result.status, "BLOCKED")
        self.assertEqual(result.reason, "INSUFFICIENT_VISIBLE_DEPTH")
        self.assertLess(result.filled_quantity, result.quantity)

    def test_post_only_order_requires_verified_trade_through(self):
        self.assertEqual(limit_order_fill(trade_through_verified=False, trade_through_price=None),
                         ("NOT_FILLED", "QUEUE_POSITION_UNVERIFIED", None))
        self.assertEqual(limit_order_fill(trade_through_verified=True, trade_through_price=100.0),
                         ("FILLED", "VERIFIED_TRADE_THROUGH", 100.0))

    def test_stop_wins_when_same_ohlc_bar_touches_stop_and_target(self):
        result = resolve_ohlc_exit("LONG", bar_open=100, bar_high=112, bar_low=88,
                                   bar_close=105, stop_price=90, target_price=110)
        self.assertEqual(result.exit_price, 90)
        self.assertTrue(result.ambiguous_bar)
        self.assertEqual(result.reason, "STOP_ADVERSE_AMBIGUOUS")

    def test_short_exit_and_funding_sign(self):
        result = resolve_ohlc_exit("SHORT", bar_open=100, bar_high=111, bar_low=89,
                                   bar_close=99, stop_price=110, target_price=90)
        self.assertEqual(result.exit_price, 110)
        self.assertTrue(result.ambiguous_bar)
        self.assertEqual(funding_cashflow(1_000, "LONG", 0.001), -1.0)
        self.assertEqual(funding_cashflow(1_000, "SHORT", 0.001), 1.0)


if __name__ == "__main__":
    unittest.main()
