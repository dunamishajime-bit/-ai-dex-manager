import {randomUUID} from "node:crypto";
import {lstat,open,readFile,rename,unlink} from "node:fs/promises";
import {dirname} from "node:path";
import {ACCOUNT_LOCK_SCHEMA,type AccountLockDocument} from "./disdex-account-order-lock";
import {appendStable4EntryOpportunityRecord,validateStable4EntryOpportunityBook,type Stable4EntryOpportunityBook,type Stable4EntryOpportunityRecord} from "./stable4-entry-opportunity-book";

type OwnedLease={document():Promise<AccountLockDocument>};
/** Evidence publication only. Missing/invalid stores never become implicit empty books. */
export class Stable4EntryOpportunityStore{
 constructor(readonly path:string,private readonly now:()=>number=Date.now){}
 private async snapshot(){
  let before;try{before=await lstat(this.path);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")throw Error("STABLE4_ENTRY_STORE_MISSING");throw error;}
  if(!before.isFile()||before.isSymbolicLink())throw Error("STABLE4_ENTRY_STORE_INVALID_FILE");
  const bytes=await readFile(this.path),after=await lstat(this.path);
  if(!after.isFile()||after.isSymbolicLink()||before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error("STABLE4_ENTRY_STORE_CAS_CHANGED");
  let book:Stable4EntryOpportunityBook;
  try{book=validateStable4EntryOpportunityBook(JSON.parse(bytes.toString("utf8")));}catch{throw Error("STABLE4_ENTRY_STORE_INVALID_DOCUMENT");}
  return{book,bytes,stat:after};
 }
 async read():Promise<Stable4EntryOpportunityBook>{return(await this.snapshot()).book;}
 async append(record:Stable4EntryOpportunityRecord,lease:OwnedLease):Promise<Stable4EntryOpportunityBook>{
  let first:AccountLockDocument|undefined;
  const check=async()=>{
   const d=await lease.document(),now=this.now();
   if(!d||d.schema!==ACCOUNT_LOCK_SCHEMA||d.accountScope!=="ASTER_FUTURES"||typeof d.ownerId!=="string"||!d.ownerId.trim()||typeof d.leaseId!=="string"||!d.leaseId.trim()||
    !Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(d.acquiredAt)||d.acquiredAt<=0||d.acquiredAt>now||!Number.isSafeInteger(d.expiresAt)||d.expiresAt<=now||
    (first&&(d.ownerId!==first.ownerId||d.leaseId!==first.leaseId||d.accountScope!==first.accountScope||d.acquiredAt!==first.acquiredAt)))throw Error("STABLE4_ENTRY_STORE_LEASE_INVALID");
   first??={...d};
  };
  await check();
  if(record.capturedAt>this.now())throw Error("STABLE4_ENTRY_STORE_CAPTURE_IN_FUTURE");
  const before=await this.snapshot(),next=appendStable4EntryOpportunityRecord(before.book,record);
  // An exact retry does not rewrite durable evidence or give it a newer capture time.
  if(next.records.length===before.book.records.length){await check();return next;}
  const temporary=this.path+"."+randomUUID()+".tmp";
  let created=false;
  try{
   const fd=await open(temporary,"wx",0o600);created=true;
   try{await fd.writeFile(JSON.stringify(next)+"\n","utf8");await fd.sync();}finally{await fd.close();}
   await check();
   const currentStat=await lstat(this.path),current=await readFile(this.path);
   if(!currentStat.isFile()||currentStat.isSymbolicLink()||currentStat.ino!==before.stat.ino||currentStat.dev!==before.stat.dev||!current.equals(before.bytes))throw Error("STABLE4_ENTRY_STORE_CAS_CHANGED");
   await rename(temporary,this.path);created=false;
   if(process.platform!=="win32"){const dir=await open(dirname(this.path),"r");try{await dir.sync();}finally{await dir.close();}}
   await check();
   return next;
  }finally{if(created)await unlink(temporary).catch(()=>undefined);}
 }
}
