import importlib.util
import unittest
from pathlib import Path

PATH=Path(__file__).resolve().parents[1]/"scripts"/"ops"/"root"/"disdex-idle-residual-flat-stale-repair.py"
spec=importlib.util.spec_from_file_location("idle_flat_repair",PATH)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class VenueWitnessOnly(unittest.TestCase):
    def sample(self):
        return {
            "status":"ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
            "ordersSent":0,"cancelsSent":0,"positionChangesSent":0,
            "positions":[{"symbol":"DOGEUSDT","positionSide":"BOTH",
                          "positionAmt":-226,"entryPrice":0.08052,"markPrice":0.0754}],
            "openOrders":[{"symbol":"DOGEUSDT","clientOrderId":m.KNOWN_STOP,
                           "side":"BUY","type":"STOP_MARKET",
                           "origQty":"226","executedQty":"0",
                           "reduceOnly":True,"status":"NEW"}],
        }

    def test_exact_protection_is_sufficient_without_market_price_parity(self):
        d=self.sample()
        before=m._check_venue(d)
        d["positions"][0]["markPrice"]=0.0769
        self.assertEqual(before,m._check_venue(d))

    def test_missing_doge_stop_fails_closed(self):
        d=self.sample();d["openOrders"]=[]
        with self.assertRaisesRegex(ValueError,"UNEXPECTED_LIVE"):
            m._check_venue(d)

    def test_unauthorized_extra_order_fails_closed(self):
        d=self.sample();d["openOrders"].append(dict(d["openOrders"][0]))
        with self.assertRaisesRegex(ValueError,"UNEXPECTED_LIVE"):
            m._check_venue(d)

    def test_amount_or_direction_change_fails_closed(self):
        for key,value in [("positionAmt",-225),("positionSide","LONG")]:
            d=self.sample();d["positions"][0][key]=value
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,"RESIDENT_STOP"):
                m._check_venue(d)

    def test_unknown_stop_or_reduce_only_change_fails_closed(self):
        for key,value in [("clientOrderId","unknown"),("reduceOnly",False),("status","FILLED")]:
            d=self.sample();d["openOrders"][0][key]=value
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,"RESIDENT_STOP"):
                m._check_venue(d)

    def test_reported_venue_side_effect_is_rejected(self):
        d=self.sample();d["cancelsSent"]=1
        with self.assertRaisesRegex(ValueError,"READONLY_VIOLATED"):
            m._check_venue(d)

if __name__=="__main__":
    unittest.main()
