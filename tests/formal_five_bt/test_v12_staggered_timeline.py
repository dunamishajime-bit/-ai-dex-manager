"""Causal V12 parity when Aster instruments list on different dates.

The audited V12 scorer expects the same H2 array index to mean the same
completed UTC interval across BTC and every candidate. Any late-listed
coin must not feed future candles or erase BTC/other-coin opportunities.
"""
import unittest

from research.formal_five_bt.strategies import RuntimeBridge

HOUR = 3_600_000


def history(start, n, base, step):
    return [
        {"ts": start + i * HOUR,
         "open": base + step * i,
         "high": base + step * i + 2,
         "low": base + step * i - 2,
         "close": base + step * i + 0.1,
         "volume": 1000 + (i % 8) * 90, "closed": True}
        for i in range(n)
    ]


class V12StaggeredTimelineTests(unittest.TestCase):
    def test_late_listed_eth_matches_the_same_calendar_time_aligned_input(self):
        start = 1_700_000_000_000
        start -= start % (2 * HOUR)
        btc = history(start, 400, 100, 0.11)
        eth = history(start + 80 * HOUR, 320, 80, 0.10)
        interval_start = start + 250 * HOUR
        interval_end = start + 256 * HOUR
        with RuntimeBridge() as bridge:
            staggered = bridge.v12_series(
                {"BTCUSDT": btc, "ETHUSDT": eth},
                interval_start, interval_end)["results"]
            aligned = bridge.v12_series(
                {"BTCUSDT": btc[80:], "ETHUSDT": eth},
                interval_start, interval_end)["results"]
        self.assertTrue(staggered)
        self.assertEqual([x["decisionTs"] for x in staggered],
                         [x["decisionTs"] for x in aligned])
        for first, second in zip(staggered, aligned):
            self.assertEqual(first["observation"], second["observation"])
            self.assertEqual(first["signals"], second["signals"])
            self.assertLessEqual(first["observation"]["referenceTs"],
                                 first["decisionTs"])

    def test_too_new_coin_cannot_change_existing_btc_eth_decisions(self):
        start = 1_700_000_000_000
        start -= start % (2 * HOUR)
        btc = history(start, 400, 100, 0.11)
        eth = history(start + 80 * HOUR, 320, 80, 0.10)
        sol = history(start + 222 * HOUR, 178, 50, 0.09)
        with RuntimeBridge() as bridge:
            prior = bridge.v12_series(
                {"BTCUSDT": btc, "ETHUSDT": eth},
                start + 250 * HOUR, start + 256 * HOUR)["results"]
            extra = bridge.v12_series(
                {"BTCUSDT": btc, "ETHUSDT": eth, "SOLUSDT": sol},
                start + 250 * HOUR, start + 256 * HOUR)["results"]
        self.assertTrue(prior)
        self.assertEqual(
            [(row["observation"], row["signals"]) for row in prior],
            [(row["observation"], row["signals"]) for row in extra])


if __name__ == "__main__":
    unittest.main()
