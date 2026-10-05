import unittest, tempfile, json, os, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from disdex_strict_portfolio_planner import load_quality102_live_state
class StateContract(unittest.TestCase):
 def test_v4_and_resident_protection_fields_are_validated(self):
  p={'symbol':'FETUSDT','side':-1,'quantity':2,'entryPrice':11,'entryTs':1000,'hardStop':.05,'bestPrice':11,'trailActive':False,'family':'BRK','variant':'BRK_FET','layer':'S3','exitPolicy':'FIXED_HOLD_STOP','maxHoldHours':24,'residentStop':{'protected':True,'clientOrderId':'q102-stop-'+'a'*22,'orderId':55,'symbol':'FETUSDT','side':'BUY','quantity':2,'originalQuantity':2,'stopPrice':11.55,'readBackStatus':'VERIFIED','lastReconciledAt':2000}}
  d={'version':1,'strategyId':'QUALITY102_CAUSAL_V1','mode':'LIVE','runtimeCommitSha':'a'*40,'updatedAt':2000,'failures':[],'position':p}
  with tempfile.TemporaryDirectory() as td:
   f=Path(td)/'state.json';f.write_text(json.dumps(d));self.assertIsNotNone(load_quality102_live_state(f,now_ms=3000))
   for change in [{'side':'SELL'},{'quantity':1},{'readBackStatus':'UNKNOWN'},{'extra':1}]:
    d['position']['residentStop']={**p['residentStop'],**change};f.write_text(json.dumps(d))
    with self.assertRaises(RuntimeError):load_quality102_live_state(f,now_ms=3000)
if __name__=='__main__':unittest.main()
