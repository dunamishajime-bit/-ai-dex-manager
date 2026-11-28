/**
 * H48-specific atomic, versioned journal store (NO order API).
 *
 * The initial journal requires a fresh, signed, flat HYPE venue read; a missing
 * or corrupt journal is never interpreted as an empty/flat account.
 *
 * Production use also requires exclusive writer supervision, account lock,
 * pending-exposure registration, STOP/risk policy and exact signed approval.
 * This file is not bound to any LIVE runner or deploy script.
 */
import { randomUUID } from "node:crypto";
import { lstat,open,readFile,rename,unlink } from "node:fs/promises";
import { dirname,resolve } from "node:path";
import type { AccountLockHandle } from "./disdex-account-order-lock";
import type { DirectTradeResult } from "./direct-trade-executor";
import { newH48ExecutionJournal,validateH48ExecutionJournal,assertH48JournalTransition,reconcileH48Attempt,
  type H48ExecutionJournal,type H48SignedVenueSnapshot } from "./hype-h48-execution-journal";

const fail=(reason:string):never=>{throw Error("H48_JOURNAL_STORE_"+reason)};
const time=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
const unix=process.platform!=="win32";
async function safeParent(path:string){
  const info=await lstat(dirname(path));
  if(!info.isDirectory()||info.isSymbolicLink()||(unix&&(info.mode&0o022)!==0))fail("PARENT_UNTRUSTED");
}
async function stableRead(path:string):Promise<string>{
  const before=await lstat(path);
  if(!before.isFile()||before.isSymbolicLink()
    ||(unix&&(before.mode&0o077)!==0))fail("FILE_UNTRUSTED");
  const raw=await readFile(path,"utf8");
  const after=await lstat(path);
  if(!after.isFile()||before.ino!==after.ino||before.dev!==after.dev
    ||before.size!==after.size||before.mtimeMs!==after.mtimeMs)fail("FILE_CHANGED_DURING_READ");
  return raw;
}
async function assertAccountLease(lease:AccountLockHandle){
  if(!lease||typeof lease.document!=="function")fail("LOCK_MISSING");
  const doc=await lease.document();
  if(!doc||doc.accountScope!=="ASTER_FUTURES"||typeof doc.leaseId!=="string"
    ||!time(doc.expiresAt)||doc.expiresAt<=Date.now())fail("ACCOUNT_LOCK_INVALID");
  return doc;
}
async function stillOwned(lease:AccountLockHandle,first:Awaited<ReturnType<typeof assertAccountLease>>){
  const after=await assertAccountLease(lease);
  if(after.leaseId!==first.leaseId||after.ownerId!==first.ownerId||after.acquiredAt!==first.acquiredAt)fail("LOCK_CHANGED");
}

async function syncParentDirectory(path:string) {
  if(!unix)return;
  const handle=await open(dirname(path),"r");
  try {await handle.sync()} finally {await handle.close()}
}
async function withExclusiveJournalWriter<T>(path:string,work:()=>Promise<T>):Promise<T>{
  await safeParent(path);
  const writerLock=path+".writer.lock";
  let handle;
  try {handle=await open(writerLock,"wx",0o600);}
  catch(e){
    if((e as NodeJS.ErrnoException)?.code==="EEXIST")fail("EXCLUSIVE_WRITER_CONFLICT");
    throw e;
  }
  try {
    await handle.writeFile(JSON.stringify({schema:"disdex-h48-journal-writer/v1",pid:process.pid})+"\n","utf8");
    await handle.sync();
    await syncParentDirectory(path);
    return await work();
  } finally {
    await handle.close();
    await unlink(writerLock).catch(()=>undefined);
  }
}

