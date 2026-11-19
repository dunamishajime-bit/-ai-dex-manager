"use client";

import type {Replay} from "@/lib/bt-verification/replay";
import {auditedRiskSourceDifferences} from "@/lib/bt-verification/risk-cap-provenance";
import v4 from "@/docs/research-results/BT_V4_SOURCE_GROSS_CAP_DRIFT_20261119_UNCERTIFIED.json";
import hype from "@/docs/research-results/BT_HYPE_SOURCE_GROSS_CAP_DRIFT_20261119_UNCERTIFIED.json";

export function BTRiskCapProvenance({replay}:{replay:Replay}){
 if(replay.source?.kind!=="HISTORICAL_STABLE4_RESEARCH_NOT_PRODUCTION")return null;
 const rows=auditedRiskSourceDifferences(hype,v4);
 return <section aria-label="旧研究とVPSソースのGross上限差" className="rounded-xl border border-[#515778] bg-[linear-gradient(135deg,#211e38,#172338)] p-4">
   <div className="flex flex-wrap items-center justify-between gap-2">
    <h3 className="text-sm font-semibold text-white">Gross上限の研究版・実装版比較</h3>
    <span className="rounded-md border border-amber-500/50 px-2 py-1 text-xs text-amber-200">本番実効上限は未確認</span>
   </div>
   <p className="mt-2 text-xs leading-6 text-[#b1b9cc]">
    旧STABLE4研究BTの10/30bps設定と、VPSで照合済みの固定SHAソースに書かれた局所的な入口上限を比較しています。
    保存済み監査記録の比較であり、現在の取引所建玉・認証済みリスク設定・共有ゲートの実効上限を表示するものではありません。
   </p>
   {rows.length===4?
   <div className="mt-3 overflow-x-auto rounded-lg border border-[#44526d]">
    <table className="w-full min-w-[640px] text-left text-xs">
     <thead className="bg-[#222b43] text-[#c3d2e1]"><tr><th className="p-3">Runner</th><th className="p-3">上限項目</th><th className="p-3">旧研究BT</th><th className="p-3">固定ソース</th><th className="p-3">差分</th></tr></thead>
     <tbody className="divide-y divide-[#3a4c65]">
      {rows.map(row=><tr key={row.runner+row.category} className="text-[#dce6ef]">
       <td className="p-3 font-semibold">{row.runner}</td>
       <td className="p-3">{row.category}</td>
       <td className="p-3 tabular-nums">{row.historicalModel.toFixed(2)}x</td>
       <td className="p-3 tabular-nums">{row.pinnedSource.toFixed(2)}x</td>
       <td className="p-3 font-semibold tabular-nums text-amber-200">{row.difference>0?"+":""}{row.difference.toFixed(2)}x</td>
      </tr>)}
     </tbody>
    </table>
   </div>
   :<p className="mt-3 text-xs text-amber-200">監査証跡が不足または不整合のため、Gross上限を比較できません。</p>}
   <p className="mt-3 text-xs leading-6 text-[#b0bbd0]">共有リスク・Margin Guard・Owner承認によってさらに厳しい制限が適用される可能性があります。ここに示す値は実取引の上限や超過を証明しません。研究版をLIVE完全一致のBTとして扱わないでください。</p>
 </section>;
}
