import hashlib
import json
import unittest

from research.formal_five_bt.strategies import DecisionTrace, RuntimeBridge, evaluate


def bars(count: int, *, start: int = 1_700_000_000_000, interval: int = 3_600_000):
    rows = []
    price = 100.0
    for index in range(count):
        open_ts = start + index * interval
        price *= 1.001
        rows.append([open_ts, price / 1.001, price * 1.002, price * 0.998, price, 1000 + index, open_ts + interval - 1])
    return rows


class RuntimeBridgeContractTests(unittest.TestCase):
    def test_runtime_source_exports_are_hash_verified(self):
        with RuntimeBridge() as bridge:
            exported = bridge.list_exports()
        self.assertEqual(exported["runtimeSha"], "e1b58060d6263a3af7ced51bec854d3e211d2f35")
        for name in ("v12", "pengu", "q102Signal", "q102Observability", "fet", "strictPlanner"):
            self.assertIn(name, exported["exports"])

    def test_v12_trace_is_live_source_output_and_has_gate_reasons(self):
        start = 1_700_000_000_000
        start -= start % 7_200_000
        rows = [
            {"ts": start + i * 7_200_000, "endTs": start + (i + 1) * 7_200_000,
             "open": 100 + i, "high": 102 + i, "low": 99 + i, "close": 101 + i,
             "volume": 1_000 + i, "sourceCount": 2}
            for i in range(180)
        ]
        history = {"bars_by_symbol": {"BTC": rows, "ETH": rows}, "index": len(rows) - 1, "provenance_verified": True}
        with RuntimeBridge() as bridge:
            trace = evaluate("V12", "ETHUSDT", history, {}, {"as_of_ms": rows[-1]["endTs"]}, bridge=bridge)
        self.assertIsInstance(trace, DecisionTrace)
        self.assertEqual(trace.strategy_id, "V12")
        self.assertTrue(trace.gates)
        self.assertTrue(trace.source_runtime_sha == "e1b58060d6263a3af7ced51bec854d3e211d2f35")
        self.assertEqual(trace.input_sha256, hashlib.sha256(json.dumps(history, sort_keys=True, separators=(",", ":")).encode()).hexdigest())

    def test_v12_batched_series_cannot_see_future_bars(self):
        start = 1_700_000_000_000
        start -= start % 7_200_000
        history = {
            "BTCUSDT": [{"ts": start + i * 3_600_000, "open": 100 + i, "high": 102 + i, "low": 99 + i, "close": 101 + i, "volume": 1_000 + i, "closed": True} for i in range(240)],
            "ETHUSDT": [{"ts": start + i * 3_600_000, "open": 80 + i, "high": 82 + i, "low": 79 + i, "close": 81 + i, "volume": 2_000 + i, "closed": True} for i in range(240)],
        }
        with RuntimeBridge() as bridge:
            original = bridge.v12_series(history, start + 180 * 3_600_000, start + 184 * 3_600_000)["results"]
            changed = {key: [dict(row) for row in rows] for key, rows in history.items()}
            for rows in changed.values():
                for row in rows[190:]:
                    row.update({"high": row["high"] * 2, "low": row["low"] / 2, "close": row["close"] * 1.8, "volume": row["volume"] * 5})
            revised = bridge.v12_series(changed, start + 180 * 3_600_000, start + 184 * 3_600_000)["results"]
        self.assertEqual(original[0], revised[0])

    def test_pengu_returns_runtime_diagnostics_from_asof_history(self):
        def candles(series):
            return [{"openTime": row[0], "closeTime": row[6], "open": row[1], "high": row[2],
                     "low": row[3], "close": row[4], "volume": row[5]} for row in series]
        pengu = candles(bars(240))
        btc = candles(bars(240))
        history = {"pengu1h": pengu, "btc1h": btc, "as_of_ms": pengu[-1]["closeTime"] + 1, "provenance_verified": True}
        with RuntimeBridge() as bridge:
            trace = evaluate("PENGU", "PENGUUSDT", history, {}, {"as_of_ms": history["as_of_ms"]}, bridge=bridge)
        self.assertEqual(trace.strategy_id, "PENGU")
        self.assertTrue(trace.gates)
        self.assertIn("runtime", trace.raw_result)

    def test_pengu_promoted_trade_outcome_batch_uses_audited_runtime(self):
        def candles(series):
            return [{"openTime": row[0], "closeTime": row[6], "open": row[1], "high": row[2],
                     "low": row[3], "close": row[4], "volume": row[5]} for row in series]
        pengu = candles(bars(500))
        btc = candles(bars(500))
        with RuntimeBridge() as bridge:
            result = bridge.pengu_trade_outcomes(
                {"pengu1h": pengu, "btc1h": btc, "penguFunding": []},
                pengu[-1]["closeTime"] + 1)
        self.assertEqual(result["runtimeSha"], "e1b58060d6263a3af7ced51bec854d3e211d2f35")
        self.assertTrue(result["recoveryV8Enabled"])
        self.assertEqual(result["candidateCount"], len(result["candidates"]))
        for candidate in result["candidates"]:
            self.assertIn(candidate["entryVersion"], {"SHORT_V20", "LONG_V2_FINAL", "RECOVERY_V8"})
            self.assertGreater(candidate["entryPrice"], 0)
            self.assertGreater(candidate["targetGross"], 0)
            self.assertIn(candidate["side"], {"LONG", "SHORT"})
            self.assertEqual(candidate["sourceRuntimeSha"], result["runtimeSha"])

    def test_q102_requires_exact_current_entry_open_and_causal_cutoff(self):
        decision_ts = 1_700_000_000_000
        entry_ts = decision_ts - decision_ts % 3_600_000
        raw_rows = bars(4_500, start=entry_ts - 4_500 * 3_600_000)
        rows = [{"timestampMs": row[0], "open": row[1], "high": row[2], "low": row[3], "close": row[4], "quoteVolume": row[5], "baseVolume": row[5] / row[4]} for row in raw_rows]
        history = {
            "candlesBySymbol": {"BTCUSDT": rows, "SUIUSDT": rows},
            "entryOpenBySymbol": {"BTCUSDT": {"timestampMs": entry_ts, "open": rows[-1]["close"]}, "SUIUSDT": {"timestampMs": entry_ts, "open": rows[-1]["close"]}},
        }
        with RuntimeBridge() as bridge:
            symbols = ["SUIUSDT"]
            trace = evaluate("Q102", "SUIUSDT", {"history": history, "decisionTs": decision_ts, "highVolSymbols": symbols, "symbols": symbols, "provenance_verified": True}, {"highVolSymbols": symbols, "symbols": symbols}, {"as_of_ms": decision_ts}, bridge=bridge)
        self.assertEqual(trace.strategy_id, "Q102")
        self.assertLessEqual(trace.data_cutoff_ms, decision_ts)
        self.assertTrue(trace.gates)

    def test_q102_series_activates_symbols_only_after_point_in_time_history_exists(self):
        hour = 3_600_000
        start = 1_700_000_000_000
        start -= start % hour
        def rows(count, offset=0):
            output = []
            price = 100.0
            for i in range(count):
                ts = start + (i + offset) * hour
                price *= 1.0005
                output.append({"timestampMs": ts, "open": price, "high": price * 1.01,
                               "low": price * 0.99, "close": price * 1.001,
                               "quoteVolume": 1_000_000, "baseVolume": 10_000})
            return output
        btc = rows(420)
        early = rows(420)
        late = rows(60, offset=360)
        with RuntimeBridge() as bridge:
            result = bridge.q102_series(
                {"BTCUSDT": btc, "SUIUSDT": early, "LATEUSDT": late},
                ["SUIUSDT", "LATEUSDT"], ["SUIUSDT", "LATEUSDT"],
                start + 336 * hour, start + 419 * hour)
        self.assertTrue(result)
        self.assertTrue(any("SUIUSDT" in row.get("availableSymbols", []) for row in result))
        self.assertTrue(all("LATEUSDT" not in row.get("availableSymbols", [])
                            for row in result[:20]))
        self.assertFalse(any("error" in row and "ENTRY_OPEN_MISSING:LATEUSDT" in row["error"]
                             for row in result))

    def test_fet_gate_evaluation_uses_only_completed_prior_bars(self):
        raw = bars(100)
        history = {"bars": raw, "provenance_verified": True}
        with RuntimeBridge() as bridge:
            trace = evaluate("FET", "FETUSDT", history, {}, {"as_of_ms": raw[-1][-1]}, bridge=bridge)
        self.assertEqual(trace.strategy_id, "FET")
        self.assertTrue(trace.gates)
        self.assertLessEqual(trace.data_cutoff_ms, raw[-1][-1])


if __name__ == "__main__":
    unittest.main()
