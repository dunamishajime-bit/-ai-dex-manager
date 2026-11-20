"use client";

import {useMemo} from "react";
import type {Replay} from "@/lib/bt-verification/replay";
import {compareStudyPinsWithObservedVps} from "@/lib/bt-verification/source-pin-compat";
import observed from "@/docs/research-results/BT_VPS_ENTRYPOINT_PARITY_20261119_UNCERTIFIED.json";

const labels={
  RESEARCH_SOURCE_DIFFERS:"研究版と稼働ソースが異なる",
  SHA_MATCH_NOT_PARITY:"SHA一致・BT結果は未認証",
  NO_TRUSTED_OBSERVATION:"照合用の証拠不足",
} as const;

export function BTResearchLivePinEvidence({replay}:{replay:Replay}){
 const rows=useMemo(()=>compareStudyPinsWithObservedVps(replay.strategyCatalog??[],observed),[replay.strategyCatalog]);
 if(replay.source?.kind!=="HISTORICAL_STABLE4_RESEARCH_NOT_PRODUCTION"||rows.length===0)return null;
 const observedAt=new Date(observed.observed_utc).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
 const mismatched=rows.filter(r=>r.status==="RESEARCH_SOURCE_DIFFERS");
 return <section aria-label="研究ソースとVPS観測SHAの照合" className="rounded-xl border border-[#345368] bg-[linear-gradient(135deg,#10263a,#101c2e)] p-4">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <h3 className="text-sm font-semibold text-white">研究BTのソースと稼働観測の差分</h3>
    <span className="rounded-md border border-amber-500/40 px-2 py-1 text-xs text-amber-200">未認証・観測時点の比較</span>
   </div>
   <p className="mt-2 text-xs leading-6 text-[#a5bbca]">
    観測時点：{observedAt} JST。これは記録済みのVPSスナップショットであり、現在の稼働状態をリアルタイムで確認するものではありません。
    SHAが一致してもエントリー、決済、Shared Risk、Gross、実約定の一致は証明されません。
   </p>
   <p className="mt-2 text-xs font-semibold text-[#f4c694]">
     {mismatched.length}系統に研究版と観測版のSHA差分があります。差分のあるモデル決済を現行LIVE結果として扱わないでください。
   </p>
   <div className="mt-3 overflow-auto rounded-lg border border-[#29475b]">
    <table className="w-full min-w-[760px] text-left text-xs">
     <thead className="bg-[#0a2030] text-[#a4bdd0]"><tr><th className="p-3">Runner</th><th className="p-3">研究版SHA</th><th className="p-3">観測版SHA</th><th className="p-3">判定</th></tr></thead>
     <tbody className="divide-y divide-[#2c475d]">
     {rows.map(row=><tr key={row.logic} className="text-[#d0dfeb]">
      <td className="p-3 font-semibold">{row.logic}</td>
      <td className="p-3 font-mono" title={row.researchShas.join(", ")}>{row.researchShas.map(x=>x.slice(0,12)).join(", ")||"－"}</td>
      <td className="p-3 font-mono" title={row.observedSha??""}>{row.observedSha?.slice(0,12)??"－"}</td>
      <td className={"p-3 "+(row.status==="RESEARCH_SOURCE_DIFFERS"?"text-amber-200":"text-[#9ac1d2]")}>{labels[row.status]}</td>
     </tr>)}
     </tbody>
    </table>
   </div>
 </section>;
}
