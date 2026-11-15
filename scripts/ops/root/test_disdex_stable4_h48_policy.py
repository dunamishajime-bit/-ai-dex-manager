"""Exact research time-only authority never relaxes unrelated inventory ownership."""
import copy
import hashlib
import json
import stat
import types
import unittest
import disdex_stable4_h48_policy as policy
from test_disdex_v4_nonflat_ownership import fixture, SHA as V4_SHA
from disdex_v4_nonflat_ownership import attest_sole_v4_inventory

SHA="c"*40
PLAN="d"*64
NOW=1800000000000
def certificate():
    return {"schema":"disdex-stable4-h48-time-only-policy/v1","approvedSha":SHA,
            "researchSha":"9e1142f5ec6d4bc285deef023572623bb1c37a34","planSha256":PLAN,
            "deploymentTarget":"professional-dismanager.net","policy":"H48_TIME_ONLY",
            "route":"HYPE_REDESIGN_CAUSAL_H48R4_WSIG","symbol":"HYPEUSDT","side":"LONG",
            "holdHours":48,"entryGridHours":6,"residentStopRequired":False,"residentTakeProfitRequired":False,
            "approvedGross":{"crypto":3,"stock":4,"total":4.25,"hype":1},"issuedAt":NOW-1000,"expiresAt":NOW+86400000,
            "operatorAcknowledgement":"H48_TIME_ONLY","authorizesOtherPolicies":False}
def check(c):
    f=getattr(policy,"validate_h48_certificate",None)
    assert callable(f),"missing H48 certificate validator"
    return f(c,approved_sha=SHA,approved_plan_sha256=PLAN,now_ms=NOW)
class H48PolicyTests(unittest.TestCase):
    def test_exact_source_plan_research_policy_and_gross(self):
        self.assertEqual(check(certificate()),certificate())
        for patch in [{"approvedSha":"a"*40},{"planSha256":"e"*64},{"researchSha":"0"*40},{"policy":"TREND"},
                      {"deploymentTarget":"other"},{"route":"HYPE_TREND_LONG_PINNED"},{"holdHours":24},
                      {"entryGridHours":1},{"residentStopRequired":True},{"residentTakeProfitRequired":True},
                      {"authorizesOtherPolicies":True},{"approvedGross":{"crypto":3,"stock":4,"total":4.75,"hype":1}},
                      {"issuedAt":True},{"issuedAt":NOW+1},{"expiresAt":NOW},{"operatorAcknowledgement":"FULL_LIVE"},{"extra":True}]:
            with self.subTest(patch=patch),self.assertRaises(ValueError):check({**certificate(),**patch})
    def test_immutable_root_metadata_is_not_an_environment_boolean(self):
        f=getattr(policy,"validate_h48_certificate_metadata",None);self.assertTrue(callable(f))
        meta=types.SimpleNamespace(st_uid=0,st_gid=0,st_mode=stat.S_IFREG|0o444)
        f(meta)
        for key,value in [("st_uid",1000),("st_gid",1000),("st_mode",stat.S_IFLNK|0o444),("st_mode",stat.S_IFREG|0o644)]:
            bad=copy.copy(meta);setattr(bad,key,value)
            with self.assertRaises(ValueError):f(bad)
    def inventory(self,mutator=None):
        f=getattr(policy,"validate_hype_flat_with_v4_inventory",None);self.assertTrue(callable(f))
        doc,positions,orders=fixture();raw=json.dumps(doc,separators=(",",":")).encode()
        proof={**attest_sole_v4_inventory(doc,V4_SHA,positions,orders),"journalReplayVerified":True,
               "rawDocumentSha256":hashlib.sha256(raw).hexdigest()}
        x=dict(hype_state={"schema":"disdex-hype-zec-long/v1","runtimeCommitSha":SHA,"mode":"LIVE","updatedAt":NOW,"positions":[],"failures":[]},hype_state_sha=SHA,
               v4_raw=raw,v4_sha=V4_SHA,replay_proof=proof,positions=positions,orders=orders,signed_at=NOW-10,now_ms=NOW)
        if mutator:mutator(x)
        return f(**x)
    def test_phase_one_accepts_flat_hype_with_exact_existing_v4_stop_inventory(self):
        result=self.inventory();self.assertTrue(result["hypeFlat"]);self.assertTrue(result["v4OwnershipVerified"])
        self.assertEqual(result["positionSymbols"],["BNBUSDT"]);self.assertEqual(len(result["preservationSha256"]),64)
    def test_hype_foreign_unprotected_or_unreplayed_inventory_never_becomes_flat(self):
        for mutate in [lambda x:x["positions"].append({"symbol":"HYPEUSDT","positionAmt":"1","positionSide":"BOTH"}),
                       lambda x:x["orders"].clear(),lambda x:x["hype_state"].update(pending={"phase":"submitted"}),
                       lambda x:x["hype_state"].update(positions=[{"symbol":"HYPEUSDT","quantity":1}]),
                       lambda x:x["replay_proof"].update(journalReplayVerified=False),
                       lambda x:x["replay_proof"].update(rawDocumentSha256="0"*64),
                       lambda x:x["replay_proof"].update(proofSha256="0"*64),
                       lambda x:x.update(signed_at=NOW-30001),lambda x:x.update(signed_at=NOW+1)]:
            with self.subTest(mutate=mutate),self.assertRaises(ValueError):self.inventory(mutate)
if __name__=="__main__":unittest.main()
