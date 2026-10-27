export const NEAR_LEG='NEARUSDT:REC_X02_TIME_36H:SHORT:1792980000000';
export const NEAR_STOP='v12-v4-50ef46933e7018db365535fa70fd';
export const V4_SHA='53a0be396719f0284af4e11b35c66a4ac7d58f79';
const near=(a,b)=>Number.isFinite(Number(a))&&Math.abs(Number(a)-b)<1e-8;
function fail(reason){throw Error('V4_NEAR_ONLY_'+reason);}

export function assertNearVenue(positions,orders){
 if(!Array.isArray(positions)||!Array.isArray(orders))fail('VENUE_READ_INVALID');
 const nearRows=positions.filter(p=>p.symbol==='NEARUSDT');
 if(!nearRows.length||nearRows.some(p=>!Number.isFinite(Number(p.positionAmt)))||
   !near(nearRows.reduce((n,p)=>n+Number(p.positionAmt),0),-2))fail('VENUE_POSITION_MISMATCH');
 const aave=positions.filter(p=>p.symbol==='AAVEUSDT');
 if(aave.some(p=>!near(p.positionAmt,0)))fail('AAVE_NOT_FLAT');
 const matches=orders.filter(o=>o.symbol==='NEARUSDT'),o=matches[0];
 if(matches.length!==1||o.clientOrderId!==NEAR_STOP||o.side!=='BUY'||o.type!=='STOP_MARKET'||
   o.reduceOnly!==true||o.status!=='NEW'||!near(o.origQty,2)||!near(o.executedQty,0)||!near(o.stopPrice,4.874))fail('VENUE_STOP_MISMATCH');
}

// Read under the shared account lease before the engine performs recovery.
export function assertNearState(doc){
 if(doc?.releaseSha!==V4_SHA)fail('SHA_MISMATCH');
 const legs=Object.values(doc?.state?.legs??{}).filter(l=>Number(l.qty)>0||l.status==='PENDING_ENTRY');
 const leg=legs[0],p=doc?.protections?.[NEAR_LEG],i=doc?.intents?.[NEAR_STOP];
 if(legs.length!==1||leg?.id!==NEAR_LEG||leg.status!=='OPEN'||!near(leg.qty,2)||
  leg.candidate?.symbol!=='NEARUSDT'||leg.candidate?.route!=='REC_X02_TIME_36H'||leg.candidate?.effectiveSide!=='SHORT')fail('LEG_MISMATCH');
 const plan=leg.plannedExit;
 if(plan?.reason!=='TIME'||plan.priceModelOnly!==true||plan.exitTs!==1793109600000||!near(plan.price,4.512))fail('PLANNED_EXIT_MISMATCH');
 if(p?.phase!=='STOP_CONFIRMED'||!near(p.protectedQty,2)||p.stopClientOrderId!==NEAR_STOP||
  i?.legId!==NEAR_LEG||i.action!=='STOP'||i.stage!=='ACKNOWLEDGED'||!near(i.command?.quantity,2)||!near(i.command?.price,4.874))fail('STOP_MISMATCH');
 const outstanding=Object.entries(doc.intents??{}).filter(([id,x])=>x.stage!=='TERMINAL'&&id!==NEAR_STOP);
 if(outstanding.length)fail('UNRESOLVED_INTENT');
}

// These wrappers narrow the existing certified engine; they never grant authority.
export function installNearOnlyGuards(engine,preflight=async()=>{}){
 const d=engine.deps,lock=d.accountLock,authority=d.assertAuthority,adapter=d.adapter;
 const acquire=lock.acquire.bind(lock),cancel=adapter.cancel.bind(adapter);
 d.accountLock={...lock,acquire:async(...args)=>{
  const lease=await acquire(...args);if(!lease)return lease;
  try{assertNearState(d.store.read());await preflight(lease);assertNearState(d.store.read());return lease;}catch(e){await lease.release();throw e;}
 }};
 d.assertAuthority=async command=>{
  const leg=d.store.read()?.state?.legs?.[NEAR_LEG];
  if(command?.legId!==NEAR_LEG||command.action!=='EXIT'||command.sequence!==0||command.symbol!=='NEARUSDT'||
   command.positionSide!=='SHORT'||!near(command.quantity,2)||leg?.status!=='OPEN'||!near(leg.qty,2))fail('ORDER_SCOPE');
  return authority(command);
 };
 d.fetchDecision=async()=>fail('ENTRY_FORBIDDEN');
 adapter.cancel=async id=>{
  if(id!==NEAR_STOP)fail('CANCEL_SCOPE');
  const positions=await d.client.getPositions('NEARUSDT');
  const rows=positions.filter(p=>p.symbol==='NEARUSDT');
  if(!rows.length||rows.some(p=>!Number.isFinite(Number(p.positionAmt)))||
    !near(rows.reduce((n,p)=>n+Number(p.positionAmt),0),0))fail('NOT_SIGNED_FLAT');
  return cancel(id);
 };
}
