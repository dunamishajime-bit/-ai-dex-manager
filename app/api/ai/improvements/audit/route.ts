import { NextRequest, NextResponse } from "next/server";
import { STRATEGY_CONFIG } from "@/config/strategyConfig";
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
  type StrategyAuditResult,
  trimAppliedEntries,
  trimPendingEntries,
} from "@/lib/ai-improvements";
import { kvGet, kvSet } from "@/lib/kv";
import { buildTelegramMessage, sendTelegramMessage } from "@/lib/telegram-service";

export const dynamic = "force-dynamic";

type StrategyAuditPayload = {
  ownerId?: string;
  notifyEmail?: string;
  walletConnected?: boolean;
  autoTradeActive?: boolean;
  allowExceptionNotify?: boolean;
  notificationReason?: string;
  liveSnapshot?: Record<string, unknown>;
  performanceSummary?: Record<string, unknown>;
  holdingsSummary?: Record<string, unknown>;
  portfolioSummary?: Record<string, unknown>;
};

type UsageSnapshot = {
  calls: number;
  costUsd: number;
};

const DAY_USAGE_PREFIX = "ai:strategy-audit:day:";
const MONTH_USAGE_PREFIX = "ai:strategy-audit:month:";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

function nowJstParts(ts: number = Date.now()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
  return { day, month: day.slice(0, 7) };
}

