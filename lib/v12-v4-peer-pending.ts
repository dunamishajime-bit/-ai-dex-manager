import type {ForeignExposure} from "./v12-v4-production-lifecycle";
import type {PendingExposureRegistry} from "./disdex-pending-exposure-registry";
/** Counts every unfilled peer intent, without treating a pending order as filled. */
export function addV4PeerPending(foreign:ForeignExposure[],registry:PendingExposureRegistry,equity:number){
 if(!(equity>0)||registry.accountScope!=="ASTER_FUTURES")throw Error("PENDING_SCOPE_OR_EQUITY_INVALID");
 const out=structuredClone(foreign);
 for(const p of registry.entries){
  if(p.status==="RELEASED")continue;
  const strategy=p.strategyId.toUpperCase();
  const kind=strategy.includes("QUALITY102")?"Q102":strategy.includes("PENGU")?"PENGU":
   strategy.includes("V52")?"V52":strategy.includes("FET")?"FET":
   strategy.includes("HYPE")?"HYPE_LONG":strategy.includes("RESIDUAL")?"RESIDUAL":
   strategy.includes("IDLE")?"IDLE":strategy.includes("V12")?"V12":null;
  if(!kind||strategy==="V12_V4"||p.side==="FLAT"||!(p.notionalUsd>0))
   throw Error("UNRECONCILED_PEER_PENDING");
  let row=out.find(o=>o.owner===kind&&o.symbol===p.symbol);
  if(!row){
   if(out.some(o=>o.symbol===p.symbol))throw Error("PENDING_SYMBOL_OWNER_CONFLICT");
   row={owner:kind,symbol:p.symbol,side:p.side,qty:0,gross:0,pendingGross:0,crypto:p.sleeve==="CRYPTO"};
   out.push(row);
  }
  if(row.side!==p.side)throw Error("PENDING_SIDE_CONFLICT");
  row.pendingGross+=p.notionalUsd/equity;
 }
 return out;
}
