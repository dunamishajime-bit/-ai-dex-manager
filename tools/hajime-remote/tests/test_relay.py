import base64
import hashlib
import importlib
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

BASE = 'https://example.test/hajime-remote'
RESOURCE = BASE + '/mcp'
VERIFIER = 'v' * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).decode().rstrip('=')


class RelayTest(unittest.TestCase):
    def setUp(self):
        try:
            self.store_module = importlib.import_module('remote_app.store')
            self.auth_module = importlib.import_module('remote_app.auth')
        except ModuleNotFoundError:
            self.fail('Authenticated relay has not been implemented')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = self.store_module.Store(Path(self.temp.name) / 'state.db')
        self.addCleanup(self.store.close)
        self.auth = self.auth_module.Auth(self.store, BASE)
        self.store.heartbeat('pc', {'paused': False})

    def oauth(self, resource=RESOURCE):
        client = self.auth.register({'redirect_uris': ['https://chatgpt.com/connector_platform/oauth/callback'], 'token_endpoint_auth_method': 'none'})
        pin = self.auth.pair('pc')
        ticket = self.auth.begin(client['client_id'], client['redirect_uris'][0], CHALLENGE, resource, 'state-one')
        location = self.auth.approve(ticket, pin)
        from urllib.parse import urlparse, parse_qs
        code = parse_qs(urlparse(location).query)['code'][0]
        return client, code

    def exchange(self, client, code, **extra):
        args = {'grant_type': 'authorization_code', 'client_id': client['client_id'], 'code': code,
                'redirect_uri': client['redirect_uris'][0], 'code_verifier': VERIFIER, 'resource': RESOURCE}
        args.update(extra)
        return self.auth.exchange(args)

    def test_auth_code_requires_correct_pkce_and_is_single_use(self):
        client, code = self.oauth()
        with self.assertRaises(ValueError):
            self.exchange(client, code, code_verifier='wrong')
        result = self.exchange(client, code)
        self.assertEqual(self.auth.validate(result['access_token']), 'pc')
        with self.assertRaises(ValueError):
            self.exchange(client, code)

    def test_resource_and_redirect_are_bound(self):
        client, code = self.oauth()
        with self.assertRaises(ValueError):
            self.exchange(client, code, resource='https://attacker.test/mcp')
        with self.assertRaises(ValueError):
            self.exchange(client, code, redirect_uri='https://attacker.test/')
        with self.assertRaises(ValueError):
            self.auth.register({'redirect_uris': ['https://attacker.test/callback']})
        with self.assertRaises(ValueError):
            self.auth.register({'redirect_uris': ['https://chatgpt.com.attacker.test/callback']})

    def test_refresh_rotates_and_is_not_an_access_token(self):
        client, code = self.oauth()
        token = self.exchange(client, code)
        with self.assertRaises(ValueError):
            self.auth.validate(token['refresh_token'])
        request = {'grant_type': 'refresh_token', 'refresh_token': token['refresh_token'], 'client_id': client['client_id'], 'resource': RESOURCE}
        next_token = self.auth.exchange(request)
        self.assertNotEqual(next_token['refresh_token'], token['refresh_token'])
        with self.assertRaises(ValueError):
            self.auth.exchange(request)

    def test_pairing_expires_and_guessing_is_bounded(self):
        client = self.auth.register({'redirect_uris': ['https://chatgpt.com/callback']})
        pin = self.auth.pair('pc')
        ticket = self.auth.begin(client['client_id'], client['redirect_uris'][0], CHALLENGE, RESOURCE, 'state')
        for _ in range(5):
            with self.assertRaises(ValueError):
                self.auth.approve(ticket, '00000000' if pin != '00000000' else '11111111')
        with self.assertRaises(ValueError):
            self.auth.approve(ticket, pin)

    def test_job_idempotency_never_executes_duplicate_mutations(self):
        first = self.store.enqueue('pc', 'write_file', {'path': 'x', 'text': 'one'}, 'request-123')
        self.assertEqual(first, self.store.enqueue('pc', 'write_file', {'path': 'x', 'text': 'one'}, 'request-123'))
        with self.assertRaises(ValueError):
            self.store.enqueue('pc', 'write_file', {'path': 'x', 'text': 'two'}, 'request-123')
        task = self.store.lease('pc')
        self.assertEqual(task['id'], first)
        self.assertIsNone(self.store.lease('pc'))
        self.store.finish('pc', first, {'status': 'ok'})
        self.store.finish('pc', first, {'status': 'ok'})
        self.assertEqual(self.store.result('pc', first)['result']['status'], 'ok')

    def test_offline_or_paused_rejects_jobs(self):
        with self.assertRaises(ValueError):
            self.store.enqueue('missing', 'click', {'x': 1, 'y': 1}, 'request-123')
        self.store.heartbeat('pc', {'paused': True})
        with self.assertRaises(ValueError):
            self.store.enqueue('pc', 'click', {'x': 1, 'y': 1}, 'request-123')

    def test_pause_does_not_lease_previously_queued_actions(self):
        operation = self.store.enqueue('pc', 'click', {'x': 1, 'y': 1}, 'request-123')
        self.store.heartbeat('pc', {'paused': True})
        self.assertIsNone(self.store.lease('pc'))
        self.assertEqual(self.store.result('pc', operation)['status'], 'cancelled')

    def test_lost_lease_is_unknown_and_never_requeued(self):
        operation = self.store.enqueue('pc', 'click', {'x': 1, 'y': 1}, 'request-123')
        self.store.lease('pc')
        with self.store.lock:
            self.store.db.execute('UPDATE jobs SET updated=? WHERE id=?', (time.time() - 500, operation))
            self.store.db.commit()
        self.assertIsNone(self.store.lease('pc'))
        self.assertEqual(self.store.result('pc', operation)['status'], 'unknown')


