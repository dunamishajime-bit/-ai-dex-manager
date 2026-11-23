import ast,io,json,math,re,unittest,urllib.error,urllib.parse,urllib.request
from pathlib import Path
from typing import Any,Dict,Optional
from unittest.mock import patch

class HttpErrorRedactionTest(unittest.TestCase):
 def test_full_runner_errors_cannot_log_signed_query_or_echoed_authorization(self):
  tree=ast.parse(Path('scripts/disdex_v13d_v11eq_stock_live_engine.py').read_text(encoding='utf-8-sig'))
  nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'http_json','redact_http_error_context'}]
  scope=dict(urllib=__import__('urllib'),json=json,re=re,math=math,Any=Any,Dict=Dict,Optional=Optional,
   assert_v52_monitor_http=lambda *args:None,bool_env=lambda *args:False)
  exec(compile(ast.Module(body=nodes,type_ignores=[]),'real-http-error-functions','exec'),scope)
  address='0x'+'a'*40
  body=b'{"msg":"bad authorization","signature":"fixture-signature-secret"}'
  def fail(request,**kwargs):raise urllib.error.HTTPError(request.full_url,400,'Bad Request',{},io.BytesIO(body))
  with patch('urllib.request.urlopen',side_effect=fail):
   with self.assertRaises(RuntimeError) as error:
    scope['http_json']('https://fapi3.asterdex.com/fapi/v3/positionRisk',params={'signature':'fixture-query-secret','user':address,'nonce':123,'symbol':'BTCUSDT'})
  text=str(error.exception)
  for secret in ['fixture-query-secret','fixture-signature-secret',address]:self.assertNotIn(secret,text)
  self.assertIn('HTTP 400',text);self.assertIn('BTCUSDT',text)

 def test_local_reference_freshness_error_keeps_its_exact_classification(self):
  tree=ast.parse(Path('scripts/disdex_v13d_v11eq_stock_live_engine.py').read_text(encoding='utf-8-sig'))
  fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='redact_http_error_context')
  scope=dict(urllib=__import__('urllib'),json=json,re=re)
  exec(compile(ast.Module(body=[fn],type_ignores=[]),'redaction','exec'),scope)
  url='http://127.0.0.1:8797/quote?symbol=TSLA';body='{"error":"stale_quote","ageMs":32000,"maximumAgeMs":30000}'
  self.assertEqual(scope['redact_http_error_context'](url,body),(url,body))

if __name__=='__main__':unittest.main()
