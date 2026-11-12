import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, readFileSync } from "node:fs";
import {
  AsterV3Client,
} from "/home/deploy/disdex-trading/releases/3ad65403013b701db5d9e53e8814e6ab827a28e8/lib/aster-v3-client.ts";
import {
  FileAccountOrderLock,
} from "/home/deploy/disdex-trading/releases/3ad65403013b701db5d9e53e8814e6ab827a28e8/lib/disdex-account-order-lock.ts";
import {
  readPendingExposureRegistry,
} from "/home/deploy/disdex-trading/releases/3ad65403013b701db5d9e53e8814e6ab827a28e8/lib/disdex-pending-exposure-registry.ts";
import {
  classifyAsterRateBudgetFailure,
  nextAsterRateBudgetRetryMs,
} from "/home/deploy/disdex-trading/releases/3ad65403013b701db5d9e53e8814e6ab827a28e8/lib/disdex-aster-rate-budget-policy.ts";
import {
  V4ExecutionStore,
  type V4ExecutionDocument,
} from "/home/deploy/disdex-trading/releases/3ad65403013b701db5d9e53e8814e6ab827a28e8/lib/v12-v4-execution-store.ts";
import {
  reconcileV4ExternalFlatClose,
} from "/home/deploy/disdex-trading/releases/3ad65403013b701db5d9e53e8814e6ab827a28e8/lib/v12-v4-venue-exit.ts";

const SHA = "3ad65403013b701db5d9e53e8814e6ab827a28e8";
const ROOT = "/var/lib/disdex";
const STORE = ROOT + "/v12-v4/orders.json";
const PENDING = ROOT + "/shared/pending-exposure.json";
const LOCK = ROOT + "/shared/account-order.lock";
const HEARTBEAT = ROOT + "/v12-v4/heartbeat.json";
const BACKUP = ROOT + "/v12-v4/orders.json.pre-xrp-manual-reconcile-1794452510700.bak";

const LEG = "XRPUSDT:REC_X06_TIME_12H:SHORT:1794067200000";
const STOP_CLIENT_ID = "v12-v4-231ed20b6835c4148b5314d8da7e";
const STOP_ORDER_ID = "4143471979";
const STOP_PRICE = 1.2507;
const STOP_TERMINAL_TS = 1794452508281;

const ENTRY_TRADE_ID = "21785120";
const ENTRY_ORDER_ID = "4143469655";
const ENTRY_TRADE_TS = 1794067400950;
const ENTRY_PRICE = 1.1581;
const ENTRY_QTY = 13.3;
const ENTRY_FEE = 0.00616109;

const CLOSE_TRADE_ID = "21843239";
const CLOSE_ORDER_ID = "4154566371";
const CLOSE_TRADE_TS = 1794452510700;
const CLOSE_PRICE = 1.0508;
const CLOSE_QTY = 13.3;
const CLOSE_REALIZED = 1.42709;
const CLOSE_FEE = 0.00559025;

const EXPECTED_FUNDING = 0.01518936;
const EXPECTED_ROUTE = "REC_X06_TIME_12H";
const EXPECTED_POLICY = "BT_REPAIR_FIXED_18H_NEXT_OPEN";

const readOnlyEndpoints = new Set(["time","positionRisk","openOrders","order","userTrades","income"]);
const PREVIEW = process.argv.includes("--preview");

