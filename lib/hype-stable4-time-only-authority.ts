import {createHash} from "node:crypto";
import {lstat,readFile} from "node:fs/promises";
import type {AsterDirectTradeExecutor,DirectPosition,DirectOpenOrder} from "./direct-trade-executor";
import type {AccountLockHandle} from "./disdex-account-order-lock";
import {validateHypeH48TimeOnlyContract,validateHypeH48PolicyEvidence,type HypeH48TimeOnlyContract} from "./hype-stable4-time-only-contract";
const RESEARCH="9e1142f5ec6d4bc285deef023572623bb1c37a34";
const fail=():never=>{throw Error("HYPE_H48_ROOT_CERTIFICATE_INVALID");};
export function validateH48SignedInventory(positions:DirectPosition[],orders:DirectOpenOrder[],phase:"ENTRY"|"POSITION",quantity:number):void{
 if(!["ENTRY","POSITION"].includes(phase)||!Number.isFinite(quantity)||quantity<=0||!Array.isArray(positions)||!Array.isArray(orders)||positions.some(p=>!p||typeof p.symbol!=="string"||!Number.isFinite(p.quantity))||orders.some(o=>!o||typeof o.symbol!=="string"))fail();
 if(orders.some(o=>o.symbol==="HYPEUSDT"))fail();
 const owned=positions.filter(p=>p.symbol==="HYPEUSDT"&&p.quantity!==0);
 if(phase==="ENTRY"?owned.length!==0:owned.length!==1||owned[0].quantity!==quantity||!["BOTH","LONG"].includes(owned[0].positionSide))fail();
}
export function validateH48TimeOnlyCertificate(value:unknown,sourceSha:string,now:number){
 const keys=["schema","approvedSha","researchSha","planSha256","deploymentTarget","policy","route","symbol","side","holdHours","entryGridHours","residentStopRequired","residentTakeProfitRequired","approvedGross","issuedAt","expiresAt","operatorAcknowledgement","authorizesOtherPolicies"];
 if(!value||typeof value!=="object"||Array.isArray(value))fail();const v=value as Record<string,any>;
 if(Reflect.ownKeys(v).length!==keys.length||Reflect.ownKeys(v).some(k=>typeof k!=="string"||!keys.includes(k)||!("value" in Object.getOwnPropertyDescriptor(v,k)!)))fail();
 if(!/^[a-f0-9]{40}$/.test(sourceSha)||v.schema!=="disdex-stable4-h48-time-only-policy/v1"||v.approvedSha!==sourceSha||v.researchSha!==RESEARCH||typeof v.planSha256!=="string"||!/^[a-f0-9]{64}$/.test(v.planSha256)||v.deploymentTarget!=="professional-dismanager.net"||v.policy!=="H48_TIME_ONLY"||v.route!=="HYPE_REDESIGN_CAUSAL_H48R4_WSIG"||v.symbol!=="HYPEUSDT"||v.side!=="LONG"||v.holdHours!==48||v.entryGridHours!==6||v.residentStopRequired!==false||v.residentTakeProfitRequired!==false||v.operatorAcknowledgement!=="H48_TIME_ONLY"||v.authorizesOtherPolicies!==false||!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(v.issuedAt)||v.issuedAt<=0||v.issuedAt>now||!Number.isSafeInteger(v.expiresAt)||v.expiresAt<=now)fail();
 const g=v.approvedGross;if(!g||typeof g!=="object"||Array.isArray(g)||Object.keys(g).length!==4||g.crypto!==3||g.stock!==1.5||g.total!==3.5||g.hype!==1)fail();
 return Object.freeze(structuredClone(v));
}
async function readRootCertificate(sha:string){
 const path="/etc/disdex/stable4/h48-time-only/"+sha+".json",before=await lstat(path);
 if(!before.isFile()||before.isSymbolicLink()||before.uid!==0||before.gid!==0||(before.mode&0o222)!==0)fail();
 const bytes=await readFile(path),after=await lstat(path);
 if(before.ino!==after.ino||before.dev!==after.dev||before.mtimeMs!==after.mtimeMs||before.size!==after.size||after.uid!==0||after.gid!==0||(after.mode&0o222)!==0)fail();
 return{certificate:validateH48TimeOnlyCertificate(JSON.parse(bytes.toString("utf8")),sha,Date.now()),sha256:createHash("sha256").update(bytes).digest("hex"),verify:async()=>{const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.ino!==after.ino||s.dev!==after.dev||s.uid!==0||s.gid!==0||(s.mode&0o222)!==0||!(await readFile(path)).equals(bytes))fail();}};
}
/** Root-certified original H48 only. Reads signed native inventory under the
 * caller's real lease. It cannot alter a STOP, cancel an order, or submit one. */
export function createH48TimeOnlyPolicyAuthority(expectedSha:string,executor:Pick<AsterDirectTradeExecutor,"getPositions"|"getOpenOrders">){
 if(!/^[a-f0-9]{40}$/.test(expectedSha))fail();
 return{authorize:async(input:{phase:"ENTRY"|"POSITION";runtimeSha:string;contract:HypeH48TimeOnlyContract;quantity:number;lease:AccountLockHandle})=>{
  if(input.runtimeSha!==expectedSha||!["ENTRY","POSITION"].includes(input.phase)||!Number.isFinite(input.quantity)||input.quantity<=0)fail();
  const c=validateHypeH48TimeOnlyContract(input.contract,input.contract);if(c.sourceSha!==expectedSha)fail();
  const initial=await input.lease.document();if(initial.accountScope!=="ASTER_FUTURES"||initial.expiresAt<=Date.now())fail();
  const certificate=await readRootCertificate(expectedSha),positions=await executor.getPositions(),positionsAt=Date.now(),orders=await executor.getOpenOrders();
  if(input.phase==="ENTRY"&&certificate.certificate.expiresAt<c.logicalExitTs+86400000)fail();
  validateH48SignedInventory(positions,orders,input.phase,input.quantity);
  const current=await input.lease.document(),now=Date.now();await certificate.verify();
  if(current.leaseId!==initial.leaseId||current.ownerId!==initial.ownerId||current.accountScope!==initial.accountScope||current.acquiredAt!==initial.acquiredAt||current.expiresAt<=now||now-positionsAt>120000)fail();
  return validateHypeH48PolicyEvidence({policy:"H48_TIME_ONLY",runtimeSha:expectedSha,positionId:c.positionId,logicalEntryTs:c.logicalEntryTs,logicalExitTs:c.logicalExitTs,quantity:input.quantity,certificateSha256:certificate.sha256,validatedAt:now,expiresAt:Math.min(certificate.certificate.expiresAt,now+120000)},{contract:c,quantity:input.quantity,now});
 }};
}
