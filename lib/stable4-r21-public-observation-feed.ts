/** Read-only R21 market snapshot. No authenticated venue, orders or state mutation. */
import {normalizeR21Raw,observationAt,R21_SYMBOLS,type R21Series} from "./stable4-r21-market-observation";
import {publicGetBars,type GetBars,type PublicSymbol} from "./stable4-p91-public-observation-feed";
import type {State,R21ObservationInput} from "./stable4-research-decision-observation";
const H=3600000;
export async function loadR21PublicObservation(asof:number,state?:State,get:GetBars=publicGetBars,now=Date.now):Promise<R21ObservationInput|undefined>{
 if(!Number.isSafeInteger(asof)||asof<=0)throw Error("R21_INVALID_ASOF");
 const t=Math.floor(asof/H)*H;
 if(asof<t+60_000||asof>t+15*60_000 )return;
 const data:Record<string,R21Series>={};
 // Stable order and bounded concurrency: at most one ASTER and one Binance request at a time.
 for(const sym of ["BTC",...R21_SYMBOLS]){
  if(now()>t+15*60_000)throw Error("R21_OBSERVATION_DEADLINE");
  const symbol=(sym+"USDT") as PublicSymbol;
  const [h,bin]=await Promise.all([get("ASTER",symbol,"1h",t-192*H,t),get("BINANCE",symbol,"1h",t-192*H,t)]);
  const m=await get("ASTER",symbol,"5m",t-51*H,t);
  data[sym]=normalizeR21Raw(h,m,bin,t);
 }
 if(now()>t+15*60_000)throw Error("R21_OBSERVATION_DEADLINE");
 return {state,candidates:observationAt(data,t)};
}
