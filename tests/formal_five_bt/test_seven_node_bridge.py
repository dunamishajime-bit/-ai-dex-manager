import os
import unittest
from pathlib import Path
from research.formal_five_bt.seven_sidecar_scan import SevenBridge, FIFTEEN, MINUTE
from research.formal_five_bt.seven_source import (
    LIVE_FIVE_SHA, SEVEN_RESEARCH_SHA, verify_seven_source,
)

class SevenFrozenNodeBridgeTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("SEVEN_BT_SOURCE_ROOT"),"pinned snapshot not installed")
    def test_live_exact_source_has_two_protected_long_sleeves(self):
        root=Path(os.environ["SEVEN_BT_SOURCE_ROOT"])
        verified=verify_seven_source(root)
        self.assertEqual(verified["source_commit_parent_sha"],LIVE_FIVE_SHA)
        t=(1800000000000//FIFTEEN)*FIFTEEN
        def candles(base,step):
            return [{"ts":t+i*FIFTEEN,"open":base+(i-.5)*step,
                "high":base+(i+.4)*step,"low":base+(i-1)*step,
                "close":base+i*step,"volume":1000} for i in range(5)]
        btc=candles(100,.1)
        hype=candles(50,.06)
        zec=candles(100,.16)
        with SevenBridge(root) as bridge:
            audit=bridge.ask(op="audit")
            self.assertEqual(audit["sourceSha"],SEVEN_RESEARCH_SHA)
            self.assertTrue(audit["researchOnly"])
            for name,series,high in [("HYPE",hype,50.31),("ZEC",zec,100.80)]:
                latest=series[-1]
                now=latest["ts"]+FIFTEEN+MINUTE
                minute=[{"ts":latest["ts"]+FIFTEEN,
                    "open":latest["close"],"high":high,
                    "low":latest["close"],"close":high-.001,"volume":100}]
                result=bridge.ask(op="evaluate",strategy=name,input={
                    "now":now,"btc15m":btc,"symbol15m":series,"symbol1m":minute})
                self.assertEqual(result["strategy"],name+"_LONG")
                self.assertTrue(result["accepted"],result)
                self.assertLess(result["stopPrice"],result["entryPrice"])
                self.assertGreater(result["takeProfitPrice"],result["entryPrice"])
                qty=bridge.ask(op="quantity",input={"strategy":name+"_LONG",
                    "equityUsd":1000,"entryPrice":result["entryPrice"],
                    "stopPrice":result["stopPrice"],"feeBpsPerSide":4,
                    "slippageBps":20,"fundingBps":2,"stepSize":.001})
                self.assertLessEqual(qty["gross"],1.000001)
                self.assertLessEqual(qty["worstCaseLossUsd"],
                    50 if name=="HYPE" else 45)
            self.assertIn("evaluateHypeLongSignal",audit["exports"])
if __name__=="__main__":unittest.main()
