import json,sys,unittest,os,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
import disdex_v4_refresh_exec as m

SHA='a'*40
def document():
    return dict(schema='disdex-v4-dynamic-evidence-commit/v1',sha=SHA,scope='V4_EVIDENCE_REFRESH_ONLY',
        ordersEnabled=False,authorizesTrading=False,capturedAt='2026-11-04T00:00:00.000Z',
        evidenceSha256={'signedAsterAccount':'b'*64},evidencePayloads={'signedAsterAccount':{'positions':[
            dict(symbol='FIXTUREUSDT',positionAmt='0',entryPrice='0') for _ in range(3000)]}})
class RefreshSerializationTest(unittest.TestCase):
    def blocked(self,reason='V4_BUDGET_PROXY_RESPONSE_INVALID',**changes):
        from types import SimpleNamespace
        event=dict(status='V4_DYNAMIC_EVIDENCE_REFRESH_BLOCKED',reason=reason,readOnly=True,
                   authorizesTrading=False,tradingEffects=dict(ordersSent=0,cancelsSent=0,positionChangesSent=0))
        event.update(changes)
        return SimpleNamespace(returncode=1,stdout='',stderr=json.dumps(event))
    def test_bounded_readonly_retry_reexecutes_the_same_validating_worker(self):
        from types import SimpleNamespace
        failed=self.blocked();success=SimpleNamespace(returncode=0,stdout='fresh worker result',stderr='')
        sequence=iter([failed,success]);calls=[];waits=[];events=[];command=['node','immutable-worker','--sha',SHA]
        result=m.run_refresh_child(command,cwd=Path('/release')/SHA,
            runner=lambda *a,**kw:calls.append((a,kw)) or next(sequence),wait=waits.append,jitter=lambda:0,emit=events.append)
        self.assertIs(result,success);self.assertEqual(waits,[15]);self.assertEqual(len(calls),2)
        self.assertTrue(all(call[0]==(command,) and call[1]['cwd']==Path('/release')/SHA for call in calls))
        self.assertEqual(events[0]['status'],'V4_REFRESH_READONLY_RETRY_DEFERRED')
    def test_retry_is_bounded_and_never_accepts_a_rejected_budget_response(self):
        failed=self.blocked();calls=[];waits=[]
        result=m.run_refresh_child(['node','immutable-worker'],cwd=Path('/release'),
            runner=lambda *a,**kw:calls.append(a) or failed,wait=waits.append,jitter=lambda:0,emit=lambda x:None)
        self.assertIs(result,failed);self.assertEqual(len(calls),3);self.assertEqual(waits,[15,30])
    def test_expired_lease_after_budget_deferral_stops_without_a_third_attempt(self):
        sequence=iter([self.blocked('ASTER_GLOBAL_RATE_BUDGET_SATURATED:4519'),self.blocked('V4_REFRESH_LEASE_EXPIRED')]);calls=[];waits=[]
        result=m.run_refresh_child(['node','immutable-worker','--lease','original-lease'],cwd=Path('/release'),
            runner=lambda *a,**kw:calls.append(a) or next(sequence),wait=waits.append,jitter=lambda:0,emit=lambda x:None)
        self.assertEqual(len(calls),2);self.assertEqual(waits,[15]);self.assertIn('V4_REFRESH_LEASE_EXPIRED',result.stderr)
        self.assertEqual(m.public_refresh_failure(result),'V4_REFRESH_LEASE_EXPIRED')
    def test_wrong_sha_lease_expiry_risk_or_unknown_error_is_not_retried(self):
        from types import SimpleNamespace
        failures=[self.blocked(reason) for reason in ['V4_REFRESH_LEASE_EXPIRED','V4_DYNAMIC_REFRESH_SHARED_RISK_NOT_HEALTHY','WRONG_SHA','UNKNOWN']]
        failures += [self.blocked(authorizesTrading=True),self.blocked(readOnly=False),
                     self.blocked(tradingEffects=dict(ordersSent=1,cancelsSent=0,positionChangesSent=0)),
                     SimpleNamespace(returncode=1,stdout='',stderr='not JSON')]
        for failed in failures:
            calls=[];waits=[]
            result=m.run_refresh_child(['node','immutable-worker'],cwd=Path('/release'),
                runner=lambda *a,**kw:calls.append(a) or failed,wait=waits.append,jitter=lambda:0,emit=lambda x:None)
            self.assertIs(result,failed);self.assertEqual(len(calls),1);self.assertEqual(waits,[])
    @unittest.skipUnless(hasattr(os,'geteuid') and os.geteuid()==0,'actual root ownership test')
    def test_atomic_compaction_preserves_ownership_and_rejects_a_symlink(self):
        with tempfile.TemporaryDirectory(prefix='disdex-v4-refresh-test-') as folder:
            path=Path(folder)/'commit.json';d=document();path.write_text(json.dumps(d,indent=2));path.chmod(0o640)
            before=path.stat();m.compact_file(path,SHA);after=path.stat()
            self.assertEqual(json.loads(path.read_bytes()),d)
            self.assertEqual((before.st_uid,before.st_gid,before.st_mode),(after.st_uid,after.st_gid,after.st_mode))
            link=Path(folder)/'link';link.symlink_to(path)
            with self.assertRaises(ValueError):m.compact_file(link,SHA)
    def test_large_pretty_commit_keeps_every_value_hash_and_source_time(self):
        d=document();raw=json.dumps(d,indent=2).encode();self.assertGreater(len(raw),256*1024)
        compact=m.compact_document(raw,SHA)
        self.assertLess(len(compact),256*1024);self.assertEqual(json.loads(compact),d)
    def test_other_sha_order_authority_or_oversized_compact_is_rejected(self):
        for key,value in [('sha','c'*40),('ordersEnabled',True),('authorizesTrading',True),('schema','other')]:
            d=document();d[key]=value
            with self.assertRaises(ValueError):m.compact_document(json.dumps(d).encode(),SHA)
        d=document();d['padding']='x'*(256*1024)
        with self.assertRaises(ValueError):m.compact_document(json.dumps(d).encode(),SHA)
if __name__=='__main__':unittest.main()
