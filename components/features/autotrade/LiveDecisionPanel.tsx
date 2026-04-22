"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

type TrendEvaluation = {
  symbol: string;
  eligible: boolean;
  score: number;
  reasons: string[];
  close: number;
  sma40: number;
  mom20: number;
  adx14: number;
  overheatPct: number;
  volumeRatio: number;
  efficiencyRatio: number;
};

type LiveDecisionResponse = {
  ok: boolean;
  details?: {
    decision: {
      isoTime: string;
      desiredSymbol: string;
      desiredSide: "trend" | "range" | "cash";
      desiredAlloc: number;
      reason: string;
      regime: {
        regimeLabel: string;
        trendAllowed: boolean;
        rangeAllowed: boolean;
        breadth40: number;
        bestMom20: number;
        bestMomAccel: number;
      };
      trendCandidate: {
        symbol: string;
        score: number;
        eligible: boolean;
        reasons: string[];
      } | null;
      rangeCandidate: {
        symbol: string;
        score: number;
        eligible: boolean;
        reasons: string[];
        subVariant?: string;
      } | null;
    };
    trendEvaluations: TrendEvaluation[];
  };
  walletDecision?: {
    currentSymbol: string;
    desiredSymbol: string;
    desiredSide: "trend" | "range" | "cash";
    desiredAlloc: number;
    reason: string;
    rotation: {
      fromSymbol: string;
      toSymbol: string;
      scoreGap: number;
    } | null;
  } | null;
  error?: string;
};

function percent(value: number, digits = 2) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

