import {verifySavedSevenFamilySourceEvidence}
 from "@/lib/bt-verification/source-observation-evidence";

export function SevenFamilyObservationEvidencePanel(){
 const e=verifySavedSevenFamilySourceEvidence();
 return (
  <section
    aria-label="BT-481-H2の保存済み7系統判定証拠"
    data-testid="bt481-seven-family-source-evidence"
    className="rounded-lg border border-[#365875] bg-[#0b283d] p-3 text-[11px] leading-5 text-[#adc7d8]"
  >
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="font-bold text-cyan-200">7系統の共通判定観測台帳（保存済み・読取専用）</p>
        <p>BTC等33銘柄の人工価格を使った元判定・研究判定の時点別記録。対象は2025年10月1日〜10月23日（終了時刻を含まない）です。</p>
      </div>
      <span className="rounded-md border border-[#497086] px-2 py-1 text-[#b9dae9]">
        BT-481-H2 / 人工市場 v4
      </span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div>
        <p className="text-[#819cb2]">判定観測</p>
        <p className="text-base font-bold text-white">{e.total.toLocaleString("ja-JP")}件</p>
      </div>
      <div>
        <p className="text-[#819cb2]">入口候補（未約定）</p>
        <p className="text-base font-bold text-cyan-200">{e.candidates.toLocaleString("ja-JP")}件</p>
      </div>
      <div>
        <p className="text-[#819cb2]">正式エントリー確認</p>
        <p className="text-base font-bold text-amber-200">{e.entryVerified}件</p>
      </div>
      <div>
        <p className="text-[#819cb2]">実行済み注文・約定</p>
        <p className="text-base font-bold text-amber-200">{e.orders}／{e.fills}件</p>
      </div>
    </div>
    <p className="mt-3 text-amber-200">
      **これは保存済みの固定人工相場（rotation、seed {e.seed}）の証拠です。**
      選択中のデモチャート・本番LIVE・STABLE4統合損益ではありません。54件の入口候補は約定ではありません。
    </p>
    <details className="mt-3" data-testid="bt481-seven-family-detail">
      <summary className="cursor-pointer font-semibold text-cyan-200">
        元ロジック系統別の観測件数・SHA証拠
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[290px] text-left">
          <thead>
            <tr className="border-b border-[#355471] text-[#a1b8cb]">
              <th className="py-1">系統</th><th className="py-1">観測件数</th>
            </tr>
          </thead>
          <tbody>
            {e.familyCounts.map(x=>(
              <tr key={x.family} className="border-b border-[#29445d]">
                <td className="py-1">{x.family}</td>
                <td className="py-1 tabular-nums">{x.observations.toLocaleString("ja-JP")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2">特徴量のみ：{e.featureOnly.toLocaleString("ja-JP")}件 ／ 候補：{e.candidates}件 ／ エントリー検証済み：{e.entryVerified}件</p>
      <p className="mt-1 break-all">台帳SHA256：{e.sourceLedgerSha256}</p>
      <p className="mt-1 break-all">圧縮アーカイブSHA256：{e.archiveSha256}</p>
      <p className="mt-2 text-amber-200">{e.note}</p>
    </details>
  </section>
 );
}
