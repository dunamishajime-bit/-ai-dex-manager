import { NextRequest,NextResponse } from 'next/server';
import { loadFetGates } from '@/lib/server/fet-gate-observability';
import { requestHasSignedOwnerSession } from "@/lib/server/session-auth";
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 const headers={'Cache-Control':'private, no-store'};
 if(!requestHasSignedOwnerSession(req))return NextResponse.json({ok:false,error:'ログインが必要です'},{status:401,headers});
 try{return NextResponse.json(await loadFetGates(),{headers});}catch{return NextResponse.json({ok:false,error:'ProductionのFET判定を取得できません'},{status:503,headers});}
}