export class FileH48ExecutionJournalStore {
  private readonly path:string;
  constructor(path:string,private readonly sourceSha:string){
    if(typeof path!=="string"||!path.trim()||!resolve(path))fail("PATH_INVALID");
    // A caller must pass an absolute, explicit, dedicated storage path.
    if(!/^([A-Za-z]:[\\/]|\/)/.test(path))fail("ABSOLUTE_PATH_REQUIRED");
    this.path=resolve(path);
    newH48ExecutionJournal(sourceSha);
  }
  async load():Promise<H48ExecutionJournal>{
    await safeParent(this.path);
    try {
      return validateH48ExecutionJournal(JSON.parse(await stableRead(this.path)),this.sourceSha);
    }catch(error){
      if((error as NodeJS.ErrnoException)?.code==="ENOENT")fail("MISSING_NOT_FLAT");
      throw error;
    }
  }
  async initialize(input:{lease:AccountLockHandle;venue:H48SignedVenueSnapshot;now:number}){
    const lease=await assertAccountLease(input.lease);
    const v=input.venue;
    if(!v||v.source!=="ASTER_SIGNED_READ_ONLY"||!time(v.observedAt)
      ||!time(input.now)||v.observedAt>input.now||input.now-v.observedAt>120000
      ||!Array.isArray(v.positions)||!Array.isArray(v.openOrders)
      ||v.positions.some(p=>p.symbol.toUpperCase()==="HYPEUSDT"&&Math.abs(p.quantity)>1e-9)
      ||v.openOrders.some(o=>o.symbol.toUpperCase()==="HYPEUSDT"))fail("VENUE_NOT_SIGNED_FLAT");
    const state=newH48ExecutionJournal(this.sourceSha);
    return withExclusiveJournalWriter(this.path,async()=>{
      await stillOwned(input.lease,lease);
      // wx preserves corrupt/stale prior journals; no implicit reset to FLAT.
      const fd=await open(this.path,"wx",0o600).catch((e:NodeJS.ErrnoException)=>{
        if(e.code==="EEXIST")fail("ALREADY_EXISTS");throw e;
      });
      try {
        await fd.writeFile(JSON.stringify(state)+"\n","utf8");
        await fd.sync();
      }finally{await fd.close()}
      await syncParentDirectory(this.path);
      return this.load();
    });
  }
  async save(expected:H48ExecutionJournal,replacement:H48ExecutionJournal,lease:AccountLockHandle,
    evidence?:{result:DirectTradeResult;venue:H48SignedVenueSnapshot;now:number}){
    const first=await assertAccountLease(lease);
    const old=validateH48ExecutionJournal(expected,this.sourceSha);
    const updated=validateH48ExecutionJournal(replacement,this.sourceSha);
    if(updated.revision!==old.revision+1)fail("REVISION_STEP_INVALID");
    assertH48JournalTransition(old,updated);
    if(old.pending?.stage==="SUBMITTED"){
      // No transition from a potentially executed order may be committed
      // without a fresh reconciliation of exact venue order + account
      // position evidence. In particular, never fabricate SUBMITTED -> FLAT.
      if(!evidence)fail("AUTHENTICATED_RECONCILIATION_REQUIRED");
      const recomputed=reconcileH48Attempt(old,evidence!);
      if(JSON.stringify(recomputed)!==JSON.stringify(updated))fail("RECONCILIATION_TRANSITION_MISMATCH");
    }
    return withExclusiveJournalWriter(this.path,async()=>{
      const raw=await stableRead(this.path).catch((e:NodeJS.ErrnoException)=>{
        if(e.code==="ENOENT")fail("MISSING_NOT_FLAT");throw e;
      });
      const current=validateH48ExecutionJournal(JSON.parse(raw),this.sourceSha);
      if(JSON.stringify(current)!==JSON.stringify(old))fail("STALE_OR_CONFLICTED");
      await safeParent(this.path);
      const tmp=this.path+"."+process.pid+"."+randomUUID()+".tmp";
      let created=false;
      try {
        const fd=await open(tmp,"wx",0o600);created=true;
        try {
          await fd.writeFile(JSON.stringify(updated)+"\n","utf8");await fd.sync();
        }finally{await fd.close()}
        await stillOwned(lease,first);
        if(await stableRead(this.path)!==raw)fail("MODIFIED_CONCURRENTLY");
        await rename(tmp,this.path);created=false;
        await syncParentDirectory(this.path);
        return this.load();
      }finally{
        if(created)await unlink(tmp).catch(()=>undefined);
      }
    });
  }
}
