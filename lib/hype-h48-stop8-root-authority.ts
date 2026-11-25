/**
 * H48+STOP8 Root/Owner cryptographic authority for a FUTURE immutable release.
 * Strictly a verifier: never signs, issues, redeems, clears a kill switch,
 * submits a venue order or mutates Root files. A Root-owned certificate and
 * an Ed25519 HP Owner token bound to the EXACT STOP8 plan are both required.
 *
 * This is a new contract, not a parser for the older H48_TIME_ONLY cert.
 */
import {createHash,createPublicKey,verify} from "node:crypto";
import {lstat,readFile} from "node:fs/promises";
import type {AccountLockHandle} from "./disdex-account-order-lock";
import type {H48RootGrantVerifier,H48ScopedOwnerOrderGrant} from "./hype-h48-native-order-executor";
import type {H48OrderIntent} from "./hype-h48-execution-journal";
import type {H48Stop8OwnerAuthority} from "./hype-h48-resident-stop8";
import {validateHypeH48TimeOnlyContract,type HypeH48TimeOnlyContract} from "./hype-stable4-time-only-contract";
import type {H48Stop8RootPositionEvidence} from "./hype-h48-stop8-policy-intent";

export const H48_STOP8_ROOT_BUNDLE_SCHEMA="disdex-h48-stop8-root-owner-bundle/v1" as const;
export const H48_STOP8_ROOT_DIR="/etc/disdex/stable4/h48-stop8" as const;
export const H48_STOP8_RECEIPT_DIR="/var/lib/disdex/unified-deploy/h48-stop8-issuance" as const;
export const H48_OWNER_PUBKEY="/var/lib/disdex/unified-deploy/owner-approval-public.pem" as const;
const TARGET="professional-dismanager.net";
const REPO="dunamishajime-bit/-ai-dex-manager";
const OPERATOR_TARGET="DD1296_FINAL_ALLIN_10BPS";
const SHA=/^[a-f0-9]{40}$/;
const HEX64=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail=(reason:string):never=>{throw Error("H48_STOP8_ROOT_GRANT_INVALID:"+reason)};
const uint=(x:unknown):x is number=>typeof x==="number"&&Number.isSafeInteger(x)&&x>0;
const pos=(x:unknown):x is number=>typeof x==="number"&&Number.isFinite(x)&&x>0;
const strictKeys=(obj:unknown,keys:readonly string[]):obj is Record<string,unknown>=>
  !!obj&&typeof obj==="object"&&!Array.isArray(obj)
  &&Object.keys(obj).length===keys.length
  &&Object.keys(obj).every(k=>keys.includes(k));
const canonical=(value:unknown):unknown=>Array.isArray(value)
  ?value.map(canonical)
  :value&&typeof value==="object"
    ?Object.fromEntries(Object.entries(value as Record<string,unknown>)
      .sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>[key,canonical(val)]))
    :value;
