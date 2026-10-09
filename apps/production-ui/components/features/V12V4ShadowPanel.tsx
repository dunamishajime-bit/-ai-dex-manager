"use client";

export type V12V4ShadowObservability = {
  ok: true;
  readOnly: true;
  tradingMutation: 0;
  architecture: "MULTILOGIC_V4";
  shadow: true;
  orderEnabled: false;
  capturedAt?: string;
  observedPolicyId?: string;
  midpointPriorityAvailable: boolean;
  midpointPromotionStatus: "BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06";
  midpointBt: Record<"10bps" | "20bps" | "30bps", { finalEquityJpy: number; dd: number }>;
  midpointCaps: { recoveryFamilyGross: number; v12Gross: number; cryptoGross: number; totalGross: number };
  stateAvailable: boolean;
  statePath: string;
  catalogAvailable: boolean;
  catalogPath: string;
  routeCount: number;
  caps: {
    recoveryRouteSlots: number;
    recoveryFamilyGross: number;
    normalRecoveryGross: number;
    robustMaxGross: number;
    minLiftMaxGross: number;
    v12Gross: number;
    cryptoGross: number;
    totalGross: number;
  };
  counts: {
    rawRouteSymbolEvaluations: number;
    independentlyQualifyingCandidates: number;
    admittedShadowVirtualLegs: number;
    rejectedShadowLegs: number;
    uniqueAdmittedSymbols: number;
    realOrderEnabledV4: 0;
  };
  candidates: V12V4ShadowRow[];
  accepted: V12V4ShadowRow[];
  rejected: V12V4ShadowRow[];
  aggregateBt: Record<string, { trades?: number; winRate?: number; pf?: number; netPnlUsd?: number; finalEquityJpy?: number; dd?: number }>;
  routeCatalog: Array<{
    route: string;
    family: string;
    entryRule: string;
    sideTransform: string;
    entryDelayHours: number;
    exitPolicy: string;
    grossPolicy: string;
    preemptionPolicy: string;
    midpointTier?: string;
    midpointRank?: number;
    midpointGross?: number;
    midpointTrainCount?: number;
    metrics: Record<string, { trades: number; winRate: number; pf?: number; netPnlUsd: number }>;
  }>;
  errors: string[];
};

type V12V4ShadowRow = {
  route: string;
  family: string;
  symbol: string;
  sourceSide: string;
  effectiveSide: string;
  rank: number;
  requestedGross: number;
  postMinLiftGross?: number;
  decision: string;
  reason: string;
  plannedExitPolicy: string;
  entryDelayHours: number;
  entryRuleTokens: string[];
  features: Record<string, unknown>;
  virtualLegId?: string;
  preemptedVirtualLegIds?: string[];
  orderEnabled: false;
  shadow: true;
};

function pct(value?: number) {
  return value === undefined || !Number.isFinite(value) ? "—" : (value * 100).toFixed(2) + "%";
}
function pf(value?: number) {
  return value === undefined || !Number.isFinite(value) ? "∞" : value.toFixed(3);
}
function gross(value?: number) {
  return value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(3) + "x";
}
function time(value?: string) {
  if (!value) return "未取得";
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toLocaleString("ja-JP") : value;
}
function feature(row: V12V4ShadowRow, key: string) {
  const v = row.features?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(4) : v === undefined ? "—" : String(v);
}

