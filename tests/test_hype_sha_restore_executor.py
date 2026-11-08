import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/ops/deploy"))
from disdex_hype_sha_restore_contract import (
    CANDIDATE, COMMAND, LEGACY, OWNER, PLAN, REPOSITORY, RUNNER, build_v4_continuity_activation,
    parse_command, proposed_pins, v4_continuity_plan,
    validate_forced_command, verify_peer_authority, verify_result,
)


class HypeRestoreContract(unittest.TestCase):
    def test_v4_continuity_is_independently_signed_and_changes_only_hype_peer(self):
        original={RUNNER:LEGACY,"V12_V4":"c"*40,"V52":"d"*40}
        desired=proposed_pins(original)
        priorHash="1"*64
        plan=v4_continuity_plan(original,desired,priorHash)
        self.assertNotEqual(plan,PLAN)
        self.assertNotEqual(plan,v4_continuity_plan(original,desired,"2"*64))
        authority=dict(scope="V12_V4",sourceSha=original["V12_V4"],planSha256=plan,
                       ordersEnabled=True,route="GITHUB_ACTIONS",operator=OWNER,issuedAt=1000,
                       expiresAt=1030,nonce="e"*32)
        artifact=build_v4_continuity_activation(authority,original,desired,priorHash,1010)
        self.assertEqual(artifact["approvedRunners"],["V12_V4"])
        self.assertEqual(artifact["approvedShaByRunner"],desired)
        for patch in ({"scope":RUNNER},{"planSha256":PLAN},{"expiresAt":1010},{"ordersEnabled":False}):
            with self.assertRaises(ValueError):
                build_v4_continuity_activation(dict(authority,**patch),original,desired,priorHash,1010)
        with self.assertRaises(ValueError):
            v4_continuity_plan(original,{**desired,"V52":"9"*40},priorHash)

    @unittest.skipUnless(os.name=="posix" and shutil.which("openssl"),"requires POSIX and OpenSSL")
    def test_ed25519_exact_scope_expiration_and_replay(self):
        from disdex_owner_approval import issue, verify
        with tempfile.TemporaryDirectory() as temp:
            key,pub,nonces=(Path(temp)/n for n in ("test-key","test-pub","nonces"))
            nonces.mkdir(mode=0o700)
            subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(key)],check=True)
            subprocess.run(["openssl","pkey","-in",str(key),"-pubout","-out",str(pub)],check=True)
            token=issue(REPOSITORY,CANDIDATE,RUNNER,OWNER,key,PLAN,now=1000,ttl=30,orders_enabled=True)
            def validate(data=token,sha=CANDIDATE,plan=PLAN,now=1010,nonce_dir=None):
                return verify(data,pub,REPOSITORY,sha,RUNNER,OWNER,plan,now=now,
                              orders_enabled=True,nonce_dir=nonce_dir)
            self.assertTrue(validate()["ordersEnabled"])
            for invalid in ({"sha":LEGACY},{"plan":"0"*64},{"now":1031}):
                with self.assertRaises(ValueError):
                    validate(**invalid)
            row=json.loads(base64.b64decode(token))
            row["signature"]=base64.b64encode(b"x"*64).decode()
            with self.assertRaisesRegex(ValueError,"invalid owner signature"):
                validate(base64.b64encode(json.dumps(row).encode()).decode())
            if os.geteuid()==0:
                validate(nonce_dir=nonces)
                with self.assertRaisesRegex(ValueError,"approval replay"):
                    validate(nonce_dir=nonces)

    def test_proposed_pin_must_preserve_v4_restart_authority(self):
        original = {RUNNER:LEGACY,"V12_V4":"c"*40,"V52":"d"*40}
        proposed = proposed_pins(original)
        self.assertEqual(proposed,{**original,RUNNER:CANDIDATE})
        def verify(pins):
            if pins != original:
                raise ValueError("V4_CANONICAL_OPERATOR_POLICY_BINDING_MISMATCH")
        with self.assertRaisesRegex(ValueError,"V4_RESTART_AUTHORITY_WOULD_BREAK"):
            verify_peer_authority(original, proposed, verify)
        calls = []
        verify_peer_authority(original, proposed, calls.append)
        self.assertEqual(calls,[original,proposed])

    def test_fixed_command_only(self):
        self.assertEqual(parse_command([COMMAND, "--run-id", "42", "--read-approval-stdin"]), "42")
        self.assertEqual(validate_forced_command([COMMAND, "--preflight-readonly"]),
                         [COMMAND,"--preflight-readonly"])
        for args in ([COMMAND, "--run-id", "42; id", "--read-approval-stdin"],
                     [COMMAND, "--run-id", "42", "--read-approval-stdin", "--sha", LEGACY],
                     [COMMAND, "--run-id", "42", "--codex-ssh"], ["/bin/sh"]):
            with self.assertRaises(ValueError):
                validate_forced_command(args)

    def test_candidate_evidence_is_exactly_bound(self):
        result = dict(status="HYPE_SHA_OWNER_REVIEW_REPAIRED", oldSha=LEGACY,
                      newSha=CANDIDATE, reviewEvents=10659, signedVenueReads=3,
                      xrpProtectionVerified=True, venueProofSha256="a"*64,
                      ordersSent=0,cancelsSent=0,positionChangesSent=0)
        self.assertEqual(verify_result(result), "a"*64)
        for patch in ({"newSha":LEGACY},{"signedVenueReads":2},{"ordersSent":1},
                      {"xrpProtectionVerified":False},{"venueProofSha256":""}):
            with self.assertRaises(ValueError):
                verify_result(dict(result, **patch))
        self.assertEqual(RUNNER,"HYPE_TREND_LONG")
        self.assertRegex(PLAN,r"^[a-f0-9]{64}$")
