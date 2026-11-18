/** Protected state types copied as field-only snapshots from pinned
 * resident-stop-ledger.ts and venue-resident-stop.ts sources.
 * No venue order/stop creation or IO functions may be imported.
 */
export interface ResidentStopPlan {
 symbol:string;side:"BUY"|"SELL";quantity:number;
 stopPrice:number;reduceOnly:true;clientOrderId:string;
}
export interface StopFill {
 clientOrderId:string;quantity:number;averagePrice:number;
 updatedAt:number;hardStop:boolean;
}
export interface StopLedger {
 originalQuantity:number;originalGross:number;
 plans:ResidentStopPlan[];fills:StopFill[];
}
export interface ResidentStopProtection {
 protected:boolean;clientOrderId:string;orderId:number;
 symbol:string;side:"BUY"|"SELL";quantity:number;
 originalQuantity:number;stopPrice:number;
 readBackStatus:"VERIFIED"|"UNVERIFIED";lastReconciledAt:number;
}
