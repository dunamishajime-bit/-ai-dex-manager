/** R26 live-entry certificate verifier. No signing, no issuing, no order authority. */
import {open} from "node:fs/promises";
import {constants} from "node:fs";
import {createPublicKey,verify} from "node:crypto";
export const IDLE_R26_ENTRY_CERT_SCHEMA="disdex-idle-r26-live-entry-certificate/v2" as const;
export const IDLE_R26_TRUSTED_ISSUER_PUBLIC_KEY="/etc/disdex/attestation/idle-r26-issuer-ed25519.pem";
export function resolveIdleR26EntrySelection(input:{mode:"SHADOW"|"LIVE";required:boolean;certifiedFlag:boolean}){
 const selected=input.required||input.certifiedFlag;
 return {applyR26:input.mode!=="LIVE"||selected,
  requireCertificate:input.mode==="LIVE"&&selected,
  held:input.mode==="LIVE"&&selected&&!input.certifiedFlag,
  allowIndependentRender:!selected};
}
export type IdleR26EntryCert={
 schema:typeof IDLE_R26_ENTRY_CERT_SCHEMA;approvedSha:string;ownerAcknowledgement:string;
 policy:"IDLE_R26_REMOVE_RENDER_TAO12H_JUP_REL24_VOL";
 candidateRegenerated:849;eligibleReference:197;
 nativeMarketSourceParity:boolean;historicalDataCoverageVerified:boolean;
 fullAccount10And30BpsVerified:boolean;syntheticNativeReplayVerified:boolean;
 dd30AndStopProtectionVerified:boolean;rootReviewApproved:boolean;
 signedIssuerEvidenceSha256:string;
 signedAtEpochMs:number;expiresAtEpochMs:number;issuerSignatureBase64:string;
};
/** Structural check only, never enough to grant LIVE. */
export function assertIdleR26EntryCertificate(raw:unknown,sha:string):IdleR26EntryCert{
 if(!raw||typeof raw!=="object"||!/^([a-f0-9]{40})$/.test(sha))
  throw Error("IDLE_R26_CERT_INVALID");
 const c=raw as Partial<IdleR26EntryCert>;
 if(c.schema!==IDLE_R26_ENTRY_CERT_SCHEMA||c.approvedSha!==sha||
 c.ownerAcknowledgement!=="APPROVE_IDLE_R26_AT_EXACT_SHA"||
 c.policy!=="IDLE_R26_REMOVE_RENDER_TAO12H_JUP_REL24_VOL"||
 c.candidateRegenerated!==849||c.eligibleReference!==197||
 c.nativeMarketSourceParity!==true||c.historicalDataCoverageVerified!==true||
 c.fullAccount10And30BpsVerified!==true||c.syntheticNativeReplayVerified!==true||
 c.dd30AndStopProtectionVerified!==true||c.rootReviewApproved!==true||
 typeof c.signedIssuerEvidenceSha256!=="string"||!/^[a-f0-9]{64}$/.test(c.signedIssuerEvidenceSha256)||
 !Number.isSafeInteger(c.signedAtEpochMs)||!Number.isSafeInteger(c.expiresAtEpochMs)||
 typeof c.issuerSignatureBase64!=="string")
  throw Error("IDLE_R26_CERT_NOT_FORMALLY_PROVEN");
 return c as IdleR26EntryCert;
}
/** Canonical, versioned, domain-separated string signed by the trusted root issuer. */
export function idleR26CertificateSignedPayload(c:IdleR26EntryCert):string{
 return "DISDEX_IDLE_R26_CERT_V2\n"+JSON.stringify([
  c.schema,c.approvedSha,c.ownerAcknowledgement,c.policy,c.candidateRegenerated,c.eligibleReference,
  c.nativeMarketSourceParity,c.historicalDataCoverageVerified,c.fullAccount10And30BpsVerified,
  c.syntheticNativeReplayVerified,c.dd30AndStopProtectionVerified,c.rootReviewApproved,
  c.signedIssuerEvidenceSha256,c.signedAtEpochMs,c.expiresAtEpochMs
 ]);
}
/** Pure verification for offline tests. A structural claim is never a signature. */
export function verifyIdleR26IssuerSignature(c:IdleR26EntryCert,publicKeyPem:string,nowMs=Date.now()):void{
 assertIdleR26EntryCertificate(c,c.approvedSha);
 if(!Number.isSafeInteger(nowMs)||c.signedAtEpochMs>nowMs||c.expiresAtEpochMs<=nowMs||
 c.expiresAtEpochMs<=c.signedAtEpochMs||c.expiresAtEpochMs-c.signedAtEpochMs>90*86400000)
  throw Error("IDLE_R26_CERT_EXPIRED_OR_FUTURE");
 let publicKey;
 try{publicKey=createPublicKey(publicKeyPem);}catch{throw Error("IDLE_R26_ISSUER_KEY_INVALID");}
 if(publicKey.asymmetricKeyType!=="ed25519")throw Error("IDLE_R26_ISSUER_KEY_NOT_ED25519");
 const signature=Buffer.from(c.issuerSignatureBase64,"base64");
 if(signature.length!==64||signature.toString("base64")!==c.issuerSignatureBase64||
 !verify(null,Buffer.from(idleR26CertificateSignedPayload(c),"utf8"),publicKey,signature))
  throw Error("IDLE_R26_ISSUER_SIGNATURE_INVALID");
}
/** Root-owned regular file read without following a symlink, including public key. */
async function readRootOwned(path:string):Promise<string>{
 const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const s=await h.stat();
  if(!s.isFile()||s.uid!==0||s.gid!==0||(s.mode&0o022)!==0)
   throw Error("IDLE_R26_CERT_NOT_ROOT_OWNED");
  if(s.size<=0||s.size>65536)throw Error("IDLE_R26_CERT_FILE_SIZE_INVALID");
  return await h.readFile({encoding:"utf8"});
 }finally{await h.close();}
}
export async function assertRootOwnedIdleR26EntryCertificate(path:string,sha:string):Promise<void>{
 // This certificate gate has no trusted issuer on Windows or non-Linux hosts.
 if(process.platform!=="linux")throw Error("IDLE_R26_CERT_LINUX_ROOT_ONLY");
 const raw=JSON.parse(await readRootOwned(path));
 const c=assertIdleR26EntryCertificate(raw,sha);
 const issuerKey=await readRootOwned(IDLE_R26_TRUSTED_ISSUER_PUBLIC_KEY);
 verifyIdleR26IssuerSignature(c,issuerKey);
}
