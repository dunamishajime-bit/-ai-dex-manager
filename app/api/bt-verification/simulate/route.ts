import type {NextRequest} from "next/server";
import {NextResponse} from "next/server";
import {verifyRequestSession} from "@/lib/server/owner-session";
import {parseAllowedSyntheticJob,computeAllowedSyntheticJob} from "@/lib/bt-verification/server-job";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;
const headers={"Cache-Control":"private, no-store, max-age=0",
  "X-Content-Type-Options":"nosniff"};
const BODY_MAX_BYTES=4096;
function validOrigin(request:NextRequest):boolean{
  const raw=request.headers.get("origin");
  const configured=process.env.DISDEX_BT_ORIGIN?.trim();
  if(!raw||!configured)return false;
  try{
    const origin=new URL(raw),trusted=new URL(configured);
    return origin.origin===trusted.origin &&
      (origin.protocol==="https:"||origin.hostname==="localhost") &&
      (trusted.protocol==="https:"||trusted.hostname==="localhost");
  }catch{return false}
}
async function bodyLimited(request:NextRequest):Promise<unknown>{
 const declared=request.headers.get("content-length");
 if(declared!==null){
   const n=Number(declared);
   if(!Number.isSafeInteger(n)||n<0||n>BODY_MAX_BYTES)throw Error("BODY_OVERSIZE");
 }
 if(!request.body)throw Error("BODY_REQUIRED");
 const reader=request.body.getReader();const chunks:Uint8Array[]=[];
 let bytes=0;
 try{
   while(true){
     const r=await reader.read();if(r.done)break;
     bytes+=r.value.byteLength;
     if(bytes>BODY_MAX_BYTES)throw Error("BODY_OVERSIZE");
     chunks.push(r.value);
   }
 }finally{reader.releaseLock()}
 if(bytes<2)throw Error("BODY_REQUIRED");
 return JSON.parse(Buffer.concat(chunks.map(c=>Buffer.from(c)),bytes).toString("utf8")) as unknown;
}
/**
 * Opt-in owner-only research simulator. No dynamic imports, native executor,
 * access to live position API, POST to venue, or remote code execution.
 * Enabling this endpoint never enables seven-runner STABLE4 parity.
 */
export async function POST(request:NextRequest){
 try{verifyRequestSession(request,["USER","ADMIN"])}
 catch{return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers})}
 if(!validOrigin(request))return NextResponse.json({error:"ORIGIN_NOT_ALLOWED"},{status:403,headers});
 if(process.env.DISDEX_BT_SANDBOX_JOBS_ENABLED!=="1")
   return NextResponse.json({error:"BT_SYNTHETIC_JOB_DISABLED_FAIL_CLOSED"},{status:503,headers});
 if(!(request.headers.get("content-type")??"").toLowerCase().includes("application/json"))
   return NextResponse.json({error:"JSON_REQUIRED"},{status:415,headers});
 let parsed:unknown;
 try{parsed=await bodyLimited(request)}
 catch{return NextResponse.json({error:"BT_JOB_INVALID_OR_OVERSIZE_BODY"},{status:400,headers})}
 let job;
 try{job=parseAllowedSyntheticJob(parsed)}
 catch(e){
   const reason=e instanceof Error?e.message:"BT_JOB_INVALID";
   return NextResponse.json({error:reason},{status:400,headers});
 }
 try{
   const replay=computeAllowedSyntheticJob(job);
   return NextResponse.json({sourceMode:"SYNTHETIC_H48_RESEARCH_ONLY",
     parity:"NOT_PRODUCTION_OR_SEVEN_RUNNER_PARITY",replay},{headers});
 }catch{
   return NextResponse.json({error:"BT_ISOLATED_SIMULATION_FAILED"},{status:503,headers});
 }
}
