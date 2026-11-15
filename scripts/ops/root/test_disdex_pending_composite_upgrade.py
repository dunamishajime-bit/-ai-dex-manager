import ast
import copy
from pathlib import Path
import unittest
from unittest.mock import patch
import tempfile
import types
import sys
import stat
import disdex_pending_composite_upgrade as upgrade

class PendingCompositeUpgradeTests(unittest.TestCase):
 def test_release_scan_checks_entire_tree_owner_and_writability(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder).resolve();(root/'nested').mkdir();bad=root/'nested'/'dependency.js';bad.write_text('x')
   real_lstat=Path.lstat
   def lstat(p,*args,**kwargs):
    original=real_lstat(p,*args,**kwargs)
    mode=stat.S_IFMT(original.st_mode)|(0o555 if stat.S_ISDIR(original.st_mode) else 0o444)
    if p==bad and unsafe[0]=='writable':mode|=0o200
    return types.SimpleNamespace(st_mode=mode,st_uid=1000 if p==bad and unsafe[0]=='owner' else 0)
   unsafe=['no']
   with patch.object(Path,'lstat',new=lstat):
    upgrade.validate_immutable_tree(root)
    for kind in ('writable','owner'):
     unsafe[0]=kind
     with self.assertRaises(ValueError):upgrade.validate_immutable_tree(root)
 def test_unit_change_is_exact_source_and_bounded_timeout_only(self):
  unit=('ExecStart=/home/deploy/disdex-trading/releases/'+upgrade.NEW+'/worker\nTimeoutStartSec=660s\nTimeoutStopSec=10s\nRuntimeMaxSec=660s\n').encode()
  old=upgrade.expected_old_unit(unit)
  self.assertEqual(old,('ExecStart=/home/deploy/disdex-trading/releases/'+upgrade.OLD+'/worker\nTimeoutStartSec=60s\nTimeoutStopSec=10s\nRuntimeMaxSec=60s\n').encode())
  for bad in [unit.replace(upgrade.NEW.encode(),b'x'),unit.replace(b'660s',b'900s'),unit+upgrade.NEW.encode()]:
   with self.assertRaises(ValueError):upgrade.expected_old_unit(bad)
 def test_three_distinct_real_no_order_results_are_required(self):
  def cycle(t):return dict(status='PENDING_MAINTENANCE_RECONCILED',sourceSha=upgrade.NEW,scope=upgrade.SCOPE,ordersEnabled=False,completedAt=t+2,result=dict(status='PENDING_READONLY_RECONCILE_APPLIED',verifiedAt=t,ownershipMode='PINNED_OWNER_PROOF',ordersSent=0,cancelsSent=0,positionChangesSent=0))
  rows=[cycle(10),cycle(20),cycle(30)];self.assertEqual(upgrade.validate_cycle_audit(rows)['verifiedAt'],30)
  with self.assertRaises(ValueError):upgrade.validate_cycle_audit(rows[:2])
  for change in [lambda r:r[1]['result'].update(verifiedAt=10),lambda r:r[0].update(sourceSha=upgrade.OLD),lambda r:r[2]['result'].update(ordersSent=1),lambda r:r[1].update(ordersEnabled=True),lambda r:r[0]['result'].update(ownershipMode='COUNTS_ONLY')]:
   altered=copy.deepcopy(rows);change(altered)
   with self.assertRaises(ValueError):upgrade.validate_cycle_audit(altered)
 def test_formal_approval_uses_caller_hash_and_nonce(self):
  source=Path(upgrade.__file__).read_text();tree=ast.parse(source)
  self.assertIn('actual_hash==args.plan_sha256',source)
  self.assertIn('parent._verify_token(args,token,nonce_dir=paths.nonce_dir)',source)
  self.assertNotIn('plan_sha256=actual_hash',source)
  self.assertIn('ROLLBACK_WORKER_BUSY',source)
  self.assertTrue(tree.body)
 def test_dispatch_preserves_other_no_order_installers_and_requires_exact_source(self):
  import hashlib
  ref=Path(upgrade.__file__).resolve().parents[3]/'.tmp/stable4-root-reference-20261115/disdex_unified_root_gate.py'
  if not ref.exists():self.skipTest('captured public source absent')
  source=ref.read_bytes();h=hashlib.sha256(source).hexdigest();modified=upgrade.build_upgrade_dispatch(source,expected_sha256=h).decode()
  self.assertIn("if args.sha == '"+upgrade.NEW+"'",modified)
  self.assertIn('return install(self,args,token)',modified)
  with self.assertRaises(ValueError):upgrade.build_upgrade_dispatch(source,expected_sha256='0'*64)
 def test_composition_preserves_h48_flat_peer_and_worker_dispatches(self):
  import hashlib
  from disdex_stable4_flat_peer_cutover import build_stable4_flat_peer_sources,ROLES
  ref=Path(upgrade.__file__).resolve().parents[3]/'.tmp/stable4-root-reference-20261115'
  if not (ref/'disdex_unified_root_gate.py').exists():self.skipTest('captured public source absent')
  output=build_stable4_flat_peer_sources((ref/'disdex_hype_scoped_root_cutover.py').read_bytes(),(ref/'disdex_unified_root_gate.py').read_bytes(),old_by_role={role:'a'*40 for role in ROLES},h48_old_sha='b'*40)
  gate=output['disdex_unified_root_gate.py'];combined=upgrade.build_upgrade_dispatch(gate,expected_sha256=hashlib.sha256(gate).hexdigest()).decode()
  ast.parse(combined)
  for module in ('disdex_stable4_flat_peer_cutover','disdex_stable4_h48_scoped_root_cutover','disdex_pending_composite_upgrade'):
   self.assertEqual(combined.count(module),2)
 def test_transaction_publishes_receipt_after_nonce_and_rolls_back_failed_reload(self):
  cases=[(False,False,False,None),(True,False,False,None),(False,True,False,None),(False,False,True,None)]+[(False,False,False,s) for s in ['timer_stop','receipt','unit_swap','timer_start']]
  for fail_reload,dry_run,fail_active,crash_stage in cases:
   with self.subTest(fail_reload=fail_reload,dry_run=dry_run,fail_active=fail_active,crash_stage=crash_stage),tempfile.TemporaryDirectory() as folder:
    d=Path(folder);old=d/upgrade.OLD;old.mkdir();(old/'scripts/ops/deploy').mkdir(parents=True)
    old_protocol=(old/'scripts/ops/deploy/disdex_pending_maintenance.py');old_protocol.write_bytes(b'old')
    new=d/upgrade.NEW;new.mkdir();(d/'systemd').mkdir();control=d/'control';(control/'pending-maintenance/committed').mkdir(parents=True)
    oldreceipt=control/'pending-maintenance/committed'/(upgrade.OLD+'.json');oldreceipt.write_text('{}')
    current=control/'current.json';current.write_text('current');pins=d/'pins.json';pins.write_text('pins')
    unit=d/'systemd'/upgrade.SERVICE
    newunit=('source='+upgrade.NEW+'\nTimeoutStartSec=660s\nTimeoutStopSec=10s\nRuntimeMaxSec=660s\n').encode();oldunit=upgrade.expected_old_unit(newunit);unit.write_bytes(oldunit)
    events=[];timer={'active':True};sha='a'*40;planhash='b'*64
    paths=types.SimpleNamespace(root=control,releases=d,current_plan=current,pins=pins,nonce_dir=control/'nonces')
    class Parent:
     root_uid=unit.stat().st_uid
     def __init__(self):self.paths=paths
     clock=lambda self:100
     def _verify_token(self,args,token,nonce_dir=None):events.append('consume' if nonce_dir else 'verify');return {'proof':'root'}
     def _read_current_sha(self,**kw):return sha
     def _assert_expected_pins(self,p):events.append('pins')
    class SDK:
     def validate_receipt(self,*args):pass
     def load_server_credentials(self):return {'ASTER_USER_ADDRESS':'0x'+'1'*40}
     def run_signed_child(self,*args,**kw):return dict(status='PENDING_READONLY_RECONCILE_VERIFIED',ordersSent=0,cancelsSent=0,positionChangesSent=0)
     def render_service(self,s):return newunit.decode()
    import hashlib
    account=hashlib.sha256(('0x'+'1'*40).encode()).hexdigest()
    desired={'sourceSha':upgrade.NEW};current_doc={'sourceSha':sha};prior={'accountIdentitySha256':account}
    def read_json(path,**kw):
     if path==current:return current_doc
     if path==pins:return {'pins':True}
     if path==oldreceipt:return prior
     return desired
    class Crash(BaseException):pass
    crashed=[]
    def crash_at(stage):
     if crash_stage==stage and not crashed:crashed.append(stage);raise Crash(stage)
    def make_file(path,raw,mode,cb):
     cb();path.write_bytes(raw)
     if path.name==upgrade.NEW+'.json' and path.parent.name=='committed':crash_at('receipt')
    maintenance=types.SimpleNamespace(validate_maintenance_plan=lambda *args:(planhash,[]),_load_sdk=lambda r:SDK(),build_receipt=lambda *args:{'ok':True},_new_file=make_file,_sync=lambda p:None,_directory=lambda p:p.mkdir(parents=True,exist_ok=True),canonical=lambda r:__import__('json').dumps(r,sort_keys=True).encode())
    gate=types.SimpleNamespace(read_root_json=read_json,parse_live_pins=lambda p,**kw:{'pin':'x'},release_marker=lambda s,*a,**kw:old if s==upgrade.OLD else new)
    realhash=hashlib.sha256
    def sha256(raw):return types.SimpleNamespace(hexdigest=lambda:'8bcc07c78338d10bf969f8833447512505e236507b165c7c3c5209ba86fbe2ca') if raw==b'old' else realhash(raw)
    reloads=[];active_checks=[]
    def run(argv,**kw):
     op=argv[1:];events.append(' '.join(op))
     if op[0]=='stop':timer['active']=False;crash_at('timer_stop')
     if op[0]=='start':timer['active']=True;crash_at('timer_start')
     if op[0]=='daemon-reload':
      crash_at('unit_swap')
      reloads.append(1)
      if fail_reload and len(reloads)==1:return types.SimpleNamespace(returncode=1,stdout='')
     if op[0]=='is-active':
      active_checks.append(1)
      if fail_active and len(active_checks)==2:return types.SimpleNamespace(returncode=1,stdout='')
     return types.SimpleNamespace(returncode=0,stdout=('active' if timer['active'] else 'inactive') if op[0]=='is-active' or (op[0]=='show' and op[1]==upgrade.TIMER) else '0' if op[0]=='show' else '')
    args=types.SimpleNamespace(scope=upgrade.SCOPE,orders_enabled='false',sha=upgrade.NEW,plan_sha256=planhash)
    pwd=types.SimpleNamespace(getpwnam=lambda name:types.SimpleNamespace(pw_uid=1000,pw_gid=1000))
    real_lstat=Path.lstat
    def lstat(p,*a,**kw):
     v=real_lstat(p,*a,**kw)
     if p==unit:return types.SimpleNamespace(st_mode=(v.st_mode&~0o022),st_uid=v.st_uid)
     if p.name==upgrade.NEW+'.json' and p.parent.name=='transactions':return types.SimpleNamespace(st_mode=(v.st_mode&~0o177)|0o600,st_uid=v.st_uid)
     return v
    with patch.dict(sys.modules,{'disdex_pending_maintenance_install':maintenance,'disdex_unified_root_gate':gate,'pwd':pwd}),patch.object(upgrade,'validate_source_files'),patch.object(upgrade.hashlib,'sha256',side_effect=sha256),patch.object(Path,'lstat',new=lstat):
     if crash_stage:
      with self.assertRaises(Crash):upgrade.upgrade(Parent(),args,'token',systemd_root=d/'systemd',runner=run)
      with self.assertRaisesRegex(ValueError,'APPROVED_UNIT_CHANGED'):
       upgrade.recover_incomplete_upgrade(Parent(),systemd_root=d/'systemd',runner=run,maintenance=maintenance,expected_new_unit=newunit+b'changed',account_lock=d/'no-account-lock')
      busy=d/'busy-account-lock';busy.write_text('active')
      before=unit.read_bytes()
      with self.assertRaisesRegex(ValueError,'ACCOUNT_LOCK_PRESENT'):
       upgrade.recover_incomplete_upgrade(Parent(),systemd_root=d/'systemd',runner=run,maintenance=maintenance,expected_new_unit=newunit,account_lock=busy)
      self.assertEqual(unit.read_bytes(),before);busy.unlink()
      self.assertTrue(upgrade.recover_incomplete_upgrade(Parent(),systemd_root=d/'systemd',runner=run,maintenance=maintenance,expected_new_unit=newunit,account_lock=d/'no-account-lock'))
      self.assertEqual(unit.read_bytes(),oldunit);self.assertFalse((control/'pending-maintenance/committed'/(upgrade.NEW+'.json')).exists())
      self.assertFalse((control/'pending-maintenance/transactions'/(upgrade.NEW+'.json')).exists())
     elif fail_reload or fail_active:
      with self.assertRaises(ValueError):upgrade.upgrade(Parent(),args,'token',systemd_root=d/'systemd',runner=run)
      self.assertEqual(unit.read_bytes(),oldunit);self.assertFalse((control/'pending-maintenance/committed'/(upgrade.NEW+'.json')).exists())
     elif dry_run:
      out=upgrade.upgrade(Parent(),args,'token',systemd_root=d/'systemd',runner=run,dry_run=True)
      self.assertEqual(out['status'],'PENDING_COMPOSITE_READONLY_PREFLIGHT_PASS');self.assertEqual(unit.read_bytes(),oldunit);self.assertNotIn('consume',events)
     else:
      out=upgrade.upgrade(Parent(),args,'token',systemd_root=d/'systemd',runner=run)
      self.assertEqual(out['status'],'PENDING_COMPOSITE_UPGRADED_AWAITING_THREE_REAL_CYCLES');self.assertEqual(unit.read_bytes(),newunit)
     if not dry_run and crash_stage!='timer_stop':self.assertLess(events.index('stop '+upgrade.TIMER),events.index('consume'))
     self.assertTrue(timer['active'])

if __name__=='__main__':unittest.main()
