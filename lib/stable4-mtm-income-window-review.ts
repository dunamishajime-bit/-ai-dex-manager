/** Bounded read-only income-window adapter for MTM review.
 * A successful API response is not proof of account-wide history completeness.
 * Unknown account credits, assets and truncated windows must not be assigned to a Runner.
 */
import type {AsterIncomeRow} from "./aster-v3-client";
import type {MtmEvent} from "./stable4-mtm-attribution-review";
const DAY=86_400_000,LIMIT=1000;
const kinds=new Set(["REALIZED_PNL","COMMISSION","FUNDING_FEE"]);
type ReadIncome=(range:{startTime:number;endTime:number;limit:number})=>Promise<readonly AsterIncomeRow[]>;
const id=(v:unknown)=>typeof v==="string"&&v.trim()===v&&v.length>0&&v.length<=100?v:typeof v==="number"&&Number.isSafeInteger(v)&&v>=0?String(v):undefined;
function decimal(v:unknown){return typeof v==="string"&&/^-?\d+(?:\.\d+)?$/.test(v)&&Number.isFinite(Number(v))?Number(v):undefined;}
export async function reviewIncomeWindow(readIncome:ReadIncome,fromMs:number,toMs:number,now:number){
 const reasons=new Set<string>();const events:MtmEvent[]=[];const seen=new Set<string>();
 const observedTypes:Record<string,number>=Object.create(null);
 const finish=(rows:number)=>({status:reasons.size?"BLOCKED" as const:"ROWS_PARSED_NOT_COMPLETENESS_PROOF" as const,
  blockers:[...reasons].sort(),rowCount:rows,observedTypes,events:reasons.size?[]:events,
  historyCompletenessProven:false as const,signedObservationIssued:false as const,orderAuthority:false as const});
 if(![fromMs,toMs,now].every(Number.isSafeInteger)||fromMs<=0||toMs<=fromMs||toMs>now||toMs-fromMs>DAY){
  reasons.add("INVALID_BOUNDED_WINDOW");return finish(0);
 }
 let rows:readonly AsterIncomeRow[];
 try{rows=await readIncome({startTime:fromMs+1,endTime:toMs,limit:LIMIT});}
 catch{reasons.add("INCOME_READ_UNAVAILABLE");return finish(0);}
 if(!Array.isArray(rows)){reasons.add("INVALID_INCOME_RESPONSE");return finish(0);}
 if(rows.length>=LIMIT)reasons.add("INCOME_WINDOW_POSSIBLY_TRUNCATED");
 for(const r of rows){
  if(!r||typeof r.incomeType!=="string"||!/^[A-Z0-9_]{1,80}$/.test(r.incomeType)){reasons.add("INVALID_INCOME_TYPE");continue;}
  observedTypes[r.incomeType]=(observedTypes[r.incomeType]??0)+1;
  if(!kinds.has(r.incomeType)){reasons.add("UNCLASSIFIED_INCOME:"+r.incomeType);continue;}
  const n=decimal(r.income),transaction=id(r.tranId);
  if(r.asset!=="USDT"){reasons.add("UNVERIFIED_INCOME_ASSET_CONVERSION");continue;}
  if(n===undefined||!transaction||typeof r.symbol!=="string"||!/^[A-Z0-9]+USDT$/.test(r.symbol)
   ||!Number.isSafeInteger(r.time)||r.time<=fromMs||r.time>toMs||(r.incomeType==="COMMISSION"&&n>0)){
   reasons.add("INVALID_INCOME_ROW");continue;
  }
  const key=r.incomeType+":"+transaction;
  if(seen.has(key)){reasons.add("DUPLICATE_INCOME_TRANSACTION");continue;}
  seen.add(key);
  events.push({id:key,symbol:r.symbol,atMs:r.time,kind:r.incomeType as MtmEvent["kind"],usd:n});
 }
 return finish(rows.length);
}