function fail(reason:string):never { throw new Error("V4_XRP_MANUAL_RECONCILE_" + reason); }
function near(a:unknown,b:number){
  return Number.isFinite(Number(a)) && Math.abs(Number(a)-b) <= Math.max(1e-8,Math.abs(b)*1e-7);
}
function sha256(path:string){ return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function assertRegular(path:string){
  const st=lstatSync(path);
  if(!st.isFile()||st.isSymbolicLink()) fail("UNSAFE_FILE:"+path);
}
function assertBlockedRunner(now=Date.now()){
  assertRegular(HEARTBEAT);
  const row=JSON.parse(readFileSync(HEARTBEAT,"utf8"));
  if(row?.schema!=="disdex-v12-v4-runner-heartbeat/v1"||
    row?.releaseSha!==SHA||row?.runtimeSha!==SHA||row?.expectedSha!==SHA||
    row?.processAlive!==true||row?.liveEnabled!==true||
    row?.safetyState!=="BLOCKED"||row?.status!=="blocked"||
    row?.orderEnabled!==false||row?.ordersAllowed!==false||row?.orderPermission!=="BLOCKED"||
    !Number.isSafeInteger(row?.mainPid)||row.mainPid<=0||
    !Number.isSafeInteger(row?.heartbeatAt)||row.heartbeatAt>now||now-row.heartbeatAt>180000||
    !String(row?.reason??"").startsWith("V4_PEER_ATTESTATION_RETRY_REQUIRED:"))
    fail("RUNNER_NOT_FAIL_CLOSED_BLOCKED");
  return {mainPid:row.mainPid,heartbeatAt:row.heartbeatAt,reason:row.reason};
}
function readOnlyFetch(input:RequestInfo|URL,init?:RequestInit){
  const request=input instanceof Request?input:undefined;
  const url=new URL(request?.url??String(input));
  const method=init?.method??request?.method??"GET";
  if(method!=="GET"||init?.body||request?.body||url.origin!=="https://fapi.asterdex.com"||
    url.username||url.password||url.hash||!url.pathname.startsWith("/fapi/v3/")||
    !readOnlyEndpoints.has(url.pathname.slice(9))) fail("READ_ONLY_BOUNDARY");
  return fetch(input,{...init,redirect:"error"});
}
async function rateBudgetRead<T>(
  label:string,
  read:()=>Promise<T>,
  renew:()=>Promise<void>,
):Promise<T>{
  let last:unknown;
  for(let attempt=0;attempt<6;attempt++){
    await renew();
    try{return await read();}
    catch(error){
      last=error;
      const deferred=classifyAsterRateBudgetFailure(error);
      if(!deferred||attempt===5)throw error;
      const waitMs=nextAsterRateBudgetRetryMs(
        attempt,250,6000,deferred.waitMs??0,()=>0.5,
      );
      if(!Number.isFinite(waitMs)||waitMs<0||waitMs>6000)fail("RATE_BUDGET_RETRY_INVALID:"+label);
      await new Promise(resolve=>setTimeout(resolve,waitMs));
    }
  }
  throw last;
}
function exactTrade(row:any,expected:{
  id:string;orderId:string;side:"BUY"|"SELL";qty:number;price:number;
  commission:number;realizedPnl:number;time:number;
}){
  return String(row?.id)===expected.id && String(row?.orderId)===expected.orderId &&
    String(row?.symbol).toUpperCase()==="XRPUSDT" &&
    String(row?.side).toUpperCase()===expected.side &&
    near(row?.qty,expected.qty)&&near(row?.price,expected.price)&&
    String(row?.commissionAsset).toUpperCase()==="USDT" &&
    near(row?.commission,expected.commission)&&near(row?.realizedPnl,expected.realizedPnl)&&
    Number(row?.time)===expected.time;
}
function assertOpenState(doc:V4ExecutionDocument){
  if(doc.releaseSha!==SHA) fail("SHA_MISMATCH");
  if(doc.state.initial.holdProtected||doc.state.executionReview!=null||doc.state.foreign.length) fail("STATE_REVIEW_OR_FOREIGN");
  const leg:any=doc.state.legs[LEG];
  if(!leg||leg.status!=="OPEN"||!near(leg.qty,ENTRY_QTY)||leg.exitRemainingQty!==0||
    leg.candidate?.symbol!=="XRPUSDT"||leg.candidate?.route!==EXPECTED_ROUTE||
    leg.candidate?.effectiveSide!=="SHORT"||leg.candidate?.plannedExitPolicy!==EXPECTED_POLICY) fail("LEG_MISMATCH");
  const p:any=doc.protections[LEG];
  if(!p||p.phase!=="STOP_CONFIRMED"||!near(p.protectedQty,ENTRY_QTY)||
    p.stopClientOrderId!==STOP_CLIENT_ID) fail("PROTECTION_MISMATCH");
  const stop:any=doc.intents[STOP_CLIENT_ID];
  if(!stop||stop.action!=="STOP"||stop.stage!=="TERMINAL"||stop.legId!==LEG||
    String(stop.venueOrderId)!==STOP_ORDER_ID||stop.updatedAt!==STOP_TERMINAL_TS) fail("STOP_INTENT_MISMATCH");
  if(Object.values(doc.intents).some((i:any)=>i.stage!=="TERMINAL")) fail("NONTERMINAL_INTENT_REMAINS");
  if(doc.state.journal.some((e:any)=>
    (e.type==="EXIT_REQUEST"||e.type==="EXIT_FILL")&&e.id===LEG)) fail("UNEXPECTED_EXIT_EVENT");
}
function assertClosedState(doc:V4ExecutionDocument){
  const leg:any=doc.state.legs[LEG];
  const stop:any=doc.intents[STOP_CLIENT_ID];
  const p:any=doc.protections[LEG];
  if(!leg||leg.status!=="CLOSED"||!near(leg.qty,0)||!near(leg.realizedUsd,CLOSE_REALIZED)||
    !near(leg.feesUsd,ENTRY_FEE+CLOSE_FEE)||!near(leg.fundingUsd,EXPECTED_FUNDING)||
    stop?.stage!=="TERMINAL"||p?.phase!=="CLOSED"||!near(p?.protectedQty,0)) fail("CLOSED_STATE_MISMATCH");
  const fill=(leg as any);
  return fill;
}
async function signedProof(client:AsterV3Client,renew:()=>Promise<void>){
  const positions=await rateBudgetRead("positions",()=>client.getPositions(),renew);
  const openOrders=await rateBudgetRead("openOrders",()=>client.getOpenOrders(),renew);
  const trades=await rateBudgetRead("userTrades",()=>client.getUserTrades(
    "XRPUSDT",{startTime:ENTRY_TRADE_TS-1,endTime:Date.now(),limit:1000},
  ),renew);
  const stop=await rateBudgetRead("stopOrder",()=>client.getOrder("XRPUSDT",STOP_CLIENT_ID),renew);
  const funding=await rateBudgetRead("funding",()=>client.getIncomeHistory({
    symbol:"XRPUSDT",incomeType:"FUNDING_FEE",
    startTime:ENTRY_TRADE_TS,endTime:Date.now(),limit:1000,
  }),renew);
  if(trades.length===1000||funding.length===1000) fail("HISTORY_MAY_BE_TRUNCATED");
  if(positions.some((x:any)=>Math.abs(Number(x.positionAmt))>1e-10)) fail("VENUE_NOT_FLAT");
  if(openOrders.length!==0) fail("OPEN_ORDER_REMAINS");
  const relevant=trades.filter((x:any)=>Number(x.time)>=ENTRY_TRADE_TS).sort((a:any,b:any)=>Number(a.time)-Number(b.time));
  if(relevant.length!==2) fail("TRADE_SEQUENCE_CHANGED");
  if(!exactTrade(relevant[0],{id:ENTRY_TRADE_ID,orderId:ENTRY_ORDER_ID,side:"SELL",qty:ENTRY_QTY,
    price:ENTRY_PRICE,commission:ENTRY_FEE,realizedPnl:0,time:ENTRY_TRADE_TS})) fail("ENTRY_TRADE_MISMATCH");
  if(!exactTrade(relevant[1],{id:CLOSE_TRADE_ID,orderId:CLOSE_ORDER_ID,side:"BUY",qty:CLOSE_QTY,
    price:CLOSE_PRICE,commission:CLOSE_FEE,realizedPnl:CLOSE_REALIZED,time:CLOSE_TRADE_TS})) fail("CLOSE_TRADE_MISMATCH");
  if(String((stop as any)?.orderId)!==STOP_ORDER_ID||String((stop as any)?.clientOrderId)!==STOP_CLIENT_ID||
    String((stop as any)?.status)!=="EXPIRED"||String((stop as any)?.type)!=="STOP_MARKET"||
    String((stop as any)?.side)!=="BUY"||(stop as any)?.reduceOnly!==true||
    !near((stop as any)?.origQty,ENTRY_QTY)||!near((stop as any)?.executedQty,0)||
    !near((stop as any)?.stopPrice,STOP_PRICE)) fail("STOP_FINAL_STATE_MISMATCH");
  const fundingTotal=funding.reduce((n:number,x:any)=>n+Number(x.income),0);
  if(!near(fundingTotal,EXPECTED_FUNDING)) fail("FUNDING_MISMATCH");
  return {positions,openOrders,trades:relevant,stop,funding,fundingTotal};
}
function ensureBackup(){
  assertRegular(STORE);
  if(!existsSync(BACKUP)){ copyFileSync(STORE,BACKUP); chmodSync(BACKUP,0o600); }
  else assertRegular(BACKUP);
  return {storeSha256Before:sha256(STORE),backupSha256:sha256(BACKUP)};
}
async function main(){
  if(process.getuid?.()===0) fail("DEPLOY_USER_REQUIRED");
  if(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH!==ROOT+"/shared/aster-rate-budget.json") fail("RATE_BUDGET_BINDING");
  const store=new V4ExecutionStore(STORE,SHA);
  const lock=new FileAccountOrderLock(LOCK,120000,PENDING);
  let lease;
  for(let attempt=0;attempt<8&&!lease;attempt++){
    lease=await lock.acquire("V12_V4_XRP_MANUAL_CLOSE_RECONCILE");
    if(!lease)await new Promise(resolve=>setTimeout(resolve,1500));
  }
  if(!lease) fail("ACCOUNT_LOCK_BUSY");
  try{
    const blockedBefore=assertBlockedRunner();
    let doc=store.read();
    if(doc.state.legs[LEG]?.status==="CLOSED"){
      assertClosedState(doc);
      console.log(JSON.stringify({status:"V4_XRP_MANUAL_RECONCILE_ALREADY_COMPLETE",revision:doc.revision,
        ordersSent:0,cancelsSent:0,positionChangesSent:0}));
      return;
    }
    assertOpenState(doc);
    const before=readFileSync(STORE);
    const beforeHash=createHash("sha256").update(before).digest("hex");
    const pending=await readPendingExposureRegistry(PENDING);
    const now=Date.now();
    const activePending=pending.entries.filter((x:any)=>x.status!=="RELEASED").length;
    if(activePending!==0||pending.updatedAt>now||now-pending.updatedAt>300000) fail("PENDING_NOT_FRESH_FLAT");

    const client=new AsterV3Client({
      baseUrl:process.env.ASTER_FUTURES_BASE_URL,
      userAddress:process.env.ASTER_USER_ADDRESS,
      privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined,
      requestTimeoutMs:10000,recvWindowMs:5000,readOnlyRateLimitMaxRetries:0,
      fetchImpl:readOnlyFetch,userAgent:"DisDex-XRP-Manual-Reconcile/1.0",
    });
    if(!client.hasTradingCredentials()) fail("ASTER_CREDENTIALS_MISSING");
    const renewLease=async()=>{await lease!.renew();};
    const proof=await signedProof(client,renewLease);
    await renewLease();
    const blockedAtCommit=assertBlockedRunner();
    if(blockedAtCommit.mainPid!==blockedBefore.mainPid) fail("RUNNER_PID_CHANGED_DURING_PROOF");
    if(createHash("sha256").update(readFileSync(STORE)).digest("hex")!==beforeHash) fail("STATE_CHANGED_DURING_PROOF");

    const durableTerminalStop=doc.intents[STOP_CLIENT_ID];
    if(!durableTerminalStop) fail("STOP_INTENT_MISSING");
    const compatibilityDoc:V4ExecutionDocument={
      ...doc,
      intents:{
        ...doc.intents,
        [STOP_CLIENT_ID]:{...durableTerminalStop,stage:"ACKNOWLEDGED"},
      },
    };
    let next=reconcileV4ExternalFlatClose(compatibilityDoc,{
      positions:proof.positions as any[],
      openOrders:proof.openOrders as any[],
      pendingCount:0,
      stop:proof.stop as any,
      trades:proof.trades as any[],
      funding:proof.funding as any[],
      observedAt:Date.now(),
    });
    next={
      ...next,
      intents:{...next.intents,[STOP_CLIENT_ID]:durableTerminalStop},
    };
    assertClosedState(next);
    if(PREVIEW){
      console.log(JSON.stringify({
        status:"V4_XRP_MANUAL_RECONCILE_PREVIEW_PASS",
        sourceRevision:doc.revision,legId:LEG,predictedStatus:next.state.legs[LEG].status,
        predictedQty:next.state.legs[LEG].qty,predictedRealizedUsd:next.state.legs[LEG].realizedUsd,
        predictedFeesUsd:next.state.legs[LEG].feesUsd,predictedFundingUsd:next.state.legs[LEG].fundingUsd,
        predictedProtectionPhase:next.protections[LEG].phase,preservedStopIntentStage:next.intents[STOP_CLIENT_ID].stage,
        venueNetQty:0,xrpOpenOrders:0,storeSha256Before:beforeHash,
        runnerMainPid:blockedBefore.mainPid,runnerSafetyState:"BLOCKED",runnerOrderEnabled:false,
        registryWrites:0,ordersSent:0,cancelsSent:0,positionChangesSent:0,
      }));
      return;
    }
    const backup=ensureBackup();
    if(backup.storeSha256Before!==beforeHash) fail("BACKUP_BASELINE_CHANGED");
    doc=store.commit(doc.revision,next);
    assertClosedState(doc);

    const positionsAfter=await rateBudgetRead("postPositions",()=>client.getPositions(),renewLease);
    const openOrdersAfter=await rateBudgetRead("postOpenOrders",()=>client.getOpenOrders(),renewLease);
    if(positionsAfter.some((x:any)=>Math.abs(Number(x.positionAmt))>1e-10)||openOrdersAfter.length)
      fail("POST_COMMIT_VENUE_CHANGED");
    console.log(JSON.stringify({
      status:"V4_XRP_MANUAL_RECONCILE_PASS",
      revision:doc.revision,legId:LEG,durableStatus:doc.state.legs[LEG].status,durableQty:doc.state.legs[LEG].qty,
      closeTradeId:CLOSE_TRADE_ID,closeOrderId:CLOSE_ORDER_ID,fillPrice:CLOSE_PRICE,fillQty:CLOSE_QTY,
      realizedUsd:doc.state.legs[LEG].realizedUsd,feesUsd:doc.state.legs[LEG].feesUsd,
      fundingUsd:doc.state.legs[LEG].fundingUsd,protectionPhase:doc.protections[LEG].phase,
      stopIntentStage:doc.intents[STOP_CLIENT_ID].stage,venueNetQty:0,xrpOpenOrders:0,
      storeSha256Before:beforeHash,backupSha256:backup.backupSha256,storeSha256After:sha256(STORE),
      runnerMainPid:blockedBefore.mainPid,runnerSafetyState:"BLOCKED",runnerOrderEnabled:false,
      ordersSent:0,cancelsSent:0,positionChangesSent:0,
    }));
  }finally{ await lease.release(); }
}
main().catch(error=>{
  console.error(JSON.stringify({status:"V4_XRP_MANUAL_RECONCILE_FAILED_CLOSED",
    error:error instanceof Error?error.message:String(error),ordersSent:0,cancelsSent:0,positionChangesSent:0}));
  process.exitCode=2;
});
