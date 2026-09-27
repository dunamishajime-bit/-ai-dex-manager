from datetime import date,datetime,timezone
import unittest
from zoneinfo import ZoneInfo
from research.formal_five_bt.v52_yahoo import (
    HourOpen,SOURCE,SYMBOLS,_ts,observe,yahoo_chart_to_opens,aster_stock_h1_to_opens,
    replay_yahoo_v52,_decision,_modeled_exit,PERIOD_START,
)

NY=ZoneInfo("America/New_York")
D=date(2026,3,9)  # Monday immediately after spring-forward, local NY clock
def ybars(day,symbol,price):
    out=[]
    for h in range(9,16):
        # 09:30 and 10:30 etc are the only observed Yahoo 60m bar opens.
        at=_ts(day,h,30)
        out.append(HourOpen(symbol,at,price,price*5,price*.5,price,SOURCE))
    return tuple(out)
def abars(day,symbol,price):
    out=[]
    for h in range(9,16):
        at=_ts(day,h,0)
        out.append(HourOpen(symbol,at,price,price,price,price,"ASTER_NATIVE_STOCK_PERP_H1_OPEN"))
    return tuple(out)
def provider(symbol="AMZN",day=D):
    stamps=[_ts(day,h,30) for h in range(9,16)]
    return {"chart":{"error":None,"result":[{"meta":{"symbol":symbol,"currency":"USD",
        "exchangeTimezoneName":"America/New_York","dataGranularity":"60m"},
      "timestamp":stamps,"indicators":{"quote":[{"open":[100]*7,"high":[600]*7,
          "low":[50]*7,"close":[500]*7}]},"events":{}}]}}
