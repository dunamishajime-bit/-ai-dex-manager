import {createResilientPublicGet} from "./stable4-public-get-resilience";
/** Public GET only, observation use. No account, credentials, trading client, or mutation. */
import {closedRows,nativeBinanceTimes,reconstructP91Inputs,type Raw,type P91Raw} from "./stable4-public-market-reconstruction";
import type {P91Input} from "./stable4-research-decision-observation";
const H=3600000,M=300000,WINDOW=1344;
export type PublicVenue="ASTER"|"BINANCE";
export const PUBLIC_MARKET_SYMBOLS=["PENGUUSDT","BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","LINKUSDT","AVAXUSDT","DOGEUSDT","INJUSDT","XRPUSDT","ADAUSDT","LTCUSDT","ATOMUSDT","AAVEUSDT","NEARUSDT"] as const;
export type PublicSymbol=typeof PUBLIC_MARKET_SYMBOLS[number];
export type GetBars=(venue:PublicVenue,symbol:PublicSymbol,interval:"1h"|"5m",start:number,end:number)=>Promise<Raw[]>;
export const publicGetBars:GetBars=createResilientPublicGet();
async function hourly(get:GetBars,venue:PublicVenue,symbol:PublicSymbol,t:number){
 const start=t-WINDOW*H;
 // Page in ascending order; require every requested H1 to be present, including zero-volume bars.
 const a=await get(venue,symbol,"1h",start,t-672*H),b=await get(venue,symbol,"1h",t-672*H,t);
 const raw=[...a,...b],c=closedRows(raw,t);
 if(c.length!==WINDOW||c.some((x,i)=>x.openTime!==start+i*H))throw Error(venue+"_"+symbol+"_H1_GAP");
 return raw;
}
export async function loadP91PublicObservation(asof:number,get:GetBars=publicGetBars):Promise<P91Input|undefined>{
 if(!Number.isSafeInteger(asof)||asof<=0)throw Error("INVALID_ASOF");
 const t=Math.floor(asof/H)*H;
 if(asof<t+M||asof>t+15*60000)return undefined;
 const [binancePengu,binanceBtc]=await Promise.all([hourly(get,"BINANCE","PENGUUSDT",t),hourly(get,"BINANCE","BTCUSDT",t)]);
 if(!nativeBinanceTimes(binancePengu,binanceBtc,t).includes(t))return undefined;
 const [asterPengu,asterBtc,binanceEth,asterM5]=await Promise.all([hourly(get,"ASTER","PENGUUSDT",t),hourly(get,"ASTER","BTCUSDT",t),hourly(get,"BINANCE","ETHUSDT",t),get("ASTER","PENGUUSDT","5m",t,t+M)]);
 const raw:P91Raw={asterPengu,asterBtc,binancePengu,binanceBtc,binanceEth,asterM5};
 const m=closedRows(asterM5,asof,M);if(m.length!==1||m[0].openTime!==t)throw Error("ASTER_M5_GAP");
 return {...reconstructP91Inputs(raw,[t],asof)[0],asof};
}
