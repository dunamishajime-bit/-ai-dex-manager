"use client";
import type {Replay} from "@/lib/bt-verification/replay";

type Mark = {frameIndex:number;time:string;label:string;kind:"ENTRY"|"EXIT"|"PARTIAL";result:"POSITIVE"|"NEGATIVE"|"UNKNOWN"};
const LOGICS=["V4","V12","PENGU","V52","Q102","HYPE","FET","IDLE","STABLE3","STABLE4"];
function markers(replay:Replay,cursor:number):Mark[]{
 const result:Mark[]=[];
 for(let i=Math.max(0,cursor-500);i<=cursor;i++){
  const frame=replay.frames[i];
  for(const e of frame.events){
   if(e.startsWith("BLOCK ") || e.includes(" RISK ") || e.startsWith("RISK "))continue;
   const time=(e.length>=20 && e.charAt(4)==="-" && e.charAt(10)==="T")?e.slice(0,20):frame.timestamp;
   const enter=e.includes("ENTRY")||e.includes("発火")||e.includes("エントリー");
   const partial=e.includes("PARTIAL")||e.includes("部分決済");
   const exit=e.includes("EXIT")||e.includes("利確")||e.includes("損切")||e.includes("決済");
   if(!enter&&!exit&&!partial)continue;
   const logic=LOGICS.find(x=>new RegExp("(^|[^A-Z0-9])"+x+"([^A-Z0-9]|$)").test(e))??"BT";
   result.push({frameIndex:i,time,label:logic+(enter?" 発火":partial?" 部分決済":" 決済")+" / "+e,kind:enter?"ENTRY":partial?"PARTIAL":"EXIT",
    result:e.includes("利確")||/\+\d+(?:\.\d+)?\s*JPY/.test(e)?"POSITIVE":e.includes("損切")||/-\d+(?:\.\d+)?\s*JPY/.test(e)?"NEGATIVE":"UNKNOWN"});
  }
 }
 return result;
}
export function BtcCandlestickChart({replay,cursor,onEventSelect}:{replay:Replay;cursor:number;onEventSelect?:(frameIndex:number,label:string)=>void}){
 const now=replay.frames[cursor].timestamp;
 const available=(replay.btcCandles??[]).filter(c=>c.closedAt<=now);
 const candles=available.slice(-64);
 if(!candles.length)return <p className="p-4 text-slate-400">この時点までに確定したBTC足はありません。</p>;
 const low=Math.min(...candles.map(c=>c.low)),high=Math.max(...candles.map(c=>c.high));
 const range=Math.max(0.001,high-low),left=40,right=600,top=24,bottom=190;
 const scale=(p:number)=>bottom-(p-(low-0.07*range))/(1.14*range)*(bottom-top);
 const dx=(right-left)/Math.max(1,candles.length);
 const eventMarkers=markers(replay,cursor).filter(x=>x.time>=candles[0].time&&x.time<=candles[candles.length-1].closedAt).slice(-18);
 return <div className="space-y-2">
  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
   <span className="text-slate-300">BTC/USDT・確定済み1時間足</span>
   <strong className="text-cyan-200">{candles[candles.length-1].close.toLocaleString("ja-JP",{maximumFractionDigits:2})} USDT</strong>
  </div>
  <svg viewBox="0 0 650 230" role="img" aria-label="BTCローソク足とモデル取引発火・決済マーカー" className="w-full rounded-lg bg-[#071524]">
  {[0,1,2,3,4].map(i=><g key={i}>
    <line x1={left} x2={right} y1={top+i*(bottom-top)/4} y2={top+i*(bottom-top)/4} stroke="#29384c" strokeWidth=".7" />
    <text x="5" y={top+4+i*(bottom-top)/4} fontSize="10" fill="#94a3b8">{Math.round(high+0.07*range-i*1.14*range/4).toLocaleString("ja-JP")}</text>
  </g>)}
  {candles.map((c,i)=>{
    const x=left+(i+0.5)*dx;
    const green=c.close>=c.open,color=green?"#2dd4bf":"#fb7185";
    return <g key={c.time}>
      <line x1={x} x2={x} y1={scale(c.high)} y2={scale(c.low)} stroke={color} strokeWidth="1.5"/>
      <rect x={x-Math.max(1.8,dx*.3)} y={Math.min(scale(c.open),scale(c.close))} width={Math.max(3.6,dx*.6)} height={Math.max(1.5,Math.abs(scale(c.open)-scale(c.close)))} fill={color} />
      {i%12===0&&<text x={x-14} y="218" fontSize="10" fill="#94a3b8">{c.time.slice(5,10)}</text>}
    </g>;
  })}
  {eventMarkers.map((mark,i)=>{
   const j=candles.findIndex(c=>mark.time>=c.time&&mark.time<c.closedAt);
   if(j<0)return null;
   const c=candles[j],x=left+(j+0.5)*dx;
   const isEntry=mark.kind==="ENTRY";
   const color=isEntry?"#38bdf8":mark.kind==="PARTIAL"?"#a78bfa":mark.result==="POSITIVE"?"#4ade80":mark.result==="NEGATIVE"?"#fb7185":"#fbbf24";
   const y=isEntry?Math.max(12,scale(c.high)-13):Math.min(199,scale(c.low)+15);
   return <g key={i}>
     <circle cx={x} cy={y} r="7" stroke="#0b1724" strokeWidth="1" fill={color} role="button" tabIndex={0} aria-label={mark.label} className="cursor-pointer" onClick={()=>onEventSelect?.(mark.frameIndex,mark.label)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onEventSelect?.(mark.frameIndex,mark.label)}}}>
       <title>{mark.time} {mark.label}</title>
     </circle>
     {(i===eventMarkers.length-1||i===eventMarkers.length-2)&&<text x={Math.min(530,x+7)} y={Math.max(10,y-4)} fontSize="10" fill={color}>{mark.label.slice(0,17)}</text>}
   </g>
  })}
  </svg>
  <p className="text-xs text-slate-400">水色：発火 ／ 紫：部分決済 ／ 緑：利益決済 ／ 赤：損失決済 ／ 黄色：損益不明。マーカーは各通貨のイベントをBTCの時間軸に表示しています。</p>
 </div>;
}
