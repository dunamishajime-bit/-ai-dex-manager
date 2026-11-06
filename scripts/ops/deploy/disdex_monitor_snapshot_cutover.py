"""Exact no-order API_MONITORS transaction for the health snapshot only.

Runner pins, their services, trading approvals, current symlink and Kill state
are frozen. A consumed scope-bound root/owner approval cannot arm trading.
"""
import copy,hashlib,json,os,re,shlex,subprocess,time,uuid
from pathlib import Path, PurePosixPath
from disdex_deployment_plan import canonical,digest,validate

SERVICE='disdex-runner-health-snapshot.service'
DROPIN=Path('/etc/systemd/system')/(SERVICE+'.d/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-observed-source.conf')
SCRIPT='scripts/ops/root/disdex-runner-health-snapshot-current.mjs'
WATCHDOG='disdex-runner-watchdog.service'
WATCHDOG_SCRIPT='scripts/ops/root/disdex-runner-watchdog-current.mjs'
TRADING={'V12_V4','V52','PENGU_V8','QUALITY102_CAUSAL_V1','FET_BRK48_RESIDUAL','HYPE_TREND_LONG','IDLE_PRIORITY_SHORT'}

def require(value,reason):
    if not value:raise ValueError('MONITOR_SNAPSHOT_'+reason)

def render_snapshot_unit(release,environment,sha):
    return ('[Service]\nEnvironmentFile='+str(environment)+'\nWorkingDirectory='+str(release)+'\n'
        'ExecStartPre=\nExecStartPre=/usr/bin/test -f '+str(release)+'/.disdex-release-sha\n'
        'ExecStartPre=/usr/bin/grep -Fxq '+sha+' '+str(release)+'/.disdex-release-sha\n'
        'ExecStart=\nExecStart=/usr/bin/node '+str(release)+'/'+SCRIPT+'\n'
        'ReadWritePaths=/var/lib/disdex/runner-health\nReadOnlyPaths=/var/lib/disdex/runner-health/ticks\n')

def validate_snapshot_prestart(properties):
    if properties.strip() in ['', 'ExecStartPre=']:return
    commands=re.findall(r'argv\[\]=(.*?) ; ignore_errors=',properties)
    require(not properties.strip() or bool(commands),'UNPARSEABLE_SNAPSHOT_PRESTART')
    for command in commands:
        roots=r'/home/deploy/disdex-trading/(?:releases|runner-health-snapshot/scoped-v52)'
        marker=roots+r'/[a-f0-9]{40}/\.disdex-release-sha'
        allowed=bool(re.fullmatch(r'/usr/bin/test -f '+marker,command))
        match=re.fullmatch(r'/usr/bin/grep -Fxq ([a-f0-9]{40}) '+roots+r'/([a-f0-9]{40})/\.disdex-release-sha',command)
        require(allowed or bool(match and match[1]==match[2]),'UNKNOWN_SNAPSHOT_PRESTART_MUST_BE_PRESERVED')

def choose_snapshot_dropin(paths,sha):
    return choose_monitor_dropin(paths,sha,SERVICE)

def choose_monitor_dropin(paths,sha,service):
    require(service in [SERVICE,WATCHDOG],'MONITOR_SERVICE_ALLOWLIST')
    parent=PurePosixPath('/etc/systemd/system')/(service+'.d')
    require(re.fullmatch('[a-f0-9]{40}',sha),'DROPIN_SHA')
    names=[]
    for path in paths:
        p=PurePosixPath(path)
        require(p.is_absolute() and str(p.parent)==str(parent) and p.name.endswith('.conf')
            and all(part not in ['.','..'] for part in p.parts),'UNTRUSTED_DROPIN_PATH')
        names.append(p.name)
    # Older installations have a near-NAME_MAX run of z characters. A new
    # name must sort last without extending that filename past NAME_MAX.
    for count in range(1,201):
        name='~'*count+'disdex-observed-'+sha[:12]+'.conf'
        if len(name.encode())<=255 and all(name>old for old in names):return Path(str(parent/name))
    raise ValueError('MONITOR_SNAPSHOT_NO_SAFE_FINAL_DROPIN_NAME')

