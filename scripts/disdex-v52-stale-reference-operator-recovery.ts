
import {readFile,writeFile,rename,stat,chown,chmod,mkdir} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {dirname} from "node:path";
import {AsterV3Client} from "../lib/aster-v3-client";
import {FileAccountOrderLock} from "../lib/disdex-account-order-lock";
import {readSharedCryptoDailyRisk} from "../lib/disdex-shared-crypto-daily-risk";
import {readSharedKillSwitch,isV52ReferenceOnlyHold} from "../lib/disdex-shared-kill-switch";
const SHA="d62fafd20864e6fb8b6c16afef0765b5435f8b03";
const V52SHA="7688ed7c93a1918d8b44837339b7da5584a868f5";
const ACK="I_AUTHORIZE_V52_STALE_REFERENCE_SCOPED_RECOVERY_AFTER_3X_SIGNED_GET";
const root="/var/lib/disdex";
const killPath=root+"/shared/kill-switch.json";
const nearId="NEARUSDT:REC_X02_TIME_36H:SHORT:1792980000000";
const aaveId="AAVEUSDT:REC_X06_TIME_12H:SHORT:1792980000000";
const stopId="v12-v4-50ef46933e7018db365535fa70fd";
const assert=(ok,msg)=>{if(!ok)throw Error("V52_SCOPE_RECOVERY_"+msg);};
const read=async(path)=>JSON.parse(await readFile(path,"utf8"));
const same=(a,b)=>Number.isFinite(Number(a))&&Math.abs(Number(a)-b)<=1e-6*Math.max(1,Math.abs(b));
function eligible(k){
 return k?.active===true&&k.scope==="V52_REFERENCE_ONLY"&&k.action==="HOLD_PROTECTED"
   &&k.operator==="disdex-v52-aster-only"&&k.recoverable===true
   &&k.strategyId==="DISDEX_V35_STRONG_RESERVED_PENGU_V96"
   &&isV52ReferenceOnlyHold(k)
   &&/^[0-9a-f]{40}$/.test(String(k.scopeMigrationSha||""));
}
async function safety(){
 const k=await read(killPath);assert(eligible(k),"WRONG_KILL_OWNER_REASON_SCOPE");
 const parsed=await readSharedKillSwitch({DISDEX_SHARED_KILL_SWITCH_FILE:killPath});
 assert(isV52ReferenceOnlyHold(parsed),"KILL_READER_MISMATCH");
 const v52=await read(root+"/v52-aster-only/runner-live.json");
 assert(v52.runtimeCommitSha===V52SHA&&v52.mode==="LIVE"&&v52.status==="ready","V52_RUNTIME_NOT_READY");
 assert(v52.positions&&Object.keys(v52.positions).length===0&&v52.pendingOrder==null
   &&v52.manualReview==null&&v52.ordersAllowed===true&&v52.newOrdersAllowed===true
   &&Date.now()-Number(v52.updatedAt)<20*60_000,"V52_NOT_FLAT_OR_FRESH");
 const v4=await read(root+"/v12-v4/orders.json");
 assert(v4.releaseSha===SHA,"V4_SHA_MISMATCH");
 const legs=v4.state?.legs||{},a=legs[aaveId],n=legs[nearId],p=v4.protections?.[nearId];
 assert(a?.status==="CLOSED"&&same(a.qty,0),"AAVE_NOT_CLOSED");
 assert(n?.status==="OPEN"&&same(n.qty,2)&&n.plannedExit==null,"NEAR_DRIFT");
 assert(Object.values(legs).filter(x=>x.status==="OPEN"&&Number(x.qty)>0).length===1,"OTHER_ACTIVE_LEGS");
 assert(p?.phase==="STOP_CONFIRMED"&&p.stopClientOrderId===stopId
   &&same(p.protectedQty,2),"NEAR_PROTECTION_DRIFT");
 const inStop=v4.intents?.[stopId];
 assert(inStop?.action==="STOP"&&inStop.stage==="ACKNOWLEDGED"&&same(inStop.command?.quantity,2),"STOP_INTENT_DRIFT");
 const pending=await read(root+"/shared/pending-exposure.json");
 const entries=Array.isArray(pending)?pending:Array.isArray(pending.entries)?pending.entries:Object.values(pending.entries||{});
 assert(entries.every(x=>x.status==="RELEASED"),"PENDING_NOT_ZERO");
 const risk=await readSharedCryptoDailyRisk(root+"/shared/crypto-daily-risk.json");
 assert(risk.ok&&risk.state?.sourceComplete&&risk.state?.tripped===false,"SHARED_RISK_NOT_HEALTHY_"+risk.reason);
 const margin=await read(root+"/shared/margin-risk/guard-live.json");
 assert(margin.stage==="HEALTHY"&&margin.ordersAllowed===true&&margin.mode==="live"&&margin.action==="NONE"
   &&Date.now()<=Number(margin.nextCheckAt)+120_000,"MARGIN_NOT_HEALTHY");
 const r=await fetch("http://127.0.0.1:8797/health",{signal:AbortSignal.timeout(5000)});
 assert(r.ok,"STOCK_REFERENCE_HEALTH_UNAVAILABLE");
 const q=await r.json();
 assert(q.connected===true&&q.lastError==null&&(
  (q.marketOpen===false&&q.status==="deferred"&&q.healthReason==="MARKET_CLOSED_REFERENCE_DEFERRED")
  ||(q.marketOpen===true&&q.status==="ok"&&q.freshnessReady===true)),"STOCK_REFERENCE_UNSAFE");
 return k;
}
function venue(v){
 const p=v.positions.filter(x=>Math.abs(Number(x.positionAmt))>1e-10);
 assert(p.length===1&&p[0].symbol==="NEARUSDT"&&same(p[0].positionAmt,-2)
 &&same(p[0].entryPrice,4.513),"ASTER_POSITION_DRIFT");
 assert(v.orders.length===1,"ASTER_ORDER_SET_DRIFT");
 const o=v.orders[0];
 assert(o.symbol==="NEARUSDT"&&o.clientOrderId===stopId&&o.status==="NEW"
 &&o.side==="BUY"&&o.type==="STOP_MARKET"&&o.reduceOnly===true
 &&same(o.origQty,2)&&same(o.stopPrice,4.874),"ASTER_NEAR_STOP_DRIFT");
 return JSON.stringify({pos:[p[0].symbol,p[0].positionAmt,p[0].entryPrice],
 stop:[o.symbol,o.clientOrderId,o.side,o.type,o.status,o.origQty,o.stopPrice]});
}
async function signed(client){
 const [positions,orders]=await Promise.all([client.getPositions(),client.getOpenOrders()]);
 return venue({positions,orders});
}
async function writeKill(value,ownership){
 const temp=killPath+"."+randomUUID()+".tmp";
 await writeFile(temp,JSON.stringify(value,null,2)+"\n",{mode:0o600,flag:"wx"});
 await chown(temp,ownership.uid,ownership.gid);
 await chmod(temp,ownership.mode&0o777);
 await rename(temp,killPath);
}
async function run(){
 if(process.argv.includes("--self-test")){
  const k={active:true,action:"HOLD_PROTECTED",scope:"V52_REFERENCE_ONLY",recoverable:true,
  operator:"disdex-v52-aster-only",strategyId:"DISDEX_V35_STRONG_RESERVED_PENGU_V96",
  scopeMigrationSha:"a".repeat(40),
  reason:'V52 recoverable tick error: HTTP 503 http://127.0.0.1:8797/quote?symbol=TSLA: {"error":"stale_quote","ageMs":32286}'};
  assert(eligible(k)&&!eligible({...k,scope:"GLOBAL"})&&!eligible({...k,action:"FLATTEN_MANAGED"}),"SELFTEST_SCOPE");
  console.log("V52_SCOPED_REFERENCE_RECOVERY_SELFTEST_PASS");return;
 }
 const apply=process.argv.includes("--apply"),verify=process.argv.includes("--verify-only");
 assert(apply!==verify,"EXACTLY_ONE_MODE");
 assert(process.argv[process.argv.indexOf("--v4-sha")+1]===SHA,"EXPECTED_SHA");
 if(apply)assert(process.argv[process.argv.indexOf("--ack")+1]===ACK,"OPERATOR_ACK_REQUIRED");
 const start=await safety(),before=await readFile(killPath);
 const client=new AsterV3Client({baseUrl:process.env.ASTER_FUTURES_BASE_URL,
 userAddress:process.env.ASTER_USER_ADDRESS,privateKey:process.env.ASTER_API_PRIVATE_KEY,
 readOnlyRateLimitMaxRetries:0,requestTimeoutMs:10000,recvWindowMs:5000,
 userAgent:"DisDex-V52-ScopedQuoteRecovery/1"});
 assert(client.hasTradingCredentials(),"ASTER_SIGNED_CREDENTIALS_REQUIRED");
 let fingerprint="";
 for(let i=0;i<3;i++){
  assert(JSON.stringify(await safety())===JSON.stringify(start),"HOLD_CHANGED_DURING_GET");
  const value=await signed(client);
  assert(i===0||value===fingerprint,"SIGNED_GETS_NOT_STABLE");
  fingerprint=value;
  if(i<2)await new Promise(ok=>setTimeout(ok,2000));
 }
 if(verify){
  console.log(JSON.stringify({status:"V52_REFERENCE_RECOVERY_VERIFY_PASS",signedReadOnlyGets:3,
  nearShort:2,nearStopQty:2,killScope:start.scope,ordersSent:0,cancelsSent:0,positionChangesSent:0}));return;
 }
 const lock=new FileAccountOrderLock(root+"/shared/account-order.lock",120000,root+"/shared/pending-exposure.json");
 const req="v52-ref-"+Date.now()+"-"+randomUUID();
 const held=await lock.acquire("V52_REFERENCE_RECOVERY:"+req);
 assert(held,"ACCOUNT_LOCK_BUSY");
 let cleared=false;
 const owner=await stat(killPath);
 try{
  await held.document();
  assert(JSON.stringify(await safety())===JSON.stringify(start),"HOLD_CHANGED_UNDER_LOCK");
  assert((await readFile(killPath)).equals(before),"HOLD_BYTES_CHANGED");
  assert(await signed(client)===fingerprint,"SIGNED_VENUE_DRIFT_UNDER_LOCK");
  const directory=dirname(killPath)+"/operator-recovery-evidence";
  await mkdir(directory,{recursive:true,mode:0o750});
  const backup=directory+"/"+req+"-kill-before.json";
  await writeFile(backup,before,{mode:0o600,flag:"wx"});
  await writeKill({...start,active:false,operator:"V52_SCOPED_REFERENCE_OPERATOR_RECOVERY",
  previousReason:start.reason,recoveredAt:new Date().toISOString(),recoveryRequestId:req,
  evidence:{signedReadOnlyGets:3,nearProtected:true,quoteFreshOrClosed:true,backup,
   ordersSent:0,cancelsSent:0,positionChangesSent:0}},owner);
  cleared=true;
  assert(await signed(client)===fingerprint,"POST_CLEAR_VENUE_DRIFT");
  assert((await readSharedKillSwitch({DISDEX_SHARED_KILL_SWITCH_FILE:killPath})).active===false,
   "POST_CLEAR_STILL_ACTIVE");
  console.log(JSON.stringify({status:"V52_REFERENCE_RECOVERY_APPLY_PASS",
  requestId:req,nearShort:2,nearStopQty:2,ordersSent:0,cancelsSent:0,positionChangesSent:0}));
 }catch(error){
  if(cleared){
   const check=await read(killPath).catch(()=>null);
   if(check?.recoveryRequestId===req&&check?.active===false)
    await writeKill({...start,active:true,scope:"GLOBAL",operator:"V52_SCOPED_RECOVERY_ROLLBACK_FAIL_CLOSED",
    previousReason:start.reason,reason:"V52 scoped recovery post-check failed: "+String(error),recoveryRequestId:req},owner)
    .catch(()=>undefined);
  }
  throw error;
 }finally{await held.release();}
}
run().catch(error=>{
 console.error(JSON.stringify({status:"V52_REFERENCE_RECOVERY_FAIL_CLOSED",reason:String(error),
 ordersSent:0,cancelsSent:0,positionChangesSent:0}));process.exitCode=1;
});
