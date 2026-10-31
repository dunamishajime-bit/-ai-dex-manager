import { NextRequest,NextResponse } from 'next/server';
import { loadRealtimeRanking } from '@/lib/server/realtime-ranking-observability';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 const headers={'Cache-Control':'private, no-store'};
 if(req.cookies.get('disdex_auth')?.value!=='1')return NextResponse.json({ok:false,error:'ログインが必要です'},{status:401,headers});
 try{return NextResponse.json(await loadRealtimeRanking(),{headers});}catch{return NextResponse.json({ok:false,error:'Productionのランキング観測を取得できません'},{status:503,headers});}
}
