/**
 * One-entry Production canary authority for V12 V4.
 * This is deliberately separate from the full 41-route Production certificate.
 * It can never authorize ordinary multi-entry LIVE operation.
 */
import {open,lstat} from "node:fs/promises";
import {constants} from "node:fs";
import {dirname} from "node:path";
import type {V4LiveDecisionSnapshot} from "./v12-v4-live-candidate-builder";
import type {V4DurableOrderCommand} from "./v12-v4-durable-orders";
import type {V4ExecutionDocument} from "./v12-v4-execution-store";
import {V12_V4_V2_POLICY} from "./v12-v4-v2-shadow";

export const V4_CANARY_PERMIT_PATH="/etc/disdex/v12-v4-production-canary-permit.json";
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
export type V4CanaryPermit={
 schema:"disdex-v12-v4-production-canary-permit/v1";
 approvedSha:string;policyId:typeof V12_V4_V2_POLICY;
 approvedAt:string;validUntil:string;
 maxEntries:1;sizing:"VENUE_MINIMUM_ONLY";
 absoluteNotionalCapUsd:number;
 operatorAcknowledgement:"I_AUTHORIZE_ONE_V12_V4_PRODUCTION_CANARY_AT_VENUE_MINIMUM";
};

export function validateV4CanaryPermit(raw:unknown,sha:string,now=Date.now()):V4CanaryPermit{
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||!SHA.test(sha))
  throw Error("V4_CANARY_ROOT_PERMIT_REQUIRED");
 const p=raw as Record<string,any>;
 if(p.schema!=="disdex-v12-v4-production-canary-permit/v1"||
   p.approvedSha!==sha||p.policyId!==V12_V4_V2_POLICY||
   p.maxEntries!==1||p.sizing!=="VENUE_MINIMUM_ONLY"||
   p.operatorAcknowledgement!=="I_AUTHORIZE_ONE_V12_V4_PRODUCTION_CANARY_AT_VENUE_MINIMUM")
  throw Error("V4_CANARY_ROOT_PERMIT_INVALID");
 if(!Number.isFinite(p.absoluteNotionalCapUsd)||p.absoluteNotionalCapUsd<=0||
   p.absoluteNotionalCapUsd>25)throw Error("V4_CANARY_NOTIONAL_CAP_INVALID");
 const from=Date.parse(String(p.approvedAt)),until=Date.parse(String(p.validUntil));
 if(!Number.isFinite(from)||!Number.isFinite(until)||from>now+300000||
   until<=now||until-from>24*3600000||until<=from)
  throw Error("V4_CANARY_PERMIT_EXPIRED_OR_FUTURE");
 return p as V4CanaryPermit;
}

export async function readV4CanaryPermit(sha:string,path=V4_CANARY_PERMIT_PATH,now=Date.now()){
 if(path!==V4_CANARY_PERMIT_PATH)throw Error("V4_CANARY_PERMIT_PATH_OVERRIDE_DENIED");
 const parent=await lstat(dirname(path));
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||(parent.mode&0o022)!==0)
  throw Error("V4_CANARY_PERMIT_PARENT_WRITABLE");
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=await f.stat();
  if(!st.isFile()||st.uid!==0||(st.mode&0o022)!==0||
    (st.gid!==0&&st.gid!==process.getgid?.()))
   throw Error("V4_CANARY_PERMIT_NOT_ROOT_SECURE");
  return validateV4CanaryPermit(JSON.parse(await f.readFile("utf8")),sha,now);
 }finally{await f.close();}
}

export function assertV4CanarySourceSnapshot(
 decision:V4LiveDecisionSnapshot,permit:V4CanaryPermit,sha:string,now=Date.now()){
 validateV4CanaryPermit(permit,sha,now);
 if(decision.policyId!==V12_V4_V2_POLICY||decision.schema!=="v12-v4-live-decision/v1"||
   decision.orderEnabled!==false||decision.realOrderEnabledV4!==0||
   decision.tradingMutation!==0||decision.errors.length||
   !DIGEST.test(decision.sourceFingerprint)||decision.decisionTs<Date.parse("2026-08-11T00:00:00Z")||
   decision.capturedAtMs<decision.decisionTs||decision.capturedAtMs-decision.decisionTs>135*60000)
  throw Error("V4_CANARY_CAUSAL_SOURCE_NOT_VERIFIED");
}

function validCommand(command:V4DurableOrderCommand){
 return !!command.legId&&!!command.symbol&&command.quantity>0&&command.price>0&&
  ["ENTRY","STOP","TAKE_PROFIT","EXIT"].includes(command.action);
}

export function assertV4CanaryOrderAuthority(input:{
 sha:string;command:V4DurableOrderCommand;permit:V4CanaryPermit;
 ownedDocument?:V4ExecutionDocument;now?:number;
}){
 const {sha,command,permit,ownedDocument}=input;
 if(!validCommand(command))throw Error("V4_CANARY_ORDER_COMMAND_INVALID");
 if(command.action==="ENTRY"){
  validateV4CanaryPermit(permit,sha,input.now??Date.now());
  if(command.quantity*command.price>permit.absoluteNotionalCapUsd+1e-8)
   throw Error("V4_CANARY_NOTIONAL_CAP_EXCEEDED");
  return {authorizedCanaryEntry:true as const};
 }
 // Never strand a signed position when the canary permit expires.
 if(!ownedDocument||ownedDocument.releaseSha!==sha)
  throw Error("V4_CANARY_REDUCTION_WITHOUT_SIGNED_OWNERSHIP");
 const leg=ownedDocument.state.legs[command.legId];
 if(!leg||leg.qty<=0||leg.status==="CLOSED"||leg.status==="CANCELLED"||
   leg.candidate.symbol!==command.symbol||leg.candidate.effectiveSide!==command.positionSide||
   !Number.isFinite(command.quantity)||command.quantity>leg.qty+1e-10)
  throw Error("V4_CANARY_OWNER_OR_QUANTITY_MISMATCH");
 return {authorizedCanaryReduction:true as const};
}
