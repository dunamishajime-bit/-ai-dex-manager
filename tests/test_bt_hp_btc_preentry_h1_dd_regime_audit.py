"""BTC completed H1 as-of market regimes: anti-lookahead and outcome tests."""
import sys,math,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_btc_preentry_h1_dd_regime_audit import (
 HOUR_MS,btc_features,classify,aggregate,group,count_episodes,ms,
)
def bars(n=90):
 return [(j*HOUR_MS,(j+1)*HOUR_MS-1,100+float(j)) for j in range(n)]
class ClosedH1RegimeTests(unittest.TestCase):
 def test_pre_entry_signal_uses_last_completed_h1_not_current_open(self):
  source=bars()
  f=btc_features(source,80*HOUR_MS)
  self.assertEqual(f["lastClosedBtcH1"],80*HOUR_MS-1)
  self.assertAlmostEqual(f["btcReturn24h"],source[79][2]/source[55][2]-1)
 def test_identical_timestamp_close_not_allowed_future(self):
  source=bars()
  f=btc_features(source,80*HOUR_MS-1)
  self.assertEqual(f["lastClosedBtcH1"],79*HOUR_MS-1)
 def test_72h_pre_entry_history_insufficient_fail_closed(self):
  with self.assertRaisesRegex(ValueError,"72H_HISTORY_MISSING"):
   btc_features(bars(),72*HOUR_MS)
 def test_rising_confirmed_requires_both_positive_returns(self):
  self.assertEqual(classify(.021,.035,.01),("BTC_RISING_CONFIRMED","LOW_VOL"))
 def test_falling_confirmed_requires_both_negative_returns(self):
  self.assertEqual(classify(-.021,-.035,.05),("BTC_FALLING_CONFIRMED","HIGH_VOL"))
 def test_rebound_and_pullback_and_mixed_are_distinct(self):
  self.assertEqual(classify(.04,-.01,.01)[0],"BTC_REBOUND_72H_NEGATIVE")
  self.assertEqual(classify(-.04,.01,.01)[0],"BTC_PULLBACK_72H_POSITIVE")
  self.assertEqual(classify(.01,.01,.01)[0],"BTC_MIXED_OR_RANGE")
 def test_invalid_utc_timestamp_rejected(self):
  with self.assertRaisesRegex(ValueError,"UTC_REQUIRED"):ms("2025-10-01T00:00:00")
  self.assertEqual(ms("2025-10-01T00:00:00Z"),1759276800000)
 def test_outcomes_not_misclassified_as_entry_regime(self):
  trades=[{"netModelJpy":-10.,"grossModelJpy":1.,
     "adversePriceDirection":True,"btcRegime":"BTC_RISING_CONFIRMED"},
    {"netModelJpy":7.,"grossModelJpy":9.,
     "adversePriceDirection":False,"btcRegime":"BTC_RISING_CONFIRMED"}]
  row=group(trades,"btcRegime")["BTC_RISING_CONFIRMED"]
  self.assertEqual((row["n"],row["wins"],row["losses"],row["adversePriceDirection"]),(2,1,1,1))
  self.assertEqual(row["netModelJpy"],-3)
 def test_empty_regime_has_unknown_win_rate(self):
  self.assertIsNone(aggregate([])["winRatePct"])
 def test_same_symbol_twentyfour_hour_episodes_dedupe(self):
  s=[{"logic":"Q102","symbol":"ARB","entryMs":t*HOUR_MS} for t in (1,4,20,46)]
  result=count_episodes(s)
  self.assertEqual(result["episodes24hSameLogicSymbol"],2)
  self.assertEqual(result["episodesByLogic"]["Q102"],2)
if __name__=="__main__":unittest.main()
