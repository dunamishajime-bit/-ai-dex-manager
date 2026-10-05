import unittest,tempfile,json,os,sys,time
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from disdex_strict_portfolio_planner import quality102_crypto_notional_from_positions
class FetV52Ownership(unittest.TestCase):
 def test_exact_owned_fet_is_counted_and_ambiguous_fails_closed(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'fet.json';now=time.time()*1000;sha='a'*40
   state={'schema':'fet-brk48-residual-state/v1','strategyId':'FET_BRK48_RESIDUAL','runtimeCommitSha':sha,'updatedAt':now,'position':{'symbol':'FETUSDT','side':1,'quantity':515,'entryPrice':.2407},'pending':None,'manualReview':None}
   row={'symbol':'FETUSDT','positionAmt':515,'markPrice':.258,'entryPrice':.2407}
   with patch.dict(os.environ,{'FET_BRK48_STATE_PATH':str(p),'DISDEX_RUNTIME_COMMIT_SHA':sha,'QUALITY102_CAUSAL_V1_STATE_PATH':str(Path(tmp)/'missing'),'DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH':''}):
    p.write_text(json.dumps(state));self.assertAlmostEqual(quality102_crypto_notional_from_positions([row],now_ms=now),132.87)
    for changes in [{'runtimeCommitSha':'b'*40},{'updatedAt':now-76*60000},{'updatedAt':now+6000},{'pending':{'phase':'submitted'}},{'position':None},{'manualReview':'ambiguous'}]:
     p.write_text(json.dumps({**state,**changes}));
     with self.assertRaises(RuntimeError):quality102_crypto_notional_from_positions([row],now_ms=now)
    p.write_text(json.dumps(state))
    for expected in ['', 'invalid']:
     with patch.dict(os.environ,{'DISDEX_RUNTIME_COMMIT_SHA':expected}):
      with self.assertRaises(RuntimeError):quality102_crypto_notional_from_positions([row],now_ms=now)
    for changes in [{'positionAmt':-515},{'positionAmt':520},{'entryPrice':.25}]:
     with self.assertRaises(RuntimeError):quality102_crypto_notional_from_positions([{**row,**changes}],now_ms=now)
    with self.assertRaises(RuntimeError):quality102_crypto_notional_from_positions([row,row],now_ms=now)
    with self.assertRaises(RuntimeError):quality102_crypto_notional_from_positions([{'symbol':'UNKNOWNUSDT','positionAmt':1,'markPrice':1}],now_ms=now)
