import {lstat,readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {observeV4PeerService,observeCurrentV4PeerService,parseV4SystemdShow} from "./v12-v4-peer-service-attestation";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {buildStable4ActiveEntryOwners} from "./stable4-active-entry-owners";
import type {V4PeerKind,V4PeerSource} from "./v12-v4-peer-state-owners";
import type {Stable4EntryOpportunityRecord} from "./stable4-entry-opportunity-book";
import {Stable4EntryOpportunityStore} from "./stable4-entry-opportunity-store";
import type {V4ExecutionDocument} from "./v12-v4-execution-store";

const exec=promisify(execFile);
const DEFAULT_PATHS:Record<V4PeerKind,string>={V12:"/var/lib/disdex/v12-x1-all/runner.json",PENGU:"/var/lib/disdex/pengu-dual-ls-v2/runner-live.json",Q102:"/var/lib/disdex/quality102-causal-v1/state.json",V52:"/var/lib/disdex/v52-aster-only/runner-live.json",FET:"/var/lib/disdex/fet-brk48-residual/state.json",HYPE_LONG:"/var/lib/disdex/hype-zec-long/runner.json",IDLE:"/var/lib/disdex/idle-priority/state.json",RESIDUAL:"/var/lib/disdex/idle-priority/residual-long-state.json"};

/** Only the current process's exact definitely-unsent Q102 candidate may be
 * removed from the peer admission view. Other pending work still blocks UNI.
 */
export function stable4UniPeerAdmissionView(sources:V4PeerSource[],candidate?:Stable4EntryOpportunityRecord,clientOrderId?:string):V4PeerSource[]{
 if(!candidate&&!clientOrderId)return sources;
 if(!candidate||!clientOrderId)throw Error("STABLE4_UNI_OWN_PENDING_IDENTITY_MISSING");
 return sources.map(source=>{
  if(source.kind!=="Q102")return source;
  const raw=source.raw,p=raw.pending;
  if(raw.position||raw.manualReview||raw.manualReviewReason||!p||p.reduceOnly!==false||p.phase!=="submitted"||p.symbol!=="UNIUSDT"||p.side!=="SELL"||p.clientOrderId!==clientOrderId||p.idempotencyKey!==candidate.positionId||p.referenceTs!==candidate.entryTs||!(typeof p.quantity==="number"&&Number.isFinite(p.quantity)&&p.quantity>0)||p.lastError||source.programSha!==candidate.sourceSha||!p.reason?.split(":").includes("STABLE4_Q102_UNI_ONLINE_RECOVERY")||JSON.stringify(p.entryOpportunity)!==JSON.stringify(candidate))throw Error("STABLE4_UNI_OWN_PENDING_CONFLICT");
  return{...source,raw:{...raw,pending:undefined}};
 });
}

async function snapshot(path:string,rootOwned=false){
 const before=await lstat(path);
 if(!before.isFile()||before.isSymbolicLink()||rootOwned&&(before.uid!==0||(before.mode&0o022)!==0))throw Error("STABLE4_OWNER_UNSAFE_FILE");
 const bytes=await readFile(path),after=await lstat(path);
 if(before.ino!==after.ino||before.dev!==after.dev||before.mtimeMs!==after.mtimeMs||before.size!==after.size)throw Error("STABLE4_OWNER_FILE_CHANGED");
 return{bytes,verify:async()=>{const current=await lstat(path);if(!current.isFile()||current.isSymbolicLink()||current.ino!==after.ino||current.dev!==after.dev||!(await readFile(path)).equals(bytes))throw Error("STABLE4_OWNER_FILE_CHANGED");}};
}

/** Read-only actual native ownership, root-pinned V4 replay and signed systemd
 * identity. Must be called while the trading caller holds its real account lease.
 */
export function createStable4UniOwnerEvidenceReader(env:NodeJS.ProcessEnv=process.env){
 const paths=env.V12_V4_PEER_STATE_PATHS_JSON?JSON.parse(env.V12_V4_PEER_STATE_PATHS_JSON) as Record<V4PeerKind,string>:DEFAULT_PATHS;
 const store=new Stable4EntryOpportunityStore(resolve(env.DISDEX_STABLE4_ENTRY_OPPORTUNITY_BOOK_PATH||"/var/lib/disdex/shared/stable4-entry-opportunity-book.json"));
 return async(candidate?:Stable4EntryOpportunityRecord,clientOrderId?:string)=>{
  const manifest=await snapshot("/etc/disdex/runner-pins.json",true),pins=JSON.parse(manifest.bytes.toString("utf8"));
  if(pins.schema!=="disdex-runner-pin-manifest/v1")throw Error("STABLE4_OWNER_PIN_SCHEMA_INVALID");
  const pin=pins.runners?.V12_V4,sha=pin?.sha,root="/home/deploy/disdex-trading/releases/"+sha;
  if(!/^[a-f0-9]{40}$/.test(sha)||pin.releaseRoot!==root||pin.serviceUnit!=="disdex-v12-v4@"+sha+".service")throw Error("STABLE4_OWNER_V4_PIN_INVALID");
  const modulePath=root+"/lib/v12-v4-execution-store.ts";
  await snapshot(modulePath,true);
  const executionPath="/var/lib/disdex/v12-v4/orders.json",execution=await snapshot(executionPath);
  // Import the immutable module belonging to the actual running V4 source.
  const module=await import(pathToFileURL(modulePath).href) as {V4ExecutionStore:new(path:string,sha:string)=>{read():V4ExecutionDocument}};
  const document=new module.V4ExecutionStore(executionPath,sha).read();
  const files:Awaited<ReturnType<typeof snapshot>>[]=[];
  const sources=await Promise.all((Object.keys(DEFAULT_PATHS) as V4PeerKind[]).map(async kind=>{
   const path=paths[kind];if(typeof path!=="string"||!path.startsWith("/var/lib/disdex/")||resolve(path)!==path)throw Error("STABLE4_OWNER_PATH_INVALID");
   const file=await snapshot(path);files.push(file);const raw=JSON.parse(file.bytes.toString("utf8"));
   let programSha=String(raw.runtimeCommitSha??raw.runtimeSha??"").toLowerCase(),programShaSource:"STATE"|"SYSTEMD"="STATE",service;
   if(kind==="V52"&&raw.mode==="DISABLED"&&raw.ordersAllowed===false&&raw.newOrdersAllowed===false&&raw.positions&&Object.keys(raw.positions).length===0){
    service={unit:"disdex-v52-aster-only@"+programSha+".service",active:false,retiredV12:false,disabled:true,observedAt:Date.now(),mainPid:0};
   }else if(kind!=="V12"&&!/^[a-f0-9]{40}$/.test(programSha)){
    const current=await observeCurrentV4PeerService(kind);programSha=current.sha;service=current.service;programShaSource="SYSTEMD";
   }else service=await observeV4PeerService(kind,programSha);
   return{kind,programSha,programShaSource,raw,service};
  }));
  const {stdout}=await exec("systemctl",["show",pin.serviceUnit,"--no-pager","--property=Id,ActiveState,SubState,MainPID,WorkingDirectory,ExecStart"],{timeout:5000});
  parseV4SystemdShow(stdout,pin.serviceUnit,Date.now());
  const book=await store.read();
  await Promise.all([manifest.verify(),execution.verify(),...files.map(f=>f.verify())]);
  const now=Date.now(),owners=buildStable4ActiveEntryOwners({now,observedAt:now,peerSources:stable4UniPeerAdmissionView(sources,candidate,clientOrderId),expectedPeerSha:sha,v4:{releaseSha:sha,document},book});
  return{book,owners:{complete:owners.complete,observedAt:owners.observedAt,positions:owners.positions}};
 };
}