def validate_monitor_plan(desired,current,pins):
    validate(desired);validate(current)
    require(current['runners']==pins and desired['runners']==pins,'RUNNER_MAP_MUST_NOT_CHANGE')
    require(desired['scope']=='API_MONITORS' and desired['ordersEnabled'] is False,'NO_ORDER_SCOPE')
    require(desired['sourceSha']==desired['monitorSha'] and desired['monitorSha']!=current['monitorSha'],'SOURCE_BINDING')
    require(desired['uiSha']==current['uiSha'] and all(desired['releaseRoots'][k]==current['releaseRoots'][k] for k in ['runners','ui'])
        and desired['releaseRoots']['monitor']==desired['releaseRoots']['runners']+'/'+desired['sourceSha'],'EXACT_MONITOR_ROOT')
    return digest(desired,current)[0]

def validate_observation(row,pins,now):
    require(row.get('schema')=='disdex-runner-health-snapshot/v1' and row.get('readOnly') is True,'SNAPSHOT_CONTRACT')
    identity=row.get('targetIdentity',{})
    require(identity.get('valid') is True and identity.get('deploymentTarget')=='professional-dismanager.net'
        and identity.get('operatorTarget')=='DD1296_FINAL_ALLIN_10BPS','TARGET_IDENTITY')
    stamp=row.get('generatedAt')
    require(type(stamp) is int and 0<=now-stamp<=60000,'SNAPSHOT_FRESHNESS')
    require(row.get('newOrdersAllowed') is False and row.get('sharedKillSwitchActive') is True,'EXISTING_PROTECTED_HOLD_REQUIRED')
    runners=row.get('runners');require(isinstance(runners,dict) and set(runners)==TRADING,'RUNNER_INVENTORY')
    for key,runner in runners.items():
        require(runner.get('runtimeSha')==pins[key] and runner.get('expectedSha')==pins[key]
            and runner.get('newOrdersAllowed') is False and str(runner.get('orderPermission','')).startswith('DENIED_'),'RUNNER_PERMISSION_OR_PIN')
        if key in ['V12_V4','V52']:
            actual=runner.get('actualLastTickAt')
            require(runner.get('tickVerified') is True and runner.get('processHealthy') is True and type(actual) is int and 0<=now-actual<=180000
                and runner.get('lastTickAt')==actual,'GENUINE_CURRENT_TICK_REQUIRED')
        else:require(runner.get('tickVerified') is False and runner.get('actualLastTickAt') is None,'LEGACY_NOT_CERTIFIED_AS_TICK')
    v4=runners['V12_V4'];require(v4.get('mode')=='MONITOR_ONLY' and v4.get('liveEnabled') is False,'V4_MUST_REMAIN_MONITOR_ONLY')
    return stamp

def protected_monitor_context(context):
    # Pending maintenance legitimately advances its timestamps under the shared
    # lock. This reader neither authorizes nor changes pending reservations.
    return {k:v for k,v in context.items() if k!='pendingHash'}

