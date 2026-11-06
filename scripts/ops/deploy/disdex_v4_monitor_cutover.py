"""V4 read-only Production phase; independent of refresh and trading grants."""
import hashlib
import re
import json
import os
from pathlib import Path
import sys
import time
from disdex_deployment_plan import canonical,validate

SCOPE='V12_V4'
SCHEMA='disdex-v4-monitor-activation/v1'
FIELDS={'schema','repository','deploymentTarget','operatorTarget','scope','approvedSha','approvedShaByRunner',
    'planSha256','phase','ordersEnabled','authorizesTrading','authorizesEvidenceRefresh',
    'route','authorizationMethod','nonceDigest','approvedAt','expiresAt','durableStateSha256'}


V4_MONITOR_REQUIRE_FLAT_LEDGER = (
    "if(Object.values(d.state.legs).some(x=>x.qty!==0||!['CLOSED','CANCELLED'].includes(x.status))||"
    "Object.values(d.intents).some(x=>x.stage!=='TERMINAL')||"
    "Object.values(d.protections).some(x=>x.phase!=='CLOSED'))process.exit(2);"
)


def require(value,reason):
    if not value:raise ValueError('V4_MONITOR_'+reason)


def systemd_environment_files(properties):
    # systemctl repeats this property once per EnvironmentFile; dict() would
    # silently discard every entry except the last, hiding unapproved inputs.
    return [path for line in properties.splitlines() if line.startswith('EnvironmentFiles=')
        for path in re.findall(r'/[^\s()]+',line.split('=',1)[1])]


def run_monitor_transaction(operations):
    operations.prepare()
    operations.consume()
    try:
        operations.publish()
        operations.switch()
        ticks=operations.audit()
        require(isinstance(ticks,list) and len(ticks)==3 and ticks==sorted(set(ticks)),
                'THREE_REAL_TICKS_REQUIRED')
        return operations.commit(ticks)
    except Exception as error:
        try:operations.rollback()
        except Exception:raise RuntimeError('V4_MONITOR_ROLLBACK_REQUIRES_RECONCILIATION') from error
        raise


def build_monitor_activation(plan,authorization,now,*,durable_state_hash):
    validate(plan);hashed=hashlib.sha256(canonical(plan)).hexdigest()
    require(plan['scope']==SCOPE and plan['ordersEnabled'] is False
        and plan['sourceSha']==plan['runners']['V12_V4'],'PLAN_SCOPE')
    require(authorization.get('scope')==SCOPE and authorization.get('ordersEnabled') is False
        and authorization.get('sourceSha')==plan['sourceSha'] and authorization.get('planSha256')==hashed,
        'AUTHORIZATION_BINDING')
    route=authorization.get('route');method='ROOT_SSH_SESSION' if route=='CODEX_SSH' else 'OWNER_SIGNED_TOKEN'
    require(route in ['CODEX_SSH','GITHUB_ACTIONS'],'AUTHORIZATION_ROUTE')
    if route=='CODEX_SSH':require(authorization.get('authorizationMethod')==method,'ROOT_AUTHORITY')
    nonce=authorization.get('nonce');require(isinstance(nonce,str) and re.fullmatch('[a-f0-9]{32}',nonce),'NONCE')
    result=dict(schema=SCHEMA,repository=plan['repository'],deploymentTarget=plan['deploymentTarget'],operatorTarget=plan['operatorTarget'],
        scope=SCOPE,approvedSha=plan['sourceSha'],approvedShaByRunner=plan['runners'].copy(),planSha256=hashed,
        phase='MONITOR_ONLY',ordersEnabled=False,authorizesTrading=False,authorizesEvidenceRefresh=False,
        route=route,authorizationMethod=method,nonceDigest=hashlib.sha256(nonce.encode()).hexdigest(),
        approvedAt=authorization.get('issuedAt'),expiresAt=authorization.get('expiresAt'),durableStateSha256=durable_state_hash)
    validate_monitor_activation(result,plan,now)
    return result


