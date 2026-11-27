/** Root-owned exact-SHA R26 admission gate. Never issues a certificate. */
import {lstat,readFile} from "node:fs/promises";
export const IDLE_R26_ENTRY_CERT_SCHEMA="disdex-idle-r26-live-entry-certificate/v1" as const;
export type IdleR26EntryCert={
 schema:typeof IDLE_R26_ENTRY_CERT_SCHEMA;approvedSha:string;ownerAcknowledgement:string;
 policy:"IDLE_R26_REMOVE_RENDER_TAO12H_JUP_REL24_VOL";
 candidateRegenerated:849;eligibleReference:197;
 nativeMarketSourceParity:boolean;historicalDataCoverageVerified:boolean;
 fullAccount10And30BpsVerified:boolean;syntheticNativeReplayVerified:boolean;
 dd30AndStopProtectionVerified:boolean;rootReviewApproved:boolean;
 signedIssuerEvidenceSha256:string;
};
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
 typeof c.signedIssuerEvidenceSha256!=="string"||!/^[a-f0-9]{64}$/.test(c.signedIssuerEvidenceSha256))
  throw Error("IDLE_R26_CERT_NOT_FORMALLY_PROVEN");
 return c as IdleR26EntryCert;
}
export async function assertRootOwnedIdleR26EntryCertificate(path:string,sha:string):Promise<void>{
 const s=await lstat(path);
 if(!s.isFile()||s.isSymbolicLink()||(typeof s.uid==="number"&&(s.uid!==0||s.gid!==0))||(s.mode&0o022)!==0)
 throw Error("IDLE_R26_CERT_NOT_ROOT_OWNED");
 assertIdleR26EntryCertificate(JSON.parse(await readFile(path,"utf8")),sha);
}
