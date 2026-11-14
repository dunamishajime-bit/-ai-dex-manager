"""Evidence adapter regression tests; synthetic fixtures only, no trading calls."""
import csv
import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_research_replay_adapter import Source, convert

class ReplayAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
    def write(self,name,rows):
        p=self.root/name
        with p.open("w",encoding="utf-8",newline="") as fh:
            w=csv.DictWriter(fh,fieldnames=rows[0].keys())
            w.writeheader();w.writerows(rows)
        return p
    def equity(self,bad_gross=False):
        return self.write("equity.csv",[
            dict(utc="2025-10-01T00:00:00Z",compounded_mtm_equity_jpy="10000",wallet_cash_jpy="10000",crypto_gross_x="0",stock_gross_x="0",total_gross_x="0"),
            dict(utc="2025-10-01T01:00:00Z",compounded_mtm_equity_jpy="10070",wallet_cash_jpy="10000",crypto_gross_x="1",stock_gross_x="0",total_gross_x="0.2" if bad_gross else "1"),
            dict(utc="2025-10-01T02:00:00Z",compounded_mtm_equity_jpy="10150",wallet_cash_jpy="10150",crypto_gross_x="0",stock_gross_x="0",total_gross_x="0"),
        ])
    def fills(self):
        return self.write("fills.csv",[dict(
            trade_id="trade_1",strategy="V4",symbol="BTCUSDT",side="LONG",
            entry_utc="2025-10-01T01:00:00Z",exit_utc="2025-10-01T02:00:00Z",
            model_entry_price="100000",notional_jpy="10000",gross_x="1"
        )])
    def test_canonical_gross_is_used_and_position_mark_unknown(self):
        out=convert(Source(self.equity(),self.fills(),None),dict(total=3.5,crypto=3,stock=1.5),interval_minutes=60)
        self.assertEqual(len(out["frames"]),3)
        mid=out["frames"][1]
        self.assertEqual(mid["gross"]["totalX"],1)
        self.assertEqual(mid["positions"][0]["logic"],"V4")
        self.assertIsNone(mid["positions"][0]["mark"])
        self.assertIsNone(mid["positions"][0]["gross"])
        self.assertEqual(mid["positions"][0]["grossAtEntry"],1)
        self.assertIn("ENTRY",mid["events"][0])
        self.assertEqual(out["frames"][2]["positions"],[])
        self.assertEqual(out["frames"][2]["realized"],150)
        self.assertEqual(out["source"]["grossCapEvidence"],"USER_SUPPLIED_NOT_VERIFIED")
    def test_btc_candles_do_not_use_unclosed_prices(self):
        p=self.root/"btc.jsonl.gz"
        with gzip.open(p,"wt",encoding="utf-8") as fh:
            # Opening 00:00 UTC; its close is only known at 01:00 UTC.
            fh.write(json.dumps([1759276800000,"100","120","90","110","1",1759280399999])+"\n")
            fh.write(json.dumps([1759280400000,"110","135","108","125","1",1759283999999])+"\n")
        out=convert(Source(self.equity(),self.fills(),None,btc_candles=p),dict(total=3.5,crypto=3,stock=1.5))
        self.assertIsNone(out["frames"][0]["btc"])
        self.assertEqual(out["frames"][1]["btc"],110)
        self.assertEqual(out["frames"][2]["btc"],125)
        self.assertEqual(len(out["btcCandles"]),2)
        self.assertTrue(out["source"]["btcCandlesSha256"])
    def test_catalog_never_claims_current_latest_pin(self):
        fills=self.fills()
        out=convert(Source(self.equity(),fills,None),dict(total=3.5,crypto=3,stock=1.5))
        catalog=out["strategyCatalog"]
        self.assertEqual([entry["logic"] for entry in catalog],["V4"])
        self.assertEqual(catalog[0]["status"],"RESEARCH_SOURCE_UNVERIFIED")
        self.assertEqual(catalog[0]["trades"],1)

    def test_bad_gross_is_rejected(self):
        with self.assertRaisesRegex(ValueError,"Gross"):
            convert(Source(self.equity(bad_gross=True),self.fills(),None),dict(total=3.5,crypto=3,stock=1.5))
    def test_duplicate_trade_id_is_rejected(self):
        p=self.fills()
        with p.open(encoding="utf-8") as fh:
            rows=list(csv.DictReader(fh))
        self.write("fills.csv",rows+rows)
        with self.assertRaisesRegex(ValueError,"Duplicate"):
            convert(Source(self.equity(),p,None),dict(total=3.5,crypto=3,stock=1.5))

if __name__=="__main__":
    unittest.main()
