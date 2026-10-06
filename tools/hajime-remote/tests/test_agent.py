import hashlib
import json
from pathlib import Path
import tempfile
import threading
import unittest
from remote_app.actions import Actions
from remote_app.agent import Agent, Receipts
from remote_app.server import create_server
from remote_app.store import Store

class AgentIntegrationTest(unittest.TestCase):
    def test_real_http_delivery_write_receipt_and_reconnect(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);store=Store(root/'server.db');receipts=Receipts(root/'receipts.db')
            config={'public_url':'https://example.test/hajime-remote','agent_token_hash':hashlib.sha256(b'agent-token').hexdigest(),'device_id':'pc'}
            server=create_server(config,store,('127.0.0.1',0));threading.Thread(target=server.serve_forever,daemon=True).start()
            actions=Actions(root,root/'app');agent=Agent({'server_url':'http://127.0.0.1:'+str(server.server_port)+'/hajime-remote'},'agent-token',actions,receipts)
            try:
                agent.poll_once();operation=store.enqueue('pc','write_file',{'path':'result.txt','text':'日本語','expected_sha256':'NEW','request_id':'integration-01'},'integration-01')
                agent.poll_once();self.assertEqual((root/'result.txt').read_text(),'日本語');self.assertEqual(store.result('pc',operation)['status'],'completed')
                self.assertEqual(store.enqueue('pc','write_file',{'path':'result.txt','text':'日本語','expected_sha256':'NEW','request_id':'integration-01'},'integration-01'),operation)
                agent.poll_once();self.assertEqual(agent.count,1)
                actions.paused.set();agent.poll_once()
                with self.assertRaises(ValueError): store.enqueue('pc','screenshot',{},'read-id-01')
            finally: server.shutdown();server.server_close();store.close();receipts.close()

    def test_pause_and_resume_cancel_queue_even_between_polls(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Store(Path(directory)/'state.db')
            try:
                store.heartbeat('pc',{'paused':False,'pause_epoch':'first'})
                operation=store.enqueue('pc','screenshot',{},'queued-before-pause')
                store.heartbeat('pc',{'paused':False,'pause_epoch':'after-pause'})
                self.assertIsNone(store.lease('pc'))
                self.assertEqual(store.result('pc',operation)['status'],'cancelled')
            finally: store.close()
