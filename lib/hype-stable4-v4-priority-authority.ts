import {createHash} from "node:crypto";
import {lstat,readFile} from "node:fs/promises";
import {validateH48TimeOnlyCertificate} from "./hype-stable4-time-only-authority";

const RESEARCH="9e1142f5ec6d4bc285deef023572623bb1c37a34";
const fail=():never=>{throw Error("H48_V4_PRIORITY_ROOT_AUTHORITY_INVALID");};
/** A separate root-issued scope authorizes priority exit, not new entries. */
export function validateH48V4PriorityAuthority(value:unknown,input:{sha:string;certificateSha256:string;now:number}){
 const keys=["schema","approvedSha","researchSha","planSha256","deploymentTarget","scope","h48CertificateSha256","issuedAt","expiresAt","operatorAcknowledgement","authorizesOtherPolicies"];
 if(!value||typeof value!=="object"||Array.isArray(value))fail();const v=value as Record<string,unknown>;
 if(Reflect.ownKeys(v).length!==keys.length||Reflect.ownKeys(v).some(k=>typeof k!=="string"||!keys.includes(k)||!("value" in Object.getOwnPropertyDescriptor(v,k)!)))fail();
 if(v.schema!=="disdex-stable4-v4-h48-priority-authority/v1"||!/^([a-f0-9]{40})$/.test(input.sha)||v.approvedSha!==input.sha||v.researchSha!==RESEARCH||typeof v.planSha256!=="string"||!/^[a-f0-9]{64}$/.test(v.planSha256)||v.deploymentTarget!=="professional-dismanager.net"||v.scope!=="V4_PRIORITY_H48_FULL_EXIT"||v.h48CertificateSha256!==input.certificateSha256||!/^[a-f0-9]{64}$/.test(input.certificateSha256)||v.operatorAcknowledgement!=="V4_PRIORITY_H48_FULL_EXIT"||v.authorizesOtherPolicies!==false||!Number.isSafeInteger(v.issuedAt)||!Number.isSafeInteger(v.expiresAt)||!Number.isSafeInteger(input.now)||(v.issuedAt as number)>input.now||(v.issuedAt as number)<=0||(v.expiresAt as number)<=input.now)fail();
 return Object.freeze({...v});
}
async function rootBytes(path:string){
 const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.uid!==0||before.gid!==0||(before.mode&0o222)!==0)fail();
 const bytes=await readFile(path),after=await lstat(path);
 if(before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||after.uid!==0||after.gid!==0||(after.mode&0o222)!==0)fail();
 return bytes;
}
export function createH48V4PriorityAuthority(sha:string){
 if(!/^[a-f0-9]{40}$/.test(sha))fail();
 return{authorize:async()=>{
  const certificatePath="/etc/disdex/stable4/h48-time-only/"+sha+".json",authorityPath="/etc/disdex/stable4/v4-h48-priority/"+sha+".json";
  const certificate=await rootBytes(certificatePath),authority=await rootBytes(authorityPath),now=Date.now();
  const certificateValue=validateH48TimeOnlyCertificate(JSON.parse(certificate.toString("utf8")),sha,now);
  const approved=validateH48V4PriorityAuthority(JSON.parse(authority.toString("utf8")),{sha,certificateSha256:createHash("sha256").update(certificate).digest("hex"),now});
  if(approved.planSha256!==certificateValue.planSha256||!(await rootBytes(certificatePath)).equals(certificate)||!(await rootBytes(authorityPath)).equals(authority))fail();
 }};
}
