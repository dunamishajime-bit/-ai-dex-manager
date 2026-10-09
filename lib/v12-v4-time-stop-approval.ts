/**
 * Operator-approved V12 V4 TIME emergency STOP contract. No write capability.
 * The historical 8% result is research; do not create this artifact without
 * explicit signed operator authorization for the final SHA.
 */
import {open,constants} from "node:fs/promises";
import {resolve} from "node:path";
import {productionExitSpec} from "./v12-v4-production-lifecycle";
import {V12_V4_TIME_EMERGENCY_RESEARCH_ID} from "./v12-v4-time-emergency-stop-research";
export const V4_TIME_STOP_APPROVAL_PATH="/var/lib/disdex/shared/v12-v4-time-stop-approval.json";
const SHA=/^[0-9a-f]{40}$/;
export type V4TimeApproval={
 schema:"disdex-v12-v4-time-stop-approval/v1";
 approvedSha:string;approvedAt:string;routeCount:37;
 policyId:typeof V12_V4_TIME_EMERGENCY_RESEARCH_ID;
 operatorAcknowledgement:"I_APPROVE_V12_V4_TIME37_FIXED8_EMERGENCY_STOP";
};
export function validateV4TimeApproval(raw:unknown,sha:string,now=Date.now()):V4TimeApproval{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("V4_TIME_STOP_OPERATOR_APPROVAL_REQUIRED");
 const x=raw as Record<string,unknown>;
 if(!SHA.test(sha)||x.schema!=="disdex-v12-v4-time-stop-approval/v1"||
  x.approvedSha!==sha||x.policyId!==V12_V4_TIME_EMERGENCY_RESEARCH_ID||
  x.routeCount!==37||
  x.operatorAcknowledgement!=="I_APPROVE_V12_V4_TIME37_FIXED8_EMERGENCY_STOP")
  throw Error("V4_TIME_STOP_OPERATOR_APPROVAL_REQUIRED");
 const ts=Date.parse(String(x.approvedAt??""));
 if(!Number.isFinite(ts)||ts<=0||ts>now+300000)
  throw Error("V4_TIME_STOP_APPROVAL_TIMESTAMP_INVALID");
 return x as V4TimeApproval;
}
export async function readV4TimeStopApproval(sha:string,path=V4_TIME_STOP_APPROVAL_PATH){
 if(resolve(path)!==V4_TIME_STOP_APPROVAL_PATH)
  throw Error("V4_TIME_STOP_APPROVAL_PATH_INVALID");
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await handle.stat();
  if(!stat.isFile()||stat.uid!==0||stat.gid!==0||
   (stat.mode&0o077)!==0)
   throw Error("V4_TIME_STOP_APPROVAL_NOT_ROOT_SECURE");
  return validateV4TimeApproval(JSON.parse(await handle.readFile("utf8")),sha);
 }finally{await handle.close();}
}
export function approvedV4TimeStopQuote(input:{
 route:string;side:"LONG"|"SHORT";signedAverageEntryFill:number;
 approval:V4TimeApproval;
}):number{
 if(input.approval.policyId!==V12_V4_TIME_EMERGENCY_RESEARCH_ID||
  input.approval.routeCount!==37||productionExitSpec(input.route).kind!=="TIME"||
  !["LONG","SHORT"].includes(input.side)||
  !Number.isFinite(input.signedAverageEntryFill)||!(input.signedAverageEntryFill>0))
  throw Error("V4_TIME_STOP_CONTRACT_INVALID");
 const v=input.signedAverageEntryFill*(input.side==="LONG"?.92:1.08);
 if(!Number.isFinite(v)||!(v>0))throw Error("V4_TIME_STOP_QUOTE_INVALID");
 return v;
}
