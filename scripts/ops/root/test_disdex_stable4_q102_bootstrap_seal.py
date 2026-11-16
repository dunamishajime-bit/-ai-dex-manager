import hashlib,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import disdex_stable4_q102_bootstrap_seal as seal

class Q102BootstrapTests(unittest.TestCase):
 def fixture(self):
  now=1800000000000;frontier=now//seal.HOUR*seal.HOUR-seal.HOUR
  state={'schemaVersion':1,'observedThrough':frontier,'recoveryUnresolved':[]}
  raw=json.dumps(state).encode();result={'schema':'disdex-stable4-outcome-bootstrap/v1','status':'CAUSAL_OBSERVATIONS_AND_OUTCOMES_BOOTSTRAPPED','ordersEnabled':False,'ordersSent':0,'through':frontier+seal.HOUR,'stateSha256':seal.digest(raw),'model':{'observedThrough':frontier},'unresolvedLabelsExcludedFromTraining':[],'sourceCacheSha256':seal.digest(b'cache'),'requestPlanSha256':seal.digest(b'plan'),'evidenceSha256':{'APTUSDT':seal.digest(b'evidence')}}
  report=json.dumps(result).encode();return dict(state_raw=raw,result_raw=report,source_cache_raw=b'cache',request_plan_raw=b'plan',evidence_files={'APTUSDT':b'evidence'},expected_state_sha256=seal.digest(raw),expected_result_sha256=seal.digest(report),now_ms=now)
 def test_current_hour_requires_latest_completed_observation_and_bound_result(self):
  args=self.fixture();result=seal.validate_candidate(**args);self.assertEqual(result['observedThrough'],args['now_ms']//seal.HOUR*seal.HOUR-seal.HOUR)
  with self.assertRaisesRegex(ValueError,'STALE'):seal.validate_candidate(**{**args,'now_ms':args['now_ms']+seal.HOUR})
  with self.assertRaisesRegex(ValueError,'HASH'):seal.validate_candidate(**{**args,'expected_state_sha256':'f'*64})
  with self.assertRaisesRegex(ValueError,'SOURCE_EVIDENCE'):seal.validate_candidate(**{**args,'evidence_files':{'APTUSDT':b'wrong'}})
 def test_unresolved_and_mutation_claims_are_checked(self):
  args=self.fixture();report=json.loads(args['result_raw']);report['ordersSent']=1
  raw=json.dumps(report).encode()
  with self.assertRaisesRegex(ValueError,'EVIDENCE'):seal.validate_candidate(**{**args,'result_raw':raw,'expected_result_sha256':seal.digest(raw)})
  report['ordersSent']=0;report['unresolvedLabelsExcludedFromTraining']=[{'reason':'unverified'}];raw=json.dumps(report).encode()
  with self.assertRaisesRegex(ValueError,'UNRESOLVED'):seal.validate_candidate(**{**args,'result_raw':raw,'expected_result_sha256':seal.digest(raw)})
 @unittest.skip('blocked draft: install must fail before any I/O until writer exclusion is redesigned')
 def test_receipt_failure_restores_previous_state_and_never_sends_orders(self):
  args=self.fixture();state=args['state_raw'];now=args['now_ms'];receipt={'candidateSha':'a'*40,'priorQ102Sha':'b'*40,'authorizesTrading':False,'stateSha256':seal.digest(state),'observedThrough':now//seal.HOUR*seal.HOUR-seal.HOUR}
  with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[3]/'.tmp') as d:
   root=Path(d);(root/'receipts').mkdir();pins=root/'pins.json';pins.write_bytes(b'pins');target=root/'state.json';target.write_bytes(b'old state')
   real_open=os.open
   def fail_receipt(path,flags,*rest,**kwargs):
    if str(path).endswith('a'*40+'.json'):raise PermissionError('test receipt failure')
    return real_open(path,flags,*rest,**kwargs)
   with patch.object(seal,'assert_old_q_not_learning',return_value=123),patch.object(seal,'require_receipt_directory'),patch.object(seal.os,'chown',create=True),patch.object(seal.os,'open',side_effect=fail_receipt):
    with self.assertRaises(PermissionError):seal.install(receipt=receipt,state_raw=state,expected_prior_sha256=seal.digest(b'old state'),pins_path=pins,pins_before=b'pins',state_path=target,receipt_dir=root/'receipts',deploy_uid=0,deploy_gid=0,now_ms=now)
   self.assertEqual(target.read_bytes(),b'old state');self.assertEqual(list((root/'receipts').iterdir()),[])
 def test_install_refuses_even_apparently_valid_input_before_filesystem_io(self):
  with self.assertRaisesRegex(RuntimeError,'DRAFT_BLOCKED'):
   seal.install(receipt={},state_raw=b'',expected_prior_sha256=None,pins_path=Path('/not-used'),pins_before=b'',deploy_uid=1,deploy_gid=1)

class OldQ102WriterExclusionTests(unittest.TestCase):
 def test_active_legacy_q102_requires_explicit_stable4_off(self):
  source_sha = 'b'*40
  class FakeProc:
   def __init__(self, raw, release):self.raw=raw;self.release=release
   def __truediv__(self, _):return self
   def resolve(self):return self.release
   def read_bytes(self):return self.raw
  def run(args, **_):
   class Reply: returncode=0;stdout='ActiveState=active\nMainPID=123\n'
   return Reply()
  correct = seal.RELEASES/source_sha
  for raw in (b'PATH=/usr/bin\x00', b'DISDEX_STABLE4_MODE=LIVE\x00',
              b'DISDEX_STABLE4_MODE=OFF\x00DISDEX_STABLE4_MODE=OFF\x00'):
   with self.subTest(raw=raw), self.assertRaisesRegex(ValueError,'WRITER_EXCLUSION'):
    seal.assert_old_q_not_learning(source_sha,run=run,proc=FakeProc(raw,correct))
  self.assertEqual(seal.assert_old_q_not_learning(
   source_sha,run=run,proc=FakeProc(b'DISDEX_STABLE4_MODE=OFF\x00',correct)),123)
  with self.assertRaisesRegex(ValueError,'IDENTITY'):
   seal.assert_old_q_not_learning(source_sha,run=run,proc=FakeProc(
    b'DISDEX_STABLE4_MODE=OFF\x00',seal.RELEASES/('a'*40)))

 def test_old_q102_stopped_has_no_active_writer_pid(self):
  def run(args, **_):
   class Reply: returncode=0;stdout='ActiveState=inactive\nMainPID=0\n'
   return Reply()
  self.assertEqual(seal.assert_old_q_not_learning('b'*40,run=run),0)

if __name__=='__main__':unittest.main()
