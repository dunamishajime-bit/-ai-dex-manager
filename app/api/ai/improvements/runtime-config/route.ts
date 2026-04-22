import { NextResponse } from "next/server";
import { selectStrategyPreset, getStrategyModeFromEnv } from "@/config/strategyMode";
import {
  AI_IMPROVEMENTS_APPLIED_KEY,
  AI_IMPROVEMENTS_LATEST_AUDIT_KEY,
  AI_IMPROVEMENTS_PENDING_KEY,
  AI_IMPROVEMENTS_RUNTIME_CONFIG_KEY,
  buildSafeConfigSnapshot,
  type AppliedImprovementEntry,
  type PendingImprovementEntry,
  type RuntimeStrategyConfigOverrides,
  type StoredStrategyAudit,
} from "@/lib/ai-improvements";
import { kvGet, kvSet } from "@/lib/kv";

export const dynamic = "force-dynamic";

const STRATEGY_MODE_STORAGE_KEY = "jdex_strategy_mode";

function buildCurrentAssessment(
  strategyMode: string,
  latestCount: { applied: number; pending: number },
) {
  return {
    summary: `現在の運用設定 ${strategyMode} は reclaim_plus_avax_sol_aux_alloc040_relaxed_baseline を本番採用しています。`,
    priority: "medium" as const,
    nextReviewInMinutes: 720,
    observations: [
      { key: "scope", severity: "low" as const, message: "売買対象は BNB Chain の ETH / SOL / AVAX で、BTC は地合い判定専用です。" },
      { key: "reserve", severity: "low" as const, message: "待機資産は USDT、ガス残しは BNB を保持します。" },
      { key: "fallback", severity: "medium" as const, message: "価格参照は CoinGecko → CoinCap → Binance → ローカルキャッシュの順で冗長化しています。" },
    ],
    safeConfigChanges: [],
    manualProposals: [
      {
        title: "本番切替後の少額シャドー運用を継続",
        reason: `改善適用 ${latestCount.applied} 件 / 保留 ${latestCount.pending} 件を踏まえ、ロジック切替後の執行差を監視するためです。`,
        expectedImpact: "バックテストと実売買のズレを早期に検知できます。",
        risk: "low" as const,
        filesLikelyAffected: ["config/reclaimHybridStrategy.ts", "app/api/trade/route.ts", "config/botConfig.ts"],
      },
      {
        title: "月次で価格取得フォールバックの監査を実施",
        reason: "API 制限や一時障害が出ても、価格参照の切替順が維持されているか確認するためです。",
        expectedImpact: "本番停止や異常価格のリスクを下げられます。",
        risk: "low" as const,
        filesLikelyAffected: ["lib/providers/market-providers.ts", "app/api/market/dashboard/route.ts"],
      },
    ],
  };
}

export async function GET() {
  const storedStrategyMode = await kvGet<string>(STRATEGY_MODE_STORAGE_KEY);
  const preset = selectStrategyPreset(storedStrategyMode || getStrategyModeFromEnv());
  const [overrides, latestAudit, applied, pending] = await Promise.all([
    kvGet<RuntimeStrategyConfigOverrides>(AI_IMPROVEMENTS_RUNTIME_CONFIG_KEY),
    kvGet<StoredStrategyAudit>(AI_IMPROVEMENTS_LATEST_AUDIT_KEY),
    kvGet<AppliedImprovementEntry[]>(AI_IMPROVEMENTS_APPLIED_KEY),
    kvGet<PendingImprovementEntry[]>(AI_IMPROVEMENTS_PENDING_KEY),
  ]);

  const latestSummary = String(latestAudit?.result?.summary || "");
  const auditIsFresh = Boolean(latestAudit?.createdAt) && latestAudit!.createdAt > Date.now() - 1000 * 60 * 60 * 24 * 3;
  const latestAssessment = auditIsFresh && latestSummary
    ? latestAudit?.result || null
    : buildCurrentAssessment(preset.mode, { applied: (applied || []).length, pending: (pending || []).length });

  return NextResponse.json({
    ok: true,
    environment: {
      scope: "VPS 本番運用",
      strategyMode: preset.mode,
      strategyId: preset.strategyId,
      engine: preset.engine,
      symbols: preset.symbols,
      cadence: "監視は常時、ロジック判定は reclaim + 補助レンジ構成",
      maxPositions: preset.maxConcurrentPositions,
      feeRate: preset.feeRate,
      targetAlloc: preset.targetAlloc,
      maxTradeSizePct: preset.maxTradeSizePct,
      stableReservePct: preset.stableReservePct,
      hardStopLossPct: preset.hardStopLossPct,
      maxSlippageBps: preset.maxSlippageBps,
      quoteProviders: preset.quoteProviders,
      priceProviders: preset.priceProviders,
    },
    overrides: overrides || {},
    effectiveConfig: buildSafeConfigSnapshot(overrides || {}),
    latestAudit: latestAssessment,
    counts: {
      applied: (applied || []).length,
      pending: (pending || []).length,
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedMode = selectStrategyPreset(body?.strategyMode || body?.strategy_mode || null).mode;
    await kvSet(STRATEGY_MODE_STORAGE_KEY, requestedMode);
    return NextResponse.json({ ok: true, strategyMode: requestedMode, strategyId: selectStrategyPreset(requestedMode).strategyId });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to persist strategy mode" },
      { status: 500 },
    );
  }
}
