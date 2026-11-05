"""Route-neutral, independently SHA-bound V52 protected-hold recovery.

An activation authorizes V52 only. Existing FET authority must be verified from
its own pinned release/artifact by the candidate guard. No route may fabricate
Actions provenance or authorize clearing the existing shared protected hold.
"""
import datetime as dt
import hashlib
import json
import re
import os
from pathlib import Path
import subprocess
import time
import ast
import math

REPO='dunamishajime-bit/-ai-dex-manager'
TARGET='professional-dismanager.net'
OPERATOR_TARGET='DD1296_FINAL_ALLIN_10BPS'
IDS={'V12_V4','QUALITY102_CAUSAL_V1','V52','PENGU_V8','FET_BRK48_RESIDUAL',
    'HYPE_TREND_LONG','IDLE_PRIORITY_SHORT','SHARED_CRYPTO_RISK','MARGIN_GUARD'}
PLAN_FIELDS={'schema','repository','deploymentTarget','operatorTarget','sourceSha','scope','runners','uiSha',
    'monitorSha','releaseRoots','ordersEnabled'}


def require(value,reason):
    if not value:raise ValueError('V52_SCOPED_'+reason)


def canonical(row):return json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('ascii')


def plan_hash(plan):return hashlib.sha256(canonical(plan)).hexdigest()


def classify_candidate_failure(output):
    for needles,category in [
        (['ASTER_GLOBAL_RATE_BUDGET_SATURATED','ASTER_RATE_BUDGET','ASTER_GLOBAL_RATE_BUDGET_COOLDOWN'],'SHARED_RATE_BUDGET_DEFERRED'),
        (['Reference quote stale','REFERENCE_STALE','LOCAL_REFERENCE_STALE'],'STOCK_REFERENCE_STALE'),
        (['ACCOUNT_LOCK','account lock'],'ACCOUNT_LOCK_DEFERRED'),
        (['QUALITY102_STATE','Q102_PEER'],'Q102_PEER_STATE_REJECTED'),
        (['HTTP Error 429','HTTP Error 418'],'VENUE_RATE_LIMIT'),
        (['ModuleNotFoundError','ImportError'],'RELEASE_DEPENDENCY_ERROR'),
    ]:
        if any(needle in output for needle in needles):return category
    return 'UNCLASSIFIED'


def validate_unchanged_caps(old_source,new_source,report):
    def constants(source):
        tree=ast.parse(source)
        classes=[n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='StrictPortfolioCaps']
        require(len(classes)==1,'GROSS_CONTRACT_CLASS')
        values={n.target.id:ast.literal_eval(n.value) for n in classes[0].body
            if isinstance(n,ast.AnnAssign) and isinstance(n.target,ast.Name)}
        require(values and all(type(v) in [int,float] and math.isfinite(v) and v>0 for v in values.values()),'GROSS_CONTRACT_VALUES')
        return values
    old=constants(old_source);new=constants(new_source)
    require(old==new,'ECONOMIC_GROSS_CHANGE_REQUIRES_SEPARATE_CERTIFICATION')
    mapping=dict(crypto='crypto_gross',stock='stock_gross',portfolio='total_gross',v11='stock_slot_gross',v50='stock_slot_gross')
    caps=report.get('caps')
    require(isinstance(caps,dict) and set(caps)==set(mapping) and all(
        type(caps.get(k)) in [int,float] and math.isfinite(caps[k]) and caps[k]==old.get(v)
        for k,v in mapping.items()),'CANDIDATE_GROSS_DIFFERS_FROM_EXISTING_SOURCE')


def validate_flat_ownership_state(state,allowed_shas,ledger):
    require(isinstance(state,dict) and state.get('schemaVersion')==3
        and state.get('strategyId')=='DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96'
        and state.get('runtimeCommitSha') in allowed_shas
        and state.get('positions')=={} and 'pendingOrder' in state and state['pendingOrder'] is None,
        'FLAT_DURABLE_STATE_REQUIRED')
    require(isinstance(ledger,dict) and isinstance(state.get('v52Ledger'),dict)
        and canonical(state['v52Ledger'])==canonical(ledger),'DURABLE_LEDGER_CHANGED')


def scoped_configuration_bytes(raw,old,new,*,environment=False):
    require(isinstance(raw,bytes) and re.fullmatch('[a-f0-9]{40}',old) and re.fullmatch('[a-f0-9]{40}',new),
            'CONFIGURATION_INPUT')
    text=raw.decode('utf-8')
    if text.lstrip().startswith('{'):
        try:row=json.loads(text)
        except ValueError:row={}
        require(not isinstance(row,dict) or not str(row.get('schema','')).startswith(
            ('disdex-live-operator-activation/','disdex-unified-operator-activation/','disdex-owner-', 'disdex-v4-monitor-activation/')),
            'APPROVAL_ARTIFACT_MUST_NOT_BE_COPIED')
    if environment:
        for line in text.splitlines():
            key,separator,_value=line.partition('=')
            require(not separator or not any(marker in key.upper() for marker in
                ['PRIVATE_KEY','API_KEY','API_SECRET','PASSWORD','ACCESS_TOKEN','AUTH_TOKEN']),
                'CREDENTIALS_MUST_REMAIN_IN_CANONICAL_FILES')
    return raw.replace(old.encode(),new.encode())


