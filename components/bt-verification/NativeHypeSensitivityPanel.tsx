import type {NativeHypeSensitivityComparison} from "@/lib/bt-verification/native-hype-sensitivity-comparison";

/** Read-only index preview; JSON hash validation occurs when an item is opened. */
export function NativeHypeSensitivityPanel({
 comparison,
}:{comparison:NativeHypeSensitivityComparison}){
 return <div className="mb-4 rounded-xl border border-[#34596b] bg-[#0e2739] p-4">
   <h3 className="text-[13px] font-bold text-cyan-100">HYPE TRENDと未採用対照 — 同一年の研究BT比較</h3>
   <p className="mt-2 text-[11px] leading-5 text-[#9bb4c6]">
     研究INDEXに記載されたモデル集計のみを比較。BTC確定足は各8,928本、
     Model Gross上限は共通のTotal 3.5x／Crypto 3.0x／Stock 1.5xです。
     Entry候補・資金予約・出口が異なるため、HYPE単独の因果寄与ではありません。
   </p>
   <div className="mt-3 overflow-x-auto">
     <table className="min-w-[560px] w-full text-left text-[11px]">
       <thead><tr className="border-b border-[#33536b] text-[#9cb6c7]">
         <th className="px-2 py-2">モデル費用</th>
         <th className="px-2 py-2">HYPE TREND 最大DD</th>
         <th className="px-2 py-2">HYPEなし最大DD</th>
         <th className="px-2 py-2">モデルDD差</th>
         <th className="px-2 py-2">勝率・あり／なし</th>
       </tr></thead>
       <tbody>{comparison.rows.map(row=><tr key={row.bps} className="border-b border-[#29485f]">
         <td className="px-2 py-2 font-bold text-cyan-100">{row.bps}bps</td>
         <td className="px-2 py-2">{row.native.maxDdPct.toFixed(2)}%</td>
         <td className="px-2 py-2">{row.noHype.maxDdPct.toFixed(2)}%</td>
         <td className="px-2 py-2">{row.ddDifferencePctPoints.toFixed(2)}pt</td>
         <td className="px-2 py-2">{row.native.winRatePct.toFixed(2)}% / {row.noHype.winRatePct.toFixed(2)}%</td>
       </tr>)}</tbody>
     </table>
   </div>
   <p className="mt-3 text-[11px] leading-5 text-amber-200">
     {comparison.bothPathsMaxDdOver20?"両モデルともDD20%目標を達成していません。":""}
     HYPE停止を推奨するものではありません。V4新SHAの経済一致、独立Forward、venue Fillは未認証。
     この表は研究INDEX由来で、ファイル本体のSHA256は「再生」選択時に照合します。
   </p>
 </div>;
}
