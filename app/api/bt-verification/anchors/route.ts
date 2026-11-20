import {NextRequest,NextResponse} from "next/server";
import {requestHasSignedOwnerSession} from "@/lib/server/session-auth";
import {parseVerifiedAsterDailyClose,priorJstCalendarDay} from "@/lib/bt-verification/anchor-source";

export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
  if(!requestHasSignedOwnerSession(request)){
    return NextResponse.json({error:"OWNER_SESSION_REQUIRED"},{status:401,headers:{"Cache-Control":"no-store"}});
  }
  const symbol=request.nextUrl.searchParams.get("symbol")??"";
  if(!/^[A-Z0-9]{3,18}USDT$/.test(symbol)){
    return NextResponse.json({error:"INVALID_SYMBOL"},{status:400});
  }
  const now=new Date();
  const utcDate=priorJstCalendarDay(now);
  const openMs=Date.parse(utcDate+"T00:00:00Z");
  if(now.getTime()<=openMs+86400000-1){
    return NextResponse.json({error:"PRIOR_JST_DAY_UTC_CANDLE_NOT_FINAL"},{status:409,headers:{"Cache-Control":"no-store"}});
  }
  const url=new URL("https://fapi.asterdex.com/fapi/v1/klines");
  url.searchParams.set("symbol",symbol);
  url.searchParams.set("interval","1d");
  url.searchParams.set("startTime",String(openMs));
  url.searchParams.set("endTime",String(openMs+86400000-1));
  url.searchParams.set("limit","2");
  try {
    const res=await fetch(url.toString(),{method:"GET",headers:{Accept:"application/json"},signal:AbortSignal.timeout(7000),cache:"no-store"});
    if(!res.ok)return NextResponse.json({error:"VENUE_UNAVAILABLE"},{status:502,headers:{"Cache-Control":"no-store"}});
    const payload:unknown=await res.json();
    const anchor=parseVerifiedAsterDailyClose(symbol,utcDate,payload,now);
    return NextResponse.json({...anchor,venue:"Aster Futures",interval:"1d",retrievedAt:now.toISOString()},
      {headers:{"Cache-Control":"private, no-store"}});
  }catch {
    return NextResponse.json({error:"ANCHOR_VERIFICATION_FAILED"},{status:502,headers:{"Cache-Control":"no-store"}});
  }
}