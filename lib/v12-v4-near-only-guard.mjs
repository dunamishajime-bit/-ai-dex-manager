export const NEAR_LEG='NEARUSDT:REC_X02_TIME_36H:SHORT:1792980000000';
export const NEAR_STOP='v12-v4-50ef46933e7018db365535fa70fd';
export const V4_SHA='53a0be396719f0284af4e11b35c66a4ac7d58f79';
const numeric=value=>(typeof value==='number'&&Number.isFinite(value))||
 (typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value)));
const near=(a,b)=>numeric(a)&&Math.abs(Number(a)-b)<1e-8;
function fail(reason){throw Error('V4_NEAR_ONLY_'+reason);}
function exactStop(o){
 return o?.clientOrderId===NEAR_STOP&&o.side==='BUY'&&o.type==='STOP_MARKET'&&
  o.reduceOnly===true&&o.status==='NEW'&&near(o.origQty,2)&&near(o.executedQty,0)&&near(o.stopPrice,4.874);
}
function exactExitCommand(c){
 return c?.legId===NEAR_LEG&&c.action==='EXIT'&&c.sequence===0&&c.symbol==='NEARUSDT'&&
  c.positionSide==='SHORT'&&near(c.quantity,2)&&Number.isFinite(Number(c.price))&&Number(c.price)>0&&
  Number.isFinite(Number(c.signalTs));
}
export function nearClosed(doc){
 const leg=doc?.state?.legs?.[NEAR_LEG];
 return leg?.status==='CLOSED'&&near(leg.qty,0);
}

export function assertNearVenue(positions,orders,phase='OPEN'){
 if(!Array.isArray(positions)||!Array.isArray(orders))fail('VENUE_READ_INVALID');
 const nearRows=positions.filter(p=>p.symbol==='NEARUSDT');
 if(nearRows.some(p=>!numeric(p.positionAmt)))fail('VENUE_POSITION_MISMATCH');
 const net=nearRows.reduce((n,p)=>n+Number(p.positionAmt),0);
 if(phase==='CLOSED'){
  if(nearRows.length!==1||!near(nearRows[0].positionAmt,0))fail('VENUE_NOT_FLAT');
  const aave=positions.filter(p=>p.symbol==='AAVEUSDT');
  if(aave.some(p=>!near(p.positionAmt,0)))fail('AAVE_NOT_FLAT');
  const active=orders.filter(o=>o.symbol==='NEARUSDT');
  if(active.length>1||(active.length===1&&!exactStop(active[0])))fail('VENUE_POST_EXIT_ORDER_MISMATCH');
  return;
 }
 if(nearRows.length!==1||!near(net,-2))fail('VENUE_POSITION_MISMATCH');
 const aave=positions.filter(p=>p.symbol==='AAVEUSDT');
 if(aave.some(p=>!near(p.positionAmt,0)))fail('AAVE_NOT_FLAT');
 const matches=orders.filter(o=>o.symbol==='NEARUSDT'),o=matches[0];
 if(matches.length!==1||o.clientOrderId!==NEAR_STOP||o.side!=='BUY'||o.type!=='STOP_MARKET'||
   o.reduceOnly!==true||o.status!=='NEW'||!near(o.origQty,2)||!near(o.executedQty,0)||!near(o.stopPrice,4.874))fail('VENUE_STOP_MISMATCH');
}

