import {readFileSync,writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {replayFetBrk48ModeledM5,type FetModeledBar} from "../lib/stable4-fet-offline-m5-exit";
const [prefix,suffix,tapeFile,out]=process.argv.slice(2);
if(!prefix||!suffix||!tapeFile||!out)throw Error("USAGE prefix.gz suffix.gz audit.json output.json");
const sha=(p:string)=>createHash("sha256").update(readFileSync(p)).digest("hex");
function load(p:string):FetModeledBar[]{
 return gunzipSync(readFileSync(p)).toString("utf8").split(/\r?\n/).filter(Boolean).map(x=>{
  const r=JSON.parse(x);
  return {ts:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])};
 });
}
const maps=new Map<number,FetModeledBar>();
for(const x of [...load(prefix),...load(suffix)]){
 const old=maps.get(x.ts);
 if(old){
  if(Object.keys(x).some(key=>Math.abs((x as any)[key]-(old as any)[key])>1e-12))throw Error("FET_5M_DUPLICATE_CONFLICT");
 }else maps.set(x.ts,x);
}
const times=[...maps.keys()].sort((a,b)=>a-b);
for(let i=1;i<times.length;i++)if(times[i]!==times[i-1]+300000)throw Error("FET_5M_GAP:"+times[i]);
type Event={entryTs:number;entryPrice:number;exitTs:number;exitPrice:number;exitReason:string};
const tape=JSON.parse(readFileSync(tapeFile,"utf8")).trades as Event[];
const errors:Record<string,number>={},samples:any[]=[];
let matched=0,stops=0,timesOut=0,matchedEntry=0;
for(const row of tape){
 const first=maps.get(row.entryTs);if(first?.open===row.entryPrice)matchedEntry++;
 const got=replayFetBrk48ModeledM5({entryTs:row.entryTs,entryPrice:row.entryPrice,barAt:ts=>maps.get(ts)});
 const reason=first?.open!==row.entryPrice?"ENTRY_OPEN_MISMATCH":got.ts!==row.exitTs?"EXIT_CLOCK_MISMATCH":
  got.reason!==row.exitReason?"EXIT_REASON_MISMATCH":Math.abs(got.price-row.exitPrice)>1e-10?"EXIT_PRICE_MISMATCH":"MATCH";
 if(reason==="MATCH")matched++;else{errors[reason]=(errors[reason]??0)+1;if(samples.length<12)samples.push({entryTs:row.entryTs,reason,expected:row,actual:got});}
 if(got.reason==="FET_PROTECTED_STOP")stops++;else timesOut++;
}
const report={schema:"stable4-fet-brk48-native-m5-model-parity/v1",status:"RESEARCH_ONLY_NOT_SIGNED_VENUE",trades:tape.length,matchedEntry,matched,stops,timeExits:timesOut,
 candleCount:maps.size,sourceSha256:{prefix:sha(prefix),suffix:sha(suffix),tape:sha(tapeFile)},mismatches:errors,examples:samples,
 limitations:["Model STOP clock uses confirmed 5m bar-close, not an actual ASTER signed order fill timestamp","Profit floor, trailing and max-hold from current pure source, original 11 archived modeled exits, not portfolio-admitted fills","No funding, venue book depth, real order receipt or Owner release certificate"],orderAuthority:false};
writeFileSync(out,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({...report,examples:samples.slice(0,3)}));
