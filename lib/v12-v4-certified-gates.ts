/**
 * Root-managed V4 production certification gate, separate from research and
 * separate from operator approval. Missing/expired/unsigned evidence is HOLD.
 * Creating a local report can never grant real order authority.
 */
import {open,lstat} from "node:fs/promises";
import {constants} from "node:fs";
import {dirname} from "node:path";
import {createHash} from "node:crypto";
import {PRODUCTION_EXIT_CATALOG} from "./v12-v4-production-lifecycle";
import type {V4LiveDecisionSnapshot} from "./v12-v4-live-candidate-builder";
import type {V4DurableOrderCommand} from "./v12-v4-durable-orders";
import type {V4ExecutionDocument} from "./v12-v4-execution-store";
import {V12_V4_V2_POLICY} from "./v12-v4-v2-shadow";
import {V12_V4_CERTIFIED_GROSS_CONTRACT} from "./v12-v4-production-contract";
export const V4_PRODUCTION_CERT_PATH="/etc/disdex/v12-v4-production-certification.json";
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const EVIDENCE_MAX_AGE_MS=24*60*60*1000;
export type V4ProductionCertificate={
 schema:"disdex-v12-v4-production-certification/v2";
 approvedSha:string;policyId:typeof V12_V4_V2_POLICY;
 approvedAt:string;validUntil:string;
 verifiedRoutes:string[];
 evidence:{
  sourceParitySha256:string;exitParitySha256:string;
  tradeExecutionSha256:string;portfolioRiskSha256:string;
  protectedSameSymbolSha256:string;independentForwardSha256:string;
  venueLifecycle:{
   mode:"ASTER_TESTNET"|"AUTHENTIC_PRODUCTION_HISTORY"|"CONTROLLED_PRODUCTION_CANARY";
   signedOrdersSha256:string;signedPositionsSha256:string;
   restartRecoverySha256:string;sameSymbolRaceSha256:string;
   realVenueObserved:true;simulatedOnly:false;
  };
 };
 approvedGross:{v12:number;crypto:number;total:number;recovery:number};
 forwardUnderperformanceAcknowledged:true;
 operatorAcknowledgement:"I_AUTHORIZE_CERTIFIED_V12_V4_REAL_ORDERS";
};
/** Regular V4 production certification may use already-authenticated Aster
 * production history and the V4 execution regression suite. It does NOT
 * require a V4 trade to exist before the first V4 trade can take place.
 * This is a separate version from the earlier exhaustive venue-lifecycle
 * certificate, not an override or a silent relaxation of that contract.
 */