export function V12V4ShadowPanel({ details }: { details?: V12V4ShadowObservability }) {
  if (!details) return null;
  const scenarios = [
    ["10bps", details.aggregateBt.PRICE_MODEL_10BPS],
    ["20bps", details.aggregateBt.PRICE_MODEL_20BPS],
    ["30bps", details.aggregateBt.PRICE_MODEL_30BPS],
  ] as const;
  const rows = details.accepted.length ? details.accepted : details.candidates;

  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-black text-white">V12 Multi-Logic V4 Shadow</div>
          <p className="mt-1 text-xs leading-5 text-white/60">41ルート / Virtual Leg / Min-Lift / REC_Y反転プリエンプト。既存LIVE V12とは分離した非発注評価です。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-sky-400/35 bg-sky-500/10 px-3 py-1 text-xs font-bold text-sky-100">SHADOW / 注文無効</span>
          <span className="rounded-full border border-emerald-400/35 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-100">orderEnabled=false</span>
          <span className="rounded-full border border-emerald-400/35 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-100">tradingMutation=0</span>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b className="text-sm text-amber-100">V12高収益研究案：V2_M150_D05_CORE_NATIVE</b>
          <span className="rounded-full border border-amber-300/35 px-3 py-1 text-xs font-bold text-amber-100">
            先読み順位・未承認／注文無効
          </span>
        </div>
        <p className="mt-2 text-xs leading-5 text-amber-50/85">
          年間全期間の事後実績で順位を決めた研究案（先読みバイアスあり）。2段階Entry/Exit修正を含みます。
          回復枠 {gross(details.midpointCaps.recoveryFamilyGross)} /
          V12 {gross(details.midpointCaps.v12Gross)} /
          Crypto {gross(details.midpointCaps.cryptoGross)} /
          Total {gross(details.midpointCaps.totalGross)}。
          {details.observedPolicyId
            ? " Shadow stateからV2研究設定を観測しました（実注文は無効）。"
            : " 現在のShadow stateでV2研究設定の稼働は未確認です。"}
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(["10bps","20bps","30bps"] as const).map((key) => (
            <div key={key} className="rounded-xl border border-amber-300/15 bg-black/25 px-3 py-2 text-xs text-white/85">
              <div className="text-white/55">研究BT {key}（2025/08–2026/08）</div>
              <div className="mt-1 font-bold">{details.midpointBt[key]?.finalEquityJpy.toLocaleString("ja-JP")} 円</div>
              <div>最大DD {pct(details.midpointBt[key]?.dd)}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-5 text-amber-100/85">
          10bps DD -20.42%／20bps DD -20.97%（目標20%超過）。2026/08–10外部期間Y06は102件・勝率37.25%・PF0.30。
          H1価格モデルの研究結果であり、実注文再現性は未認証です。
          {details.midpointPriorityAvailable ? " 41ルート事後順位ファイル：確認済み。" : " 41ルート事後順位ファイル：未接続。"}
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {[
          ["State", details.stateAvailable ? "取得済み" : "未接続"],
          ["Route", String(details.routeCount)],
          ["候補", String(details.counts.independentlyQualifyingCandidates)],
          ["Shadow Leg", String(details.counts.admittedShadowVirtualLegs)],
          ["Reject", String(details.counts.rejectedShadowLegs)],
          ["Symbols", String(details.counts.uniqueAdmittedSymbols)],
          ["実注文V4", String(details.counts.realOrderEnabledV4)],
          ["更新", time(details.capturedAt)],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div><div className="mt-1 break-words text-sm font-bold text-white">{value}</div></div>)}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/75">Recovery slot <b className="text-white">{details.caps.recoveryRouteSlots}</b> / family <b className="text-white">{gross(details.caps.recoveryFamilyGross)}</b></div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/75">Normal <b className="text-white">{gross(details.caps.normalRecoveryGross)}</b> / Robust <b className="text-white">{gross(details.caps.robustMaxGross)}</b></div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/75">Min-Lift max <b className="text-white">{gross(details.caps.minLiftMaxGross)}</b> / V12 <b className="text-white">{gross(details.caps.v12Gross)}</b></div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/75">Crypto <b className="text-white">{gross(details.caps.cryptoGross)}</b> / Total <b className="text-white">{gross(details.caps.totalGross)}</b></div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
        <div className="border-b border-white/10 px-3 py-2 text-sm font-bold text-white">従来V4正式BT台帳（Final1000 + G5 48h）— 中間配分案の結果ではありません</div>
        <table className="min-w-[760px] w-full text-left text-xs">
          <thead className="text-white/45"><tr><th className="px-3 py-2">Cost</th><th className="px-3 py-2">V12件数</th><th className="px-3 py-2">勝率</th><th className="px-3 py-2">PF</th><th className="px-3 py-2">V12 Net USD</th><th className="px-3 py-2">全体最終JPY</th><th className="px-3 py-2">DD</th></tr></thead>
          <tbody>{scenarios.map(([label, row]) => <tr key={label} className="border-t border-white/5"><td className="px-3 py-2 font-bold text-white">{label}</td><td className="px-3 py-2">{row?.trades ?? "—"}</td><td className="px-3 py-2">{pct(row?.winRate)}</td><td className="px-3 py-2">{pf(row?.pf)}</td><td className="px-3 py-2">{row?.netPnlUsd?.toFixed(2) ?? "—"}</td><td className="px-3 py-2">{row?.finalEquityJpy?.toLocaleString("ja-JP", { maximumFractionDigits: 0 }) ?? "—"}</td><td className="px-3 py-2">{pct(row?.dd)}</td></tr>)}</tbody>
        </table>
      </div>

      {details.stateAvailable ? (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
          <div className="border-b border-white/10 px-3 py-2"><div className="text-sm font-bold text-white">現在のV4 Shadow判定</div><div className="mt-1 text-[11px] text-white/50">同一通貨でも独立ルートを別行表示。実注文には接続しません。</div></div>
          <table className="min-w-[1500px] w-full text-left text-[11px]">
            <thead className="text-white/45"><tr><th className="px-2 py-2">通貨</th><th className="px-2 py-2">Route</th><th className="px-2 py-2">Side</th><th className="px-2 py-2">Gross</th><th className="px-2 py-2">age</th><th className="px-2 py-2">ret6</th><th className="px-2 py-2">EMA/ATR</th><th className="px-2 py-2">BTC6/24</th><th className="px-2 py-2">Rel12/24</th><th className="px-2 py-2">Vol</th><th className="px-2 py-2">ER24</th><th className="px-2 py-2">Exit</th><th className="px-2 py-2">判定理由</th></tr></thead>
            <tbody>{rows.slice(0, 120).map((row, index) => <tr key={(row.virtualLegId || row.route) + index} className="border-t border-white/5"><td className="px-2 py-2 font-bold text-white">{row.symbol}</td><td className="px-2 py-2 text-gold-100">{row.route}</td><td className="px-2 py-2">{row.sourceSide} → {row.effectiveSide}</td><td className="px-2 py-2">{gross(row.postMinLiftGross ?? row.requestedGross)}</td><td className="px-2 py-2">{feature(row, "age")}</td><td className="px-2 py-2">{feature(row, "sret6")}</td><td className="px-2 py-2">{feature(row, "ema12Dist")}</td><td className="px-2 py-2">{feature(row, "btc6")} / {feature(row, "btc24")}</td><td className="px-2 py-2">{feature(row, "rel12")} / {feature(row, "rel24")}</td><td className="px-2 py-2">{feature(row, "volRatio")}</td><td className="px-2 py-2">{feature(row, "er24")}</td><td className="px-2 py-2">{row.plannedExitPolicy}</td><td className="px-2 py-2">{row.reason}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">V4 Shadow stateは未接続です。台帳・41ルート契約は読み込み済みですが、現在時点のShadow判定はまだ生成されていません。実注文V4は0件のままです。</div>
      )}

      <details className="mt-4 rounded-2xl border border-white/10 bg-black/20">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-white">41ルート詳細・10/20/30bps実績を表示</summary>
        <div className="overflow-x-auto border-t border-white/10">
          <table className="min-w-[1500px] w-full text-left text-[11px]">
            <thead className="text-white/45"><tr><th className="px-2 py-2">Route</th><th className="px-2 py-2">Family</th><th className="px-2 py-2">Entry</th><th className="px-2 py-2">Side/Delay</th><th className="px-2 py-2">Exit</th><th className="px-2 py-2">旧Gross</th><th className="px-2 py-2">中間順位 / Tier / Gross / 学習n</th><th className="px-2 py-2">10bps</th><th className="px-2 py-2">20bps</th><th className="px-2 py-2">30bps</th></tr></thead>
            <tbody>{details.routeCatalog.map((route) => <tr key={route.route} className="border-t border-white/5 align-top"><td className="px-2 py-2 font-bold text-gold-100">{route.route}</td><td className="px-2 py-2">{route.family}</td><td className="max-w-[420px] px-2 py-2 leading-5">{route.entryRule}</td><td className="px-2 py-2">{route.sideTransform} / +{route.entryDelayHours}h</td><td className="px-2 py-2">{route.exitPolicy}</td><td className="px-2 py-2">{route.grossPolicy}</td><td className="px-2 py-2">{
              route.midpointRank === undefined
                ? "—"
                : [route.midpointRank, route.midpointTier, route.midpointGross === undefined ? "Core native" : gross(route.midpointGross), "n="+route.midpointTrainCount].join(" / ")
            }</td>{["10bps","20bps","30bps"].map((key) => { const m = route.metrics[key]; return <td key={key} className="px-2 py-2">{m?.trades ?? 0} / {pct(m?.winRate)} / PF {pf(m?.pf)}</td>; })}</tr>)}</tbody>
          </table>
        </div>
      </details>

      {details.errors.length ? <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">Shadow観測: {details.errors.join(" / ")}</div> : null}
    </section>
  );
}
