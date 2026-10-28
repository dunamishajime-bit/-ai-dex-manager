import importlib.util,json,time,unittest,tempfile
from pathlib import Path
P=Path(__file__).resolve().parents[1]/'scripts/ops/root/disdex-v4-resident-stop-crosscheck.py'
s=importlib.util.spec_from_file_location('audit',P); m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
S=m.V4_SHA

class StopObservationTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.root=Path(self.temp.name)
  self.now=int(time.time()*1000)
  self.leg='DOGEUSDT:REC_Y06_REV_D0_T72:SHORT:1793181600000'
  cid='v12-v4-98ded39746ed3502a4d7b0e26ef9'
  self.obs={'schema':'resident-stop-observation/v1','ok':True,'readOnly':True,'checkedAt':self.now,
   'unprotectedCount':1,'positions':[{'symbol':'DOGEUSDT','positionSide':'SHORT','quantity':226,'protected':False,
   'orders':[{'orderId':3161652232,'clientOrderId':cid,'side':'BUY','reduceOnly':True,'quantity':226,
   'stopPrice':0.08696,'status':'NEW'}]}]}
  self.ledger={'releaseSha':S,'state':{'legs':{self.leg:{'status':'OPEN','qty':226,'entryNotional':18.19752}}},
   'protections':{self.leg:{'phase':'STOP_CONFIRMED','protectedQty':226,'stopClientOrderId':cid}}}
  self.hb={'runtimeSha':S,'expectedSha':S,'serviceUnit':m.UNIT,'mode':'LIVE','safetyState':'HEALTHY','lastTickAt':self.now}
 def tearDown(self):self.temp.cleanup()
 def evaluate(self):
  paths=[]
  for name,content in [('obs',self.obs),('ledger',self.ledger),('hb',self.hb)]:
   p=self.root/(name+'.json');p.write_text(json.dumps(content));paths.append(p)
  return m.run(self.now,*paths,verify_service=False)
 def test_exact_venue_and_ledger_is_verified(self):
  r=self.evaluate();self.assertEqual(r['status'],'HEALTHY');self.assertEqual(r['effectiveUnprotectedCount'],0)
 def test_wrong_qty_remains_blocked(self):
  self.obs['positions'][0]['orders'][0]['quantity']=225
  self.assertEqual(self.evaluate()['status'],'BLOCKED')
 def test_wrong_client_id_remains_blocked(self):
  self.obs['positions'][0]['orders'][0]['clientOrderId']='v12-v4-unknown'
  self.assertEqual(self.evaluate()['status'],'BLOCKED')
 def test_expired_venue_readback_fails_closed(self):
  self.obs['checkedAt']-=181000
  with self.assertRaises(RuntimeError):self.evaluate()
 def test_stop_worse_than_hard_loss_fails_closed(self):
  self.obs['positions'][0]['orders'][0]['stopPrice']=0.10
  self.assertEqual(self.evaluate()['status'],'BLOCKED')
 def test_missing_ownership_remains_blocked(self):
  self.ledger['state']['legs']={}
  self.assertEqual(self.evaluate()['status'],'BLOCKED')

if __name__=='__main__':unittest.main()
