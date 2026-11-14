import type {Quality102Candle} from "./disdex-quality102-causal-pipeline";
import type {Quality102CausalV1History} from "./disdex-quality102-causal-v1-signal";
const H=3600000;
/** Binary-search a read-only public archive; never expose the entry candle's HLC. */
export function historicalQ102History(source:Readonly<Record<string,readonly Quality102Candle[]>>,decisionTs:number):Quality102CausalV1History{
 if(!Number.isSafeInteger(decisionTs)||decisionTs<=0||decisionTs%H!==0)throw Error("STABLE4_BOOTSTRAP_HOUR_INVALID");
 const candlesBySymbol:Record<string,readonly Quality102Candle[]>={},entryOpenBySymbol:Record<string,{timestampMs:number;open:number}>={};
 for(const [symbol,rows]of Object.entries(source)){
  let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>>1;if(rows[m].timestampMs<decisionTs)lo=m+1;else hi=m;}
  const entry=rows[lo];if(!entry||entry.timestampMs!==decisionTs||!(entry.open>0&&Number.isFinite(entry.open)))throw Error("STABLE4_BOOTSTRAP_ENTRY_OPEN_MISSING:"+symbol+":"+decisionTs);
  if(!lo||rows[lo-1].timestampMs!==decisionTs-H)throw Error("STABLE4_BOOTSTRAP_COMPLETED_BOUNDARY_MISSING:"+symbol+":"+decisionTs);
  candlesBySymbol[symbol]=rows.slice(0,lo);entryOpenBySymbol[symbol]={timestampMs:decisionTs,open:entry.open};
 }
 return{candlesBySymbol,entryOpenBySymbol};
}
