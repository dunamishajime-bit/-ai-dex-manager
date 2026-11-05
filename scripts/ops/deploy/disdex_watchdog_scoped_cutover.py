"""Root SSH, exact-plan watchdog-only certification. Never changes runner units.

Audit-only first; existing bounded recovery resumes only after three genuine
cycles with no recovery intent. No token, owner artifact or trading permission
is synthesized by this helper. The source is the already certified monitor pin.
"""
import argparse,hashlib,json,os,re,subprocess,time,uuid
from pathlib import Path
from types import SimpleNamespace
from disdex_deployment_plan import canonical
from disdex_monitor_snapshot_cutover import (TRADING,WATCHDOG,WATCHDOG_SCRIPT,require,
    choose_monitor_dropin,protected_monitor_context,validate_live_observation)

ROOT=Path('/var/lib/disdex/unified-deploy')
HEALTH=Path('/var/lib/disdex/runner-health')

def snapshot_ready_for_audit(row,now):
    stamp=row.get('generatedAt')
    require(type(stamp) is int and 0<stamp<=now,'WATCHDOG_SNAPSHOT_TIMESTAMP_INVALID')
    return now-stamp<=60000

def validate_audit(row,sha,now,*,audit_only):
    require(row.get('auditOnly') is audit_only and row.get('releaseSha')==sha
        and row.get('exitCode')==0 and row.get('restartCalls')==[] and row.get('errors')==[],'WATCHDOG_AUDIT_IDENTITY')
    at=row.get('observedAt');require(type(at) is int and 0<=now-at<=60000,'WATCHDOG_AUDIT_FRESHNESS')
    for key,ids in [('decisions',TRADING),('dependencies',{'SHARED_CRYPTO_RISK','MARGIN_GUARD'})]:
        rows=row.get(key,{})
        require(set(rows)==ids and all(r.get('action')=='NOOP' for r in rows.values()),'WATCHDOG_NON_NOOP')
    effects=row.get('tradingEffects',{})
    require(all(type(effects.get(k)) is int and effects[k]==0 for k in ['ordersSent','cancelSent','positionChangesSent']),'WATCHDOG_TRADING_EFFECT')
    return at

def render_watchdog_unit(root,env,sha,*,audit_only):
    require(re.fullmatch('[a-f0-9]{40}',sha) and root=='/home/deploy/disdex-trading/releases/'+sha,'WATCHDOG_SOURCE')
    require(env=='/etc/disdex/current-runtime/'+sha+'-watchdog.env','WATCHDOG_ENV_PATH')
    return ('[Service]\nEnvironmentFile='+env+'\nWorkingDirectory='+root+'\n'
        'ExecStartPre=\nExecStartPre=/usr/bin/test -f '+root+'/.disdex-release-sha\n'
        'ExecStartPre=/usr/bin/grep -Fxq '+sha+' '+root+'/.disdex-release-sha\n'
        'ExecStart=\nExecStart=/usr/bin/python3 /usr/local/libexec/disdex-unified/disdex_watchdog_exec.py --sha '+sha+(' --audit-only' if audit_only else '')+'\n')

def run_transaction(ops):
    ops.prepare();ops.authorize()
    try:
        ops.publish();times=ops.audit();require(len(times)==3 and times==sorted(set(times)),'WATCHDOG_THREE_CYCLES')
        ops.enable_recovery();return ops.commit(times)
    except Exception:
        ops.rollback();raise

