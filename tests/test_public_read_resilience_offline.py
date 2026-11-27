import sys,unittest,io,json,urllib.request,urllib.error
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import disdex_public_read_resilience as m
class Response:
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self):return b'{"ok":true}'
class Tests(unittest.TestCase):
 def setUp(self):m._COOLDOWN.clear();self.t=0;self.n=0
 def sleep(self,n):self.t+=n
 def request(self,fn,method="GET",query=""):
  req=urllib.request.Request("https://fapi.asterdex.com/fapi/v3/klines"+query,method=method)
  def op(*a,**k):self.n+=1;return fn(self.n)
  return m.public_read_json(req,opener=op,sleep=self.sleep,clock=lambda:self.t)
 def test_recovery(self):
  def f(n):
   if n==1:raise urllib.error.URLError("timeout")
   if n==2:raise urllib.error.HTTPError("url",503,"unavailable",{},io.BytesIO())
   return Response()
  self.assertEqual(self.request(f),{"ok":True});self.assertEqual(self.n,3)
 def test_long_retry_after(self):
  def f(n):raise urllib.error.HTTPError("url",429,"limit",{"Retry-After":"60"},io.BytesIO())
  with self.assertRaises(urllib.error.HTTPError):self.request(f)
  with self.assertRaisesRegex(RuntimeError,"COOLDOWN"):self.request(f)
  self.assertEqual(self.n,1);self.t+=61;self.assertEqual(self.request(lambda n:Response()),{"ok":True})
 def test_no_mutation_or_signed_replay(self):
  for method,query in [("POST",""),("DELETE",""),("GET","?signature=fixture")]:
   with self.assertRaises(ValueError):self.request(lambda n:Response(),method,query)
  self.assertEqual(self.n,0)
 def test_yahoo_wrapper_routes_to_shared_get(self):
  import ast
  from typing import Any
  from unittest.mock import patch
  tree=ast.parse((Path(__file__).resolve().parents[1]/"scripts/dd-reduction/v52_amzn_yahoo_gate.py").read_text(encoding="utf8"))
  fn=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=="_http_json")
  scope={"urllib":__import__("urllib"),"Any":Any}
  exec(compile(ast.Module(body=[fn],type_ignores=[]),"yahoo_wrapper","exec"),scope)
  with patch.object(m,"public_read_json",return_value={"chart":{}}) as get:
   self.assertEqual(scope["_http_json"]("https://query1.finance.yahoo.com/v8/finance/chart/AMZN",5),{"chart":{}})
   self.assertEqual(get.call_args.args[0].get_method(),"GET")
   self.assertEqual(get.call_count,1)
if __name__=="__main__":unittest.main()
