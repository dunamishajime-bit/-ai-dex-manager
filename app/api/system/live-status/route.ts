import { NextRequest, NextResponse } from "next/server";
import { requestHasSignedOwnerSession } from "@/lib/server/session-auth";
import { loadCurrentProductionRuntime } from "@/lib/server/current-production-runtime";
import { loadV12V4HpObservability } from "@/lib/server/v12-v4-hp-observability";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store, max-age=0"};
export async function GET(req: NextRequest) {
 if(!requestHasSignedOwnerSession(req))return NextResponse.json({ok:false,readOnly:true,tradingMutation:0,status:"UNAVAILABLE",error:"Authentication required."},{status:401,headers});
 try {
  const [current,v4]=await Promise.all([loadCurrentProductionRuntime(),loadV12V4HpObservability()]);
  const monitorCount=Object.values(current.runtimeLineage.units).filter(x=>x.monitorOnly===true&&x.matchesCurrent&&x.processActive===true).length;
  const status=v4.displayStatus==="LIVE_VERIFIED"?"LIVE":v4.displayStatus==="MONITOR_ONLY"?"MONITOR_ONLY":v4.displayStatus==="STALE"?"STALE":"UNAVAILABLE";
  return NextResponse.json({ok:status==="LIVE"||status==="MONITOR_ONLY",readOnly:true,tradingMutation:0,status,
   checkedAt:current.checkedAt,mode:v4.actual.v4RunnerMode,strategyId:"V12_V4",
   runnerUpdatedAt:v4.timestamps.heartbeatUpdatedAt===null?undefined:new Date(v4.timestamps.heartbeatUpdatedAt).toISOString(),
   runnerMonitorCount:monitorCount,runnerTotal:Object.keys(current.runtimeLineage.units).length,
   sharedHoldActive:current.sharedHoldActive,reason:"V4 runtime "+v4.displayStatus+"; 監視稼働と実注文許可は別です。"
  },{headers});
 }catch{return NextResponse.json({ok:false,readOnly:true,tradingMutation:0,status:"UNAVAILABLE",error:"現行Runner観測を取得できません。"},{status:503,headers});}
}
