/**
 * H48 STOP8 intent journal. A live protection attempt must survive process
 * crashes and cannot be reset from SUBMITTED to PREPARED, even if the venue
 * request fails or returns UNKNOWN. This is a filesystem adapter; it does
 * NOT obtain Owner approval, POST a STOP, or clear GLOBAL HOLD.
 */
import {randomUUID} from "node:crypto";
import {mkdir,open,lstat,readFile,realpath,rename,unlink} from "node:fs/promises";
import {dirname,isAbsolute,resolve} from "node:path";
import type {AccountLockHandle} from "./disdex-account-order-lock";
import type {H48SignedVenueSnapshot} from "./hype-h48-execution-journal";
import {
  validateH48Stop8Intent,verifyH48Stop8Venue,
  type H48Stop8Intent,type H48Stop8Store,
} from "./hype-h48-resident-stop8";

const fail=(reason:string):never=>{throw Error("H48_STOP8_STORE_"+reason)};
const errorCode=(e:unknown)=>String((e as NodeJS.ErrnoException)?.code||"");
type FileInfo=Awaited<ReturnType<typeof lstat>>;
function safeFile(s:FileInfo){
  if(!s.isFile()||s.isSymbolicLink()||(process.platform!=="win32"&&(s.mode&0o022)!==0))
    fail("UNTRUSTED_FILE");
}
async function safeParent(path:string){
  const parent=dirname(path);
  const s=await lstat(parent);
  if(!s.isDirectory()||s.isSymbolicLink()
    ||await realpath(parent)!==resolve(parent))
    fail("UNTRUSTED_DIRECTORY");
}
async function dirSync(path:string){
  if(process.platform==="win32")return;
  const fd=await open(dirname(path),"r");
  try{await fd.sync()}finally{await fd.close()}
}
async function readStable(path:string):Promise<{bytes:Buffer;file:FileInfo}>{
  await safeParent(path);
  const first=await lstat(path);safeFile(first);
  const bytes=await readFile(path);
  const last=await lstat(path);safeFile(last);
  if(first.dev!==last.dev||first.ino!==last.ino||first.size!==last.size
    ||first.mtimeMs!==last.mtimeMs||bytes.length>16_384)
    fail("FILE_CHANGED_OR_OVERSIZED");
  return {bytes,file:last};
}
async function assertLease(lease:AccountLockHandle){
  const doc=await lease.document();
  if(doc.accountScope!=="ASTER_FUTURES"||doc.expiresAt<=Date.now()
    ||doc.leaseId!==lease.leaseId||doc.ownerId!==lease.ownerId)
    fail("ACCOUNT_LEASE_NOT_OWNED");
  return doc;
}
function unchanged(a:H48Stop8Intent,b:H48Stop8Intent){
  const base=(v:H48Stop8Intent)=>({
    schema:v.schema,sourceSha:v.sourceSha,planSha256:v.planSha256,
    positionId:v.positionId,entryClientOrderId:v.entryClientOrderId,
    stopClientOrderId:v.stopClientOrderId,entryPrice:v.entryPrice,
    quantity:v.quantity,tickSize:v.tickSize,stopPrice:v.stopPrice,
    issuedAt:v.issuedAt,
  });
  return JSON.stringify(base(a))===JSON.stringify(base(b));
}
export class FileH48Stop8Store implements H48Stop8Store {
  readonly path:string;
  constructor(path:string,private readonly sourceSha:string,private readonly planSha256:string){
    if(!path||!isAbsolute(path))fail("ABSOLUTE_PATH_REQUIRED");
    this.path=resolve(path);
  }
  private validate(value:H48Stop8Intent){
    const v=validateH48Stop8Intent(value);
    if(v.sourceSha!==this.sourceSha||v.planSha256!==this.planSha256)
      fail("SOURCE_PLAN_MISMATCH");
    return v;
  }
  async load():Promise<H48Stop8Intent>{
    // ENOENT is not FLAT and never means a prior attempt can be retried.
    const {bytes}=await readStable(this.path);
    try{return this.validate(JSON.parse(bytes.toString("utf8")))}
    catch(e){if(errorCode(e)==="ENOENT")throw e;throw e}
  }
  async initialize(input:{
    intent:H48Stop8Intent;lease:AccountLockHandle;
    signedVenue:H48SignedVenueSnapshot;now:number;
  }):Promise<void>{
    const intent=this.validate(input.intent);
    if(intent.stage!=="PREPARED"||!Number.isSafeInteger(input.now)
      ||Math.abs(input.now-intent.issuedAt)>120_000)
      fail("NEW_INTENT_INVALID");
    await assertLease(input.lease);
    const venue=input.signedVenue;
    if(venue?.source!=="ASTER_SIGNED_READ_ONLY"||venue.observedAt>input.now
      ||input.now-venue.observedAt>120_000
      ||!Array.isArray(venue.positions)||!Array.isArray(venue.openOrders)
      ||venue.openOrders.some(x=>x?.symbol?.toUpperCase()==="HYPEUSDT"))
      fail("SIGNED_FRESH_HYPE_WITHOUT_ORDERS_REQUIRED");
    const held=venue.positions.filter(x=>x?.symbol?.toUpperCase()==="HYPEUSDT"&&Math.abs(x.quantity)>1e-9);
    if(held.length!==1||held[0].quantity!==intent.quantity
      ||!["BOTH","LONG"].includes(held[0].positionSide)
      ||Math.abs(held[0].entryPrice-intent.entryPrice)>intent.tickSize)
      fail("SIGNED_POSITION_NOT_MATCHED");
    await mkdir(dirname(this.path),{recursive:true,mode:0o700});
    await safeParent(this.path);
    const fd=await open(this.path,"wx",0o600).catch((e:NodeJS.ErrnoException)=>{
      if(e.code==="EEXIST")fail("PRIOR_INTENT_ALREADY_EXISTS");throw e;
    });
    try{await fd.writeFile(JSON.stringify(intent)+"\n","utf8");await fd.sync()}
    finally{await fd.close()}
    await dirSync(this.path);
    await assertLease(input.lease);
  }
  async save(before:H48Stop8Intent,after:H48Stop8Intent,lease:AccountLockHandle,
    proof?:{venue:H48SignedVenueSnapshot;now:number}):Promise<void>{
    const old=this.validate(before),next=this.validate(after);
    if(!unchanged(old,next))fail("IDENTITY_MUTATION");
    if(old.stage==="PREPARED"&&next.stage==="SUBMITTED"){
      if(old.submittedAt!==null||next.submittedAt===null
        ||next.submittedAt<old.issuedAt||next.confirmedAt!==null)
        fail("SUBMISSION_TRANSITION");
    }else if(old.stage==="SUBMITTED"&&next.stage==="CONFIRMED"){
      if(!proof)fail("VENUE_READBACK_REQUIRED");
      if(next.submittedAt!==old.submittedAt||next.confirmedAt!==proof.now)
        fail("CONFIRMATION_CLOCK_MISMATCH");
      verifyH48Stop8Venue(old,proof.venue,proof.now);
    }else fail("ILLEGAL_TRANSITION");
    const initial=await assertLease(lease);
    const lockPath=this.path+".writer.lock";
    const guard=await open(lockPath,"wx",0o600).catch((e:NodeJS.ErrnoException)=>{
      if(e.code==="EEXIST")fail("EXCLUSIVE_WRITER_CONFLICT");throw e;
    });
    let temp:string|undefined;
    try{
      await guard.writeFile(JSON.stringify({schema:"h48-stop8-single-writer/v1",
        pid:process.pid})+"\n");
      await guard.sync();
      const {bytes}=await readStable(this.path);
      const observed=this.validate(JSON.parse(bytes.toString("utf8")));
      if(JSON.stringify(observed)!==JSON.stringify(old))
        fail("STALE_OR_CONFLICTED");
      const final=await assertLease(lease);
      if(final.ownerId!==initial.ownerId||final.leaseId!==initial.leaseId
        ||final.acquiredAt!==initial.acquiredAt)fail("LOCK_OWNER_CHANGED");
      temp=this.path+"."+randomUUID()+".tmp";
      const fd=await open(temp,"wx",0o600);
      try{await fd.writeFile(JSON.stringify(next)+"\n");await fd.sync()}
      finally{await fd.close()}
      if(!(await readFile(this.path)).equals(bytes))
        fail("MODIFIED_DURING_COMMIT");
      await rename(temp,this.path);temp=undefined;
      await dirSync(this.path);
    }finally{
      if(temp)await unlink(temp).catch(()=>undefined);
      await guard.close();
      await unlink(lockPath).catch(()=>undefined);
    }
  }
}
