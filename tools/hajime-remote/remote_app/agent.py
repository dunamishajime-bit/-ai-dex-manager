import hashlib
import json
import logging
import os
import sqlite3
import threading
import time
import urllib.request
import uuid
from pathlib import Path

from . import __version__


class Receipts:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,status TEXT,result TEXT,ack INTEGER,created REAL)')
        self.db.commit()

    def close(self): self.db.close()

    def execute(self, task, actions):
        with self.lock:
            row = self.db.execute('SELECT * FROM receipts WHERE id=?', (task['id'],)).fetchone()
            if row:
                if row['result']: return json.loads(row['result'])
                # Persist the unknown receipt so it can also be delivered after a crash.
                result = {'status': 'error', 'error': 'PREVIOUS_EXECUTION_OUTCOME_UNKNOWN_NO_REPLAY'}
            else:
                self.db.execute('INSERT INTO receipts VALUES(?,?,?,?,?)', (task['id'], 'running', None, 0, time.time()))
                self.db.commit()
                try: result = {'status': 'ok', **actions.execute(task['tool'], task['arguments'])}
                except (ValueError, OSError) as error: result = {'status': 'error', 'error': str(error)}
                except Exception:
                    logging.exception('Operation failed (arguments omitted)')
                    result = {'status': 'error', 'error': 'PC_OPERATION_FAILED'}
            self.db.execute("UPDATE receipts SET status='completed',result=? WHERE id=?", (json.dumps(result), task['id']))
            self.db.commit()
            return result

    def pending(self):
        with self.lock:
            rows = self.db.execute('SELECT id,result FROM receipts WHERE ack=0 AND result IS NOT NULL').fetchall()
            return [{'operation_id': row['id'], 'result': json.loads(row['result'])} for row in rows]

    def cleanup(self):
        with self.lock:
            # Undelivered private results expire too; retain a safe error receipt.
            self.db.execute("UPDATE receipts SET result=? WHERE ack=0 AND result IS NOT NULL AND created<?", (json.dumps({'status':'error','error':'RESULT_EXPIRED_NO_REPLAY'}),time.time()-900))
            self.db.execute('UPDATE receipts SET result=NULL WHERE ack=1 AND created<?',(time.time()-900,))
            self.db.execute('DELETE FROM receipts WHERE ack=1 AND created<?',(time.time()-30*86400,))
            self.db.commit()

    def ack(self, key):
        with self.lock:
            self.db.execute('UPDATE receipts SET ack=1 WHERE id=?', (key,))
            self.db.commit()
        self.cleanup()


class Agent:
    def __init__(self, config, token, actions, receipts, on_status=None):
        self.config, self.token, self.actions, self.receipts = config, token, actions, receipts
        self.on_status = on_status or (lambda text: None)
        self.stopping = threading.Event()
        self.count = 0
        self.pause_epoch = uuid.uuid4().hex
        self.last_cleanup=0

    def request(self, endpoint, body):
        url = self.config['server_url'].rstrip('/') + '/agent/' + endpoint
        headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.token}
        req = urllib.request.Request(url, json.dumps(body).encode(), headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read(8_000_000)
            return json.loads(raw)

    def pause(self):
        self.actions.paused.set()
        self.pause_epoch=uuid.uuid4().hex

    def pair(self): return self.request('pair', {})

    def poll_once(self):
        self.cleanup()
        for receipt in self.receipts.pending():
            self.request('result', receipt)
            self.receipts.ack(receipt['operation_id'])
        epoch=self.pause_epoch
        task = self.request('poll', {'paused': self.actions.paused.is_set(), 'pause_epoch':epoch, 'name': os.environ.get('COMPUTERNAME', 'Windows PC'),
                                    'version': __version__, 'desktop_available': bool(self.actions.desktop and self.actions.desktop.available())})['task']
        self.on_status('停止中（接続あり）' if self.actions.paused.is_set() else '接続済み・操作待機')
        if task:
            result = {'status':'error','error':'PAUSED_AFTER_LEASE_NO_ACTION_SENT'} if epoch!=self.pause_epoch else self.receipts.execute(task, self.actions)
            self.request('result', {'operation_id': task['id'], 'result': result})
            self.receipts.ack(task['id'])
            self.count += 1

    def cleanup(self):
        if time.monotonic()-self.last_cleanup>30:
            self.receipts.cleanup();self.actions.cleanup();self.last_cleanup=time.monotonic()

    def run(self):
        retry = 1
        while not self.stopping.is_set():
            try:
                self.cleanup();self.poll_once(); retry = 1
            except Exception as error:
                # Network errors can include credential-bearing request objects; log type only.
                logging.warning('Relay connection failure: %s', type(error).__name__)
                self.on_status('再接続待ち：' + type(error).__name__)
                retry = min(30, retry * 2)
            self.stopping.wait(retry)

    def stop(self):
        self.actions.paused.set()
        self.stopping.set()
        self.actions.stop_all()
