"""Research-only exact-source drift audit for formal STABLE4 DD30 release gate.

Enumerates all 23 old approved-manifest source SHA pins and independently
checks required code protection tokens. NEVER updates the legacy formal
manifest, suppresses a failing CI, issues an owner goal, or grants LIVE orders.
"""
from __future__ import annotations
from hashlib import sha256
import json
from pathlib import Path
import sys
# Executing this file directly under scripts/research does not place the
# repository root on sys.path. Keep the verified source gate import exact.
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from scripts.ops.deploy.stable4_dd30_integrated_source_gate import (
   REQUIRED_TOKENS,normalized_digest,OLD_TARGET,FORMAL_OLD_ROOT,STOP_ROOT
)

ROOT=Path(__file__).resolve().parents[2]
MANIFEST='docs/production/STABLE4_DD30_INTEGRATED_SOURCE_MANIFEST_20261123.json'
MANIFEST_PIN='4609dec4085f03b3be28d9fd69ff8f76e7bfad2766f49dc3a8e3f03f1566ec1e'
GATE='scripts/ops/deploy/stable4_dd30_integrated_source_gate.py'
GATE_PIN='0429affe04523b6c76acfea64788b45c5d891b9aeb192efdb971ed6bd43cb83c'
DRIFTED={
 'lib/aster-v3-client.ts':('4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf','3d1ac92985c99f7a78963a1897a118dff31fffa0f4504b3339c3292ef47dbeb8'),
 'lib/pengu-dual-ls-v2-portfolio-runner.ts':('60a0322431b2399a5529f7be1e79878514387d69be680b45f6933ab69121e62a','ea95ad0cc86c3aa592c3b6b16d0d45106a0170f31a7b7c8008e2fa411f9be546'),
 'lib/v12-v4-runner-engine.ts':('4ae0423f0df8c3ff0823ae7698aeb9de16bb0bab09ccdf241bdc527d3810e04f','a0bff768c5782ceda4f5e44e80b27e143db75b8ba2ef2e6ee96e982a76061e0b'),
 'lib/v12-v4-shared-reservations.ts':('20d2856af6cbe952cb85ef41c67feb3d916248de3d367245db9e1dc8767d0711','834e74aa42d09d8f09bbcd7e8a53224dbde2e9cf36ffe91fe8ab0ebb10bc1958'),
}

