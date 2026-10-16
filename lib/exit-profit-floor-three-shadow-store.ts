/**
 * Isolated, append-compatible three-floor SHADOW sidecar.
 *
 * This file is deliberately NOT the Q102 trading state nor V4 order-event
 * ledger. The old LIVE runtimes can roll back without parsing new fields/events.
 * Contains NO credentials or order authority.
 *
 * Caller must hold the existing account/runner lock while saving.
 */
import {randomUUID} from "node:crypto";
import {open,readFile,rename,mkdir,lstat,unlink} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {
 type ExitFloorH1State,type ExitFloorOwner,EXIT_FLOOR_HOUR_MS,
} from "./exit-profit-floor-three";
import {validateThreeExitFloorShadowState} from "./exit-profit-floor-three-observers";

type SidecarDocument={
 schema:"three-exit-profit-floor-shadow/v1";
 owner:ExitFloorOwner;
 byLegId:Record<string,ExitFloorH1State>;
};
const SCHEMA="three-exit-profit-floor-shadow/v1" as const;
function ownedDocument(owner:ExitFloorOwner):SidecarDocument{
 return {schema:SCHEMA,owner,byLegId:{}};
}
function validateDoc(value:unknown,owner:ExitFloorOwner):SidecarDocument{
 if(!value||typeof value!=="object"||Array.isArray(value))
  throw Error("THREE_EXIT_SHADOW_SIDECAR_CORRUPT");
 const doc=value as SidecarDocument;
 if(doc.schema!==SCHEMA||doc.owner!==owner||
    !doc.byLegId||Array.isArray(doc.byLegId)||typeof doc.byLegId!=="object"||
    Object.keys(doc).some(k=>!["schema","owner","byLegId"].includes(k)))
  throw Error("THREE_EXIT_SHADOW_SIDECAR_SCHEMA_MISMATCH");
 for(const [key,raw] of Object.entries(doc.byLegId)){
  const state=validateThreeExitFloorShadowState(raw);
  if(key!==state.legId||state.owner!==owner)
   throw Error("THREE_EXIT_SHADOW_SIDECAR_OWNER_MISMATCH");
 }
 return doc;
}
const isNotFound=(e:unknown)=>(e as NodeJS.ErrnoException)?.code==="ENOENT";
export class FileThreeExitFloorShadowStore {
 readonly path:string;
 constructor(path:string,readonly owner:ExitFloorOwner){
  if(!path||!["Q102","V12_V4"].includes(owner))
   throw Error("THREE_EXIT_SHADOW_SIDECAR_BAD_PATH_OR_OWNER");
  this.path=resolve(path);
 }
 private async readDoc():Promise<SidecarDocument>{
  try{
   const info=await lstat(this.path);
   if(!info.isFile()||info.isSymbolicLink())
    throw Error("THREE_EXIT_SHADOW_SIDECAR_UNSAFE_FILE");
   return validateDoc(JSON.parse(await readFile(this.path,"utf8")),this.owner);
  }catch(error){
   if(isNotFound(error))return ownedDocument(this.owner);
   throw error;
  }
 }
 async load(legId:string):Promise<ExitFloorH1State|undefined>{
  if(!legId)throw Error("THREE_EXIT_SHADOW_SIDECAR_LEG_ID_REQUIRED");
  const doc=await this.readDoc();
  return doc.byLegId[legId];
 }
 async save(next:ExitFloorH1State):Promise<void>{
  const state=validateThreeExitFloorShadowState(next);
  if(state.owner!==this.owner)
   throw Error("THREE_EXIT_SHADOW_SIDECAR_OWNER_MISMATCH");
  const doc=await this.readDoc();
  const prior=doc.byLegId[state.legId];
  if(prior){
   if(prior.policyId!==state.policyId||prior.symbol!==state.symbol||
      prior.owner!==state.owner||prior.entryTs!==state.entryTs||
      prior.entryPrice!==state.entryPrice||prior.side!==state.side||
      prior.securedReturn!==state.securedReturn||
      prior.lastClosedH1OpenTs>state.lastClosedH1OpenTs||
      prior.highWaterCloseReturn>state.highWaterCloseReturn+1e-12||
      (prior.armed&&!state.armed)||
      (prior.effectiveFromTs!==undefined&&state.effectiveFromTs!==prior.effectiveFromTs))
    throw Error("THREE_EXIT_SHADOW_SIDECAR_STATE_REGRESSION");
   if(prior.lastClosedH1OpenTs===state.lastClosedH1OpenTs &&
      JSON.stringify(prior)===JSON.stringify(state))return;
   if(state.lastClosedH1OpenTs!==prior.lastClosedH1OpenTs+EXIT_FLOOR_HOUR_MS)
    throw Error("THREE_EXIT_SHADOW_SIDECAR_H1_GAP");
  }
  const nextDoc:SidecarDocument={...doc,byLegId:{...doc.byLegId,[state.legId]:state}};
  await mkdir(dirname(this.path),{recursive:true,mode:0o700});
  const temp=this.path+"."+randomUUID()+".tmp";
  let created=false;
  try{
   const fd=await open(temp,"wx",0o600);
   created=true;
   try{await fd.writeFile(JSON.stringify(nextDoc)+"\n","utf8");await fd.sync();}
   finally{await fd.close();}
   await rename(temp,this.path);
   created=false;
  }finally{if(created)await unlink(temp).catch(()=>undefined);}
 }
}