def validate_live_observation(row,pins,now,baseline):
    require(row.get('schema')=='disdex-runner-health-snapshot/v1' and row.get('readOnly') is True,'SNAPSHOT_CONTRACT')
    identity=row.get('targetIdentity',{})
    require(identity.get('valid') is True and identity.get('deploymentTarget')=='professional-dismanager.net'
        and identity.get('operatorTarget')=='DD1296_FINAL_ALLIN_10BPS','TARGET_IDENTITY')
    stamp=row.get('generatedAt');require(type(stamp) is int and 0<=now-stamp<=60000,'SNAPSHOT_FRESHNESS')
    require(row.get('sharedKillSwitchActive') is False and baseline.get('sharedKillSwitchActive') is False,'LIVE_KILL_CHANGED')
    risk=row.get('sharedRisk',{})
    require(risk.get('maximumLossPct')==7.5 and risk.get('safetyState')=='HEALTHY'
        and risk.get('sourceComplete') is True and risk.get('fresh') is True and risk.get('tripped') is False,'LIVE_SHARED_RISK')
    runners=row.get('runners');require(isinstance(runners,dict) and set(runners)==TRADING,'RUNNER_INVENTORY')
    for key,runner in runners.items():
        old=baseline.get('runners',{}).get(key,{})
        require(runner.get('runtimeSha')==pins[key] and runner.get('expectedSha')==pins[key],'RUNNER_PIN')
        require(all(runner.get(k)==old.get(k) for k in ['newOrdersAllowed','orderPermission','mode','liveEnabled']),
            'LIVE_PERMISSION_MUST_NOT_CHANGE')
        require(runner.get('processHealthy') is True,'LIVE_PROCESS_UNHEALTHY')
        if key in ['V12_V4','V52']:
            actual=runner.get('actualLastTickAt')
            require(runner.get('tickVerified') is True and type(actual) is int and 0<=now-actual<=180000
                and runner.get('lastTickAt')==actual,'GENUINE_CURRENT_TICK_REQUIRED')
        else:require(runner.get('tickVerified') is False and runner.get('actualLastTickAt') is None,'LEGACY_NOT_CERTIFIED_AS_TICK')
    v4=runners['V12_V4']
    require(v4.get('mode')=='LIVE' and v4.get('liveEnabled') is True and v4.get('newOrdersAllowed') is True,'EXISTING_V4_LIVE_REQUIRED')
    return stamp

def run_transaction(ops):
    ops.prepare();ops.consume()
    try:
        ops.publish();times=ops.audit()
        require(len(times)==3 and times==sorted(set(times)),'THREE_REAL_SNAPSHOT_CYCLES')
        return ops.commit(times)
    except Exception as error:
        try:ops.rollback()
        except Exception:raise RuntimeError('MONITOR_SNAPSHOT_ROLLBACK_REQUIRES_RECONCILIATION') from error
        raise

