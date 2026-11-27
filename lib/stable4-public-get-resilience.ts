import {waitForAsterGlobalRateSlot,deferAsterGlobalRateBudget} from "./disdex-aster-global-rate-budget";
import {asterFuturesRequestWeight} from "./aster-v3-client";
/** Public-market GET resilience. Never uses a different venue or stale interval as fallback. */
import {closedRows,type Raw} from "./stable4-public-market-reconstruction";
import type {GetBars,PublicVenue} from "./stable4-p91-public-observation-feed";
const H=3600000,M=300000;
type Options={fetcher?:typeof fetch;now?:()=>number;sleep?:(ms:number)=>Promise<void>;random?:()=>number;maxAttempts?:number;budgetMs?:number;timeoutMs?:number};
type Cached={rows:Raw[];expires:number};
class PublicFailure extends Error{
 constructor(message:string,readonly retryable:boolean,readonly waitMs=0){super(message);}
}
function retryAfter(value:string|null,now:number){
 if(!value)return 0;
 const n=Number(value);if(Number.isFinite(n)&&n>=0)return n*1000;
 const t=Date.parse(value);return Number.isFinite(t)?Math.max(0,t-now):0;
}
export function createResilientPublicGet(options:Options={}):GetBars{
 const fetcher=options.fetcher??fetch,now=options.now??Date.now,sleep=options.sleep??(ms=>new Promise(r=>setTimeout(r,ms))),random=options.random??Math.random;
 const maxAttempts=options.maxAttempts??3,budget=options.budgetMs??24000,timeout=options.timeoutMs??6500;
 const cache=new Map<string,Cached>(),inflight=new Map<string,Promise<Raw[]>>();
 const cooldown=new Map<PublicVenue,number>();
 // Serialize requests within each venue, independently of the other venue.
 const tails=new Map<PublicVenue,Promise<unknown>>();
 const copy=(rows:Raw[])=>rows.map(r=>[...r]);
 return async(venue,symbol,interval,start,end)=>{
  const width=interval==="1h"?H:M,limit=(end-start)/width;
  if(!["ASTER","BINANCE"].includes(venue)||!["PENGUUSDT","BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","LINKUSDT","AVAXUSDT","DOGEUSDT","INJUSDT","XRPUSDT","ADAUSDT","LTCUSDT","ATOMUSDT","AAVEUSDT","NEARUSDT"].includes(symbol)||!["1h","5m"].includes(interval)||!Number.isSafeInteger(limit)||limit<1||limit>1000||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start%width||end%width||end>now())throw Error("INVALID_PUBLIC_RANGE");
  const key=[venue,symbol,interval,start,end].join("|");
  const hit=cache.get(key);if(hit&&hit.expires>now())return copy(hit.rows);
  if(inflight.has(key))return copy(await inflight.get(key)!);
  const deadline=now()+budget;
  const job=async():Promise<Raw[]>=>{
   const u=new URL(venue==="ASTER"?"https://fapi.asterdex.com/fapi/v3/klines":"https://fapi.binance.com/fapi/v1/klines");
   u.search=new URLSearchParams({symbol,interval,startTime:String(start),endTime:String(end-1),limit:String(limit)}).toString();
   for(let attempt=0;attempt<maxAttempts;attempt++){
    const wait=Math.max(0,(cooldown.get(venue)??0)-now());
    if(wait+100>=deadline-now())throw Error(venue+"_PUBLIC_COOLDOWN_OR_DEADLINE");
    if(wait)await sleep(wait);
    const left=deadline-now();if(left<=0)throw Error(venue+"_PUBLIC_DEADLINE");
    try{
     if(venue==="ASTER")await waitForAsterGlobalRateSlot(asterFuturesRequestWeight("GET","/fapi/v3/klines",{limit}),"MARKET_DATA");
     const r=await fetcher(u,{method:"GET",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(Math.max(1,Math.min(timeout,left)))});
     if(!r.ok){
      const shared=venue==="ASTER"?String(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH||"").trim():"";
      const retryable=r.status===408||r.status===425||r.status===429&&!shared||r.status>=500;
      const delay=retryAfter(r.headers.get("retry-after"),now());
      if(r.status===429||r.status===418)cooldown.set(venue,Math.max(cooldown.get(venue)??0,now()+Math.max(delay,r.status===418?120000:2000)));
      if(shared&&(r.status===418||r.status===429))await deferAsterGlobalRateBudget({path:shared,status:r.status,cooldownMs:Math.max(delay,r.status===418?120000:60000)});
      throw new PublicFailure(venue+"_PUBLIC_HTTP_"+r.status,retryable,delay);
     }
     let d:unknown;try{d=await r.json();}catch{throw new PublicFailure("PUBLIC_JSON",true);}
     if(!Array.isArray(d)||d.some(x=>!Array.isArray(x)))throw new PublicFailure("PUBLIC_RESPONSE_SHAPE",true);
     const rows=closedRows(d,end,width);
     if(rows.length!==limit||rows.some((x,i)=>x.openTime!==start+i*width)||d.length!==limit)throw new PublicFailure("PUBLIC_CLOSED_RANGE_GAP",true);
     if(now()>deadline)throw new PublicFailure("PUBLIC_DEADLINE",false);
     // Cache only fully validated closed bars for the exact requested window.
     cache.set(key,{rows:copy(d),expires:now()+10*60000});
     for(const [k,v] of cache)if(v.expires<=now())cache.delete(k);
     while(cache.size>64)cache.delete(cache.keys().next().value!);
     return copy(d);
    }catch(e){
     // Data-integrity errors from closedRows are not retried or cached.
     const retryable=e instanceof PublicFailure?e.retryable:e instanceof TypeError||(e instanceof Error&&["TimeoutError","AbortError"].includes(e.name));
     if(!retryable||attempt+1>=maxAttempts)throw e;
     const delay=Math.max(e instanceof PublicFailure?e.waitMs:0,Math.max(0,(cooldown.get(venue)??0)-now()),500*2**attempt+Math.floor(random()*250));
     if(delay+100>=deadline-now())throw Error(venue+"_PUBLIC_RETRY_BUDGET");
     await sleep(delay);
    }
   }
   throw Error("PUBLIC_RETRY_EXHAUSTED");
  };
  const prior=tails.get(venue)??Promise.resolve();
  const p=prior.catch(()=>{}).then(job);
  tails.set(venue,p);inflight.set(key,p);
  try{return copy(await p);}finally{
   inflight.delete(key);if(tails.get(venue)===p)tails.delete(venue);
  }
 };
}