const sorted=(v:unknown)=>JSON.stringify(canonical(v));
function parseJsonUnique(text:string):unknown{
  // HP token's field dictionary is flat. Canonical re-encoding below rejects
  // duplicates/extra fields by byte equality, not last-key-wins JSON.parse.
  try {return JSON.parse(text);}catch {fail("JSON_INVALID");}
}
export interface H48Stop8RootBundle {
  schema:typeof H48_STOP8_ROOT_BUNDLE_SCHEMA;
  approvedSha:string;planSha256:string;
  deploymentTarget:typeof TARGET;
  scope:"HYPE_TREND_LONG";
  operation:"HYPE_STABLE4_H48_STOP8_LIVE";
  policy:"H48_R4_RESIDENT_STOP8";
  residentStopRequired:true;
  residentTakeProfitRequired:false;
  stopTriggerPct:8;
  stopOrderType:"STOP_MARKET";
  stopReduceOnly:true;
  gross:{crypto:3;stock:4;total:4.25;hype:1.5};
  approvalId:string;
  ownerSignedToken:string;
  issuedAt:number;expiresAt:number;
  maxEntryNotionalUsd:number;maxSlippageBps:number;
}
const BUNDLE_FIELDS=[
 "schema","approvedSha","planSha256","deploymentTarget","scope","operation",
 "policy","residentStopRequired","residentTakeProfitRequired","stopTriggerPct",
 "stopOrderType","stopReduceOnly","gross","approvalId","ownerSignedToken",
 "issuedAt","expiresAt","maxEntryNotionalUsd","maxSlippageBps",
] as const;
const OWNER_FIELDS=[
 "schema","repository","deploymentTarget","operatorTarget","route","sourceSha",
 "scope","operator","nonce","issuedAt","expiresAt","planSha256","ordersEnabled",
] as const;
function base64Canonical(raw:string){
  if(typeof raw!=="string"||raw.length===0||raw.length>16_384
     ||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))fail("OWNER_TOKEN_ENCODED_INVALID");
  const bytes=Buffer.from(raw,"base64");
  if(bytes.toString("base64")!==raw)fail("OWNER_TOKEN_BASE64_NONCANONICAL");
  return bytes;
}
export function attestH48Stop8RootBundle(input:{
  bundle:unknown;rootCertificateBytes:Uint8Array;
  trustedOwnerEd25519PublicPem:Uint8Array;
  sourceSha:string;planSha256:string;
  now:number;
}):Readonly<{bundle:H48Stop8RootBundle;certificateSha256:string}>{
  const {sourceSha,planSha256,now}=input;
  const b=input.bundle as H48Stop8RootBundle;
  if(!SHA.test(sourceSha)||!HEX64.test(planSha256)||!uint(now)
    ||!strictKeys(b,BUNDLE_FIELDS)
    ||b.schema!==H48_STOP8_ROOT_BUNDLE_SCHEMA
    ||b.approvedSha!==sourceSha||b.planSha256!==planSha256
    ||b.deploymentTarget!==TARGET||b.scope!=="HYPE_TREND_LONG"
    ||b.operation!=="HYPE_STABLE4_H48_STOP8_LIVE"
    ||b.policy!=="H48_R4_RESIDENT_STOP8"
    ||b.residentStopRequired!==true||b.residentTakeProfitRequired!==false
    ||b.stopTriggerPct!==8||b.stopOrderType!=="STOP_MARKET"
    ||b.stopReduceOnly!==true
    ||!strictKeys(b.gross,["crypto","stock","total","hype"])
    ||b.gross.crypto!==3||b.gross.stock!==4
    ||b.gross.total!==4.25||b.gross.hype!==1.5
    ||!UUID.test(String(b.approvalId))
    ||!uint(b.issuedAt)||!uint(b.expiresAt)
    ||b.issuedAt>now||b.expiresAt<=now
    ||b.expiresAt-b.issuedAt>30*86_400_000
    ||!pos(b.maxEntryNotionalUsd)||!pos(b.maxSlippageBps)
    ||b.maxSlippageBps>30)fail("EXACT_ROOT_CERTIFICATE_FIELDS");
  // Reject certificates with alternate JSON fields and encodings; fixed
  // issuer canonical JSON (one trailing LF) prevents semantic substitution.
  const bytes=Buffer.from(input.rootCertificateBytes);
  if(bytes.length>16384||bytes.toString("utf8")!==sorted(b)+"\n")
    fail("ROOT_CERTIFICATE_CANONICAL_BYTES");
  const ownerTokenText=base64Canonical(b.ownerSignedToken).toString("utf8");
  const outer=parseJsonUnique(ownerTokenText);
  if(!strictKeys(outer,["payload","signature"])
    ||ownerTokenText!==sorted(outer))fail("OWNER_TOKEN_FIELDS");
  const token=outer as {payload:unknown;signature:unknown};
  if(!strictKeys(token.payload,OWNER_FIELDS))fail("OWNER_SIGNED_PAYLOAD_FIELDS");
  const p=token.payload as Record<string,unknown>;
  if(p.schema!=="disdex-owner-deployment-approval/v2"
    ||p.repository!==REPO||p.deploymentTarget!==TARGET
    ||p.operatorTarget!==OPERATOR_TARGET||p.route!=="GITHUB_ACTIONS"
    ||p.sourceSha!==sourceSha||p.scope!=="HYPE_TREND_LONG"
    ||p.operator!=="dunamishajime-bit"
    ||p.planSha256!==planSha256||p.ordersEnabled!==true
    ||typeof p.nonce!=="string"||!/^[a-f0-9]{32}$/.test(p.nonce)
    ||!uint(p.issuedAt)||!uint(p.expiresAt)
    ||Number(p.expiresAt)-Number(p.issuedAt)>300
    ||Number(p.issuedAt)*1000>b.issuedAt+30000
    ||Number(p.expiresAt)*1000<b.issuedAt-30000)
    fail("OWNER_SIGNED_PLAN_POLICY_SCOPE_MISMATCH");
  const sig=typeof token.signature==="string"?base64Canonical(token.signature):Buffer.alloc(0);
  if(sig.length!==64)fail("OWNER_TOKEN_SIGNATURE_LENGTH");
  let verified=false;
  try {
    const key=createPublicKey(Buffer.from(input.trustedOwnerEd25519PublicPem).toString("utf8"));
    verified=key.asymmetricKeyType==="ed25519"&&verify(null,Buffer.from(sorted(p)),key,sig);
  }catch{verified=false;}
  if(!verified)fail("OWNER_ED25519_SIGNATURE_INVALID");
  return Object.freeze({bundle:b,
    certificateSha256:createHash("sha256").update(bytes).digest("hex")});
}
/** Derive an ephemeral, position-specific STOP8 proof only from an
 * already independently verified Owner-signed Root certificate. */
