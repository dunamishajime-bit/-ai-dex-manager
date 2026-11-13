export const DOGE_LEG='DOGEUSDT:REC_Y06_REV_D0_T72:SHORT:1793181600000';
export const DOGE_STOP='v12-v4-98ded39746ed3502a4d7b0e26ef9';
export const V4_SHA='53a0be396719f0284af4e11b35c66a4ac7d58f79';
export const DOGE_QTY=226;
export const DOGE_ENTRY=0.08052;
export const DOGE_EXIT_TS=1793440800000;
export const DOGE_EXIT_PRICE=0.07505;

const near=(a,b)=>Number.isFinite(Number(a))&&Math.abs(Number(a)-Number(b))<=Math.max(1e-8,Math.abs(Number(b))*1e-7);
function fail(reason){throw Error('V4_DOGE_ONLY_'+reason);}

export function assertDogeVenueOpen(positions,orders){
 if(!Array.isArray(positions)||!Array.isArray(orders))fail('VENUE_READ_INVALID');
 const doge=positions.filter(p=>p.symbol==='DOGEUSDT');
 if(doge.some(p=>!Number.isFinite(Number(p.positionAmt))))fail('VENUE_POSITION_INVALID');
 const net=doge.reduce((n,p)=>n+Number(p.positionAmt),0);
 if(doge.length!==1||!near(net,-DOGE_QTY)||!near(doge[0].entryPrice,DOGE_ENTRY))fail('VENUE_POSITION_MISMATCH');
 const matches=orders.filter(o=>o.symbol==='DOGEUSDT');
 const stop=matches[0];
 if(matches.length!==1||stop?.clientOrderId!==DOGE_STOP||stop?.side!=='BUY'||stop?.type!=='STOP_MARKET'||
  stop?.reduceOnly!==true||stop?.status!=='NEW'||!near(stop?.origQty,DOGE_QTY)||!near(stop?.executedQty,0))
  fail('VENUE_STOP_MISMATCH');
}

export function assertDogeVenueFlatWithResidentStop(positions,orders){
 if(!Array.isArray(positions)||!Array.isArray(orders))fail('VENUE_READ_INVALID');
 const doge=positions.filter(p=>p.symbol==='DOGEUSDT');
 if(doge.some(p=>!Number.isFinite(Number(p.positionAmt))))fail('VENUE_POSITION_INVALID');
 const net=doge.reduce((n,p)=>n+Number(p.positionAmt),0);
 if(!near(net,0))fail('VENUE_NOT_FLAT');
 const matches=orders.filter(o=>o.symbol==='DOGEUSDT');
 const stop=matches[0];
 if(matches.length!==1||stop?.clientOrderId!==DOGE_STOP||stop?.side!=='BUY'||stop?.type!=='STOP_MARKET'||
  stop?.reduceOnly!==true||stop?.status!=='NEW'||!near(stop?.origQty,DOGE_QTY)||!near(stop?.executedQty,0))
  fail('FLAT_STOP_MISMATCH');
}

export function assertDogeVenueClosed(positions,orders){
 if(!Array.isArray(positions)||!Array.isArray(orders))fail('VENUE_READ_INVALID');
 const doge=positions.filter(p=>p.symbol==='DOGEUSDT');
 if(doge.some(p=>!Number.isFinite(Number(p.positionAmt))))fail('VENUE_POSITION_INVALID');
 const net=doge.reduce((n,p)=>n+Number(p.positionAmt),0);
 if(!near(net,0))fail('VENUE_NOT_FLAT');
 if(orders.some(o=>o.symbol==='DOGEUSDT'))fail('VENUE_DOGE_ORDER_REMAINS');
}