class MonitorSnapshotOperations:
    def __init__(self,parent,args,token):
        self.parent=parent;self.paths=parent.paths;self.args=args;self.token=token;self.created=[];self.current_replaced=False
        self.dropin=DROPIN;self.env=Path('/etc/disdex/current-runtime')/(args.sha+'-observed-health.env')
        self.receipt=self.paths.receipts/('monitor-snapshot-'+args.sha+'.json')
        self.journal=self.paths.root/'monitor-transactions'/(args.sha+'-'+uuid.uuid4().hex+'.json')
    def command(self,*args):
        result=subprocess.run(['/usr/bin/systemctl',*args],capture_output=True,text=True,timeout=40)
        require(result.returncode==0,'SYSTEMD_'+args[0].upper())
        return result.stdout.strip()
    def file(self,path):
        from disdex_shared_risk_witness import file_bytes
        return file_bytes(path)
    def protected(self):
        current=self.reader.read_context()
        if getattr(self,'live_preserving',False):
            require(protected_monitor_context(current)==protected_monitor_context(self.context),'LIVE_PEERS_RISK_KILL_CHANGED')
            require(self.approval_hashes()==self.frozen_approvals,'LIVE_OPERATOR_APPROVAL_CHANGED')
        else:require(current==self.context,'PEERS_RISK_KILL_PENDING_CHANGED')
        self.parent._assert_expected_pins(self.pins)
        require(self.parent._read_current_sha(unchanged_identity_only=True)==self.current['sourceSha'],'CURRENT_SYMLINK_CHANGED')
    def observe(self,folder):
        env={**self.environment,'PATH':'/usr/bin:/bin','HOME':'/root',
            'DISDEX_HEALTH_SNAPSHOT_DEPLOYMENT_TARGET':'professional-dismanager.net',
            'DISDEX_HEALTH_SNAPSHOT_OPERATOR_TARGET':'DD1296_FINAL_ALLIN_10BPS',
            'DISDEX_HEALTH_SNAPSHOT_HEALTH_ROOT':str(folder),
            'DISDEX_HEALTH_SNAPSHOT_TICK_ROOT':'/var/lib/disdex/runner-health/ticks',
            'DISDEX_HEALTH_SNAPSHOT_CANONICAL_PATH':str(folder/'current.json')}
        result=subprocess.run(['/usr/bin/node',str(self.release/SCRIPT)],cwd=self.release,env=env,capture_output=True,text=True,timeout=40)
        require(result.returncode==0,'CANDIDATE_READONLY_PREVIEW_FAILED')
        row=json.loads(self.file(folder/'current.json'))
        self.validate_row(row)
        self.protected();return row
    def validate_row(self,row):
        now=time.time_ns()//1000000
        if getattr(self,'live_preserving',False):return validate_live_observation(row,self.pins,now,self.live_baseline)
        return validate_observation(row,self.pins,now)
    def approval_hashes(self):
        return {str(path):hashlib.sha256(self.file(path)).hexdigest() for path in self.approval_paths}
    def prepare(self):
        from disdex_unified_root_gate import _assert_execution_root,read_root_json,parse_live_pins,release_marker,assert_regular_secure,assert_private_dir,assert_root_trusted_dir
        from disdex_shared_risk_witness import ProductionSharedRiskReader
        from disdex_v4_monitor_cutover import systemd_environment_files
        _assert_execution_root(self.parent.root_uid)
        require(self.args.scope=='API_MONITORS' and self.args.orders_enabled=='false','NO_ORDER_SCOPE')
        properties=self.command('show',SERVICE,'-p','DropInPaths')
        validate_snapshot_prestart(self.command('show',SERVICE,'-p','ExecStartPre'))
        values=properties.split('=',1)[1].split() if '=' in properties else []
        for path in values:assert_regular_secure(Path(path),private=False)
        self.dropin=choose_snapshot_dropin(values,self.args.sha)
        folder=self.paths.root/'plans/API_MONITORS'
        for path in [self.paths.root,folder,self.paths.nonce_dir,self.paths.receipts]:assert_private_dir(path)
        assert_root_trusted_dir(self.dropin.parent);assert_root_trusted_dir(self.env.parent)
        self.desired=read_root_json(folder/(self.args.sha+'.json'));self.current=read_root_json(self.paths.current_plan)
        self.pins=parse_live_pins(read_root_json(self.paths.pins,private=False),releases=self.paths.releases)
        require(validate_monitor_plan(self.desired,self.current,self.pins)==self.args.plan_sha256 and self.desired['sourceSha']==self.args.sha,'PLAN_HASH')
        self.release=release_marker(self.args.sha,self.paths.releases)
        for path in [self.release/SCRIPT,self.release/'lib/disdex-observed-runner-phase.mjs',self.release/'lib/disdex-q102-health-gate.mjs']:
            require(not assert_regular_secure(path,private=False).st_mode&0o222,'IMMUTABLE_CANDIDATE_REQUIRED')
        for path in [self.dropin,self.env,self.receipt,self.journal]:require(not path.exists() and not path.is_symlink(),'EXISTING_TARGET_REQUIRES_RECONCILIATION')
        self.parent._verify_token(self.args,self.token)
        self.reader=ProductionSharedRiskReader();self.context=self.reader.read_context()
        self.live_baseline=json.loads(self.file(Path('/var/lib/disdex/runner-health/current.json')))
        self.live_preserving=(self.live_baseline.get('sharedKillSwitchActive') is False
            and self.live_baseline.get('runners',{}).get('V12_V4',{}).get('newOrdersAllowed') is True)
        if self.live_preserving:
            self.approval_paths=set()
            manifest=read_root_json(self.paths.pins,private=False)
            for entry in manifest['runners'].values():
                props=self.command('show',entry['serviceUnit'],'-p','ExecStartPre')
                self.approval_paths.update(Path(x) for x in re.findall(r'--activation-path\s+([^\s;]+)',props))
            self.approval_paths.add(Path('/var/lib/disdex/shared/operator-activation/v12-v4-full.json'))
            for path in self.approval_paths:assert_regular_secure(path,private=False)
            self.frozen_approvals=self.approval_hashes()
            self.validate_row(self.live_baseline)
        self.protected()
        self.current_raw=self.file(self.paths.current_plan);self.current_meta=self.paths.current_plan.stat()
        self.next_current={**self.current,'monitorSha':self.desired['monitorSha'],'releaseRoots':self.desired['releaseRoots'].copy()}
        self.environment={}
        properties=self.command('show',SERVICE,'-p','EnvironmentFiles','-p','ExecStart','-p','WorkingDirectory')
        self.old_properties=properties
        for path in systemd_environment_files(properties):
            p=Path(path);assert_regular_secure(p,private=False)
            for line in self.file(p).decode().splitlines():
                key,sep,value=line.partition('=')
                if not sep or not re.fullmatch('DISDEX_HEALTH_SNAPSHOT_[A-Z0-9_]+',key):continue
                values=shlex.split(value) if value.startswith(('"',"'")) else [value]
                require(len(values)==1 and '\x00' not in values[0],'MALFORMED_HEALTH_CONFIGURATION')
                self.environment[key]=values[0]
        self.preview=self.paths.root/'monitor-previews'/(self.args.sha+'-'+uuid.uuid4().hex)
        self.preview.mkdir(parents=True,mode=0o700)
        self.before=self.observe(self.preview)
    def consume(self):
        self.protected();require(self.file(self.paths.current_plan)==self.current_raw,'CURRENT_PLAN_CAS')
        self.authorization=self.parent._verify_token(self.args,self.token,nonce_dir=self.paths.nonce_dir)
        self.authorized_at=self.parent.clock()
    def publish(self):
        from disdex_pending_maintenance_install import _new_file,_directory
        from disdex_shared_risk_monitor_wiring import atomic_text
        _directory(self.journal.parent)
        # Immutable recovery journal is evidence, never a copied authorization.
        journal=dict(schema='disdex-monitor-recovery-journal/v1',sourceSha=self.args.sha,planSha256=self.args.plan_sha256,
            beforePlan=self.current,beforeServiceProperties=self.old_properties,protectedContext=self.context,
            consumedNonceDigest=hashlib.sha256(self.authorization['nonce'].encode()).hexdigest(),authorizedAt=self.authorized_at,
            allowedMutations=[str(self.dropin),str(self.env),str(self.paths.current_plan)],authorizesTrading=False)
        _new_file(self.journal,canonical(journal)+b'\n',0o400,lambda:None)
        require(self.dropin.parent.is_dir() and not self.dropin.parent.is_symlink(),'ROOT_DROPIN_DIRECTORY_REQUIRED')
        env=('DISDEX_HEALTH_SNAPSHOT_DEPLOYMENT_TARGET=professional-dismanager.net\n'
             'DISDEX_HEALTH_SNAPSHOT_OPERATOR_TARGET=DD1296_FINAL_ALLIN_10BPS\n'
             'DISDEX_HEALTH_SNAPSHOT_CANONICAL_PATH=/var/lib/disdex/runner-health/current.json\n')
        unit=render_snapshot_unit(self.release,self.env,self.args.sha)
        for path,raw,mode in [(self.env,env.encode(),0o600),(self.dropin,unit.encode(),0o644)]:
            _new_file(path,raw,mode,lambda p=path:self.created.append(p))
        self.command('daemon-reload')
        properties=self.command('show',SERVICE,'-p','ExecStart','-p','WorkingDirectory')
        require(str(self.release/SCRIPT) in properties and 'WorkingDirectory='+str(self.release) in properties,'EFFECTIVE_SOURCE_MISMATCH')
        self.protected();require(self.file(self.paths.current_plan)==self.current_raw,'CURRENT_PLAN_CAS')
        self.current_replaced=True
        atomic_text(self.paths.current_plan,canonical(self.next_current)+b'\n',
            (self.current_meta.st_uid,self.current_meta.st_gid,self.current_meta.st_mode&0o777))
    def audit(self):
        times=[];pairs=[];deadline=time.monotonic()+600
        while len(times)<3:
            require(time.monotonic()<deadline,'REAL_CYCLE_AUDIT_TIMEOUT');self.protected()
            self.command('start',SERVICE)
            row=json.loads(self.file(Path('/var/lib/disdex/runner-health/current.json')))
            stamp=self.validate_row(row)
            pair=[row['runners'][key]['actualLastTickAt'] for key in ['V12_V4','V52']]
            if stamp not in times and (not pairs or all(pair[i]>pairs[-1][i] for i in range(2))):
                times.append(stamp);pairs.append(pair)
            if len(times)<3:self.parent.sleep_fn(10)
        self.protected();return times
    def commit(self,times):
        from disdex_pending_maintenance_install import _new_file
        self.protected()
        row=dict(schema='disdex-monitor-snapshot-receipt/v1',status='MONITOR_SNAPSHOT_VERIFIED_NOT_TRADING_AUTHORITY',
            sourceSha=self.args.sha,scope='API_MONITORS',planSha256=self.args.plan_sha256,ordersEnabled=False,
            authorizesTrading=False,authorizesKillClearance=False,runnerMap=self.pins,serviceUnit=SERVICE,
            deploymentAuthorizedAt=self.authorized_at,committedAt=self.parent.clock(),auditSnapshotTimes=times,
            journal=str(self.journal),ordersSent=0,cancelsSent=0,positionChangesSent=0)
        if getattr(self,'live_preserving',False):row.update(livePreserving=True,priorTradingAuthorityPreserved=True,
            protectedOperatorArtifactHashes=self.frozen_approvals)
        _new_file(self.receipt,canonical(row)+b'\n',0o400,lambda:self.created.append(self.receipt));return row
    def rollback(self):
        from disdex_shared_risk_monitor_wiring import atomic_text
        errors=[]
        if self.current_replaced:
            try:
                require(self.file(self.paths.current_plan) in [self.current_raw,canonical(self.next_current)+b'\n'],'ROLLBACK_PLAN_CAS')
                atomic_text(self.paths.current_plan,self.current_raw,(self.current_meta.st_uid,self.current_meta.st_gid,self.current_meta.st_mode&0o777))
            except Exception:errors.append(True)
        for path in reversed(self.created):
            try:path.unlink(missing_ok=True)
            except Exception:errors.append(True)
        try:self.command('daemon-reload')
        except Exception:errors.append(True)
        if self.journal.exists():
            try:
                from disdex_pending_maintenance_install import _new_file
                outcome=dict(schema='disdex-monitor-rollback-outcome/v1',sourceSha=self.args.sha,
                    status='RECONCILIATION_REQUIRED' if errors else 'ROLLED_BACK',
                    recordedAt=self.parent.clock(),journalSha256=hashlib.sha256(self.file(self.journal)).hexdigest(),
                    authorizesTrading=False,ordersSent=0,cancelsSent=0,positionChangesSent=0)
                _new_file(self.journal.with_suffix('.rollback.json'),canonical(outcome)+b'\n',0o400,lambda:None)
            except Exception:errors.append(True)
        if errors:raise RuntimeError('MONITOR_SNAPSHOT_ROLLBACK_INCOMPLETE')

class MonitorSnapshotRootExecutor:
    def __init__(self,parent):self.parent=parent
    def execute(self,args,token):return run_transaction(MonitorSnapshotOperations(self.parent,args,token))
