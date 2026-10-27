/** One-shot NEAR reduction; imports the already-certified 53a V4 runtime unchanged. */
import {readFileSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {assertNearState,assertNearVenue,installNearOnlyGuards,nearClosed,NEAR_LEG,NEAR_STOP,V4_SHA} from '../lib/v12-v4-near-only-guard.mjs';

const root='/home/deploy/disdex-trading/releases/'+V4_SHA;
const ack='I_AUTHORIZE_V4_OPERATOR_EXIT_NEAR_ONLY';
function arg(name:string){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;}
function requireRelease(){
 const operatorSha=String(arg('--operator-sha')??'').toLowerCase();
 const cwd=realpathSync(process.cwd());
 if(!/^[a-f0-9]{40}$/.test(operatorSha)||cwd!=='/home/deploy/disdex-trading/releases/'+operatorSha||
  realpathSync(dirname(process.argv[1]))!==join(cwd,'scripts')||
  readFileSync(join(cwd,'.disdex-release-sha'),'utf8').trim()!==operatorSha||
  readFileSync(join(root,'.disdex-release-sha'),'utf8').trim()!==V4_SHA||
  process.env.DISDEX_RELEASE_SHA!==V4_SHA||process.env.V12_V4_LIVE_ACK!==V4_SHA||arg('--ack')!==ack)
  throw Error('V4_NEAR_OPERATOR_RELEASE_OR_ACK_INVALID');
 return operatorSha;
}
async function main(){
 const operatorSha=requireRelease();
 const [{buildV4ProductionRuntime},{assertV4EntrySafety},{readPendingExposureRegistry},{readV4ProductionCertificate},{readV4TimeStopApproval},{advanceV4Protection}]=await Promise.all([
  import(root+'/scripts/v12-v4-production-runner.ts'),import(root+'/lib/v12-v4-entry-safety.ts'),
  import(root+'/lib/disdex-pending-exposure-registry.ts'),
  import(root+'/lib/v12-v4-certified-gates.ts'),import(root+'/lib/v12-v4-time-stop-approval.ts'),
  import(root+'/lib/v12-v4-execution-store.ts'),
 ]);
 let runtime:any;
 const authorize=async(input:any)=>{
  assertNearState(runtime.store.read());
  if(input.legId!==NEAR_LEG||input.symbol!=='NEARUSDT'||input.positionSide!=='SHORT'||input.quantity!==2)
   throw Error('V4_NEAR_OPERATOR_AUTHORIZATION_SCOPE');
 };
 runtime=await buildV4ProductionRuntime({operatorExitLegIds:new Set([NEAR_LEG]),authorizeOperatorExit:authorize});
 const client=runtime.engine.deps.client;
 const safety=async(lease:any)=>{
  await readV4ProductionCertificate(V4_SHA);
  await readV4TimeStopApproval(V4_SHA);
  await assertV4EntrySafety();
  const registry=await readPendingExposureRegistry(String(process.env.DISDEX_PENDING_EXPOSURE_REGISTRY_PATH));
  if(registry.entries.some((x:any)=>['PENDING','SUBMITTED','UNKNOWN'].includes(x.status)))
   throw Error('V4_NEAR_OPERATOR_PENDING_EXPOSURE');
  const phase=nearClosed(runtime.store.read())?'CLOSED':'OPEN';
  for(let i=0;i<3;i++){
   await lease.renew();
   const [positions,orders]=await Promise.all([client.getPositions(),client.getOpenOrders()]);
   assertNearVenue(positions,orders,phase);
  }
  await lease.renew();
 };
 installNearOnlyGuards(runtime.engine,safety);
 const guarded=runtime.engine.deps.assertAuthority;
 runtime.engine.deps.assertAuthority=async(command:any)=>{await assertV4EntrySafety();return guarded(command);};
 const lease=await runtime.engine.deps.accountLock.acquire('V12_V4_NEAR_OPERATOR_PREFLIGHT');
 if(!lease)throw Error('V4_NEAR_OPERATOR_ACCOUNT_LOCK_BUSY');
 await lease.release();
 console.log(JSON.stringify({status:'V4_NEAR_OPERATOR_DRY_RUN_PASS',operatorSha,v4Sha:V4_SHA,signedRounds:3,ordersSent:0,cancelsSent:0}));
 if(!process.argv.includes('--apply'))return;
 const wasClosed=nearClosed(runtime.store.read());
 const result=await runtime.engine.tick();
 if((!wasClosed&&result.status!=='exited')||(wasClosed&&!['exited','observing'].includes(result.status)))throw Error('V4_NEAR_OPERATOR_EXIT_INCOMPLETE:'+result.reason);
 let doc=runtime.store.read(),leg=doc.state.legs[NEAR_LEG],protection=doc.protections[NEAR_LEG];
 const [positions,orders]=await Promise.all([client.getPositions(),client.getOpenOrders()]);
 assertNearVenue(positions,orders,'CLOSED');
 assertNearState(doc);
 if(protection?.phase!=='CLOSED'){
  if(orders.some((o:any)=>o.symbol==='NEARUSDT'))throw Error('V4_NEAR_OPERATOR_STOP_STILL_OPEN');
  const next=advanceV4Protection(doc,NEAR_LEG,'CLOSED',Date.now(),0);
  runtime.store.commit(doc.revision,next);
  doc=runtime.store.read();leg=doc.state.legs[NEAR_LEG];protection=doc.protections[NEAR_LEG];
 }
 assertNearState(doc);
 if(orders.some((o:any)=>o.symbol==='NEARUSDT')||Number(leg?.qty)!==0||leg?.status!=='CLOSED'||protection?.phase!=='CLOSED')
  throw Error('V4_NEAR_OPERATOR_POST_EXIT_RECONCILIATION_FAILED');
 const exits=Object.values(doc.intents).filter((i:any)=>i.legId===NEAR_LEG&&i.action==='EXIT') as any[];
 console.log(JSON.stringify({status:'V4_NEAR_OPERATOR_EXIT_SUCCESS',operatorSha,v4Sha:V4_SHA,
  nearPosition:0,nearOpenOrders:0,closedLeg:NEAR_LEG,stopRetired:NEAR_STOP,
  exitOrderIds:exits.map(i=>({clientOrderId:i.clientOrderId,venueOrderId:i.venueOrderId,stage:i.stage})),result}));
}
main().catch(e=>{console.error(JSON.stringify({status:'V4_NEAR_OPERATOR_FAILED_CLOSED',error:e instanceof Error?e.message:String(e)}));process.exitCode=2;});
