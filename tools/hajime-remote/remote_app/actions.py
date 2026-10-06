import base64
import hashlib
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

from .protocol import validate_tool

OUTPUT_MAX = 1_000_000


class Actions:
    def __init__(self, root, app_dir, desktop=None):
        self.root = Path(root).resolve()
        self.app_dir = Path(app_dir).resolve()
        self.app_dir.mkdir(parents=True, exist_ok=True)
        self.commands = {}
        self.command_lock = threading.RLock()
        self.paused = threading.Event()
        self.desktop = desktop
        self.cleanup()

    def cleanup(self):
        with self.command_lock:
            active={str(j['output_path']) for j in self.commands.values() if not j['done'].is_set()}
            for file in (self.app_dir/'commands').glob('*'):
                if str(file) not in active and file.suffix in ('.out','.py','.ps1') and time.time()-file.stat().st_mtime>900:
                    file.unlink(missing_ok=True)
            for key,job in list(self.commands.items()):
                if job['done'].is_set() and time.time()-job['created']>900:
                    job['output_path'].unlink(missing_ok=True);del self.commands[key]

    def path(self, raw, allow_directory=False):
        path = Path(raw).expanduser()
        if not path.is_absolute(): path = self.root / path
        path = path.resolve()
        try: path.relative_to(self.root)
        except ValueError: raise ValueError('PATH_OUTSIDE_USER_ROOT') from None
        protected_names = {'.ssh', '.aws', '.azure', '.gnupg', '.env', 'credentials', 'login data', 'cookies', 'local state', 'config.json'}
        if (path == self.app_dir or self.app_dir in path.parents
                or any(part.lower() in protected_names or part.lower().startswith('.env.') for part in path.parts)
                or path.suffix.lower() in ('.pem', '.key', '.pfx', '.p12', '.kdbx')):
            raise ValueError('PRIVATE_CREDENTIAL_PATH_DENIED')
        if not allow_directory and path.is_dir(): raise ValueError('FILE_REQUIRED')
        return path

    def execute(self, tool, args):
        validate_tool(tool, args)
        if self.paused.is_set(): raise ValueError('PC_PAUSED_NO_ACTION_SENT')
        if tool == 'screenshot':
            if not self.desktop: raise ValueError('WINDOWS_DESKTOP_NOT_AVAILABLE')
            return self.desktop.screenshot()
        if tool == 'desktop_actions':
            if not self.desktop: raise ValueError('WINDOWS_DESKTOP_NOT_AVAILABLE')
            return self.desktop.perform(args['capture_id'], args['actions'], self.paused)
        if tool == 'list_windows':
            if not self.desktop: raise ValueError('WINDOWS_DESKTOP_NOT_AVAILABLE')
            return {'windows': self.desktop.windows()}
        if tool == 'list_files':
            path = self.path(args['path'], True)
            if not path.is_dir(): raise ValueError('DIRECTORY_REQUIRED')
            entries = []
            for item in sorted(path.iterdir(), key=lambda x: x.name.lower()):
                if len(entries) >= 500: break
                try:
                    self.path(str(item), True)
                    entries.append({'name': item.name, 'directory': item.is_dir(), 'size': item.stat().st_size})
                except (ValueError, OSError): continue
            return {'path': str(path), 'entries': entries, 'limit': 500}
        if tool == 'read_file':
            path = self.path(args['path'])
            if path.stat().st_size > OUTPUT_MAX: raise ValueError('TEXT_FILE_TOO_LARGE')
            raw = path.read_bytes()
            offset, limit = args.get('offset', 0), args.get('limit', 65536)
            return {'path': str(path), 'text': raw[offset:offset+limit].decode('utf8', errors='replace'),
                    'sha256': hashlib.sha256(raw).hexdigest(), 'next_offset': min(len(raw), offset+limit), 'size': len(raw)}
        if tool == 'write_file': return self.write(args)
        if tool == 'run_command': return self.run(args)
        if tool == 'get_command_output': return self.output(args)
        if tool == 'stop_command':
            job = self.command(args['command_id'])
            self.terminate(job)
            return {'command_id': args['command_id'], 'stopped': True}
        raise ValueError('UNSUPPORTED_PC_TOOL')

    def write(self, args):
        path = self.path(args['path'])
        expected = args['expected_sha256']
        def check():
            if expected == 'NEW':
                if path.exists(): raise ValueError('FILE_ALREADY_EXISTS')
            elif not path.is_file() or path.stat().st_size > OUTPUT_MAX or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise ValueError('FILE_CHANGED_READ_AGAIN')
        check()
        raw = args['text'].encode('utf8')
        if len(raw) > OUTPUT_MAX: raise ValueError('TEXT_FILE_TOO_LARGE')
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(prefix='.hajime-write-', dir=path.parent)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(raw); stream.flush(); os.fsync(stream.fileno())
            check()
            if self.paused.is_set(): raise ValueError('PC_PAUSED_NO_ACTION_SENT')
            if expected == 'NEW':
                # Hard-link publication fails atomically if another process created it.
                os.link(temp, path)
                os.unlink(temp)
            else: os.replace(temp, path)
        finally:
            if os.path.exists(temp): os.unlink(temp)
        return {'path': str(path), 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes_written': len(raw)}

    def command(self, key):
        with self.command_lock:
            if key not in self.commands: raise ValueError('COMMAND_NOT_FOUND_OR_AGENT_RESTARTED')
            return self.commands[key]

    def run(self, args):
        cwd = self.path(args.get('cwd', str(self.root)), True)
        if not cwd.is_dir(): raise ValueError('COMMAND_CWD_NOT_DIRECTORY')
        with self.command_lock:
            if sum(1 for j in self.commands.values() if not j['done'].is_set()) >= 4:
                raise ValueError('TOO_MANY_RUNNING_COMMANDS')
            # Bounded command history; output files are local and expire.
            for key, job in list(self.commands.items()):
                if job['done'].is_set() and time.time() - job['created'] > 900:
                    job['output_path'].unlink(missing_ok=True)
                    del self.commands[key]
            if len(self.commands) >= 100: raise ValueError('COMMAND_HISTORY_FULL_WAIT_FOR_EXPIRY')
            key = uuid.uuid4().hex
            directory = self.app_dir / 'commands'
            directory.mkdir(exist_ok=True)
            script = directory / (key + ('.py' if args['shell'] == 'python' else '.ps1'))
            script.write_text(args['command'], encoding='utf8')
            output = directory / (key + '.out')
            if args['shell'] == 'python':
                python = Path(sys.executable)
                if python.name.lower() == 'pythonw.exe': python = python.with_name('python.exe')
                argv = [str(python), '-u', '-X', 'utf8', str(script)]
            elif os.name == 'nt':
                wrapper = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;$ErrorActionPreference='Stop'; & ([ScriptBlock]::Create([IO.File]::ReadAllText('" + str(script).replace("'", "''") + "',[Text.Encoding]::UTF8)))"
                encoded = base64.b64encode(wrapper.encode('utf-16le')).decode()
                argv = ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]
            else:
                script.unlink(missing_ok=True)
                raise ValueError('POWERSHELL_REQUIRES_WINDOWS')
            options = {'cwd': str(cwd), 'stdout': subprocess.PIPE, 'stderr': subprocess.STDOUT, 'stdin': subprocess.DEVNULL}
            if os.name == 'nt': options['creationflags'] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP | 4
            else: options['start_new_session'] = True
            if self.paused.is_set():
                script.unlink(missing_ok=True); raise ValueError('PC_PAUSED_NO_ACTION_SENT')
            tree = None
            if os.name == 'nt':
                from .process_job import Job
                tree = Job()
            try:
                process = subprocess.Popen(argv, **options)
                if tree: tree.attach_and_resume(process)
            except Exception:
                if tree:
                    tree.close()
                    if 'process' in locals(): process.kill()
                script.unlink(missing_ok=True); raise
            job = {'process': process, 'output_path': output, 'done': threading.Event(), 'timed_out': False,
                   'tree': tree, 'truncated': False, 'created': time.time(), 'lock': threading.RLock()}
            self.commands[key] = job
            output.write_bytes(b'')
        def collect():
            total = 0
            try:
                with output.open('ab') as stream:
                    while True:
                        chunk = process.stdout.read(4096)
                        if not chunk: break
                        if total < OUTPUT_MAX:
                            stream.write(chunk[:OUTPUT_MAX-total]); stream.flush()
                        total += len(chunk)
                        if total > OUTPUT_MAX: job['truncated'] = True
                process.wait()
            finally:
                process.stdout.close()
                script.unlink(missing_ok=True)
                if tree:
                    with job['lock']: tree.close()
                job['done'].set()
        def deadline():
            if not job['done'].wait(args.get('timeout_seconds', 120)):
                job['timed_out'] = True
                self.terminate(job)
        threading.Thread(target=collect, daemon=True).start()
        threading.Thread(target=deadline, daemon=True).start()
        return {'command_id': key, 'running': True, 'instruction': 'Poll get_command_output for exit status.'}

    def output(self, args):
        job = self.command(args['command_id'])
        offset, limit = args.get('offset', 0), args.get('limit', 65536)
        with job['output_path'].open('rb') as stream:
            stream.seek(offset); raw = stream.read(limit)
        return {'command_id': args['command_id'], 'output': raw.decode('utf8', errors='replace'),
                'next_offset': offset + len(raw), 'running': not job['done'].is_set(),
                'exit_code': job['process'].poll(), 'timed_out': job['timed_out'], 'truncated': job['truncated']}

    def terminate(self, job):
        with job['lock']:
            process = job['process']
            if os.name == 'nt':
                job['tree'].stop()
            else:
                try: os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError: pass
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: process.kill()

    def stop_all(self):
        with self.command_lock: jobs = list(self.commands.values())
        for job in jobs: self.terminate(job)