class Operations:
    def __init__(self,expected_hash):self.expected_hash=expected_hash;self.created=[];self.published=False
    def file(self,p):
        from disdex_shared_risk_witness import file_bytes
        return file_bytes(Path(p))
    def command(self,*args):
        require(bool(args) and (args[0]=='show' or args==('daemon-reload',)
            or args==('start',WATCHDOG)),'WATCHDOG_MUTATION_SCOPE')
        r=subprocess.run(['/usr/bin/systemctl',*args],capture_output=True,text=True,timeout=40)
        require(r.returncode==0,'WATCHDOG_SYSTEMD_'+args[0]);return r.stdout.strip()
    def hashes(self):return {str(p):hashlib.sha256(self.file(p)).hexdigest() for p in sorted(self.freeze_files)}
    def protected(self):
        require(protected_monitor_context(self.reader.read_context())==self.context,'WATCHDOG_PEER_IDENTITY_CHANGED')
        require(self.hashes()==self.frozen,'WATCHDOG_CONFIGURATION_OR_AUTHORITY_CHANGED')
        require(Path('/home/deploy/disdex-trading/current').readlink()==self.current_link,'WATCHDOG_CURRENT_LINK_CHANGED')
    def prepare(self):
        from disdex_unified_root_gate import assert_codex_ssh_session,read_root_json,parse_live_pins,release_marker,assert_regular_secure,assert_root_trusted_dir
        from disdex_shared_risk_witness import ProductionSharedRiskReader
        from disdex_v4_monitor_cutover import systemd_environment_files
        assert_codex_ssh_session();self.current=read_root_json(ROOT/'current-plan.json');self.sha=self.current['monitorSha']
        releases=Path('/home/deploy/disdex-trading/releases');self.release=release_marker(self.sha,releases)
        manifest=read_root_json(Path('/etc/disdex/runner-pins.json'),private=False);self.pins=parse_live_pins(manifest,releases=releases)
        require(self.current['runners']==self.pins,'WATCHDOG_CURRENT_MAP')
        self.baseline=json.loads(self.file(HEALTH/'current.json'));validate_live_observation(self.baseline,self.pins,time.time_ns()//1000000,self.baseline)
        self.reader=ProductionSharedRiskReader();self.context=protected_monitor_context(self.reader.read_context())
        self.current_link=Path('/home/deploy/disdex-trading/current').readlink()
        self.freeze_files={ROOT/'current-plan.json',Path('/etc/disdex/runner-pins.json'),Path(__file__),Path(__file__).with_name('disdex_watchdog_exec.py')}
        self.env_path=Path('/etc/disdex/current-runtime')/(self.sha+'-watchdog.env')
        props=self.command('show',WATCHDOG,'-p','DropInPaths','-p','EnvironmentFiles','-p','FragmentPath','-p','ExecStart','-p','WorkingDirectory')
        self.before_properties=props;properties=dict(x.split('=',1) for x in props.splitlines() if '=' in x)
        self.dropin=choose_monitor_dropin(properties.get('DropInPaths','').split(),self.sha,WATCHDOG)
        for p in [self.dropin.parent,self.env_path.parent]:assert_root_trusted_dir(p)
        self.freeze_files.update(Path(p) for p in properties.get('DropInPaths','').split())
        self.freeze_files.update(Path(p) for p in systemd_environment_files(props))
        self.freeze_files.add(Path(properties['FragmentPath']))
        env=dict(DISDEX_WATCHDOG_RELEASE_ROOT=str(self.release),DISDEX_WATCHDOG_EXPECTED_SHA=self.sha,
            DISDEX_WATCHDOG_APPROVED_SHA=self.sha,DISDEX_WATCHDOG_V12_MODE='V4')
        prefixes={'V12_V4':'V12','QUALITY102_CAUSAL_V1':'Q102','V52':'V52','PENGU_V8':'PENGU',
            'FET_BRK48_RESIDUAL':'FET','HYPE_TREND_LONG':'HYPE','IDLE_PRIORITY_SHORT':'IDLE'}
        for key,prefix in prefixes.items():
            p=manifest['runners'][key];name='DISDEX_WATCHDOG_'+prefix+'_'
            env.update({name+'EXPECTED_SHA':p['sha'],name+'RELEASE_ROOT':p['releaseRoot'],name+'SERVICE_UNIT':p['serviceUnit'],name+'EVIDENCE_MODE':p.get('evidenceMode','legacy')})
            pre=self.command('show',p['serviceUnit'],'-p','ExecStartPre')
            paths=list(dict.fromkeys(re.findall(r'--activation-path\s+([^\s;]+)',pre)))
            if key=='V12_V4':paths=['/var/lib/disdex/shared/operator-activation/v12-v4-full.json']
            require(bool(paths),'WATCHDOG_OPERATOR_PATH_REQUIRED')
            for path in paths:self.freeze_files.add(Path(path))
            env[name+'OPERATOR_ACTIVATION_PATH']=paths[0]
        for key,prefix in [('SHARED_CRYPTO_RISK','SHARED_RISK'),('MARGIN_GUARD','MARGIN_GUARD')]:
            env['DISDEX_WATCHDOG_'+prefix+'_EXPECTED_SHA']=self.pins[key]
        for name in [WATCHDOG_SCRIPT,'scripts/ops/root/disdex-live-operator-activation-gate.mjs','lib/disdex-v4-canonical-operator-binding.mjs','lib/disdex-watchdog-audit-mode.mjs']:
            p=self.release/name;require(not assert_regular_secure(p,private=False).st_mode&0o222,'WATCHDOG_IMMUTABLE_SOURCE');self.freeze_files.add(p)
        for path in self.freeze_files:assert_regular_secure(path,private=False)
        self.frozen=self.hashes();self.env=env
        require(not self.dropin.exists() and not self.env_path.exists(),'WATCHDOG_TARGET_ALREADY_EXISTS')
        self.preview=HEALTH/'private'/('watchdog-certification-'+uuid.uuid4().hex);self.preview.mkdir(mode=0o700)
        self.plan=dict(schema='disdex-watchdog-scoped-plan/v1',sourceSha=self.sha,scope='API_MONITORS',ordersEnabled=False,
            deploymentTarget='professional-dismanager.net',operatorTarget='DD1296_FINAL_ALLIN_10BPS',route='CODEX_SSH',
            runners=self.pins,protectedContext=self.context,protectedFileHashes=self.frozen,
            mutations=[str(self.dropin),str(self.env_path)],serviceUnits=[WATCHDOG],
            auditOnlyThenRestoreExistingBoundedRecovery=True,environment=self.env)
        self.plan_hash=hashlib.sha256(canonical(self.plan)).hexdigest();self.probe(audit_only=True)
        return self.plan
    def probe(self,*,audit_only):
        env={**self.env,'PATH':'/usr/bin:/bin','HOME':'/root'}
        for key,name in [('STATE','state'),('AUDIT','audit'),('LOCK','lock')]:env['DISDEX_WATCHDOG_'+key+'_PATH']=str(self.preview/(name+'.json'))
        result=subprocess.run(['/usr/bin/node',str(self.release/WATCHDOG_SCRIPT),'--audit-only'],cwd=self.release,env=env,text=True,capture_output=True,timeout=40)
        require(result.returncode==0,'WATCHDOG_PREVIEW_FAILED')
        row=json.loads(self.file(self.preview/'audit.json'));validate_audit(row,self.sha,time.time_ns()//1000000,audit_only=True)
        self.protected();return row
    def authorize(self):
        from disdex_unified_root_gate import assert_codex_ssh_session,build_codex_ssh_authorization,_consume_codex_ssh_nonce
        from disdex_pending_maintenance_install import _new_file,_directory
        assert_codex_ssh_session();require(self.expected_hash==self.plan_hash,'WATCHDOG_EXACT_PLAN_APPROVAL')
        self.protected();args=SimpleNamespace(route='CODEX_SSH',owner='codex-ssh',_codex_ssh_authenticated=True,
            sha=self.sha,scope='API_MONITORS',orders_enabled='false',plan_sha256=self.plan_hash)
        self.auth=build_codex_ssh_authorization(args);_consume_codex_ssh_nonce(ROOT/'nonces',self.auth['nonce'],root_uid=0)
        folder=ROOT/'watchdog-transactions';_directory(folder);self.journal=folder/(self.auth['nonce']+'.json')
        _new_file(self.journal,canonical(dict(plan=self.plan,authorization=self.auth,beforeServiceProperties=self.before_properties))+b'\n',0o400,lambda:None)
    def publish(self):
        from disdex_pending_maintenance_install import _new_file
        self.protected()
        self.env_raw=('\n'.join(k+'='+v for k,v in sorted(self.env.items()))+'\n').encode()
        self.audit_unit=render_watchdog_unit(str(self.release),str(self.env_path),self.sha,audit_only=True).encode()
        for p,raw,mode in [(self.env_path,self.env_raw,0o600),(self.dropin,self.audit_unit,0o644)]:
            _new_file(p,raw,mode,lambda p=p:self.created.append(p))
        self.command('daemon-reload');self.published=True;self.protected()
    def audit(self):
        times=[];ticks=[];deadline=time.monotonic()+600;self.deferred_snapshot_reads=0
        while len(times)<3:
            require(time.monotonic()<deadline,'WATCHDOG_REAL_CYCLE_TIMEOUT');self.protected();self.command('start',WATCHDOG)
            row=json.loads(self.file(HEALTH/'private/watchdog-current-audit.json'))
            at=validate_audit(row,self.sha,time.time_ns()//1000000,audit_only=True)
            health=json.loads(self.file(HEALTH/'current.json'));now=time.time_ns()//1000000
            if not snapshot_ready_for_audit(health,now):
                self.deferred_snapshot_reads+=1;time.sleep(10);continue
            validate_live_observation(health,self.pins,now,self.baseline)
            tick=health['runners']['V12_V4']['actualLastTickAt']
            if at not in times and (not ticks or tick>ticks[-1]):times.append(at);ticks.append(tick)
            if len(times)<3:time.sleep(10)
        self.protected();return times
    def enable_recovery(self):
        from disdex_shared_risk_monitor_wiring import atomic_text
        # New code has made zero restart requests over three independent real
        # V4 cycles. Preserve existing bounded recovery; do not clear budgets.
        self.probe(audit_only=True);self.protected()
        require(self.file(self.dropin)==self.audit_unit,'WATCHDOG_OWN_DROPIN_CAS')
        self.live_unit=render_watchdog_unit(str(self.release),str(self.env_path),self.sha,audit_only=False).encode()
        atomic_text(self.dropin,self.live_unit,(0,0,0o644));self.command('daemon-reload');self.command('start',WATCHDOG)
        row=json.loads(self.file(HEALTH/'private/watchdog-current-audit.json'))
        validate_audit(row,self.sha,time.time_ns()//1000000,audit_only=False);self.protected()
    def commit(self,times):
        from disdex_pending_maintenance_install import _new_file
        self.protected();row=dict(schema='disdex-watchdog-scoped-receipt/v1',status='WATCHDOG_LIVE_PRESERVING_VERIFIED',
            sourceSha=self.sha,scope='API_MONITORS',ordersEnabled=False,authorizesTrading=False,planSha256=self.plan_hash,
            runnerMap=self.pins,serviceUnits=[WATCHDOG],auditTimes=times,boundedRecoveryRestored=True,
            recordedAt=int(time.time()),journal=str(self.journal),ordersSent=0,cancelsSent=0,positionChangesSent=0,
            deferredStaleSnapshotReads=getattr(self,'deferred_snapshot_reads',0))
        path=ROOT/'receipts'/('watchdog-'+self.auth['nonce']+'.json');_new_file(path,canonical(row)+b'\n',0o400,lambda:None)
        return row
    def rollback(self):
        for path in reversed(self.created):
            if path==self.dropin:require(self.file(path) in [self.audit_unit,getattr(self,'live_unit',b'')],'WATCHDOG_ROLLBACK_CAS')
            elif path==self.env_path:require(self.file(path)==self.env_raw,'WATCHDOG_ROLLBACK_CAS')
            path.unlink()
        self.command('daemon-reload')
        if getattr(self,'journal',None):
            from disdex_pending_maintenance_install import _new_file
            row=dict(schema='disdex-watchdog-rollback/v1',status='ROLLED_BACK_WATCHDOG_ONLY',sourceSha=self.sha,
                planSha256=self.plan_hash,journalSha256=hashlib.sha256(self.file(self.journal)).hexdigest(),
                recordedAt=int(time.time()),runnerMap=self.pins,ordersSent=0,cancelsSent=0,positionChangesSent=0)
            _new_file(self.journal.with_suffix('.rollback.json'),canonical(row)+b'\n',0o400,lambda:None)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--plan-sha256');parser.add_argument('--execute',action='store_true');a=parser.parse_args()
    from disdex_unified_root_gate import assert_codex_ssh_session,assert_private_dir,assert_regular_secure
    assert_codex_ssh_session();assert_private_dir(ROOT,root_uid=0)
    from disdex_deployment_serialization import deployment_lock
    with deployment_lock(ROOT,'API_MONITORS',False):
        op=Operations(a.plan_sha256)
        if a.execute:result=run_transaction(op)
        else:op.prepare();result=dict(status='WATCHDOG_READONLY_PREFLIGHT_PASS_NOT_LIVE',planSha256=op.plan_hash,plan=op.plan)
        print(json.dumps(result,sort_keys=True))

if __name__=='__main__':main()
