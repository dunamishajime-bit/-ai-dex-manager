import * as fs from "node:fs";
import {createV4FourRuleState,observeV4FourRuleM5,observeV4FourRuleH1} from "./v4-pin-source-e788abc8/lib/v12-v4-four-rule-policy";
const data=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const M5=300000,H1=3600000;
const pass:any[]=[],mismatch:any[]=[],shortEarlier:any[]=[];
for(const item of data.trades){
 const t=item.oldTrade;
 if(item.m5.some((x:any)=>x===null)||item.h1.some((x:any)=>x===null)){mismatch.push({id:t.id,error:"MISSING_CANDLE"});continue;}
 const hmap=new Map(item.h1.map((x:any)=>[x.openTs,x]));
 let state=createV4FourRuleState(),firstH1:any=null,priorM5:any=null,error="";
 for(const m of item.m5){
  try{
   const m5=observeV4FourRuleM5({route:t.route,side:t.side,entryTs:t.entryTs,fill:t.fillProxy,state,bar:m});
   state=m5.state;
   if(m5.exitCandidate&&priorM5===null)priorM5=m5.exitCandidate;
   if((m.openTs+M5)%H1===0){
    const h1=hmap.get(m.openTs+M5-H1);
    if(!h1)throw Error("H1_BAR_CLOSED_MISSING");
    const tick=observeV4FourRuleH1({route:t.route,side:t.side,entryTs:t.entryTs,fill:t.fillProxy,state,bar:h1});
    state=tick.state;
    if(tick.exitCandidate&&firstH1===null)firstH1=tick.exitCandidate;
   }
  }catch(e:any){error=String(e?.message||e);break;}
  if(firstH1)break;
 }
 if(priorM5&&priorM5.exitTs<=t.exitTs)shortEarlier.push({id:t.id,m5ExitTs:priorM5.exitTs,modelH1ExitTs:t.exitTs,m5Reason:priorM5.reason});
 if(error){mismatch.push({id:t.id,error});continue;}
 if(!firstH1){mismatch.push({id:t.id,error:"NO_NATIVE_H1_EXIT",oldExitTs:t.exitTs});continue;}
 const ok=firstH1.exitTs===t.exitTs&&firstH1.reason===t.exitReasonModel&&Math.abs(firstH1.modelPrice-t.exitPriceModel)<=1e-9;
 if(!ok)mismatch.push({id:t.id,oldExitTs:t.exitTs,newExitTs:firstH1.exitTs,oldPrice:t.exitPriceModel,newPrice:firstH1.modelPrice,oldReason:t.exitReasonModel,newReason:firstH1.reason});
 else pass.push({id:t.id,exitTs:firstH1.exitTs,exitPrice:firstH1.modelPrice,exitReason:firstH1.reason});
}
const output={schema:"p107-v4-176-h1-four-rule-candidate-native-parity/v1",sourceSha:"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",oldModeledCount:data.trades.length,matched:pass.length,mismatchCount:mismatch.length,failures:mismatch,matchingCases:pass,priorM5ProspectiveExitCases:shortEarlier,priorM5ProspectiveExitCount:shortEarlier.length,productionActualFillsVerified:0,fullSTABLE4AccountBT:false};
fs.writeFileSync(process.argv[3],JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({old:output.oldModeledCount,matching:pass.length,mismatch:mismatch.length,earlyM5Prospective:shortEarlier.length,firstFailures:mismatch.slice(0,5)}));