function fixed(value: number, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function sideLabel(side: "trend" | "range" | "cash") {
  if (side === "trend") return "Trend";
  if (side === "range") return "Range";
  return "Cash";
}

function regimeLabel(label?: string) {
  if (label === "trend_strong") return "強い上昇トレンド";
  if (label === "trend_weak") return "弱い上昇トレンド";
  if (label === "range_only") return "レンジ中心";
  if (label === "ambiguous") return "方向感が弱い";
  return label || "-";
}

function reasonLabel(reason: string) {
  switch (reason) {
    case "close>sma40":
      return "終値がSMA40を上回っています。";
    case "close<=sma40":
      return "終値がSMA40を下回っています。";
    case "mom20-ok":
      return "20本モメンタムがプラスです。";
    case "mom20-low":
      return "20本モメンタムが弱いです。";
    case "sol-ok":
      return "SOLの追加条件を満たしています。";
    case "sol-overheat":
      return "SOLは過熱気味です。";
    case "avax-mom-ok":
      return "AVAXのモメンタム条件を満たしています。";
    case "avax-mom-low":
      return "AVAXのモメンタムが弱いです。";
    case "avax-vol-ok":
      return "AVAXの出来高条件を満たしています。";
    case "avax-vol-low":
      return "AVAXの出来高が不足しています。";
    case "structure-break":
      return "高値更新の流れがあります。";
    case "structure-flat":
      return "高値更新の勢いが弱いです。";
    case "volume-ok":
      return "出来高の裏付けがあります。";
    case "volume-low":
      return "出来高が不足しています。";
    case "accel-ok":
      return "上昇加速が維持されています。";
    case "accel-low":
      return "上昇加速が弱まっています。";
    case "eff-ok":
      return "値動きの効率が良好です。";
    case "eff-low":
      return "値動きの効率が弱いです。";
    case "retq22-pass":
      return "RETQ22の強気条件を満たしています。";
    case "retq22-block":
      return "RETQ22の条件に届いていません。";
    case "retq22-off":
      return "この銘柄ではRETQ22追加条件を使っていません。";
    case "trend-gate-off":
      return "BTC全体条件がトレンド許可になっていません。";
    case "priority-pick":
      return "優先ルールにより採用しています。";
    case "idle-extra":
      return "通常候補が弱い待機局面のため、追加候補として評価しています。";
    case "reserve-wait":
      return "条件未達のためUSDT待機です。";
    default:
      return reason;
  }
}

function decisionReasonLabel(reason: string) {
  if (reason === "reserve-wait") {
    return "条件が揃っていないため、USDTのまま待機します。";
  }

  if (reason.startsWith("trend:")) {
    const parts = reason.replace("trend:", "").split("|").filter(Boolean).map(reasonLabel);
    return `トレンド条件を満たしたため採用します。${parts.join(" ")}`;
  }

  if (reason.startsWith("range:")) {
    const parts = reason.replace("range:", "").split("|").filter(Boolean).map(reasonLabel);
    return `レンジ条件を使う局面です。${parts.join(" ")}`;
  }

  return reason;
}

function uniqueRows(rows: TrendEvaluation[], compact: boolean) {
  const ordered = [...rows].sort((left, right) => {
    if (left.symbol === "PENGU") return -1;
    if (right.symbol === "PENGU") return 1;
    return Number(right.eligible) - Number(left.eligible) || right.score - left.score;
  });
  return compact ? ordered.slice(0, 5) : ordered;
}

export function LiveDecisionPanel({ compact = false }: { compact?: boolean }) {
  const [response, setResponse] = useState<LiveDecisionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/system/auto-trade/live-decision", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as LiveDecisionResponse | null;
        if (cancelled) return;

        if (json?.ok && json.details) {
          setResponse(json);
          setError(null);
        } else {
          setError(json?.error || "12H判定データを取得できませんでした。");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "12H判定データを取得できませんでした。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(load, 60000);
    window.addEventListener("auto-trade-live-decision-refresh", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("auto-trade-live-decision-refresh", load);
    };
  }, []);

  const data = response?.details || null;
  const walletDecision = response?.walletDecision || null;
  const rows = useMemo(() => uniqueRows(data?.trendEvaluations || [], compact), [compact, data?.trendEvaluations]);
  const selectedScore = data?.decision.trendCandidate?.score ?? data?.decision.rangeCandidate?.score ?? null;
  const penguRow = rows.find((row) => row.symbol === "PENGU");
  const rotation = walletDecision?.rotation || null;

  return (
    <section className="panel-gold rounded-[28px] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <TrendingUp className="h-4 w-4 text-gold-100" />
          12H自動トレード判定
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-gold-100/70">
          <RefreshCw className="h-3.5 w-3.5" />
          live
        </div>
      </div>

      {loading ? (
        <div className="mt-3 rounded-[18px] border border-dashed border-white/10 px-4 py-6 text-sm text-white/70">
          現在の12H判定を読み込んでいます。
        </div>
      ) : error ? (
        <div className="mt-3 rounded-[18px] border border-loss/30 bg-loss/10 px-4 py-6 text-sm text-loss">
          {error}
        </div>
      ) : data ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-gold-100/70">現在の採用内容</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="text-2xl font-black text-white">
                  {data.decision.desiredSymbol} / {sideLabel(data.decision.desiredSide)}
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em]",
                    data.decision.desiredSide === "cash"
                      ? "border border-white/12 bg-white/[0.03] text-white/70"
                      : "border border-profit/35 bg-profit/10 text-profit",
                  )}
                >
                  配分 {Math.round(data.decision.desiredAlloc * 100)}%
                </span>
                {selectedScore != null ? (
                  <span className="rounded-full border border-gold-400/25 bg-gold-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-gold-100">
                    score {fixed(selectedScore)}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-[12px] leading-6 text-white/82">
                {decisionReasonLabel(data.decision.reason)}
              </div>
              {rotation ? (
                <div className="mt-3 rounded-[16px] border border-profit/30 bg-profit/10 px-3 py-3 text-[11px] leading-5 text-white/85">
                  <div className="font-bold text-profit">ローテーション予定</div>
                  <div className="mt-1">
                    {rotation.fromSymbol} の勢いが鈍り、{rotation.toSymbol} のScoreが {fixed(rotation.scoreGap)} 点上回っているため、
                    次回実行では {rotation.fromSymbol} を全額決済して {rotation.toSymbol} へ切り替えます。
                  </div>
                </div>
              ) : null}
              <div className="mt-3 rounded-[16px] border border-gold-400/15 bg-black/20 px-3 py-3 text-[11px] leading-5 text-white/76">
                PENGUは通常時の主力ではなく、待機中または保有中通貨の勢いが鈍った時だけ比較対象に入ります。
              </div>
              {walletDecision ? (
                <div className="mt-2 text-[11px] text-white/60">
                  現在保有 {walletDecision.currentSymbol} / 実行予定 {walletDecision.desiredSymbol}
                </div>
              ) : null}
              <div className="mt-2 text-[11px] text-white/60">
                判定更新 {new Date(data.decision.isoTime).toLocaleString("ja-JP")}
              </div>
            </div>

            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-gold-100/70">相場の見立て</div>
              <div className="mt-2 grid gap-2 text-sm text-white/84 md:grid-cols-2">
                <div>レジーム: {regimeLabel(data.decision.regime.regimeLabel)}</div>
                <div>トレンド条件: {data.decision.regime.trendAllowed ? "有効" : "無効"}</div>
                <div>レンジ条件: {data.decision.regime.rangeAllowed ? "有効" : "無効"}</div>
                <div>breadth40: {data.decision.regime.breadth40}</div>
                <div>最良 mom20: {percent(data.decision.regime.bestMom20)}</div>
                <div>最良 accel: {percent(data.decision.regime.bestMomAccel)}</div>
              </div>
              {penguRow ? (
                <div className="mt-3 rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-5 text-white/76">
                  PENGU score {fixed(penguRow.score)}。{penguRow.eligible ? "条件を満たしています。" : "現時点では条件未達です。"}
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-gold-100/80">
              候補通貨の比較
            </div>
            {rows.map((row) => (
              <div
                key={row.symbol}
                className="grid gap-3 rounded-[18px] border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white/82 xl:grid-cols-[1fr_1fr_0.85fr]"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-lg font-black text-white">{row.symbol}/USDT</div>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                        row.eligible
                          ? "border-profit/40 bg-profit/10 text-profit"
                          : "border-white/15 bg-white/[0.03] text-white/60",
                      )}
                    >
                      {row.eligible ? "採用候補" : "見送り"}
                    </span>
                    {row.symbol === "PENGU" ? (
                      <span className="rounded-full border border-gold-400/25 bg-gold-400/10 px-2 py-0.5 text-[10px] font-bold text-gold-100">
                        追加候補
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-white/74">
                    <div>score {fixed(row.score)}</div>
                    <div>終値 {fixed(row.close, 4)}</div>
                    <div>SMA40 {fixed(row.sma40, 4)}</div>
                    <div>mom20 {percent(row.mom20)}</div>
                    <div>ADX14 {fixed(row.adx14)}</div>
                    <div>過熱率 {percent(row.overheatPct)}</div>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-bold text-gold-100/80">判定理由</div>
                  <div className="mt-2 space-y-1 text-[11px] leading-5 text-white/76">
                    {row.reasons.map((reason) => (
                      <div key={`${row.symbol}-${reason}`}>・{reasonLabel(reason)}</div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2 text-[11px] text-white/74">
                  <div className="rounded-[12px] border border-white/8 bg-black/20 px-3 py-2">
                    出来高比率 {fixed(row.volumeRatio)}
                  </div>
                  <div className="rounded-[12px] border border-white/8 bg-black/20 px-3 py-2">
                    効率比率 {fixed(row.efficiencyRatio)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
