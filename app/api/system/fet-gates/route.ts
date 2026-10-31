import { NextRequest,NextResponse } from 'next/server';
import { loadFetGates } from '@/lib/server/fet-gate-observability';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 const headers={'Cache-Control':'private, no-store'};
 if(req.cookies.get('disdex_auth')?.value!=='1')return NextResponse.json({ok:false,error:'ログインが必要です'},{status:401,headers});
 try{return NextResponse.json(await loadFetGates(),{headers});}catch{return NextResponse.json({ok:false,error:'ProductionのFET判定を取得できません'},{status:503,headers});}
}
