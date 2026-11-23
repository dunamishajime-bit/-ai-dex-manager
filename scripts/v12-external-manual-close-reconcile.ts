import "dotenv/config";
import {copyFile} from "node:fs/promises";
import {AsterV3Client} from "../lib/aster-v3-client";
import {reconcileV12ExternalManualClose} from "../lib/v12-external-manual-close-reconcile";
import {FileV12X1AllRunnerStateStore} from "../lib/v12-x1-all-runner-state";
import {resolveV12X1AllRuntime} from "../config/v12X1AllRuntime";
import {normalizeLiveStateOwnership} from "../lib/disdex-live-state-ownership";

const ACK="I_ACK_V12_EXTERNAL_MANUAL_CLOSE_RECONCILIATION";
function arg(name:string){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;}
function numberEnv(name:string,fallback:number){const n=Number(process.env[name]);return Number.isFinite(n)?n:fallback;}

async function main(){
 if(arg("--ack")!==ACK)throw Error("V12_EXTERNAL_CLOSE_OPERATOR_ACK_REQUIRED");
 const expectedStateSha=String(arg("--expected-state-sha")||"").trim().toLowerCase();
 if(!/^[a-f0-9]{40}$/.test(expectedStateSha))throw Error("V12_EXTERNAL_CLOSE_EXPECTED_SHA_REQUIRED");
 const runtime=resolveV12X1AllRuntime();
 if(runtime.mode!=="LIVE")throw Error("V12_EXTERNAL_CLOSE_LIVE_STATE_REQUIRED");
 const store=new FileV12X1AllRunnerStateStore(runtime.statePath,"LIVE");
 const before=await store.load();
 if(before.runtimeCommitSha!==expectedStateSha)throw Error("V12_EXTERNAL_CLOSE_STATE_SHA_MISMATCH");
 const backup=runtime.statePath+".external-manual-close."+Date.now()+".bak";
 await copyFile(runtime.statePath,backup);
 const normalizeStateOwnership=async()=>{
  if(typeof process.getuid==="function"&&process.getuid()===0){
   await normalizeLiveStateOwnership(runtime.statePath,{label:"V12_EXTERNAL_CLOSE_STATE"});
  }
 };
 await normalizeStateOwnership();
 const client=new AsterV3Client({
  baseUrl:process.env.ASTER_FUTURES_BASE_URL,
  userAddress:process.env.ASTER_USER_ADDRESS,
  privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined,
  requestTimeoutMs:numberEnv("ASTER_REQUEST_TIMEOUT_MS",10_000),
  recvWindowMs:numberEnv("ASTER_RECV_WINDOW_MS",5_000),
  readOnlyRateLimitMaxRetries:0,
  userAgent:"DisDex-V12-External-Manual-Close-Reconcile/1.0",
 });
 if(!client.hasTradingCredentials())throw Error("V12_EXTERNAL_CLOSE_ASTER_CREDENTIALS_MISSING");
 try{
  const result=await reconcileV12ExternalManualClose({
   stateStore:store,client,
   pendingRegistryPath:String(process.env.DISDEX_PENDING_EXPOSURE_REGISTRY_PATH||"/var/lib/disdex/shared/pending-exposure.json"),
   expectedStateSha,
  });
  await normalizeStateOwnership();
  console.log(JSON.stringify({...result,backup,stateOwnership:"deploy:deploy:600",ordersSent:0,cancelsSent:0,positionChangesSent:0}));
 }catch(error){
  try{await normalizeStateOwnership();}catch{}
  console.error(JSON.stringify({status:"V12_EXTERNAL_MANUAL_CLOSE_RECONCILE_BLOCKED",
   error:error instanceof Error?error.message:String(error),backup,
   ordersSent:0,cancelsSent:0,positionChangesSent:0}));
  throw error;
 }
}
main().catch(()=>{process.exitCode=2;});
