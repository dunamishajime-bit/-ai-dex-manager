import {createHash} from "node:crypto";
import {appendFile,mkdir,readFile,rename,lstat,writeFile,chown,chmod} from "node:fs/promises";
import {dirname} from "node:path";
import {AsterV3Client} from "../lib/aster-v3-client";
import {FileAccountOrderLock} from "../lib/disdex-account-order-lock";
import {readPendingExposureRegistry} from "../lib/disdex-pending-exposure-registry";
import {V4ExecutionStore,type V4ExecutionDocument} from "../lib/v12-v4-execution-store";
import {rebindV4ActiveLineage} from "../lib/v12-v4-active-lineage-rebind";

const ACK="I_ACK_V12_V4_ACTIVE_LINEAGE_REBIND_AFTER_SIGNED_RECONCILIATION";
const SHA=/^[a-f0-9]{40}$/;
const STATE_PATH="/var/lib/disdex/v12-v4/orders.json";
const AUDIT_PATH="/var/lib/disdex/v12-v4/active-lineage-rebind.jsonl";

function arg(name:string){const i=process.argv.indexOf(name);return i>=0?String(process.argv[i+1]||"").trim():"";}
function required(name:string){const value=String(process.env[name]||"").trim();if(!value)throw Error(`V4_ACTIVE_REBIND_MISSING_ENV:${name}`);return value;}
function num(value:unknown,label:string){const n=Number(value);if(!Number.isFinite(n))throw Error(`V4_ACTIVE_REBIND_INVALID_${label}`);return n;}
function sideMatches(position:any,side:"LONG"|"SHORT"){
 const amount=num(position.positionAmt,"POSITION");
 return side==="LONG"?amount>0:amount<0;
}
function quantityClose(a:number,b:number){return Math.abs(Math.abs(a)-Math.abs(b))<=Math.max(1e-8,Math.abs(b)*1e-6);}
function hash(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
async function regular(path:string){const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink())throw Error(`V4_ACTIVE_REBIND_UNSAFE_FILE:${path}`);}

function parseArgs(){
 if(!process.argv.includes("--apply"))throw Error("V4_ACTIVE_REBIND_REQUIRES_APPLY");
 if(arg("--ack")!==ACK)throw Error("V4_ACTIVE_REBIND_ACK_REQUIRED");
 const oldSha=arg("--old-sha").toLowerCase(),newSha=arg("--new-sha").toLowerCase();
 if(!SHA.test(oldSha)||!SHA.test(newSha)||oldSha===newSha)throw Error("V4_ACTIVE_REBIND_SHA_INVALID");
 return {oldSha,newSha};
}