export function deriveH48Stop8PositionEvidence(input:{
  attested:Readonly<{bundle:H48Stop8RootBundle;certificateSha256:string}>;
  contract:HypeH48TimeOnlyContract;quantity:number;now:number;
}):H48Stop8RootPositionEvidence{
  const c=validateHypeH48TimeOnlyContract(input.contract,input.contract);
  const b=input.attested.bundle;
  if(c.sourceSha!==b.approvedSha
    ||b.policy!=="H48_R4_RESIDENT_STOP8"||b.residentStopRequired!==true
    ||!pos(input.quantity)||!uint(input.now)
    ||input.now>=b.expiresAt||!HEX64.test(input.attested.certificateSha256))
    fail("POSITION_PROOF_NOT_ROOT_BOUND");
  return {
    schema:"disdex-h48-stop8-position-policy-evidence/v1",
    policy:"H48_R4_RESIDENT_STOP8",
    runtimeSha:c.sourceSha,planSha256:b.planSha256,
    positionId:c.positionId,logicalEntryTs:c.logicalEntryTs,
    logicalExitTs:c.logicalExitTs,quantity:input.quantity,
    certificateSha256:input.attested.certificateSha256,
    validatedAt:input.now,expiresAt:Math.min(b.expiresAt,input.now+120_000),
  };
}
const RECEIPT_SCHEMA="disdex-h48-stop8-issuance-receipt/v1" as const;
const PERMIT_SCHEMA="disdex-h48-stop8-scoped-order-permit/v1" as const;
const RECEIPT_FIELDS=[
 "schema","approvedSha","planSha256","certificateSha256","approvalId",
 "runId","policy","issuedAt","ordersEnabled","orderPermitIssued",
] as const;
const PERMIT_FIELDS=[
 "schema","approvedSha","planSha256","certificateSha256","approvalId",
 "scope","operation","policy","ordersEnabled","issuedAt","expiresAt",
] as const;
/** A certificate without an immutable, same-source/same-Owner receipt is
 * never enough to enable HYPE entry or protected STOP8 maintenance. */
