/**
 * Durable V4 order intent journal. This module grants no order authority.
 * Callers must hold the shared account lock before reserving or sending orders.
 * A persisted SUBMITTING/UNKNOWN intent is reconciled by the same client ID,
 * never changed back to PREPARED after an ambiguous venue response.
 */
import {createHash,randomUUID} from "node:crypto";
import {openSync,closeSync,fsyncSync,writeFileSync,readFileSync,renameSync,lstatSync,mkdirSync,unlinkSync} from "node:fs";
import {dirname} from "node:path";
import {createProductionState,replayProductionJournal,applyProductionEvent,type InitialState,type State,type Event} from "./v12-v4-production-lifecycle";
export type V4OrderAction="ENTRY"|"EXIT"|"STOP"|"TAKE_PROFIT";
export type V4IntentStage="PREPARED"|"SUBMITTING"|"UNKNOWN"|"ACKNOWLEDGED"|"TERMINAL";
export type V4OrderIntent={
 clientOrderId:string;legId:string;action:V4OrderAction;sequence:number;stage:V4IntentStage;
 createdAt:number;updatedAt:number;command?:unknown;venueOrderId?:string;sharedReservationId?:string;
};
export type V4ExecutionDocument={
 schema:1;releaseSha:string;revision:number;state:State;intents:Record<string,V4OrderIntent>;
};
export function v4OrderIdentity(releaseSha:string,legId:string,action:V4OrderAction,sequence:number):string{
 if(!/^[a-f0-9]{40}$/.test(releaseSha)||!legId||!["ENTRY","EXIT","STOP","TAKE_PROFIT"].includes(action)||!Number.isInteger(sequence)||sequence<0)throw Error("INVALID_ORDER_IDENTITY");
 return "v12-v4-"+createHash("sha256").update(JSON.stringify([releaseSha,legId,action,sequence])).digest("hex").slice(0,28);
}
const transitions:Record<V4IntentStage,V4IntentStage[]>={
 PREPARED:["SUBMITTING"],SUBMITTING:["UNKNOWN","ACKNOWLEDGED","TERMINAL"],
 UNKNOWN:["ACKNOWLEDGED","TERMINAL"],ACKNOWLEDGED:["UNKNOWN","TERMINAL"],TERMINAL:[],
};
export function advanceV4Intent(doc:V4ExecutionDocument,cid:string,stage:V4IntentStage,ts:number):V4ExecutionDocument{
 const intent=doc.intents[cid];
 if(!intent||!Number.isFinite(ts)||ts<intent.updatedAt||!transitions[intent.stage].includes(stage))throw Error("INVALID_INTENT_TRANSITION");
 const next=structuredClone(doc);next.intents[cid]={...intent,stage,updatedAt:ts};return next;
}
export function appendV4ExecutionEvent(doc:V4ExecutionDocument,event:Event):V4ExecutionDocument{
 return {...structuredClone(doc),state:applyProductionEvent(doc.state,event)};
}
function assertRegular(path:string){
 const st=lstatSync(path);if(st.isSymbolicLink()||!st.isFile())throw Error("UNSAFE_EXECUTION_FILE");
}
function validate(doc:V4ExecutionDocument,sha:string){
 if(doc.schema!==1||doc.releaseSha!==sha)throw Error("EXECUTION_RELEASE_MISMATCH");
 if(!Number.isInteger(doc.revision)||doc.revision<0||!doc.state||!doc.intents||Array.isArray(doc.intents))throw Error("INVALID_EXECUTION_DOCUMENT");
 const replay=replayProductionJournal(doc.state.initial,doc.state.journal);
 if(JSON.stringify(replay)!==JSON.stringify(doc.state))throw Error("SNAPSHOT_JOURNAL_MISMATCH");
 for(const [cid,x]of Object.entries(doc.intents)){
  if(cid!==x.clientOrderId||cid!==v4OrderIdentity(sha,x.legId,x.action,x.sequence)||!transitions[x.stage]||
    !Number.isFinite(x.createdAt)||!Number.isFinite(x.updatedAt)||x.updatedAt<x.createdAt)throw Error("INVALID_PERSISTED_INTENT");
 }
}
/** Local writer lock is exclusive and never forcibly cleared after a crash. */
export class V4ExecutionStore{
 constructor(readonly path:string,readonly releaseSha:string){
  if(!/^[a-f0-9]{40}$/.test(releaseSha))throw Error("INVALID_RELEASE_SHA");
 }
 read():V4ExecutionDocument{
  assertRegular(this.path);const doc=JSON.parse(readFileSync(this.path,"utf8")) as V4ExecutionDocument;
  validate(doc,this.releaseSha);return doc;
 }
 initialize(initial:InitialState):V4ExecutionDocument{
  mkdirSync(dirname(this.path),{recursive:true});
  const guard=openSync(this.path+".writer","wx",0o600);
  try{
   try{const existing=this.read();return existing;}catch(e:any){if(e.code!=="ENOENT")throw e;}
   const doc:V4ExecutionDocument={schema:1,releaseSha:this.releaseSha,revision:0,state:createProductionState(initial),intents:{}};
   this.persist(doc);return doc;
  }finally{closeSync(guard);unlinkSync(this.path+".writer");}
 }
 commit(expectedRevision:number,proposed:V4ExecutionDocument):V4ExecutionDocument{
  const guard=openSync(this.path+".writer","wx",0o600);
  try{
   const current=this.read();
   if(current.revision!==expectedRevision||proposed.revision!==expectedRevision)throw Error("STALE_EXECUTION_REVISION");
   if(JSON.stringify(current.state.initial)!==JSON.stringify(proposed.state.initial))throw Error("INITIAL_STATE_MUTATION");
   if(JSON.stringify(proposed.state.journal.slice(0,current.state.journal.length))!==JSON.stringify(current.state.journal))throw Error("JOURNAL_HISTORY_MUTATION");
   for(const [cid,prior]of Object.entries(current.intents)){
    const next=proposed.intents[cid];
    if(!next||next.legId!==prior.legId||next.action!==prior.action||next.sequence!==prior.sequence||next.createdAt!==prior.createdAt||JSON.stringify(next.command)!==JSON.stringify(prior.command)||next.updatedAt<prior.updatedAt||
      (next.stage!==prior.stage&&!transitions[prior.stage].includes(next.stage)))throw Error("INTENT_HISTORY_MUTATION");
   }
   for(const [cid,intent]of Object.entries(proposed.intents)){if(!current.intents[cid]&&intent.stage!=="PREPARED")throw Error("NEW_INTENT_MUST_BE_PREPARED");}
   const doc={...structuredClone(proposed),revision:expectedRevision+1};
   validate(doc,this.releaseSha);this.persist(doc);return doc;
  }finally{closeSync(guard);unlinkSync(this.path+".writer");}
 }
 private persist(doc:V4ExecutionDocument){
  const temp=this.path+"."+randomUUID()+".tmp";
  const fd=openSync(temp,"wx",0o600);
  try{writeFileSync(fd,JSON.stringify(doc)+"\n","utf8");fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temp,this.path);
  if(process.platform!=="win32"){
   const directory=openSync(dirname(this.path),"r");
   try{fsyncSync(directory);}finally{closeSync(directory);}
  }
 }
}
