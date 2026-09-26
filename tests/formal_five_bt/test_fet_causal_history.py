"""FET must stop candidate generation on gaps, malformed OHLC and before listing."""
import unittest
from research.formal_five_bt.strategies import RuntimeBridge
H=3_600_000
START=1_700_006_400_000

def bars(n):
    return [[START+i*H,"10.0","10.2","9.8","10.0","1000",START+(i+1)*H-1,"10000"] for i in range(n)]

class FetHistoryCoverage(unittest.TestCase):
    def test_unrelated_earlier_or_later_gap_does_not_fake_contiguous_73h(self):
        original=bars(370)
        invalid=[list(x) for x in original]
        invalid[152][2]="1.0"  # bad OHLC high lower than low
        with RuntimeBridge() as bridge:
            baseline=bridge.fet_series(original,START+100*H,START+330*H)
            observed=bridge.fet_series(invalid,START+100*H,START+330*H)
        self.assertEqual([v["decisionTs"] for v in baseline],[v["decisionTs"] for v in observed])
        self.assertTrue(all(v["historyReady"] for v in baseline))
        gaps=[v for v in observed if v["gapReason"]=="FET_73H_HISTORY_GAP_OR_MALFORMED"]
        self.assertGreater(len(gaps),0)
        self.assertTrue(all(v["signal"] is None for v in gaps))
        self.assertTrue(observed[-1]["historyReady"])
    def test_late_listing_cannot_create_a_false_73h_signal(self):
        early=bars(200)[150:]
        with RuntimeBridge() as bridge:
            obs=bridge.fet_series(early,START+150*H,START+198*H)
        self.assertTrue(any(not x["historyReady"] for x in obs))
        self.assertTrue(all(x["signal"] is None for x in obs if not x["historyReady"]))
if __name__=="__main__": unittest.main()
