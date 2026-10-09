"use client";

import type { V12V4ShadowObservability } from "@/lib/server/v12-v4-shadow-observability";
export type { V12V4ShadowObservability } from "@/lib/server/v12-v4-shadow-observability";

const pct = (v?: number) => v === undefined || !Number.isFinite(v) ? "—" : (v * 100).toFixed(2) + "%";
const gross = (v?: number) => v === undefined || !Number.isFinite(v) ? "未確認" : v.toFixed(3) + "x";
const number = (v?: number) => v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(3);
const timestamp = (v?: string | number) => {
  if (v === undefined) return "未確認";
  const ts = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(ts) ? new Date(ts).toLocaleString("ja-JP") : "未確認";
};
const box = "rounded-xl border border-white/10 bg-black/20 p-3";
const cell = "px-3 py-2";

export function V12V4ShadowPanel({ details }: { details?: V12V4ShadowObservability }) {
  if (!details) return null;
  const runtime = details.runtimeObservation;
  const catalog = [...details.routeCatalog].sort((a, b) => (a.midpointRank ?? 99) - (b.midpointRank ?? 99));
  const ranks = new Map(catalog.map(route => [route.route, route]));
  const rows = [...details.accepted, ...details.rejected];
  const displayRows = rows.length ? rows : details.candidates;
  const simulatedGross = details.accepted.reduce((sum, row) => sum + (row.postMinLiftGross ?? row.requestedGross), 0);
  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-white">V12 V4 / V2_M150_D05_CORE_NATIVE</h3>
          <p className="mt-1 text-xs leading-5 text-white/60">41ルート研究設定・Shadow判定と、現在の既存LIVE観測を分離して表示します。</p>
        </div>
        <span className="rounded-full border border-amber-400/35 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-100">BLOCKED_PRODUCTION_PARITY / V4発注権限なし</span>
      </div>

      <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
        <b className="text-sm text-amber-100">研究認証：未認証・Production昇格停止</b>
        <p className="mt-2 text-xs leading-5 text-amber-50/85">凍結した年間全期間の事後実績順位（学習終了 2026-08-10）です。因果的な外部期間実証ではありません。Y06外部期間は102件・PF約0.30、10bps最大DD20.42%は目標20%を超過。8システムの現在LIVEとのイベント別再現性、実注文・数量・予約Gross・Exit所有権は未証明です。</p>
        <p className="mt-2 text-xs text-amber-100">orderEnabled=false / tradingMutation=0 / realOrderEnabledV4=0 / certificateVerified=false</p>
        <p className="mt-2 text-xs text-white/60">Shadow JSONや既存V12のenableフラグは、V4の実発注権限を証明しません。</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {(["10bps", "20bps", "30bps"] as const).map(key => (
            <div key={key} className={box}>
              <div className="text-xs text-white/55">研究BT {key} / 2025-08-10〜2026-08-10</div>
              <div className="mt-1 text-sm font-bold text-white">{details.midpointBt[key].finalEquityJpy.toLocaleString("ja-JP")} 円</div>
              <div className="text-xs text-white/75">最大MTM DD {pct(details.midpointBt[key].dd)}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-5 text-amber-100/85">H1価格モデル・初期入金10,000円一回の研究結果です。この金額はLIVE残高・LIVE損益ではありません。順位ファイル：{details.midpointPriorityAvailable ? "凍結SHA256照合済み" : "未接続／不一致"}</p>
      </div>

      <div className="mt-4 rounded-2xl border border-sky-400/20 bg-sky-500/5 p-4">
        <b className="text-sm text-sky-100">現在の既存LIVE Runtime観測（V4認証とは別）</b>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["V12 heartbeat", runtime?.runnerStatus ?? "UNAVAILABLE"],
            ["更新", timestamp(runtime?.runnerUpdatedAt)],
            ["mode / safety", [runtime?.mode, runtime?.safetyState].filter(Boolean).join(" / ") || "未確認"],
            ["共有Kill Switch", runtime?.killSwitchActive === undefined ? "未確認" : runtime.killSwitchActive ? "ACTIVE / " + (runtime.killSwitchAction ?? "未確認") : "inactive（記録上）"],
          ].map(([label, value]) => <div key={label} className={box}><div className="text-[10px] text-white/45">{label}</div><div className="mt-1 text-xs font-bold text-white">{value}</div></div>)}
        </div>
        <p className="mt-2 break-all text-[11px] text-white/60">Release: {runtime?.releaseSha ?? "未確認"} / 確認時刻 {timestamp(runtime?.checkedAt)}</p>
        {runtime?.killSwitchReason ? <p className="mt-2 text-xs text-amber-100">共有停止の記録理由：{runtime.killSwitchReason}</p> : null}
        <p className="mt-2 text-xs leading-5 text-white/60">OBSERVEDは現在SHAと新鮮なheartbeatの照合です。サービス稼働・約定・V4発注許可の認証ではありません。STALE／UNAVAILABLE時は現状を断定できません。実建玉・約定履歴・実Exitは既存LIVE詳細欄で確認してください。</p>
        {runtime?.error ? <p className="mt-2 break-all text-[11px] text-amber-100">観測未接続：{runtime.error}</p> : null}
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
        <table className="w-full min-w-[650px] text-left text-xs">
          <caption className="px-3 py-2 text-left font-bold text-white">Gross上限：研究の予定値と現在Runtime設定（取引所レバレッジとは別）</caption>
          <thead className="text-white/45"><tr><th className={cell}>対象</th><th className={cell}>V2研究予定</th><th className={cell}>現在Runtime観測</th></tr></thead>
          <tbody>{[
            ["Recovery family", details.midpointCaps.recoveryFamilyGross, undefined],
            ["V12", details.midpointCaps.v12Gross, runtime?.caps?.v12Gross],
            ["Crypto", details.midpointCaps.cryptoGross, runtime?.caps?.cryptoGross],
            ["Total", details.midpointCaps.totalGross, runtime?.caps?.totalGross],
          ].map(([name, planned, observed]) => <tr key={String(name)} className="border-t border-white/5"><td className={cell}>{name}</td><td className={cell}>{gross(planned as number)}</td><td className={cell}>{gross(observed as number | undefined)}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Shadow state", details.stateAvailable ? "新鮮・安全形式を確認" : "未接続／古い／安全形式不一致"],
          ["Shadow更新", timestamp(details.capturedAt)],
          ["独立候補 / 採用 / 拒否", details.counts.independentlyQualifyingCandidates + " / " + details.counts.admittedShadowVirtualLegs + " / " + details.counts.rejectedShadowLegs],
          ["Shadow採用予定Gross合計", details.stateAvailable ? gross(simulatedGross) : "未確認"],
        ].map(([label, value]) => <div key={label} className={box}><div className="text-[10px] text-white/45">{label}</div><div className="mt-1 text-xs font-bold text-white">{value}</div></div>)}
      </div>
      <p className="mt-2 text-xs leading-5 text-white/60">採用・拒否はShadow仮想判定です。予定Gross合計は実資金使用・実建玉Grossではありません。実資金使用のV4所有者照合は未認証です。</p>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
        <table className="w-full min-w-[1000px] text-left text-xs">
          <caption className="px-3 py-2 text-left font-bold text-white">Shadow候補・採用／拒否・予定Exit（{displayRows.length}行）</caption>
          <thead className="text-white/45"><tr>{["Symbol", "Route", "研究Rank / Score", "Side", "予定Gross", "判定 / 理由", "予定Exit"].map(x => <th key={x} className={cell}>{x}</th>)}</tr></thead>
          <tbody>{displayRows.map((row, index) => <tr key={(row.virtualLegId ?? row.route) + index} className="border-t border-white/5 align-top"><td className={cell}>{row.symbol}</td><td className={cell}>{row.route}</td><td className={cell}>{ranks.get(row.route)?.midpointRank ?? "—"} / {number(ranks.get(row.route)?.midpointScore)}</td><td className={cell}>{row.sourceSide} → {row.effectiveSide}</td><td className={cell}>{gross(row.postMinLiftGross ?? row.requestedGross)}</td><td className={cell}>{row.decision} / {row.reason}</td><td className={cell}>{row.plannedExitPolicy || "未記録"}</td></tr>)}</tbody>
        </table>
        {!displayRows.length ? <p className="px-3 py-3 text-xs text-amber-100">現在の安全で新鮮なShadow判定は未取得です。実候補・採用・拒否・Exit履歴を推測しません。</p> : null}
      </div>

      <details className="mt-4 rounded-2xl border border-white/10 bg-black/20">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-white">41ルート凍結研究順位・Score・予定Gross・Entry／Exit契約</summary>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px] text-left text-[11px]">
            <thead className="text-white/45"><tr>{["Rank", "Route / Family", "事後Score / Tier / n30", "予定Gross", "Entry", "Side / Delay", "予定Exit / Preemption", "10bps", "20bps", "30bps"].map(x => <th key={x} className={cell}>{x}</th>)}</tr></thead>
            <tbody>{catalog.map(route => <tr key={route.route} className="border-t border-white/5 align-top"><td className={cell}>{route.midpointRank ?? "—"}</td><td className={cell}>{route.route} / {route.family}</td><td className={cell}>{number(route.midpointScore)} / {route.midpointTier ?? "—"} / {route.midpointTrainCount ?? "—"}</td><td className={cell}>{route.midpointRank === undefined ? "未確認" : route.midpointGross === undefined ? "Core native（動的）" : gross(route.midpointGross)}</td><td className={cell}>{route.entryRule}</td><td className={cell}>{route.sideTransform} / +{route.entryDelayHours}h</td><td className={cell}>{route.exitPolicy} / {route.preemptionPolicy}</td>{["10bps", "20bps", "30bps"].map(key => <td key={key} className={cell}>{route.metrics[key]?.trades ?? "—"} / {pct(route.metrics[key]?.winRate)} / PF {number(route.metrics[key]?.pf)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
      <p className="mt-2 text-[11px] leading-5 text-white/50">予定Exitは契約記述であり実Exit実行／実Exit履歴ではありません。凍結ルート単体台帳とV2統合BTは集計条件が異なります。</p>
      {details.errors.length ? <div className="mt-3 break-all rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">Shadow観測：{details.errors.join(" / ")}</div> : null}
    </section>
  );
}
