"""Node source used by the HYPE flat-v2 executor under the candidate loader."""
PRECHECK_MIGRATE = r"""
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, copyFile, open, rename, unlink, chmod, chown, lstat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { AsterV3Client } from './lib/aster-v3-client.ts';
import { FileAccountOrderLock } from './lib/disdex-account-order-lock.ts';
import { replayProductionJournal } from './lib/v12-v4-production-lifecycle.ts';

const [legacy,candidate,plan,runId]=process.argv.slice(1);
const V4_SHA='3ad65403013b701db5d9e53e8814e6ab827a28e8';
const REVIEW='HYPE_ZEC_RUNNER_FAIL_CLOSED:UNKNOWN_JOURNAL_EVENT';
const REPAIRED='HYPE_CURRENT_FLAT_REVIEW_REPAIRED_AFTER_SIGNED_SCOPED_FLAT';
const statePath='/var/lib/disdex/hype-zec-long/runner.json';
const v4Path='/var/lib/disdex/v12-v4/orders.json';
const shared='/var/lib/disdex/shared/';
if(!/^[a-f0-9]{40}$/.test(legacy)||!/^[a-f0-9]{40}$/.test(candidate)||!/^[a-f0-9]{64}$/.test(plan)||!/^[0-9]{1,20}$/.test(runId))
 throw Error('HYPE_FLAT_V2_ARGS_INVALID');

const lock=new FileAccountOrderLock(shared+'account-order.lock',120000,shared+'pending-exposure.json');
let lease;
for(let i=0;i<8;i++){
 lease=await lock.acquire('HYPE_SHA_FLAT_V2:'+runId);
 if(lease)break;
 await wait(750+i*250);
}
if(!lease)throw Error('HYPE_FLAT_V2_ACCOUNT_LOCK_BUSY');
try{
 await lease.document();
 const v4=JSON.parse(await readFile(v4Path,'utf8'));
 if(v4.releaseSha!==V4_SHA||!v4.state||v4.state.executionReview!=null||v4.state.initial?.holdProtected!==false
    ||(v4.state.foreign??[]).length!==0) throw Error('HYPE_V4_CURRENT_OWNERSHIP_CHANGED');
 const replay=replayProductionJournal(v4.state.initial,v4.state.journal);
 const legs=Object.values(replay.legs??{});
 if(replay.executionReview!=null||(replay.foreign??[]).length!==0
    ||legs.some(l=>Math.abs(Number(l.qty??0))>1e-12||!['CLOSED','CANCELLED'].includes(String(l.status))))
   throw Error('HYPE_V4_CURRENT_OWNERSHIP_CHANGED');
 const reviewEvents=(v4.state.journal??[]).filter(e=>e?.type==='EXECUTION_REVIEW_RESOLVED').length;
 if(reviewEvents<1)throw Error('HYPE_V4_REVIEW_EVENT_MISSING');
 const journalCount=(v4.state.journal??[]).length;
 if(journalCount<10000)throw Error('HYPE_V4_JOURNAL_TOO_SHORT');

 const client=new AsterV3Client({
   baseUrl:process.env.ASTER_FUTURES_BASE_URL,
   userAddress:process.env.ASTER_USER_ADDRESS,
   privateKey:process.env.ASTER_API_PRIVATE_KEY,
   readOnlyRateLimitMaxRetries:0,
   requestTimeoutMs:12000,
   fetchImpl:(input,init={})=>{
     const u=new URL(typeof input==='string'?input:input.url??String(input));
     if((init.method??'GET')!=='GET'||init.body!=null||u.origin!=='https://fapi.asterdex.com'
        ||u.username||u.password||u.hash
        ||!['/fapi/v3/time','/fapi/v3/positionRisk','/fapi/v3/openOrders'].includes(u.pathname))
       throw Error('HYPE_FLAT_V2_READONLY_BOUNDARY');
     return fetch(input,{...init,redirect:'error'});
   }
 });
 if(!client.hasTradingCredentials())throw Error('HYPE_FLAT_V2_CREDENTIALS_REQUIRED');
 const snapshots=[];
 for(let round=0;round<3;round++){
   let ok=false,last;
   for(let attempt=0;attempt<6&&!ok;attempt++){
     try{
       const clock=await client.getServerTime();
       await wait(250);
       const allPositions=await client.getPositions();
       await wait(250);
       const orders=await client.getOpenOrders();
       const positions=allPositions.filter(p=>Math.abs(Number(p.positionAmt??p.quantity??0))>1e-12);
       const ts=Number(clock.serverTime);
       if(!Number.isFinite(ts)||Math.abs(Date.now()-ts)>=45000)throw Error('HYPE_FLAT_V2_CLOCK');
       if(positions.length!==0||orders.length!==0)throw Error('HYPE_FLAT_V2_VENUE_NOT_FLAT');
       snapshots.push({serverTime:ts,positions:[],openOrders:[]});
       ok=true;
     }catch(e){
       last=e;
       const msg=e instanceof Error?e.message:String(e);
       if(!/ASTER_GLOBAL_RATE_BUDGET|timeout/i.test(msg)||attempt===5)throw e;
       await wait(1000+attempt*750);
     }
   }
   if(!ok)throw last;
   if(round<2)await wait(750);
 }
 await lease.document();
 const raw=await readFile(statePath);
 const meta=await lstat(statePath);
 if(meta.isSymbolicLink()||!meta.isFile())throw Error('HYPE_FLAT_V2_STATE_FILE_INVALID');
 const state=JSON.parse(raw.toString('utf8'));
 const failures=Array.isArray(state.failures)?state.failures:[];
 const lastFailure=failures.at(-1)??{};
 const lastDecision=state.lastDecision??{};
 if(state.runtimeCommitSha!==legacy||state.mode!=='LIVE'||state.manualReview!=null
    ||(state.positions??[]).length!==0||state.pending
    ||state.updatedAt!==state.lastDecisionTs||state.updatedAt!==lastFailure.occurredAt
    ||lastDecision.reason!==REPAIRED||lastFailure.message!==REPAIRED
    ||!failures.some(x=>x?.message===REVIEW))throw Error('HYPE_FLAT_V2_REPAIRED_STATE_BASELINE');
 const backup=statePath+'.before-flat-v2-'+runId;
 await copyFile(statePath,backup,fsConstants.COPYFILE_EXCL);
 if(!(await readFile(backup)).equals(raw))throw Error('HYPE_FLAT_V2_BACKUP_MISMATCH');
 await chown(backup,meta.uid,meta.gid); await chmod(backup,meta.mode&0o777);
 const now=Date.now();
 const reason='HYPE_SHA_FLAT_V2_MIGRATED_FROM_REPAIRED_D6:ASTER_SIGNED_FLAT_3X';
 const next={...state,runtimeCommitSha:candidate,updatedAt:now,lastDecisionTs:now,
   lastDecision:{strategy:'HYPE_LONG',signalTs:null,accepted:false,reason},
   failures:[...(Array.isArray(state.failures)?state.failures:[]),{message:reason,occurredAt:now}].slice(-100)};
 delete next.manualReview;
 const out=Buffer.from(JSON.stringify(next,null,2)+'\n');
 const tmp=statePath+'.'+randomUUID()+'.flat-v2.tmp';
 const h=await open(tmp,'wx',meta.mode&0o777);
 try{await h.writeFile(out);await h.sync();}finally{await h.close();}
 await chown(tmp,meta.uid,meta.gid);await chmod(tmp,meta.mode&0o777);
 await lease.document();
 if(!(await readFile(statePath)).equals(raw)){await unlink(tmp).catch(()=>{});throw Error('HYPE_FLAT_V2_STATE_CAS');}
 await rename(tmp,statePath);
 if(!(await readFile(statePath)).equals(out))throw Error('HYPE_FLAT_V2_STATE_READBACK');
 const venueProofSha256=createHash('sha256').update(JSON.stringify(snapshots)).digest('hex');
 console.log(JSON.stringify({status:'HYPE_SHA_FLAT_V2_REPAIRED',oldSha:legacy,newSha:candidate,v4Sha:V4_SHA,
   journalCount,reviewEvents,signedVenueReads:3,accountFlatVerified:true,venueProofSha256,backupPath:backup,
   ordersSent:0,cancelsSent:0,positionChangesSent:0}));
}finally{await lease.release();}
"""
