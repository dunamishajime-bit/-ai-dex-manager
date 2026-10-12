import {appendFile,chmod,lstat,mkdir,readFile,writeFile} from "node:fs/promises";
import {AsterApiError,AsterV3Client} from "../lib/aster-v3-client";
import {FileAccountOrderLock} from "../lib/disdex-account-order-lock";
import {readPendingExposureRegistry,releasePendingExposure} from "../lib/disdex-pending-exposure-registry";
import {V4ExecutionStore} from "../lib/v12-v4-execution-store";
import {resolveUnknownEntryNoVenueExecution} from "../lib/v12-v4-unknown-entry-recovery";

const ACK="I_ACK_V12_V4_UNKNOWN_ENTRY_RECOVERY_NO_VENUE_EXECUTION";
function arg(name:string){const i=process.argv.indexOf(name);return i>=0?String(process.argv[i+1]||"").trim():"";}
function required(name:string){const value=String(process.env[name]||"").trim();if(!value)throw Error(`V4_UNKNOWN_ENTRY_RECOVERY_MISSING_ENV:${name}`);return value;}
async function regular(path:string){const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink())throw Error(`V4_UNKNOWN_ENTRY_RECOVERY_UNSAFE_FILE:${path}`);return st;}

async function main(){
 if(!process.argv.includes("--apply"))throw Error("V4_UNKNOWN_ENTRY_RECOVERY_REQUIRES_APPLY");
 if(arg("--ack")!==ACK)throw Error("V4_UNKNOWN_ENTRY_RECOVERY_ACK_REQUIRED");
 const sha=arg("--sha").toLowerCase(),cid=arg("--client-order-id");
 if(!/^[a-f0-9]{40}$/.test(sha)||!cid)throw Error("V4_UNKNOWN_ENTRY_RECOVERY_ARGUMENT_INVALID");
 const storePath=required("V12_V4_EXECUTION_STORE_PATH"),pendingPath=required("DISDEX_PENDING_EXPOSURE_REGISTRY_PATH");
 const store=new V4ExecutionStore(storePath,sha),lock=new FileAccountOrderLock(required("DISDEX_ACCOUNT_LOCK_PATH"),120000,pendingPath);
 const lease=await lock.acquire("V12_V4_UNKNOWN_ENTRY_RECOVERY");
 if(!lease)throw Error("V4_UNKNOWN_ENTRY_RECOVERY_ACCOUNT_LOCK_BUSY");
 try{
  const before=store.read(),intent=before.intents[cid],leg=intent&&before.state.legs[intent.legId];
  if(!intent||!leg)throw Error("V4_UNKNOWN_ENTRY_RECOVERY_INTENT_MISSING");
  const observedAt=Date.now(),windowStart=Math.max(0,intent.createdAt-60_000);
  const client=new AsterV3Client({baseUrl:process.env.ASTER_FUTURES_BASE_URL,userAddress:process.env.ASTER_USER_ADDRESS,privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined,requestTimeoutMs:15000,readOnlyRateLimitMaxRetries:0,userAgent:`DisDex-V4-Unknown-Recovery/${sha.slice(0,12)}`});
  let order:{status:"NOT_FOUND";code:-2013};
  try{await client.getOrder(leg.candidate.symbol,cid);throw Error("V4_UNKNOWN_ENTRY_RECOVERY_ORDER_PRESENT");}
  catch(error){
   if(!(error instanceof AsterApiError&&error.code===-2013))throw error;
   order={status:"NOT_FOUND",code:-2013};
  }
  const [positions,openOrders,userTrades,income]=await Promise.all([
   client.getPositions(leg.candidate.symbol),
   client.getOpenOrders(leg.candidate.symbol),
   client.getUserTrades(leg.candidate.symbol,{startTime:windowStart,endTime:observedAt,limit:1000}),
   client.getIncomeHistory({symbol:leg.candidate.symbol,startTime:windowStart,endTime:observedAt,limit:1000}),
  ]);
  const evidence={observedAt,order,positions:positions.map(row=>({symbol:String(row.symbol),positionAmt:String(row.positionAmt)})),openOrders,userTrades,income};
  const auditPath="/var/lib/disdex/v12-v4/unknown-entry-recovery.jsonl";
  await mkdir("/var/lib/disdex/v12-v4",{recursive:true,mode:0o700});
  try{await regular(auditPath);}catch(error:any){if(error?.code!=="ENOENT")throw error;await writeFile(auditPath,"",{encoding:"utf8",mode:0o600});}
  await appendFile(auditPath,JSON.stringify({schema:"disdex-v12-v4-unknown-entry-recovery/v1",status:"EVIDENCE_CAPTURED",sha,clientOrderId:cid,symbol:leg.candidate.symbol,evidence})+"\n");
  const resolved=resolveUnknownEntryNoVenueExecution(before,cid,evidence);
  store.commit(before.revision,resolved.document);
  const pending=await readPendingExposureRegistry(pendingPath),row=pending.entries.find(x=>x.reservationId===cid);
  if(!row||row.strategyId!=="V12_V4"||row.symbol!==leg.candidate.symbol||row.runtimeSha!==sha)throw Error("V4_UNKNOWN_ENTRY_RECOVERY_PENDING_IDENTITY_INVALID");
  await releasePendingExposure(cid,pendingPath);
  const after=store.read(),released=(await readPendingExposureRegistry(pendingPath)).entries.find(x=>x.reservationId===cid);
  if(after.intents[cid]?.stage!=="TERMINAL"||after.state.legs[leg.id]?.status!=="CANCELLED"||after.protections[leg.id]?.phase!=="CLOSED"||released?.status!=="RELEASED")throw Error("V4_UNKNOWN_ENTRY_RECOVERY_READBACK_FAILED");
  await appendFile(auditPath,JSON.stringify({schema:"disdex-v12-v4-unknown-entry-recovery/v1",status:"APPLIED",sha,clientOrderId:cid,symbol:leg.candidate.symbol,terminalEvent:resolved.terminalEvent,mutationCalls:0})+"\n");
  await chmod(auditPath,0o600);
  console.log(JSON.stringify({status:"V4_UNKNOWN_ENTRY_RECOVERY_APPLY_PASS",sha,clientOrderId:cid,symbol:leg.candidate.symbol,orderMutationCalls:0,stage:after.intents[cid].stage,legStatus:after.state.legs[leg.id].status,protection:after.protections[leg.id].phase,pendingStatus:released?.status}));
 }finally{await lease.release();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=2;});
