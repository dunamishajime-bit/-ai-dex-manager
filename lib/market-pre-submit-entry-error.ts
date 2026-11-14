/** Constructed only around checks that precede the market-order HTTP request. */
export class MarketPreSubmitEntryError extends Error {
 readonly name="MarketPreSubmitEntryError";
 readonly reduceOnly=false;
 readonly rejectionCode:string;
 constructor(readonly symbol:string,readonly clientOrderId:string,readonly stage:"MARGIN_PREPARATION"|"MARGIN_GUARD"|"QUOTE"|"QUANTITY"|"ENTRY_NOTIONAL",error:unknown){
  const code=error instanceof Error?error.message.match(/^([A-Z][A-Z0-9_]{2,100})(?::|$)/)?.[1]:undefined;
  super(`MARKET_ENTRY_PRE_SUBMIT_REJECTED:${stage}:${symbol}:${code??"CHECK_FAILED"}`);
  this.rejectionCode=code??"CHECK_FAILED";
 }
}