async function main(){
 const {oldSha,newSha}=parseArgs();
 const pendingPath=required("DISDEX_PENDING_EXPOSURE_REGISTRY_PATH");
 const lockPath=required("DISDEX_ACCOUNT_LOCK_PATH");
 const ownerUid=num(required("V12_V4_STATE_OWNER_UID"),"OWNER_UID");
 const ownerGid=num(required("V12_V4_STATE_OWNER_GID"),"OWNER_GID");
 await regular(STATE_PATH);
 const raw=JSON.parse(await readFile(STATE_PATH,"utf8")) as V4ExecutionDocument;
 if(raw.schema!==2||raw.releaseSha!==oldSha)throw Error("V4_ACTIVE_REBIND_RELEASE_MISMATCH");
 const activeEntries=Object.values(raw.intents??{}).filter((i:any)=>i.action==="ENTRY"&&i.stage!=="TERMINAL");
 if(activeEntries.length)throw Error(`V4_ACTIVE_REBIND_UNRESOLVED_ENTRY:${activeEntries.length}`);
 const lock=new FileAccountOrderLock(lockPath,120000,pendingPath);
 const lease=await lock.acquire("V12_V4_ACTIVE_LINEAGE_REBIND");
 if(!lease)throw Error("V4_ACTIVE_REBIND_ACCOUNT_LOCK_BUSY");
 try{
  const pending=await readPendingExposureRegistry(pendingPath);
  const pendingV4=pending.entries.filter((e:any)=>e.strategyId==="V12_V4"&&e.status!=="RELEASED");
  if(pendingV4.length)throw Error(`V4_ACTIVE_REBIND_PENDING_EXPOSURE:${pendingV4.length}`);
  const client=new AsterV3Client({
   baseUrl:process.env.ASTER_FUTURES_BASE_URL,userAddress:process.env.ASTER_USER_ADDRESS,
   privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined,
   requestTimeoutMs:15000,readOnlyRateLimitMaxRetries:0,userAgent:`DisDex-V4-Active-Rebind/${newSha.slice(0,12)}`,
  });
  if(!client.hasTradingCredentials())throw Error("V4_ACTIVE_REBIND_SIGNED_CREDENTIALS_REQUIRED");
  const [positions,openOrders]=await Promise.all([client.getPositions(),client.getOpenOrders()]);
  const candidate=rebindV4ActiveLineage(raw,oldSha,newSha);
  const activeLegs=Object.values(candidate.state.legs).filter((leg:any)=>leg.qty>0&&["OPEN","PENDING_EXIT"].includes(leg.status));
  const knownProtectionIds=new Set<string>();
  for(const leg of activeLegs){
   const symbol=String(leg.candidate.symbol).toUpperCase();
   const venuePositions=(positions as any[]).filter(row=>String(row.symbol).toUpperCase()===symbol&&Math.abs(num(row.positionAmt,"POSITION"))>1e-12);
   const owned=venuePositions.find(row=>sideMatches(row,leg.candidate.effectiveSide));
   if(!owned||!quantityClose(num(owned.positionAmt,"POSITION"),leg.qty))throw Error(`V4_ACTIVE_REBIND_POSITION_MISMATCH:${leg.id}`);
   const protection=candidate.protections[leg.id];
   if(!protection||protection.phase!=="STOP_CONFIRMED"||!(protection.protectedQty>=leg.qty)||!protection.stopClientOrderId)
    throw Error(`V4_ACTIVE_REBIND_PROTECTION_STATE_INVALID:${leg.id}`);
   knownProtectionIds.add(protection.stopClientOrderId);
   const stop=(openOrders as any[]).find(row=>String(row.clientOrderId||"")===protection.stopClientOrderId);
   if(!stop||stop.reduceOnly!==true||!quantityClose(num(stop.origQty,"STOP_QTY"),leg.qty))throw Error(`V4_ACTIVE_REBIND_PROTECTION_READBACK_MISMATCH:${leg.id}`);
  }
  const unknownOrders=(openOrders as any[]).filter(row=>!knownProtectionIds.has(String(row.clientOrderId||"")));
  if(unknownOrders.length)throw Error(`V4_ACTIVE_REBIND_UNKNOWN_OPEN_ORDERS:${unknownOrders.length}`);
  const unexpectedPositions=(positions as any[]).filter(row=>Math.abs(num(row.positionAmt,"POSITION"))>1e-12&&!activeLegs.some((leg:any)=>String(leg.candidate.symbol).toUpperCase()===String(row.symbol).toUpperCase()&&sideMatches(row,leg.candidate.effectiveSide)));
  if(unexpectedPositions.length)throw Error(`V4_ACTIVE_REBIND_UNEXPECTED_POSITIONS:${unexpectedPositions.length}`);
  const beforeHash=hash(raw),afterHash=hash(candidate),observedAt=Date.now();
  const temporary=`${STATE_PATH}.${newSha}.${process.pid}.tmp`;
  await writeFile(temporary,`${JSON.stringify(candidate)}\n`,{encoding:"utf8",mode:0o600});
  await chown(temporary,ownerUid,ownerGid);await chmod(temporary,0o600);
  new V4ExecutionStore(temporary,newSha).read();
  await mkdir(dirname(STATE_PATH)+"/migrations",{recursive:true,mode:0o700});
  const backupPath=`${dirname(STATE_PATH)}/migrations/orders.${oldSha}-to-${newSha}.${observedAt}.json`;
  await rename(STATE_PATH,backupPath);
  try{await rename(temporary,STATE_PATH);}catch(error){await rename(backupPath,STATE_PATH).catch(()=>undefined);throw error;}
  await regular(STATE_PATH);new V4ExecutionStore(STATE_PATH,newSha).read();
  await mkdir(dirname(AUDIT_PATH),{recursive:true,mode:0o700});
  try{await regular(AUDIT_PATH);}catch(error:any){if(error?.code!=="ENOENT")throw error;await writeFile(AUDIT_PATH,"",{encoding:"utf8",mode:0o600});}
  await appendFile(AUDIT_PATH,`${JSON.stringify({schema:"disdex-v12-v4-active-lineage-rebind/v1",status:"APPLIED",oldSha,newSha,observedAt,beforeHash,afterHash,backupPath,activeLegs:activeLegs.map((leg:any)=>({id:leg.id,symbol:leg.candidate.symbol,side:leg.candidate.effectiveSide,qty:leg.qty})),positionCount:positions.filter((row:any)=>Math.abs(num(row.positionAmt,"POSITION"))>1e-12).length,openOrderCount:openOrders.length,mutationCalls:0,ordersSent:0,cancelsSent:0,positionChangesSent:0})}\n`,{encoding:"utf8"});
  await chown(AUDIT_PATH,0,0);await chmod(AUDIT_PATH,0o600);
  console.log(JSON.stringify({status:"V4_ACTIVE_LINEAGE_REBIND_APPLY_PASS",oldSha,newSha,backupPath,statePath:STATE_PATH,activeLegs:activeLegs.map((leg:any)=>({symbol:leg.candidate.symbol,side:leg.candidate.effectiveSide,qty:leg.qty})),positions:positions.filter((row:any)=>Math.abs(num(row.positionAmt,"POSITION"))>1e-12).length,openOrders:openOrders.length,legacyReleaseShas:candidate.legacyReleaseShas,mutationCalls:0,ordersSent:0,cancelsSent:0,positionChangesSent:0}));
 }finally{await lease.release();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=2;});
