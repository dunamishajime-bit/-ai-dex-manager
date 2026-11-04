import sys
import os
import tempfile
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"/"ops"/"deploy"))
import disdex_v4_static_evidence as m

SHA="a"*40

class StaticEvidenceContractTest(unittest.TestCase):
    @unittest.skipUnless(os.name=='posix' and getattr(os,'geteuid',lambda:1)()==0,'actual Linux Root filesystem required')
    def test_actual_root_staging_rejects_links_mutable_paths_and_existing_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);target=base/SHA;target.mkdir(mode=0o700)
            with patch.object(m,'STAGING_BASE',base):
                self.assertEqual(m._assert_staging_output(SHA,target),target)
                target.chmod(0o755)
                with self.assertRaisesRegex(ValueError,'METADATA'):m._assert_staging_output(SHA,target)
                target.chmod(0o700)
                alias=base/'alias';alias.symlink_to(base,target_is_directory=True)
                with self.assertRaisesRegex(ValueError,'SYMLINK'):m._assert_staging_output(SHA,alias/SHA)
                (target/'route-source-parity.json').write_text('{}')
                with self.assertRaisesRegex(ValueError,'ALREADY_EXISTS'):m._assert_staging_output(SHA,target)
                with self.assertRaisesRegex(ValueError,'UNTRUSTED'):m._assert_staging_output('b'*40,target)

    @unittest.skipUnless(os.name=='posix' and getattr(os,'geteuid',lambda:1)()==0,'actual Linux Root filesystem required')
    def test_exclusive_publication_cannot_overwrite_a_prior_staging_result(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'route-source-parity.json'
            m._atomic(path,{'candidateSha':SHA},exclusive=True)
            before=path.read_bytes()
            with self.assertRaises(FileExistsError):m._atomic(path,{'candidateSha':'b'*40},exclusive=True)
            self.assertEqual(path.read_bytes(),before)
            self.assertEqual(sorted(p.name for p in path.parent.iterdir()),[path.name])

    def test_staged_certification_writes_only_candidate_private_outputs(self):
        writes=[];target=Path('/var/lib/disdex/ops-audit/v4-upgrade/run')/SHA
        with patch.object(m,'_assert_release',return_value=Path('/candidate')), \
             patch.object(m,'_assert_staging_output',return_value=target,create=True), \
             patch.object(m.Path,'is_file',return_value=True), \
             patch.object(m,'_run',side_effect=[dict(sha256='1'*64,returnCode=0,testsPassed=20),dict(sha256='2'*64,returnCode=0,testsPassed=9),dict(sha256='3'*64,returnCode=0,testsPassed=0)]), \
             patch.object(m,'_atomic',side_effect=lambda path,value,**kwargs:writes.append(path)):
            result=m.certify(SHA,output_root=target)
        self.assertEqual(len(writes),2)
        self.assertTrue(all(path.parent==target for path in writes))
        self.assertEqual(result['status'],'V4_STATIC_EVIDENCE_STAGED_NOT_LIVE')
        self.assertIs(result['authorizesTrading'],False)

    def test_untrusted_staging_output_is_rejected_before_test_execution(self):
        with patch.object(m,'_assert_release',return_value=Path('/candidate')), \
             patch.object(m,'_assert_staging_output',side_effect=ValueError('STAGING_OUTPUT_UNTRUSTED'),create=True), \
             patch.object(m,'_run') as run,patch.object(m,'_atomic') as write:
            with self.assertRaisesRegex(ValueError,'STAGING_OUTPUT_UNTRUSTED'):
                m.certify(SHA,output_root=Path('/etc/disdex/v12-v4-evidence'))
        run.assert_not_called();write.assert_not_called()

    def test_certification_is_candidate_bound_and_requires_all_commands(self):
        writes={}
        with patch.object(m,"_assert_release",return_value=Path("/candidate")), \
             patch.object(m.Path,"is_file",return_value=True), \
             patch.object(m,"_run",side_effect=[
                 {"sha256":"1"*64,"returnCode":0,"testsPassed":20},
                 {"sha256":"2"*64,"returnCode":0,"testsPassed":9},
                 {"sha256":"3"*64,"returnCode":0,"testsPassed":0},
             ]) as runner, \
             patch.object(m,"_atomic",side_effect=lambda path,value:writes.__setitem__(path.name,value)):
            result=m.certify(SHA)
        self.assertEqual(result["status"],"V4_STATIC_EVIDENCE_CERTIFIED")
        self.assertEqual(result["candidateSha"],SHA)
        self.assertEqual(writes["route-source-parity.json"]["candidateSha"],SHA)
        self.assertEqual(writes["route-source-parity.json"]["routeCount"],41)
        self.assertTrue(writes["route-source-parity.json"]["sourceParity"])
        self.assertEqual(writes["v4-execution-tests.json"]["testPasses"],29)
        self.assertEqual(writes["v4-execution-tests.json"]["commandCount"],3)
        self.assertEqual(writes["v4-execution-tests.json"]["failCount"],0)
        self.assertTrue(writes["v4-execution-tests.json"]["typecheck"])
        self.assertIn('tsconfig.v4-release-candidate.json',runner.call_args_list[-1].args[1])

    def test_zero_exit_without_a_positive_unambiguous_test_summary_is_not_certification(self):
        for stdout in ['', '# tests 0\n# pass 0\n# fail 0\n', '# tests 2\n# pass 1\n# fail 1\n']:
            with self.subTest(stdout=stdout),patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=stdout,stderr='')):
                with self.assertRaisesRegex(ValueError,'TEST_SUMMARY'):
                    m._run(Path('/candidate'),['node','tsx','--test','--test-reporter=tap','test.ts'])

    def test_bad_candidate_sha_is_rejected_before_tests(self):
        with patch.object(m.os,"geteuid",return_value=0,create=True):
            with self.assertRaisesRegex(ValueError,"SHA_INVALID"):
                m._assert_release("latest")

if __name__=="__main__":
    unittest.main()
