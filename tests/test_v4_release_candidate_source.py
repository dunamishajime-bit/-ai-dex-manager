import json
import subprocess
import unittest
from pathlib import Path

PREVIEW = "a5c52b348e1a3cf6a58a90e31318caa1d3478b2e"
REFRESH_HELPERS = "3524e3676848b9260f53164e07257acdda7bcc5c"

def source(path):
    return subprocess.check_output(["git", "show", PREVIEW + ":" + path])

def source_at(commit, path):
    return subprocess.check_output(["git", "show", commit + ":" + path])

class CandidateSourceTest(unittest.TestCase):
    def test_runtime_files_are_exactly_reviewed_preview_plus_explicit_atomic_publication_delta(self):
        manifest = json.loads(source("deploy/v4-staged-overlay/manifest.json"))
        self.assertEqual(manifest["baseSha"], "53a0be396719f0284af4e11b35c66a4ac7d58f79")
        for row in manifest["files"]:
            with self.subTest(target=row["target"]):
                expected = source("deploy/v4-staged-overlay/" + row["source"]).replace(b"\r\n", b"\n")
                if row['target']=='lib/disdex-aster-global-rate-budget.ts':
                    # Preserve every proxy, priority, cooldown and mutex byte.
                    # Only the reviewed exclusive UUID publication differs.
                    for old,new in [
                        (b'const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;',b'const temporary = `${path}.${randomUUID()}.tmp`;'),
                        (b'{ encoding: "utf8", mode: 0o660 });',b'{ encoding: "utf8", mode: 0o660, flag: "wx" });'),
                    ]:
                        self.assertEqual(expected.count(old),1)
                        expected=expected.replace(old,new)
                    absent=b'return errorCode(error) === "ENOENT";'
                    self.assertEqual(expected.count(absent),2)
                    expected=expected.replace(absent,b'return false;',1)
                    expected=expected.replace(absent,b'return false;',1)
                    expected=expected.replace(b'    } catch (error) {\n      return false;\n',
                        b'    } catch (error) {\n      // An absent generation was released; retry mkdir. Treating absence as\n      // stale can rename a different live generation created before eviction.\n      return false;\n',1)
                if row['target']=='scripts/v12-v4-production-runner.ts':
                    old=(b' const peer=/^V4_PEER_UNIT_NOT_RUNNING_OR_WRONG_SHA:/.test(reason);\n'
                         b' if(!stale&&!peer)return;\n'
                         b' return {status:"blocked",reason:`${peer?"V4_PEER_ATTESTATION_RETRY_REQUIRED":"V4_EVIDENCE_REFRESH_REQUIRED"}:${reason}`,')
                    new=(b' const peer=/^V4_PEER_UNIT_NOT_RUNNING_OR_WRONG_SHA:/.test(reason);\n'
                         b" const ledger=reason==='FRESH_SHARED_ACCOUNT_LEDGER_REQUIRED'||reason==='V4_SIGNED_ACCOUNT_READ_WINDOW_STALE';\n"
                         b' if(!stale&&!peer&&!ledger)return;\n'
                         b' return {status:"blocked",reason:`${ledger?"V4_SHARED_ACCOUNT_REFRESH_REQUIRED":peer?"V4_PEER_ATTESTATION_RETRY_REQUIRED":"V4_EVIDENCE_REFRESH_REQUIRED"}:${reason}`,')
                    self.assertEqual(expected.count(old),1)
                    expected=expected.replace(old,new)
                    # The telemetry-only join uses base symbols; execution
                    # candidates retain their original quote-qualified keys.
                    for old, new in [
                        (b'...decision.candidates.map(candidate=>candidate.symbol),',
                         b'...decision.candidates.map(candidate=>candidate.symbol?.replace(/USDT$/,"")),'),
                        (b'...decision.filtered.map(candidate=>candidate.symbol),',
                         b'...decision.filtered.map(candidate=>candidate.symbol?.replace(/USDT$/,"")),'),
                        (b'const candidate=decision.candidates.find(row=>row.symbol===symbol);',
                         b'const candidate=decision.candidates.find(row=>row.symbol?.replace(/USDT$/,"")===symbol);'),
                    ]:
                        self.assertEqual(expected.count(old),1)
                        expected=expected.replace(old,new)
                validity_delta = {
                    "lib/v12-v4-certified-gates.ts": [
                        (b'import {createHash} from "node:crypto";\n',
                         b'import {createHash} from "node:crypto";\nimport validity from "../config/v12-v4-evidence-validity.json";\n'),
                        (b'const EVIDENCE_MAX_AGE_MS=24*60*60*1000;\n',
                         b'const EVIDENCE_MAX_AGE_MS=24*60*60*1000;\nexport const V4_BOUNDED_CERTIFICATE_VALIDITY_MS=validity.certificateDays*86400000;\n'),
                        (b'until<=now||until-from>7*86400000||until<=from)\n',
                         b'until<=now||until-from>(bounded?V4_BOUNDED_CERTIFICATE_VALIDITY_MS:7*86400000)||until<=from)\n'),
                    ],
                    "lib/v12-v4-refresh-commit.ts": [
                        (b"import {createHash} from 'node:crypto';\n",
                         b"import {createHash} from 'node:crypto';\nimport validity from '../config/v12-v4-evidence-validity.json';\n"),
                        (b'c.leaseExpiresAt-c.leaseApprovedAt>86400',
                         b'c.leaseExpiresAt-c.leaseApprovedAt>validity.refreshLeaseDays*86400'),
                    ],
                    "scripts/ops/root/disdex-v4-dynamic-evidence-refresh.ts": [
                        (b'24-hour deadline.  It cannot refresh', b'evidence freshness deadline. It cannot refresh'),
                        (b'import { dirname, join, resolve } from "node:path";\n',
                         b'import { dirname, join, resolve } from "node:path";\nimport validity from "../../../config/v12-v4-evidence-validity.json";\n'),
                        (b'const REFRESH_MAX_LEASE_SECONDS = 24 * 60 * 60;',
                         b'const REFRESH_MAX_LEASE_SECONDS = validity.refreshLeaseDays * 24 * 60 * 60;'),
                    ],
                }
                for old, new in validity_delta.get(row["target"], []):
                    self.assertEqual(expected.count(old), 1)
                    expected = expected.replace(old, new)
                actual = Path(row["target"]).read_bytes().replace(b"\r\n", b"\n")
                self.assertEqual(actual, expected)

    def test_extended_validity_is_exactly_thirty_days(self):
        self.assertEqual(json.loads(Path("config/v12-v4-evidence-validity.json").read_text()),
                         {"certificateDays": 30, "refreshLeaseDays": 30})

    def test_supervisor_fixture_is_the_reviewed_integration_version(self):
        expected = source("scripts/ops/root/disdex-runner-health-snapshot-v2.mjs").replace(b"\r\n", b"\n")
        self.assertEqual(Path("tests/fixtures/disdex-runner-health-snapshot-v2.mjs").read_bytes().replace(b"\r\n", b"\n"), expected)

    def test_refresh_helpers_are_exactly_the_reviewed_root_helpers(self):
        for path in (
            "scripts/ops/root/disdex-v4-evidence-refresh-activate",
        ):
            with self.subTest(path=path):
                expected = source_at(REFRESH_HELPERS, path).replace(b"\r\n", b"\n")
                actual = Path(path).read_bytes().replace(b"\r\n", b"\n")
                self.assertEqual(actual, expected)

if __name__ == "__main__":
    unittest.main()
