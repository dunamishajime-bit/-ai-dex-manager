import "dotenv/config";

import { readFile } from "node:fs/promises";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";
import { releaseIdleResidualLongForFormalEntry } from "../lib/idle-residual-long-preemption";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";

function arg(name:string){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;}
function numberEnv(name:string,fallback:number){const n=Number(process.env[name]);return Number.isFinite(n)?n:fallback;}

async function sharedLockDocument(){
  const path=process.env.DISDEX_ACCOUNT_LOCK_PATH||"/var/lib/disdex/shared/account-order.lock";
  const value=JSON.parse(await readFile(path,"utf8")) as {schema?:string;expiresAt?:number;ownerId?:string;leaseId?:string};
  if(value.schema!=="disdex-account-lock/v1"||!value.ownerId||!value.leaseId||Number(value.expiresAt)<=Date.now()){
    throw new Error("IDLE_RESIDUAL_CORE_PREEMPT_SHARED_LOCK_UNCONFIRMED");
  }
  return value;
}

async function main(){
  const caller=String(arg("--caller")||"").trim().toUpperCase();
  if(caller!=="V52_CORE")throw new Error("IDLE_RESIDUAL_CORE_PREEMPT_CALLER_NOT_ALLOWED");
  if(arg("--shared-lock-held")!=="true")throw new Error("IDLE_RESIDUAL_CORE_PREEMPT_SHARED_LOCK_ASSERTION_REQUIRED");
  const cause=String(arg("--cause")||"").trim();
  if(!cause)throw new Error("IDLE_RESIDUAL_CORE_PREEMPT_CAUSE_REQUIRED");
  const runtimeSha=String(process.env.DISDEX_RUNTIME_COMMIT_SHA||process.env.DISDEX_RELEASE_SHA||"").trim().toLowerCase();
  if(!/^[0-9a-f]{40}$/.test(runtimeSha))throw new Error("IDLE_RESIDUAL_CORE_PREEMPT_RUNTIME_SHA_REQUIRED");

  const client=new AsterV3Client({
    baseUrl:process.env.ASTER_FUTURES_BASE_URL,
    userAddress:process.env.ASTER_USER_ADDRESS,
    privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined,
    requestTimeoutMs:numberEnv("ASTER_REQUEST_TIMEOUT_MS",10_000),
    recvWindowMs:numberEnv("ASTER_RECV_WINDOW_MS",5_000),
    userAgent:`DisDex-IdleResidual-Core-Preempt/${runtimeSha.slice(0,12)}`,
  });
  if(!client.hasTradingCredentials())throw new Error("IDLE_RESIDUAL_CORE_PREEMPT_ASTER_CREDENTIALS_REQUIRED");
  const executor=new AsterDirectTradeExecutor(client,{
    exchangeInfoTtlMs:numberEnv("ASTER_EXCHANGE_INFO_TTL_MS",15*60_000),
    reconciliationAttempts:numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS",6),
    reconciliationDelayMs:numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS",1_500),
  });
  const adapter=new V12AsterLiveAdapter(client,{
    maxSlippageBps:numberEnv("V12_X1_ALL_MAX_SLIPPAGE_BPS",20),
    reconciliationAttempts:numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS",6),
    reconciliationDelayMs:numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS",1_500),
    readRequestSpacingMs:numberEnv("V12_X1_ALL_REQUEST_SPACING_MS",100),
  });
  const positions=await executor.getPositions();
  const result=await releaseIdleResidualLongForFormalEntry({
    executor,adapter,lock:{document:sharedLockDocument},positions,
    causeIdempotencyKey:cause,expectedRuntimeSha:runtimeSha,
    statePath:process.env.DISDEX_IDLE_RESIDUAL_LONG_STATE_PATH,
    enabled:/^(1|true|yes|on)$/i.test(String(process.env.DISDEX_IDLE_RESIDUAL_LONG_ENABLED||"")),
    maxSlippageBps:numberEnv("DISDEX_IDLE_RESIDUAL_LONG_MAX_SLIPPAGE_BPS",20),
  });
  console.log(JSON.stringify({caller,cause,...result,ordersSent:result.status==="reduced"?1:0}));
  if(result.status==="blocked")process.exitCode=2;
}

main().catch((error)=>{
  console.error(JSON.stringify({status:"blocked",message:error instanceof Error?error.message:String(error),ordersSent:0}));
  process.exitCode=2;
});
