import type {NextRequest} from "next/server";
import {NextResponse} from "next/server";
import {verifyRequestSession} from "@/lib/server/owner-session";
import {isReplayStoreConfigured,readOwnerRun,deleteOwnerRun} from "@/lib/server/bt-replay-store";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store, max-age=0"};
function subjectFor(request:NextRequest){
  try{return verifyRequestSession(request,["USER","ADMIN"]).subject}catch{return null}
}
function validOrigin(request:NextRequest){
  const origin=request.headers.get("origin");
  if(!origin)return false;
  const configured=process.env.DISDEX_BT_ORIGIN?.trim();
  if(!configured)return false; // require separate operator-controlled HTTPS origin
  try {
    const expected=new URL(configured);
    const sent=new URL(origin);
    return sent.origin===expected.origin&&(sent.protocol==="https:"||sent.hostname==="localhost")&&
      (expected.protocol==="https:"||expected.hostname==="localhost");
  }catch{return false}
}
export async function GET(request:NextRequest,ctx:{params:Promise<{id:string}>}){
  const subject=subjectFor(request);
  if(!subject)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers});
  if(!isReplayStoreConfigured())return NextResponse.json({error:"BT_SERVER_ARCHIVE_NOT_CONFIGURED"},{status:503,headers});
  const {id}=await ctx.params;
  if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:"INVALID_ID"},{status:400,headers});
  try{
    const item=await readOwnerRun(subject,id);
    if(!item)return NextResponse.json({error:"NOT_FOUND"},{status:404,headers});
    return NextResponse.json(item,{headers});
  }catch{return NextResponse.json({error:"BT_REPLAY_INTEGRITY_FAILURE"},{status:409,headers})}
}
export async function DELETE(request:NextRequest,ctx:{params:Promise<{id:string}>}){
  const subject=subjectFor(request);
  if(!subject)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers});
  if(!validOrigin(request))return NextResponse.json({error:"ORIGIN_NOT_ALLOWED"},{status:403,headers});
  if(!isReplayStoreConfigured())return NextResponse.json({error:"BT_SERVER_ARCHIVE_NOT_CONFIGURED"},{status:503,headers});
  const {id}=await ctx.params;
  if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:"INVALID_ID"},{status:400,headers});
  try{
    const removed=await deleteOwnerRun(subject,id);
    if(!removed)return NextResponse.json({error:"NOT_FOUND"},{status:404,headers});
    return new NextResponse(null,{status:204,headers});
  }catch{return NextResponse.json({error:"BT_ARCHIVE_DELETE_FAILED"},{status:503,headers})}
}
