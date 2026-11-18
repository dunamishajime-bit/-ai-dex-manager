import type {Stable4Pair} from "@/lib/bt-verification/stable4-baseline-comparison";
const yen=(n:number)=>Math.round(n).toLocaleString("ja-JP")+"円";
const pct=(n:number)=>n.toFixed(2)+"%";
export function Stable4BaselineComparisonPanel({pairs}:{pairs:Stable4Pair[]}){
 return <section aria-label="3層STABLE4研究上限比較" className="mb-4 rounded-xl border border-[#3c6178] bg-[#10283c] p-4">
  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
   <h3 className="text-sm font-bold text-cyan-100">3層STABLE4＋H48：研究上限と本番Gross上限の比較</h3>
   <span className="text-[10px] font-semibold text-amber-200">研究BTのみ・LIVE一致未認証</span>
  </div>
  <p className="mb-3 text-[11px] leading-5 text-[#a4bcd0]">同じ初期資金1万円・研究期間の保存台帳。SHA付き研究INDEXの元データから表示。売買ルート・資金競合も変わり得るため、差額をGross上限だけの因果効果と断定しません。</p>
  <div className="overflow-x-auto">
   <table className="min-w-[620px] w-full text-left text-[11px]">
    <thead><tr className="border-b border-[#3a566e] text-[#9eb7ca]">
     <th className="px-2 py-2">費用</th><th className="px-2 py-2">研究ケース</th><th className="px-2 py-2 text-right">最終資金</th><th className="px-2 py-2 text-right">最大DD</th><th className="px-2 py-2 text-right">モデル約定</th><th className="px-2 py-2">Gross上限</th>
    </tr></thead>
    <tbody>{pairs.flatMap(row=>[
     <tr key={"r"+row.costBps} className="border-b border-[#2c475b] text-cyan-100">
      <td className="px-2 py-2">{row.costBps}bps</td><td className="px-2 py-2">3層STABLE4＋H48 研究上限</td><td className="px-2 py-2 text-right">{yen(row.research.finalEquityJpy)}</td>
      <td className="px-2 py-2 text-right">{pct(row.research.maxDdPct)}</td><td className="px-2 py-2 text-right">{row.research.modeledFills}</td><td className="px-2 py-2">総4.25x / 株4.0x</td>
     </tr>,
     <tr key={"c"+row.costBps} className="border-b border-[#2c475b] text-[#d7e6f3]">
      <td className="px-2 py-2">{row.costBps}bps</td><td className="px-2 py-2">本番Gross上限で研究再計算</td><td className="px-2 py-2 text-right">{yen(row.capped.finalEquityJpy)}</td>
      <td className="px-2 py-2 text-right">{pct(row.capped.maxDdPct)}</td><td className="px-2 py-2 text-right">{row.capped.modeledFills}</td><td className="px-2 py-2">総3.5x / 株1.5x</td>
     </tr>
    ])}</tbody>
   </table>
  </div>
  <p className="mt-3 text-[11px] leading-5 text-amber-200">暗号資産は両ケース3.0x。現在のLIVE Runner、Source pin、実約定、保護STOPを認証した結果ではありません。研究モードと模擬市場モードを混同しないでください。</p>
 </section>;
}
