import json,unittest
from pathlib import Path
R=Path(__file__).resolve().parent
class DataParityFailClosed(unittest.TestCase):
    def test_q102_early_history_missing(self):
        a=json.loads((R/"P107_Q102_PIN_S34_EXACT_SYMBOL_COVERAGE_20261122.json").read_text(encoding="utf8"))
        self.assertEqual(len(a["S34_symbols"]),11)
        self.assertEqual(a["S34_missing_required_181d_prewarm_asof_2025_10_01"],["FETUSDT","LDOUSDT","RENDERUSDT"])
        self.assertFalse(a["full_STABLE4_parity"])
    def test_ohlc_fail_closed(self):
        a=json.loads((R/"P107_Q102_NATIVE_PIN_INVALID_OHLC_AUDIT_20261122.json").read_text(encoding="utf8"))
        self.assertEqual(a["badSymbols"],["BTCUSDT"])
        self.assertEqual(a["rowsBySymbol"]["BTCUSDT"]["invalidOHLCCount"],1)
    def test_official_api_confirms_invalid_ohlc(self):
        a=json.loads((R/"P107_OFFICIAL_ASTER_BTC_INVALID_BAR_CROSSCHECK_20261122.json").read_text(encoding="utf8"))
        e=a["endpoints"];self.assertEqual(len(e),2)
        self.assertEqual(e[0]["response_sha256"],e[1]["response_sha256"])
        for z in e:
            self.assertEqual(z["http_status"],200)
            self.assertFalse(z["ohlc_valid"])
    def test_official_missing_early_bars(self):
        a=json.loads((R/"P107_Q102_OFFICIAL_EARLY_H1_AVAILABILITY_PROBE_20261122.json").read_text(encoding="utf8"))
        self.assertEqual(len(a["rows"]),6)
        self.assertEqual({r["symbol"] for r in a["rows"]},{"FETUSDT","LDOUSDT","RENDERUSDT"})
        self.assertTrue(all(r.get("httpCode")==200 and r.get("rows")==0 for r in a["rows"]))
    def test_direct_native_source_fails_closed_then_runs(self):
        a=json.loads((R/"P107_Q102_NATIVE_SAMPLE_ASOF_NEGATIVE_POSITIVE_20261122.json").read_text(encoding="utf8"))
        self.assertTrue(a["expectedNegativeAndPositiveControlsPass"])
        self.assertEqual(a["results"][0]["error"],"QUALITY102_INVALID_CANDLE")
        self.assertEqual(a["results"][1]["status"],"PIN_SOURCE_CALLED")
        self.assertFalse(a["p107FullParity"])
if __name__=="__main__":unittest.main()
