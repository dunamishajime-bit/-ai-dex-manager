import ast
from pathlib import Path
import unittest
import urllib.parse
import urllib.request
import urllib.error
from typing import Any, Dict, Optional
from unittest.mock import patch

class MonitorTransportTest(unittest.TestCase):
    def test_monitor_rejects_mutations_and_untrusted_signed_destinations(self):
        tree=ast.parse(Path('scripts/disdex_v13d_v11eq_stock_live_engine.py').read_text(encoding='utf8'))
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='assert_v52_monitor_http')
        scope={'bool_env':lambda *args:True,'urllib':__import__('urllib')}
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'transport','exec'),scope)
        check=scope['assert_v52_monitor_http']
        check('GET','https://fapi3.asterdex.com/fapi/v3/positionRisk',signed=True)
        for method,url in [('POST','https://fapi3.asterdex.com/fapi/v3/order'),('DELETE','https://fapi3.asterdex.com/fapi/v3/order'),('GET','https://example.com/fapi/v3/positionRisk'),('GET','http://fapi3.asterdex.com/fapi/v3/positionRisk'),('GET','https://fapi3.asterdex.com/fapi/v3/unknown')]:
            with self.subTest(method=method,url=url),self.assertRaises(RuntimeError):check(method,url,signed=True)

    def test_http_boundary_denies_post_and_redirect_before_following(self):
        tree=ast.parse(Path('scripts/disdex_v13d_v11eq_stock_live_engine.py').read_text(encoding='utf8'))
        functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'assert_v52_monitor_http','http_json'}]
        scope={'bool_env':lambda *args:True,'urllib':__import__('urllib'),'Any':Any,'Dict':Dict,'Optional':Optional}
        exec(compile(ast.Module(body=functions,type_ignores=[]),'transport','exec'),scope)
        with patch('urllib.request.urlopen') as direct, patch('urllib.request.build_opener') as opener:
            with self.assertRaisesRegex(RuntimeError,'MUTATION_FORBIDDEN'):
                scope['http_json']('https://fapi3.asterdex.com/fapi/v3/order',method='POST')
            direct.assert_not_called();opener.assert_not_called()
            def make_opener(handler):
                class Opener:
                    def open(self,*args,**kwargs):
                        return handler.redirect_request(None,None,302,'redirect',{},'https://example.com')
                return Opener()
            opener.side_effect=make_opener
            with self.assertRaisesRegex(RuntimeError,'REDIRECT_FORBIDDEN'):
                scope['http_json']('https://fapi3.asterdex.com/fapi/v3/positionRisk')
            direct.assert_not_called()

if __name__=='__main__':unittest.main()
