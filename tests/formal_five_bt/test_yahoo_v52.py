import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from urllib.error import HTTPError
from zoneinfo import ZoneInfo

from research.formal_five_bt.market_data import FxRate
from research.formal_five_bt.yahoo_v52 import (
    PROXY_ID,TICKERS,YahooSourceBlocked,clean_bar,download_chart,parse_chart,replay,signals,
)
NY=ZoneInfo("America/New_York")
def fixture_day(day=(2025,8,11)):
    values={
      "AMZN":[101,100.1,100,100,100,100],
      "TSLA":[100.2,100.8,100,100,100,100],
    }
    data={}
    for symbol in TICKERS:
        closes=values.get(symbol,[100.1,100.2,100.1,100,100,100])
        bars=[]
        for i,hour in enumerate((9,10,11,12,13,14)):
            start=int(datetime(*day,hour,30,tzinfo=NY).timestamp()*1000)
            price=closes[i];before=100 if i==0 else closes[i-1]
            bar=clean_bar(symbol,start,{"open":before,"high":max(before,price),
                 "low":min(before,price),"close":price,"volume":1500})
            assert bar is not None
            bars.append(bar)
        data[symbol]=bars
    return data

def fx():
    at=int(datetime(2025,8,9,tzinfo=timezone.utc).timestamp()*1000)
    return [FxRate("ECB","USDJPY_ECB_CROSS","daily_reference",at,at,at,"a"*64,150.)]

class YahooV52Tests(unittest.TestCase):
    def test_yahoo_429_does_not_use_another_provider_or_fake_data(self):
        with patch("urllib.request.urlopen",side_effect=HTTPError("u",429,"Too Many Requests",{},None)):
            with self.assertRaisesRegex(YahooSourceBlocked,"YAHOO_ACCESS_BLOCKED_HTTP_429"):
                download_chart("AMZN")
    def test_yahoo_chart_schema_requires_hourly_usd_new_york_and_completed_bars(self):
        t=int(datetime(2025,8,11,9,30,tzinfo=NY).timestamp())
        result={"meta":{"exchangeTimezoneName":"America/New_York","dataGranularity":"60m","currency":"USD"},
          "timestamp":[t,t+3600],"indicators":{"quote":[{
           "open":[100,101],"high":[102,102],"low":[99,100],"close":[101,100],"volume":[1000,2000]}]}}
        raw=json.dumps({"chart":{"error":None,"result":[result]}}).encode()
        rows,info=parse_chart("AMZN",raw)
        self.assertEqual(info["status"],"ACQUIRED")
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0].start_ny,"09:30")
        self.assertEqual(rows[0].end_ms,int(datetime(2025,8,11,10,30,tzinfo=NY).timestamp()*1000))
        result["meta"]["currency"]="JPY"
        with self.assertRaisesRegex(ValueError,"YAHOO_NON_USD"):
            parse_chart("AMZN",json.dumps({"chart":{"error":None,"result":[result]}}).encode())
    def test_v11_entry_at_yahoo_1030_close_and_v50_at_1130(self):
        candles=fixture_day()
        choices,issues=signals(candles,20)
        v11=[x for x in choices if x.slot=="V11_EQ"]
        self.assertEqual(len(v11),1)
        self.assertEqual(v11[0].symbol,"AMZN")
        self.assertEqual(v11[0].side,"SHORT")
        self.assertEqual(v11[0].entry_ms,candles["AMZN"][0].end_ms)
        self.assertEqual(v11[0].entry_price,candles["AMZN"][0].close)
        self.assertEqual(v11[0].model_id,PROXY_ID)
        self.assertTrue(any(x.slot=="V50_POST_OPEN_BASIS" and x.symbol=="TSLA" and
                            x.entry_ms==candles["TSLA"][1].end_ms for x in choices))
    def test_assumed_same_price_execution_is_not_reported_as_historical_aster_fill(self):
        data=fixture_day()
        result=replay(data,fx(),20.)
        self.assertFalse(result["orderbook_required"])
        self.assertFalse(result["actual_aster_basis_measured"])
        self.assertFalse(result["historical_exact_fills_verified"])
        self.assertTrue(result["independent_stock_only_not_shared_five_logic"])
        self.assertGreaterEqual(result["modeled_completed_trades"],2)
        self.assertEqual(result["contributions_jpy"],10000)
        self.assertGreaterEqual(len(result["monthly"]),1)
        for row in result["ledger"]:
            self.assertEqual(row["model_id"],PROXY_ID)
            self.assertGreater(row["exit_ms"],row["entry_ms"])
            self.assertIn("EXACT_YAHOO_COMPLETED_60M_CLOSE",row["fill_assumption"])
    def test_missing_five_stock_window_does_not_manufacture_a_top1(self):
        data=fixture_day()
        del data["META"]
        choices,issues=signals(data,20.)
        self.assertEqual(choices,[])
        self.assertGreater(issues["INCOMPLETE_FIVE_STOCK_0930_OPEN"],0)
    def test_cost_assumptions_change_signal_gate_without_invented_real_venue_fee(self):
        data=fixture_day()
        normal,_=signals(data,20.)
        severe,_=signals(data,60.)
        self.assertLessEqual(len(severe),len(normal))
        self.assertTrue(all(c.model_id==PROXY_ID for c in normal))
    def test_official_nyse_early_close_is_enforced(self):
        t=int(datetime(2025,11,28,12,30,tzinfo=NY).timestamp()*1000)
        row={"open":100,"high":101,"low":99,"close":100,"volume":100}
        result=clean_bar("AMZN",t,row)
        self.assertEqual(result.end_ms,int(datetime(2025,11,28,13,0,tzinfo=NY).timestamp()*1000))
        after=int(datetime(2025,11,28,13,30,tzinfo=NY).timestamp()*1000)
        self.assertIsNone(clean_bar("AMZN",after,row))
if __name__=="__main__":unittest.main()
