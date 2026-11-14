/** Raised only before a market order is transmitted; never infer this from text. */
export class MarketSlippageGuardError extends Error {
 constructor(readonly symbol:string,readonly clientOrderId:string,readonly reduceOnly:boolean,
  readonly adverseSlippageBps:number,readonly maxSlippageBps:number){
  super(`Slippage guard blocked ${symbol}: ${adverseSlippageBps.toFixed(2)}bps > ${maxSlippageBps.toFixed(2)}bps.`);
  this.name="MarketSlippageGuardError";
 }
}
