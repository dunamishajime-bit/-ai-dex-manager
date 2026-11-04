import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promises as fs} from 'node:fs';
import {emptyIdleState,writeIdleState} from '../lib/idle-priority-short-state';
import {emptyIdleResidualLongState,writeIdleResidualLongState} from '../lib/idle-residual-long-state';
import {FileHypeZecLongRunnerStateStore} from '../lib/hype-zec-long-runner-state';
import {buildSharedCryptoDailyRiskState,SHARED_CRYPTO_STRATEGIES,writeSharedCryptoDailyRisk} from '../lib/disdex-shared-crypto-daily-risk';
import {reserveAsterGlobalRateSlot} from '../lib/disdex-aster-global-rate-budget';

const sha='a'.repeat(40),now=1800000000000;
test('a released primary lock is retried instead of being classified as a stale generation',{skip:process.platform!=='linux'},async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'disdex-lock-handoff-')),path=join(dir,'budget.json'),lock=path+'.lock';
 const originalRead=fs.readFile,originalRename=fs.rename;let released=false,staleRenames=0;
 try{
  await fs.mkdir(lock);await fs.utimes(lock,new Date(Date.now()-30000),new Date(Date.now()-30000));
  t.mock.method(fs,'readFile',async(...args:Parameters<typeof fs.readFile>)=>{
   if(String(args[0])===join(lock,'owner.json')&&!released){released=true;await fs.rm(lock,{recursive:true});}
   return originalRead(...args);
  });
  t.mock.method(fs,'rename',async(from:Parameters<typeof fs.rename>[0],to:Parameters<typeof fs.rename>[1])=>{
   if(String(from)===lock&&String(to).includes('.stale.'))staleRenames++;
   return originalRename(from,to);
  });
  await reserveAsterGlobalRateSlot({path,minIntervalMs:1,maxQueueMs:5000,nowMs:now});
  assert.equal(released,true);assert.equal(staleRenames,0,'an absent old generation cannot justify evicting a newly acquired one');
 }finally{t.mock.restoreAll();await rm(dir,{recursive:true,force:true});}
});
async function publications(name:string,write:(path:string)=>Promise<unknown>,schema:string){
 const dir=await mkdtemp(join(tmpdir(),'disdex-current-atomic-'+name+'-'));const path=join(dir,'state.json');const original=Date.now;Date.now=()=>now;
 try{
  const results=await Promise.allSettled(Array.from({length:80},()=>write(path)));
  assert.equal(results.filter(r=>r.status==='rejected').length,0,results.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason?.message).join('\n'));
  assert.equal(JSON.parse(await readFile(path,'utf8')).schema,schema);
  assert.equal((await stat(path)).mode&0o777,0o600);
  assert.deepEqual(await readdir(dir),['state.json']);
 }finally{Date.now=original;await rm(dir,{recursive:true,force:true});}
}
test('current IDLE state survives eighty same-PID same-millisecond writes',{skip:process.platform==='win32'},()=>publications('idle',p=>writeIdleState(p,emptyIdleState(sha,now)),'disdex-idle-priority-state/v2'));
test('current residual state survives eighty same-PID same-millisecond writes',{skip:process.platform==='win32'},()=>publications('residual',p=>writeIdleResidualLongState(p,emptyIdleResidualLongState(sha,now)),'disdex-idle-residual-long-state/v1'));
test('current HYPE state survives eighty same-PID same-millisecond writes',{skip:process.platform==='win32'},()=>publications('hype',p=>new FileHypeZecLongRunnerStateStore(p,sha,'LIVE').save({schema:'disdex-hype-zec-long/v1',runtimeCommitSha:sha,mode:'LIVE',updatedAt:now,failures:[]}),'disdex-hype-zec-long/v1'));
test('current daily risk survives eighty publications without changing loss policy',{skip:process.platform==='win32'},()=>publications('risk',p=>writeSharedCryptoDailyRisk(p,buildSharedCryptoDailyRiskState({accountScope:'ASTER_FUTURES',utcDay:'2027-01-15',strategyIds:[...SHARED_CRYPTO_STRATEGIES],lossPct:0,maximumLossPct:7.5,tripped:false,updatedAt:now,realizedPnl:0,unrealizedPnl:0,fees:0,funding:0,netDailyPnl:0,referenceEquity:100,sourceComplete:true})),'disdex-shared-crypto-daily-risk/v1'));
test('current shared budget still serializes eighty distinct permits',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'disdex-current-budget-'));try{
  const results=await Promise.all(Array.from({length:80},()=>reserveAsterGlobalRateSlot({path:join(dir,'budget.json'),minIntervalMs:1,maxQueueMs:5000,priority:'RISK_READ',nowMs:now})));
  assert.equal(new Set(results.map(x=>x.permitAt)).size,80);assert.equal((await readdir(dir)).some(n=>n.endsWith('.tmp')),false);
  assert.equal(JSON.parse(await readFile(join(dir,'budget.json'),'utf8')).nextAllowedAt,now+80);
 }finally{await rm(dir,{recursive:true,force:true});}
});
