import tempfile
import unittest
from pathlib import Path
from research.formal_five_bt.seven_sidecar_scan import (
    FIFTEEN, MINUTE, to_bar, check_contiguous, fifteen_minute_gates,
    canonical, save, read_rows, save_jsonl,
)

class SidecarScanContract(unittest.TestCase):
    def setUp(self):
        self.rules={"btcMinMoveBps":3,"btcMinAccelBps":-1,"btcMaxMoveBps":45,
            "symbolMinMoveBps":8,"symbolMinAccelBps":-1,
            "symbolMaxDistanceBps":120,"breakoutBps":8,"breakoutConfirmMinutes":5}
    def rows(self,prices,ts=1_700_000_100_000):
        origin=ts-ts%FIFTEEN
        return [{"ts":origin+i*FIFTEEN,"open":p,"high":p*1.001,
            "low":p*.999,"close":p,"volume":100} for i,p in enumerate(prices)]
    def test_native_15m_1m_parser_rejects_fake_or_negative_prices(self):
        with self.assertRaisesRegex(ValueError,"OHLC_INVALID"):
            to_bar([900000,1,0.5,0.1,2,100],FIFTEEN)
        with self.assertRaisesRegex(ValueError,"TIMESTAMP"):
            to_bar([900123,1,1.2,0.9,1,100],FIFTEEN)
        self.assertEqual(to_bar([900000,"1","1.2","0.9","1","10"],FIFTEEN)["volume"],10)
    def test_15m_gate_runs_on_completed_aligned_history(self):
        a=self.rows([100,100.2,100.4,100.6,100.8])
        b=self.rows([50,50.11,50.23,50.36,50.5])
        ok,check=fifteen_minute_gates(a,b,self.rules,
            entry_ts=b[-1]["ts"]+FIFTEEN)
        self.assertTrue(ok,check)
        self.assertTrue("EMA20_DISTANCE" in check)
        b[-1]["ts"]+=MINUTE
        ok,check=fifteen_minute_gates(a,b,self.rules,
            entry_ts=b[-1]["ts"]+FIFTEEN)
        self.assertFalse(ok)
        self.assertEqual(check["DATA"],"BTC_SYMBOL_15M_NOT_ALIGNED")
    def test_gap_in_15m_window_is_not_allowed_as_false_zero(self):
        a=self.rows([100,100.2,100.4,100.6])
        b=self.rows([50,50.2,50.4,50.6])
        a[-2]["ts"]+=MINUTE
        ok,detail=fifteen_minute_gates(a,b,self.rules,
            entry_ts=b[-1]["ts"]+FIFTEEN)
        self.assertFalse(ok)
        self.assertEqual(detail["DATA"],"15M_SERIES_GAP")
    def test_outputs_are_repeatable_and_have_exact_hash(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"decisions"/"HYPE.jsonl"
            records=[{"strategy":"HYPE","reason":"未取得","status":"NOT_VERIFIABLE"}]
            count,expected=save_jsonl(path,records)
            self.assertEqual(count,1)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),expected)
            self.assertEqual(read_rows(path),records)

if __name__=="__main__":unittest.main()
