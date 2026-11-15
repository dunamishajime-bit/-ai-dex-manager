import test from "node:test";
import assert from "node:assert/strict";
import {validateH48V4PriorityAuthority} from "../lib/hype-stable4-v4-priority-authority";
const sha="a".repeat(40),certificateSha256="b".repeat(64),now=1800000000000;
const receipt=()=>({schema:"disdex-stable4-v4-h48-priority-authority/v1",approvedSha:sha,researchSha:"9e1142f5ec6d4bc285deef023572623bb1c37a34",planSha256:"c".repeat(64),deploymentTarget:"professional-dismanager.net",scope:"V4_PRIORITY_H48_FULL_EXIT",h48CertificateSha256:certificateSha256,issuedAt:now-1000,expiresAt:now+1000,operatorAcknowledgement:"V4_PRIORITY_H48_FULL_EXIT",authorizesOtherPolicies:false});
test("root V4 priority scope binds exact source, H48 certificate, research and expiry",()=>{
 assert.equal(validateH48V4PriorityAuthority(receipt(),{sha,certificateSha256,now}).scope,"V4_PRIORITY_H48_FULL_EXIT");
 for(const change of [{approvedSha:"f".repeat(40)},{scope:"V4_ANY_CLOSE"},{h48CertificateSha256:"f".repeat(64)},{researchSha:"f".repeat(40)},{planSha256:"bad"},{expiresAt:now},{operatorAcknowledgement:"YES"},{authorizesOtherPolicies:true},{extra:true}])assert.throws(()=>validateH48V4PriorityAuthority({...receipt(),...change},{sha,certificateSha256,now}),/AUTHORITY/);
});
