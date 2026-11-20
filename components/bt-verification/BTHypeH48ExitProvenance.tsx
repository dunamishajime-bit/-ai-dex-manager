"use client";

import type {Replay} from "@/lib/bt-verification/replay";
import {safeStandaloneH48ExitComparison} from "@/lib/bt-verification/hype-exit-provenance";
import source from "@/docs/research-results/BT_HYPE_H48_TIME_ONLY_STANDALONE_COUNTERFACTUAL_20261119_UNCERTIFIED.json";

export function BTHypeH48ExitProvenance({replay}:{replay:Replay}){
 if(replay.source?.kind!=="HISTORICAL_STABLE4_RESEARCH_NOT_PRODUCTION")return null;
 const cases=safeStandaloneH48ExitComparison(source);
 return <section aria-label="HYPE H48 モデル出口差分" className="rounded-xl border border-[#4b516d] bg-[linear-gradient(135deg,#1a2a3a,#1a2335)] p-4">
   <div className="flex flex-wrap items-center justify-between gap-2">
     <h3 className="text-sm font-semibold text-white">HYPE H48｜出口モデルの再検証</h3>
     <span className="rounded-md border border-amber-500/50 px-2 py-1 text-xs text-amber-200">単独研究・本番未認証</span>
   </div>
   <p className="mt-2 text-xs leading-6 text-[#b4c1d1]">
     旧研究の27候補・同一モデル入口価格について、M5の6%損切りありとH1の48時間境界価格で決済する仮想ケースを比較。
     旧研究の27候補には損切り6件がありました。これは実取引27件を意味しません。
   </p>
   {cases===null?
      <p className="mt-3 text-xs text-amber-200">検証データが不整合のため結果を表示できません。</p>
     :<div className="mt-3 overflow-x-auto rounded-lg border border-[#394b60]">
      <table className="w-full min-w-[620px] text-left text-xs">
       <thead className="bg-[#172f42] text-[#b9d0df]"><tr>
        <th className="p-3">手数料モデル</th><th className="p-3">旧勝率</th><th className="p-3">時間決済勝率</th>
        <th className="p-3">旧最大単独損失</th><th className="p-3">時間決済最大単独損失</th><th className="p-3">最悪損失差</th>
       </tr></thead>
       <tbody className="divide-y divide-[#36485f]">
        {cases.map(item=><tr key={item.bps} className="text-[#d7e5ed]">
          <td className="p-3 font-semibold">{item.bps}bps</td>
          <td className="p-3 tabular-nums">{item.historicalWinPct.toFixed(2)}%</td>
          <td className="p-3 tabular-nums">{item.timeOnlyWinPct.toFixed(2)}%</td>
          <td className="p-3 tabular-nums">{item.historicalWorstPct.toFixed(2)}%</td>
          <td className="p-3 tabular-nums text-rose-200">{item.timeOnlyWorstPct.toFixed(2)}%</td>
          <td className="p-3 tabular-nums text-amber-200">{item.worstDeltaPctPoints.toFixed(2)}pt</td>
        </tr>)}
       </tbody>
      </table>
     </div>}
   <p className="mt-3 text-xs leading-6 text-[#a9bdd0]">
     これは元の27候補の出口差分だけを比較した結果です。旧統合BTのHYPE採用5件や現行のシグナル候補35件、
     V4優先決済、他Runner、Shared Risk、Gross、Funding、実スリッページ、取引所の建玉・STOP、最大DDは再現していません。
     勝率が同じでも最大損失が悪化する可能性があります。
   </p>
 </section>;
}
