import hashlib
import importlib
import json
import tempfile
import time
import unittest
from pathlib import Path


class ActionTest(unittest.TestCase):
    def setUp(self):
        try: module = importlib.import_module('remote_app.actions')
        except ModuleNotFoundError: self.fail('Windows actions are not implemented')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.actions = module.Actions(self.root, self.root / 'HajimeRemote')
        self.addCleanup(self.actions.stop_all)

    def test_atomic_write_requires_expected_file_hash(self):
        args = {'path': str(self.root / 'example.txt'), 'text': '最初', 'expected_sha256': 'NEW', 'request_id': 'write-001'}
        result = self.actions.execute('write_file', args)
        self.assertEqual((self.root / 'example.txt').read_text(), '最初')
        with self.assertRaises(ValueError): self.actions.execute('write_file', args)
        with self.assertRaises(ValueError): self.actions.execute('write_file', {**args, 'expected_sha256': 'a'*64})
        self.actions.execute('write_file', {**args, 'text': '次', 'expected_sha256': result['sha256']})
        self.assertEqual((self.root / 'example.txt').read_text(), '次')

    def test_escape_symlink_and_private_key_reads_are_denied(self):
        outside = self.root.parent / ('outside-' + self.root.name)
        outside.write_text('outside')
        self.addCleanup(outside.unlink)
        (self.root / 'link').symlink_to(outside)
        for path in (outside, self.root / 'link', self.root / 'DisDex.pem', self.root / 'HajimeRemote' / 'config.json'):
            with self.assertRaises(ValueError): self.actions.execute('read_file', {'path': str(path)})

    def test_read_file_offsets_hash_and_directory_inventory(self):
        (self.root / 'text.txt').write_text('abcdefgh', encoding='utf8')
        read = self.actions.execute('read_file', {'path': str(self.root / 'text.txt'), 'offset': 2, 'limit': 3})
        self.assertEqual(read['text'], 'cde')
        self.assertEqual(read['sha256'], hashlib.sha256(b'abcdefgh').hexdigest())
        listing = self.actions.execute('list_files', {'path': str(self.root)})
        self.assertIn('text.txt', [x['name'] for x in listing['entries']])

    def wait_command(self, command_id):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            result = self.actions.execute('get_command_output', {'command_id': command_id})
            if not result['running']: return result
            time.sleep(.03)
        self.fail('command did not finish')

    def test_real_python_command_returns_output_and_exit_status(self):
        result = self.actions.execute('run_command', {'shell': 'python', 'command': "print('日本語'); raise SystemExit(7)", 'request_id': 'command-001'})
        output = self.wait_command(result['command_id'])
        self.assertEqual(output['exit_code'], 7)
        self.assertIn('日本語', output['output'])
        self.assertEqual(output['next_offset'], len(output['output'].encode('utf8')))

    def test_running_command_timeout_and_stop(self):
        job = self.actions.execute('run_command', {'shell': 'python', 'command': 'import time; time.sleep(30)', 'timeout_seconds': 1, 'request_id': 'command-002'})
        result = self.wait_command(job['command_id'])
        self.assertTrue(result['timed_out'])
        job = self.actions.execute('run_command', {'shell': 'python', 'command': 'import time; time.sleep(30)', 'request_id': 'command-003'})
        self.actions.execute('stop_command', {'command_id': job['command_id'], 'request_id': 'stop-001'})
        self.assertFalse(self.wait_command(job['command_id'])['running'])

    def test_unknown_command_or_tool_is_rejected(self):
        with self.assertRaises(ValueError): self.actions.execute('get_command_output', {'command_id': 'unknown'})
        with self.assertRaises(ValueError): self.actions.execute('unknown', {})

    def test_pause_prevents_file_changes_and_commands(self):
        self.actions.paused.set()
        with self.assertRaises(ValueError): self.actions.execute('write_file', {'path': str(self.root/'x'), 'text': 'x', 'expected_sha256': 'NEW', 'request_id': 'write-002'})
        with self.assertRaises(ValueError): self.actions.execute('run_command', {'shell': 'python', 'command': 'print(1)', 'request_id': 'command-004'})
        self.assertFalse((self.root/'x').exists())


