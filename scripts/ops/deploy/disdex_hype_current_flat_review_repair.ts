import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, chmod, copyFile, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { AsterV3Client } from "/home/deploy/disdex-trading/releases/d6bcc94512a6416189cd92d7203b9ac3b2c98e70/lib/aster-v3-client.ts";
import { FileAccountOrderLock } from "/home/deploy/disdex-trading/releases/d6bcc94512a6416189cd92d7203b9ac3b2c98e70/lib/disdex-account-order-lock.ts";
import { classifyAsterRateBudgetFailure, nextAsterRateBudgetRetryMs } from "/home/deploy/disdex-trading/releases/d6bcc94512a6416189cd92d7203b9ac3b2c98e70/lib/disdex-aster-rate-budget-policy.ts";

const HYPE_SHA="d6bcc94512a6416189cd92d7203b9ac3b2c98e70";
const V4_SHA="3ad65403013b701db5d9e53e8814e6ab827a28e8";
const STATE="/var/lib/disdex/hype-zec-long/runner.json";
const V4="/var/lib/disdex/v12-v4/orders.json";
const PENDING="/var/lib/disdex/shared/pending-exposure.json";
const LOCK="/var/lib/disdex/shared/account-order.lock";
const PIN="/etc/disdex/runner-pins.json";
const KILL="/var/lib/disdex/shared/kill-switch.json";
const RISK="/var/lib/disdex/shared/crypto-daily-risk.json";
const MARGIN="/var/lib/disdex/shared/margin-risk/guard-live.json";
const REVIEW="HYPE_ZEC_RUNNER_FAIL_CLOSED:UNKNOWN_JOURNAL_EVENT";
const XRP_LEG="XRPUSDT:REC_X06_TIME_12H:SHORT:1794067200000";
const HYPE_SYMBOLS=new Set(["HYPEUSDT","ZECUSDT"]);
const PREVIEW=process.argv.includes("--preview");

