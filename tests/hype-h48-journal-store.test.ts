import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp,rm,writeFile,readFile,open,unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountLockHandle,AccountLockDocument } from "../lib/disdex-account-order-lock";
import { FileH48ExecutionJournalStore } from "../lib/hype-h48-journal-store";
import { createHypeH48TimeOnlyContract } from "../lib/hype-stable4-time-only-contract";
import type { DirectTradeResult } from "../lib/direct-trade-executor";
import { newH48ExecutionJournal,checkpointH48ResearchGrid,reconcileH48Attempt,type H48SignedVenueSnapshot,type H48ExecutionJournal } from "../lib/hype-h48-execution-journal";
import { advanceH48ResearchSequence } from "../lib/hype-h48-research-sequence";

const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d";
function lease(ttl=30000):AccountLockHandle{
 const acquiredAt=Date.now();
 const doc:AccountLockDocument={
   schema:"disdex-account-lock/v1",accountScope:"ASTER_FUTURES",
   ownerId:"h48-isolated-test",leaseId:"test-lease",acquiredAt,expiresAt:acquiredAt+ttl,
   reservations:[],
 };
 return {ownerId:doc.ownerId,leaseId:doc.leaseId,acquiredAt,
   renewalIntervalMs:1000,document:async()=>({...doc}),
   renew:async()=>({...doc}),reserve:async()=>{throw Error("TEST_RESERVE_DISABLED")},
   releaseReservation:async()=>{},release:async()=>{}};
}
const signed=(now:number,position=false,order=false):H48SignedVenueSnapshot=>({
  source:"ASTER_SIGNED_READ_ONLY",observedAt:now,
  positions:position?[{symbol:"HYPEUSDT",quantity:1,entryPrice:100,markPrice:101,unrealizedPnl:1,
    pnlPct:0.01,notionalUsd:100,positionSide:"BOTH",leverage:5,updatedAt:now}]:[],
  openOrders:order?[{clientOrderId:"unmanaged",symbol:"HYPEUSDT",quantity:1,executedQuantity:0}]:[],
});
function advance(){
 const E=Date.UTC(2026,10,24,0),H=3600000;
 const s=newH48ExecutionJournal(SHA);
 const base=Array.from({length:25},(_,i)=>({openTs:E-(25-i)*H,close:100}));
 const seq=advanceH48ResearchSequence({state:s.research,runtimeSha:SHA,
   now:E+1000,entry:{openTs:E,open:100,observedAt:E+500},
   hypeClosed:base,btcClosed:base,existingHypePosition:false});
 assert.equal(seq.decision.status,"NO_BASE_SIGNAL");
 return checkpointH48ResearchGrid(s,seq);
}

