"use client";
import {useMemo,useState} from "react";
import type {Replay} from "@/lib/bt-verification/replay";
const tile="rounded-xl border border-[#29475b] bg-[linear-gradient(145deg,#13283b,#0d1e30)] p-4";
const money=(n:number)=>"¥"+n.toLocaleString("ja-JP",{maximumFractionDigits:0});
export function BTStrategyResearchDiagnostics({replay}:{replay:Replay}){
 const [logic,setLogic]=useState("ALL");
 const catalog=replay.strategyCatalog??[];
 const stats=replay.strategyStats??[];
 const sorted=useMemo(()=>stats.filter(x=>logic==="ALL"||x.logic===logic)
   .slice().sort((a,b)=>a.netPnlJpy-b.netPnlJpy).slice(0,40),[stats,logic]);
 const terminal=replay.terminalModelPositions??[];
 if(!catalog.length&&!stats.length&&!terminal.length)return null;
 return <section className={tile}>
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div>
    <h3 className="text-base font-bold text-white">研究ソース・ロジック別検証台帳</h3>
    <p className="mt-1 text-xs leading-6 text-[#9bb9ce]">現在のLIVE認証済み設定ではありません。ソースSHAは研究台帳の参照コミットです。実約定・Production一致とは区別します。</p>
   </div>
   <span className="rounded-lg border border-amber-600/50 px-2 py-1 text-xs font-semibold text-amber-200">RESEARCH / 未認証</span>
  </div>
  {!!catalog.length&&<div className="mt-4 overflow-x-auto rounded-lg border border-[#2b455c]">
    <table className="w-full min-w-[610px] text-left text-xs">
     <thead className="bg-[#0b2234] text-[#91b2c6]"><tr>
      <th className="p-3">ロジック</th><th className="p-3">モデル決済</th>
      <th className="p-3">ルート数</th><th className="p-3">通貨数</th>
      <th className="p-3">研究ソースSHA</th></tr></thead>
     <tbody className="divide-y divide-[#29465b]">
      {catalog.map(item=><tr key={item.logic} className="text-[#d2e1eb]">
       <td className="p-3 font-bold text-cyan-200">{item.logic}</td>
       <td className="p-3 tabular-nums">{item.trades.toLocaleString("ja-JP")}</td>
       <td className="p-3">{item.routes}</td><td className="p-3">{item.symbols}</td>
       <td className="p-3 font-mono" title={item.sourceRuntimeShas.join(", ")}>{item.sourceRuntimeShas.map(v=>v.slice(0,12)).join(", ")}</td>
      </tr>)}
     </tbody>
    </table>
   </div>}
  {!!stats.length&&<div className="mt-6">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <h4 className="text-sm font-bold text-white">ロジック × 通貨の損益・勝率・逆行決済</h4>
    <label className="text-xs text-[#9cb9cb]">対象ロジック
      <select value={logic} onChange={e=>setLogic(e.target.value)}
        className="ml-2 rounded-lg border border-[#365a70] bg-[#0b1e2e] px-3 py-2 text-sm text-white">
       <option value="ALL">全ロジック</option>
       {catalog.map(x=><option key={x.logic} value={x.logic}>{x.logic}</option>)}
      </select>
    </label>
   </div>
   <p className="mt-2 text-xs leading-6 text-[#8faec1]">損益の悪い通貨から表示。逆行決済＝ロングで決済価格が入口より低い、またはショートで高い。将来の最適点やエントリー誤判定の確定数ではありません。</p>
   <div className="mt-3 max-h-[450px] overflow-auto rounded-lg border border-[#2b455c]">
    <table className="w-full min-w-[680px] text-left text-xs">
     <thead className="sticky top-0 bg-[#0b2234] text-[#91b2c6]"><tr>
      <th className="p-3">ロジック / 通貨</th><th className="p-3">決済件数</th>
      <th className="p-3">勝率</th><th className="p-3">負け件数</th>
      <th className="p-3">価格逆行決済</th><th className="p-3">モデル合計損益</th></tr></thead>
     <tbody className="divide-y divide-[#29465b]">
      {sorted.map(x=><tr key={x.logic+"-"+x.symbol} className="text-[#cddde8]">
       <td className="p-3 font-semibold">{x.logic} / <span className="text-cyan-200">{x.symbol}</span></td>
       <td className="p-3 tabular-nums">{x.closedCount}{x.tradeCount>x.closedCount?"（未決済"+(x.tradeCount-x.closedCount)+"）":""}</td>
       <td className="p-3">{x.winRatePct===null?"—":x.winRatePct.toFixed(1)+"%"}</td>
       <td className="p-3">{x.netLossCount??"未算出"}</td>
       <td className="p-3">{x.adverseExitCount??"未算出"}</td>
       <td className={"p-3 font-semibold tabular-nums "+(x.netPnlJpy<0?"text-rose-300":"text-emerald-300")}>{money(x.netPnlJpy)}</td>
      </tr>)}
     </tbody>
    </table>
   </div>
  </div>}
  {!!terminal.length&&<div className="mt-6 rounded-xl border border-amber-600/40 bg-[#332819] p-4">
   <h4 className="font-bold text-amber-200">期間末モデル未決済建玉（実口座の保有ではありません）</h4>
   {terminal.map((p,i)=><p key={i} className="mt-2 text-xs leading-6 text-[#e0d1b6]">
    {p.logic} / {p.symbol} {p.side}、モデル入口 {p.openedAt}、
    入口価格 {p.entryPrice}、割当Gross {p.entryGrossX}x、ルート {p.route}
    {p.modeledFutureExitAt?"、仮定上の将来決済 "+p.modeledFutureExitAt:""}
   </p>)}
  </div>}
 </section>;
}