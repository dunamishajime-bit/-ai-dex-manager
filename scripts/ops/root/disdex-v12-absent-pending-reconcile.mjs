import {readFile,writeFile,mkdir,rename,realpath,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {prepareAbsentPendingReconciliation,matchingPendingExposure} from './disdex-v12-absent-pending-policy.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=(ok,why)=>{if(!ok)throw Error(why);};
const arg=k=>{const i=process.argv.indexOf(k);return i<0?undefined:process.argv[i+1];};
async function main(){
 const sha=arg('--sha'),apply=process.argv.includes('--apply');
 fail(/^[0-9a-f]{40}$/.test(sha??''),'EXACT_SHA_REQUIRED');
 if(apply)fail(arg('--ack')==='I_ACK_SIGNED_ABSENT_PENDING_HOLD_RETAINED','OPERATOR_ACK_REQUIRED');
 const current=await realpath('/home/deploy/disdex-trading/current');
 fail(current===resolve('/home/deploy/disdex-trading/releases',sha),'CURRENT_RELEASE_MISMATCH');
 fail((await readFile(resolve(current,'.disdex-release-sha'),'utf8')).trim()===sha,'CURRENT_MARKER_MISMATCH');
 const stopped=()=>{const s=execFileSync('/usr/bin/systemctl',['show','disdex-v12-x1-all@'+sha+'.service','-p','ActiveState','--value'],{encoding:'utf8'}).trim();fail(['failed','inactive'].includes(s),'V12_MUST_STAY_STOPPED');};
 stopped();
 const statePath=resolve(process.env.V12_X1_ALL_STATE_PATH||'/var/lib/disdex/v12-x1-all/runner.json');
 const killPath=resolve(process.env.DISDEX_SHARED_KILL_SWITCH_PATH||'/var/lib/disdex/shared/kill-switch.json');
 const registryPath=resolve(process.env.DISDEX_PENDING_EXPOSURE_REGISTRY_PATH||'/var/lib/disdex/shared/pending-exposure.json');
 const stateBytes=await readFile(statePath),killBytes=await readFile(killPath),state=JSON.parse(stateBytes),kill=JSON.parse(killBytes);
 fail(kill.active===true&&kill.action==='HOLD_PROTECTED','PROTECTED_HOLD_REQUIRED');
 fail(state.pending,'PENDING_REQUIRED');
 const pending=state.pending,root=resolve(arg('--evidence-dir')||'/var/lib/disdex/ops-evidence/v12-v4-cert-20261009');
 const load=f=>import(pathToFileURL(resolve(current,'lib',f)).href);
 const {AsterV3Client,AsterApiError}=await load('aster-v3-client.ts');
 const {FileAccountOrderLock}=await load('disdex-account-order-lock.ts');
 const {readPendingExposureRegistry,releasePendingExposure}=await load('disdex-pending-exposure-registry.ts');
 const {normalizeLiveStateOwnership,normalizeLiveSharedStateOwnership}=await load('disdex-live-state-ownership.ts');
 const {FileV12X1AllRunnerStateStore}=await load('v12-x1-all-runner-state.ts');
 const client=new AsterV3Client({baseUrl:process.env.ASTER_FUTURES_BASE_URL,userAddress:process.env.ASTER_USER_ADDRESS,privateKey:process.env.ASTER_API_PRIVATE_KEY,requestTimeoutMs:10000,readOnlyRateLimitMaxRetries:0,userAgent:'DisDex-Signed-Absent-Pending-Reconcile/1.0'});
 fail(client.hasTradingCredentials(),'SIGNED_GET_CREDENTIALS_REQUIRED');
 const lock=new FileAccountOrderLock(process.env.DISDEX_ACCOUNT_LOCK_PATH||'/var/lib/disdex/shared/account-order.lock',120000);
 const deadline=Date.now()+120000;let handle=null;
 while(!handle&&Date.now()<deadline){handle=await lock.acquire('V12_ABSENT_PENDING_RECONCILE:'+process.pid);if(!handle)await delay(50);}
 fail(handle,'ACCOUNT_LOCK_BUSY_NO_FORCE_DELETE');
 try{
  const doc=await handle.document();fail(doc.reservations.length===0,'LOCK_RESERVATIONS_PRESENT');
  fail(hash(await readFile(statePath))===hash(stateBytes),'STATE_CHANGED_BEFORE_READBACK');
  const registry=await readPendingExposureRegistry(registryPath);
  const reservationId=matchingPendingExposure(registry.entries,pending,sha),rounds=[];
  for(let i=0;i<3;i++){
   fail(Date.now()-handle.acquiredAt<85000,'ACCOUNT_LEASE_TIME_BUDGET');
   const clock=await client.getServerTime(),positionsRaw=await client.getPositions(),ordersRaw=await client.getOpenOrders();
   let lookup;
   try{await client.getOrder(pending.symbol,pending.clientOrderId);throw Error('PENDING_ORDER_EXISTS');}
   catch(e){if(!(e instanceof AsterApiError)||e.status!==400||e.code!==-2013)throw e;lookup={status:e.status,code:e.code,symbol:pending.symbol,clientOrderId:pending.clientOrderId};}
   const tradeStartMs=pending.createdAt-120000,tradeEndMs=Date.now();
   const trades=await client.getUserTrades(pending.symbol,{startTime:tradeStartMs,endTime:tradeEndMs,limit:1000});
   const positions=positionsRaw.map(p=>({symbol:p.symbol,positionAmt:p.positionAmt,entryPrice:p.entryPrice}));
   const orders=ordersRaw.map(o=>({symbol:o.symbol,clientOrderId:o.clientOrderId,orderId:o.orderId,executedQty:o.executedQty,status:o.status,side:o.side,type:o.type,reduceOnly:o.reduceOnly,origQty:o.origQty,stopPrice:o.stopPrice}));
   fail(positions.some(p=>p.symbol==='TSLAUSDT'&&Number(p.positionAmt)===.38),'TSLA_OWNED_QUANTITY_CHANGED');
   fail(positions.some(p=>p.symbol==='PENGUUSDT'&&Number(p.positionAmt)===-7718),'PENGU_OWNED_QUANTITY_CHANGED');
   fail(orders.filter(o=>o.symbol==='PENGUUSDT'&&o.side==='BUY'&&o.type==='STOP_MARKET'&&o.reduceOnly===true&&Number(o.origQty)===7718&&Number(o.executedQty)===0&&o.status==='NEW'&&String(o.orderId)==='1165455184'&&o.clientOrderId==='pengu-stop-4921f3999a59b24c59c2f0'&&Number(o.stopPrice)===.009259).length===1,'PENGU_EXACT_PROTECTION_REQUIRED');
   rounds.push({observedAt:Date.now(),serverTime:clock.serverTime,lookup,tradeStartMs,tradeEndMs,positions,orders,trades});
   if(i<2)await delay(1000);
  }
  const recovered=prepareAbsentPendingReconciliation(state,rounds,sha,Date.now());
  stopped();await handle.document();
  fail(hash(await readFile(statePath))===hash(stateBytes),'STATE_COMPARE_AND_SWAP_FAILED');
  fail(hash(await readFile(killPath))===hash(killBytes),'HOLD_CHANGED_DURING_RECONCILE');
  const currentRegistry=await readPendingExposureRegistry(registryPath);
  fail(matchingPendingExposure(currentRegistry.entries,pending,sha)===reservationId,'RESERVATION_CHANGED');
  await mkdir(root,{recursive:true,mode:0o700});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),prefix=resolve(root,stamp+'-'+pending.clientOrderId);
  const report={status:apply?'PENDING_ABSENCE_VERIFIED_READY_TO_COMMIT':'V12_ABSENT_PENDING_DRY_RUN_PASS',sha,pendingClientOrderId:pending.clientOrderId,reservationId,rounds,stateBeforeSha256:hash(stateBytes),killBeforeSha256:hash(killBytes),ordersSent:0,cancelsSent:0,positionChangesSent:0,newStrategyEnabled:false};
  await writeFile(prefix+'-evidence.json',JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  if(apply){
   await writeFile(prefix+'-state-before.json',stateBytes,{mode:0o600,flag:'wx'});
   await writeFile(prefix+'-registry-before.json',JSON.stringify(currentRegistry,null,2)+'\n',{mode:0o600,flag:'wx'});
   const attributes=await stat(statePath),temporary=statePath+'.reconcile-'+process.pid+'.tmp';
   await writeFile(temporary,JSON.stringify(recovered,null,2)+'\n',{mode:attributes.mode&0o777});
   JSON.parse(await readFile(temporary,'utf8'));
   await handle.document();stopped();
   fail(hash(await readFile(statePath))===hash(stateBytes),'FINAL_STATE_COMPARE_AND_SWAP_FAILED');
   fail(hash(await readFile(killPath))===hash(killBytes),'FINAL_HOLD_CHANGED');
   await rename(temporary,statePath);
   await normalizeLiveStateOwnership(statePath,{label:'V12_ABSENT_PENDING_HOLD_RETAINED'});
   // State commits first: if releasing this proven reservation fails, HOLD remains
   // and stale over-reservation stays conservative. Never enable orders here.
   fail(await releasePendingExposure(reservationId,registryPath),'MATCHED_RESERVATION_RELEASE_FAILED');
   await normalizeLiveSharedStateOwnership(registryPath,{label:'V12_ABSENT_PENDING_RESERVATION_RELEASE'});
   const registryMetadata=await stat(registryPath);
   fail((registryMetadata.mode&0o777)===0o660,'POST_SHARED_REGISTRY_MODE_INVALID');
   const after=await new FileV12X1AllRunnerStateStore(statePath,'LIVE').load();
   fail(!after.pending&&after.lastCompletedIdempotencyKey===pending.idempotencyKey&&after.killSwitch?.active===true&&after.manualReview===state.manualReview,'POST_STATE_INVARIANT_FAILED');
   const regAfter=await readPendingExposureRegistry(registryPath);
   fail(regAfter.entries.find(e=>e.reservationId===reservationId)?.status==='RELEASED','POST_RESERVATION_INVARIANT_FAILED');
   fail(hash(await readFile(killPath))===hash(killBytes),'POST_HOLD_INVARIANT_FAILED');
   fail((await realpath('/home/deploy/disdex-trading/current'))===current,'POST_RUNTIME_CHANGED');
   stopped();
   report.status='V12_ABSENT_PENDING_RECONCILED_HOLD_RETAINED';
   report.stateAfterSha256=hash(await readFile(statePath));report.sharedKillSwitchUnchanged=true;report.runnerRestarted=false;
   await writeFile(prefix+'-result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  console.log(JSON.stringify({...report,rounds:rounds.map(r=>({observedAt:r.observedAt,lookup:r.lookup,trades:r.trades.length,positions:r.positions.filter(p=>Number(p.positionAmt)!==0),orders:r.orders})),evidencePrefix:prefix}));
 }finally{await handle.release();}
}
main().catch(e=>{console.error(JSON.stringify({status:'V12_ABSENT_PENDING_RECONCILE_FAIL_CLOSED',reason:e instanceof Error?e.message:String(e),ordersSent:0,cancelsSent:0,positionChangesSent:0,newStrategyEnabled:false}));process.exitCode=2;});
