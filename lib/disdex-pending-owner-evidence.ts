import {constants} from 'node:fs';
import {lstat,open,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {resolveResidentStopOwnerPins,v4ProofsFromIndependentEvidence,q102ProofsFromIndependentEvidence,observeResidentProtection} from './resident-stop-observation';
import type {ResidentStopOwnerPins} from './resident-stop-observation';
import type {validateOwnedPendingVenue} from './disdex-pending-owned-venue';

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
 Q102_STATE:'/var/lib/disdex/quality102-causal-v1/state.json',
 Q102_HEARTBEAT:'/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json',
 V52_STATE:'/var/lib/disdex/v52-aster-only/runner-live.json',
 MARGIN:'/var/lib/disdex/shared/margin-risk/guard-live.json',
};
function hash(raw:string){return createHash('sha256').update(raw).digest('hex');}

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
 const v4Proofs=v4ProofsFromIndependentEvidence(orders,records.V4_LEDGER.value,records.V4_HEARTBEAT.value,
   records.V4_MARKER.raw??'',now,manifest.pins.V12);
 const q102Proofs=q102ProofsFromIndependentEvidence(orders,records.Q102_STATE.value,records.Q102_HEARTBEAT.value,
   records.Q102_MARKER.raw??'',now,manifest.pins.Q102);
 const input={positions,orders,states,runtimeSha,ownerPins:manifest.pins as ResidentStopOwnerPins,now,
  v4Proofs,q102Proofs,v52State:records.V52_STATE.value,margin:records.MARGIN.value};
 const observation=observeResidentProtection(positions,orders,states,runtimeSha,now,v4Proofs,q102Proofs,manifest.pins);
 const required=new Set<string>();
 for(const row of observation.positions){
  if(row.strategy==='V12_V4')for(const key of ['V4_LEDGER','V4_HEARTBEAT','V4_MARKER'])required.add(key);
  else if(row.strategy==='Q102')for(const key of ['Q102_STATE','Q102_HEARTBEAT','Q102_MARKER'])required.add(key);
  else if(row.strategy==='V52')for(const key of ['V52_STATE','MARGIN'])required.add(key);
  else if(Object.hasOwn(records,row.strategy))required.add(row.strategy);
 }
 return {input,verifyUnchanged:async()=>{
  const current=await canonicalManifest();
  if(hash(current.raw)!==hash(manifest.raw))throw Error('PENDING_OWNER_PIN_CHANGED_DURING_PROOF');
  for(const key of required){
   const record=records[key];
   if(record.raw===undefined||hash(await readFile(record.path,'utf8'))!==hash(record.raw)){
    throw Error('PENDING_OWNER_STATE_CHANGED_DURING_PROOF');
   }
  }
 }};
}
