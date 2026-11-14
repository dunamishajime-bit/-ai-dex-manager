"use client";
import type { ReplayFrame, Position } from "@/lib/bt-verification/replay";
import { grossForFrame, isStock } from "@/lib/bt-verification/replay";

const COLORS=["#22d3ee","#a78bfa","#fbbf24","#34d399","#f472b6","#60a5fa","#c084fc","#fb923c","#2dd4bf","#e879f9","#a3e635","#f87171"];
function colorFor(p:Position):string {
 const key=p.logic+"|"+p.symbol+"|"+p.side;
 let hash=0;
 for(const ch of key)hash=((hash*33) ^ ch.charCodeAt(0)) >>> 0;
 return COLORS[hash%COLORS.length];
}
const fmt=(n:number)=>n.toLocaleString("ja-JP",{minimumFractionDigits:2,maximumFractionDigits:2});
export function GrossAllocationPanel({
 frame, limits, unverifiedCap, researchManifestCap, onSelect, selected
}:{
 frame:ReplayFrame;
 limits:{total:number;crypto:number;stock:number};
 unverifiedCap:boolean;
 researchManifestCap:boolean;
 onSelect:(id:string)=>void;
 selected:string|null;
}){
 const g=grossForFrame(frame);
 const renderMeter=(title:string,used:number,cap:number,positions:Position[])=>{
   const known=positions.reduce((s,p)=>s+(p.gross??0),0);
   const unknown=Math.max(0,used-known);
   const scale=Math.max(cap,used,0.000001);
   return <div className="space-y-2" key={title}>
     <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
       <strong>{title} Gross</strong>
       <div className="text-right">
         <div className="font-mono font-semibold">{fmt(used)}x / {fmt(cap)}x</div>
         <p className="text-xs text-slate-400">上限の {fmt(used/cap*100)}% 使用 / 残り {fmt(Math.max(0,cap-used))}x</p>
       </div>
     </div>
     <div className="flex h-7 overflow-hidden rounded-md bg-[#111e2e]" role="meter" aria-label={title+" Gross使用量"} aria-valuemin={0} aria-valuenow={used} aria-valuemax={cap}>
       {positions.filter(p=>(p.gross??0)>0).map(p=><button
         type="button" key={title+p.id} title={p.logic+" / "+p.symbol+" / "+fmt(p.gross??0)+"x"}
         onClick={()=>onSelect(p.id)}
         className={"h-full min-w-[2px] border-r border-[#05111c] transition-opacity "+(selected===p.id?"opacity-100 ring-2 ring-white":"opacity-90 hover:opacity-100")}
         style={{width:(100*(p.gross??0)/scale)+"%",backgroundColor:colorFor(p),flexShrink:0}}
       />)}
       {unknown>0.000001&&<div className="h-full bg-slate-500/80" title={"未配分Gross "+fmt(unknown)+"x"} style={{width:(100*unknown/scale)+"%",flexShrink:0}}/>}
     </div>
     {used>cap+0.000001&&<p className="text-xs font-semibold text-rose-300">上限超過 {fmt(used-cap)}x（元データの上限設定も確認してください）</p>}
   </div>
 };
 return <section className="rounded-xl border border-cyan-800 bg-[#10243b] p-4">
   <h2 className="mb-3 text-xl font-bold">Gross使用状況（実数値主表示・割合補助）</h2>
   <div className="space-y-5">
     {renderMeter("Total",g.total,limits.total,frame.positions)}
     {renderMeter("Crypto",g.crypto,limits.crypto,frame.positions.filter(p=>!isStock(p.symbol)))}
     {renderMeter("Stock",g.stock,limits.stock,frame.positions.filter(p=>isStock(p.symbol)))}
   </div>
   {researchManifestCap&&<p className="mt-3 text-xs text-slate-400">上限値はこの研究BTの集計マニフェストと一致しています（現在のLIVE設定への適合は別途確認）。</p>}
   {unverifiedCap&&<p className="mt-3 rounded-lg border border-amber-700/60 bg-amber-950/20 p-2 text-sm text-amber-200">Gross上限は元BTの設定との一致が未検証です。割合は仮の上限に対する参考値です。</p>}
   {g.inconsistent&&<p className="mt-3 text-sm text-rose-300">Gross内訳と総Grossが一致しません。元データを検査してください。</p>}
   {g.unallocated>0.001&&<p className="mt-3 text-sm text-amber-200">灰色は建玉に配分できないGross：{fmt(g.unallocated)}x。建玉別の現時点Grossを推測しません。</p>}
   {frame.positions.some(p=>p.gross===null&&(p.grossAtEntry!==undefined||p.lastPartialGrossX!==undefined))&&<div className="mt-4 rounded-lg border border-slate-600 bg-[#071524] p-3">
     <h3 className="font-semibold text-sm">参考：保有建玉の投入時Gross（現在値ではありません）</h3>
     <p className="mt-1 mb-3 text-xs text-slate-400">元のモデル約定に記録された投入時の値です。現在の総Grossとは一致しない場合があり、上の正式スナップショットの灰色領域を置き換えません。</p>
     <p className="mb-1 font-mono text-xs text-amber-100">投入時Gross合計 {fmt(frame.positions.reduce((n,p)=>n+(p.gross===null?(p.grossAtEntry??0):0),0))}x</p>
     <div className="flex h-3 overflow-hidden rounded bg-slate-800">
       {frame.positions.filter(p=>p.gross===null&&(p.grossAtEntry??0)>0).map(p=><button
         type="button" key={p.id} onClick={()=>onSelect(p.id)}
         title={p.logic+" "+p.symbol+" entry Gross "+fmt(p.grossAtEntry??0)+"x"}
         className="h-full min-w-[2px] border-r border-slate-950"
         style={{width:(100*(p.grossAtEntry??0)/Math.max(limits.total,frame.positions.reduce((n,x)=>n+(x.gross===null?(x.grossAtEntry??0):0),0)))+"%",backgroundColor:colorFor(p),flexShrink:0}} />)}
     </div>
   </div>}
   <h3 className="mt-5 mb-1 font-semibold">建玉別Gross内訳</h3>
   <p className="text-xs text-slate-400">全建玉表示：表示フィルターはTotalの計算・内訳には適用されません。</p>
   <div className="mt-2 space-y-1">
     {frame.positions.map(p=>{
       const current=p.gross;
       return <button type="button" key={p.id} onClick={()=>onSelect(p.id)}
         className={"flex w-full flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-slate-800 "+(selected===p.id?"bg-slate-800 ring-1 ring-cyan-400":"")}>
         <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{backgroundColor:current===null?"#64748b":colorFor(p)}}/>{p.logic} / {p.symbol} / {p.side}</span>
         {current!==null?<span className="font-mono">{fmt(current)}x・使用中Grossの {g.total>0?fmt(current/g.total*100)+"%":"—"}・Total上限の {fmt(current/limits.total*100)}%</span>:
          <span className="text-amber-200">{p.grossAtEntry!==undefined&&p.grossAtEntry!==null?"発注時 "+fmt(p.grossAtEntry)+"x / ":""}{p.lastPartialGrossX!==undefined?"一部決済時の残Gross "+fmt(p.lastPartialGrossX??0)+"x / ":""}現時点Gross未算定</span>}
       </button>;
     })}
     {frame.positions.length===0&&<p className="text-sm text-slate-400">この時点の保有建玉はありません。</p>}
   </div>
 </section>;
}
