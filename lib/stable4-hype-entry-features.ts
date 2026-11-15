import type {Stable4HypeCandle} from "./hype-stable4-opportunity-signal";
const H=3600000;
/** Entry-only H48 research features. All bars end at/before logical entry. */
export function stable4HypeEntryFeatures(hype:readonly Stable4HypeCandle[],btc:readonly Stable4HypeCandle[],entryTs:number){
 const window=(rows:readonly Stable4HypeCandle[],n:number)=>{
  const out=rows.filter(b=>b.ts>=entryTs-n*H&&b.ts<entryTs).sort((a,b)=>a.ts-b.ts);
  if(!Number.isSafeInteger(entryTs)||out.length!==n||out.some((b,i)=>b.ts!==entryTs-(n-i)*H||![b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)))throw Error("STABLE4_HYPE_ENTRY_FEATURE_COVERAGE_INVALID");
  return out;
 };
 const rows=window(hype,73),b=window(btc,25),c=rows.map(x=>x.close),ret=(n:number)=>c[72]/c[72-n]-1;
 const changes=c.slice(-24).map((x,i)=>x/c[48+i]-1),mean=changes.reduce((s,x)=>s+x,0)/24;
 const path=c.slice(-24).reduce((s,x,i)=>s+Math.abs(x-c[48+i]),0),last=rows.slice(-25),low=Math.min(...last.map(x=>x.low)),high=Math.max(...last.map(x=>x.high));
 const h24=ret(24),b24=b[24].close/b[0].close-1;
 return{h6:ret(6),h12:ret(12),h24,h72:ret(72),b24,rel24:h24-b24,er24:path===0?0:Math.abs(c[72]-c[48])/path,pos24:high===low?.5:(c[72]-low)/(high-low),rv24:Math.sqrt(changes.reduce((s,x)=>s+(x-mean)**2,0)/24)};
}
