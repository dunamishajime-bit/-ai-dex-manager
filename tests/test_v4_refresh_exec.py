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