def layered_monitor_pin_changes(rows,prefix,old_sha,new_sha,releases_root):
    units={'DISDEX_HEALTH_SNAPSHOT_V52_':'disdex-v52-aster-only','DISDEX_WATCHDOG_V52_':'disdex-v52-aster-only',
           'DISDEX_HEALTH_SNAPSHOT_V12_':'disdex-v12-v4','DISDEX_WATCHDOG_V12_':'disdex-v12-v4'}
    require(prefix in units,'MONITOR_KEY_SCOPE');unit_prefix=units[prefix]
    effective={};changes=[];seen={}
    for path,text in rows:
        if path in seen:require(seen[path]==text,'MONITOR_LAYER_CHANGED_DURING_READ')
        old={};new={}
        for line in text.splitlines():
            key,separator,value=line.partition('=')
            if key not in [prefix+'EXPECTED_SHA',prefix+'RELEASE_ROOT',prefix+'SERVICE_UNIT']:continue
            require(separator and key not in old,'DUPLICATE_MONITOR_KEY')
            if key.endswith('EXPECTED_SHA'):
                require(re.fullmatch('[a-f0-9]{40}',value),'MALFORMED_HISTORICAL_MONITOR_SHA');replacement=new_sha
            elif key.endswith('RELEASE_ROOT'):
                require(value.startswith(releases_root+'/') and re.fullmatch('[a-f0-9]{40}',value[len(releases_root)+1:]),'MONITOR_ROOT_ESCAPE')
                replacement=releases_root+'/'+new_sha
            else:
                require(re.fullmatch(re.escape(unit_prefix)+r'@[a-f0-9]{40}\.service',value),'MONITOR_UNIT_SCOPE')
                replacement=unit_prefix+'@'+new_sha+'.service'
            old[key]=value;new[key]=replacement;effective[key]=value
        if old and path not in seen:changes.append((path,old,new))
        seen[path]=text
    require(effective.get(prefix+'EXPECTED_SHA')==old_sha
        and effective.get(prefix+'RELEASE_ROOT')==releases_root+'/'+old_sha
        and (prefix+'SERVICE_UNIT' not in effective or effective[prefix+'SERVICE_UNIT']==unit_prefix+'@'+old_sha+'.service'),
        'EFFECTIVE_MONITOR_PIN_DIFFERS_FROM_LIVE')
    return changes


def run_scoped_transaction(operations):
    operations.prepare();operations.consume()
    try:
        operations.publish();operations.switch();ticks=operations.audit()
        require(isinstance(ticks,list) and len(ticks)==3 and all(type(t) is int and t>0 for t in ticks)
            and ticks==sorted(set(ticks)),'THREE_REAL_CYCLES_REQUIRED')
        return operations.commit(ticks)
    except Exception as error:
        try:operations.rollback()
        except Exception:raise RuntimeError('V52_SCOPED_ROLLBACK_REQUIRES_RECONCILIATION') from error
        raise


def validate_real_tick(row,*,sha,pid,now,previous):
    expected=dict(schema='disdex-runner-tick/v1',runnerId='V52',runtimeSha=sha,expectedSha=sha,
        serviceUnit='disdex-v52-aster-only@'+sha+'.service',mainPid=pid,
        workingDirectory='/home/deploy/disdex-trading/releases/'+sha)
    require(isinstance(row,dict) and type(pid) is int and pid>0 and type(row.get('mainPid')) is int
        and all(row.get(k)==v for k,v in expected.items()),'REAL_TICK_IDENTITY')
    start=row.get('tickStartedAt');end=row.get('tickCompletedAt')
    require(type(start) is int and type(end) is int and 0<start<=end<=now and now-end<=120000
        and (previous is None or end>previous),'REAL_TICK_FRESHNESS')
    require(row.get('newOrdersAllowed') is False and row.get('status') in ['held','completed','market-closed'],
            'PROTECTED_HOLD_CYCLE_REQUIRED')
    return end