def validate_monitor_activation(row,plan,now,committed_receipt=None):
    validate(plan)
    require(isinstance(row,dict) and set(row)==FIELDS,'ACTIVATION_FIELDS')
    require(row['schema']==SCHEMA and row['repository']==plan['repository']
        and row['deploymentTarget']==plan['deploymentTarget'] and row['operatorTarget']==plan['operatorTarget']
        and row['scope']==SCOPE and plan['scope']==SCOPE and row['approvedSha']==plan['sourceSha']
        and row['approvedSha']==plan['runners']['V12_V4'] and row['approvedShaByRunner']==plan['runners']
        and row['planSha256']==hashlib.sha256(canonical(plan)).hexdigest()
        and row['phase']=='MONITOR_ONLY' and row['ordersEnabled'] is False and plan['ordersEnabled'] is False
        and row['authorizesTrading'] is False and row['authorizesEvidenceRefresh'] is False,
        'ACTIVATION_BINDING')
    require((row['route'],row['authorizationMethod']) in [('CODEX_SSH','ROOT_SSH_SESSION'),('GITHUB_ACTIONS','OWNER_SIGNED_TOKEN')]
        and isinstance(row['nonceDigest'],str) and re.fullmatch('[a-f0-9]{64}',row['nonceDigest']),'AUTHORITY_IDENTITY')
    require(isinstance(row['durableStateSha256'],str) and re.fullmatch('[a-f0-9]{64}',row['durableStateSha256']),
            'DURABLE_STATE_HASH')
    issued=row['approvedAt'];expires=row['expiresAt']
    require(type(issued) is int and type(expires) is int and type(now) is int
        and 0<issued<=now and 1<=expires-issued<=300,'APPROVAL_WINDOW')
    if committed_receipt is None:require(now<expires,'APPROVAL_EXPIRED')
    else:
        r=committed_receipt
        require(r.get('status')=='V4_MONITOR_ONLY_VERIFIED' and r.get('ordersEnabled') is False
            and r.get('sourceSha')==row['approvedSha'] and r.get('planSha256')==row['planSha256']
            and r.get('activationSha256')==hashlib.sha256(canonical(row)).hexdigest()
            and r.get('nonceDigest')==row['nonceDigest']
            and type(r.get('deploymentAuthorizedAt')) is int and issued<=r['deploymentAuthorizedAt']<expires
            and type(r.get('committedAt')) is int and r['deploymentAuthorizedAt']<=r['committedAt']<=now,
            'COMMITTED_NO_ORDER_RECEIPT')
        ticks=r.get('auditTickTimes')
        require(isinstance(ticks,list) and len(ticks)==3 and all(type(t) is int and t>0 for t in ticks)
            and ticks==sorted(set(ticks)) and ticks[0]>=r['deploymentAuthorizedAt']*1000
            and ticks[-1]<=r['committedAt']*1000+999,'COMMITTED_THREE_READONLY_CYCLES')
    return row


def validate_monitor_observation(health,tick,*,sha,pid,now,previous_tick):
    require(isinstance(health,dict) and isinstance(tick,dict) and type(pid) is int and pid>0,'OBSERVATION_TYPES')
    expected=dict(runnerId='V12_V4',runtimeSha=sha,expectedSha=sha,serviceUnit='disdex-v12-v4@'+sha+'.service',
        mainPid=pid,workingDirectory='/home/deploy/disdex-trading/releases/'+sha)
    require(all(row.get(k)==v for row in [health,tick] for k,v in expected.items()),'PROCESS_IDENTITY')
    require(health.get('schema')=='disdex-v12-v4-runner-heartbeat/v1' and tick.get('schema')=='disdex-runner-tick/v1'
        and health.get('mode')==health.get('operationMode')=='MONITOR_ONLY'
        and all(row.get('newOrdersAllowed') is False for row in [health,tick])
        and health.get('liveEnabled') is False,'NO_ORDER_PHASE')
    started=tick.get('tickStartedAt');completed=tick.get('tickCompletedAt');heartbeat=health.get('heartbeatAt')
    require(all(type(t) is int and 0<t<=now for t in [started,completed,heartbeat])
        and started<=completed<=heartbeat and health.get('lastTickAt')==completed
        and now-completed<=180000 and (previous_tick is None or completed>previous_tick),'REAL_TICK_FRESHNESS')
    require(all(type(tick.get(k)) is int and tick[k]==0 for k in ['ordersSent','cancelsSent','positionChangesSent']),
            'MUTATION_COUNTERS')
    require(all(type(health.get(k)) is int and health[k]>=0 for k in ['candidateCount','positionCount','openOrderCount','pendingCount']),
            'INCOMPLETE_DECISION')
    return dict(tickStartedAt=started,tickCompletedAt=completed,heartbeatAt=heartbeat,pid=pid,
        mode='MONITOR_ONLY',ordersEnabled=False,candidateCount=health['candidateCount'])