class YahooV52Tests(unittest.TestCase):
    def test_yahoo_point_in_time_uses_bar_open_never_future_high(self):
        bars=yahoo_chart_to_opens(provider(),"AMZN")
        self.assertEqual(observe(bars,abars(D,"AMZN",101),_ts(D,10,0))["yahoo_ref"],100.)
        self.assertAlmostEqual(observe(bars,abars(D,"AMZN",101),_ts(D,10,0))["basis_bps"],100.)
        self.assertEqual(bars[0].high,600.)
        self.assertEqual(bars[0].close,500.)
    def test_yahoo_refuses_daily_adjusted_or_mixed_currency_data(self):
        for key,val in (("currency","JPY"),("dataGranularity","1d"),("exchangeTimezoneName","UTC")):
            raw=provider()
            raw["chart"]["result"][0]["meta"][key]=val
            with self.assertRaises(ValueError):yahoo_chart_to_opens(raw,"AMZN")
    def test_yahoo_split_events_require_explicit_reconciliation(self):
        raw=provider()
        raw["chart"]["result"][0]["events"]={"splits":{"123":{"date":123,"numerator":2,"denominator":1}}}
        with self.assertRaisesRegex(ValueError,"SPLIT"):yahoo_chart_to_opens(raw,"AMZN")
    def test_v11_and_v50_explicit_stock_perp_basis_are_assumed_fills(self):
        stocks={s:ybars(D,s,100) for s in SYMBOLS}
        perps={s:abars(D,s,101 if s=="AMZN" else 100) for s in SYMBOLS}
        # Separate V50 opportunity on META emerges after the V11 AMZN capture.
        perps["META"]=tuple(HourOpen(x.symbol,x.ts,102 if datetime.fromtimestamp(x.ts,NY).hour>=11 else 100,
            x.high,x.low,x.close,x.source) for x in perps["META"])
        result=replay_yahoo_v52(stocks,perps,assumed_cost_bps=20)
        self.assertEqual(result["status"],"MODELED_YAHOO_REFERENCE_NOT_FORMAL_ASTER_EXECUTION")
        self.assertEqual(result["production_source_sha"],"a09ea45ca3cbd72100f9eb0eaae499039c40b6a0")
        self.assertTrue(any(r["route"]=="V11_EQ" and r["symbol"]=="AMZN" for r in result["trades"]))
        print("V50_TEST_DEBUG",[(r["symbol"],r.get("window_ny"),r.get("gate_status"),r.get("gate_reasons")) for r in result["decisions"] if r["route"]=="V50_POST_OPEN_BASIS" and r["symbol"]=="META"])
        self.assertTrue(any(r["route"]=="V50_POST_OPEN_BASIS" and r["symbol"]=="META" for r in result["trades"]))
        self.assertTrue(all(r["price_venue"]=="YAHOO_EQUITY_REFERENCE_NOT_ASTER_PERP_FILL"
            for r in result["trades"]))
        self.assertTrue(all(r["entry_price_type"]=="YAHOO_60M_OPEN_MODEL" for r in result["trades"]))
    def test_yahoo_reference_and_aster_perp_assumed_fills_are_separate_metrics(self):
        # Distinct price paths, identical V11 trigger. We must never
        # mislabel Yahoo cash-reference returns as actual Aster perp PnL.
        stocks={sym:ybars(D,sym,100) for sym in SYMBOLS}
        perps={sym:abars(D,sym,101 if sym=="AMZN" else 100) for sym in SYMBOLS}
        perps["AMZN"]=tuple(HourOpen(x.symbol,x.ts,
          101 if datetime.fromtimestamp(x.ts,NY).hour<=10 else 100,
          x.high,x.low,x.close,x.source) for x in perps["AMZN"])
        cash=replay_yahoo_v52(stocks,perps,fill_mode="YAHOO_REFERENCE")
        venue=replay_yahoo_v52(stocks,perps,fill_mode="ASTER_PERP")
        cash_v11=[x for x in cash["trades"] if x["route"]=="V11_EQ"]
        venue_v11=[x for x in venue["trades"] if x["route"]=="V11_EQ"]
        self.assertEqual(len(cash_v11),len(venue_v11))
        self.assertGreater(len(venue_v11),0)
        self.assertEqual(cash_v11[0]["fill_mode"],"YAHOO_REFERENCE")
        self.assertEqual(venue_v11[0]["fill_mode"],"ASTER_PERP")
        self.assertGreater(
          venue_v11[0]["net_reference_return_after_assumed_roundtrip_cost"],
          cash_v11[0]["net_reference_return_after_assumed_roundtrip_cost"])
        self.assertTrue(venue["never_a_formal_verified_fill"])
        with self.assertRaisesRegex(ValueError,"FILL_MODE"):
          replay_yahoo_v52(stocks,perps,fill_mode="REAL_EXECUTED")

    def test_missing_perp_never_manufactures_basis_signals(self):
        stocks={s:ybars(D,s,100) for s in SYMBOLS}
        perps={s:tuple() for s in SYMBOLS}
        result=replay_yahoo_v52(stocks,perps,assumed_cost_bps=20)
        self.assertEqual(result["modeled_closed_trades"],0)
        self.assertIsNone(result["win_rate_pct"])
    def test_no_same_symbol_or_same_sleeve_overlap_and_cost_sensitivity(self):
        stocks={s:ybars(D,s,100) for s in SYMBOLS}
        perps={s:abars(D,s,101 if s=="AMZN" else 100) for s in SYMBOLS}
        normal=replay_yahoo_v52(stocks,perps,assumed_cost_bps=20)
        severe=replay_yahoo_v52(stocks,perps,assumed_cost_bps=55)
        self.assertTrue(normal["trades"])
        self.assertLess(severe["modeled_closed_trades"],normal["modeled_closed_trades"]+1)
        self.assertTrue(all(r["decision_ts"]<r["exit_ts"] for r in normal["trades"]))
        for i,a in enumerate(normal["trades"]):
            for b in normal["trades"][i+1:]:
                if a["symbol"]==b["symbol"]:
                    self.assertFalse(a["decision_ts"]<b["exit_ts"] and b["decision_ts"]<a["exit_ts"])
    def test_early_close_skips_afternoon_windows(self):
        d=date(2025,11,28)
        stocks={s:ybars(d,s,100) for s in SYMBOLS}
        perps={s:abars(d,s,101 if s=="AMZN" else 100) for s in SYMBOLS}
        result=replay_yahoo_v52(stocks,perps)
        self.assertTrue(all(x["window_ny"]!="13:30" for x in result["decisions"]))
    def test_aster_must_have_hourly_utc_anchored_prices(self):
        good=[[int(datetime(2026,3,9,14,tzinfo=timezone.utc).timestamp()*1000),
                "100","102","99","101","0",int(datetime(2026,3,9,15,tzinfo=timezone.utc).timestamp()*1000)]]
        self.assertEqual(len(aster_stock_h1_to_opens(good,"AMZN")),1)
        bad=[[*good[0]]];bad[0][0]+=30*60*1000
        with self.assertRaisesRegex(ValueError,"TIMELINE"):aster_stock_h1_to_opens(bad,"AMZN")
if __name__=="__main__":unittest.main()
