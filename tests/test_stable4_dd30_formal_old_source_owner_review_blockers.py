"""Prevent stale approved 23-file source manifest from certifying new code.

The old formal gate MUST remain red until all source diffs receive genuine
semantic review and a fresh Owner-approved immutable goal/certificate.
"""
from __future__ import annotations
import copy
from hashlib import sha256
import json
from pathlib import Path
import unittest
from scripts.research.stable4_dd30_formal_source_drift_owner_review_evidence import analyze

ROOT=Path(__file__).resolve().parents[1]
ART='docs/research/STABLE4_DD30_23_SOURCE_4_SHA_DRIFT_OWNER_REVIEW_20261128.json'
PIN='497801d477ecb9e63ba2ca54664109645c58c763b22614e8576cb36a16377a01'
CODE='scripts/research/stable4_dd30_formal_source_drift_owner_review_evidence.py'
CODEPIN='e3b4fc19066fb41e37ec81a97d5bcf6fa0acfb616769318bf90c21fafd77ca40'
CHANGED={'lib/aster-v3-client.ts','lib/pengu-dual-ls-v2-portfolio-runner.ts',
         'lib/v12-v4-runner-engine.ts','lib/v12-v4-shared-reservations.ts'}

def read():
    raw=(ROOT/ART).read_bytes()
    if sha256(raw).hexdigest()!=PIN:raise ValueError('FORMAL_SOURCE_REVIEW_PROVENANCE_CHANGED')
    if sha256((ROOT/CODE).read_bytes()).hexdigest()!=CODEPIN:
        raise ValueError('FORMAL_SOURCE_AUDIT_SCRIPT_CHANGED')
    return json.loads(raw)

def check(r):
    if (r.get('schema')!='stable4-dd30-old-formal-gate-candidate-source-drift-owner-review/v1'
        or r.get('status')!='BLOCKED_FOUR_SOURCE_SHA_DRIFTS_REQUIRE_NEW_REVIEW_AND_OWNER_GOAL'
        or r.get('oldManifestSha256')!='4609dec4085f03b3be28d9fd69ff8f76e7bfad2766f49dc3a8e3f03f1566ec1e'
        or r.get('oldSourceGuardSha256')!='0429affe04523b6c76acfea64788b45c5d891b9aeb192efdb971ed6bd43cb83c'):
        raise ValueError('FORMAL_BROKEN_PIN_SCOPE_NOT_PROVEN')
    for k in ('oldSourceManifestPreserved','allRequiredSafetyTokensPresent',
        'requiresManualSemanticReviewAndFreshOwnerGoal','noNewOwnerCertificateIssued',
        'oldFormalRootC731MustStayBlocked'):
        if r.get(k) is not True:raise ValueError('FORMAL_REVIEW_STATE_FORGED:'+k)
    for k in ('oldOwnerApprovalStillValidForNewSources','oldFormalGateExpectedToPass',
        'rootDeploymentReady','productionEligible','orderAuthority'):
        if r.get(k) is not False:raise ValueError('FORMAL_REVIEW_FALSE_LIVE_REDEPLOY:'+k)
    summary=r['summary']
    if summary['sourceFiles']!=23 or summary['exactPreviousPinsMatched']!=19 or summary['candidateSHAChanged']!=4 or summary['semanticReviewRequired']!=4 or summary['liveOrderAuthority'] is not False:
        raise ValueError('FORMAL_23_PIN_COUNTS_CHANGED')
    if set(r['changedSourcePaths'])!=CHANGED or len(r['changedSourcePaths'])!=4 or len(r['files'])!=23:
        raise ValueError('FORMAL_INCOMPLETE_SOURCE_DRIFT_LIST')
    if set(r['currentReadOnlyCandidateSourceIdentity'])!={x['sourcePath'] for x in r['files']}:
        raise ValueError('NEW_SOURCE_REVIEW_CANDIDATE_MANIFEST_INVALID')
    for f in r['files']:
        old=f['previousApprovedManifestSha256'];new=f['candidateCurrentSha256'];name=f['sourcePath']
        if f['allMinimumSafetyTokensPresent'] is not True or f['oldOwnerApprovalCarriesForward'] is not False or f['productionReleaseAllowed'] is not False:
            raise ValueError('OLD_OWNER_CERT_REUSED_AS_NEW')
        if (name in CHANGED)!=(old!=new) or f['candidateExactPinMatchesOld']!=(old==new):
            raise ValueError('OLD_VERSUS_NEW_SOURCE_DRIFT_CONTRADICTION')
        if f['semanticChangeAuditComplete'] is not (old==new):
            raise ValueError('UNREVIEWED_SOURCE_MARKED_SEMANTICALLY_AUDITED')
        if r['currentReadOnlyCandidateSourceIdentity'][name]!=new:
            raise ValueError('NEW_SOURCE_IDENTITY_MANIFEST_FORGED')

class Stable4Dd30OldFormalSourcePinBoundaryTest(unittest.TestCase):
    def test_all_23_current_source_pins_only_four_drift_readonly(self):
        doc=read();check(doc);self.assertEqual(doc,analyze())
    def test_prevent_old_owner_approval_reuse_or_skip_semantic_review(self):
        for k,value in (('oldOwnerApprovalStillValidForNewSources',True),
           ('rootDeploymentReady',True),('productionEligible',True),
           ('oldFormalGateExpectedToPass',True),('orderAuthority',True)):
            doc=copy.deepcopy(read());doc[k]=value
            with self.subTest(field=k),self.assertRaises(ValueError):check(doc)
        doc=read();x=next(f for f in doc['files'] if f['sourcePath'] in CHANGED)
        x['semanticChangeAuditComplete']=True
        with self.assertRaises(ValueError):check(doc)
    def test_reject_hiding_any_of_four_source_sha_diffs(self):
        doc=read();doc['changedSourcePaths'].pop()
        with self.assertRaises(ValueError):check(doc)
        doc=read();doc['summary']['candidateSHAChanged']=3
        with self.assertRaises(ValueError):check(doc)

if __name__=='__main__':unittest.main()
