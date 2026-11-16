/** Immutable worker replacement module: signed read-only composite ownership.
 * Reuses the worker's FULL native STOP/state validator on all residual rows.
 * H48 is removed from that residual set only by an opaque root-pinned proof.
 */
import {createHash} from "node:crypto";
import {lstat,readFile,readlink} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {pathToFileURL} from "node:url";
import {authorizePendingH48Ownership,partitionPendingH48Ownership,verifyPendingH48Capability,pendingWitnessNumber,pendingModuleExports,type PendingH48Capability} from "./disdex-pending-h48-composite";
import {loadPendingProtectedHoldCapability,verifyPendingProtectedHold,type PendingNoOrderContext} from "./disdex-pending-protected-hold";
type Row=Record<string,any>;
type Lease={document():Promise<Row>;renew():Promise<Row>};
type Client={getPositions():Promise<Row[]>;getOpenOrders():Promise<Row[]>};
const execute=promisify(execFile),MANIFEST="/etc/disdex/runner-pins.json",V4_LEDGER="/var/lib/disdex/v12-v4/orders.json";
function fail(code:string):never{throw Error("PENDING_COMPOSITE_"+code);}
const sha=(s:unknown,n=40):s is string=>typeof s==="string"&&new RegExp("^[a-f0-9]{"+n+"}$").test(s);
const time=(n:unknown):n is number=>typeof n==="number"&&Number.isSafeInteger(n)&&n>0;
const hash=(b:string|Uint8Array)=>createHash("sha256").update(b).digest("hex");
const PREFIX:Record<string,string>={V12_V4:"disdex-v12-v4",PENGU_V8:"disdex-pengu-dual-ls-v2",QUALITY102_CAUSAL_V1:"disdex-quality102-causal-v1",V52:"disdex-v52-aster-only",FET_BRK48_RESIDUAL:"disdex-fet-brk48",HYPE_TREND_LONG:"disdex-hype-long",IDLE_PRIORITY_SHORT:"disdex-idle-priority-short"};
const OWNER:Record<string,string>={V12_V4:"V12_V4",Q102:"QUALITY102_CAUSAL_V1",PENGU:"PENGU_V8",V52:"V52",FET:"FET_BRK48_RESIDUAL",HYPE:"HYPE_TREND_LONG",IDLE:"IDLE_PRIORITY_SHORT",RESIDUAL:"IDLE_PRIORITY_SHORT"};
const ENTRY:Record<string,string[]>={V12_V4:["v12-v4-production-runner.ts"],PENGU_V8:["disdex-pengu-dual-ls-v2-live-runner.ts"],QUALITY102_CAUSAL_V1:["disdex-quality102-causal-v1-live-runner.ts"],V52:["disdex-v52-aster-only-live-runner.ts"],FET_BRK48_RESIDUAL:["disdex-fet-brk48-live-runner.ts"],HYPE_TREND_LONG:["disdex-hype-zec-long-live-runner.ts","disdex-hype-trend-live-runner.ts","disdex-hype-stable4-live-runner.ts"],IDLE_PRIORITY_SHORT:["disdex-idle-priority-short-live-runner.ts"]};
export function pendingCanonicalJson(v:any):string{if(Array.isArray(v))return"["+v.map(pendingCanonicalJson).join(",")+"]";if(v&&typeof v==="object")return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+pendingCanonicalJson(v[k])).join(",")+"}";const s=JSON.stringify(v);if(s===undefined)fail("UNDEFINED_PROOF_VALUE");return s;}
export const pendingCanonicalDigest=(v:unknown)=>hash(pendingCanonicalJson(v));
/** Decimal text stays exact across JS/Python without rounding native quantities through Number. */
export function pendingDecimalText(value:unknown):string{
 pendingWitnessNumber(value);let s=String(value).trim(),sign="";if(s[0]==="-"||s[0]==="+"){if(s[0]==="-")sign="-";s=s.slice(1);}
 const [m,e="0"]=s.toLowerCase().split("e"),[a,b=""]=m.split("."),digits=(a+b).replace(/^0+/,"")||"0";
 let exp=Number(e)-b.length;if(!Number.isSafeInteger(exp)||Math.abs(exp)>1000)fail("DECIMAL_EXPONENT");
 if(digits==="0")return"0";
 let out=exp>=0?digits+"0".repeat(exp):digits.length+exp>0?digits.slice(0,digits.length+exp)+"."+digits.slice(digits.length+exp):"0."+"0".repeat(-exp-digits.length)+digits;
 if(out.includes("."))out=out.replace(/0+$/,"").replace(/\.$/,"");return sign+out;
}
export function pendingInventorySnapshot(positions:Row[],orders:Row[]){
 if(!Array.isArray(positions)||!Array.isArray(orders))fail("SIGNED_ARRAYS");const seen=new Set<string>(),ids=new Set<string>();
 const p=positions.flatMap(row=>{const qty=pendingWitnessNumber(row?.positionAmt);if(qty===0)return[];if(Math.abs(qty)<=1e-12||typeof row.symbol!=="string"||!/^[A-Z0-9]+USDT$/.test(row.symbol)||seen.has(row.symbol)||!["BOTH","LONG","SHORT"].includes(row.positionSide)||!(pendingWitnessNumber(row.entryPrice)>0))fail("POSITION_IDENTITY_OR_DUST");if(row.positionSide!=="BOTH"&&(row.positionSide==="LONG"?qty<0:qty>0))fail("POSITION_SIDE");seen.add(row.symbol);return[{symbol:row.symbol,positionSide:row.positionSide,positionAmt:pendingDecimalText(row.positionAmt),entryPrice:pendingDecimalText(row.entryPrice)}];});
 const o=orders.map(row=>{const cid=row?.clientOrderId;if(typeof cid!=="string"||!cid||cid!==cid.trim()||ids.has(cid)||typeof row.symbol!=="string"||!/^[A-Z0-9]+USDT$/.test(row.symbol)||!["BUY","SELL"].includes(row.side)||!["STOP_MARKET","TAKE_PROFIT_MARKET"].includes(row.type)||row.reduceOnly!==true||row.status!=="NEW"||!(pendingWitnessNumber(row.origQty)>0)||pendingWitnessNumber(row.executedQty)!==0||!(pendingWitnessNumber(row.stopPrice)>0)||!(["string","number"].includes(typeof row.orderId)&&/^[1-9][0-9]*$/.test(String(row.orderId))))fail("ORDER_NOT_EXACT_PROTECTIVE");ids.add(cid);return{symbol:row.symbol,clientOrderId:cid,orderId:String(row.orderId),side:row.side,type:row.type,origQty:pendingDecimalText(row.origQty),executedQty:"0",reduceOnly:true,status:"NEW",stopPrice:pendingDecimalText(row.stopPrice)};});
 const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
 return{positions:p.sort((a,b)=>cmp(a.symbol,b.symbol)||cmp(a.positionSide,b.positionSide)),orders:o.sort((a,b)=>cmp(a.symbol,b.symbol)||cmp(a.clientOrderId,b.clientOrderId)||cmp(a.orderId,b.orderId)||cmp(a.type,b.type)||cmp(a.side,b.side))};
}
async function captureFile(path:string,rootImmutable=false){const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||(before.mode&0o002)!==0||(rootImmutable&&(before.uid!==0||(before.mode&0o222)!==0)))fail("FILE_METADATA");const bytes=await readFile(path),after=await lstat(path);if(before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.uid!==after.uid||before.mode!==after.mode)fail("FILE_RACED");return{bytes,sha256:hash(bytes),verify:async()=>{const next=await captureFile(path,rootImmutable);if(!bytes.equals(next.bytes))fail("FILE_CAS_CHANGED");}};}
async function manifestCapture(){const st=await lstat(MANIFEST),parent=await lstat("/etc/disdex");if(st.uid!==0||(st.mode&0o022)!==0||parent.uid!==0||!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o022)!==0)fail("PIN_AUTHORITY_METADATA");const file=await captureFile(MANIFEST);const manifest=JSON.parse(file.bytes.toString());if(manifest.schema!=="disdex-runner-pin-manifest/v1"||manifest.target!=="professional-dismanager.net")fail("PIN_AUTHORITY_IDENTITY");return{...file,manifest};}
/** Heavy actual-owner-source replay occurs BEFORE the account lease; later byte CAS is mandatory. */
export async function preflightPendingV4Replay(){
 const manifest=await manifestCapture(),v4Sha=manifest.manifest.runners?.V12_V4?.sha;if(!sha(v4Sha))fail("V4_PIN");
 const release="/home/deploy/disdex-trading/releases/"+v4Sha,modulePath=release+"/lib/v12-v4-execution-store.ts",module=await captureFile(modulePath,true),marker=await captureFile(release+"/.disdex-release-sha",true),ledger=await captureFile(V4_LEDGER);
 if(marker.bytes.toString().trim()!==v4Sha)fail("V4_MARKER");
 const native=pendingModuleExports(await import(pathToFileURL(modulePath).href));if(typeof native.V4ExecutionStore!=="function")fail("V4_REPLAY_MODULE");
 const document=new native.V4ExecutionStore(V4_LEDGER,v4Sha).read();
 if(document.releaseSha!==v4Sha||pendingCanonicalJson(document)!==pendingCanonicalJson(JSON.parse(ledger.bytes.toString())))fail("V4_REPLAY_BINDING");
 await module.verify();await marker.verify();await ledger.verify();await manifest.verify();
 return{v4Sha,rawSha256:ledger.sha256,files:{[modulePath]:module.sha256,[release+"/.disdex-release-sha"]:marker.sha256,[V4_LEDGER]:ledger.sha256},verify:async()=>{await module.verify();await marker.verify();await ledger.verify();await manifest.verify();}};
}
export async function preparePendingCompositeOwnership(input:{positions:Row[];orders:Row[];workerSha:string;lease:Lease;client:Client;context?:PendingNoOrderContext;replay:Awaited<ReturnType<typeof preflightPendingV4Replay>>}){
 if(!sha(input.workerSha))fail("WORKER_SOURCE");const manifest=await manifestCapture();await input.replay.verify();
 if(manifest.manifest.runners?.V12_V4?.sha!==input.replay.v4Sha)fail("V4_PIN_CAS");
 const protectedHold=input.context?await loadPendingProtectedHoldCapability(input.replay.v4Sha,input.context):undefined,release="/home/deploy/disdex-trading/releases/"+input.workerSha;
 const [ownerModule,venueModule,observationModule]=(await Promise.all([import(pathToFileURL(release+"/lib/disdex-pending-owner-evidence.ts").href),import(pathToFileURL(release+"/lib/disdex-pending-owned-venue.ts").href),import(pathToFileURL(release+"/lib/resident-stop-observation.ts").href)])).map(pendingModuleExports);
 let h48:PendingH48Capability|undefined,hype:any,hypeState:any,hypeFile:any;const original=pendingInventorySnapshot(input.positions,input.orders);
 if(original.positions.some(p=>p.symbol==="HYPEUSDT")){
  hypeFile=await captureFile("/var/lib/disdex/hype-zec-long/runner.json");hypeState=JSON.parse(hypeFile.bytes.toString());
  if(hypeState.positions?.some((p:Row)=>p.nativeExitContract?.kind==="H48_TIME_ONLY")){
   hype={positions:input.positions,orders:input.orders,hypeState,hypeSha:manifest.manifest.runners.HYPE_TREND_LONG.sha,now:Date.now()};h48=await authorizePendingH48Ownership(hype,{manifest:manifest.manifest,lease:input.lease,client:input.client});
  }
 }
 const partition=h48?partitionPendingH48Ownership(hype,h48):{positions:input.positions,orders:input.orders,h48PositionCount:0,positionCount:original.positions.length,openOrderCount:original.orders.length};
 const ownership=await ownerModule.collectPendingOwnerEvidence(partition.positions,partition.orders,input.workerSha,{protectedHold});
 const checked=venueModule.validateOwnedPendingVenue({...ownership.input,positions:partition.positions,orders:partition.orders});
 if(checked.positionCount+partition.h48PositionCount!==original.positions.length||checked.openOrderCount!==original.orders.length)fail("ORIGINAL_INVENTORY_COUNTS_CHANGED");
 const observation=observationModule.observeResidentProtection(partition.positions,partition.orders,ownership.input.states,input.workerSha,ownership.input.now,ownership.input.v4Proofs,ownership.input.q102Proofs,ownership.input.ownerPins);
 if(!observation.ok||!ownership.sourceEvidence)fail("NATIVE_OWNER_EVIDENCE_EXPORT_REQUIRED");
 const verifyUnchanged=async()=>{await input.lease.document();await ownership.verifyUnchanged();await input.replay.verify();await manifest.verify();if(protectedHold)await verifyPendingProtectedHold(protectedHold);if(h48)await verifyPendingH48Capability(h48);if(hypeFile)await hypeFile.verify();};
 await verifyUnchanged();
 const sourceFiles={...input.replay.files,...ownership.sourceEvidence.files},owners:Row[]=observation.positions.map((p:Row)=>{const runner=OWNER[p.strategy];if(!runner)fail("UNKNOWN_NATIVE_OWNER");const sourceSha=manifest.manifest.runners[runner]?.sha;if(!sha(sourceSha))fail("OWNER_SOURCE");return{symbol:p.symbol,runner,sourceSha,policy:p.strategy==="V52"?"V52_NATIVE_STATE":"RESIDENT_STOP",orderIds:p.orders.map((o:Row)=>o.clientOrderId),certificateSha256:null};});
 if(h48){const proof=await verifyPendingH48Capability(h48);Object.assign(sourceFiles,proof.files,{"/var/lib/disdex/hype-zec-long/runner.json":hypeFile.sha256});owners.push({symbol:"HYPEUSDT",runner:"HYPE_TREND_LONG",sourceSha:manifest.manifest.runners.HYPE_TREND_LONG.sha,policy:"H48_TIME_ONLY",orderIds:[],certificateSha256:proof.certificateSha256});}
 const runnerShaMap=Object.fromEntries(Object.entries(manifest.manifest.runners).map(([k,v])=>[k,(v as Row).sha]));
 return{partition,ownership,owners,runnerShaMap,sourceFiles,pinManifestSha256:manifest.sha256,verifyUnchanged,positionCount:original.positions.length,openOrderCount:original.orders.length};
}
export async function observePendingOwnerRuntime(runner:string,sourceSha:string){
 if(!PREFIX[runner]||!sha(sourceSha))fail("RUNTIME_OWNER");const cwd="/home/deploy/disdex-trading/releases/"+sourceSha,unit=PREFIX[runner]+"@"+sourceSha+".service";
 const {stdout}=await execute("/usr/bin/systemctl",["show",unit,"--no-pager","--property=Id,ActiveState,SubState,MainPID,WorkingDirectory,ExecStart"],{timeout:10000});
 const data=Object.fromEntries(stdout.split(/\r?\n/).filter(x=>x.includes("=")).map(x=>[x.slice(0,x.indexOf("=")),x.slice(x.indexOf("=")+1)])),pid=Number(data.MainPID);
 if(data.Id!==unit||data.ActiveState!=="active"||data.SubState!=="running"||data.WorkingDirectory!==cwd||!Number.isSafeInteger(pid)||pid<=0||!data.ExecStart?.includes(cwd+"/"))fail("RUNTIME_UNIT");
 const [dir,raw,st]=await Promise.all([readlink("/proc/"+pid+"/cwd"),readFile("/proc/"+pid+"/cmdline","utf8"),lstat("/proc/"+pid)]),argv=raw.split("\0").filter(Boolean);
 if(dir!==cwd||st.uid!==process.getuid?.()||argv[0]!=="/usr/bin/node"||!argv.includes(cwd+"/node_modules/tsx/dist/loader.mjs")||!argv.includes("--daemon")||!ENTRY[runner].some(name=>argv.includes(cwd+"/scripts/"+name))||argv.some(a=>a.includes("/home/deploy/disdex-trading/releases/")&&!a.startsWith(cwd+"/")))fail("RUNTIME_PROCESS_SOURCE");
 const marker=await captureFile(cwd+"/.disdex-release-sha",true);if(marker.bytes.toString().trim()!==sourceSha)fail("RUNTIME_MARKER");return{runner,sourceSha,unit,pid,cwd};
}
export async function buildPendingCompositeWitness(input:{workerSha:string;requestNonce:string;positions:Row[];orders:Row[];signedObservedAt:{positions:number;orders:number;balances:number};registrySha256:string;lease:Lease;composite:Awaited<ReturnType<typeof preparePendingCompositeOwnership>>}){
 if(!sha(input.workerSha)||!sha(input.requestNonce,32)||!sha(input.registrySha256,64))fail("WITNESS_REQUEST_BINDING");
 await input.composite.verifyUnchanged();const inventory=pendingInventorySnapshot(input.positions,input.orders),runtimes:Row[]=[];
 for(const runner of [...new Set(input.composite.owners.map(o=>String(o.runner)))])runtimes.push(await observePendingOwnerRuntime(runner,input.composite.runnerShaMap[runner]));
 await input.composite.verifyUnchanged();const lease=await input.lease.document(),now=Date.now(),first=Math.min(...Object.values(input.signedObservedAt));
 if(Object.values(input.signedObservedAt).some(t=>!time(t)||t>now)||now-first>120000||!time(lease.acquiredAt)||lease.acquiredAt>first||!time(lease.expiresAt)||lease.expiresAt<=now||lease.accountScope!=="ASTER_FUTURES"||lease.ownerId!=="PENDING_READONLY_WITNESS")fail("WITNESS_LEASE_OR_SOURCE_STALE");
 const proof:Row={schema:"disdex-composite-owner-witness/v1",workerSha:input.workerSha,requestNonce:input.requestNonce,accountScope:"ASTER_FUTURES",signedObservedAt:input.signedObservedAt,verifiedAt:now,expiresAt:Math.min(first+120000,lease.expiresAt),inventory,inventorySha256:pendingCanonicalDigest(inventory),runnerShaMap:input.composite.runnerShaMap,cas:{pinManifestSha256:input.composite.pinManifestSha256,registryBeforeSha256:input.registrySha256,registryAfterSha256:input.registrySha256,ownerFilesBefore:input.composite.sourceFiles,ownerFilesAfter:input.composite.sourceFiles},lease:{ownerId:lease.ownerId,leaseId:lease.leaseId,acquiredAt:lease.acquiredAt,checkedAt:now,expiresAt:lease.expiresAt},owners:input.composite.owners,runtimes,effects:{ordersSent:0,cancelsSent:0,positionChangesSent:0,registryWrites:0}};
 return{...proof,proofSha256:pendingCanonicalDigest(proof)};
}
