import hashlib
import json
import sqlite3
import threading
import time
import uuid


class Store:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
        PRAGMA journal_mode=WAL;
        PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, seen REAL, info TEXT);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, device TEXT, request_id TEXT,
          tool TEXT, args TEXT, digest TEXT, status TEXT, result TEXT, created REAL, updated REAL,
          UNIQUE(device, request_id));
        CREATE TABLE IF NOT EXISTS auth_items(kind TEXT, id TEXT, data TEXT, expires REAL,
          PRIMARY KEY(kind,id));
        ''')
        self.db.commit()

    def close(self):
        self.db.close()

    def put(self, kind, key, data, ttl):
        with self.lock:
            self.db.execute('INSERT OR REPLACE INTO auth_items VALUES(?,?,?,?)',
                            (kind, key, json.dumps(data), time.time() + ttl))
            self.db.commit()

    def get(self, kind, key):
        with self.lock:
            row = self.db.execute('SELECT data,expires FROM auth_items WHERE kind=? AND id=?', (kind, key)).fetchone()
            return json.loads(row['data']) if row and row['expires'] > time.time() else None

    def remove(self, kind, key):
        with self.lock:
            self.db.execute('DELETE FROM auth_items WHERE kind=? AND id=?', (kind, key))
            self.db.commit()

    def heartbeat(self, device, info):
        # Retain only non-secret machine metadata, never the whole agent payload.
        info = {k: info[k] for k in ('paused', 'name', 'version', 'desktop_available', 'pause_epoch') if k in info}
        with self.lock:
            previous=self.device(device)
            self.db.execute('INSERT OR REPLACE INTO devices VALUES(?,?,?)', (device, time.time(), json.dumps(info)))
            if info.get('paused') or (previous.get('pause_epoch') is not None and info.get('pause_epoch')!=previous.get('pause_epoch')):
                self.db.execute("UPDATE jobs SET status='cancelled',args='{}',updated=? WHERE device=? AND status='queued'", (time.time(), device))
            self.db.commit()

    def device(self, device):
        with self.lock:
            row = self.db.execute('SELECT seen,info FROM devices WHERE id=?', (device,)).fetchone()
            if not row:
                return {'connected': False, 'paused': True}
            return {**json.loads(row['info']), 'connected': time.time() - row['seen'] < 60, 'last_seen': row['seen']}

    def enqueue(self, device, tool, args, request_id):
        raw = json.dumps(args, sort_keys=True, separators=(',', ':'))
        digest = hashlib.sha256((tool + raw).encode()).hexdigest()
        with self.lock:
            existing = self.db.execute('SELECT id,digest FROM jobs WHERE device=? AND request_id=?', (device, request_id)).fetchone()
            if existing:
                if existing['digest'] != digest:
                    raise ValueError('REQUEST_ID_REUSED_WITH_DIFFERENT_ACTION')
                return existing['id']
            state = self.device(device)
            if not state['connected']:
                raise ValueError('PC_OFFLINE_NO_ACTION_SENT')
            if state.get('paused'):
                raise ValueError('PC_PAUSED_NO_ACTION_SENT')
            pending = self.db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0]
            if pending >= 32:
                raise ValueError('OPERATION_QUEUE_FULL')
            key = uuid.uuid4().hex
            now = time.time()
            self.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?)',
                            (key, device, request_id, tool, raw, digest, 'queued', None, now, now))
            self.db.commit()
            return key

    def lease(self, device):
        with self.lock:
            now = time.time()
            # A vanished agent must not cause automatic replay of an action.
            self.db.execute("UPDATE jobs SET status='unknown',args='{}',updated=? WHERE status='running' AND updated<?", (now, now - 180))
            self.db.execute("UPDATE jobs SET status='cancelled',args='{}',updated=? WHERE status='queued' AND created<?", (now, now - 30))
            row = None
            if not self.device(device).get('paused'):
                row = self.db.execute("SELECT * FROM jobs WHERE device=? AND status='queued' ORDER BY created LIMIT 1", (device,)).fetchone()
            if row:
                self.db.execute("UPDATE jobs SET status='running',updated=? WHERE id=?", (now, row['id']))
            self.db.commit()
            return {'id': row['id'], 'tool': row['tool'], 'arguments': json.loads(row['args']), 'created': row['created']} if row else None

    def finish(self, device, operation, result):
        raw = json.dumps(result)
        if len(raw.encode()) > 6_000_000:
            raise ValueError('RESULT_TOO_LARGE')
        with self.lock:
            row = self.db.execute('SELECT status FROM jobs WHERE id=? AND device=?', (operation, device)).fetchone()
            if not row:
                raise ValueError('OPERATION_NOT_FOUND')
            if row['status'] == 'completed':
                return
            if row['status'] not in ('running', 'unknown'):
                raise ValueError('OPERATION_NOT_LEASED')
            self.db.execute("UPDATE jobs SET status='completed',args='{}',result=?,updated=? WHERE id=?", (raw, time.time(), operation))
            self.db.commit()

    def result(self, device, operation):
        with self.lock:
            row = self.db.execute('SELECT id,status,result,created FROM jobs WHERE id=? AND device=?', (operation, device)).fetchone()
            if not row:
                raise ValueError('OPERATION_NOT_FOUND')
            result = json.loads(row['result']) if row['result'] else None
            return {'operation_id': row['id'], 'status': row['status'], 'result': result}

    def cleanup(self):
        with self.lock:
            now = time.time()
            # Keep deduplication tombstones, but scrub private inputs/results.
            self.db.execute("UPDATE jobs SET args='{}',result=NULL,status=CASE WHEN status='completed' THEN 'expired' ELSE status END WHERE updated<?", (now - 900,))
            self.db.execute('DELETE FROM jobs WHERE created<?', (now - 30 * 86400,))
            self.db.execute('DELETE FROM auth_items WHERE expires<?', (now,))
            self.db.commit()