def render_monitor_unit(sha):
    require(isinstance(sha,str) and re.fullmatch('[a-f0-9]{40}',sha),'SOURCE_SHA')
    release='/home/deploy/disdex-trading/releases/'+sha
    broker='disdex-v4-rate-budget-broker@'+sha+'.service'
    return ('[Unit]\nDescription=DisDex V4 formally approved read-only recovery\nAfter=network-online.target '+broker+'\n'
        'Requires='+broker+'\nWants=network-online.target\nOnFailure=disdex-runner-health-alert.service\n'
        'StartLimitIntervalSec=300\nStartLimitBurst=3\n[Service]\nType=simple\nUser=deploy\nGroup=deploy\n'
        'WorkingDirectory='+release+'\nEnvironmentFile=\nEnvironmentFile=/etc/disdex/disdex-v12-aster-credentials.env\n'
        'EnvironmentFile=/etc/disdex/current-runtime/'+sha+'-v4-monitor-only.env\n'
        'UnsetEnvironment=NODE_OPTIONS PYTHONPATH PYTHONHOME\nExecStartPre=\n'
        'ExecStartPre=+/usr/bin/python3 /usr/local/libexec/disdex-unified/disdex_v4_monitor_cutover.py --prestart --sha '+sha+'\n'
        'ExecStart=\nExecStart=/usr/bin/node --import '+release+'/node_modules/tsx/dist/loader.mjs '
        +release+'/scripts/v12-v4-production-runner.ts --monitor-only --daemon\n'
        'Restart=on-failure\nRestartSec=30s\nTimeoutStopSec=30s\nKillSignal=SIGTERM\n'
        'NoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=read-only\n'
        'ReadOnlyPaths=/var/lib/disdex/shared /var/lib/disdex/unified-deploy /home/deploy/disdex-trading/releases /etc/disdex\n'
        'ReadOnlyPaths=/var/lib/disdex/v12-v4/orders.json\n'
        'ReadWritePaths=/var/lib/disdex/v12-v4 /var/lib/disdex/runner-health/ticks\nUMask=0027\n'
        '[Install]\nWantedBy=multi-user.target\n')


