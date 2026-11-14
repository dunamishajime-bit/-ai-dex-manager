"use client";
import type {Replay,BtcCandle} from "@/lib/bt-verification/replay";

type Mark={frameIndex:number;time:string;label:string;kind:"ENTRY"|"EXIT"|"PARTIAL";result:"POSITIVE"|"NEGATIVE"|"UNKNOWN"};
const LOGICS=["DEMO_Q102","DEMO_PENGU","DEMO_V4","V4","V12","PENGU","V52","Q102","HYPE","FET","IDLE","STABLE3","STABLE4"];
const fmt=(n:number)=>n.toLocaleString("ja-JP",{minimumFractionDigits:2,maximumFractionDigits:2});
function markers(replay:Replay,cursor:number):Mark[]{
 const result:Mark[]=[];
 for(let i=Math.max(0,cursor-1800);i<=cursor;i++){
  const frame=replay.frames[i];
  for(const event of frame.events){
   if(event.startsWith("BLOCK ")||event.includes(" RISK ")||event.startsWith("RISK ")||event.startsWith("FUNDING "))continue;
   const time=(event.length>=20&&event.charAt(4)==="-"&&event.charAt(10)==="T")?event.slice(0,20):frame.timestamp;
   const enter=event.includes("ENTRY")||event.includes("発火")||event.includes("エントリー");
   const partial=event.includes("PARTIAL")||event.includes("部分決済");
   const exit=event.includes("EXIT")||event.includes("利確")||event.includes("損切")||event.includes("決済");
   if(!enter&&!partial&&!exit)continue;
   const logic=LOGICS.find(x=>new RegExp("(^|[^A-Z0-9_])"+x+"([^A-Z0-9_]|$)").test(event))??"BT";
   result.push({frameIndex:i,time,label:logic+(enter?" 発火":partial?" 部分決済":" 決済")+" / "+event,
     kind:enter?"ENTRY":partial?"PARTIAL":"EXIT",
     result:event.includes("利確")||/\+\d+(?:\.\d+)?\s*JPY/.test(event)?"POSITIVE":
       event.includes("損切")||/-\d+(?:\.\d+)?\s*JPY/.test(event)?"NEGATIVE":"UNKNOWN"});
  }
 }
 return result;
}
function hourLabel(c:BtcCandle){return c.time.slice(5,10)+" "+c.time.slice(11,13)+"時"}
export function BtcCandlestickChart({replay,cursor,onEventSelect}:{
 replay:Replay;cursor:number;onEventSelect?:(frameIndex:number,label:string)=>void;
}){
 const frame=replay.frames[cursor],now=frame.timestamp;
 // Future data exists in imported archives. Only expose completed bars as-of the
 // observed simulation clock, plus the synthetic bar formed from past/current ticks.
 const completed=(replay.btcCandles??[]).filter(c=>c.closedAt<=now);
 const forming=replay.mode==="DEMO"?frame.formingBtcCandle:undefined;
 const all=forming?[...completed,forming]:completed;
 const bars=all.slice(-68);
 if(!bars.length)return <div className="rounded-xl border border-[#234359] bg-[#08192c] p-8 text-center text-sm text-[#8ba5bd]">確定済みのBTCローソク足を待っています。デモでは足が5分ごとに形成されます。</div>;

 const left=55,right=701,top=24,bottom=256;
 const priceMin=Math.min(...bars.map(c=>c.low));
 const priceMax=Math.max(...bars.map(c=>c.high));
 const rawRange=Math.max(2,priceMax-priceMin);
 const max=priceMax+rawRange*.11,min=Math.max(1,priceMin-rawRange*.1);
 const span=Math.max(1,max-min);
 const y=(price:number)=>bottom-((price-min)/span)*(bottom-top);
 const w=(right-left)/68;
 const xAt=(i:number)=>right-(bars.length-i-.5)*w;
 const current=bars[bars.length-1];
 const currentX=xAt(bars.length-1),price=current.close,priceY=y(price);
 const gain=frame.btc===null?0:(price/current.open-1)*100;
 const eventMarkers=markers(replay,cursor)
   .filter(mark=>mark.time>=bars[0].time && mark.time<=bars[bars.length-1].closedAt)
   .slice(-13);
 const activeRatio=forming?Math.min(1,Math.max(0,
   (Date.parse(now)-Date.parse(forming.time))/
   (Date.parse(forming.closedAt)-Date.parse(forming.time)))):1;
 const chartGradientId="bt-chart-bg",glowId="bt-chart-glow";
 const isSynthetic=replay.mode==="DEMO";
 return <div className="min-w-0 space-y-2">
  <div className="flex flex-wrap items-start justify-between gap-3 px-1">
   <div className="flex items-center gap-2.5">
     <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e39c2d]/15 text-[14px] text-[#f6af3c]">₿</span>
     <div><strong className="block text-[13px] font-bold text-white">BTC / USDT</strong>
       <span className="text-[10px] text-[#7799b1]">1時間足 · {isSynthetic?"形成中の足を5分刻みで更新":"確定足の履歴再生"}</span></div>
     {forming&&<span className="rounded-full border border-cyan-500/35 bg-[#114755] px-2 py-1 text-[10px] font-semibold text-cyan-200">● 形成中 {Math.round(activeRatio*100)}%</span>}
   </div>
   <div className="text-right"><div className="font-mono text-[17px] font-bold tabular-nums tracking-tight text-[#d3f4f3] sm:text-[20px]">{fmt(price)} <span className="text-[10px] font-semibold text-[#86a7bc]">USDT</span></div>
     <div className={"font-mono text-[11px] "+(gain>=0?"text-emerald-300":"text-rose-300")}>{gain>=0?"+":""}{gain.toFixed(2)}% <span className="text-[#8aa4ba]">/ 現在足</span></div>
   </div>
  </div>
  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-[#254157] bg-[#0a1b2c] px-3 py-2.5 text-[11px]">
    {([
      ["O / 始値",current.open,"text-[#caddeb]"],
      ["H / 高値",current.high,"text-emerald-300"],
      ["L / 安値",current.low,"text-rose-300"],
      ["C / 現在値",current.close,"text-cyan-200"]
    ] as const).map(([name,value,color])=><div key={name} className="flex items-center gap-2">
      <span className="text-[#7695ad]">{name}</span>
      <span className={"font-mono font-bold tabular-nums transition-colors duration-150 "+color}>{fmt(value)}</span>
    </div>)}
    {forming&&<div className="ml-auto flex items-center gap-2">
      <span className="text-[10px] text-[#799fb5]">足の進行</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[#234056]">
        <span className="block h-full rounded-full bg-[#21cdbf] transition-[width] duration-150" style={{width:(activeRatio*100)+"%"}}/>
      </span>
    </div>}
  </div>
  <div className="overflow-hidden rounded-xl border border-[#264157] bg-[#071522] shadow-[inset_0_0_32px_rgba(0,0,0,.28)]">
   <svg viewBox="0 0 790 331" role="img" aria-label="BTCローソク足とモデル取引発火・決済マーカー" className="block w-full">
     <defs>
       <linearGradient id={chartGradientId} x1="0" x2="0" y1="0" y2="1">
         <stop offset="0" stopColor="#0e273b"/><stop offset=".48" stopColor="#091c2d"/><stop offset="1" stopColor="#061321"/>
       </linearGradient>
       <linearGradient id={glowId} x1="0" x2="1"><stop offset="0" stopColor="#06263a" stopOpacity="0"/><stop offset="1" stopColor="#13516a" stopOpacity=".19"/></linearGradient>
       <filter id="bt-current-price-glow" x="-30%" y="-120%" width="160%" height="340%">
         <feGaussianBlur stdDeviation="3.3"/>
       </filter>
     </defs>
     <rect x="0" y="0" width="790" height="331" fill={"url(#"+chartGradientId+")"}/>
     <rect x="550" y="12" width="151" height="250" fill={"url(#"+glowId+")"}/>
     {[0,1,2,3,4,5].map(i=><g key={"h"+i}>
       <line x1={left} x2={right} y1={top+(bottom-top)*i/5} y2={top+(bottom-top)*i/5} stroke="#244158" strokeWidth=".75" strokeDasharray="3 4"/>
       <text x="711" y={top+4+(bottom-top)*i/5} fontSize="11" fill="#8aa3ba" fontFamily="ui-monospace,monospace">
         {Math.round(max-span*i/5).toLocaleString("ja-JP")}
       </text>
     </g>)}
     {[0,1,2,3,4,5,6,7,8].map(i=><line key={"v"+i}
       x1={left+i*(right-left)/8} x2={left+i*(right-left)/8} y1={top} y2="302"
       stroke="#1b394f" strokeWidth=".6" opacity=".65"/>)}
     <rect x={left} y="270" width={right-left} height="27" fill="#0a1c2b" fillOpacity=".9"/>
     <line x1={left} x2={right} y1="270" y2="270" stroke="#294155" strokeWidth=".8"/>
     {bars.map((c,i)=>{
       const xx=xAt(i),green=c.close>=c.open,color=green?"#31ddbf":"#f06a81";
       const bodyTop=Math.min(y(c.open),y(c.close));
       const bodyHeight=Math.max(1.75,Math.abs(y(c.open)-y(c.close)));
       const isForming=c.time===forming?.time;
       const bodyWidth=Math.min(7.8,Math.max(4.1,w*.7));
       const volumeIntensity=Math.max(.06,Math.min(1,(c.high-c.low)/Math.max(1,rawRange*.35)));
       return <g key={c.time} style={{transform:"translateX("+xx+"px)",transition:"transform 160ms cubic-bezier(.22,.7,.3,1)"}}>
         <line x1="0" x2="0" y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={isForming?1.7:1.25}
           style={{transition:"y1 120ms ease-out, y2 120ms ease-out"}}/>
         <rect x={-bodyWidth/2} y={bodyTop} width={bodyWidth} height={bodyHeight}
           rx=".75" fill={color} opacity={isForming?1:.9}
           stroke={isForming?"#d1faf5":"none"} strokeWidth={isForming?.45:0}
           style={{transition:"y 120ms ease-out,height 120ms ease-out,fill 100ms"}}/>
         {isForming&&<rect x={-bodyWidth/2-1} y={bodyTop-1} width={bodyWidth+2}
           height={bodyHeight+2} fill="none" stroke="#67e8f9" strokeOpacity=".32" strokeWidth="1.2"
           style={{transition:"y 120ms ease-out,height 120ms ease-out"}}/>}
         <rect x={-bodyWidth/2} y={295-21*volumeIntensity} width={bodyWidth} height={21*volumeIntensity}
           fill={color} opacity={isForming?.52:.26}/>
         {i%12===0&&<text x="-24" y="320" fontSize="10.5" fill="#7897ad">{c.time.slice(5,10)}</text>}
         <title>{hourLabel(c)} · O {fmt(c.open)} / H {fmt(c.high)} / L {fmt(c.low)} / C {fmt(c.close)} {isForming?"(形成中)":"(確定)"}</title>
       </g>;
     })}
     {eventMarkers.map((mark,i)=>{
       const j=bars.findIndex(c=>mark.time>=c.time&&mark.time<=c.closedAt);
       if(j<0)return null;
       const c=bars[j],xx=xAt(j);
       const entry=mark.kind==="ENTRY";
       const color=entry?"#40c9ff":mark.kind==="PARTIAL"?"#a78bfa":mark.result==="POSITIVE"?"#5ee5a0":mark.result==="NEGATIVE"?"#ff768a":"#facc5f";
       const yy=entry?Math.min(293,y(c.low)+21):Math.max(11,y(c.high)-20);
       return <g key={mark.frameIndex+"-"+i} transform={"translate("+xx+" "+yy+")"}
         onClick={()=>onEventSelect?.(mark.frameIndex,mark.label)} onKeyDown={e=>{
           if(e.key==="Enter"||e.key===" "){e.preventDefault();onEventSelect?.(mark.frameIndex,mark.label)}
         }} role="button" tabIndex={0} aria-label={mark.label} className="cursor-pointer">
         <circle r="11" fill={color} opacity=".15"/><circle r="6.1" fill="#0a1d30" stroke={color} strokeWidth="2"/>
         <path d={entry?"M0 -3 L3 2 L-3 2 Z":"M0 3 L3 -2 L-3 -2 Z"} fill={color}/>
         {i>=eventMarkers.length-2&&<g transform={"translate("+(xx>530?-103:11)+" -12)"}>
           <rect width="101" height="21" rx="5" fill="#132b41" stroke={color} strokeOpacity=".72"/>
           <text x="7" y="14" fill="#dceaf6" fontSize="9.8" fontWeight="600">{mark.label.slice(0,14)}</text>
         </g>}
         <title>{mark.time} / {mark.label}</title>
       </g>;
     })}
     <line x1={left} x2={right} y1={priceY} y2={priceY} stroke="#32dacc" strokeWidth=".85"
       strokeDasharray="5 5" opacity=".73" style={{transition:"y1 125ms ease-out,y2 125ms ease-out"}}/>
     <line x1={currentX} x2={currentX} y1={top} y2="302" stroke="#2db7d9"
       strokeWidth=".65" strokeDasharray="3 5" opacity=".63" style={{transition:"x1 130ms ease-out,x2 130ms ease-out"}}/>
     <rect x="707" y={Math.max(8,Math.min(249,priceY-12))} width="80" height="24" rx="5"
       fill="#1ac4ac" opacity=".24" filter="url(#bt-current-price-glow)"/>
     <rect x="707" y={Math.max(8,Math.min(249,priceY-12))} width="80" height="24" rx="4.8"
       fill="#18bdae" stroke="#4febd2" strokeWidth=".8"
       style={{transition:"y 125ms linear"}}/>
     <text x="713" y={Math.max(24,Math.min(265,priceY+4))} fontSize="11" fill="#062d30"
       fontFamily="ui-monospace,monospace" fontWeight="800"
       style={{transition:"y 125ms linear"}}>{Math.round(price).toLocaleString("ja-JP")}</text>
   </svg>
  </div>
  <div className="flex flex-wrap items-center justify-between gap-2 px-1">
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-[#91b0c4]">
      <span><span className="mr-1 text-cyan-300">▲</span>発火</span>
      <span><span className="mr-1 text-emerald-300">▼</span>利益決済</span>
      <span><span className="mr-1 text-rose-300">▼</span>損切り</span>
      <span><span className="mr-1 text-violet-300">◆</span>部分決済</span>
      <span className="text-[#728da4]">{isSynthetic?"下段は模擬値幅強度（実出来高ではありません）":"下段は足の値幅強度（出来高ではありません）"}</span>
    </div>
    <span className="font-mono text-[10px] text-[#86b0c5]">{now.replace("T"," ").replace("Z"," UTC")}</span>
  </div>
 </div>;
}