class HttpTest(RelayTest):
    def setUp(self):
        super().setUp()
        try:
            server_module = importlib.import_module('remote_app.server')
        except ModuleNotFoundError:
            self.fail('MCP HTTP transport has not been implemented')
        config = {'public_url': BASE, 'agent_token_hash': hashlib.sha256(b'agent-secret').hexdigest(), 'device_id': 'pc'}
        self.server = server_module.create_server(config, self.store, ('127.0.0.1', 0))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.url = 'http://127.0.0.1:' + str(self.server.server_address[1])

    def request(self, path, data=None, token=None, origin=None):
        headers = {'Content-Type': 'application/json'}
        if token: headers['Authorization'] = 'Bearer ' + token
        if origin: headers['Origin'] = origin
        raw = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(self.url + path, raw, headers)
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.status, dict(response.headers), json.loads(response.read() or b'null')
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), json.loads(error.read() or b'null')

    def token(self):
        client, code = self.oauth()
        return self.exchange(client, code)['access_token']

    def test_mcp_authentication_and_discovery(self):
        body = {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-06-18'}}
        status, headers, _ = self.request('/hajime-remote/mcp', body)
        self.assertEqual(status, 401)
        self.assertIn('resource_metadata=', headers['WWW-Authenticate'])
        self.assertEqual(self.request('/hajime-remote/mcp', body, token='agent-secret')[0], 401)
        status, _, response = self.request('/hajime-remote/mcp', body, token=self.token())
        self.assertEqual(status, 200)
        self.assertEqual(response['result']['protocolVersion'], '2025-06-18')
        status, _, response = self.request('/hajime-remote/mcp', {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'}, token=self.token())
        names = {x['name'] for x in response['result']['tools']}
        self.assertIn('screenshot', names)
        self.assertIn('run_command', names)
        self.assertNotIn('agent_token_hash', json.dumps(response))

    def test_origin_and_agent_auth_are_enforced(self):
        body = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}
        self.assertEqual(self.request('/hajime-remote/mcp', body, self.token(), 'https://attacker.test')[0], 403)
        self.assertEqual(self.request('/hajime-remote/agent/poll', {'paused': False})[0], 401)
        self.assertEqual(self.request('/hajime-remote/agent/poll', {'paused': True}, self.token())[0], 401)
        status, _, response = self.request('/hajime-remote/agent/poll', {'paused': True}, 'agent-secret')
        self.assertEqual(status, 200)
        self.assertIsNone(response['task'])

    def test_unknown_tool_and_missing_write_request_id_are_rejected(self):
        for name, arguments in [('missing', {}), ('write_file', {'path': 'a', 'text': 'x'})]:
            body = {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}}
            status, _, response = self.request('/hajime-remote/mcp', body, self.token())
            self.assertEqual(status, 200)
            self.assertTrue(response['result']['isError'])
            self.assertIsNone(self.store.lease('pc'))


if __name__ == '__main__': unittest.main()

class RefreshFamilyTest(RelayTest):
    def test_replayed_refresh_revokes_attacker_successor(self):
        client,code=self.oauth();original=self.exchange(client,code)
        request={'grant_type':'refresh_token','refresh_token':original['refresh_token'],'client_id':client['client_id'],'resource':RESOURCE}
        successor=self.auth.exchange(request)
        with self.assertRaises(ValueError): self.auth.exchange(request)
        with self.assertRaises(ValueError): self.auth.validate(successor['access_token'])
        with self.assertRaises(ValueError): self.auth.exchange({**request,'refresh_token':successor['refresh_token']})

class BrowserAuthorizationTest(HttpTest):
    def test_form_policy_preserves_origin_and_allows_registered_chat_callback(self):
        from urllib.parse import urlencode
        client=self.auth.register({'redirect_uris':['https://chatgpt.com/connector/oauth/test']})
        query=urlencode({'response_type':'code','client_id':client['client_id'],'redirect_uri':client['redirect_uris'][0],'code_challenge':CHALLENGE,'code_challenge_method':'S256','resource':RESOURCE,'state':'browser-test'})
        with urllib.request.urlopen(self.url+'/hajime-remote/authorize?'+query) as response:
            html=response.read().decode()
            self.assertEqual(response.headers['Referrer-Policy'],'strict-origin')
            self.assertIn("form-action 'self' https://chatgpt.com;",response.headers['Content-Security-Policy'])
        import re
        ticket=re.search(r'name="ticket" value="([^"]+)"',html).group(1)
        pin=self.auth.pair('pc')
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs): return None
        request=urllib.request.Request(self.url+'/hajime-remote/authorize',urlencode({'ticket':ticket,'pin':pin}).encode(),{'Content-Type':'application/x-www-form-urlencoded','Origin':'https://example.test'})
        try: urllib.request.build_opener(NoRedirect).open(request)
        except urllib.error.HTTPError as error:
            self.assertEqual(error.code,303)
            self.assertTrue(error.headers['Location'].startswith(client['redirect_uris'][0]+'?code='))
        else: self.fail('Callback missing')
    def test_null_origin_remains_rejected(self):
        status,_,_=self.request('/hajime-remote/authorize',{'pin':'12345678','ticket':'invalid'},origin='null')
        self.assertEqual(status,403)
