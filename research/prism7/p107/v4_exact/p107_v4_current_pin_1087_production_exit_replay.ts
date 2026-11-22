import * as fs from "node:fs";
import {evaluateProductionExit,evaluateNativeProductionExit,productionExitSpec} from "./v4-pin-source-e788abc8/lib/v12-v4-production-lifecycle";
const source=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const H=3600000;
const matches:any[]=[],mismatches:any[]=[];
let nativeCount=0;
for(const entry of source.trades){
 const t=entry.oldTrade,barSet=entry.h1;
 if(barSet.some((x:any)=>!x)){mismatches.push({id:t.id,issue:"H1_BAR_MISSING"});continue;}
 let spec:any;
 try{spec=productionExitSpec(t.route);}catch(e:any){mismatches.push({id:t.id,issue:"UNSUPPORTED_ROUTE",error:String(e?.message||e)});continue;}
 if(JSON.stringify(spec)!==JSON.stringify(t.exitSpec)){mismatches.push({id:t.id,issue:"EXIT_POLICY_SPEC_MISMATCH",source:spec,old:t.exitSpec});continue;}
 const leg:any={
   id:t.id,qty:1,status:"OPEN",entryNotional:t.entryPrice,entryTs:t.entryTs,entryAtr:t.entryAtr,
   candidate:{route:t.route,effectiveSide:t.side,symbol:t.symbol},
   nativeExitEvidence:spec.kind==="NATIVE"?"WR60_BASELINE_1978_PARITY":undefined
 };
 if(spec.kind==="NATIVE")nativeCount++;
 let first:any=null,error="";
 for(let i=0;i<barSet.length-1;i++){
   const bar=barSet[i],next=barSet[i+1],at=bar.openTs+H;
   const nextOpen={ts:next.openTs,price:next.open};
   try{
     const d=evaluateProductionExit(leg,bar,at,nextOpen);
     if(spec.kind==="NATIVE"){
       const update=evaluateNativeProductionExit(leg,bar,at,nextOpen);
       leg.nativeStop=update.stop;leg.nativePeak=update.peak;leg.previousExitBar=bar;
     }
     if(d){first=d;break;}
   }catch(e:any){error=String(e?.message||e);break;}
 }
 if(error){mismatches.push({id:t.id,issue:"SOURCE_THROW",error});continue;}
 if(!first){mismatches.push({id:t.id,issue:"NO_SOURCE_EXIT",exitTs:t.exitTs,reason:t.exitReason});continue;}
 const match=first.exitTs===t.exitTs&&first.reason===t.exitReason&&Math.abs(first.price-t.exitPrice)<=1e-8;
 if(!match)mismatches.push({id:t.id,issue:"EXIT_VALUE_DIFFERENCE",old:{ts:t.exitTs,reason:t.exitReason,price:t.exitPrice},native:{ts:first.exitTs,reason:first.reason,price:first.price}});
 else matches.push({id:t.id,exitTs:first.exitTs,reason:first.reason,price:first.price,specKind:spec.kind});
}
const out={
 schema:"p107-v4-1087-production-exit-pinned-source-price-model-parity/v1",
 currentPin:"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",
 historicalModelCount:source.trades.length,
 sourceNativeExitIdenticalCount:matches.length,
 sourceNativeExitMismatchedCount:mismatches.length,
 oldNativeSpecCount:nativeCount,
 matches,mismatches,
 realVenueSignedExitFills:0,
 fullSTABLE4AccountParity:false
};
fs.writeFileSync(process.argv[3],JSON.stringify(out,null,2)+"\n");
console.log(JSON.stringify({old:out.historicalModelCount,matching:matches.length,mismatch:mismatches.length,nativeSpecs:nativeCount,mismatchExamples:mismatches.slice(0,8)}));
