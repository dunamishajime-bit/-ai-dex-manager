import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {lstat,open,readFile,readlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {promisify} from 'node:util';
import {resolveResidentStopOwnerPins,v4ProofsFromIndependentEvidence,v4ProofsFromBoundLedger,q102ProofsFromIndependentEvidence,observeResidentProtection} from './resident-stop-observation';
import type {ResidentStopOwnerPins} from './resident-stop-observation';
import type {validateOwnedPendingVenue} from './disdex-pending-owned-venue';
import {parseV4SystemdShow} from './v12-v4-peer-service-attestation';

type Row=Record<string,any>;
const MANIFEST='/etc/disdex/runner-pins.json';
const PATHS:Record<string,string>={
 PENGU:'/var/lib/disdex/pengu-dual-ls-v2/runner-live.json',
 FET:'/var/lib/disdex/fet-brk48-residual/state.json',
 HYPE:'/var/lib/disdex/hype-zec-long/runner.json',
 IDLE:'/var/lib/disdex/idle-priority/state.json',
 RESIDUAL:'/var/lib/disdex/idle-priority/residual-long-state.json',
 V4_LEDGER:'/var/lib/disdex/v12-v4/orders.json',
 V4_HEARTBEAT:'/var/lib/disdex/runner-health/heartbeats/v12-v4.json',
 V4_RUNNER_HEARTBEAT:'/var/lib/disdex/v12-v4/heartbeat.json',
 Q102_STATE:'/var/lib/disdex/quality102-causal-v1/state.json',
 Q102_HEARTBEAT:'/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json',
 V52_STATE:'/var/lib/disdex/v52-aster-only/runner-live.json',
 MARGIN:'/var/lib/disdex/shared/margin-risk/guard-live.json',
};
function hash(raw:string){return createHash('sha256').update(raw).digest('hex');}
const exec=promisify(execFile);
type V4Runtime={unit:string;pid:number;cwd:string};

/** A peer's entry block does not release or reassign a verified resident STOP. */
export function pendingV4OwnerProofs(
 orders:Row[],ledger:Row|undefined,heartbeat:Row|undefined,marker:string,now:number,sha:string,runtime:V4Runtime,
){
 const unit=`disdex-v12-v4@${sha}.service`,cwd=`/home/deploy/disdex-trading/releases/${sha}`;
 const peerUnavailable=/^V4_PEER_ATTESTATION_RETRY_REQUIRED:V4_PEER_UNIT_NOT_RUNNING_OR_WRONG_SHA:disdex-(?:pengu-dual-ls-v2|hype-long|idle-priority-short|quality102-causal-v1|v52-aster-only|fet-brk48)@[a-f0-9]{40}\.service$/;
 if(!/^[a-f0-9]{40}$/.test(sha)||runtime.unit!==unit||runtime.cwd!==cwd||!Number.isSafeInteger(runtime.pid)||runtime.pid<1||
   heartbeat?.schema!=='disdex-v12-v4-runner-heartbeat/v1'||heartbeat.releaseSha!==sha||
   heartbeat.runtimeSha!==sha||heartbeat.expectedSha!==sha||heartbeat.serviceUnit!==unit||
   heartbeat.workingDirectory!==cwd||heartbeat.mainPid!==runtime.pid||heartbeat.mode!=='LIVE'||
   heartbeat.operationMode!=='CERTIFIED'||heartbeat.liveEnabled!==true||heartbeat.limitedLive!==false||
   heartbeat.orderEnabled!==false||heartbeat.safetyState!=='BLOCKED'||!peerUnavailable.test(heartbeat.reason)||
   !Number.isSafeInteger(heartbeat.heartbeatAt)||heartbeat.heartbeatAt>now||now-heartbeat.heartbeatAt>180000||
   ledger?.schema!==2||ledger.state?.initial?.holdProtected!==false||ledger.state?.executionReview!=null)
  return [];
 return pendingV4DurableStopProofs(orders,ledger,marker,sha);
}

/**
 * Proves ownership from the immutable pinned release marker, the V4 durable ledger,
 * and the signed venue STOP read-back. This is liveness-independent and grants no
 * trading permission; it exists only so read-only pending reconciliation cannot
 * deadlock when the V4 process is fully stopped.
 */
export function pendingV4DurableStopProofs(
 orders:Row[],ledger:Row|undefined,marker:string,sha:string,
){
 if(!/^[a-f0-9]{40}$/.test(sha)||ledger?.schema!==2||ledger.releaseSha!==sha||
   ledger.state?.initial?.holdProtected!==false||ledger.state?.executionReview!=null)
  return [];
 return v4ProofsFromBoundLedger(orders,ledger,marker,sha).filter(proof=>{
  const intent=ledger.intents?.[proof.stopClientOrderId];
  const leg=ledger.state?.legs?.[intent?.legId];
  const protection=ledger.protections?.[intent?.legId];
  const order=orders.find(row=>row.clientOrderId===proof.stopClientOrderId);
  return intent?.action==='STOP'&&intent.stage==='ACKNOWLEDGED'&&leg?.status==='OPEN'&&
   Number(leg.qty)===proof.quantity&&protection?.phase==='STOP_CONFIRMED'&&
   Number(protection?.protectedQty)===proof.quantity&&
   protection?.stopClientOrderId===proof.stopClientOrderId&&
   order?.status==='NEW'&&order?.reduceOnly===true&&Number(order.executedQty)===0;
 });
}

async function observeV4Runtime(sha:string):Promise<V4Runtime>{
 const unit=`disdex-v12-v4@${sha}.service`,cwd=`/home/deploy/disdex-trading/releases/${sha}`;
 const {stdout}=await exec('/usr/bin/systemctl',['show',unit,'--no-pager',
  '--property=Id,ActiveState,SubState,MainPID,WorkingDirectory,ExecStart'],{timeout:5000});
 const {mainPid:pid}=parseV4SystemdShow(stdout,unit,Date.now());
 const proc=`/proc/${pid}`;
 const [dir,command,identity,mark]=await Promise.all([readlink(proc+'/cwd'),readFile(proc+'/cmdline','utf8'),
  lstat(proc),lstat(cwd+'/.disdex-release-sha')]);
 const expected=['/usr/bin/node','--import',cwd+'/node_modules/tsx/dist/loader.mjs',
  cwd+'/scripts/v12-v4-production-runner.ts','--daemon'];
 if(dir!==cwd||identity.uid!==process.getuid?.()||!mark.isFile()||mark.isSymbolicLink()||
   mark.uid!==0||(mark.mode&0o222)!==0||command!==expected.join('\0')+'\0')
  throw Error('PENDING_OWNER_V4_RUNTIME_UNVERIFIED');
 return {unit,pid,cwd};
}

export function validatePendingPinMetadata(input:{uid:number;mode:number;regular:boolean;symlink:boolean;
 parentUid:number;parentMode:number;parentDirectory:boolean;parentSymlink:boolean}):void {
 if(input.uid!==0||!input.regular||input.symlink||(input.mode&0o022)!==0
   ||input.parentUid!==0||!input.parentDirectory||input.parentSymlink||(input.parentMode&0o022)!==0){
  throw Error('PENDING_OWNER_PIN_FILE_UNTRUSTED');
 }
}

async function canonicalManifest(){
 const target=await lstat(MANIFEST),parent=await lstat(dirname(MANIFEST));
 const fd=await open(MANIFEST,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const actual=await fd.stat();
  validatePendingPinMetadata({uid:actual.uid,mode:actual.mode,regular:actual.isFile(),symlink:target.isSymbolicLink(),
   parentUid:parent.uid,parentMode:parent.mode,parentDirectory:parent.isDirectory(),parentSymlink:parent.isSymbolicLink()});
  if(actual.ino!==target.ino||actual.dev!==target.dev)throw Error('PENDING_OWNER_PIN_REPLACED');
  const raw=await fd.readFile('utf8'),manifest=JSON.parse(raw);
  if(manifest.target!=='professional-dismanager.net')throw Error('PENDING_OWNER_PIN_TARGET_MISMATCH');
  return {raw,pins:resolveResidentStopOwnerPins(manifest)};
 }finally{await fd.close();}
}

export type PendingOwnerEvidence={input:Parameters<typeof validateOwnedPendingVenue>[0];verifyUnchanged:()=>Promise<void>};

/** Reads no private credentials and never writes the shared observer/state. */
export async function collectPendingOwnerEvidence(positions:Row[],orders:Row[],runtimeSha:string):Promise<PendingOwnerEvidence>{
 const manifest=await canonicalManifest();
 const paths={...PATHS,
  V4_MARKER:`/home/deploy/disdex-trading/releases/${manifest.pins.V12}/.disdex-release-sha`,
  Q102_MARKER:`/home/deploy/disdex-trading/releases/${manifest.pins.Q102}/.disdex-release-sha`};
 const records:Record<string,{path:string;raw?:string;value?:Row}>={};
 await Promise.all(Object.entries(paths).map(async([key,path])=>{
  try{
   const st=await lstat(path);
   if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o002)!==0)throw Error('not trusted state');
   const raw=await readFile(path,'utf8');
   records[key]={path,raw,value:key.endsWith('_MARKER')?undefined:JSON.parse(raw)};
  }catch{records[key]={path};}
 }));
 const now=Date.now();
 const states=Object.fromEntries(['PENGU','FET','HYPE','IDLE','RESIDUAL'].map(key=>[key,records[key].value??{}]));
 let v4Proofs=v4ProofsFromIndependentEvidence(orders,records.V4_LEDGER.value,records.V4_HEARTBEAT.value,
   records.V4_MARKER.raw??'',now,manifest.pins.V12);
 let v4ProofSource:'NONE'|'INDEPENDENT_HEARTBEAT'|'DURABLE_LEDGER'|'RUNNING_BLOCKED_RUNTIME'=
  v4Proofs.length>0?'INDEPENDENT_HEARTBEAT':'NONE';
 let v4Runtime:V4Runtime|undefined;
 if(v4Proofs.length===0&&orders.some(order=>/^v12-v4-[a-f0-9]{28}$/.test(order.clientOrderId??''))){
  v4Proofs=pendingV4DurableStopProofs(orders,records.V4_LEDGER.value,records.V4_MARKER.raw??'',manifest.pins.V12);
  if(v4Proofs.length>0){
   v4ProofSource='DURABLE_LEDGER';
  }else{
   const runtime=await observeV4Runtime(manifest.pins.V12);
   v4Proofs=pendingV4OwnerProofs(orders,records.V4_LEDGER.value,records.V4_RUNNER_HEARTBEAT.value,
    records.V4_MARKER.raw??'',Date.now(),manifest.pins.V12,runtime);
   if(v4Proofs.length>0){v4Runtime=runtime;v4ProofSource='RUNNING_BLOCKED_RUNTIME';}
  }
 }
 const q102Proofs=q102ProofsFromIndependentEvidence(orders,records.Q102_STATE.value,records.Q102_HEARTBEAT.value,
   records.Q102_MARKER.raw??'',now,manifest.pins.Q102);
 const input={positions,orders,states,runtimeSha,ownerPins:manifest.pins as ResidentStopOwnerPins,now,
  v4Proofs,q102Proofs,v52State:records.V52_STATE.value,margin:records.MARGIN.value};
 const observation=observeResidentProtection(positions,orders,states,runtimeSha,now,v4Proofs,q102Proofs,manifest.pins);
 const required=new Set<string>();
 for(const row of observation.positions){
  if(row.strategy==='V12_V4'){
   required.add('V4_LEDGER');required.add('V4_MARKER');
   if(v4ProofSource==='INDEPENDENT_HEARTBEAT')required.add('V4_HEARTBEAT');
   else if(v4ProofSource==='RUNNING_BLOCKED_RUNTIME')required.add('V4_RUNNER_HEARTBEAT');
  }
  else if(row.strategy==='Q102')for(const key of ['Q102_STATE','Q102_HEARTBEAT','Q102_MARKER'])required.add(key);
  else if(row.strategy==='V52')for(const key of ['V52_STATE','MARGIN'])required.add(key);
  else if(Object.hasOwn(records,row.strategy))required.add(row.strategy);
 }
 return {input,verifyUnchanged:async()=>{
  const current=await canonicalManifest();
  if(hash(current.raw)!==hash(manifest.raw))throw Error('PENDING_OWNER_PIN_CHANGED_DURING_PROOF');
  if(v4Runtime){
   const observed=await observeV4Runtime(manifest.pins.V12);
   if(observed.pid!==v4Runtime.pid)throw Error('PENDING_OWNER_V4_RUNTIME_CHANGED_DURING_PROOF');
  }
  for(const key of required){
   const record=records[key];
   if(record.raw===undefined||hash(await readFile(record.path,'utf8'))!==hash(record.raw)){
    throw Error('PENDING_OWNER_STATE_CHANGED_DURING_PROOF');
   }
  }
 }};
}