export const V4_SHARED_EXECUTION_EVIDENCE_PATHS={
 routeSourceParity:"/etc/disdex/v12-v4-evidence/route-source-parity.json",
 establishedAsterOrders:"/etc/disdex/v12-v4-evidence/established-aster-orders.json",
 signedAsterAccount:"/etc/disdex/v12-v4-evidence/signed-aster-account.json",
 v4ExecutionTests:"/etc/disdex/v12-v4-evidence/v4-execution-tests.json",
 sharedRiskAndPeers:"/etc/disdex/v12-v4-evidence/shared-risk-and-peers.json",
} as const;
type V4EvidenceKey=keyof typeof V4_SHARED_EXECUTION_EVIDENCE_PATHS;
const STATIC_EVIDENCE_KEYS=new Set<V4EvidenceKey>(["routeSourceParity","v4ExecutionTests"]);
const DYNAMIC_EVIDENCE_KEYS=new Set<V4EvidenceKey>(["establishedAsterOrders","signedAsterAccount","sharedRiskAndPeers"]);
export type V4SharedExecutionCertificate={
 schema:"disdex-v12-v4-production-certification/v3";
 approvedSha:string;policyId:typeof V12_V4_V2_POLICY;
 approvedAt:string;validUntil:string;
 verifiedRoutes:string[];
 venueEvidenceBasis:"ESTABLISHED_ASTER_PRODUCTION_EXECUTION";
 evidenceSha256:Record<V4EvidenceKey,string>;
 approvedGross:{v12:number;crypto:number;total:number;recovery:number};
 risksAcknowledged:{
  v4FirstLiveFillNotYetObserved:true;
  weakIndependentForwardPerformance:true;
 };
 operatorAcknowledgement:"I_AUTHORIZE_CERTIFIED_V12_V4_REAL_ORDERS";
};
export type V4AnyProductionCertificate=V4ProductionCertificate|V4SharedExecutionCertificate;
const FULL_ROUTE_SET=new Set(PRODUCTION_EXIT_CATALOG.map(r=>r.route));
function requireAllRoutes(routes:unknown){
 if(FULL_ROUTE_SET.size!==41||!Array.isArray(routes)||routes.length!==41||
   new Set(routes).size!==41||routes.some((r:unknown)=>!FULL_ROUTE_SET.has(String(r))))
  throw Error("V4_ALL_41_ROUTE_PROOF_REQUIRED");
}
type V4EvidenceRecord=Record<string,unknown>;
function record(value:unknown,key:V4EvidenceKey):V4EvidenceRecord{
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error(`V4_EVIDENCE_CONTENT_INVALID:${key}`);
 return value as V4EvidenceRecord;
}
function numberField(value:unknown,key:string){
 const n=Number(value);if(!Number.isFinite(n))throw Error(`V4_EVIDENCE_FIELD_INVALID:${key}`);return n;
}
function evidenceIsStatic(key:V4EvidenceKey){return STATIC_EVIDENCE_KEYS.has(key);}
function evidenceIsDynamic(key:V4EvidenceKey){return DYNAMIC_EVIDENCE_KEYS.has(key);}
function assertCurrentEvidenceMetadata(value:V4EvidenceRecord,key:V4EvidenceKey,sha:string,now:number){
 if(value.status!=="PASS")throw Error(`V4_EVIDENCE_STATUS_NOT_PASS:${key}`);
 if(value.candidateSha!==sha)throw Error(`V4_EVIDENCE_CANDIDATE_SHA_MISMATCH:${key}`);
 const captured=Date.parse(String(value.capturedAt??""));
  if(!Number.isFinite(captured)||captured>now+5*60_000||
     (evidenceIsDynamic(key)&&now-captured>EVIDENCE_MAX_AGE_MS))
  throw Error(`V4_EVIDENCE_STALE:${key}`);
}
/** Validate redacted evidence content before its digest grants authority. */
export function validateV4SharedExecutionEvidencePayloads(payloads:Record<V4EvidenceKey,unknown>,sha:string,now=Date.now()){
 if(!SHA.test(sha))throw Error("V4_EVIDENCE_SHA_INVALID");
 for(const key of Object.keys(V4_SHARED_EXECUTION_EVIDENCE_PATHS) as V4EvidenceKey[])
  assertCurrentEvidenceMetadata(record(payloads[key],key),key,sha,now);
 const route=record(payloads.routeSourceParity,"routeSourceParity");
 if(numberField(route.routeCount,"routeCount")!==41||route.sourceParity!==true)
  throw Error("V4_EVIDENCE_ROUTE_PARITY_INVALID");
 const orders=record(payloads.establishedAsterOrders,"establishedAsterOrders");
 if(orders.readOnly!==true||numberField(orders.mutationCalls,"mutationCalls")!==0)
  throw Error("V4_EVIDENCE_MUTATION_OR_READONLY_INVALID:establishedAsterOrders");
 const account=record(payloads.signedAsterAccount,"signedAsterAccount");
 if(account.readOnly!==true||account.signedGet!==true||numberField(account.mutationCalls,"mutationCalls")!==0)
  throw Error("V4_EVIDENCE_MUTATION_OR_READONLY_INVALID:signedAsterAccount");
 const tests=record(payloads.v4ExecutionTests,"v4ExecutionTests");
 if(numberField(tests.testPasses,"testPasses")<=0||numberField(tests.failCount,"failCount")!==0||tests.typecheck!==true)
  throw Error("V4_EVIDENCE_TESTS_NOT_PASS");
 const risk=record(payloads.sharedRiskAndPeers,"sharedRiskAndPeers");
 if(risk.sharedRiskHealthy!==true||risk.marginGuardHealthy!==true||risk.killSwitch!==false||numberField(risk.pendingCount,"pendingCount")!==0)
  throw Error("V4_EVIDENCE_HEALTH_NOT_PASS");
 const refreshGenerations=DYNAMIC_EVIDENCE_KEYS.size===0?[]:
  [...DYNAMIC_EVIDENCE_KEYS].map(key=>record(payloads[key],key).refreshGeneration);
 // Dynamic refreshes are written as one staged generation.  Legacy evidence
 // has no marker and remains accepted; once a marker is present, a partial
 // rename or mixed-age bundle is fail-closed instead of being treated as a
 // fresh account/risk proof.
 if(refreshGenerations.some(value=>value!==undefined)&&
   (refreshGenerations.some(value=>typeof value!=="string"||!value)||new Set(refreshGenerations).size!==1))
  throw Error("V4_EVIDENCE_DYNAMIC_REFRESH_GENERATION_MISMATCH");
 return true as const;
}
function validateV4SharedExecutionCertificate(raw:Record<string,any>,sha:string,now:number):V4SharedExecutionCertificate{
 const c=raw;
 if(c.schema!=="disdex-v12-v4-production-certification/v3"||
    c.approvedSha!==sha||c.policyId!==V12_V4_V2_POLICY||
    c.venueEvidenceBasis!=="ESTABLISHED_ASTER_PRODUCTION_EXECUTION"||
    c.operatorAcknowledgement!=="I_AUTHORIZE_CERTIFIED_V12_V4_REAL_ORDERS"||
    c.risksAcknowledged?.v4FirstLiveFillNotYetObserved!==true||
    c.risksAcknowledged?.weakIndependentForwardPerformance!==true)
  throw Error("V4_SHARED_EXECUTION_CERTIFICATE_INVALID");
 requireAllRoutes(c.verifiedRoutes);
 const hashes=c.evidenceSha256;
 if(!hashes||Object.keys(hashes).length!==5||
  !Object.keys(V4_SHARED_EXECUTION_EVIDENCE_PATHS).every(k=>DIGEST.test(String(hashes[k]??""))))
  throw Error("V4_SHARED_EXECUTION_EVIDENCE_INCOMPLETE");
 const caps=c.approvedGross;
 if(!caps||caps.v12!==V12_V4_CERTIFIED_GROSS_CONTRACT.v12||caps.crypto!==V12_V4_CERTIFIED_GROSS_CONTRACT.crypto||caps.total!==V12_V4_CERTIFIED_GROSS_CONTRACT.total||caps.recovery!==V12_V4_CERTIFIED_GROSS_CONTRACT.recovery)
  throw Error("V4_SHARED_RISK_CAP_MISMATCH");
 const from=Date.parse(String(c.approvedAt)),until=Date.parse(String(c.validUntil));
 if(!Number.isFinite(from)||!Number.isFinite(until)||from>now+300000||
   until<=now||until-from>7*86400000||until<=from)
  throw Error("V4_CERTIFICATE_EXPIRED_OR_FUTURE");
 return c as V4SharedExecutionCertificate;
}
/** Read and hash actual root-managed evidence bytes; a plausible hex string,
 * research document or writable paper log is NOT enough to issue authority. */
