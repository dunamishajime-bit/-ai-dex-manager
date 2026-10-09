import "dotenv/config";
import {readFile,lstat} from "node:fs/promises";
import {AsterV3Client} from "../lib/aster-v3-client";
import {V12AsterLiveAdapter} from "../lib/v12-aster-live-adapter";
import {FileAccountOrderLock} from "../lib/disdex-account-order-lock";
import {V4ExecutionStore} from "../lib/v12-v4-execution-store";
import {initializeV4SignedFlatState} from "../lib/v12-v4-signed-bootstrap";
import {V4RunnerEngine} from "../lib/v12-v4-runner-engine";
import {loadV4ClosedCandles,buildV4LiveDecisionBatch} from "../lib/v12-v4-live-candidate-builder";
import {productionExitSpec} from "../lib/v12-v4-production-lifecycle";
import {readV4TimeStopApproval,approvedV4TimeStopQuote} from "../lib/v12-v4-time-stop-approval";
import {attachV4NativeCoreCandidates} from "../lib/v12-v4-core-candidate";
import type {V4PeerKind,V4PeerSource} from "../lib/v12-v4-peer-state-owners";
const H2=7200000;
function env(name:string){
 const value=String(process.env[name]??"").trim();
 if(!value)throw Error("V4_MISSING_CONFIGURATION:"+name);
 return value;
}
async function safeJson(path:string){
 const st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink())throw Error("V4_UNSAFE_SOURCE_FILE");
 return JSON.parse(await readFile(path,"utf8")) as Record<string,any>;
}
async function loadPeers():Promise<V4PeerSource[]>{
 const paths=JSON.parse(env("V12_V4_PEER_STATE_PATHS_JSON")) as Record<V4PeerKind,string>;
 const kinds:V4PeerKind[]=["V12","PENGU","Q102","V52","FET","HYPE_LONG","IDLE","RESIDUAL"];
 return Promise.all(kinds.map(async kind=>{
  const path=paths[kind];
  if(!path||!path.startsWith("/var/lib/disdex/"))throw Error("V4_PEER_STATE_PATH_INVALID:"+kind);
  const raw=await safeJson(path);
  const programSha=String(raw.runtimeCommitSha??raw.runtimeSha??"").toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(programSha))throw Error("V4_PEER_RELEASE_NOT_ATTESTED:"+kind);
  return {kind,programSha,raw};
 }));
}
function requireReleaseSha(){
 const sha=env("DISDEX_RELEASE_SHA").toLowerCase();
 if(!/^[a-f0-9]{40}$/.test(sha))throw Error("V4_INVALID_RELEASE_SHA");
 if(env("V12_V4_LIVE_ACK").toLowerCase()!==sha)throw Error("V4_RELEASE_ACK_MISMATCH");
 return sha;
}
export async function buildV4ProductionRuntime(){
 const releaseSha=requireReleaseSha();
 const client=new AsterV3Client({baseUrl:process.env.ASTER_FUTURES_BASE_URL,
  userAddress:process.env.ASTER_USER_ADDRESS,
  privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined,
  requestTimeoutMs:10000,userAgent:"DisDex-V12-V4-Production/"+releaseSha.slice(0,12)});
 if(!client.hasTradingCredentials())throw Error("V4_SIGNED_VENUE_CREDENTIALS_REQUIRED");
 const adapter=new V12AsterLiveAdapter(client,{maxSlippageBps:20});
 const store=new V4ExecutionStore(env("V12_V4_EXECUTION_STORE_PATH"),releaseSha);
 if(process.argv.includes("--init-signed-flat")){
  await initializeV4SignedFlatState({store,client,peers:await loadPeers(),pendingPath:env("DISDEX_PENDING_EXPOSURE_REGISTRY_PATH")});
 }
 store.read();
 const lock=new FileAccountOrderLock(env("DISDEX_ACCOUNT_LOCK_PATH"),120000);
 const pendingRegistryPath=env("DISDEX_PENDING_EXPOSURE_REGISTRY_PATH");
 const info=await client.getExchangeInfo();
 const symbols=new Map(info.symbols.map(row=>[row.symbol,row]));
 let cache:{boundary:number;value:ReturnType<typeof buildV4LiveDecisionBatch>}|undefined;
 const fetchDecision=async()=>{
  const now=Date.now(),boundary=now-now%H2;
  if(cache&&cache.boundary===boundary)return cache.value;
  const bars=await loadV4ClosedCandles(client,now);
  let value=buildV4LiveDecisionBatch(bars,now);
  if(value.nativeCoreEvents.length){
   const refs=new Map<string,number>();
   for(const event of value.nativeCoreEvents){
    const raw=await client.getKlines(event.symbol+"USDT","1h",3);
    const opened=raw.find(row=>Number(row[0])===event.entry_ts_ms);
    if(!opened||Number(opened[0])>now||!(Number(opened[1])>0))
     throw Error("V4_NATIVE_CORE_ENTRY_H1_OPEN_MISSING");
    refs.set(event.symbol+"|"+event.entry_ts_ms,Number(opened[1]));
   }
   value=attachV4NativeCoreCandidates(value,bars,refs);
  }
  cache={boundary,value};
  return value;
 };
 const engine=new V4RunnerEngine({
  store,accountLock:lock,adapter,client,pendingRegistryPath,
  fetchDecision,fetchPeers:loadPeers,
  fetchExitFeed:async symbol=>{
   const now=Date.now(),rows=await client.getKlines(symbol,"1h",500);
   return {closed:rows.filter(x=>Number(x[0])+3600000<=now&&Number(x[6])<now)
     .map(x=>({openTs:Number(x[0]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4])})),
    nextOpens:rows.filter(x=>Number(x[0])<=now).map(x=>({ts:Number(x[0]),price:Number(x[1])}))};
  },
  quantityNormalizer:adapter.executor,
  referencePrice:async symbol=>{
   const quote=await adapter.executor.getMarketQuote(symbol);
   const p=(Number(quote.askPrice)+Number(quote.bidPrice))/2;
   if(!(p>0))throw Error("V4_MARKET_QUOTE_NOT_VALID");
   return p;
  },
  minimumVenueOrderNotional:async(symbol,price)=>{
   const row=symbols.get(symbol);
   if(!row||row.status!=="TRADING")throw Error("V4_SYMBOL_NOT_TRADING");
   const notional=Number(row.filters?.find(f=>f.filterType==="MIN_NOTIONAL")?.notional);
   const qty=Number(row.filters?.find(f=>f.filterType==="LOT_SIZE")?.minQty);
   if(!(notional>0)||!(qty>0))throw Error("V4_VENUE_FILTER_NOT_ATTESTED");
   return Math.max(notional,qty*price);
  },
  requiredResidentStop:async({route,side,entryPrice,atr14})=>{
   const spec=productionExitSpec(route),sg=side==="LONG"?1:-1;
   if(spec.kind==="TIME"){
    // Never infer authorization from research scores or environment flags.
    // A root-owned exact-SHA policy artifact must be explicitly installed.
    const approval=await readV4TimeStopApproval(releaseSha);
    return approvedV4TimeStopQuote({route,side,signedAverageEntryFill:entryPrice,approval});
   }
   return spec.kind==="ATR"?entryPrice-sg*spec.sl*atr14:
    (await import("../lib/v12-x1-all")).protectiveLevels(entryPrice,atr14,side).initialStop;
  },
  assertSourceParity:async()=>{throw Error("V4_NATIVE_SOURCE_FORWARD_PARITY_NOT_CERTIFIED");},
  assertAuthority:async()=>{throw Error("V4_REAL_ORDER_ACTIVATION_NOT_CERTIFIED");},
 });
 return {engine,releaseSha};
}
async function main(){
 const once=process.argv.includes("--once"),daemon=process.argv.includes("--daemon"),initialize=process.argv.includes("--init-signed-flat");
 if(process.argv.includes("--self-test")){
  const {PRODUCTION_EXIT_CATALOG}=await import("../lib/v12-v4-production-lifecycle");
  if(PRODUCTION_EXIT_CATALOG.length!==41)throw Error("V4_ROUTE_CATALOG_INCOMPLETE");
  console.log(JSON.stringify({status:"SELF_TEST_PASS",routes:41,realOrderEnabledV4:0}));
  return;
 }
 if(!once&&!daemon&&!initialize)throw Error("V4_RUNNER_REQUIRES_MODE");
 const {engine,releaseSha}=await buildV4ProductionRuntime();
 if(initialize){console.log(JSON.stringify({status:"SIGNED_FLAT_STATE_INITIALIZED",releaseSha,orderEnabled:false}));return;}
 let stopping=false;
 process.once("SIGINT",()=>{stopping=true;});
 process.once("SIGTERM",()=>{stopping=true;});
 do{
  const result=await engine.tick();
  console.log(JSON.stringify({releaseSha,timestamp:new Date().toISOString(),...result}));
  if(!daemon||stopping)break;
  await new Promise<void>(done=>setTimeout(done,Math.max(15000,Number(process.env.V12_V4_TICK_INTERVAL_MS||60000))));
 }while(!stopping);
}
if(process.argv[1]?.includes("v12-v4-production-runner"))
 main().catch(error=>{
  console.error(JSON.stringify({level:"fatal",status:"V4_RUNNER_FAILED_CLOSED",
   error:error instanceof Error?error.message:String(error)}));
  process.exitCode=2;
 });
