/**
 * H48 ASTER authenticated GET readback, isolated from any order API.
 *
 * The DirectTradeExecutor's production ASTER client uses authenticated
 * getPositions/getOpenOrders and venue-clock-verified account snapshots.
 * A test double is permitted only when this component is explicitly
 * injected for offline testing. This is NOT a signature over the returned
 * payload, and is not sufficient LIVE trade authorization.
 */
import type { AccountLockHandle, AccountLockDocument } from "./disdex-account-order-lock";
import type { DirectTradeExecutor, DirectPosition, DirectOpenOrder } from "./direct-trade-executor";
import type { H48SignedVenueSnapshot } from "./hype-h48-execution-journal";

const fail=(r:string):never=>{throw Error("H48_AUTHENTICATED_READ_"+r);};
function readLease(lease:AccountLockHandle):Promise<AccountLockDocument> {
  if(!lease||typeof lease.document!=="function")fail("NO_ACCOUNT_LEASE");
  return lease.document();
}
function validateLease(v:AccountLockDocument,now:number) {
  if(!v||v.schema!=="disdex-account-lock/v1"||v.accountScope!=="ASTER_FUTURES"
      ||typeof v.ownerId!=="string"||!v.ownerId||typeof v.leaseId!=="string"||!v.leaseId
      ||!Number.isSafeInteger(v.acquiredAt)||!Number.isSafeInteger(v.expiresAt)
      ||v.acquiredAt>now||v.expiresAt<=now)fail("LEASE_UNVERIFIED");
}
function checkedPositions(rows:DirectPosition[]):DirectPosition[] {
  if(!Array.isArray(rows))fail("POSITIONS_INVALID");
  for(const p of rows) {
    if(!p||typeof p.symbol!=="string"||!/^[A-Z0-9]+USDT$/.test(p.symbol)
      ||!Number.isFinite(p.quantity)||!Number.isFinite(p.entryPrice)
      ||!Number.isFinite(p.markPrice)||!Number.isFinite(p.notionalUsd)
      ||p.entryPrice<0||p.markPrice<0||p.notionalUsd<0
      ||!["LONG","SHORT","BOTH"].includes(p.positionSide))fail("POSITION_ROW_INVALID");
  }
  return rows.map(x=>({...x}));
}
function checkedOrders(rows:DirectOpenOrder[]):DirectOpenOrder[] {
  if(!Array.isArray(rows))fail("ORDERS_INVALID");
  for(const o of rows) {
    if(!o||typeof o.symbol!=="string"||!/^[A-Z0-9]+USDT$/.test(o.symbol)
      ||typeof o.clientOrderId!=="string"||!Number.isFinite(o.quantity)
      ||!Number.isFinite(o.executedQuantity)||o.quantity<0||o.executedQuantity<0
      ||o.executedQuantity>o.quantity+1e-12)fail("ORDER_ROW_INVALID");
  }
  return rows.map(x=>({...x}));
}

/**
 * Unconditionally perform all three authenticated GETs: positions, orders,
 * and account/venue-clock readback. No method capable of sending an order
 * is accepted. Leases must be held throughout the complete sequence.
 */
export async function readAuthenticatedH48Inventory(input:{
  executor:Pick<DirectTradeExecutor,"getPositions"|"getOpenOrders"|"getAccountSnapshot">;
  lease:AccountLockHandle;
  now?:()=>number;
}):Promise<H48SignedVenueSnapshot> {
  const clock=input.now??Date.now;
  const initialNow=clock();
  if(!Number.isSafeInteger(initialNow)||initialNow<=0)fail("CLOCK_INVALID");
  const old=await readLease(input.lease);
  validateLease(old,initialNow);
  const positions=checkedPositions(await input.executor.getPositions());
  const orders=checkedOrders(await input.executor.getOpenOrders());
  const balance=await input.executor.getAccountSnapshot();
  const now=clock();
  if(!Number.isSafeInteger(now)||now<initialNow||now-initialNow>120000)fail("READ_TOO_SLOW");
  validateLease(old,now);
  if(!balance||balance.asset!=="USDT"||!Number.isFinite(balance.updatedAt)
    ||balance.updatedAt>now||now-balance.updatedAt>30000
    ||!Number.isFinite(balance.walletBalance)||!Number.isFinite(balance.availableBalance)
    ||balance.walletBalance<0||balance.availableBalance<0)fail("ACCOUNT_OR_VENUE_CLOCK_INVALID");
  const current=await readLease(input.lease);
  validateLease(current,clock());
  if(current.leaseId!==old.leaseId||current.ownerId!==old.ownerId
    ||current.accountScope!==old.accountScope||current.acquiredAt!==old.acquiredAt)fail("LEASE_CHANGED");
  return Object.freeze({
    source:"ASTER_SIGNED_READ_ONLY" as const,
    observedAt:now,
    positions:Object.freeze(positions.map(v=>Object.freeze(v))),
    openOrders:Object.freeze(orders.map(v=>Object.freeze(v))),
  });
}
