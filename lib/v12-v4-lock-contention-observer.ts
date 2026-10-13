/**
 * V4-only bounded account-lock retry with durable, privacy-minimized evidence.
 * Never removes a lock, changes ownership, or bypasses exchange/operator gates.
 */
import {createHash} from "node:crypto";
import {appendFile,lstat,mkdir,readFile} from "node:fs/promises";
import {dirname} from "node:path";
import {runWithBoundedAccountLockRetry} from "./disdex-account-lock-bounded-retry";

export type V4LockHolderObservation = {
 observedAt:number;
 state:"HELD"|"EXPIRED_BUT_PRESENT"|"RELEASED_BEFORE_READ"|"UNREADABLE";
 ownerId?:string;
 leaseFingerprint?:string;
 acquiredAt?:number;
 expiresAt?:number;
 heldForMs?:number;
 remainingMs?:number;
};
export type V4LockContentionEvent={
 schema:"disdex-v12-v4-lock-contention/v1";
 releaseSha:string;
 operationMode:string;
 observedAt:number;
 busyAttempts:number;
 resolved:boolean;
 outcome:string;
 elapsedMs:number;
 retryIntervalMs:number;
 retryDelaysMs:number[];
 observations:V4LockHolderObservation[];
 orderMutationByObserver:0;
};

export async function inspectV4LockHolder(path:string,now:number=Date.now()):Promise<V4LockHolderObservation>{
 const fallback:V4LockHolderObservation={observedAt:now,state:"UNREADABLE"};
 try{
  // Do not follow an unexpected symlink or accept an unbounded input.
  const st=await lstat(path);
  if(!st.isFile()||st.isSymbolicLink()||st.size>16_384)return fallback;
  const raw=JSON.parse(await readFile(path,"utf8")) as Record<string,unknown>;
  if(raw.schema!=="disdex-account-lock/v1"||typeof raw.ownerId!=="string"||
     typeof raw.leaseId!=="string")return fallback;
  const acquiredAt=Number(raw.acquiredAt),expiresAt=Number(raw.expiresAt);
  if(!Number.isFinite(acquiredAt)||!Number.isFinite(expiresAt))return fallback;
  const ownerId=raw.ownerId.replace(/[^a-zA-Z0-9_.:\-]/g,"_").slice(0,100);
  return {observedAt:now,state:expiresAt<=now?"EXPIRED_BUT_PRESENT":"HELD",
   ownerId,leaseFingerprint:createHash("sha256").update(raw.leaseId).digest("hex").slice(0,16),
   acquiredAt,expiresAt,heldForMs:Math.max(0,now-acquiredAt),
   remainingMs:Math.max(0,expiresAt-now)};
 }catch(e){
  if((e as NodeJS.ErrnoException)?.code==="ENOENT")return {observedAt:now,state:"RELEASED_BEFORE_READ"};
  return fallback;
 }
}

type TickResult={status:string};
export async function executeV4WithContentionAudit<T extends TickResult>(input:{
 operation:()=>Promise<T>;
 releaseSha:string;
 operationMode:string;
 accountLockPath:string;
 auditPath?:string;
 attempts?:number;
 retryMs?:number;
 shouldStop?:()=>boolean;
 wait?:(ms:number)=>Promise<void>;
 now?:()=>number;
 persist?:(event:V4LockContentionEvent)=>Promise<void>;
 emit?:(event:V4LockContentionEvent)=>void;
 onContention?:(observation:V4LockHolderObservation,attempt:number)=>void;
}):Promise<T>{
 const now=input.now??Date.now,startedAt=now();
 const retryMs=input.retryMs??750;
 const observations:V4LockHolderObservation[]=[];
 const retryDelaysMs:number[]=[];
 const baseWait=input.wait??((ms:number)=>new Promise<void>(done=>setTimeout(done,ms)));
 let result:T|undefined;
 try{
  result=await runWithBoundedAccountLockRetry({
   attempts:input.attempts??10,retryMs,shouldStop:input.shouldStop,
   wait:async()=>{
    const n=Math.max(1,observations.length);
    const delay=Math.min(2500,retryMs+Math.max(0,n-1)*500);
    retryDelaysMs.push(delay);
    await baseWait(delay);
   },
   operation:async()=>{
    const next=await input.operation();
    if(next.status==="locked"){
     const observation=await inspectV4LockHolder(input.accountLockPath,now());
     observations.push(observation);
     input.onContention?.(observation,observations.length);
    }
    return next;
   },
  });
  return result;
 }finally{
  if(observations.length){
   const event:V4LockContentionEvent={
    schema:"disdex-v12-v4-lock-contention/v1",
    releaseSha:input.releaseSha,operationMode:input.operationMode,
    observedAt:startedAt,busyAttempts:observations.length,
    resolved:Boolean(result&&result.status!=="locked"),
    outcome:result?.status??"THREW_DURING_RETRY",
    elapsedMs:Math.max(0,now()-startedAt),retryIntervalMs:retryMs,retryDelaysMs,
    observations,orderMutationByObserver:0,
   };
   // Never let an observability write failure strand the protection reconciliation.
   try{
    if(input.persist)await input.persist(event);
    else{
     const path=input.auditPath??"/var/lib/disdex/v12-v4/lock-contention-events.jsonl";
     if(!path.startsWith("/var/lib/disdex/v12-v4/"))throw Error("V4_CONTENTION_AUDIT_PATH_INVALID");
     await mkdir(dirname(path),{recursive:true,mode:0o700});
     await appendFile(path,JSON.stringify(event)+"\n",{encoding:"utf8",mode:0o600});
    }
   }catch(e){console.error(JSON.stringify({level:"error",reason:"V4_LOCK_AUDIT_WRITE_FAILED",
     error:e instanceof Error?e.message:String(e)}));}
   (input.emit??((ev)=>console.log(JSON.stringify({event:"V4_LOCK_CONTENTION",...ev}))))(event);
  }
 }
}
