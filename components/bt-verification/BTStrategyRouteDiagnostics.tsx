"use client";

import {useMemo,useState} from "react";
import type {Replay} from "@/lib/bt-verification/replay";

type Order = "losses"|"adverse"|"net";

const jpy=(n:number)=>"¥"+n.toLocaleString("ja-JP",{maximumFractionDigits:0});

export function BTStrategyRouteDiagnostics({replay}:{replay:Replay}){
 const [logic,setLogic]=useState("ALL");
 const [order,setOrder]=useState<Order>("losses");
 const records=replay.strategyRouteStats??[];
 const rows=useMemo(()=>records.filter(x=>logic==="ALL"||x.logic===logic).slice().sort((a,b)=>{
   if(order==="adverse")return b.adverseExitCount!-a.adverseExitCount!;
   if(order==="net")return a.netPnlJpy-b.netPnlJpy;
   return b.netLossCount!-a.netLossCount!;
 }).slice(0,100),[records,logic,order]);
 if(replay.source?.kind!=="HISTORICAL_STABLE4_RESEARCH_NOT_PRODUCTION"||records.length===0)return null;
 const logics=[...new Set(records.map(x=>x.logic))].sort();
 return <section className="rounded-xl border border-[#2e4f61] bg-[linear-gradient(135deg,#11283b,#0d1f31)] p-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div>
    <h3 className="text-sm font-bold text-white">ルート・通貨別の研究損失分析</h3>
    <p className="mt-1 text-xs leading-6 text-[#9cb9ca]">研究モデルの決済のみ。逆方向決済はエントリー価格に対し不利な価格で終わった件数で、方向誤判定の確定件数ではありません。</p>
   </div>
   <span className="rounded-md border border-amber-600/40 px-2 py-1 text-xs text-amber-200">旧STABLE4・LIVE未認証</span>
  </div>
  <div className="mt-3 flex flex-wrap gap-3">
   <label className="text-xs text-[#a4bdcc]">ロジック
    <select value={logic} onChange={e=>setLogic(e.target.value)} className="ml-2 rounded-lg border border-[#365a70] bg-[#0b1e2e] px-2 py-1.5 text-white">
     <option value="ALL">全ロジック</option>
     {logics.map(name=><option key={name} value={name}>{name}</option>)}
    </select>
   </label>
   <label className="text-xs text-[#a4bdcc]">優先順
    <select value={order} onChange={e=>setOrder(e.target.value as Order)} className="ml-2 rounded-lg border border-[#365a70] bg-[#0b1e2e] px-2 py-1.5 text-white">
     <option value="losses">損失決済件数が多い順</option>
     <option value="adverse">不利な価格方向が多い順</option>
     <option value="net">モデル純損益が低い順</option>
    </select>
   </label>
  </div>
  <div className="mt-3 max-h-[480px] overflow-auto rounded-lg border border-[#29465b]">
   <table className="w-full min-w-[820px] text-left text-xs">
    <thead className="sticky top-0 bg-[#0b2234] text-[#a5bdcc]"><tr>
     <th className="p-3">ロジック</th><th className="p-3">ルート</th><th className="p-3">通貨</th>
     <th className="p-3">決済</th><th className="p-3">勝率</th><th className="p-3">損失</th>
     <th className="p-3">不利な価格方向</th><th className="p-3">モデル純損益</th>
    </tr></thead>
    <tbody className="divide-y divide-[#2b455b]">
    {rows.map(x=><tr key={JSON.stringify([x.logic,x.route,x.symbol])} className="text-[#d2e1eb]">
      <td className="p-3 font-semibold text-cyan-200">{x.logic}</td>
      <td className="p-3 font-mono">{x.route}</td>
      <td className="p-3">{x.symbol}</td>
      <td className="p-3 tabular-nums">{x.closedCount}</td>
      <td className="p-3 tabular-nums">{x.winRatePct===null?"－":x.winRatePct.toFixed(1)+"%"}</td>
      <td className="p-3 tabular-nums">{x.netLossCount??"－"}</td>
      <td className="p-3 tabular-nums">{x.adverseExitCount??"－"}</td>
      <td className={"p-3 font-semibold tabular-nums "+(x.netPnlJpy<0?"text-rose-300":"text-emerald-300")}>{jpy(x.netPnlJpy)}</td>
    </tr>)}
    </tbody>
   </table>
  </div>
  <p className="mt-2 text-xs leading-6 text-[#86a5b8]">金額は複利・モデル決済時点の値で、元本固定の損失額ではありません。最大100行表示。改善判定には別期間の検証が必要です。</p>
 </section>;
}
