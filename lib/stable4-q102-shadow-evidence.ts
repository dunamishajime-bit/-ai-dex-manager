import type {AsterV3Client} from "./aster-v3-client";
import type {Quality102Candle} from "./disdex-quality102-causal-pipeline";
import type {Quality102CausalV1History} from "./disdex-quality102-causal-v1-signal";
import type {Stable4ShadowOutcomeInput} from "./stable4-q102-shadow-outcome";
const M=300000,DAY=86400000;
export type Stable4ShadowEvidence=Pick<Stable4ShadowOutcomeInput,"fiveMinute"|"hourly"|"boundaryOpen"|"funding">;
export interface Stable4ShadowEvidenceRequest{symbol:string;from:number;through:number;includeM5:boolean;history:Quality102CausalV1History;}
/** Public GET-only evidence, using the client's unchanged shared rate budget. */
export class Stable4Q102ShadowEvidenceProvider {
 private readonly now:()=>number;
 private readonly limit:number;
 private readonly maxPages:number;
 constructor(private readonly client:Pick<AsterV3Client,"getKlines"|"getFundingRateHistory">,options:{now?:()=>number;pageLimit?:number;maxPages?:number}={}){
  this.now=options.now??Date.now;this.limit=options.pageLimit??1000;this.maxPages=options.maxPages??200;
  if(!Number.isSafeInteger(this.limit)||this.limit<1||this.limit>1000||!Number.isSafeInteger(this.maxPages)||this.maxPages<1||this.maxPages>200)throw Error("STABLE4_EVIDENCE_PAGINATION_CONFIG_INVALID");
 }
 async load(x:Stable4ShadowEvidenceRequest):Promise<Stable4ShadowEvidence>{
  if(!/^[A-Z0-9]+USDT$/.test(x.symbol)||!Number.isSafeInteger(x.from)||x.from<=0||x.from%M!==0||!Number.isSafeInteger(x.through)||x.through<x.from||x.through>this.now()||x.through-x.from>90*DAY)throw Error("STABLE4_EVIDENCE_RANGE_INVALID");
  const fiveMinute:Quality102Candle[]=[],seen=new Set<number>();let boundaryOpen:Stable4ShadowEvidence["boundaryOpen"];
  if(x.includeM5){
   let cursor=x.from,done=false;
   for(let page=0;page<this.maxPages;page++){
    const rows=await this.client.getKlines(x.symbol,"5m",this.limit,{startTime:cursor,endTime:x.through});
    if(!Array.isArray(rows)||rows.length>this.limit)throw Error("STABLE4_M5_RESPONSE_INVALID");
    let previous=cursor-M;
    for(const row of rows){
     const timestampMs=Number(row[0]),open=Number(row[1]);
     if(!Number.isSafeInteger(timestampMs)||timestampMs<cursor||timestampMs>x.through||timestampMs%M!==0||timestampMs<=previous||seen.has(timestampMs))throw Error("STABLE4_M5_DUPLICATE_OR_NONADVANCING");
     if(!(open>0&&Number.isFinite(open)))throw Error("STABLE4_M5_OPEN_INVALID");
     previous=timestampMs;seen.add(timestampMs);
     if(timestampMs+M>x.through){boundaryOpen={timestampMs,open};continue;}
     const candle={timestampMs,open,high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),quoteVolume:Number(row[7])};
     if(![candle.high,candle.low,candle.close,candle.quoteVolume].every(Number.isFinite)||candle.low<=0||candle.quoteVolume<0||candle.high<Math.max(open,candle.close)||candle.low>Math.min(open,candle.close))throw Error("STABLE4_M5_RESPONSE_INVALID");
     fiveMinute.push(candle);
    }
    if(rows.length<this.limit||previous+M>x.through){done=true;break;}
    cursor=previous+M;
   }
   if(!done)throw Error("STABLE4_M5_PAGINATION_LIMIT");
   const count=Math.floor((x.through-x.from)/M);
   if(fiveMinute.length!==count||fiveMinute.some((b,i)=>b.timestampMs!==x.from+i*M))throw Error("STABLE4_M5_GAP");
  }
  const fundingRows:{fundingTime:number;fundingRate:number}[]=[],fundingSeen=new Set<number>();
  let cursor=x.from+1,done=cursor>=x.through;
  if(!done)for(let page=0;page<this.maxPages;page++){
   const rows=await this.client.getFundingRateHistory(x.symbol,this.limit,{startTime:cursor,endTime:x.through-1});
   if(!Array.isArray(rows)||rows.length>this.limit)throw Error("STABLE4_FUNDING_RESPONSE_INVALID");
   let previous=cursor-1;
   for(const row of rows){
    const fundingTime=Number(row.fundingTime),fundingRate=Number(row.fundingRate);
    if(row.symbol!==x.symbol||!Number.isSafeInteger(fundingTime)||fundingTime<cursor||fundingTime>=x.through||fundingTime<=previous||fundingSeen.has(fundingTime)||!Number.isFinite(fundingRate))throw Error("STABLE4_FUNDING_DUPLICATE_OR_NONADVANCING");
    fundingSeen.add(fundingTime);previous=fundingTime;fundingRows.push({fundingTime,fundingRate});
   }
   if(rows.length<this.limit||previous>=x.through-1){done=true;break;}
   cursor=previous+1;
  }
  if(!done)throw Error("STABLE4_FUNDING_PAGINATION_LIMIT");
  return{fiveMinute,hourly:(x.history.candlesBySymbol[x.symbol]??[]).filter(b=>b.timestampMs+3600000<=x.through),
   ...(boundaryOpen?{boundaryOpen}:{}),funding:{from:x.from,through:x.through,capturedAt:this.now(),rows:fundingRows}};
 }
}