export function attestH48Stop8IssuanceReceipt(input:{
  receipt:unknown;rawBytes:Uint8Array;
  certificateSha256:string;approvedSha:string;planSha256:string;
  approvalId:string;issuedAt:number;
}):void{
  const r=input.receipt as Record<string,unknown>;
  if(!strictKeys(r,RECEIPT_FIELDS)
    ||r.schema!==RECEIPT_SCHEMA||r.approvedSha!==input.approvedSha
    ||r.planSha256!==input.planSha256
    ||r.certificateSha256!==input.certificateSha256
    ||r.approvalId!==input.approvalId||r.issuedAt!==input.issuedAt
    ||typeof r.runId!=="string"||!/^[0-9]{1,20}$/.test(r.runId)
    ||r.policy!=="H48_R4_RESIDENT_STOP8"
    ||r.ordersEnabled!==false||r.orderPermitIssued!==false
    ||Buffer.from(input.rawBytes).toString("utf8")!==sorted(r)+"\\n")
    fail("IMMUTABLE_RECEIPT_NOT_ATTESTED");
}
/** A signed Owner certificate alone is NOT a scoped permission to trade.
 * Root must independently install an exact, short-lived, immutable permit
 * through the protected Environment approval, never an injected Boolean. */
export function attestH48Stop8ScopedOrderPermit(input:{
  permit:unknown;rawBytes:Uint8Array;
  certificateSha256:string;approvedSha:string;planSha256:string;
  approvalId:string;now:number;
}):Readonly<{issuedAt:number;expiresAt:number}>{
  const p=input.permit as Record<string,unknown>;
  if(!strictKeys(p,PERMIT_FIELDS)
    ||p.schema!==PERMIT_SCHEMA||p.approvedSha!==input.approvedSha
    ||p.planSha256!==input.planSha256
    ||p.certificateSha256!==input.certificateSha256
    ||p.approvalId!==input.approvalId
    ||p.scope!=="HYPE_TREND_LONG"
    ||p.operation!=="HYPE_STABLE4_H48_STOP8_LIVE"
    ||p.policy!=="H48_R4_RESIDENT_STOP8"
    ||p.ordersEnabled!==true
    ||!uint(p.issuedAt)||!uint(p.expiresAt)
    ||p.issuedAt>input.now||p.expiresAt<=input.now
    ||p.expiresAt-p.issuedAt>24*3_600_000
    ||Buffer.from(input.rawBytes).toString("utf8")!==sorted(p)+"\\n")
    fail("SCOPED_ROOT_ORDER_PERMIT_INVALID");
  return {issuedAt:p.issuedAt,expiresAt:p.expiresAt};
}
async function rootImmutable(path:string) {
  const first=await lstat(path);
  if(!first.isFile()||first.isSymbolicLink()
      ||first.uid!==0||first.gid!==0||(first.mode&0o222)!==0)
    fail("ROOT_FILE_OWNER_MODE");
  const bytes=await readFile(path);
  const last=await lstat(path);
  if(last.ino!==first.ino||last.dev!==first.dev
    ||last.size!==first.size||last.mtimeMs!==first.mtimeMs)
    fail("ROOT_FILE_CHANGED_DURING_READ");
  return bytes;
}
/** Root directory/key and current SHA are fixed; no alternate path or
 * caller-provided public key can be supplied in the production verifier. */
