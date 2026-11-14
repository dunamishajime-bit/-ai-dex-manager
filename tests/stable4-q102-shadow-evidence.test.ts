import test from "node:test";
import assert from "node:assert/strict";
import * as evidence from "../lib/stable4-q102-shadow-evidence";
const M=300000,T=1800000000000,NOW=T+2*M+1000;
const k=(ts:number,p=100)=>[ts,String(p),String(p),String(p),String(p),"1",ts+M-1,"1",1,"0","0","0"];
function fixture(options:any={}){
 const klines=[k(T),k(T+M),[T+2*M,"110","bad unfinished high","bad unfinished low","bad unfinished close","bad",NOW+M,"bad"]];
 const funding=[1,2,3].map(n=>({symbol:"UNIUSDT",fundingTime:T+n,fundingRate:".0001"}));
 const calls:any[]=[];
 const client={getKlines:async(symbol:string,interval:string,limit:number,range:any)=>{calls.push({kind:"m5",range});return klines.filter(x=>+x[0]>=range.startTime&&+x[0]<=range.endTime).slice(0,limit);},getFundingRateHistory:async(symbol:string,limit:number,range:any)=>{calls.push({kind:"funding",range});return funding.filter(x=>x.fundingTime>=range.startTime&&x.fundingTime<=range.endTime).slice(0,limit);}};
 const Provider=(evidence as any).Stable4Q102ShadowEvidenceProvider;
 return{provider:new Provider(client,{now:()=>NOW,pageLimit:2,...options}),client,calls,klines};
}
const request={symbol:"UNIUSDT",from:T,through:NOW,includeM5:true,history:{candlesBySymbol:{UNIUSDT:[]}}};
test("M5 and funding pagination prove full requested coverage without exposing unfinished candle fields",async()=>{
 const f=fixture();const x=await f.provider.load(request);
 assert.equal(x.fiveMinute.length,2);assert.deepEqual(x.boundaryOpen,{timestampMs:T+2*M,open:110});
 assert.equal(x.funding.rows.length,3);assert.equal(x.funding.from,T);assert.equal(x.funding.through,NOW);
 assert.equal(f.calls.filter(x=>x.kind==="m5").length,2);assert.equal(f.calls.filter(x=>x.kind==="funding").length,2);
 assert.equal(f.calls[3].range.startTime,T+3,"funding inclusive API advances beyond last observed timestamp");
});
test("missing completed bars, duplicate responses and pagination limits fail closed",async()=>{
 const gap=fixture();gap.klines.splice(1,1);await assert.rejects(gap.provider.load(request),/M5_GAP/);
 const dup=fixture();dup.client.getKlines=async()=>[k(T),k(T)];await assert.rejects(dup.provider.load(request),/DUPLICATE|NONADVANCING/);
 const truncated=fixture({maxPages:1});await assert.rejects(truncated.provider.load(request),/PAGINATION_LIMIT/);
});