export async function verifyV4SharedExecutionEvidence(c:V4SharedExecutionCertificate){
 const parent=await lstat("/etc/disdex/v12-v4-evidence");
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||
    (parent.mode&0o022)!==0)throw Error("V4_EVIDENCE_PARENT_UNTRUSTED");
 const payloads={} as Record<V4EvidenceKey,unknown>;
 for(const [key,path] of Object.entries(V4_SHARED_EXECUTION_EVIDENCE_PATHS) as [V4EvidenceKey,string][]){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const st=await file.stat();
   if(!st.isFile()||st.uid!==0||(st.mode&0o022)!==0)
    throw Error("V4_EVIDENCE_FILE_UNTRUSTED:"+key);
   const data=await file.readFile();
    // Static release proofs remain digest-bound to the certificate. Dynamic
    // account/risk proofs are revalidated from the official read-only source
    // on every gate evaluation, so a legitimate 24-hour refresh must not be
    // mistaken for a release tamper and crash the daemon.
    if(evidenceIsStatic(key)&&createHash("sha256").update(data).digest("hex")!==c.evidenceSha256[key])
    throw Error("V4_EVIDENCE_DIGEST_MISMATCH:"+key);
   try{payloads[key]=JSON.parse(data.toString("utf8"));}
   catch{throw Error("V4_EVIDENCE_CONTENT_INVALID:"+key);}
  }finally{await file.close();}
 }
 validateV4SharedExecutionEvidencePayloads(payloads,c.approvedSha);
 return true;
}

