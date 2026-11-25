/**
 * First-party H48R4 research/STOP8 SHADOW entrypoint.
 *
 * Safe even if an operator sets LIVE mode accidentally: intentionally no
 * authenticated POST/DELETE, no order/cancel API, no Root permit writes,
 * no GLOBAL HOLD changes, and no LIVE mode code branch. The future exact
 * SHA-certified LIVE adapter is separately approved by the Owner/Codex.
 */
import "dotenv/config";
import {AsterV3Client,type AsterKline} from "../lib/aster-v3-client";
import {AsterDirectTradeExecutor} from "../lib/direct-trade-executor";
import {FileAccountOrderLock} from "../lib/disdex-account-order-lock";
import {FileH48ExecutionJournalStore} from "../lib/hype-h48-journal-store";
import {H48NativeReadOnlyMonitor} from "../lib/hype-h48-native-monitor";
import {readAuthenticatedH48Inventory} from "../lib/hype-h48-authenticated-readback";
import {createInterruptibleDelay} from "../lib/interruptible-delay";

const H=3_600_000, GRID=6*H;
const fail=(why:string):never=>{throw Error("H48_NATIVE_SHADOW_"+why)};
const intEnv=(name:string,defaultValue:number)=>{
  const n=Number(process.env[name]);return Number.isFinite(n)&&n>0?n:defaultValue;
};
function requireSha(input:unknown):string{
  const s=String(input??"").trim().toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(s))fail("IMMUTABLE_SHA_NOT_PINNED");
  return s;
}
function parseH1(symbol:string,rows:readonly AsterKline[],now:number){
  const result=rows.map(row=>{
    const openTs=Number(row[0]),open=Number(row[1]),close=Number(row[4]);
    if(!Number.isSafeInteger(openTs)||openTs<=0||openTs%H!==0
       ||!Number.isFinite(open)||open<=0
       ||!Number.isFinite(close)||close<=0
       ||openTs>now||now-openTs>250*H)
      fail("H1_BAR_INVALID:"+symbol);
    return {openTs,open,close};
  }).sort((a,b)=>a.openTs-b.openTs);
  for(let i=1;i<result.length;i++)
    if(result[i].openTs!==result[i-1].openTs+H)
      fail("H1_DATA_GAP_OR_DUPLICATE:"+symbol);
  return result;
}
async function main(){
  const sha=requireSha(process.env.DISDEX_H48_RUNTIME_SHA);
  const mode=String(process.env.DISDEX_H48_MODE??"SHADOW").trim().toUpperCase();
  if(mode!=="SHADOW")fail("LIVE_NOT_IMPLEMENTED_OR_AUTHORIZED");
  if(process.argv.includes("--self-test")){
    console.log(JSON.stringify({event:"h48-native-shadow-self-test",
      mode,sourceSha:sha,ordersSent:0,cancelsSent:0,positionChangesSent:0}));
    return;
  }
  const statePath=String(process.env.DISDEX_H48_JOURNAL_PATH??"");
  if(!statePath.startsWith("/")&&!/^[A-Za-z]:[\\/]/.test(statePath))
    fail("ABSOLUTE_SHADOW_JOURNAL_REQUIRED");
  const client=new AsterV3Client({
    baseUrl:process.env.ASTER_FUTURES_BASE_URL,
    userAddress:process.env.ASTER_USER_ADDRESS,
    privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined,
    requestTimeoutMs:intEnv("ASTER_REQUEST_TIMEOUT_MS",10_000),
    recvWindowMs:intEnv("ASTER_RECV_WINDOW_MS",5_000),
    userAgent:"DisDex-H48-SHADOW/"+sha.slice(0,12),
  });
  if(!client.hasTradingCredentials())fail("AUTHENTICATED_GET_CREDENTIALS_REQUIRED");
  const executor=new AsterDirectTradeExecutor(client);
  const orderLock=new FileAccountOrderLock(
    process.env.DISDEX_ACCOUNT_LOCK_PATH||"/var/lib/disdex/shared/account-order.lock",
    intEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS",120_000));
  const store=new FileH48ExecutionJournalStore(statePath,sha);
  const delay=createInterruptibleDelay();
  let stopping=false;
  const stop=()=>{stopping=true;delay.interrupt()};
  process.on("SIGINT",stop);process.on("SIGTERM",stop);
  const daemon=process.argv.includes("--daemon");
  do{
    const lock=await orderLock.acquire("H48_NATIVE_SHADOW:"+sha,"ASTER_FUTURES");
    if(!lock){
      console.log(JSON.stringify({event:"h48-shadow",status:"HOLD",
        reason:"ASTER_SINGLE_WRITER_LOCK_BUSY",ordersSent:0,cancelsSent:0}));
      if(!daemon||stopping)break;
      await delay.wait(30_000);
      continue;
    }
    try{
      const now=Date.now();
      // getPositions, getOpenOrders, getAccountSnapshot are authenticated
      // GET, never a synthetic flat snapshot. Reject failed account state.
      await readAuthenticatedH48Inventory({executor,lease:lock});
      const [h,b]=await Promise.all([
        client.getKlines("HYPEUSDT","1h",120),
        client.getKlines("BTCUSDT","1h",120),
      ]);
      const hype=parseH1("HYPEUSDT",h,now),btc=parseH1("BTCUSDT",b,now);
      const gridTs=Math.floor(now/GRID)*GRID;
      const current=hype.find(row=>row.openTs===gridTs);
      const entry=(now-gridTs<120_000&&current)
        ?{openTs:gridTs,open:current.open,observedAt:now}:undefined;
      const closed=(rows:ReturnType<typeof parseH1>)=>
        rows.filter(row=>row.openTs+H<=gridTs)
          .slice(-25).map(row=>({openTs:row.openTs,close:row.close}));
      const monitor=new H48NativeReadOnlyMonitor({
        runtimeSha:sha,store,executor,lease:lock,
      });
      const record=await store.load();
      const dueTs=record.mode==="OPEN"?record.position?.contract.logicalExitTs:undefined;
      const dueH1=dueTs?hype.find(row=>row.openTs===dueTs):undefined;
      const exitBoundary=dueH1&&now-dueTs!>=0&&now-dueTs!<120_000
        ?{openTs:dueTs!,open:dueH1.open,observedAt:now}:undefined;
      const outcome=await monitor.tick({
        entry,
        ...(entry?{hypeClosed:closed(hype),btcClosed:closed(btc)}:{}),
        exitBoundary,
      });
      console.log(JSON.stringify({event:"h48-native-shadow-tick",
        sourceSha:sha,mode,asOf:now,...outcome,
        ordersSent:0,cancelsSent:0,positionChangesSent:0}));
    }catch(error){
      console.error(JSON.stringify({event:"h48-native-shadow-tick",
        status:"HOLD",reason:error instanceof Error?error.message:String(error),
        ordersSent:0,cancelsSent:0,positionChangesSent:0}));
    }finally{
      await lock.release();
    }
    if(!daemon||stopping)break;
    await delay.wait(Math.min(30_000,intEnv("DISDEX_H48_SHADOW_POLL_MS",30_000)));
  }while(!stopping);
}
main().catch(error=>{
  console.error(JSON.stringify({event:"h48-native-shadow-fatal",
    status:"FAIL_CLOSED",message:error instanceof Error?error.message:String(error),
    ordersSent:0,cancelsSent:0,positionChangesSent:0}));
  process.exitCode=1;
});