test("H48 journal missing means BLOCKED; signed flat + lease creates once, atomic revision saves",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"h48-journal-audit-"));
 const p=join(dir,"execution.json");
 try{
   const store=new FileH48ExecutionJournalStore(p,SHA);
   await assert.rejects(store.load(),/H48_JOURNAL_STORE_MISSING_NOT_FLAT/);
   const now=Date.now();
   const current=await store.initialize({lease:lease(),venue:signed(now),now});
   assert.deepEqual(current,newH48ExecutionJournal(SHA));
   const next=advance();
   assert.equal(next.revision,1);
   const saved=await store.save(current,next,lease());
   assert.equal(saved.revision,1);
   assert.equal((await store.load()).research.lastEvaluatedEntryTs,next.research.lastEvaluatedEntryTs);
   await assert.rejects(store.save(current,next,lease()),/H48_JOURNAL_STORE_STALE_OR_CONFLICTED/);
   await assert.rejects(store.initialize({lease:lease(),venue:signed(now),now}),/ALREADY_EXISTS/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("H48 initialization never assumes stale or non-flat signed venue is safe",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"h48-journal-flat-"));
 try{
   const p=join(dir,"state.json"),store=new FileH48ExecutionJournalStore(p,SHA);
   const now=Date.now();
   for(const venue of [signed(now,true),signed(now,false,true),signed(now-300000)]){
     await assert.rejects(store.initialize({lease:lease(),venue,now}),/VENUE_NOT_SIGNED_FLAT/);
   }
   await assert.rejects(store.initialize({lease:lease(-1000),venue:signed(now),now}),/ACCOUNT_LOCK_INVALID/);
   await assert.rejects(store.load(),/MISSING_NOT_FLAT/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("corrupt or wrong-SHA journal requires manual intervention; never reset to flat",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"h48-journal-corrupt-"));
 try{
   const p=join(dir,"state.json"),store=new FileH48ExecutionJournalStore(p,SHA);
   await writeFile(p,"{ corrupted","utf8");
   await assert.rejects(store.load());
   await assert.rejects(store.initialize({lease:lease(),venue:signed(Date.now()),now:Date.now()}));
   await writeFile(p,JSON.stringify({...newH48ExecutionJournal(SHA),sourceSha:"a".repeat(40)}),"utf8");
   await assert.rejects(store.load(),/HYPE_H48_JOURNAL_STATE_HEADER/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("atomic save rejects missing predecessor, invalid revision and changed lock",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"h48-journal-lock-"));
 try{
   const store=new FileH48ExecutionJournalStore(join(dir,"s.json"),SHA),now=Date.now();
   const current=await store.initialize({lease:lease(),venue:signed(now),now});
   const next=advance();
   await assert.rejects(store.save(current,{...next,revision:3},lease()),/REVISION_STEP_INVALID/);
   const live=lease(-1000);
   await assert.rejects(store.save(current,next,live),/ACCOUNT_LOCK_INVALID/);
   assert.equal((await store.load()).revision,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("exclusive journal writer-lock prevents a second process from overwriting state",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"h48-journal-writer-"));
 try {
   const path=join(dir,"journal.json");
   const store=new FileH48ExecutionJournalStore(path,SHA),now=Date.now();
   const current=await store.initialize({lease:lease(),venue:signed(now),now});
   const before=await readFile(path,"utf8");
   const writerLock=path+".writer.lock";
   const guard=await open(writerLock,"wx",0o600);
   try{
     await assert.rejects(store.save(current,advance(),lease()),/EXCLUSIVE_WRITER_CONFLICT/);
     assert.equal(await readFile(path,"utf8"),before);
   }finally{await guard.close();await unlink(writerLock)}
   const after=await store.save(current,advance(),lease());
   assert.equal(after.revision,1);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("SUBMITTED -> FLAT cannot be persisted without fresh exact venue cancellation evidence",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"h48-journal-trade-proof-"));
 try {
   const path=join(dir,"state.json"),store=new FileH48ExecutionJournalStore(path,SHA);
   const E=Date.UTC(2026,10,24,0),H=3600000;
   const contract=createHypeH48TimeOnlyContract({sourceSha:SHA,positionId:"H48|HYPEUSDT|"+E,logicalEntryTs:E});
   const id="h48e-"+"c".repeat(30);
   const submitted:H48ExecutionJournal={
     ...newH48ExecutionJournal(SHA),revision:7,mode:"ENTRY_PENDING",
     research:{schema:"disdex-h48-r4-wsig-research-sequence/v1",sourceSha:SHA,
       lastEvaluatedEntryTs:E,nextBaseEligibleTs:E+48*H},
     pending:{phase:"ENTRY",stage:"SUBMITTED",clientOrderId:id,contract,quantity:2,
       referencePrice:100,certificateSha256:"a".repeat(64),
       authorizationExpiresAt:E+60000,preparedAt:E+1000,submittedAt:E+1200},
   };
   await writeFile(path,JSON.stringify(submitted)+"\n",{mode:0o600});
   const order:DirectTradeResult={
     requestId:id,clientOrderId:id,symbol:"HYPEUSDT",side:"BUY",status:"CANCELED",
     requestedQuantity:2,submittedQuantity:2,executedQuantity:0,averagePrice:0,
     quoteQuantity:0,executionUnknown:false,reconciled:true,
   };
   const venue:H48SignedVenueSnapshot={
     source:"ASTER_SIGNED_READ_ONLY",observedAt:E+1500,positions:[],openOrders:[],
   };
   const evidence={result:order,venue,now:E+1600};
   const flat=reconcileH48Attempt(submitted,evidence);
   assert.equal(flat.mode,"FLAT");
   await assert.rejects(store.save(submitted,flat,lease()),/AUTHENTICATED_RECONCILIATION_REQUIRED/);
   const forgedEvidence={...evidence,result:{...order,clientOrderId:"OTHER-ORDER"}};
   await assert.rejects(store.save(submitted,flat,lease(),forgedEvidence),/RECONCILIATION_TRANSITION_MISMATCH/);
   assert.equal((await store.load()).mode,"ENTRY_PENDING");
   const saved=await store.save(submitted,flat,lease(),evidence);
   assert.equal(saved.mode,"FLAT");
   assert.equal(saved.revision,8);
 }finally{await rm(dir,{recursive:true,force:true})}
});
