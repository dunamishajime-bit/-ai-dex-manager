import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {assertIdleR26EntryCertificate,IDLE_R26_ENTRY_CERT_SCHEMA,idleR26CertificateSignedPayload,verifyIdleR26IssuerSignature,assertRootOwnedIdleR26EntryCertificate,type IdleR26EntryCert} from "../lib/idle-r26-entry-certificate";
const sha="a".repeat(40),now=Date.UTC(2026,10,27,0);
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const key=publicKey.export({format:"pem",type:"spki"}).toString();
const base={
 schema:IDLE_R26_ENTRY_CERT_SCHEMA,approvedSha:sha,ownerAcknowledgement:"APPROVE_IDLE_R26_AT_EXACT_SHA",
 policy:"IDLE_R26_REMOVE_RENDER_TAO12H_JUP_REL24_VOL",candidateRegenerated:849,eligibleReference:197,
 nativeMarketSourceParity:true,historicalDataCoverageVerified:true,
 fullAccount10And30BpsVerified:true,syntheticNativeReplayVerified:true,
 dd30AndStopProtectionVerified:true,rootReviewApproved:true,signedIssuerEvidenceSha256:"b".repeat(64),
 signedAtEpochMs:now-1000,expiresAtEpochMs:now+60000,issuerSignatureBase64:""
} satisfies IdleR26EntryCert;
function make(c=base){
 return {...c,issuerSignatureBase64:sign(null,Buffer.from(idleR26CertificateSignedPayload(c)) ,privateKey).toString("base64")};
}
test("root issuer signature is required even for a structurally plausible R26 certificate",()=>{
 const cert=make();
 assert.equal(assertIdleR26EntryCertificate(cert,sha).approvedSha,sha);
 assert.doesNotThrow(()=>verifyIdleR26IssuerSignature(cert,key,now));
 assert.throws(()=>verifyIdleR26IssuerSignature({...cert,issuerSignatureBase64:"a".repeat(88)},key,now),/SIGNATURE_INVALID/);
 assert.throws(()=>verifyIdleR26IssuerSignature({...cert,signedIssuerEvidenceSha256:"c".repeat(64)},key,now),/SIGNATURE_INVALID/);
 assert.throws(()=>verifyIdleR26IssuerSignature({...cert,approvedSha:"f".repeat(40)},key,now),/SIGNATURE_INVALID/);
 assert.throws(()=>verifyIdleR26IssuerSignature({...cert,rootReviewApproved:false} as any,key,now),/NOT_FORMALLY_PROVEN/);
});
test("expired, not-yet-issued, overlong and wrong algorithm all fail closed",()=>{
 const c=make();
 assert.throws(()=>verifyIdleR26IssuerSignature(c,key,now+61000),/EXPIRED_OR_FUTURE/);
 assert.throws(()=>verifyIdleR26IssuerSignature(c,key,now-2000),/EXPIRED_OR_FUTURE/);
 const long={...base,expiresAtEpochMs:now+100*86400000};
 assert.throws(()=>verifyIdleR26IssuerSignature(make(long),key,now),/EXPIRED_OR_FUTURE/);
 const rsa=generateKeyPairSync("rsa",{modulusLength:2048}).publicKey.export({format:"pem",type:"spki"}).toString();
 assert.throws(()=>verifyIdleR26IssuerSignature(c,rsa,now),/NOT_ED25519/);
});
test("missing claims or invalid sha cannot create approval",()=>{
 const c=make();
 assert.throws(()=>assertIdleR26EntryCertificate({},sha),/NOT_FORMALLY_PROVEN/);
 assert.throws(()=>assertIdleR26EntryCertificate(c,"bad"),/INVALID/);
 for(const field of Object.keys(base).filter(x=>!["signedAtEpochMs","expiresAtEpochMs","issuerSignatureBase64"].includes(x))){
  const broken={...c,[field]:false};
  assert.throws(()=>assertIdleR26EntryCertificate(broken,sha),/NOT_FORMALLY_PROVEN/);
 }
});
test("Windows/non-Linux cannot treat a plain test certificate as trusted Root-issued",async()=>{
 if(process.platform!=="linux"){
  await assert.rejects(()=>assertRootOwnedIdleR26EntryCertificate("C:\\does-not-exist",sha),/LINUX_ROOT_ONLY/);
 }
});