export class FileH48Stop8RootAuthority
  implements H48RootGrantVerifier,H48Stop8OwnerAuthority {
  constructor(private readonly sourceSha:string,private readonly planSha256:string) {
    if(!SHA.test(sourceSha)||!HEX64.test(planSha256))fail("SOURCE_OR_PLAN_SHA");
  }
  private async attest(lease:AccountLockHandle,now:number){
    const doc=await lease.document();
    if(doc.accountScope!=="ASTER_FUTURES"
       ||doc.leaseId!==lease.leaseId||doc.ownerId!==lease.ownerId
       ||doc.expiresAt<=now||doc.acquiredAt>now)
      fail("SINGLE_WRITER_LEASE_NOT_ATTESTED");
    const root=await rootImmutable(H48_STOP8_ROOT_DIR+"/"+this.sourceSha+".json");
    const ownerKey=await rootImmutable(H48_OWNER_PUBKEY);
    const certificate=attestH48Stop8RootBundle({
      bundle:parseJsonUnique(root.toString("utf8")),
      rootCertificateBytes:root,trustedOwnerEd25519PublicPem:ownerKey,
      sourceSha:this.sourceSha,planSha256:this.planSha256,now,
    });
    const receiptRaw=await rootImmutable(H48_STOP8_RECEIPT_DIR+"/"+this.sourceSha+".json");
    attestH48Stop8IssuanceReceipt({
      receipt:parseJsonUnique(receiptRaw.toString("utf8")),rawBytes:receiptRaw,
      certificateSha256:certificate.certificateSha256,
      approvedSha:this.sourceSha,planSha256:this.planSha256,
      approvalId:certificate.bundle.approvalId,issuedAt:certificate.bundle.issuedAt,
    });
    return certificate;
  }
  async attestPosition(input:{
    contract:HypeH48TimeOnlyContract;quantity:number;
    lease:AccountLockHandle;now:number;
  }):Promise<H48Stop8RootPositionEvidence>{
    const attested=await this.attest(input.lease,input.now);
    return deriveH48Stop8PositionEvidence({
      attested,contract:input.contract,quantity:input.quantity,now:input.now,
    });
  }
  async verifyForOrder(input:{
    pending:H48OrderIntent;runtimeSha:string;
    lease:AccountLockHandle;now:number;
  }):Promise<H48ScopedOwnerOrderGrant> {
    if(input.runtimeSha!==this.sourceSha||!uint(input.now))
      fail("ORDER_SOURCE_OR_TIME");
    const record=await this.attest(input.lease,input.now);
    if(input.pending.certificateSha256!==record.certificateSha256)
      fail("ORDER_CERTIFICATE_BINDING");
    const permitRaw=await rootImmutable(H48_STOP8_ROOT_DIR+"/"+this.sourceSha+".order-enable.json");
    const permit=attestH48Stop8ScopedOrderPermit({
      permit:parseJsonUnique(permitRaw.toString("utf8")),rawBytes:permitRaw,
      certificateSha256:record.certificateSha256,
      approvedSha:this.sourceSha,planSha256:this.planSha256,
      approvalId:record.bundle.approvalId,now:input.now,
    });
    return {
      schema:"disdex-h48-production-order-grant/v2",
      scope:"HYPE_TREND_LONG",approvedSha:this.sourceSha,
      planSha256:this.planSha256,
      certificateSha256:record.certificateSha256,
      clientOrderId:input.pending.clientOrderId,phase:input.pending.phase,
      approvalId:record.bundle.approvalId,
      issuedAt:Math.max(permit.issuedAt,input.now-1000),
      expiresAt:Math.min(permit.expiresAt,input.now+60_000),
      maxEntryNotionalUsd:record.bundle.maxEntryNotionalUsd,
      maxSlippageBps:record.bundle.maxSlippageBps,
      grossCapHype:1.5,stopGovernanceCertified:true,
    };
  }
  async assertSignedResidentStop8(input:{
    sourceSha:string;planSha256:string;positionId:string;
    lease:AccountLockHandle;now:number;
  }):Promise<void>{
    if(input.sourceSha!==this.sourceSha||input.planSha256!==this.planSha256
       ||!input.positionId.startsWith("H48|HYPEUSDT|"))
      fail("STOP8_POSITION_OR_PLAN");
    await this.attest(input.lease,input.now);
  }
}
