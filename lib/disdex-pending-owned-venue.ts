import {observeResidentProtection,type ResidentStopOwnerPins,type V4OwnerProof} from './resident-stop-observation';

type Row=Record<string,any>;
const STOCK=/^(AMZN|META|MSFT|NVDA|TSLA)USDT$/;
const V52_ID='DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96';
const OWNERS=['V12','Q102','PENGU','V52','FET','HYPE','IDLE','RESIDUAL'];
function requireProof(test:unknown,code:string):asserts test {
 if(!test)throw Error('PENDING_OWNER_'+code);
}
function amount(raw:unknown):number {
 requireProof((typeof raw==='number'||typeof raw==='string')
   &&!(typeof raw==='string'&&(!raw.trim()||!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())))
   &&Number.isFinite(Number(raw)),'NUMBER_INVALID');
 return Number(raw);
}
function fresh(at:unknown,now:number,age:number):boolean {
 return typeof at==='number'&&Number.isSafeInteger(at)&&at>0&&at<=now&&now-at<=age;
}

/** Ownership proof only; never grants order permission or modifies reservations. */
export function validateOwnedPendingVenue(input:{positions:Row[];orders:Row[];states:Record<string,any>;
 runtimeSha:string;ownerPins:ResidentStopOwnerPins;now:number;v4Proofs?:V4OwnerProof[];
 q102Proofs?:V4OwnerProof[];v52State?:Row;margin?:Row}) {
 requireProof(Number.isSafeInteger(input.now)&&input.now>0&&/^[a-f0-9]{40}$/.test(input.runtimeSha),'IDENTITY_INVALID');
 requireProof(Array.isArray(input.positions)&&Array.isArray(input.orders),'ARRAY_INVALID');
 requireProof(input.ownerPins&&typeof input.ownerPins==='object'
   &&Object.keys(input.ownerPins).length===OWNERS.length
   &&OWNERS.every(key=>typeof (input.ownerPins as Row)[key]==='string'
     &&/^[a-f0-9]{40}$/.test((input.ownerPins as Row)[key])),'PIN_INVALID');
 requireProof(input.states&&typeof input.states==='object'&&!Array.isArray(input.states),'STATE_INVALID');
 const active=input.positions.filter(row=>Math.abs(amount(row?.positionAmt))>1e-12);
 const symbols=new Set<string>();
 for(const position of active){
  requireProof(typeof position.symbol==='string'&&/^[A-Z0-9]+USDT$/.test(position.symbol),'SYMBOL_INVALID');
  requireProof(!symbols.has(position.symbol),'DUPLICATE_SYMBOL_OR_HEDGE');symbols.add(position.symbol);
  requireProof(Math.abs(amount(position.notional))>0,'NOTIONAL_INVALID');
 }
 const ids=new Set<string>();
 for(const order of input.orders){
  requireProof(typeof order?.clientOrderId==='string'&&!!order.clientOrderId&&!ids.has(order.clientOrderId),'ORDER_ID_INVALID');
  ids.add(order.clientOrderId);
  requireProof(order.type==='STOP_MARKET'&&order.status==='NEW'&&order.reduceOnly===true
    &&amount(order.executedQty)===0&&amount(order.origQty)>0&&amount(order.stopPrice)>0,'STOP_UNSUPPORTED_OR_PARTIAL');
  requireProof(symbols.has(order.symbol)&&!STOCK.test(order.symbol),'ORPHAN_OR_UNSUPPORTED_STOCK_ORDER');
 }
 const states=Object.fromEntries(Object.entries(input.states).filter(([,state])=>state&&fresh(state.updatedAt,input.now,300000)));
 const observation=observeResidentProtection(active,input.orders,states,input.runtimeSha,input.now,
   input.v4Proofs??[],input.q102Proofs??[],input.ownerPins);
 requireProof(observation.ok===true&&observation.orphanStops.length===0,'OBSERVATION_INCOMPLETE');
 for(const position of active.filter(row=>!STOCK.test(row.symbol))){
  const matches=observation.positions.filter(row=>row.symbol===position.symbol);
  requireProof(matches.length===1&&matches[0].protected===true&&matches[0].readBackStatus==='VERIFIED','CRYPTO_PROTECTION_UNVERIFIED');
  requireProof(['V12_V4','Q102','PENGU','FET','HYPE','IDLE','RESIDUAL'].includes(matches[0].strategy),'UNKNOWN_STRATEGY');
 }
 const stocks=active.filter(row=>STOCK.test(row.symbol));
 if(stocks.length){
  const state=input.v52State;
  requireProof(state&&state.schemaVersion===3&&state.strategyId===V52_ID
    &&state.runtimeCommitSha===input.ownerPins.V52
    &&(!state.runtimeSha||state.runtimeSha===input.ownerPins.V52)
    &&fresh(state.updatedAt,input.now,300000)&&state.pendingOrder==null
    &&state.positions&&typeof state.positions==='object'&&!Array.isArray(state.positions),'STOCK_STATE_UNVERIFIED');
  const margin=input.margin;
  requireProof(margin&&margin.stage==='HEALTHY'&&margin.ordersAllowed===true&&fresh(margin.checkedAt,input.now,120000),'STOCK_MARGIN_UNVERIFIED');
  const expected=new Map<string,number>();const entries=new Set<string>();
  for(const [slot,position] of Object.entries(state.positions) as [string,Row][]){
   requireProof(['V11_EQ','V50_POST_OPEN_BASIS'].includes(slot)&&position?.strategy===slot,'STOCK_SLOT_INVALID');
   requireProof(typeof position.symbol==='string'&&STOCK.test(position.symbol+'USDT'),'STOCK_SYMBOL_INVALID');
   const id=position.entryClientOrderId;
   requireProof(typeof id==='string'&&/^(stock-v11eq-aster-only-|stock-v52-).+/.test(id)
     &&id===position.positionId&&!entries.has(id),'STOCK_ENTRY_ID_INVALID');entries.add(id);
   requireProof(['BUY','SELL'].includes(position.asterOpenSide)&&amount(position.asterQty)>0,'STOCK_QUANTITY_INVALID');
   const symbol=position.symbol+'USDT';
   expected.set(symbol,(expected.get(symbol)??0)+amount(position.asterQty)*(position.asterOpenSide==='BUY'?1:-1));
  }
  requireProof(expected.size===stocks.length&&stocks.every(row=>expected.has(row.symbol)),'STOCK_OWNER_SET_MISMATCH');
  for(const position of stocks){
   const actual=amount(position.positionAmt),owned=expected.get(position.symbol)!;
   requireProof(Math.abs(actual-owned)<=Math.max(1e-8,Math.abs(actual)*1e-9),'STOCK_OWNER_QUANTITY_MISMATCH');
  }
 }
 return {positionCount:active.length,openOrderCount:input.orders.length,ownershipVerified:true as const};
}
