import type {NextRequest} from "next/server";
import {NextResponse} from "next/server";
import {verifyRequestSession} from "@/lib/server/owner-session";
import {readResearchReplay} from "@/lib/server/bt-research-library";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff"};
export async function GET(request:NextRequest,ctx:{params:Promise<{id:string}>}){
 try{verifyRequestSession(request,["USER","ADMIN"])}
 catch{return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers})}
 const {id}=await ctx.params;
 if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}_REPLAY\.json$/.test(id)||id.includes("..")){
  return NextResponse.json({error:"INVALID_RESEARCH_ID"},{status:400,headers});
 }
 try{
  const value=await readResearchReplay(id);
  if(!value)return NextResponse.json({error:"NOT_FOUND"},{status:404,headers});
  return NextResponse.json(value,{headers});
 }catch{return NextResponse.json({error:"BT_RESEARCH_INTEGRITY_OR_CONFIG_FAILURE"},{status:503,headers})}
}