function buildHeuristicAudit(payload: StrategyAuditPayload, currentConfig: Record<string, number>): StrategyAuditResult {
  const walletConnected = Boolean(payload.walletConnected);
  const autoTradeActive = Boolean(payload.autoTradeActive);
  const summary = autoTradeActive && walletConnected
    ? "VPS 上の運用は稼働中です。必要な提案のみ管理者通知の対象とします。"
    : "運用が停止中のため、提案の配信は抑制します。";

  return {
    summary,
    observations: [
      {
        key: "scope",
        severity: "low",
        message: "対象は現在の運用範囲に限定されます。",
      },
      {
        key: "gate",
        severity: autoTradeActive && walletConnected ? "medium" : "high",
        message: walletConnected && autoTradeActive
          ? "ウォレット接続済みかつ自動運用中です。"
          : "ウォレット未接続または自動運用停止のため、提案は抑制します。",
      },
      {
        key: "config",
        severity: "low",
        message: "運用設定は読み込み済みです。",
      },
    ],
    safeConfigChanges: [],
    manualProposals: [],
    priority: "medium",
    nextReviewInMinutes: 720,
  };
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as StrategyAuditPayload;
    const walletConnected = Boolean(payload.walletConnected);
    const autoTradeActive = Boolean(payload.autoTradeActive);
    const allowExceptionNotify = Boolean(payload.allowExceptionNotify);
    const shouldRunAudit = (walletConnected && autoTradeActive) || allowExceptionNotify;

    const currentOverrides = (await kvGet<RuntimeStrategyConfigOverrides>(AI_IMPROVEMENTS_RUNTIME_CONFIG_KEY)) || {};

    if (!shouldRunAudit) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "auto_trade_inactive_or_wallet_disconnected",
        runtimeOverrides: currentOverrides,
        result: buildHeuristicAudit(payload, buildSafeConfigSnapshot(currentOverrides)),
        applied: [],
        pending: [],
      });
    }

    const currentConfig = buildSafeConfigSnapshot(currentOverrides);
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_TRADE_REVIEW_MODEL || STRATEGY_CONFIG.OPENAI_TRADE_REVIEW_MODEL;

    const { day, month } = nowJstParts();
    const dayUsageKey = `${DAY_USAGE_PREFIX}${day}`;
    const monthUsageKey = `${MONTH_USAGE_PREFIX}${month}`;
    const [dayUsage, monthUsage, appliedRaw, pendingRaw] = await Promise.all([
      kvGet<UsageSnapshot>(dayUsageKey),
      kvGet<UsageSnapshot>(monthUsageKey),
      kvGet<AppliedImprovementEntry[]>(AI_IMPROVEMENTS_APPLIED_KEY),
      kvGet<PendingImprovementEntry[]>(AI_IMPROVEMENTS_PENDING_KEY),
    ]);

    let result: StrategyAuditResult = buildHeuristicAudit(payload, currentConfig);
    let source: "openai" | "heuristic" = "heuristic";
    let estimatedCostUsd = 0;

    const canUseOpenAi =
      Boolean(apiKey)
      && (dayUsage?.calls || 0) < STRATEGY_CONFIG.OPENAI_STRATEGY_AUDIT_MAX_CALLS_PER_DAY
      && (monthUsage?.costUsd || 0) < STRATEGY_CONFIG.OPENAI_STRATEGY_AUDIT_MONTHLY_BUDGET_USD;

    if (canUseOpenAi) {
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_completion_tokens: 500,
            messages: [
              { role: "system", content: "You audit a Japanese crypto auto-trading dashboard. Return concise JSON only." },
              { role: "user", content: JSON.stringify({ currentConfig, payload }) },
            ],
          }),
        });
        const data = await response.json().catch(() => null);
        const content = data?.choices?.[0]?.message?.content;
        let parsed: any = null;
        if (typeof content === "string") {
          try {
            parsed = JSON.parse(content);
          } catch {
            parsed = null;
          }
        }
        if (response.ok && parsed && typeof parsed === "object") {
          result = {
            summary: String(parsed.summary || result.summary),
            observations: Array.isArray(parsed.observations) ? parsed.observations : result.observations,
            safeConfigChanges: Array.isArray(parsed.safeConfigChanges) ? parsed.safeConfigChanges : result.safeConfigChanges,
            manualProposals: Array.isArray(parsed.manualProposals) ? parsed.manualProposals : result.manualProposals,
            priority: String(parsed.priority || result.priority) as StrategyAuditResult["priority"],
            nextReviewInMinutes: Number(parsed.nextReviewInMinutes || result.nextReviewInMinutes),
          };
          source = "openai";
        }
      } catch {
        // keep heuristic result
      }
    }

    const previousApplied = appliedRaw || [];
    const previousPending = pendingRaw || [];
    const nextOverrides: RuntimeStrategyConfigOverrides = { ...currentOverrides };
    const applied: AppliedImprovementEntry[] = [];
    const pending: PendingImprovementEntry[] = [];
    const auditId = `audit_${Date.now()}`;

    for (const change of result.safeConfigChanges) {
      if (!change || typeof change !== "object") continue;
      const nextValue = Number((change as any).proposed);
      const key = String((change as any).key || "");
      const previousValue = typeof nextOverrides[key as keyof RuntimeStrategyConfigOverrides] === "number"
        ? Number(nextOverrides[key as keyof RuntimeStrategyConfigOverrides])
        : Number((change as any).current || 0);
      if (!Number.isFinite(nextValue) || Math.abs(previousValue - nextValue) < 1e-9) continue;
      (nextOverrides as any)[key] = nextValue;
      applied.push({
        ...(change as any),
        id: `${key}-${Date.now()}`,
        auditId,
        createdAt: Date.now(),
        previousValue,
        nextValue,
        source,
      });
    }

    for (const proposal of result.manualProposals) {
      pending.push({
        ...(proposal as any),
        id: `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        auditId,
        createdAt: Date.now(),
        source,
      });
    }

    const storedAudit: StoredStrategyAudit = {
      id: auditId,
      createdAt: Date.now(),
      source,
      result,
      applied,
      pending,
    };

    await Promise.all([
      kvSet(AI_IMPROVEMENTS_RUNTIME_CONFIG_KEY, nextOverrides, DEFAULT_TTL_SECONDS),
      kvSet(AI_IMPROVEMENTS_APPLIED_KEY, trimAppliedEntries([...applied, ...previousApplied]), DEFAULT_TTL_SECONDS),
      kvSet(AI_IMPROVEMENTS_PENDING_KEY, trimPendingEntries([...pending, ...previousPending]), DEFAULT_TTL_SECONDS),
      kvSet(AI_IMPROVEMENTS_LATEST_AUDIT_KEY, storedAudit, DEFAULT_TTL_SECONDS),
      kvSet(dayUsageKey, {
        calls: (dayUsage?.calls || 0) + (source === "openai" ? 1 : 0),
        costUsd: Number(((dayUsage?.costUsd || 0) + estimatedCostUsd).toFixed(6)),
      }, 60 * 60 * 24 * 3),
      kvSet(monthUsageKey, {
        calls: (monthUsage?.calls || 0) + (source === "openai" ? 1 : 0),
        costUsd: Number(((monthUsage?.costUsd || 0) + estimatedCostUsd).toFixed(6)),
      }, 60 * 60 * 24 * 40),
    ]);

    const shouldNotify = (walletConnected && autoTradeActive && (applied.length > 0 || pending.length > 0)) || allowExceptionNotify;
    if (shouldNotify) {
      await sendTelegramMessage(buildTelegramMessage("DisTERMINAL AI 改善通知", [
        result.summary,
        ...applied.map((entry) => `適用: ${entry.key}`),
        ...pending.map((entry) => `保留: ${entry.title}`),
        payload.notificationReason ? `理由: ${payload.notificationReason}` : "",
        allowExceptionNotify ? "例外通知が有効です。" : "",
      ]));
    }

    return NextResponse.json({
      ok: true,
      source,
      estimatedCostUsd,
      result,
      applied,
      pending,
      runtimeOverrides: nextOverrides,
      skipped: false,
    });
  } catch (error) {
    console.error("[ai/improvements/audit] Unexpected failure:", error);
    return NextResponse.json({ ok: false, error: "Failed to run AI improvements audit" }, { status: 500 });
  }
}
