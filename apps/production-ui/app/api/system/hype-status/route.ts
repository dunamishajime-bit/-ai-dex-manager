import { NextRequest, NextResponse } from "next/server";
import { loadHypeRuntimeObservability } from "@/lib/server/hype-runtime-observability";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req:NextRequest){
  if(req.cookies.get("disdex_auth")?.value!=="1")
    return NextResponse.json({ok:false,readOnly:true,tradingMutation:0,error:"ログインが必要です"},
      {status:401,headers:{"Cache-Control":"private, no-store"}});
  try{
    const data=await loadHypeRuntimeObservability();
    return NextResponse.json(data,{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({ok:false,readOnly:true,tradingMutation:0,
      error:error instanceof Error?error.message:"HYPE stateを取得できません"},
      {status:503,headers:{"Cache-Control":"private, no-store"}});
  }
}
