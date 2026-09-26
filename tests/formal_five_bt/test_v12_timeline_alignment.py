"""V12 scans must use each symbol only after its own contiguous listing/warm-up."""
import unittest
from research.formal_five_bt.strategies import RuntimeBridge

H1=3_600_000
H2=2*H1
START=1_700_006_400_000

def make_h1(count:int,base:float):
    return [{"ts":START+i*H1,"open":base+i*.03,"high":base+i*.04+0.1,
             "low":base+i*.02-0.1,"close":base+i*.03+0.01,
             "volume":1000+i,"closed":True} for i in range(count)]

class V12HistoricalListingAndGap(unittest.TestCase):
    def test_late_listed_symbol_does_not_suppress_already_listed_symbols(self):
        btc=make_h1(420,100);eth=make_h1(420,50);near=make_h1(420,25)[160:]
        with RuntimeBridge() as bridge:
            r=bridge.v12_series({"BTCUSDT":btc,"ETHUSDT":eth,"NEARUSDT":near},
                START+70*H2,START+190*H2)
        self.assertEqual(r["h2Counts"]["BTC"],210)
        self.assertEqual(r["h2Counts"]["NEAR"],130)
        self.assertGreater(len(r["results"]),100)
        self.assertGreater(r["eligibleEvaluationWindows"]["ETH"],r["eligibleEvaluationWindows"]["NEAR"])
        self.assertGreater(r["eligibleEvaluationWindows"]["NEAR"],0)
        self.assertEqual(r["requiredLookback"],55)
    def test_one_invalid_h2_pair_blocks_only_relevant_warmup_window(self):
        btc=make_h1(420,100);eth=make_h1(420,50)
        broken=[dict(x) for x in eth]
        for i in (240,241):broken[i]["closed"]=False
        with RuntimeBridge() as bridge:
            control=bridge.v12_series({"BTCUSDT":btc,"ETHUSDT":eth},START+70*H2,START+190*H2)
            actual=bridge.v12_series({"BTCUSDT":btc,"ETHUSDT":broken},START+70*H2,START+190*H2)
        self.assertEqual(actual["h2Counts"]["ETH"],control["h2Counts"]["ETH"]-1)
        self.assertEqual([x["decisionTs"] for x in actual["results"]],[x["decisionTs"] for x in control["results"]])
        self.assertLess(actual["eligibleEvaluationWindows"]["ETH"],control["eligibleEvaluationWindows"]["ETH"])
        self.assertGreater(actual["eligibleEvaluationWindows"]["ETH"],0)
    def test_invalid_btc_pair_blocks_every_strategy_during_btc_rewarmup(self):
        btc=make_h1(420,100);eth=make_h1(420,50)
        for i in (220,221):btc[i]["closed"]=False
        with RuntimeBridge() as bridge:
            actual=bridge.v12_series({"BTCUSDT":btc,"ETHUSDT":eth},START+70*H2,START+190*H2)
        self.assertGreater(actual["skippedBtcWarmupOrGap"],0)
        self.assertTrue(all(x["decisionTs"]!=START+110*H2 for x in actual["results"]))
if __name__=="__main__":unittest.main()