def analyze():
    original=(ROOT/MANIFEST).read_bytes();gate=(ROOT/GATE).read_bytes()
    if sha256(original).hexdigest()!=MANIFEST_PIN or sha256(gate).hexdigest()!=GATE_PIN:
        raise ValueError('OLD_FORMAL_SOURCE_OR_GUARD_CHANGED')
    data=json.loads(original)
    if (data.get('schema')!='disdex-stable4-dd30-integrated-source/v1' or
        any(data.get(k) is not False for k in (
          'liveOrderAuthority','productionInstalled','ownerApprovalVerified',
          'formalCutoverComplete','oldC731FormalCutoverMayBeUsed',
          'portfolioDrawdownGuaranteedBelow30')) or
        data.get('v4DdEntryHold')!=0.30):
        raise ValueError('OLD_MANIFEST_APPROVAL_SCOPE_CANNOT_BE_UPGRADED')
    originals=data['sourceSha256']
    if len(originals)!=23 or set(originals)!=set(REQUIRED_TOKENS):
        raise ValueError('EXACT_FORMAL_23_SOURCE_PATHS_DIFFER')
    results=[]
    for f in sorted(REQUIRED_TOKENS):
        path=ROOT/f
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise ValueError('UNSAFE_FORMAL_SOURCE_PATH:'+f)
        blob=path.read_bytes();actual=normalized_digest(blob)
        prior=originals[f]
        old_new=DRIFTED.get(f)
        if old_new is not None and (prior,actual)!=old_new:
            raise ValueError('UNEXPECTED_FORMAL_SOURCE_DRIFT:'+f)
        if old_new is None and actual!=prior:
            raise ValueError('UNREVIEWED_FORMAL_SOURCE_SHA_CHANGED:'+f)
        # Matching a token is only a minimum source-contract assertion; it is
        # NOT evidence of a reviewed semantic diff or a valid Owner approval.
        value=blob.decode('utf-8-sig')
        missing=[text for text in REQUIRED_TOKENS[f] if text not in value]
        if missing:raise ValueError('FORMAL_SOURCE_REQUIRED_SAFETY_TOKENS_MISSING:'+f)
        results.append({'sourcePath':f,'previousApprovedManifestSha256':prior,
            'candidateCurrentSha256':actual,'candidateExactPinMatchesOld':actual==prior,
            'expectedRequiredTokenCount':len(REQUIRED_TOKENS[f]),
            'allMinimumSafetyTokensPresent':True,
            'semanticChangeAuditComplete':False if actual!=prior else True,
            'oldOwnerApprovalCarriesForward':False,'productionReleaseAllowed':False})
    old_root=(ROOT/FORMAL_OLD_ROOT).read_text(encoding='utf8')
    if OLD_TARGET not in old_root:raise ValueError('OLD_ROOT_CUTOVER_UNEXPECTED_CHANGE')
    stop=(ROOT/STOP_ROOT).read_text(encoding='utf8')
    if '53a0be396719f0284af4e11b35c66a4ac7d58f79' in stop:
        raise ValueError('STOP_DIAGNOSTIC_USING_STALE_SHA')
    matched=[r for r in results if r['candidateExactPinMatchesOld']]
    drift=[r for r in results if not r['candidateExactPinMatchesOld']]
    if len(matched)!=19 or len(drift)!=4:
        raise ValueError('FORMAL_SOURCE_PIN_DIFF_NOT_SPECIFIC_TO_FOUR_FILES')
    return {'schema':'stable4-dd30-old-formal-gate-candidate-source-drift-owner-review/v1',
        'status':'BLOCKED_FOUR_SOURCE_SHA_DRIFTS_REQUIRE_NEW_REVIEW_AND_OWNER_GOAL',
        'oldManifestSha256':MANIFEST_PIN,'oldSourceGuardSha256':GATE_PIN,
        'oldSourceManifestPreserved':True,
        'oldOwnerApprovalStillValidForNewSources':False,
        'oldFormalGateExpectedToPass':False,
        'oldFormalRootC731MustStayBlocked':True,
        'allRequiredSafetyTokensPresent':True,
        'summary':{'sourceFiles':len(results),'exactPreviousPinsMatched':len(matched),
          'candidateSHAChanged':len(drift),'requiredSafetyTokensChecked':sum(r['expectedRequiredTokenCount'] for r in results),
          'semanticReviewRequired':len(drift),'liveOrderAuthority':False},
        'currentReadOnlyCandidateSourceIdentity':{r['sourcePath']:r['candidateCurrentSha256'] for r in results},
        'files':results,'changedSourcePaths':[r['sourcePath'] for r in drift],
        'requiresManualSemanticReviewAndFreshOwnerGoal':True,
        'noNewOwnerCertificateIssued':True,
        'rootDeploymentReady':False,'productionEligible':False,'orderAuthority':False,
        'limitations':[
           '19 old exact pins match, four differ. 23 sets of REQUIRED_TOKENS present but source text-token checks alone do NOT prove source semantic safety, unchanged behavior or equivalent Owner approval.',
           'The formal integrated gate failing at lib/aster-v3-client.ts is correct for the old manifest. This report neither repins old manifest nor alters old formal CI or old c731 Root deployment.',
           'New code-specific source diff review, new immutable exact-source manifest and fresh Owner-approved goal/certificate are needed for any formal release. Research only, no LIVE arm or trading actions.',
           'Separately, Q102 complete all-20-symbol 225d H1 annual histories and V52 native 5-stock 2-venue L2 historical books and venue STOP/fill proofs are absent; no approved seven-runner combined BT exists.',
        ]}

if __name__=='__main__':
    if len(sys.argv)!=2:raise ValueError('NEW_FORMAL_SOURCE_AUDIT_OUTPUT_REQUIRED')
    x=analyze()
    with open(sys.argv[1],'x',encoding='utf8',newline='\n') as f:json.dump(x,f,sort_keys=True,indent=2);f.write('\n')
    print('OLD_FORMAL_GATE_DRIFT',json.dumps({'matched':x['summary']['exactPreviousPinsMatched'],'drift':x['summary']['candidateSHAChanged'],'changed':x['changedSourcePaths']},sort_keys=True))
