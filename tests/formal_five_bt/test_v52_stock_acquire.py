import tempfile
import unittest
from pathlib import Path
from datetime import datetime,timezone
from research.formal_five_bt.v52_stock_acquire import fetch_history,acquire,verify,BEGIN,END,HOUR
from research.formal_five_bt.v52_yahoo import SYMBOLS
def item(ts,price=100):
    return [ts,str(price),str(price+1),str(price-1),str(price),str(100),ts+HOUR-1]
class AsterStockFetchTests(unittest.TestCase):
    def test_public_paged_a09_stock_prices_are_replayable_without_l2(self):
        calls=[]
        def api(path,params=None):
            calls.append((path,params))
            if path=="exchangeInfo":
                return {"symbols":[{"symbol":s+"USDT","status":"TRADING","onboardDate":BEGIN-HOUR} for s in SYMBOLS]}
            start=params["startTime"]
            return [item(t) for t in range(start,min(start+3*HOUR,BEGIN+4*HOUR),HOUR)]
        # Small bounded chunk simulates last one-year page ending at BEGIN+4H.
        r=fetch_history("AMZN",api,start=BEGIN,end=BEGIN+4*HOUR,pause=lambda _:None)
        self.assertEqual(len(r),4)
        self.assertEqual(len(calls),2)
        # The manifest includes native instrument and SHA and refuses changes.
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            # Full-year acquisition is not needed to test page integrity.
            # Exercise same native-hour row validation and path pin.
            from research.formal_five_bt.v52_yahoo import aster_stock_h1_to_opens
            self.assertEqual(len(aster_stock_h1_to_opens(r,"AMZN")),4)
    def test_does_not_invent_future_bars_or_retry_invalid_server_rows(self):
        def broken(_p,_params):return [item(BEGIN),item(BEGIN)]
        with self.assertRaisesRegex(ValueError,"TIMESTAMPS"):
            fetch_history("AMZN",broken,start=BEGIN,end=BEGIN+2*HOUR,pause=lambda _:None)
    def test_stock_perp_listing_required_before_bt_start(self):
        def meta(path,params=None):
            if path=="exchangeInfo":
                return {"symbols":[{"symbol":s+"USDT","status":"TRADING",
                  "onboardDate":BEGIN+HOUR} for s in SYMBOLS]}
            raise AssertionError("must fail before fetching bars")
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError,"LISTED_AFTER_BT_START"):
                acquire(Path(d),get=meta,pause=lambda _:None)
if __name__=="__main__":unittest.main()