def prestart(sha):
    """Read-only root guard for this monitor phase; never mints approvals."""
    from disdex_unified_root_gate import ROOT,PINS,RELEASES,read_root_json,parse_live_pins,release_marker,assert_private_dir,assert_regular_secure
    from disdex_shared_risk_witness import file_bytes
    require(os.geteuid()==0 and re.fullmatch('[a-f0-9]{40}',sha),'ROOT_AND_SHA_REQUIRED')
    root=ROOT/'activations/V12_V4_MONITOR_ONLY'
    assert_private_dir(root)
    activation=read_root_json(root/(sha+'.json'))
    desired=read_root_json(ROOT/'plans/V12_V4'/(sha+'.json'))
    receipt_path=ROOT/'receipts'/('v4-monitor-only-'+sha+'.json')
    receipt=read_root_json(receipt_path) if receipt_path.exists() or receipt_path.is_symlink() else None
    validate_monitor_activation(activation,desired,int(time.time()),receipt)
    release_marker(sha,RELEASES)
    marker=RELEASES/sha/'scripts/v12-v4-production-runner.ts'
    source_info=assert_regular_secure(marker,private=False)
    require(not source_info.st_mode&0o222,'SOURCE_WRITABLE')
    pins=parse_live_pins(read_root_json(PINS,private=False),releases=RELEASES)
    current=read_root_json(ROOT/'current-plan.json');validate(current)
    require(pins==current['runners'] and pins['V12_V4']==sha,'CURRENT_PIN_MISMATCH')
    require(hashlib.sha256(file_bytes(Path('/var/lib/disdex/v12-v4/orders.json'))).hexdigest()==activation['durableStateSha256'],
            'DURABLE_STATE_CHANGED')
    consumed=[]
    for path in (ROOT/'nonces').iterdir():
        if hashlib.sha256(path.name.encode()).hexdigest()==activation['nonceDigest']:
            assert_regular_secure(path,private=True);consumed.append(path)
    require(len(consumed)==1,'CONSUMED_NONCE_NOT_PROVEN')
    return dict(status='V4_MONITOR_PRESTART_NO_ORDER_READY',sourceSha=sha,ordersEnabled=False,
        authorizesTrading=False,authorizesEvidenceRefresh=False)


