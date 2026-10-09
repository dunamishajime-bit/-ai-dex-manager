const requireFact=(ok,reason)=>{if(!ok)throw Error('V12_ABSENT_PENDING_'+reason);};
const finite=n=>n!==null&&n!==''&&Number.isFinite(Number(n));
function fingerprint(round){
 requireFact(Array.isArray(round.positions)&&Array.isArray(round.orders)&&Array.isArray(round.trades),'ACCOUNT_ARRAYS_REQUIRED');
 const positions=round.positions.map(p=>{requireFact(typeof p.symbol==='string'&&finite(p.positionAmt)&&finite(p.entryPrice),'POSITION_INVALID');return [p.symbol,Number(p.positionAmt),Number(p.entryPrice)];}).filter(p=>p[1]!==0).sort((a,b)=>a[0].localeCompare(b[0]));
 const orders=round.orders.map(o=>{requireFact(typeof o.symbol==='string'&&typeof o.clientOrderId==='string'&&finite(o.origQty)&&Number(o.origQty)>0,'ORDER_INVALID');return [o.symbol,o.clientOrderId,o.status,o.side,o.type,o.reduceOnly,Number(o.origQty),o.stopPrice??null];}).sort((a,b)=>a[1].localeCompare(b[1]));
 return JSON.stringify({positions,orders});
}
export function prepareAbsentPendingReconciliation(state,rounds,sha,now=Date.now()){
 requireFact(/^[a-f0-9]{40}$/.test(sha)&&state.runtimeCommitSha===sha,'RUNTIME_MISMATCH');
 requireFact(state.schema==='v12-x1-all-runner-state/v2'&&state.strategyId==='V12_X1.00_ALL'&&state.mode==='LIVE','STATE_INVALID');
 requireFact(!state.active&&Array.isArray(state.activePositions??[])&&(state.activePositions??[]).length===0,'LOCAL_POSITION_PRESENT');
 const p=state.pending;
 requireFact(p&&p.action==='ENTRY'&&typeof p.symbol==='string'&&p.symbol.endsWith('USDT')&&p.clientOrderId===p.idempotencyKey&&p.clientOrderId.startsWith('v12-')&&finite(p.quantity)&&Number(p.quantity)>0&&['LONG','SHORT'].includes(p.side),'ENTRY_INVALID');
 requireFact(finite(p.createdAt)&&now-p.createdAt>=120000&&now-p.createdAt<=7*86400000,'ENTRY_AGE_INVALID');
 requireFact(state.killSwitch?.active===true&&typeof state.manualReview==='string'&&state.manualReview.length>0,'PROTECTION_REQUIRED');
 requireFact(Array.isArray(rounds)&&rounds.length===3,'THREE_ROUNDS_REQUIRED');
 let identity;
 for(let i=0;i<rounds.length;i++){
  const r=rounds[i];requireFact(finite(r.observedAt)&&now-r.observedAt>=-5000&&now-r.observedAt<=90000&&(i===0||r.observedAt>rounds[i-1].observedAt),'EVIDENCE_TIME_INVALID');
  requireFact(finite(r.serverTime)&&Math.abs(r.serverTime-r.observedAt)<=30000,'VENUE_CLOCK_INVALID');
  requireFact(r.lookup?.status===400&&r.lookup?.code===-2013&&r.lookup.symbol===p.symbol&&r.lookup.clientOrderId===p.clientOrderId,'LOOKUP_NOT_EXACT_ABSENT');
  requireFact(finite(r.tradeStartMs)&&r.tradeStartMs<=p.createdAt-120000&&finite(r.tradeEndMs)&&r.tradeEndMs>=r.observedAt-30000,'TRADE_WINDOW_INCOMPLETE');
  const found=fingerprint(r);if(identity===undefined)identity=found;requireFact(identity===found,'ACCOUNT_CHANGED');
  requireFact(!r.positions.some(x=>x.symbol===p.symbol&&Number(x.positionAmt)!==0),'VENUE_POSITION_PRESENT');
  requireFact(!r.orders.some(x=>x.symbol===p.symbol),'VENUE_ORDER_PRESENT');
  requireFact(r.trades.length===0,'VENUE_FILL_PRESENT');
 }
 requireFact(now-rounds.at(-1).observedAt<=10000,'FINAL_EVIDENCE_STALE');
 return {...state,pending:undefined,lastCompletedIdempotencyKey:p.idempotencyKey,updatedAt:now,reconciliationStatus:'MANUAL_REVIEW'};
}

export function matchingPendingExposure(entries,pending,sha){
 requireFact(Array.isArray(entries),'RESERVATION_ARRAY_REQUIRED');
 const same=entries.filter(e=>e.strategyId==='V12_X1.00_ALL'&&e.symbol===pending.symbol&&e.status==='PENDING');
 requireFact(same.length===1,'ONE_PENDING_RESERVATION_REQUIRED');
 const e=same[0];
 requireFact(typeof e.reservationId==='string'&&e.runtimeSha===sha&&e.side===pending.side&&finite(e.createdAt)&&Math.abs(e.createdAt-pending.createdAt)<=2000&&finite(e.gross)&&Math.abs(e.gross-pending.requestedGross)<=1e-9&&finite(e.notionalUsd)&&Math.abs(e.notionalUsd-pending.quantity*pending.expectedPrice)<=1e-6,'RESERVATION_IDENTITY_MISMATCH');
 return e.reservationId;
}
