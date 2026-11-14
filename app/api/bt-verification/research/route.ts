import type {NextRequest} from "next/server";
import {NextResponse} from "next/server";
import {verifyRequestSession} from "@/lib/server/owner-session";
import {listResearchReplays} from "@/lib/server/bt-research-library";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff"};
export async function GET(request:NextRequest){
 try{verifyRequestSession(request,["USER","ADMIN"])}
 catch{return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers})}
 try{return NextResponse.json({items:await listResearchReplays(),source:"HASHED_RESEARCH_NOT_PRODUCTION_PARITY"},{headers})}
 catch{return NextResponse.json({error:"BT_RESEARCH_LIBRARY_NOT_READY"},{status:503,headers})}
}
