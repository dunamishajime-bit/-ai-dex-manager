import {NextRequest,NextResponse} from "next/server";
import {loadV12V4HpObservability} from "@/lib/server/v12-v4-hp-observability";
import {loadVerifiedV4GateTelemetry} from "@/lib/server/v12-v4-gate-reference-observability";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const headers={"Cache-Control":"private, no-store"};
 if(req.cookies.get("disdex_auth")?.value!=="1")return NextResponse.json({ok:false,error:"ログインが必要です"},{status:401,headers});
 try{
  const live=await loadV12V4HpObservability();
  const verified=await loadVerifiedV4GateTelemetry(live);
  return NextResponse.json({ok:true,readOnly:true,tradingMutation:0,
   verified:!!verified,decisionTs:verified?.decisionTs??null,
   runtimeSha:live.actual.currentReleaseSha,
   symbols:verified?.symbols??[],
   reason:verified?"RUNNER_EXACT_SOURCE_VERIFIED":"RUNNER_NATIVE_GATE_TELEMETRY_NOT_AVAILABLE_OR_STALE",
  },{headers});
 }catch{return NextResponse.json({ok:true,readOnly:true,tradingMutation:0,
   verified:false,decisionTs:null,symbols:[],reason:"OBSERVER_UNAVAILABLE"},{headers});}
}