class V4MonitorOperations:
    """Canonical, dormant-V4-only recovery. No current symlink/state migration."""
    def __init__(self,parent,args,token):
        self.parent=parent;self.args=args;self.token=token;self.paths=parent.paths
        self.systemd=parent.systemd;self.created=[];self.replaced=[];self.stopped_old_monitor=False
        self.old_masked_by_us=False;self.new_started=False;self.broker_started=False
        self.unit='disdex-v12-v4@'+args.sha+'.service'
        self.broker='disdex-v4-rate-budget-broker@'+args.sha+'.service'
        self.old_monitor='disdex-v12-v4-monitor@89a58d02dbc8e80b6c9f649c6fd4e7e8ae5e2d27.service'
        self.orders=Path('/var/lib/disdex/v12-v4/orders.json')
        self.health=Path('/var/lib/disdex/v12-v4/heartbeat.json')
        self.tick=Path('/var/lib/disdex/runner-health/ticks/v12-v4.json')
        self.receipt_path=self.paths.receipts/('v4-monitor-only-'+args.sha+'.json')
        self.activation_dir=self.paths.activation_dir/'V12_V4_MONITOR_ONLY'
        self.activation_path=self.activation_dir/(args.sha+'.json')
        self.unit_path=Path('/etc/systemd/system')/self.unit
        self.env_path=Path('/etc/disdex/current-runtime')/(args.sha+'-v4-monitor-only.env')

    def _command(self,*args):
        import subprocess
        result=subprocess.run(['/usr/bin/systemctl',*args],capture_output=True,text=True,timeout=35)
        require(result.returncode==0,'SYSTEMD_OPERATION_FAILED:'+args[0])
        return result.stdout.strip()

    def _file(self,path):
        from disdex_shared_risk_witness import file_bytes
        return file_bytes(path)

    def _protected(self):
        context=self.reader.read_context()
        # V4 alone changes unit identity. Shared Risk, seven peers, Kill and
        # pending must retain their actual identities/bytes throughout.
        context['peers'].pop('V12_V4')
        context['durableStateHash']=hashlib.sha256(self._file(self.orders)).hexdigest()
        return context

    def _assert_protected(self):
        require(self._protected()==self.protected,'PROTECTED_RUNTIME_CHANGED')

    def _signed_flat(self):
        proof=self.sdk.run_signed_child(self.sdk_release,self.deploy,credentials=self.credentials)
        require(proof.get('status')=='PENDING_READONLY_RECONCILE_VERIFIED'
            and all(type(proof.get(k)) is int and proof[k]==0 for k in
                ['positionCount','openOrderCount','ordersSent','cancelsSent','positionChangesSent']),
                'FRESH_SIGNED_FLAT_PROOF_REQUIRED')
        return proof

    def prepare(self):
        import pwd,subprocess
        from disdex_unified_root_gate import read_root_json,parse_live_pins,release_marker,validate_bootstrap_plan,assert_private_dir,_assert_execution_root
        from disdex_shared_risk_witness import ProductionSharedRiskReader
        from disdex_pending_maintenance_install import _load_sdk
        from disdex_shared_risk_monitor_wiring import SharedRiskMonitorWiring
        _assert_execution_root(self.parent.root_uid)
        require(self.args.scope==SCOPE and self.args.orders_enabled=='false','EXACT_NO_ORDER_SCOPE_REQUIRED')
        for path in [self.paths.root,self.paths.root/'plans/V12_V4',self.paths.nonce_dir,self.paths.activation_dir,self.paths.receipts]:
            assert_private_dir(path,root_uid=self.parent.root_uid)
        self.desired=read_root_json(self.paths.root/'plans/V12_V4'/(self.args.sha+'.json'))
        self.current=read_root_json(self.paths.current_plan)
        self.manifest=read_root_json(self.paths.pins,private=False)
        self.pins=parse_live_pins(self.manifest,releases=self.paths.releases)
        current_sha=self.parent._read_current_sha(unchanged_identity_only=True)
        hashed,changes=validate_bootstrap_plan(self.desired,self.current,self.pins,current_sha)
        require(hashed==self.args.plan_sha256 and self.desired['sourceSha']==self.args.sha
            and changes['changedRunners']==['V12_V4'] and not any(changes[k] for k in ['uiChanged','monitorChanged','releaseRootsChanged']),
            'PLAN_EXCEEDS_SINGLE_RUNNER')
        self.release=release_marker(self.args.sha,self.paths.releases)
        for path in [self.activation_path,self.receipt_path,self.unit_path,self.env_path,
                     Path(str(self.unit_path)+'.d')]:require(not path.exists() and not path.is_symlink(),'EXISTING_TARGET_REQUIRES_SEPARATE_TRANSACTION')
        self.old_unit='disdex-v12-v4@'+self.pins['V12_V4']+'.service'
        require(self.systemd.active_state(self.old_unit) in ['failed','inactive']
            and self.systemd.main_pid(self.old_unit)==0,'OLD_V4_MUST_BE_DORMANT')
        require(not self.systemd.is_active(self.unit) and not self.systemd.is_masked(self.old_unit),'UNEXPECTED_V4_INSTANCE')
        self.old_monitor_active=self.systemd.is_active(self.old_monitor)
        if self.old_monitor_active:
            monitor_pid=self.systemd.main_pid(self.old_monitor)
            expected=self.paths.releases/'89a58d02dbc8e80b6c9f649c6fd4e7e8ae5e2d27'
            require(monitor_pid>0 and Path('/proc',str(monitor_pid),'cwd').resolve(strict=True)==expected,
                    'OLD_MONITOR_CWD_MISMATCH')
            command=self.systemd._state(self.old_monitor,'ExecStart')
            require('v12-v4-monitor-only-runner.ts --daemon' in command and 'v12-v4-production-runner.ts' not in command,
                    'OLD_MONITOR_NOT_READONLY_SOURCE')
        active=self._command('list-units','--no-legend','--plain','--no-pager','--type=service',
            '--state=active,activating,deactivating','disdex-v12-v4-monitor@*.service')
        require([line.split()[0] for line in active.splitlines() if line.strip()]==([self.old_monitor] if self.old_monitor_active else []),
                'UNEXPECTED_PARALLEL_MONITOR')
        self.reader=ProductionSharedRiskReader();self.protected=self._protected()
        self.sdk_release=self.paths.releases/'7b7719c65d2c6116d02463fc4603200f28e20762'
        release_marker(self.sdk_release.name,self.paths.releases)
        self.sdk=_load_sdk(self.sdk_release);self.credentials=self.sdk.load_server_credentials();self.deploy=pwd.getpwnam('deploy')
        self.parent._verify_token(self.args,self.token)
        self.before_signed=self._signed_flat()
        # Replay the existing durable journal with the candidate's actual
        # validator. read() never initializes, rewrites or migrates the store.
        script=("import {V4ExecutionStore} from './lib/v12-v4-execution-store.ts';"
            "const d=new V4ExecutionStore('/var/lib/disdex/v12-v4/orders.json',"+json.dumps(self.pins['V12_V4'])+").read();"
            + V4_MONITOR_REQUIRE_FLAT_LEDGER
            + "console.log(JSON.stringify({durableReplayValidated:true,revision:d.revision}));")
        result=subprocess.run(['/usr/bin/node','--import',str(self.release/'node_modules/tsx/dist/loader.mjs'),
            '--input-type=module','-e',script],cwd=self.release,env={'PATH':'/usr/bin:/bin','HOME':self.deploy.pw_dir},
            user=self.deploy.pw_uid,group=self.deploy.pw_gid,extra_groups=[],capture_output=True,text=True,timeout=15)
        require(result.returncode==0,'DURABLE_REPLAY_OR_FLAT_STATE_INVALID')
        self.reader.read_risk();self._assert_protected()
        self.next_manifest=json.loads(json.dumps(self.manifest));entry=self.next_manifest['runners']['V12_V4']
        entry.update(sha=self.args.sha,serviceUnit=self.unit,releaseRoot=str(self.release),evidenceMode='tick-v1')
        self.next_current={**self.current,'runners':self.desired['runners'].copy()}
        common='7688ed7c93a1918d8b44837339b7da5584a868f5';base=Path('/etc/disdex/current-runtime')
        def values(sha,prefix,unit=False):
            result={prefix+'EXPECTED_SHA':sha,prefix+'RELEASE_ROOT':str(self.paths.releases/sha)}
            if unit:result[prefix+'SERVICE_UNIT']='disdex-v12-v4@'+sha+'.service'
            return result
        self.wiring=SharedRiskMonitorWiring([
            (base/(common+'.health-snapshot.env'),values(self.pins['V12_V4'],'DISDEX_HEALTH_SNAPSHOT_V12_'),values(self.args.sha,'DISDEX_HEALTH_SNAPSHOT_V12_')),
            (base/(common+'.watchdog.env'),values(self.pins['V12_V4'],'DISDEX_WATCHDOG_V12_',True),values(self.args.sha,'DISDEX_WATCHDOG_V12_',True))])
        self.baselines={path:(self._file(path),path.stat()) for path in [self.paths.pins,self.paths.current_plan,self.health]}
        if self.tick.exists():self.baselines[self.tick]=(self._file(self.tick),self.tick.stat())
        self.broker_was_active=self.systemd.is_active(self.broker)
        require(not self.broker_was_active,'CANDIDATE_BROKER_ALREADY_ACTIVE')

    def consume(self):
        self._assert_protected();self.parent._assert_expected_pins(self.pins)
        authorization=self.parent._verify_token(self.args,self.token,nonce_dir=self.paths.nonce_dir)
        self.authorized_at=self.parent.clock()
        self.activation=build_monitor_activation(self.desired,authorization,self.authorized_at,
            durable_state_hash=self.protected['durableStateHash'])

    def publish(self):
        from disdex_pending_maintenance_install import _directory,_new_file
        _directory(self.activation_dir)
        env=dict(NODE_ENV='production',DISDEX_RELEASE_SHA=self.args.sha,DISDEX_RUNTIME_COMMIT_SHA=self.args.sha,
            DISDEX_RELEASE_ROOT=str(self.release),V12_V4_OPERATION_MODE='MONITOR_ONLY',V12_V4_ORDERS_ENABLED='false',
            V12_V4_SERVICE_UNIT=self.unit,V12_V4_HEALTH_STATE_PATH=str(self.health),
            DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH='/var/lib/disdex/shared/aster-rate-budget.json',
            DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET='/run/disdex-v4-budget-'+self.args.sha+'/budget.sock',
            V12_V4_PENDING_READONLY_PROOF_PATH='/var/lib/disdex/v12-v4/monitor/pending-proof.json')
        for path,raw,mode in [(self.activation_path,canonical(self.activation)+b'\n',0o400),
                (self.unit_path,render_monitor_unit(self.args.sha).encode(),0o644),
                (self.env_path,''.join(k+'='+v+'\n' for k,v in env.items()).encode(),0o600)]:
            _new_file(path,raw,mode,lambda p=path:self.created.append(p))
        self._command('daemon-reload')
        execution=self._command('show',self.unit,'-p','ExecStart','-p','ExecStartPre','-p','EnvironmentFiles','-p','ReadWritePaths','-p','User','-p','WorkingDirectory')
        row=dict(line.split('=',1) for line in execution.splitlines() if '=' in line)
        require(row.get('User')=='deploy' and row.get('WorkingDirectory')==str(self.release)
            and '--monitor-only --daemon' in row.get('ExecStart','') and 'cli.mjs' not in row.get('ExecStart','')
            and row['ExecStart'].count('argv[]=')==1
            and row.get('ExecStartPre','').count('argv[]=')==1
            and 'disdex_v4_monitor_cutover.py --prestart --sha '+self.args.sha in row['ExecStartPre']
            and '/var/lib/disdex/shared' not in row.get('ReadWritePaths','').split(),
            'EFFECTIVE_SYSTEMD_NO_ORDER_BOUNDARY')
        files=systemd_environment_files(execution)
        require(files==['/etc/disdex/disdex-v12-aster-credentials.env',str(self.env_path)],'UNEXPECTED_ENVIRONMENT_OVERRIDE')

    def _replace(self,path,raw):
        from disdex_shared_risk_monitor_wiring import atomic_text
        before,meta=self.baselines[path]
        require(self._file(path)==before,'METADATA_CAS_CONFLICT')
        self.replaced.append((path,raw));atomic_text(path,raw,(meta.st_uid,meta.st_gid,meta.st_mode&0o777))

    def switch(self):
        self._assert_protected()
        if self.old_monitor_active:
            self.stopped_old_monitor=True;self.systemd.stop(self.old_monitor)
        self.old_masked_by_us=True;self.systemd.mask(self.old_unit)
        self._replace(self.paths.pins,canonical(self.next_manifest)+b'\n')
        self._replace(self.paths.current_plan,canonical(self.next_current)+b'\n')
        self.wiring.apply()
        self.broker_started=True;self.systemd.start(self.broker)
        self.new_started=True;self.systemd.start(self.unit)

    def audit(self):
        ticks=[];deadline=time.monotonic()+240
        pid=None
        while len(ticks)<3:
            require(time.monotonic()<deadline,'REAL_TICK_AUDIT_TIMEOUT')
            require(not self.systemd.is_active(self.old_unit),'DUPLICATE_V4')
            require(self.systemd.active_state(self.unit)=='active','NEW_UNIT_NOT_ACTIVE')
            current_pid=self.systemd.main_pid(self.unit)
            require(current_pid>0 and (pid is None or current_pid==pid),'PID_CHANGED')
            pid=current_pid
            require(self.systemd._state(self.unit,'NRestarts')=='0','UNEXPECTED_RESTART')
            self._assert_protected();self.parent._assert_expected_pins(self.desired['runners']);self.wiring.assert_applied()
            try:health=json.loads(self._file(self.health));tick=json.loads(self._file(self.tick))
            except FileNotFoundError:self.parent.sleep_fn(2);continue
            if tick.get('runtimeSha')!=self.args.sha or tick.get('tickCompletedAt') in ticks:
                self.parent.sleep_fn(2);continue
            # The real writer publishes tick first and heartbeat second. A
            # read between those two atomic renames is incomplete, not a cycle.
            if health.get('runtimeSha')!=self.args.sha or health.get('lastTickAt')!=tick.get('tickCompletedAt'):
                self.parent.sleep_fn(2);continue
            observation=validate_monitor_observation(health,tick,sha=self.args.sha,pid=pid,now=time.time_ns()//1000000,
                previous_tick=ticks[-1] if ticks else None)
            self._signed_flat();self.reader.read_risk();self._assert_protected()
            ticks.append(observation['tickCompletedAt'])
        return ticks

    def commit(self,ticks):
        from disdex_pending_maintenance_install import _new_file
        result=dict(status='V4_MONITOR_ONLY_VERIFIED',sourceSha=self.args.sha,planSha256=self.args.plan_sha256,
            activationSha256=hashlib.sha256(canonical(self.activation)).hexdigest(),nonceDigest=self.activation['nonceDigest'],
            deploymentAuthorizedAt=self.authorized_at,committedAt=self.parent.clock(),auditTickTimes=ticks,
            ordersEnabled=False,authorizesTrading=False,authorizesEvidenceRefresh=False,
            durableStateSha256=self.protected['durableStateHash'],ordersSent=0,cancelsSent=0,positionChangesSent=0)
        self._assert_protected()
        _new_file(self.receipt_path,canonical(result)+b'\n',0o400,lambda:self.created.append(self.receipt_path))
        self.systemd.enable(self.unit);self.systemd.enable(self.broker)
        return result

    def rollback(self):
        from disdex_shared_risk_monitor_wiring import atomic_text
        errors=[]
        def attempt(fn):
            try:fn()
            except Exception:errors.append(True)
        if self.new_started:attempt(lambda:self.systemd.stop(self.unit));attempt(lambda:self.systemd.disable(self.unit))
        if self.broker_started:attempt(lambda:self.systemd.stop(self.broker));attempt(lambda:self.systemd.disable(self.broker))
        if hasattr(self,'wiring'):attempt(self.wiring.restore)
        for path,expected in reversed(self.replaced):
            def restore(p=path,wanted=expected):
                require(self._file(p) in [wanted,self.baselines[p][0]],'ROLLBACK_CAS_CONFLICT')
                old,meta=self.baselines[p];atomic_text(p,old,(meta.st_uid,meta.st_gid,meta.st_mode&0o777))
            attempt(restore)
        if self.new_started:
            for path in [self.health,self.tick]:
                def restore_health(p=path):
                    if not p.exists():return
                    current=json.loads(self._file(p))
                    if current.get('runtimeSha')!=self.args.sha:return
                    if p in self.baselines:
                        old,meta=self.baselines[p];atomic_text(p,old,(meta.st_uid,meta.st_gid,meta.st_mode&0o777))
                    else:p.unlink()
                attempt(restore_health)
        for path in reversed(self.created):attempt(lambda p=path:p.unlink(missing_ok=True))
        attempt(lambda:self._command('daemon-reload'))
        if self.old_masked_by_us:attempt(lambda:self.systemd.unmask(self.old_unit))
        if self.stopped_old_monitor:attempt(lambda:self.systemd.start(self.old_monitor))
        # The original trading unit was dormant: never restart it on rollback.
        if errors:raise RuntimeError('V4_MONITOR_ROLLBACK_INCOMPLETE')


class V4MonitorRootExecutor:
    def __init__(self,parent):self.parent=parent
    def execute(self,args,token):return run_monitor_transaction(V4MonitorOperations(self.parent,args,token))


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prestart',action='store_true',required=True)
    parser.add_argument('--sha',required=True)
    args=parser.parse_args()
    try:print(json.dumps(prestart(args.sha),sort_keys=True));return 0
    except Exception as error:
        reason=str(error) if isinstance(error,ValueError) and str(error).startswith('V4_MONITOR_') else type(error).__name__
        print(json.dumps(dict(status='V4_MONITOR_PRESTART_FAIL_CLOSED',reason=reason,ordersEnabled=False)),file=sys.stderr)
        return 2


if __name__=='__main__':sys.exit(main())