def validate_scoped_plan(desired,current,pins):
    for row in [desired,current]:
        require(isinstance(row,dict) and set(row)==PLAN_FIELDS,'PLAN_FIELDS')
        require(row['schema']=='disdex-unified-deployment-plan/v2' and row['repository']==REPO
            and row['deploymentTarget']==TARGET and row['operatorTarget']==OPERATOR_TARGET
            and type(row['ordersEnabled']) is bool,'TARGET_OR_PERMISSION')
        require(isinstance(row['runners'],dict) and set(row['runners'])==IDS,'RUNNER_MAP')
        require(all(isinstance(value,str) and re.fullmatch('[a-f0-9]{40}',value)
            for value in [row['sourceSha'],row['uiSha'],row['monitorSha'],*row['runners'].values()]),'SOURCE_SHA')
        roots=row['releaseRoots']
        require(isinstance(roots,dict) and set(roots)=={'runners','ui','monitor'} and all(
            isinstance(v,str) and v.startswith('/') and not any(p in ['','..','.'] for p in v.split('/')[1:])
            for v in roots.values()),'RELEASE_ROOTS')
    require(current['runners']==pins,'STALE_CURRENT_PINS')
    require(desired['scope']=='V52' and desired['ordersEnabled'] is True
        and desired['sourceSha']==desired['runners']['V52'],'EXACT_V52_AUTHORITY')
    require({k for k in IDS if desired['runners'][k]!=current['runners'][k]}=={'V52'}
        and all(desired[k]==current[k] for k in ['uiSha','monitorSha','releaseRoots']),
        'PEER_OR_INFRASTRUCTURE_DELTA')
    return plan_hash(desired)


def build_runtime_activation(plan,authorization,now,*,inventory_digest):
    require(plan.get('scope')=='V52' and plan.get('ordersEnabled') is True,'ACTIVATION_SCOPE')
    for field,expected in [('repository',REPO),('deploymentTarget',TARGET),('operatorTarget',OPERATOR_TARGET),
            ('sourceSha',plan['sourceSha']),('scope','V52'),('planSha256',plan_hash(plan))]:
        require(authorization.get(field)==expected,'APPROVAL_BINDING')
    require(authorization.get('ordersEnabled') is True,'APPROVAL_PERMISSION')
    issued=authorization.get('issuedAt');expires=authorization.get('expiresAt')
    require(type(issued) is int and type(expires) is int and type(now) is int
        and 0<issued<=now<expires and 1<=expires-issued<=300,'APPROVAL_EXPIRED_OR_FUTURE')
    route=authorization.get('route');operator=authorization.get('operator')
    require(route in ['CODEX_SSH','GITHUB_ACTIONS'] and isinstance(operator,str)
        and re.fullmatch('[A-Za-z0-9-]{1,39}',operator),'AUTHORITY_ROUTE')
    if route=='CODEX_SSH':
        require(authorization.get('schema')=='disdex-codex-ssh-root-auth/v1'
            and operator=='codex-ssh' and authorization.get('authorizationMethod')=='ROOT_SSH_SESSION'
            and authorization.get('signatureVerified') is False,'ROOT_AUTHORITY')
    else:
        require(authorization.get('schema')=='disdex-owner-deployment-approval/v2',
                'SIGNED_ROUTE_CANNOT_REUSE_ROOT_SESSION')
    nonce=authorization.get('nonce')
    require(isinstance(nonce,str) and re.fullmatch('[a-f0-9]{32}',nonce)
        and isinstance(inventory_digest,str) and re.fullmatch('[a-f0-9]{64}',inventory_digest),'EVIDENCE_BINDING')
    return dict(schema='disdex-live-operator-activation/v1',target=OPERATOR_TARGET,
        approvedSha=plan['sourceSha'],approvedRunners=['V52'],approvedShaByRunner={'V52':plan['sourceSha']},
        ordersEnabled=True,activationClass='FULL_LIVE',operatorAcknowledgement='I_ACK_REAL_MONEY_LIVE_ACTIVATION',
        approvedAt=dt.datetime.fromtimestamp(issued,dt.timezone.utc).isoformat().replace('+00:00','Z'),
        deploymentApprovalExpiresAt=expires,planSha256=plan_hash(plan),
        authorizationMethod='ROOT_SSH_SESSION' if route=='CODEX_SSH' else 'OWNER_SIGNED_TOKEN',
        authorizedOperator=operator,route=route,signatureVerified=route=='GITHUB_ACTIONS',
        nonceDigest=hashlib.sha256(nonce.encode()).hexdigest(),
        authorizesKillClearance=False,fetCorePreemptionReady=True,
        formalCertification=False,venueLifecycleCertified=False,
        evidence=dict(sourceSha=plan['sourceSha'],inventoryDigest=inventory_digest,
            signedAsterReadOnly=True,startUnderProtectedHold=True,killSwitchActive=True,
            peerAuthorities='UNCHANGED_INDEPENDENT_APPROVALS_REQUIRED',ordersSent=0,cancelsSent=0,positionChangesSent=0),
        notes='V52-only authorization; FULL_LIVE is the existing runtime gate class, not a post-cutover certification. '
            'Existing protected hold is maintained. This artifact does not authorize FET or Kill clearance.')


