import type { Replay } from "./replay";
const DB_NAME="disdex-bt-replay-library";
const STORE="runs";
export type SavedRun = {id:string;name:string;createdAt:string;frames:number;mode:string};
type StoredRun=SavedRun & {data:Replay};
function openDatabase():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>{
    const db=req.result;
    if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:"id"});
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
}
async function execute<T>(mode:IDBTransactionMode, action:(store:IDBObjectStore,resolve:(v:T)=>void,reject:(e:unknown)=>void)=>void):Promise<T>{
 const db=await openDatabase();
 return new Promise<T>((resolve,reject)=>{
  const tx=db.transaction(STORE,mode);
  const store=tx.objectStore(STORE);
  let settled=false;
  let seen=false;
  let value:T|undefined;
  // A request may succeed before the transaction commits. Only announce
  // saved/reloaded status after transaction completion.
  const ok=(v:T)=>{value=v;seen=true};
  const fail=(err:unknown)=>{if(!settled){settled=true;db.close();reject(err)}};
  tx.onabort=()=>fail(tx.error??new Error("IndexedDB transaction aborted"));
  tx.onerror=()=>fail(tx.error??new Error("IndexedDB transaction error"));
  tx.oncomplete=()=>{
    if(settled)return;
    settled=true;db.close();
    if(seen)resolve(value as T);
    else reject(new Error("IndexedDB request was not completed"));
  };
  try{action(store,ok,fail)}catch(e){try{tx.abort()}catch{}fail(e)}
 });
}
export async function saveRun(name:string,data:Replay):Promise<SavedRun>{
 const item:StoredRun={id:crypto.randomUUID(),name:name.trim().slice(0,120)||"BT replay",createdAt:new Date().toISOString(),frames:data.frames.length,mode:data.mode,data};
 return execute("readwrite",(store,resolve,reject)=>{
  const r=store.put(item);
  r.onsuccess=()=>resolve({id:item.id,name:item.name,createdAt:item.createdAt,frames:item.frames,mode:item.mode});
  r.onerror=()=>reject(r.error);
 });
}
export async function listRuns():Promise<SavedRun[]>{
 return execute("readonly",(store,resolve,reject)=>{
  const r=store.getAll();
  r.onsuccess=()=>resolve((r.result as StoredRun[]).map(({id,name,createdAt,frames,mode})=>({id,name,createdAt,frames,mode})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
  r.onerror=()=>reject(r.error);
 });
}
export async function readRun(id:string):Promise<Replay|null>{
 return execute("readonly",(store,resolve,reject)=>{
  const r=store.get(id);
  r.onsuccess=()=>resolve((r.result as StoredRun|undefined)?.data ?? null);
  r.onerror=()=>reject(r.error);
 });
}
export async function deleteRun(id:string):Promise<void>{
 return execute("readwrite",(store,resolve,reject)=>{
  const r=store.delete(id);
  r.onsuccess=()=>resolve();
  r.onerror=()=>reject(r.error);
 });
}
