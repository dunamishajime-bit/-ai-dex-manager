import * as fs from "node:fs";
import {createV4FourRuleState,observeV4FourRuleM5} from "./v4-pin-source-e788abc8/lib/v12-v4-four-rule-policy";
const input=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const mismatches:any[]=[],successful:any[]=[];
let success=0;
for(const item of input.trades){
 const t=item.oldTrade;
 if(t.side!=="SHORT"||t.exitReasonModel!=="V4_SHORT_INITIAL_ADVERSE_CANDIDATE")throw Error("NOT_SHORT_M5");
 if(item.m5.some((x:any)=>x===null)){mismatches.push({id:t.id,issue:"HISTORICAL_M5_MISSING"});continue;}
 let state=createV4FourRuleState(),first:any=null,fail:any=null;
 for(const bar of item.m5){
  try{
   const result=observeV4FourRuleM5({route:t.route,side:t.side,entryTs:t.entryTs,fill:t.fillProxy,state,bar});
   state=result.state;
   if(result.exitCandidate&&first===null)first=result.exitCandidate;
  }catch(e:any){
   fail=String(e?.message||e);
   break;
  }
  if(first)break;
 }
 if(fail){mismatches.push({id:t.id,issue:"SOURCE_THROW",error:fail});continue;}
 if(!first){mismatches.push({id:t.id,issue:"NATIVE_NO_EARLY_EXIT_BEFORE_OLD_EXIT",oldExitTs:t.exitTs});continue;}
 const dt=first.exitTs-t.exitTs,delta=first.modelPrice-t.exitPriceModel;
 const pass=dt===0&&first.reason===t.exitReasonModel&&Math.abs(delta)<=1e-9;
 if(!pass)mismatches.push({id:t.id,issue:"NATIVE_VS_MODELED_EVENT_MISMATCH",oldExitTs:t.exitTs,nativeExitTs:first.exitTs,oldPrice:t.exitPriceModel,nativePrice:first.modelPrice,oldReason:t.exitReasonModel,nativeReason:first.reason});
 else{success++;successful.push({id:t.id,sourceReason:first.reason,exitTs:first.exitTs,referencePrice:first.modelPrice,evidenceBarTs:first.evidenceBarTs});}
}
const out={
 schema:"p107-v4-131-modelled-early-exit-candidates-source-rule-m5-parity/v1",
 currentPin:"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",
 oldExitCount:input.trades.length,
 nativeCandidateIdentityPriceMatchCount:success,
 nativeCandidateMismatchCount:mismatches.length,
 mismatches,sourceConfirmedCandidates:successful,
 actualExchangeSignedFills:0,oldTapeUsedCandidateAsModeledExit:true,
 important:"Exact source M5 timing/price candidate match is NOT a signed market fill. Actual fill, STOP, ownership, funding and account replay missing.",
 p107_full_production_parity:false
};
fs.writeFileSync(process.argv[3],JSON.stringify(out,null,2)+"\n");
console.log(JSON.stringify({old:out.oldExitCount,matches:success,mismatches:mismatches.length,examples:mismatches.slice(0,4)}));
