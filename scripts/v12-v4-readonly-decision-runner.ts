import "dotenv/config";
import {mkdir,writeFile,rename} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {AsterV3Client} from "../lib/aster-v3-client";
import {loadV4ClosedCandles,buildV4LiveDecisionBatch} from "../lib/v12-v4-live-candidate-builder";

/** Non-ordering V4 market-data daemon. Authorization and execution live elsewhere. */
export async function tick(client:Pick<AsterV3Client,"getKlines">,output:string,now:()=>number=Date.now){
 const capturedAtMs=now();
 const bars=await loadV4ClosedCandles(client,capturedAtMs);
 const result=buildV4LiveDecisionBatch(bars,capturedAtMs);
 if(result.errors.length)throw Error("INCOMPLETE_V4_DECISION_BATCH:"+result.errors.join(","));
 await mkdir(dirname(output),{recursive:true});
 const temporary=output+"."+randomUUID()+".tmp";
 await writeFile(temporary,JSON.stringify(result)+"\n",{encoding:"utf8",flag:"wx",mode:0o600});
 await rename(temporary,output);
 return result;
}
async function main(){
 if(!process.argv.includes("--once")&&!process.argv.includes("--daemon"))throw Error("V4_DECISION_REQUIRES_MODE");
 const client=new AsterV3Client({baseUrl:process.env.ASTER_FUTURES_BASE_URL});
 const destination=resolve(process.env.V12_V4_REALTIME_DECISION_PATH||".runtime-state/v12-v4-live-decision.json");
 const once=process.argv.includes("--once");
 for(;;){
  const result=await tick(client,destination);
  console.log(JSON.stringify({decisionTs:result.decisionTs,candidates:result.candidateCount,nativeCoreEvents:result.nativeCoreEvents.length,orderEnabled:false}));
  if(once)break;
  const h2=7200000,now=Date.now(),next=now+h2-now%h2+5000;
  await new Promise<void>(done=>setTimeout(done,Math.max(1,next-Date.now())));
 }
}
if(process.argv[1]?.includes("v12-v4-readonly-decision-runner"))
 main().catch(error=>{console.error(error);process.exitCode=2;});
