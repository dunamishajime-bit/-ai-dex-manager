/**
 * Root-managed V4 production certification gate, separate from research and
 * separate from operator approval. Missing/expired/unsigned evidence is HOLD.
 * Creating a local report can never grant real order authority.
 */
import {open,lstat} from "node:fs/promises";
import {constants} from "node:fs";
import {dirname} from "node:path";
import {PRODUCTION_EXIT_CATALOG} from "./v12-v4-production-lifecycle";
import type {V4LiveDecisionSnapshot} from "./v12-v4-live-candidate-builder";
import type {V4DurableOrderCommand} from "./v12-v4-durable-orders";
import type {V4ExecutionDocument} from "./v12-v4-execution-store";
import {V12_V4_V2_POLICY} from "./v12-v4-v2-shadow";
export const V4_PRODUCTION_CERT_PATH="/etc/disdex/v12-v4-production-certification.json";
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
export type V4ProductionCertificate={
 schema:"disdex-v12-v4-production-certification/v1";
 approvedSha:string;policyId:typeof V12_V4_V2_POLICY;
 approvedAt:string;validUntil:string;
 verifiedRoutes:string[];
 evidence:{
  sourceParitySha256:string;exitParitySha256:string;
  tradeExecutionSha256:string;portfolioRiskSha256:string;
  protectedSameSymbolSha256:string;independentForwardSha256:string;
 };
 approvedGross:{v12:number;crypto:number;total:number;recovery:number};
 forwardUnderperformanceAcknowledged:true;
 operatorAcknowledgement:"I_AUTHORIZE_CERTIFIED_V12_V4_REAL_ORDERS";
};
export function validateV4ProductionCertificate(raw:unknown,sha:string,now=Date.now()):V4ProductionCertificate{
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||!SHA.test(sha))
  throw Error("V4_ROOT_CERTIFICATE_REQUIRED");
 const c=raw as Record<string,any>;
 if(c.schema!=="disdex-v12-v4-production-certification/v1"||
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
 const caps=c.approvedGross;
 if(!caps||caps.v12!==3||caps.crypto!==3.5||caps.total!==4.75||caps.recovery!==2.5)
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
  return validateV4ProductionCertificate(JSON.parse(await f.readFile("utf8")),sha,now);
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