// Read under the shared account lease before the engine performs recovery.
export function assertNearState(doc){
 if(doc?.releaseSha!==V4_SHA)fail('SHA_MISMATCH');
 const legs=Object.values(doc?.state?.legs??{}).filter(l=>Number(l.qty)>0||l.status==='PENDING_ENTRY'||l.status==='PENDING_EXIT');
 const leg=legs[0],p=doc?.protections?.[NEAR_LEG],i=doc?.intents?.[NEAR_STOP];
 const closed=doc?.state?.legs?.[NEAR_LEG];
 if(!legs.length&&closed?.status==='CLOSED'&&near(closed.qty,0)){
  const exits=Object.values(doc.intents??{}).filter(x=>x.action==='EXIT'&&x.legId===NEAR_LEG);
  if(exits.length!==1||exits[0].stage!=='TERMINAL'||!exactExitCommand(exits[0].command))fail('CLOSED_STATE_MISMATCH');
  if(!p||!['STOP_CONFIRMED','EXIT_PENDING','CLOSED'].includes(p.phase)||
   (p.phase==='CLOSED'?(p.protectedQty!==0):!(near(p.protectedQty,2)&&p.stopClientOrderId===NEAR_STOP)))
   fail('CLOSED_PROTECTION_STATE_MISMATCH');
  const invalid=Object.entries(doc.intents??{}).some(([id,x])=>x.stage!=='TERMINAL'&&id!==NEAR_STOP);
  if(invalid||!i||i.legId!==NEAR_LEG||i.action!=='STOP'||!['ACKNOWLEDGED','TERMINAL'].includes(i.stage)||
   !near(i.command?.quantity,2)||!near(i.command?.price,4.874))fail('CLOSED_INTENT_MISMATCH');
  return;
 }
 if(legs.length!==1||leg?.id!==NEAR_LEG||!['OPEN','PENDING_EXIT'].includes(leg.status)||!near(leg.qty,2)||
  leg.candidate?.symbol!=='NEARUSDT'||leg.candidate?.route!=='REC_X02_TIME_36H'||leg.candidate?.effectiveSide!=='SHORT')fail('LEG_MISMATCH');
 const plan=leg.plannedExit;
 if(plan?.reason!=='TIME'||plan.priceModelOnly!==true||plan.exitTs!==1793109600000||!near(plan.price,4.512))fail('PLANNED_EXIT_MISMATCH');
 if((leg.status==='OPEN'&&p?.phase!=='STOP_CONFIRMED')||(leg.status==='PENDING_EXIT'&&!['STOP_CONFIRMED','EXIT_PENDING'].includes(p?.phase))||
  !near(p.protectedQty,2)||p.stopClientOrderId!==NEAR_STOP||
  i?.legId!==NEAR_LEG||i.action!=='STOP'||!['ACKNOWLEDGED','TERMINAL'].includes(i.stage)||!near(i.command?.quantity,2)||!near(i.command?.price,4.874))fail('STOP_MISMATCH');
 const outstanding=Object.entries(doc.intents??{}).filter(([id,x])=>x.stage!=='TERMINAL'&&id!==NEAR_STOP&&x.action!=='EXIT');
 if(leg.status==='OPEN'&&Object.values(doc.intents??{}).some(x=>x.action==='EXIT'&&x.stage!=='TERMINAL'))fail('UNEXPECTED_EXIT_INTENT');
 if(leg.status==='PENDING_EXIT'){
  const exits=Object.values(doc.intents??{}).filter(x=>x.action==='EXIT'&&x.legId===NEAR_LEG&&x.stage!=='TERMINAL');
  if(exits.length!==1||exits[0].command?.symbol!=='NEARUSDT'||exits[0].command?.positionSide!=='SHORT'||!near(exits[0].command?.quantity,2))fail('EXIT_INTENT_MISMATCH');
 }
 if(outstanding.length)fail('UNRESOLVED_INTENT');
}

// These wrappers narrow the existing certified engine; they never grant authority.
export function installNearOnlyGuards(engine,preflight=async()=>{}){
 const d=engine.deps,lock=d.accountLock,authority=d.assertAuthority,adapter=d.adapter;
 const acquire=lock.acquire.bind(lock),cancel=adapter.cancel.bind(adapter),executeExit=adapter.executeExit.bind(adapter);
 const initialExitIds=new Set();
 d.accountLock={...lock,acquire:async(...args)=>{
  const lease=await acquire(...args);if(!lease)return lease;
  try{assertNearState(d.store.read());await preflight(lease);assertNearState(d.store.read());return lease;}catch(e){await lease.release();throw e;}
 }};
 d.assertAuthority=async command=>{
  const leg=d.store.read()?.state?.legs?.[NEAR_LEG];
  if(command?.legId!==NEAR_LEG||command.action!=='EXIT'||command.sequence!==0||command.symbol!=='NEARUSDT'||
   command.positionSide!=='SHORT'||!near(command.quantity,2)||!['OPEN','PENDING_EXIT'].includes(leg?.status)||!near(leg?.qty,2))fail('ORDER_SCOPE');
  if(leg.status==='PENDING_EXIT'){
   const exit=Object.values(d.store.read().intents??{}).find(x=>x.action==='EXIT'&&x.legId===NEAR_LEG&&x.stage!=='TERMINAL');
   if(!exit||JSON.stringify(exit.command)!==JSON.stringify(command))fail('EXIT_INTENT_SCOPE');
   if(exit.stage==='PREPARED')initialExitIds.add(exit.clientOrderId);
  }else{
   const exit=Object.values(d.store.read().intents??{}).find(x=>x.action==='EXIT'&&x.legId===NEAR_LEG);
   if(exit?.stage==='PREPARED')initialExitIds.add(exit.clientOrderId);
  }
  command.noAmbiguousRetry=true;
  return authority(command);
 };
 d.fetchDecision=async()=>{
  if(nearClosed(d.store.read()))return {capturedAtMs:Date.now(),errors:[],candidates:[],orderEnabled:false,realOrderEnabledV4:0,tradingMutation:0};
  fail('ENTRY_FORBIDDEN');
 };
 adapter.executeExit=async input=>{
  const intent=d.store.read().intents?.[input?.clientOrderId];
  if(intent?.legId===NEAR_LEG&&intent.action==='EXIT'){
   if(intent.stage==='SUBMITTING'&&initialExitIds.delete(input.clientOrderId))return executeExit(input);
   fail('AMBIGUOUS_EXIT_REQUIRES_SIGNED_READBACK');
  }
  return executeExit(input);
 };
 adapter.cancel=async id=>{
  if(id!==NEAR_STOP)fail('CANCEL_SCOPE');
  const [positions,orders]=await Promise.all([d.client.getPositions('NEARUSDT'),d.client.getOpenOrders('NEARUSDT')]);
  assertNearVenue(positions,orders,'CLOSED');
  return cancel(id);
 };
}