function fail(reason:string):never{throw new Error("HYPE_CURRENT_FLAT_REPAIR_"+reason);}
function digest(bytes:Buffer|string){return createHash("sha256").update(bytes).digest("hex");}
async function regular(path:string){
  const st=await lstat(path);
  if(!st.isFile()||st.isSymbolicLink())fail("UNSAFE_FILE:"+path);
  return st;
}
async function json(path:string){
  const st=await regular(path);
  const raw=await readFile(path);
  const value=JSON.parse(raw.toString("utf8"));
  if(!value||typeof value!=="object"||Array.isArray(value))fail("JSON_INVALID:"+path);
  return {st,raw,value};
}
async function assertProductionGuards(){
  const pins=(await json(PIN)).value;
  const row=pins?.runners?.HYPE_TREND_LONG;
  if(row?.sha!==HYPE_SHA||row?.serviceUnit!=="disdex-hype-long@"+HYPE_SHA+".service")fail("PIN_MISMATCH");
  const kill=(await json(KILL)).value; if(kill.active!==false)fail("KILL_SWITCH_ACTIVE");
  const risk=(await json(RISK)).value;
  if(risk.tripped!==false||risk.sourceComplete!==true||Number(risk.maximumLossPct)!==7.5)fail("SHARED_RISK_NOT_HEALTHY");
  const margin=(await json(MARGIN)).value;
  if(margin.stage!=="HEALTHY"||margin.ordersAllowed!==true)fail("MARGIN_NOT_HEALTHY");
}
function assertState(value:any){
  if(value.schema!=="disdex-hype-zec-long/v1"||value.runtimeCommitSha!==HYPE_SHA||value.mode!=="LIVE")
    fail("STATE_LINEAGE");
  if(value.manualReview!==REVIEW)fail("REVIEW_NOT_EXACT");
  if(value.pending!=null)fail("LOCAL_PENDING");
  if(value.positions!=null&&(!Array.isArray(value.positions)||value.positions.length!==0))fail("LOCAL_POSITION");
  if(!Array.isArray(value.failures))fail("FAILURES_INVALID");
  if(!Number.isSafeInteger(value.updatedAt)||value.updatedAt<=0||value.updatedAt>Date.now()+60_000)fail("UPDATED_AT_INVALID");
}
function assertV4(value:any){
  if(value.releaseSha!==V4_SHA)fail("V4_SHA");
  const s=value.state;
  if(!s||s.initial?.holdProtected===true||s.executionReview!=null||!Array.isArray(s.foreign)||s.foreign.length!==0)
    fail("V4_REVIEW_OR_FOREIGN");
  const x=s.legs?.[XRP_LEG];
  if(!x||x.status!=="CLOSED"||Math.abs(Number(x.qty))>1e-12)fail("V4_XRP_NOT_CLOSED");
  for(const leg of Object.values(s.legs||{}) as any[]){
    if(leg&&leg.status==="OPEN"&&Math.abs(Number(leg.qty))>1e-12)fail("V4_OPEN_LEG");
  }
}
function scopedFlat(positions:any[],orders:any[]){
  const ps=positions.filter(x=>HYPE_SYMBOLS.has(String(x?.symbol||"").toUpperCase())&&Math.abs(Number(x?.positionAmt))>1e-10);
  const os=orders.filter(x=>HYPE_SYMBOLS.has(String(x?.symbol||"").toUpperCase())&&["NEW","PARTIALLY_FILLED","PENDING_NEW"].includes(String(x?.status||"").toUpperCase()));
  if(ps.length||os.length)fail("VENUE_HYPE_ZEC_NOT_FLAT");
  return digest(JSON.stringify({positions:ps,orders:os}));
}
async function budgetRead<T>(read:()=>Promise<T>,renew:()=>Promise<void>):Promise<T>{
  for(let attempt=0;attempt<6;attempt++){
    await renew();
    try{return await read();}
    catch(error){
      const deferred=classifyAsterRateBudgetFailure(error);
      const timeout=error instanceof Error&&/^Aster request timeout after \d+ms$/.test(error.message);
      if((!deferred&&!timeout)||attempt===5)throw error;
      const waitMs=deferred
        ? nextAsterRateBudgetRetryMs(attempt,250,6000,deferred.waitMs??0,()=>0.5)
        : Math.min(6000,750*(attempt+1));
      await new Promise(r=>setTimeout(r,waitMs));
    }
  }
  fail("READ_RETRY_EXHAUSTED");
}
async function signedScopedProof(client:AsterV3Client,renew:()=>Promise<void>){
  const positions=await budgetRead(()=>client.getPositions(),renew);
  const orders=await budgetRead(()=>client.getOpenOrders(),renew);
  return scopedFlat(positions as any[],orders as any[]);
}
async function main(){
  if(process.getuid?.()===0)fail("DEPLOY_USER_REQUIRED");
  if(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH!=="/var/lib/disdex/shared/aster-rate-budget.json")fail("RATE_BUDGET_BINDING");
  await assertProductionGuards();
  const stateBefore=await json(STATE); assertState(stateBefore.value);
  assertV4((await json(V4)).value);
  const gate=new FileAccountOrderLock(LOCK,120000,PENDING);
  let lease;
  for(let i=0;i<8&&!lease;i++){
    lease=await gate.acquire("HYPE_CURRENT_FLAT_REVIEW_REPAIR:"+process.pid);
    if(!lease)await new Promise(r=>setTimeout(r,1000));
  }
  if(!lease)fail("ACCOUNT_LOCK_BUSY");
  try{
    const renew=async()=>{await lease!.renew();};
    const client=new AsterV3Client({
      baseUrl:process.env.ASTER_FUTURES_BASE_URL,
      userAddress:process.env.ASTER_USER_ADDRESS,
      privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined,
      requestTimeoutMs:12000,recvWindowMs:5000,readOnlyRateLimitMaxRetries:0,
      userAgent:"DisDex-HYPE-Current-Flat-Repair/1.0",
    });
    if(!client.hasTradingCredentials())fail("ASTER_CREDENTIALS_MISSING");
    await assertProductionGuards();
    const proof1=await signedScopedProof(client,renew);
    await new Promise(r=>setTimeout(r,750));
    const proof2=await signedScopedProof(client,renew);
    if(proof1!==proof2)fail("SCOPED_PROOF_CHANGED");
    assertV4((await json(V4)).value);
    await assertProductionGuards();
    const current=await readFile(STATE);
    if(digest(current)!==digest(stateBefore.raw))fail("STATE_CAS_PRECONDITION");
    const now=Date.now();
    const after:any={...stateBefore.value,
      updatedAt:now,lastDecisionTs:now,
      lastDecision:{strategy:"HYPE_LONG",signalTs:null,accepted:false,reason:"HYPE_CURRENT_FLAT_REVIEW_REPAIRED_AFTER_SIGNED_SCOPED_FLAT"},
      failures:[...stateBefore.value.failures.slice(-99),{message:"HYPE_CURRENT_FLAT_REVIEW_REPAIRED_AFTER_SIGNED_SCOPED_FLAT",occurredAt:now}],
    };
    delete after.manualReview; delete after.pending; delete after.positions;
    const bytes=Buffer.from(JSON.stringify(after,null,2)+"\n");
    if(PREVIEW){
      console.log(JSON.stringify({status:"HYPE_CURRENT_FLAT_REVIEW_REPAIR_PREVIEW_PASS",
        stateSha256Before:digest(stateBefore.raw),predictedStateSha256:digest(bytes),
        signedScopedReads:2,hypeZecPositions:0,hypeZecOpenOrders:0,
        stateWrites:0,ordersSent:0,cancelsSent:0,positionChangesSent:0}));
      return;
    }
    const backup=STATE+".before-current-flat-review-repair-"+now;
    await copyFile(STATE,backup,fsConstants.COPYFILE_EXCL);
    await chmod(backup,stateBefore.st.mode&0o777);
    if(digest(await readFile(backup))!==digest(stateBefore.raw))fail("BACKUP_MISMATCH");
    const temp=STATE+"."+randomUUID()+".tmp";
    const fd=await open(temp,"wx",stateBefore.st.mode&0o777);
    try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
    try{
      await chmod(temp,stateBefore.st.mode&0o777);
      await renew();
      if(digest(await readFile(STATE))!==digest(stateBefore.raw))fail("STATE_CAS_MISMATCH");
      await rename(temp,STATE);
    }catch(error){await unlink(temp).catch(()=>undefined);throw error;}
    const readback=JSON.parse((await readFile(STATE)).toString("utf8"));
    if(readback.manualReview!=null||readback.pending!=null||(readback.positions?.length??0)!==0||
      readback.runtimeCommitSha!==HYPE_SHA||readback.updatedAt!==now)fail("STATE_POSTCHECK");
    console.log(JSON.stringify({status:"HYPE_CURRENT_FLAT_REVIEW_REPAIR_PASS",backup,
      stateSha256Before:digest(stateBefore.raw),stateSha256After:digest(bytes),
      signedScopedReads:2,hypeZecPositions:0,hypeZecOpenOrders:0,
      ordersSent:0,cancelsSent:0,positionChangesSent:0}));
  }finally{await lease.release();}
}
main().catch(error=>{
  console.error(JSON.stringify({status:"HYPE_CURRENT_FLAT_REVIEW_REPAIR_BLOCKED",
    reason:error instanceof Error?error.message:String(error),
    ordersSent:0,cancelsSent:0,positionChangesSent:0}));
  process.exitCode=2;
});
