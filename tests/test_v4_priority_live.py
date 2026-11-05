"""V4-first root recovery; isolated facts only, no venue mutation."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
import disdex_v4_priority_live as m

NOW=2_000_000_000_000
SHA='a'*40
OLD='b'*40

def facts():
    return dict(candidateSha=SHA,oldStateSha=OLD,monitorOnly=True,
        positions=0,openOrders=0,activePending=0,signedVerifiedAt=NOW-1000,
        risk=dict(maximumLossPct=7.5,tripped=False,sourceComplete=True,updatedAt=NOW-1000,utcDay='2033-05-18'),
        margin=dict(stage='HEALTHY',ordersAllowed=True,checkedAt=NOW-1000),
        kill=dict(active=True,action='HOLD_PROTECTED',operator='disdex-v52-aster-only',recoverable=True,
            reason='V52 upstream state unavailable: QUALITY102_STATE_MISMATCH:runtimeCommitSha'),
        v52Sha=m.FIXED_V52_SHA,q102Sha=m.Q102_SHA,allPeersAttested=True,
        peerPermissionsUnchanged=True,economicsIdentical=True,time37PriorApprovalVerified=True,
        staticEvidence=dict(candidateSha=SHA,routeCount=41,sourceParity=True,testPasses=37,typecheck=True),
        durableHash='d'*64,killHash='e'*64)

class PriorityFactsTest(unittest.TestCase):
    def test_hp_primary_rebind_changes_only_the_verified_v4_key(self):
        common = "c" * 40
        source = (
            "# HP compatibility\n"
            "DISDEX_PRIMARY_V12_RUNNER=V4\n"
            f"DISDEX_V12_V4_PRIMARY_SHA={OLD}\n"
            f"DISDEX_V12_V4_PEER_SHA={common}\n"
            "DISDEX_V12_V4_OPERATION_MODE=CERTIFIED\n"
        )
        before, after = m.hp_primary_pin_change(source, common, OLD, SHA)
        from disdex_shared_risk_monitor_wiring import replace_values
        self.assertEqual(replace_values(source, before, after), source.replace(OLD, SHA))
        for invalid in [
            source.replace(OLD, "d" * 40),
            source.replace(common, "d" * 40),
            source.replace("CERTIFIED", "CANARY"),
            source + f"DISDEX_V12_V4_PRIMARY_SHA={OLD}\n",
        ]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                m.hp_primary_pin_change(invalid, common, OLD, SHA)

    def test_upgrade_baseline_binds_prior_authority_before_any_stop(self):
        from unittest.mock import patch
        op=m.ProductionOperations(candidate_sha=SHA,static_root=Path('/tmp')/SHA)
        op.pins={'V12_V4':OLD};op.plan={};op.prior_sha=OLD
        row=dict(sha=OLD,pid=42,activeState='active',cwd=str(m.RELEASES/OLD))
        approval={};implementation={};calls=[]
        with patch('disdex_unified_root_gate.read_root_json',side_effect=[approval,implementation]),\
             patch('disdex_v4_canonical_prestart.validate_activation',side_effect=lambda *a:calls.append('authority')),\
             patch('disdex_v4_root_cutover.await_v4_decision_cycle',side_effect=lambda *a,**k:calls.append('tick') or {'tickCompletedAt':NOW}),\
             patch.object(m,'bytes_at',return_value=b'authority'):
            op._verify_upgrade_baseline(row)
        self.assertEqual(calls,['authority','tick']);self.assertTrue(op.old_live_authority_verified)
        self.assertEqual(op.runtime_approval_hash,m.digest(b'authority'))

    def test_healthy_live_upgrade_requires_verified_old_authority_and_preserves_inactive_kill(self):
        f=facts();f.update(monitorOnly=False,liveUpgradeAuthorized=True,oldLiveAuthorityVerified=True,
                          priorRuntimeSha=OLD);f['oldStateSha']=OLD;f['kill']={'active':False}
        self.assertTrue(m.validate_priority_evidence(f,NOW))
        for delta in [dict(oldLiveAuthorityVerified=False),dict(priorRuntimeSha=SHA),dict(candidateSha=OLD)]:
            with self.subTest(delta=delta),self.assertRaises(ValueError):m.validate_priority_evidence(dict(f,**delta),NOW)
        bad=copy.deepcopy(f);bad['kill']['active']=True
        with self.assertRaises(ValueError):m.validate_priority_evidence(bad,NOW)

    def test_upgrade_candidate_identity_is_explicit_and_cannot_mix_recovery_modes(self):
        op=m.ProductionOperations(candidate_sha=SHA,static_root=Path('/var/lib/disdex/ops-audit/run')/SHA)
        self.assertEqual(op.candidate_sha,SHA);self.assertTrue(op.upgrade)
        for bad in ['', 'latest', '../'+SHA]:
            with self.assertRaises(ValueError):m.ProductionOperations(candidate_sha=bad,static_root=Path('/tmp')/SHA)
        with self.assertRaises(ValueError):
            m.ProductionOperations(recovery=True,candidate_sha=SHA,static_root=Path('/tmp')/SHA)

        recovery=m.ProductionOperations(recovery=True,candidate_sha=SHA,
            static_root=Path('/var/lib/disdex/ops-audit/run')/SHA)
        self.assertEqual(recovery.candidate_sha,SHA)
        self.assertTrue(recovery.recovery)
        self.assertFalse(recovery.upgrade)

    def test_recovery_witness_retries_only_account_lock_contention(self):
        from unittest.mock import Mock
        witness=Mock(side_effect=[ValueError('ACCOUNT_LOCK_PRESENT'),{'signed':True}])
        sleep=Mock()
        self.assertEqual(m.retry_recovery_witness(witness,sleep=sleep),{'signed':True})
        sleep.assert_called_once_with(2)
        unsafe=Mock(side_effect=ValueError('PENDING_EXPOSURE_ACTIVE'))
        with self.assertRaisesRegex(ValueError,'PENDING_EXPOSURE_ACTIVE'):
            m.retry_recovery_witness(unsafe,sleep=sleep)
        unsafe.assert_called_once()

    def test_upgrade_stop_changes_only_the_exact_old_v4_process(self):
        before=dict(writer={'pid':5},killHash='a'*64,peerApprovalHashes={'peer':'b'*64},
            peers={'V12_V4':dict(sha=OLD,pid=42,cwd='/release/'+OLD,activeState='active',nRestarts=0),
                   'PENGU_V8':dict(pid=19,sha=SHA)})
        stopped=copy.deepcopy(before)
        stopped['peers']['V12_V4'].update(pid=0,cwd=None,activeState='inactive')
        self.assertTrue(m.validate_stopped_upgrade_context(before,stopped,OLD))
        failed=copy.deepcopy(stopped);failed['peers']['V12_V4']['activeState']='failed'
        self.assertTrue(m.validate_stopped_upgrade_context(before,failed,OLD))
        for key,value in [('killHash','changed'),('writer',{'pid':6}),('peerApprovalHashes',{})]:
            bad=copy.deepcopy(stopped);bad[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.validate_stopped_upgrade_context(before,bad,OLD)
        for key,value in [('pid',43),('sha',SHA),('nRestarts',1),('activeState','active')]:
            bad=copy.deepcopy(stopped);bad['peers']['V12_V4'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.validate_stopped_upgrade_context(before,bad,OLD)

    def test_upgrade_freeze_stops_before_signed_read_and_refuses_changed_journal(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        op=m.ProductionOperations(candidate_sha=SHA,static_root=Path('/tmp')/SHA)
        before=dict(writer={'pid':5},killHash='a'*64,peerApprovalHashes={},
            peers={'V12_V4':dict(sha=OLD,pid=42,cwd='/release/'+OLD,activeState='active',nRestarts=0)})
        after=copy.deepcopy(before);after['peers']['V12_V4'].update(pid=0,cwd=None,activeState='inactive')
        op.prior_sha=OLD;op.plan=dict(context=before,durableHash=m.digest(b'original'))
        op.runtime_approval_path=Path('/approval');op.runtime_approval_hash=m.digest(b'authority')
        contexts=iter([before,after,after]);op._context=lambda:next(contexts)
        op.deploy=SimpleNamespace(pw_uid=1000,pw_gid=1000);op.credentials={};op.transaction=Path('/unused')
        calls=[]
        op.sdk=SimpleNamespace(source_release=lambda:None,run_signed_child=lambda *a,**k:calls.append('signed'))
        with patch.object(m.subprocess,'run',side_effect=lambda *a,**k:calls.append('stop')),\
             patch.object(m,'bytes_at',side_effect=lambda p:b'authority' if p==op.runtime_approval_path else b'changed'):
            with self.assertRaisesRegex(ValueError,'DURABLE_CHANGED'):op._freeze_upgrade()
        self.assertEqual(calls,['stop'])
        self.assertTrue(op.upgrade_old_stopped)

    def test_pre_migration_failure_can_restore_only_unchanged_old_authority(self):
        from unittest.mock import patch,MagicMock
        op=m.ProductionOperations(candidate_sha=SHA,static_root=Path('/tmp')/SHA)
        op.prior_sha=OLD;op.upgrade_old_stopped=True;op.pins={'V12_V4':OLD}
        op.runtime_approval_path=Path('/approval');op.runtime_approval_hash=m.digest(b'old')
        op.plan=dict(certificateHash=m.digest(b'old'),killHash=m.digest(b'old'))
        op.transaction=Path('/transaction');op._validate_upgrade_rollback=MagicMock()
        document=dict(releaseSha=OLD)
        with patch.object(m,'json_at',return_value=document),patch.object(m.subprocess,'run') as run,\
             patch.object(m,'exclusive_json'):
            op._restore_unmigrated_upgrade()
        op._validate_upgrade_rollback.assert_called_once()
        self.assertEqual(run.call_args.args[0],['/usr/bin/systemctl','start','disdex-v12-v4@'+OLD+'.service'])
        op._validate_upgrade_rollback.reset_mock()
        with patch.object(m,'json_at',return_value={'releaseSha':SHA}),patch.object(m.subprocess,'run') as run,\
             patch.object(m,'exclusive_json'):
            op._restore_unmigrated_upgrade()
        self.assertEqual([call.args[0][1] for call in run.call_args_list],['disable','stop'])
        self.assertTrue(all('disdex-v4-dynamic-evidence-refresh@'+OLD in ' '.join(call.args[0]) for call in run.call_args_list))
        op._validate_upgrade_rollback.assert_not_called()

    def test_v4_monitor_update_covers_every_layer_and_preserves_all_peer_keys(self):
        from disdex_v52_scoped_root_cutover import layered_monitor_pin_changes
        prefix='DISDEX_WATCHDOG_V12_';base='/home/deploy/disdex-trading/releases'
        rows=[(Path('/old.env'),prefix+'EXPECTED_SHA='+('c'*40)+'\n'+prefix+'RELEASE_ROOT='+base+'/'+('c'*40)+'\nDISDEX_WATCHDOG_Q102_EXPECTED_SHA='+SHA+'\n'),
              (Path('/effective.env'),prefix+'EXPECTED_SHA='+OLD+'\n'+prefix+'RELEASE_ROOT='+base+'/'+OLD+'\n'+prefix+'SERVICE_UNIT=disdex-v12-v4@'+OLD+'.service\n')]
        changes=layered_monitor_pin_changes(rows,prefix,OLD,SHA,base)
        self.assertEqual(len(changes),2)
        self.assertEqual(changes[-1][2][prefix+'SERVICE_UNIT'],'disdex-v12-v4@'+SHA+'.service')
        self.assertTrue(all(not any('Q102' in k for k in before) for _,before,_ in changes))

    def test_certified_unit_uses_shared_file_budget_not_the_readonly_monitor_proxy(self):
        raw=b'[Service]\nEnvironment=DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=/var/lib/disdex/shared/aster-rate-budget.json\n'
        fixed=m.render_certified_budget_unit(raw)
        self.assertIn(b'UnsetEnvironment=DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS',fixed)
        self.assertIn(raw,fixed);self.assertEqual(m.render_certified_budget_unit(fixed),fixed)
    def test_recovery_plan_keeps_exact_existing_pins_and_authority(self):
        current=dict(runners={'V12_V4':SHA},sourceSha=OLD,scope='V12_V4',ordersEnabled=True)
        self.assertEqual(len(m.same_release_recovery_hash(current,current['runners'],OLD,SHA)),64)
        for bad in [dict(current,ordersEnabled=False),dict(current,sourceSha=SHA),dict(current,runners={'V12_V4':OLD})]:
            with self.assertRaises(ValueError):m.same_release_recovery_hash(bad,{'V12_V4':SHA},OLD,SHA)
    def test_same_source_recovery_requires_flat_terminal_durable_history(self):
        d=dict(schema=2,releaseSha=SHA,state=dict(initial=dict(holdProtected=False),foreign=[],legs={}),intents={},protections={})
        self.assertTrue(m.validate_recovery_document(d,SHA))
        for key,value in [('releaseSha',OLD),('intents',{'x':{'stage':'UNKNOWN'}}),('protections',{'x':{'phase':'STOP_CONFIRMED'}})]:
            with self.assertRaises(ValueError):m.validate_recovery_document(dict(d,**{key:value}),SHA)
        for leg in [dict(status='OPEN',qty=1),dict(status='CLOSED',qty=float('nan'))]:
            bad=copy.deepcopy(d);bad['state']['legs']={'x':leg}
            with self.assertRaises(ValueError):m.validate_recovery_document(bad,SHA)
        f=facts();f['monitorOnly']=False
        with self.assertRaises(ValueError):m.validate_priority_evidence(f,NOW)
        f.update(recoveryAuthorized=True,sameSourceProtected=True)
        self.assertTrue(m.validate_priority_evidence(f,NOW))
    def test_refresh_adapter_keeps_the_same_flock_and_exact_candidate(self):
        sha='a'*40
        old='ExecStart=/usr/bin/flock -n /run/disdex-v4-evidence-refresh/refresh.lock /usr/bin/node /home/deploy/disdex-trading/releases/'+sha+'/node_modules/tsx/dist/cli.mjs /home/deploy/disdex-trading/releases/'+sha+'/scripts/ops/root/disdex-v4-dynamic-evidence-refresh.ts --sha '+sha+' --apply --lease /var/lib/disdex/unified-deploy/refresh-leases/v4/'+sha+'.json\n'
        updated=m.render_refresh_service(old.encode(),sha).decode()
        self.assertIn('/usr/bin/flock -n /run/disdex-v4-evidence-refresh/refresh.lock',updated)
        self.assertIn('disdex_v4_refresh_exec.py --sha '+sha,updated)
        with self.assertRaises(ValueError):m.render_refresh_service(old.encode(),'b'*40)
    def test_economic_source_allows_only_line_endings_not_changed_logic(self):
        self.assertTrue(m.economic_source_equal(b'const stop=0.08;\n',b'const stop=0.08;\r\n'))
        self.assertFalse(m.economic_source_equal(b'const stop=0.08;\n',b'const stop=0.09;\r\n'))
    def test_only_the_exact_repaired_obsolete_hold_is_eligible(self):
        self.assertIs(m.validate_priority_evidence(facts(),NOW),True)

    def test_unknown_hold_and_changed_peer_permission_are_rejected(self):
        for key,value in [('reason','OTHER_REASON'),('operator','other'),('recoverable',False),('action','FLATTEN_MANAGED')]:
            f=facts();f['kill'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.validate_priority_evidence(f,NOW)
        for key,value in [('peerPermissionsUnchanged',False),('allPeersAttested',False),
            ('economicsIdentical',False),('time37PriorApprovalVerified',False),('monitorOnly',False),
            ('v52Sha',OLD),('q102Sha',OLD),('positions',1),('openOrders',1),('activePending',1)]:
            f=facts();f[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.validate_priority_evidence(f,NOW)

    def test_stale_future_nonfinite_and_weakened_risk_fail_closed(self):
        for group,key,value in [('risk','maximumLossPct',8),('risk','tripped',True),
            ('risk','sourceComplete',False),('risk','updatedAt',NOW-120001),
            ('risk','updatedAt',NOW+1),('risk','utcDay','2000-01-01'),
            ('margin','checkedAt',NOW-360001),('margin','ordersAllowed',False)]:
            f=facts();f[group][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.validate_priority_evidence(f,NOW)
        for key,value in [('positions',float('nan')),('openOrders',False),('signedVerifiedAt',NOW-30001),
                          ('signedVerifiedAt',NOW+1)]:
            f=facts();f[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.validate_priority_evidence(f,NOW)

class FakeOperations:
    def __init__(self,fail=None):self.calls=[];self.fail=fail
    def stage(self,name):
        self.calls.append(name)
        if self.fail==name:raise RuntimeError(name)
    def preflight(self):self.stage('preflight');return {'planSha256':'a'*64}
    def authorize(self,plan):self.stage('authorize');return {'ordersEnabled':True}
    def prepare(self,grant):self.stage('prepare')
    def activate(self):
        self.stage('activate')
        return dict(status='V4_LIVE_CUTOVER_VERIFIED',auditCycles=[
            {'decisionCycle':{'tickCompletedAt':t}} for t in [1,2,3]])
    def protect_on_failure(self):self.stage('protect')

class PrioritySequenceTest(unittest.TestCase):
    def test_already_staged_unit_does_not_reload_or_change_peer_execution_fingerprints(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);release=root/'release'/SHA
            for sub in ['deploy/systemd','ops/systemd']:(release/sub).mkdir(parents=True,exist_ok=True)
            (release/'deploy/systemd/disdex-v12-v4@.service').write_text('[Service]\nEnvironmentFile=/etc/disdex/current-runtime/%i.env\nExecStartPre=+/usr/bin/node /home/deploy/disdex-trading/releases/%i/scripts/ops/root/disdex-live-operator-activation-gate.mjs\nExecStart=/usr/bin/node /runner\n')
            refresh='ExecStart=/usr/bin/flock -n /run/disdex-v4-evidence-refresh/refresh.lock /usr/bin/node /home/deploy/disdex-trading/releases/%i/node_modules/tsx/dist/cli.mjs /home/deploy/disdex-trading/releases/%i/scripts/ops/root/disdex-v4-dynamic-evidence-refresh.ts --sha %i --apply --lease /var/lib/disdex/unified-deploy/refresh-leases/v4/%i.json\n'
            (release/'ops/systemd/disdex-v4-dynamic-evidence-refresh@.service').write_text(refresh)
            (release/'ops/systemd/disdex-v4-dynamic-evidence-refresh@.timer').write_text('[Timer]\nOnUnitActiveSec=10min\n')
            for sub in ['etc/disdex/current-runtime','etc/systemd/system','var/lib/disdex/unified-deploy']:(root/sub).mkdir(parents=True,exist_ok=True)
            op=m.ProductionOperations(candidate_sha=SHA,static_root=Path('/tmp')/SHA)
            op.release=release;op.plan={'context':{}};op._context=lambda:{};op.authorization={'nonce':'a'*32}
            def path(value):
                text=str(value)
                return root/text.lstrip('/') if text.startswith(('/etc/','/var/')) else Path(value)
            with patch.object(m.os,'O_NOFOLLOW',getattr(m.os,'O_NOFOLLOW',0),create=True),patch.object(m,'Path',side_effect=path),patch.object(m,'bytes_at',side_effect=lambda p:p.read_bytes()),patch.object(m.subprocess,'run') as run:
                op._stage_unit();self.assertEqual(run.call_count,1)
                op._stage_unit();self.assertEqual(run.call_count,1)

    def test_authority_precedes_any_preparation_and_full_executor_owns_audit(self):
        op=FakeOperations();r=m.execute_priority(op)
        self.assertEqual(r['status'],'V4_LIVE_CUTOVER_VERIFIED')
        self.assertEqual(op.calls,['preflight','authorize','prepare','activate'])

    def test_unauthorized_preflight_never_changes_live(self):
        for phase in ['preflight','authorize']:
            op=FakeOperations(phase)
            with self.assertRaises(RuntimeError):m.execute_priority(op)
            self.assertNotIn('prepare',op.calls);self.assertNotIn('protect',op.calls)

    def test_mutation_failure_reinstates_protection_without_old_sha_restart(self):
        for phase in ['prepare','activate']:
            op=FakeOperations(phase)
            with self.assertRaises(RuntimeError):m.execute_priority(op)
            self.assertEqual(op.calls[-1],'protect')

    def test_readonly_or_repeated_tick_receipt_is_never_reported_live(self):
        op=FakeOperations()
        op.activate=lambda:dict(status='V4_MONITOR_ONLY_VERIFIED',auditCycles=[])
        with self.assertRaises(ValueError):m.execute_priority(op)
        self.assertEqual(op.calls[-1],'protect')
        op=FakeOperations()
        op.activate=lambda:dict(status='V4_LIVE_CUTOVER_VERIFIED',auditCycles=[
            {'decisionCycle':{'tickCompletedAt':1}} for _ in range(3)])
        with self.assertRaises(ValueError):m.execute_priority(op)

@unittest.skipIf(sys.platform=='win32','POSIX owner-preserving restoration')
class ProtectionRestoreTest(unittest.TestCase):
    def test_same_source_recovery_audits_three_cycles_or_masks_candidate_without_old_restart(self):
        import tempfile,json
        from unittest.mock import patch,MagicMock
        for fail in [False,True]:
            with self.subTest(fail=fail),tempfile.TemporaryDirectory(prefix='disdex-v4-recovery-test-') as folder:
                root=Path(folder);approval=root/'activation.json';approval.write_text('{}');approval.chmod(0o600)
                op=m.ProductionOperations(recovery=True);op.transaction=root;op.runtime_approval_path=approval
                op.recovery_prior_unit='disdex-v12-v4@'+m.PRIOR_SHA+'.service'
                op.runtime_approval_hash=m.digest(approval.read_bytes());op.manifest={'fixture':True};op.pins={'V12_V4':m.CANDIDATE_SHA}
                op.plan_hash='a'*64;op.authorization={'nonce':'b'*32}
                context=dict(peers={},writer={'pid':4},peerApprovalHashes={})
                op.plan=dict(context=context,repository='fixture',deploymentTarget='fixture',operatorTarget='fixture')
                op._context=lambda:context
                unit='disdex-v12-v4@'+m.CANDIDATE_SHA+'.service';systemd=MagicMock()
                systemd.main_pid.side_effect=[0,4242];systemd.is_masked.return_value=False
                systemd.is_active.return_value=True;systemd.is_enabled.return_value=True
                decisions=RuntimeError('AUDIT_FAILURE') if fail else [dict(tickCompletedAt=t) for t in [1,2,3]]
                kwargs=dict(side_effect=decisions)
                with patch.object(m,'V4LocalUnitSystemdAdapter',return_value=systemd),patch.object(m,'ROOT',root),patch.object(m,'exclusive_json') as receipt,\
                    patch.object(m,'json_at',return_value=op.manifest),patch.object(m.subprocess,'run'),\
                    patch('disdex_unified_root_gate._atomic_json') as journal,\
                    patch('disdex_unified_root_gate._validate_venue_evidence',side_effect=lambda value,**kw:value),\
                    patch('disdex_v4_venue_witness.collect_v4_venue_evidence',side_effect=lambda **kw:{}),\
                    patch('disdex_v4_root_cutover.await_v4_decision_cycle',**kwargs):
                    if fail:
                        with self.assertRaises(RuntimeError):op._activate_recovery()
                        systemd.stop.assert_called_once_with(unit);systemd.mask.assert_called_once_with(unit)
                        systemd.enable.assert_not_called();self.assertEqual(journal.call_args.args[1]['phase'],'RECOVERY_REQUIRED_PROTECTED')
                        self.assertEqual(journal.call_args.args[1]['oldUnit'],op.recovery_prior_unit)
                        receipt.assert_not_called()
                    else:
                        r=op._activate_recovery();self.assertEqual([v['decisionCycle']['tickCompletedAt'] for v in r['auditCycles']],[1,2,3])
                        systemd.mask.assert_not_called();self.assertEqual(journal.call_args.args[1]['phase'],'COMMITTED')
                        self.assertEqual(receipt.call_args.args[1]['status'],'V4_LIVE_CUTOVER_VERIFIED')
                    systemd.start.assert_called_once_with(unit)
    def test_scoped_mask_preserves_local_unit_and_restores_it_without_starting_anything(self):
        import tempfile,os
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(prefix='disdex-v4-mask-test-') as folder:
            root=Path(folder);units=root/'units';units.mkdir();backups=root/'backups';backups.mkdir(mode=0o700)
            unit='disdex-v12-v4@'+'a'*40+'.service';path=units/unit;raw=b'[Service]\nExecStart=/fixture/monitor-only\n';path.write_bytes(raw)
            adapter=m.V4LocalUnitSystemdAdapter({unit},backups,unit_root=units,root_uid=os.getuid())
            with patch.object(adapter,'active_state',return_value='inactive'),patch.object(adapter,'main_pid',return_value=0),patch.object(adapter,'_run') as run,patch.object(m.subprocess,'run'):
                adapter.mask(unit);self.assertTrue(path.is_symlink());self.assertEqual(str(path.readlink()),'/dev/null')
                adapter.unmask(unit);self.assertEqual(path.read_bytes(),raw)
                self.assertFalse(any(call.args[0] in ('start','restart') for call in run.call_args_list))
                with self.assertRaises(ValueError):adapter.mask('disdex-other.service')
            with patch.object(adapter,'active_state',return_value='active'):
                with self.assertRaises(ValueError):adapter.mask(unit)
    def test_a_killed_child_before_receipt_is_still_recovered_and_new_trip_is_preserved(self):
        import tempfile,json
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(prefix='disdex-v4-priority-test-') as folder:
            root=Path(folder);path=root/'kill-switch.json'
            op=m.ProductionOperations();op.plan_hash='c'*64;op.authorization={'nonce':'b'*32}
            op.original_kill=json.dumps({'active':True,'action':'HOLD_PROTECTED','reason':m.REASON}).encode()
            cleared=dict(active=False,action='HOLD_PROTECTED',reason=m.REASON,clearedBy='codex-ssh',
                recoveryPlanSha256=op.plan_hash,recoveryNonceDigest=m.digest(b'b'*32))
            path.write_text(json.dumps(cleared));path.chmod(0o600)
            with patch.object(m,'SHARED',root):op.protect_on_failure()
            self.assertEqual(path.read_bytes(),op.original_kill)
            new_trip=json.dumps(dict(cleared,active=True,reason='NEW_SAFETY_TRIP')).encode();path.write_bytes(new_trip)
            with patch.object(m,'SHARED',root):op.protect_on_failure()
            self.assertEqual(path.read_bytes(),new_trip)

    def test_restore_is_protective_owner_preserving_and_compare_and_swap_only(self):
        import tempfile,json
        with tempfile.TemporaryDirectory(prefix='disdex-v4-priority-test-') as folder:
            path=Path(folder)/'kill.json';cleared=b'{"active":false}\n';path.write_bytes(cleared);path.chmod(0o600)
            before=path.stat();old=b'{"active":true,"action":"HOLD_PROTECTED","reason":"old"}\n'
            m.restore_owned_hold(path,m.digest(cleared),old)
            self.assertEqual(path.read_bytes(),old)
            self.assertEqual((path.stat().st_uid,path.stat().st_gid,path.stat().st_mode&0o777),
                (before.st_uid,before.st_gid,0o600))
            with self.assertRaises(ValueError):m.restore_owned_hold(path,m.digest(cleared),old)
            self.assertEqual(path.read_bytes(),old)

if __name__=='__main__':unittest.main()
