"use client";
import {useState} from "react";
import type {Replay,BtcCandle} from "@/lib/bt-verification/replay";

export function ResearchSymbolCharts({replay,cursor,onSelectEvent}:{
 replay:Replay;cursor:number;onSelectEvent?:(index:number)=>void;
}){
 const all=replay.symbolCandles;
 const symbols=all?Object.keys(all).sort():[];
 const [selection,setSelection]=useState("BTCUSDT");
 if(!all||!symbols.length)return null;
 const symbol=all[selection]?selection:symbols[0];
 const now=replay.frames[cursor].timestamp;
 const bars=(all[symbol]??[]).filter(c=>c.closedAt<=now).slice(-70);
 const events=replay.frames.slice(0,cursor+1).flatMap((f,index)=>
   f.events.filter(text=>text.includes(symbol)&&/\b(ENTRY|EXIT|PARTIAL)\b/.test(text))
     .map(text=>({timestamp:f.timestamp,index,text})));
 const view={left:44,right:715,top:20,bottom:265};
 const max=Math.max(1,...bars.map(c=>c.high)),min=Math.min(...bars.map(c=>c.low));
 const range=Math.max(1e-8,max-min);
 const top=max+range*.1,low=Math.max(0.00000001,min-range*.1);
 const y=(v:number)=>view.bottom-(v-low)/(top-low)*(view.bottom-view.top);
 const width=(view.right-view.left)/Math.max(70,bars.length);
 const x=(i:number)=>view.right-(bars.length-i-.5)*width;
 const eventMarks=events.filter(e=>bars.some(c=>e.timestamp>=c.time&&e.timestamp<=c.closedAt)).slice(-14);
 const fmt=(n:number)=>n.toLocaleString("ja-JP",{maximumFractionDigits:n<10?7:2});
 return <section className="rounded-xl border border-[#29475b] bg-[linear-gradient(145deg,#13283b,#0d1e30)] p-4">
   <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
     <div><h3 className="text-base font-bold text-white">通貨別・時刻同期チャート</h3>
       <p className="mt-1 text-xs text-[#91aec4]">BTC代表チャートと同じ再生時刻。未来足は表示しません。</p></div>
     <label className="text-xs text-[#abc5d8]">銘柄
       <select value={symbol} onChange={e=>setSelection(e.target.value)}
         className="ml-2 rounded-lg border border-[#365a70] bg-[#0b2032] p-2 text-sm text-white">
         {symbols.map(s=><option key={s} value={s}>{s}</option>)}
       </select>
     </label>
   </div>
   {!bars.length?<p className="p-6 text-sm text-[#94aec1]">この時刻までに確定したローソク足はありません。</p>:<>
     <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-[#b3cce0]">
       <span>{symbol} / {replay.source?.kind==="SYNTHETIC_ANCHORED_DAILY_NO_STRATEGY"?"人工・日足":"ソース保有足"}</span>
       <strong className="font-mono text-sm text-cyan-200">{fmt(bars[bars.length-1].close)}</strong>
     </div>
     <div className="overflow-hidden rounded-xl border border-[#244359] bg-[#071522]">
       <svg role="img" aria-label={symbol+" 確定OHLCと取引イベント"} viewBox="0 0 790 310" className="block w-full">
         {[0,1,2,3,4].map(i=><g key={i}>
           <line x1={view.left} x2={view.right} y1={view.top+i*(view.bottom-view.top)/4}
             y2={view.top+i*(view.bottom-view.top)/4} stroke="#294357" strokeDasharray="3 4"/>
           <text x="723" y={view.top+3+i*(view.bottom-view.top)/4} fontSize="11" fill="#9bb5c9">{fmt(top-i*(top-low)/4)}</text>
         </g>)}
         {bars.map((bar,i)=>{
           const green=bar.close>=bar.open,color=green?"#31ddbf":"#f06a81";
           return <g key={bar.time}>
             <line x1={x(i)} x2={x(i)} y1={y(bar.high)} y2={y(bar.low)} stroke={color} strokeWidth="1.3"/>
             <rect x={x(i)-Math.max(2,width*.32)} y={Math.min(y(bar.open),y(bar.close))}
               width={Math.max(3,width*.64)} height={Math.max(1.8,Math.abs(y(bar.close)-y(bar.open)))}
               rx=".7" fill={color}/>
             {i%12===0&&<text x={x(i)-13} y="293" fontSize="10" fill="#91afc4">{bar.time.slice(5,10)}</text>}
             <title>{bar.time} / O {fmt(bar.open)} H {fmt(bar.high)} L {fmt(bar.low)} C {fmt(bar.close)}</title>
           </g>;
         })}
         {eventMarks.map((e,i)=>{
           const index=bars.findIndex(c=>e.timestamp>=c.time&&e.timestamp<=c.closedAt);
           if(index<0)return null;
           const entry=e.text.includes("ENTRY"),bar=bars[index];
           return <g key={e.index+"-"+i} transform={"translate("+x(index)+" "+(entry?Math.min(280,y(bar.low)+11):Math.max(9,y(bar.high)-11))+")"}
               role="button" tabIndex={0} onClick={()=>onSelectEvent?.(e.index)}
               onKeyDown={evt=>{if(evt.key==="Enter")onSelectEvent?.(e.index);}}>
             <circle r="6.5" stroke={entry?"#48c5ff":"#facc5f"} fill="#0b2131" strokeWidth="2"/>
             <title>{e.timestamp} / {e.text}</title>
           </g>;
         })}
       </svg>
     </div>
     <p className="mt-3 text-xs text-[#91aec4]">{eventMarks.length}件の表示イベント（候補・モデル約定を含む場合はその区分を維持）。市場・戦略の認証状態はデータソースに依存します。</p>
   </>}
 </section>;
}