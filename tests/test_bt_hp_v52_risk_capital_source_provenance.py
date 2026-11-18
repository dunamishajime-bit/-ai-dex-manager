"""V52 risk denominator source provenance and fixed floor tests."""
import sys,tempfile,math,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_v52_risk_capital_source_provenance import (
    source_contract,capital_proxy,MINCAP,EXPECTED_SYMBOLS,
)
def dummy_source():
    return ('_V52_V96_SYMBOLS='+repr(EXPECTED_SYMBOLS)+'\n'
      '_mincap=10000.0*5.0/62.50520405\n'
      '_reserve=max(_mincap,.10*eq_v52)\n'
      '_capital=max(_mincap,eq_v52-_v96_notional-_reserve)\n'
      'for _q in []:\n'
      ' if _q["s"]=="V52" or _q["symbol"] not in _V52_V96_SYMBOLS:continue\n'
      'v52_daily_audit.append(dict(utc=iso(t),event="TRIP",loss_pct=100*_lpct,strategy_capital_jpy=_capital))\n')
def eval_source(s):
    with tempfile.TemporaryDirectory() as d:
      p=Path(d)/"archived.py";p.write_text(s,"utf8")
      return source_contract(p)
class V52RiskCapitalSourceTests(unittest.TestCase):
 def test_min_capital_matches_logged_clamp(self):
    self.assertAlmostEqual(MINCAP,799.9333937059597)
 def test_reconstruct_may15_capital_10bps(self):
    self.assertAlmostEqual(capital_proxy(1230204.4292191342,2202641.5632669),MINCAP)
 def test_reconstruct_may15_capital_30bps(self):
    self.assertAlmostEqual(capital_proxy(650587.6206628574,1166498.622731125),MINCAP)
 def test_non_floor_calculation_uses_reserve(self):
    self.assertAlmostEqual(capital_proxy(1000000,100000),800000)
 def test_source_scoped_symbols_matched(self):
    x=eval_source(dummy_source())
    self.assertEqual(x["minCapitalJpy"],MINCAP)
    self.assertEqual(set(x["v96ScopeSymbols"]),EXPECTED_SYMBOLS)
 def test_source_formula_changed_rejected(self):
    wrong=dummy_source().replace('_reserve=max(_mincap,.10*eq_v52)',
       '_reserve=max(_mincap,.25*eq_v52)')
    with self.assertRaisesRegex(ValueError,"SOURCE_V52_CAPITAL_FORMULA_CHANGED"):
      eval_source(wrong)
 def test_v96_symbol_universe_drift_rejected(self):
    wrong=dummy_source().replace("PENGUUSDT","BROKENCOIN")
    with self.assertRaisesRegex(ValueError,"SOURCE_V52_V96_SCOPE_SYMBOLS_CHANGED"):
      eval_source(wrong)
 def test_negative_and_nonfinite_reference_rejected(self):
    for v,n in ((math.nan,0),(10000,math.inf),(-1,0),(1000,-1)):
      with self.subTest((v,n)),self.assertRaisesRegex(ValueError,"NONFINITE_OR_INVALID_CAPITAL"):
       capital_proxy(v,n)
if __name__=="__main__":unittest.main()