export function validateV4ProductionCertificate(raw:unknown,sha:string,now=Date.now()):V4AnyProductionCertificate{
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||!SHA.test(sha))
  throw Error("V4_ROOT_CERTIFICATE_REQUIRED");
 const c=raw as Record<string,any>;
 if(c.schema==="disdex-v12-v4-production-certification/v3")return validateV4SharedExecutionCertificate(c,sha,now);
 if(c.schema!=="disdex-v12-v4-production-certification/v2"||
  c.approvedSha!==sha||c.policyId!==V12_V4_V2_POLICY||
  c.operatorAcknowledgement!=="I_AUTHORIZE_CERTIFIED_V12_V4_REAL_ORDERS"||
  c.forwardUnderperformanceAcknowledged!==true)throw Error("V4_ROOT_CERTIFICATE_INVALID");
 const expected=new Set(PRODUCTION_EXIT_CATALOG.map(r=>r.route));
 if(expected.size!==41||!Array.isArray(c.verifiedRoutes)||c.verifiedRoutes.length!==41||
  new Set(c.verifiedRoutes).size!==41||c.verifiedRoutes.some((r:unknown)=>!expected.has(String(r))))
  throw Error("V4_ALL_41_ROUTE_PROOF_REQUIRED");
 const e=c.evidence;
 if(!e||!["sourceParitySha256","exitParitySha256","tradeExecutionSha256",
   "portfolioRiskSha256","protectedSameSymbolSha256","independentForwardSha256"]
    .every(k=>DIGEST.test(String(e[k]??""))))throw Error("V4_INDEPENDENT_CERT_EVIDENCE_REQUIRED");
 const venue=e.venueLifecycle;
 const modes=new Set(["ASTER_TESTNET","AUTHENTIC_PRODUCTION_HISTORY","CONTROLLED_PRODUCTION_CANARY"]);
 if(!venue||!modes.has(String(venue.mode))||venue.realVenueObserved!==true||
   venue.simulatedOnly!==false||
   !["signedOrdersSha256","signedPositionsSha256","restartRecoverySha256","sameSymbolRaceSha256"]
    .every(k=>DIGEST.test(String(venue[k]??""))))
  throw Error("V4_REAL_VENUE_LIFECYCLE_EVIDENCE_REQUIRED");
 const caps=c.approvedGross;
 if(!caps||caps.v12!==V12_V4_CERTIFIED_GROSS_CONTRACT.v12||caps.crypto!==V12_V4_CERTIFIED_GROSS_CONTRACT.crypto||caps.total!==V12_V4_CERTIFIED_GROSS_CONTRACT.total||caps.recovery!==V12_V4_CERTIFIED_GROSS_CONTRACT.recovery)
  throw Error("V4_SHARED_RISK_CAP_MISMATCH");
 const from=Date.parse(String(c.approvedAt)),until=Date.parse(String(c.validUntil));
 if(!Number.isFinite(from)||!Number.isFinite(until)||from>now+300000||until<=now||
    until-from>7*86400000||until<=from)throw Error("V4_CERTIFICATE_EXPIRED_OR_FUTURE");
 return c as V4ProductionCertificate;
}
export async function readV4ProductionCertificate(sha:string,
 path:string=V4_PRODUCTION_CERT_PATH,now=Date.now()){
 if(path!==V4_PRODUCTION_CERT_PATH)throw Error("V4_CERT_PATH_OVERRIDE_DENIED");
 const parent=await lstat(dirname(path));
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||
  (parent.mode&0o022)!==0)throw Error("V4_CERT_PARENT_WRITABLE");
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=await f.stat();
  if(!st.isFile()||st.uid!==0||(st.mode&0o022)!==0||
   (st.gid!==0&&st.gid!==process.getgid?.()))
    throw Error("V4_CERT_NOT_ROOT_SECURE");
  const cert=validateV4ProductionCertificate(JSON.parse(await f.readFile("utf8")),sha,now);
  if(cert.schema==="disdex-v12-v4-production-certification/v3")await verifyV4SharedExecutionEvidence(cert);
  return cert;
 }finally{await f.close();}
}
export async function assertV4CertifiedSource(sha:string,decision:V4LiveDecisionSnapshot){
 await readV4ProductionCertificate(sha);
 if(decision.policyId!==V12_V4_V2_POLICY||decision.schema!=="v12-v4-live-decision/v1"||
   decision.orderEnabled!==false||decision.realOrderEnabledV4!==0||
   decision.tradingMutation!==0||decision.errors.length||
   !DIGEST.test(decision.sourceFingerprint)||decision.decisionTs<Date.parse("2026-08-11T00:00:00Z")||
   decision.capturedAtMs<decision.decisionTs||decision.capturedAtMs-decision.decisionTs>135*60000)
  throw Error("V4_LIVE_CAUSAL_SOURCE_NOT_VERIFIED");
}
export async function assertV4CertifiedOrder(sha:string,command:V4DurableOrderCommand,
 ownedDocument?:V4ExecutionDocument){
 if(!command.legId||!command.symbol||!(command.quantity>0)||!(command.price>0)||
   !["ENTRY","STOP","TAKE_PROFIT","EXIT"].includes(command.action))
  throw Error("V4_CERTIFIED_ORDER_COMMAND_INVALID");
 if(command.action==="ENTRY")return readV4ProductionCertificate(sha);
 // New entries require a fresh certificate; signed reduce-only exits and
 // protection of an already held leg must remain possible after expiration.
 if(!ownedDocument||ownedDocument.releaseSha!==sha)
  throw Error("V4_REDUCE_ONLY_WITHOUT_SIGNED_V4_OWNERSHIP");
 const leg=ownedDocument.state.legs[command.legId];
 if(!leg||leg.qty<=0||leg.status==="CLOSED"||leg.status==="CANCELLED"||
   leg.candidate.symbol!==command.symbol||leg.candidate.effectiveSide!==command.positionSide||
   !Number.isFinite(command.quantity)||command.quantity>leg.qty+1e-10)
  throw Error("V4_REDUCE_ONLY_OWNER_OR_QUANTITY_MISMATCH");
 return {authorizedReduction:true as const};
}
