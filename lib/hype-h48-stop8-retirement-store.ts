/**
 * Durable retirement ledger for the one owned STOP8 order.
 * Missing ledger is NOT permission to retry a DELETE. fsync, exclusive
 * writer and strict Root-plan lineage are required for each transition.
 */
import {randomUUID} from "node:crypto";
import {dirname,isAbsolute,resolve} from "node:path";
import {open,readFile,rename,unlink,lstat,realpath} from "node:fs/promises";
import type {AccountLockHandle} from "./disdex-account-order-lock";
import type {H48SignedVenueSnapshot} from "./hype-h48-execution-journal";
import {
  RETIRE_SCHEMA,type H48Stop8Retirement,type H48Stop8RetirementStore,
} from "./hype-h48-stop8-retirement";
const fail=(why:string):never=>{throw Error("H48_STOP8_RETIRE_STORE_"+why)};
const validTime=(x:unknown):x is number=>
  typeof x==="number"&&Number.isSafeInteger(x)&&x>0;
export class FileH48Stop8RetirementStore implements H48Stop8RetirementStore {
  readonly path:string;
  constructor(path:string,private readonly sourceSha:string,private readonly planSha256:string){
    if(!path||!isAbsolute(path)||!/^[a-f0-9]{40}$/.test(sourceSha)
      ||!/^[a-f0-9]{64}$/.test(planSha256))
      fail("IDENTITY");
    this.path=resolve(path);
  }
  private validate(s:H48Stop8Retirement):H48Stop8Retirement{
    const fields=["schema","sourceSha","planSha256","positionId","stopClientOrderId",
      "phase","preparedAt","submittedAt","confirmedAt"];
    if(!s||typeof s!=="object"||Array.isArray(s)
      ||Object.keys(s).length!==fields.length
      ||Object.keys(s).some(k=>!fields.includes(k))
      ||s.schema!==RETIRE_SCHEMA||s.sourceSha!==this.sourceSha
      ||s.planSha256!==this.planSha256
      ||typeof s.positionId!=="string"||!s.positionId.startsWith("H48|HYPEUSDT|")
      ||typeof s.stopClientOrderId!=="string"||!/^h48s-[a-f0-9]{30}$/.test(s.stopClientOrderId)
      ||!validTime(s.preparedAt)
      ||s.phase==="PREPARED"&&(s.submittedAt!==null||s.confirmedAt!==null)
      ||s.phase==="CANCEL_SUBMITTED"&&(!validTime(s.submittedAt)
        ||s.submittedAt<s.preparedAt||s.confirmedAt!==null)
      ||s.phase==="CONFIRMED"&&(!validTime(s.confirmedAt)
        ||s.confirmedAt<s.preparedAt
        ||s.submittedAt!==null&&(!validTime(s.submittedAt)
          ||s.submittedAt<s.preparedAt||s.submittedAt>s.confirmedAt))
      ||!["PREPARED","CANCEL_SUBMITTED","CONFIRMED"].includes(s.phase))
      fail("STATE_INVALID");
    return structuredClone(s);
  }
  private async parent(){
    const parent=dirname(this.path),stat=await lstat(parent);
    if(!stat.isDirectory()||stat.isSymbolicLink()
      ||await realpath(parent)!==resolve(parent)
      ||process.platform!=="win32"&&(stat.mode&0o022)!==0)
      fail("UNTRUSTED_DIRECTORY");
  }
  private async syncDir(){
    if(process.platform==="win32")return;
    const fd=await open(dirname(this.path),"r");
    try{await fd.sync()}finally{await fd.close()}
  }
  private async read():Promise<{state:H48Stop8Retirement;raw:Buffer}>{
    await this.parent();
    const stat=await lstat(this.path);
    if(!stat.isFile()||stat.isSymbolicLink()
      ||process.platform!=="win32"&&(stat.mode&0o022)!==0||stat.size>8192)
      fail("UNTRUSTED_FILE");
    const raw=await readFile(this.path);
    const after=await lstat(this.path);
    if(after.ino!==stat.ino||after.dev!==stat.dev
      ||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)
      fail("READ_CHANGED");
    try{return {state:this.validate(JSON.parse(raw.toString("utf8"))),raw}}
    catch{fail("CORRUPT_JSON")}
  }
  async load():Promise<H48Stop8Retirement>{return (await this.read()).state}
  private async lease(lock:AccountLockHandle){
    const state=await lock.document();
    if(state.accountScope!=="ASTER_FUTURES"
      ||state.ownerId!==lock.ownerId||state.leaseId!==lock.leaseId
      ||state.expiresAt<=Date.now())fail("ACCOUNT_LEASE_NOT_ACTIVE");
    return state;
  }
  async initialize(intent:H48Stop8Retirement,lock:AccountLockHandle):Promise<void>{
    const entry=this.validate(intent);
    if(entry.phase!=="PREPARED")fail("INITIAL_STATE_NOT_PREPARED");
    await this.parent();
    await this.lease(lock);
    const fd=await open(this.path,"wx",0o600).catch((e:NodeJS.ErrnoException)=>{
      if(e.code==="EEXIST")fail("PRIOR_RETIRE_INTENT_EXISTS");throw e;
    });
    try{await fd.writeFile(JSON.stringify(entry)+"\n");await fd.sync()}
    finally{await fd.close()}
    await this.syncDir();
  }
  async save(before:H48Stop8Retirement,after:H48Stop8Retirement,
    lock:AccountLockHandle,signedEvidence?:{
      venue:H48SignedVenueSnapshot;now:number;
    }):Promise<void>{
    const old=this.validate(before),next=this.validate(after);
    const identity=(s:H48Stop8Retirement)=>[
      s.schema,s.sourceSha,s.planSha256,s.positionId,s.stopClientOrderId,s.preparedAt,
    ].join("|");
    if(identity(old)!==identity(next))fail("IDENTITY_CHANGED");
    const submit=old.phase==="PREPARED"&&next.phase==="CANCEL_SUBMITTED"
      &&next.submittedAt!==null&&next.submittedAt>=old.preparedAt;
    const confirm=(old.phase==="PREPARED"||old.phase==="CANCEL_SUBMITTED")
      &&next.phase==="CONFIRMED"
      &&next.submittedAt===old.submittedAt;
    if(!submit&&!confirm)fail("ILLEGAL_TRANSITION");
    if(confirm){
      const proof=signedEvidence;
      if(!proof)fail("SIGNED_FLAT_EVIDENCE_REQUIRED");
      const p=proof!;
      if(!Number.isSafeInteger(p.now)||p.venue?.source!=="ASTER_SIGNED_READ_ONLY"
        ||!Number.isSafeInteger(p.venue.observedAt)
        ||p.venue.observedAt>p.now||p.now-p.venue.observedAt>30_000
        ||p.venue.observedAt<old.preparedAt
        ||old.submittedAt!==null&&p.venue.observedAt<old.submittedAt
        ||p.now!==next.confirmedAt
        ||!Array.isArray(p.venue.positions)||!Array.isArray(p.venue.openOrders)
        ||p.venue.positions.some(row=>row?.symbol==="HYPEUSDT"&&Math.abs(row.quantity)>1e-9)
        ||p.venue.openOrders.some(row=>row?.symbol==="HYPEUSDT"))
        fail("SIGNED_FLAT_OR_STOP_ABSENCE_NOT_PROVEN");
    }
    const initial=await this.lease(lock);
    await this.parent();
    const guardPath=this.path+".writer.lock";
    const guard=await open(guardPath,"wx",0o600).catch((e:NodeJS.ErrnoException)=>{
      if(e.code==="EEXIST")fail("EXCLUSIVE_WRITER_CONFLICT");throw e;
    });
    let temp:string|undefined;
    try{
      await guard.writeFile(JSON.stringify({schema:"h48-stop8-retirement-writer/v1",pid:process.pid})+"\n");
      await guard.sync();
      const stored=await this.read();
      if(JSON.stringify(stored.state)!==JSON.stringify(old))fail("STATE_CONFLICT");
      const renewed=await this.lease(lock);
      if(renewed.leaseId!==initial.leaseId||renewed.acquiredAt!==initial.acquiredAt)
        fail("LEASE_CHANGED");
      temp=this.path+"."+randomUUID()+".tmp";
      const fd=await open(temp,"wx",0o600);
      try{await fd.writeFile(JSON.stringify(next)+"\n");await fd.sync()}
      finally{await fd.close()}
      if(!(await readFile(this.path)).equals(stored.raw))
        fail("MODIFIED_BEFORE_RENAME");
      await rename(temp,this.path);temp=undefined;
      await this.syncDir();
    }finally{
      if(temp)await unlink(temp).catch(()=>undefined);
      await guard.close();await unlink(guardPath).catch(()=>undefined);
    }
  }
}