export function assertDogeState(doc){
 if(doc?.releaseSha!==V4_SHA)fail('SHA_MISMATCH');
 const legs=Object.values(doc?.state?.legs??{}).filter(l=>Number(l.qty)>0||l.status==='PENDING_ENTRY'||l.status==='PENDING_EXIT');
 const leg=legs.find(l=>l?.id===DOGE_LEG);
 const protection=doc?.protections?.[DOGE_LEG];
 const stopIntent=doc?.intents?.[DOGE_STOP];
 const durable=doc?.state?.legs?.[DOGE_LEG];
 if(!legs.length&&durable?.status==='CLOSED'&&near(durable.qty,0)){
  const exits=Object.values(doc?.intents??{}).filter(x=>x.action==='EXIT'&&x.legId===DOGE_LEG);
  if(exits.length!==1||exits[0].stage!=='TERMINAL'||protection?.phase!=='CLOSED')fail('CLOSED_STATE_MISMATCH');
  return;
 }
 if(!leg||legs.length!==1||!['OPEN','PENDING_EXIT'].includes(leg.status)||!near(leg.qty,DOGE_QTY)||
  leg.candidate?.symbol!=='DOGEUSDT'||leg.candidate?.route!=='REC_Y06_REV_D0_T72'||leg.candidate?.effectiveSide!=='SHORT')
  fail('LEG_MISMATCH');
 const plan=leg.plannedExit;
 if(plan?.reason!=='TIME'||plan?.priceModelOnly!==true||Number(plan?.exitTs)!==DOGE_EXIT_TS||!near(plan?.price,DOGE_EXIT_PRICE))
  fail('PLANNED_EXIT_MISMATCH');
 if((leg.status==='OPEN'&&protection?.phase!=='STOP_CONFIRMED')||
  (leg.status==='PENDING_EXIT'&&!['STOP_CONFIRMED','EXIT_PENDING'].includes(protection?.phase))||
  !near(protection?.protectedQty,DOGE_QTY)||protection?.stopClientOrderId!==DOGE_STOP)
  fail('STOP_PROTECTION_MISMATCH');
 if(stopIntent?.legId!==DOGE_LEG||stopIntent?.action!=='STOP'||!['ACKNOWLEDGED','TERMINAL'].includes(stopIntent?.stage)||
  !near(stopIntent?.command?.quantity,DOGE_QTY))
  fail('STOP_INTENT_MISMATCH');
 const unexpected=Object.entries(doc?.intents??{}).filter(([id,x])=>id!==DOGE_STOP&&x?.stage!=='TERMINAL'&&!['EXIT'].includes(x?.action));
 if(unexpected.length)fail('UNRESOLVED_NON_EXIT_INTENT');
 const exits=Object.values(doc?.intents??{}).filter(x=>x?.action==='EXIT'&&x?.stage!=='TERMINAL');
 if(leg.status==='OPEN'&&exits.length)fail('UNEXPECTED_EXIT_INTENT');
 if(leg.status==='PENDING_EXIT'){
  if(exits.length!==1||exits[0].legId!==DOGE_LEG||exits[0].command?.symbol!=='DOGEUSDT'||
    exits[0].command?.positionSide!=='SHORT'||!near(exits[0].command?.quantity,DOGE_QTY))
    fail('EXIT_INTENT_MISMATCH');
 }
}

export function installDogeOnlyGuards(engine,preflight=async()=>{}){
 const d=engine.deps;
 const lock=d.accountLock,authority=d.assertAuthority,adapter=d.adapter;
 const acquire=lock.acquire.bind(lock),cancel=adapter.cancel.bind(adapter);
 d.accountLock={...lock,acquire:async(...args)=>{
  const lease=await acquire(...args); if(!lease)return lease;
  try{
   assertDogeState(d.store.read());
   await preflight(lease);
   assertDogeState(d.store.read());
   return lease;
  }catch(error){await lease.release();throw error;}
 }};
 d.assertAuthority=async command=>{
  const leg=d.store.read()?.state?.legs?.[DOGE_LEG];
  if(command?.legId!==DOGE_LEG||command?.action!=='EXIT'||command?.sequence!==0||
    command?.symbol!=='DOGEUSDT'||command?.positionSide!=='SHORT'||!near(command?.quantity,DOGE_QTY)||
    !['OPEN','PENDING_EXIT'].includes(leg?.status)||!near(leg?.qty,DOGE_QTY))
    fail('ORDER_SCOPE');
  if(leg.status==='PENDING_EXIT'){
   const exit=Object.values(d.store.read()?.intents??{}).find(x=>x?.action==='EXIT'&&x?.legId===DOGE_LEG&&x?.stage!=='TERMINAL');
   if(!exit||JSON.stringify(exit.command)!==JSON.stringify(command))fail('EXIT_INTENT_SCOPE');
  }
  return authority(command);
 };
 d.fetchDecision=async()=>fail('ENTRY_FORBIDDEN');
 adapter.cancel=async id=>{
  if(id!==DOGE_STOP)fail('CANCEL_SCOPE');
  const [positions,orders]=await Promise.all([d.client.getPositions('DOGEUSDT'),d.client.getOpenOrders('DOGEUSDT')]);
  assertDogeVenueFlatWithResidentStop(positions,orders);
  return cancel(id);
 };
}
