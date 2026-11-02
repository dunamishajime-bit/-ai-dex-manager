import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "ops" / "deploy"))
from disdex_v4_live_readiness import assess, PREFIXES, REQUIRED_ROOT, _installed_candidate_sha

class InstalledCandidateMarker(unittest.TestCase):
    def test_root_like_readonly_marker_value_validation(self):
        import os,tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"source-sha"
            p.write_text("a"*40+"\n",encoding="ascii")
            p.chmod(0o444)
            # On non-root local CI the owner check deliberately fails closed.
            # Windows stat reports a synthetic uid; Linux CI verifies the
            # real root-ownership semantics. The value/mode contract is still
            # portable here.
            if os.name=="nt":
                self.assertEqual(_installed_candidate_sha(p),"a"*40)
            else:
                geteuid=getattr(os,"geteuid")
                if geteuid()==0:
                    self.assertEqual(_installed_candidate_sha(p),"a"*40)
                else:
                    self.assertIsNone(_installed_candidate_sha(p))
            p.chmod(0o644)
            self.assertIsNone(_installed_candidate_sha(p))


class ReadinessFailsClosed(unittest.TestCase):
    def baseline(self):
        return {
            "currentReleaseSha": "a" * 40,
            "killSwitchActive": False,
            "rootPrerequisites": {k: {"present": True} for k in REQUIRED_ROOT},
            "runnerUnits": {
                k: [{"unit": v + "@" + "b"*40 + ".service", "active": "active"}]
                for k, v in PREFIXES.items()
            },
            "candidate": {
                "markerMatches": True, "localRuntime": True, "sourceGate": True,
                "readyProof": True, "release": {"rootOwned": True},
            },
            "legacyRunnerReleaseOwnership": "all-root-owned",
            "auxiliaryLiveRootsVerified": True,
        }

    def test_never_mints_owner_or_venue_proofs(self):
        b=assess(self.baseline())
        self.assertIn("OWNER_SIGNATURE_AND_GITHUB_REVIEW_NOT_ATTESTED",b)
        self.assertIn("VENUE_SIGNED_STOP_PRESERVATION_NOT_ATTESTED",b)

    def test_codex_root_ssh_activation_is_not_reported_as_missing_owner_signature(self):
        s=self.baseline()
        s["candidateSha"] = s["currentReleaseSha"]
        s["authorization"] = {
            "route": "CODEX_SSH",
            "authorizationMethod": "ROOT_SSH_SESSION",
            "approvedSha": s["currentReleaseSha"],
            "ordersEnabled": True,
        }
        self.assertNotIn("OWNER_SIGNATURE_AND_GITHUB_REVIEW_NOT_ATTESTED", assess(s))

    def test_active_kill_switch_old_v4_failed_and_unowned_legacy_block(self):
        s=self.baseline()
        s["killSwitchActive"]=True
        s["runnerUnits"]["V12_V4"][0]["active"]="failed"
        s["legacyRunnerReleaseOwnership"]="legacy-deploy-owned-or-absent"
        r=assess(s)
        self.assertIn("SHARED_KILL_SWITCH_NOT_HEALTHY",r)
        self.assertIn("V4_BASELINE_RUNNER_NOT_ACTIVE",r)
        self.assertIn("LEGACY_RUNNER_RELEASE_TRUST_TRANSITION_UNPROVEN",r)

    def test_missing_signer_plan_venue_and_pin_are_blockers(self):
        s=self.baseline()
        for x in ("ownerSignaturePublicKey","currentPlan","runnerPinManifest","venueBefore","venueAfter"):
            s["rootPrerequisites"][x]={"present":False}
        r=assess(s)
        for x in ("ownerSignaturePublicKey","currentPlan","runnerPinManifest","venueBefore","venueAfter"):
            self.assertIn("MISSING_"+x,r)

    def test_missing_and_failed_peer_are_blocked(self):
        s=self.baseline()
        s["runnerUnits"]["MARGIN_GUARD"]=[]
        s["runnerUnits"]["IDLE_PRIORITY_SHORT"][0]["active"]="failed"
        r=assess(s)
        self.assertIn("MISSING_RUNNER_UNIT_MARGIN_GUARD",r)
        self.assertIn("PEER_RUNNER_NOT_ACTIVE_IDLE_PRIORITY_SHORT",r)

    def test_candidate_not_verified_never_passes(self):
        s=self.baseline()
        s["candidate"]["markerMatches"]=False
        self.assertIn("CANDIDATE_RELEASE_NOT_CERTIFIED",assess(s))

if __name__=="__main__":
    unittest.main()