class V52ScopedOperations:
    """Fixed Production paths; the canonical root gate holds the global lock."""
    OLD='4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81'
    COMMON='7688ed7c93a1918d8b44837339b7da5584a868f5'
    STATE=Path('/var/lib/disdex/v52-aster-only/runner-live.json')
    KILL=Path('/var/lib/disdex/shared/kill-switch.json')
    MARGIN=Path('/var/lib/disdex/shared/margin-risk/guard-live.json')
    PENDING=Path('/var/lib/disdex/shared/pending-exposure.json')
    TICK=Path('/var/lib/disdex/runner-health/ticks/v52.json')
    def __init__(self,parent,args,token):
        self.parent=parent;self.paths=parent.paths;self.args=args;self.token=token;self.systemd=parent.systemd
        self.old_unit='disdex-v52-aster-only@'+self.OLD+'.service'
        self.new_unit='disdex-v52-aster-only@'+args.sha+'.service'
        self.approval=Path('/var/lib/disdex/shared/operator-activation')/('v52-'+args.sha+'.json')
        self.unit_root=Path('/etc/systemd/system');self.env_root=Path('/etc/disdex/current-runtime')
        self.unit_path=self.unit_root/self.new_unit;self.dropin_dir=Path(str(self.unit_path)+'.d')
        self.env_path=self.env_root/(args.sha+'-v52-scoped.env')
        self.receipt_path=self.paths.receipts/('v52-protected-hold-'+args.sha+'.json')
        self.created=[];self.replaced=[];self.old_stopped=False;self.new_started=False
        self.prepared_files=[]
        self.created_directory=False

    def command(self,*argv,timeout=35):
        result=subprocess.run(['/usr/bin/systemctl',*argv],capture_output=True,text=True,timeout=timeout)
        require(result.returncode==0,'SYSTEMD_FAILED:'+argv[0])
        return result.stdout.strip()

    def file(self,path):
        from disdex_shared_risk_witness import file_bytes
        return file_bytes(path)

    def protected(self):
        context=self.reader.read_context();context['peers'].pop('V52')
        return context

    def check_protected(self):require(self.protected()==self.baseline,'PEER_KILL_PENDING_OR_WRITER_CHANGED')

    def signed_flat(self):
        proof=self.sdk.run_signed_child(self.sdk_release,self.deploy,credentials=self.credentials)
        require(proof.get('status')=='PENDING_READONLY_RECONCILE_VERIFIED'
            and all(type(proof.get(k)) is int and proof[k]==0 for k in
                ['positionCount','openOrderCount','ordersSent','cancelsSent','positionChangesSent']),
            'FRESH_SIGNED_FLAT_REQUIRED')
        captured=proof.get('verifiedAt')
        require(type(captured) is int and 0<=time.time_ns()//1000000-captured<=30000,
            'SIGNED_FLAT_PROOF_STALE')
        return proof

    def health(self):
        risk=self.reader.read_risk();now=time.time_ns()//1000000
        require(risk.get('sourceComplete') is True and risk.get('tripped') is False
            and risk.get('maximumLossPct')==7.5,'SHARED_RISK_NOT_HEALTHY')
        margin=json.loads(self.file(self.MARGIN));pending=json.loads(self.file(self.PENDING));kill=json.loads(self.file(self.KILL))
        # A protected-hold deployment uses the existing witness contract.
        # Healthy Margin polls every five minutes; the trading engine still
        # performs its independent fresh Margin check before any order.
        for value,age in [(margin.get('checkedAt'),900000),(pending.get('updatedAt'),300000)]:
            require(type(value) is int and 0<=now-value<=age,'MARGIN_OR_PENDING_STALE')
        require(margin.get('stage')=='HEALTHY' and margin.get('ordersAllowed') is True,'MARGIN_BLOCKED')
        entries=pending.get('entries');require(isinstance(entries,list) and all(isinstance(e,dict) and e.get('status')=='RELEASED' for e in entries),'ACTIVE_OR_UNKNOWN_PENDING')
        require(kill.get('active') is True and kill.get('action')=='HOLD_PROTECTED'
            and kill.get('operator')=='disdex-v52-aster-only' and kill.get('recoverable') is True
            and kill.get('reason')=='V52 upstream state unavailable: QUALITY102_STATE_MISMATCH:runtimeCommitSha',
            'EXACT_EXISTING_PROTECTED_HOLD_REQUIRED')

    def _trusted_source(self,path):
        from disdex_unified_root_gate import assert_regular_secure
        assert_regular_secure(path,private=False)
        require(not path.is_symlink(),'UNTRUSTED_CONFIGURATION')
        return self.file(path)

    def candidate_readonly(self):
        env={**self.old_environment,**self.credentials,**self.runtime_environment()}
        env.update(DISDEX_V52_MONITOR_ONLY='true',DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED='false',
            DISDEX_V52_MONITOR_BUDGET_BROKER_SHA='25d4a86f541a33564c8060bc71633fd810ac9370',
            DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET='/run/disdex-v4-budget-25d4a86f541a33564c8060bc71633fd810ac9370/budget.sock')
        for key in ['NODE_OPTIONS','PYTHONHOME','PYTHONSTARTUP']:env.pop(key,None)
        result=subprocess.run(['/usr/bin/python3','-S',str(self.release/'scripts/disdex_v52_aster_only_live_engine.py'),
            '--mode','live','--preflight-readonly'],cwd=self.release,env=env,user=self.deploy.pw_uid,
            group=self.deploy.pw_gid,extra_groups=[],capture_output=True,text=True,timeout=70)
        # No raw error/output URLs, response bodies or environment are logged.
        require(result.returncode==0,'CANDIDATE_GET_ONLY_PREFLIGHT_BLOCKED:'+classify_candidate_failure(result.stderr+result.stdout))
        rows=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        require(len(rows)==1 and rows[0].get('readOnly') is True and rows[0].get('ordersSent') is False,
                'CANDIDATE_PREFLIGHT_CONTRACT')
        relative='scripts/disdex_strict_portfolio_planner.py'
        validate_unchanged_caps(self.file(self.paths.releases/self.OLD/relative).decode(),
            self.file(self.release/relative).decode(),rows[0])
        return rows[0]

    def runtime_environment(self):
        return dict(DISDEX_RELEASE_SHA=self.args.sha,DISDEX_RUNTIME_COMMIT_SHA=self.args.sha,
            DISDEX_RELEASE_ROOT=str(self.release),DISDEX_V52_REAL_TICK_ENABLED='true',
            DISDEX_RUNNER_TICK_HEARTBEAT_ROOT='/var/lib/disdex/runner-health',
            DISDEX_V52_OPERATOR_ACTIVATION_PATH=str(self.approval),DISDEX_V52_MONITOR_ONLY='false',
            DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED='true',FET_BRK48_CORE_PREEMPTION_READY='true',
            DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH='/var/lib/disdex/shared/aster-rate-budget.json',
            DISDEX_ACCOUNT_LOCK_PATH='/var/lib/disdex/shared/account-order.lock',
            DISDEX_PYTHON_BIN='/usr/bin/python3',PYTHONPATH=str(self.release/'.vendor-stock-site-packages'),
            PYTHONNOUSERSITE='1',PYTHONDONTWRITEBYTECODE='1',DISDEX_TSX_BIN=str(self.release/'node_modules/.bin/tsx'))

    def prepare(self):
        import pwd
        from disdex_unified_root_gate import _assert_execution_root,read_root_json,parse_live_pins,release_marker,assert_private_dir
        from disdex_shared_risk_witness import ProductionSharedRiskReader
        from disdex_pending_maintenance_install import _load_sdk
        from disdex_shared_risk_monitor_wiring import SharedRiskMonitorWiring
        _assert_execution_root(self.parent.root_uid)
        require(self.args.scope=='V52' and self.args.orders_enabled=='true','EXACT_SCOPE_PERMISSION_REQUIRED')
        for path in [self.paths.root,self.paths.root/'plans/V52',self.paths.nonce_dir,self.paths.receipts]:assert_private_dir(path)
        self.desired=read_root_json(self.paths.root/'plans/V52'/(self.args.sha+'.json'))
        self.current=read_root_json(self.paths.current_plan);self.manifest=read_root_json(self.paths.pins,private=False)
        self.pins=parse_live_pins(self.manifest,releases=self.paths.releases)
        require(validate_scoped_plan(self.desired,self.current,self.pins)==self.args.plan_sha256
            and self.desired['sourceSha']==self.args.sha and self.pins['V52']==self.OLD,'ROOT_PLAN_BINDING')
        require(self.parent._read_current_sha(unchanged_identity_only=True)==self.current['sourceSha'],'CURRENT_SYMLINK_IDENTITY')
        self.release=release_marker(self.args.sha,self.paths.releases)
        vendor=self.release/'.vendor-stock-site-packages'
        require(vendor.is_dir() and not vendor.is_symlink() and vendor.stat().st_uid==0 and not vendor.stat().st_mode&0o222,
                'IMMUTABLE_RELEASE_LOCAL_PYTHON_DEPENDENCIES_REQUIRED')
        require(self.systemd.active_state(self.old_unit)=='active' and self.systemd.main_pid(self.old_unit)>0
            and not self.systemd.is_active(self.new_unit),'OLD_ONLY_V52_REQUIRED')
        for path in [self.unit_path,self.dropin_dir,self.env_path,self.approval,self.receipt_path]:
            require(not path.exists() and not path.is_symlink(),'EXISTING_TARGET_REQUIRES_SEPARATE_TRANSACTION')
        self.old_pid=self.systemd.main_pid(self.old_unit)
        require(Path('/proc',str(self.old_pid),'cwd').resolve(strict=True)==self.paths.releases/self.OLD,'OLD_PID_CWD_MISMATCH')
        raw_environment=Path('/proc',str(self.old_pid),'environ').read_bytes()
        self.old_environment={k.decode():v.decode() for part in raw_environment.split(b'\0') if b'=' in part for k,v in [part.split(b'=',1)]}
        self.reader=ProductionSharedRiskReader();self.baseline=self.protected();self.health()
        self.sdk_release=self.paths.releases/'7b7719c65d2c6116d02463fc4603200f28e20762'
        self.sdk=_load_sdk(self.sdk_release);self.credentials=self.sdk.load_server_credentials();self.deploy=pwd.getpwnam('deploy')
        address=self.credentials['ASTER_USER_ADDRESS'].lower()
        require(re.fullmatch('0x[a-f0-9]{40}',address) and self.old_environment.get('ASTER_USER_ADDRESS','').lower()==address,
                'ACCOUNT_IDENTITY_MISMATCH')
        self.account_hash=hashlib.sha256(address.encode()).hexdigest()
        self.parent._verify_token(self.args,self.token);self.before_proof=self.signed_flat()
        self.inventory_digest=hashlib.sha256(canonical(dict(accountIdentitySha256=self.account_hash,positionCount=0,openOrderCount=0))).hexdigest()
        self.candidate_readonly();self.check_protected();self.health()
        state=json.loads(self.file(self.STATE))
        self.ledger_before=state.get('v52Ledger')
        validate_flat_ownership_state(state,{self.OLD},self.ledger_before)
        self.old_enabled=self.systemd.is_enabled(self.old_unit)
        self.baselines={path:(self.file(path),path.stat()) for path in [self.paths.pins,self.paths.current_plan]}
        self.next_manifest=json.loads(json.dumps(self.manifest));self.next_manifest['runners']['V52'].update(
            sha=self.args.sha,serviceUnit=self.new_unit,releaseRoot=str(self.release),evidenceMode='tick-v1')
        self.next_current={**self.current,'runners':self.desired['runners'].copy()}
        # Copy only V52's configuration material, never approval artifacts.
        old_fragment=self.unit_root/self.old_unit
        self.prepared_files.append((self.unit_path,scoped_configuration_bytes(self._trusted_source(old_fragment),self.OLD,self.args.sha),0o644))
        old_dropins=self.unit_root/(self.old_unit+'.d')
        require(old_dropins.is_dir() and not old_dropins.is_symlink(),'OLD_INSTANCE_DROPINS_MISSING')
        for path in sorted(old_dropins.glob('*.conf')):
            self.prepared_files.append((self.dropin_dir/path.name,scoped_configuration_bytes(self._trusted_source(path),self.OLD,self.args.sha),0o644))
        for suffix in ['-v52-overrides.env','-market-closed-api-cadence.env']:
            old=self.env_root/(self.OLD+suffix);new=self.env_root/(self.args.sha+suffix)
            require(not new.exists() and not new.is_symlink(),'NEW_PRIVATE_ENV_EXISTS')
            self.prepared_files.append((new,scoped_configuration_bytes(self._trusted_source(old),self.OLD,self.args.sha,environment=True),0o600))
        files=[]
        # Update every effective V52 override, including historical filenames.
        for unit,prefix in [('disdex-runner-health-snapshot.service','DISDEX_HEALTH_SNAPSHOT_V52_'),
                ('disdex-runner-watchdog.service','DISDEX_WATCHDOG_V52_')]:
            output=self.command('show',unit,'-p','EnvironmentFiles')
            layers=[]
            for line in output.splitlines():
                for value in re.findall(r'/[^\s()]+',line.split('=',1)[1] if '=' in line else ''):
                    path=Path(value);layers.append((path,self._trusted_source(path).decode()))
            files.extend(layered_monitor_pin_changes(layers,prefix,self.OLD,self.args.sha,str(self.paths.releases)))
        pin=self.env_root/'v52-current.env';values={}
        for line in self._trusted_source(pin).decode().splitlines():
            key,_,value=line.partition('=')
            if key in ['DISDEX_V52_RUNTIME_SHA','DISDEX_V52_RUNTIME_ROOT']:values[key]=value
        require(values==dict(DISDEX_V52_RUNTIME_SHA=self.OLD,DISDEX_V52_RUNTIME_ROOT=str(self.paths.releases/self.OLD)),'CURRENT_V52_RUNTIME_PIN')
        files.append((pin,values,dict(DISDEX_V52_RUNTIME_SHA=self.args.sha,DISDEX_V52_RUNTIME_ROOT=str(self.release))))
        self.wiring=SharedRiskMonitorWiring(files)

    def consume(self):
        self.check_protected();self.health();self.parent._assert_expected_pins(self.pins)
        approval=self.parent._verify_token(self.args,self.token,nonce_dir=self.paths.nonce_dir)
        self.authorized_at=self.parent.clock()
        self.activation=build_runtime_activation(self.desired,approval,self.authorized_at,inventory_digest=self.inventory_digest)

    def publish(self):
        from disdex_pending_maintenance_install import _directory,_new_file
        self.dropin_dir.mkdir(mode=0o755);self.created_directory=True
        self.dropin_dir.chmod(0o755);_directory(self.dropin_dir,0o755)
        env=''.join(k+'='+v+'\n' for k,v in self.runtime_environment().items()).encode()
        final=('[Service]\nEnvironmentFile='+str(self.env_path)+'\n'
            'UnsetEnvironment=PYTHONHOME PYTHONSTARTUP NODE_OPTIONS\n'
            'ExecStart=\nExecStart=/usr/bin/python3 -S '+str(self.release/'scripts/disdex_v52_aster_only_live_engine.py')+' --mode live --daemon\n'
            'ExecStartPre=+/usr/bin/python3 '+str(self.release/'scripts/ops/root/disdex-fet-preemption-readiness-guard.py')
            +' --prestart --sha '+self.args.sha+' --activation-path '+str(self.approval)+'\n'
            'ReadWritePaths=/var/lib/disdex/runner-health/ticks\n').encode()
        extra=self.dropin_dir/'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-certified-source.conf'
        for path,raw,mode in [*self.prepared_files,(self.env_path,env,0o600),
                (extra,final,0o644),(self.approval,canonical(self.activation)+b'\n',0o600)]:
            _new_file(path,raw,mode,lambda p=path:self.created.append(p))
        self.command('daemon-reload')
        verify=subprocess.run(['/usr/bin/systemd-analyze','verify',self.new_unit],capture_output=True,text=True,timeout=30)
        require(verify.returncode==0,'UNIT_SYNTAX_OR_DEPENDENCY_INVALID')
        properties=self.command('show',self.new_unit,'-p','ExecStart','-p','ExecStartPre','-p','WorkingDirectory','-p','User')
        require('WorkingDirectory='+str(self.release) in properties and 'User=deploy' in properties
            and str(self.release/'scripts/disdex_v52_aster_only_live_engine.py')+' --mode live --daemon' in properties
            and str(self.release/'scripts/ops/root/disdex-live-operator-activation-gate.mjs') in properties
            and str(self.release/'scripts/ops/root/disdex-fet-preemption-readiness-guard.py') in properties
            and str(self.approval) in properties and self.OLD not in properties,'EFFECTIVE_INSTANCE_SOURCE_OR_GATE_MISMATCH')
        self.check_protected()

    def switch(self):
        from disdex_shared_risk_monitor_wiring import atomic_text
        self.check_protected();self.health()
        self.old_stopped=True;self.systemd.stop(self.old_unit)
        require(self.systemd.main_pid(self.old_unit)==0 and not self.systemd.is_active(self.old_unit),
            'OLD_V52_STILL_ACTIVE')
        old_raw=self.file(self.STATE);old_meta=self.STATE.lstat()
        validate_flat_ownership_state(json.loads(old_raw),{self.OLD},self.ledger_before)
        self.health();self.signed_flat()
        require(self.file(self.STATE)==old_raw,'STOPPED_V52_STATE_CHANGED')
        self.stopped_state_metadata=(old_meta.st_uid,old_meta.st_gid,old_meta.st_mode&0o777)
        for path,raw in [(self.paths.pins,canonical(self.next_manifest)+b'\n'),(self.paths.current_plan,canonical(self.next_current)+b'\n')]:
            before,meta=self.baselines[path];require(self.file(path)==before,'METADATA_CAS_CONFLICT')
            self.replaced.append((path,raw));atomic_text(path,raw,(meta.st_uid,meta.st_gid,meta.st_mode&0o777))
        self.wiring.apply();self.new_started=True;self.systemd.start(self.new_unit)

    def audit(self):
        ticks=[];deadline=time.monotonic()+240;pid=None;next_observation=0
        while len(ticks)<3:
            require(time.monotonic()<deadline,'THREE_REAL_CYCLE_AUDIT_TIMEOUT')
            require(not self.systemd.is_active(self.old_unit),'DUPLICATE_V52')
            require(self.systemd.active_state(self.new_unit)=='active','NEW_INSTANCE_NOT_ACTIVE')
            current_pid=self.systemd.main_pid(self.new_unit);require(current_pid>0 and (pid is None or current_pid==pid),'PID_CHANGED')
            pid=current_pid;require(self.systemd._state(self.new_unit,'NRestarts')=='0','UNEXPECTED_RESTART')
            self.check_protected();self.health();self.parent._assert_expected_pins(self.desired['runners']);self.wiring.assert_applied()
            if time.monotonic()<next_observation:self.parent.sleep_fn(2);continue
            try:row=json.loads(self.file(self.TICK))
            except FileNotFoundError:self.parent.sleep_fn(2);continue
            if row.get('runtimeSha')!=self.args.sha or row.get('tickCompletedAt') in ticks:self.parent.sleep_fn(2);continue
            stamp=validate_real_tick(row,sha=self.args.sha,pid=pid,now=time.time_ns()//1000000,previous=ticks[-1] if ticks else None)
            validate_flat_ownership_state(json.loads(self.file(self.STATE)),{self.args.sha},self.ledger_before)
            self.signed_flat();self.check_protected();ticks.append(stamp);next_observation=time.monotonic()+30
        return ticks

    def commit(self,ticks):
        from disdex_pending_maintenance_install import _new_file
        self.check_protected();self.health()
        result=dict(status='V52_PROTECTED_HOLD_VERIFIED_NOT_FULL_LIVE',sourceSha=self.args.sha,
            scope='V52',planSha256=self.args.plan_sha256,ordersEnabled=True,effectiveNewOrdersAllowed=False,
            authorizesKillClearance=False,protectedHoldPreserved=True,auditTickTimes=ticks,
            deploymentAuthorizedAt=self.authorized_at,committedAt=self.parent.clock(),
            activationSha256=hashlib.sha256(canonical(self.activation)).hexdigest(),
            ordersSent=0,cancelsSent=0,positionChangesSent=0)
        _new_file(self.receipt_path,canonical(result)+b'\n',0o400,lambda:self.created.append(self.receipt_path))
        self.systemd.enable(self.new_unit)
        if self.old_enabled:self.systemd.disable(self.old_unit)
        return result

    def rollback(self):
        from disdex_shared_risk_monitor_wiring import atomic_text
        errors=[]
        def attempt(fn):
            try:fn()
            except Exception:errors.append(True)
        if self.new_started:
            self.systemd.stop(self.new_unit)
            require(self.systemd.main_pid(self.new_unit)==0 and not self.systemd.is_active(self.new_unit),
                'ROLLBACK_NEW_WRITER_STILL_ACTIVE')
            current=self.file(self.STATE);state=json.loads(current)
            validate_flat_ownership_state(state,{self.OLD,self.args.sha},self.ledger_before)
            self.health();self.signed_flat()
            require(self.file(self.STATE)==current,'ROLLBACK_V52_STATE_CHANGED')
            if state['runtimeCommitSha']==self.args.sha:
                restored=canonical({**state,'runtimeCommitSha':self.OLD})+b'\n'
                atomic_text(self.STATE,restored,self.stopped_state_metadata)
                require(self.file(self.STATE)==restored,'ROLLBACK_V52_STATE_READBACK')
            attempt(lambda:self.systemd.disable(self.new_unit))
        if hasattr(self,'wiring'):attempt(self.wiring.restore)
        for path,expected in reversed(self.replaced):
            def restore(p=path,wanted=expected):
                old,meta=self.baselines[p];require(self.file(p) in [old,wanted],'ROLLBACK_CAS_CONFLICT')
                atomic_text(p,old,(meta.st_uid,meta.st_gid,meta.st_mode&0o777))
            attempt(restore)
        for path in reversed(self.created):attempt(lambda p=path:p.unlink(missing_ok=True))
        if self.created_directory and self.dropin_dir.exists():attempt(self.dropin_dir.rmdir)
        attempt(lambda:self.command('daemon-reload'))
        if errors:raise RuntimeError('V52_SCOPED_ROLLBACK_INCOMPLETE')
        if self.old_stopped:
            if self.old_enabled:attempt(lambda:self.systemd.enable(self.old_unit))
            attempt(lambda:self.systemd.start(self.old_unit))
        if errors:raise RuntimeError('V52_SCOPED_ROLLBACK_INCOMPLETE')


class V52ScopedRootExecutor:
    def __init__(self,parent):self.parent=parent
    def execute(self,args,token):return run_scoped_transaction(V52ScopedOperations(self.parent,args,token))