class ReceiptTest(unittest.TestCase):
    def setUp(self):
        try:
            self.module = importlib.import_module('remote_app.agent')
            actions_module = importlib.import_module('remote_app.actions')
        except ModuleNotFoundError: self.fail('Durable Windows agent receipts are not implemented')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.actions = actions_module.Actions(self.root, self.root/'HajimeRemote')
        self.receipts = self.module.Receipts(self.root/'receipts.db')
        self.addCleanup(self.receipts.close)

    def task(self):
        return {'id': 'operation-one', 'tool': 'write_file', 'arguments': {'path': str(self.root/'once.txt'), 'text': 'once', 'expected_sha256': 'NEW', 'request_id': 'write-003'}}

    def test_duplicate_task_returns_receipt_without_rewriting(self):
        first = self.receipts.execute(self.task(), self.actions)
        before = (self.root/'once.txt').stat().st_mtime_ns
        self.assertEqual(first, self.receipts.execute(self.task(), self.actions))
        self.assertEqual((self.root/'once.txt').stat().st_mtime_ns, before)
        self.assertEqual(len(self.receipts.pending()), 1)
        self.receipts.ack('operation-one')
        self.assertEqual(self.receipts.pending(), [])

    def test_restarted_agent_preserves_receipt(self):
        first = self.receipts.execute(self.task(), self.actions)
        other = self.module.Receipts(self.root/'receipts.db')
        try: self.assertEqual(first, other.execute(self.task(), self.actions))
        finally: other.close()

    def test_crash_during_execution_never_replays(self):
        with self.receipts.lock:
            self.receipts.db.execute('INSERT INTO receipts(id,status,result,ack,created) VALUES(?,?,?,?,?)', ('operation-one', 'running', None, 0, time.time()))
            self.receipts.db.commit()
        result = self.receipts.execute(self.task(), self.actions)
        self.assertEqual(result['status'], 'error')
        self.assertEqual(result['error'], 'PREVIOUS_EXECUTION_OUTCOME_UNKNOWN_NO_REPLAY')
        self.assertFalse((self.root/'once.txt').exists())


if __name__ == '__main__': unittest.main()

class ProcessTreeTest(unittest.TestCase):
    @unittest.skipIf(__import__('os').name=='nt','Windows job tree is covered by native smoke')
    def test_exited_parent_child_is_still_killed_on_timeout(self):
        import os
        import signal
        from remote_app.actions import Actions
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);actions=Actions(root,root/'app');pidfile=root/'child.pid'; marker=root/'heartbeat'
            child="import time,pathlib; p=pathlib.Path("+repr(str(marker))+");\nwhile True: p.write_text(str(time.time_ns())); time.sleep(.02)"
            script="import subprocess,sys,pathlib; p=subprocess.Popen([sys.executable,'-c',"+repr(child)+"]); pathlib.Path("+repr(str(pidfile))+").write_text(str(p.pid))"
            job=actions.run({'shell':'python','command':script,'timeout_seconds':1})
            deadline=time.monotonic()+4
            while time.monotonic()<deadline and actions.commands[job['command_id']]['process'].poll() is None: time.sleep(.03)
            self.assertEqual(actions.commands[job['command_id']]['process'].poll(),0)
            while time.monotonic()<deadline and not marker.exists(): time.sleep(.03)
            actions.stop_all()
            pid=int(pidfile.read_text())
            try:
                time.sleep(.1); before=marker.read_text();time.sleep(.15);self.assertEqual(marker.read_text(),before,'child survived stop_all')
            finally:
                try: os.kill(pid,signal.SIGKILL)
                except ProcessLookupError: pass
                actions.stop_all()

class CleanupTest(unittest.TestCase):
    def test_restart_cleanup_removes_expired_command_files(self):
        from remote_app.actions import Actions
        import os
        with tempfile.TemporaryDirectory() as directory:
            app=Path(directory)/'app';commands=app/'commands';commands.mkdir(parents=True)
            old=commands/'old.out';old.write_text('private');os.utime(old,(time.time()-1000,time.time()-1000))
            actions=Actions(directory,app)
            actions.cleanup()
            self.assertFalse(old.exists())
    def test_receipt_cleanup_runs_without_new_ack(self):
        from remote_app.agent import Receipts
        with tempfile.TemporaryDirectory() as directory:
            receipts=Receipts(Path(directory)/'receipts.db')
            try:
                receipts.db.execute('INSERT INTO receipts VALUES(?,?,?,?,?)',('id','completed','{"secret":"private"}',1,time.time()-1000));receipts.db.commit()
                receipts.cleanup()
                self.assertIsNone(receipts.db.execute('SELECT result FROM receipts').fetchone()[0])
            finally: receipts.close()
