import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { STRATEGY_CONFIG } from "@/config/strategyConfig";
import { kvGet, kvSet } from "@/lib/kv";

export const dynamic = "force-dynamic";

type TradeReviewKind = "entry" | "exit";

type TradeReviewDecision = {
    approve: boolean;
    priorityScore: number;
    sizeMultiplier: number;
    entryAdjustmentPct: number;
    takeProfitAdjustmentPct: number;
    stopLossAdjustmentPct: number;
    holdMinutes: number;
    reason: string;
    detail: string;
    strategy: string;
    exitPlan: string;
};

type TradeReviewPayload = {
    kind: TradeReviewKind;
    ownerId?: string;
    symbol: string;
    chain?: string;
    candidate: Record<string, unknown>;
    peers?: Array<Record<string, unknown>>;
    portfolio?: Record<string, unknown>;
};

type UsageSnapshot = {
    calls: number;
    costUsd: number;
};

const CACHE_PREFIX = "ai:trade-review:cache:";
const DAY_USAGE_PREFIX = "ai:trade-review:day:";
const MONTH_USAGE_PREFIX = "ai:trade-review:month:";
const SYMBOL_HOUR_PREFIX = "ai:trade-review:symbol-hour:";
const DEFAULT_TTL_SECONDS = Math.ceil(STRATEGY_CONFIG.OPENAI_TRADE_REVIEW_CACHE_TTL_MS / 1000);
const MODEL_PRICING: Record<string, { inputUsdPer1M: number; outputUsdPer1M: number }> = {
    "gpt-5": { inputUsdPer1M: 1.25, outputUsdPer1M: 10 },
    "gpt-5-mini": { inputUsdPer1M: 0.25, outputUsdPer1M: 2 },
    "gpt-5-nano": { inputUsdPer1M: 0.05, outputUsdPer1M: 0.4 },
    "gpt-5.4-nano-2026-03-17": { inputUsdPer1M: 0.05, outputUsdPer1M: 0.4 },
};

function nowJstParts(ts: number = Date.now()) {
    const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(ts));
    const hour = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        hour12: false,
    }).format(new Date(ts));
    return { day, hour, month: day.slice(0, 7) };
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function buildCacheKey(payload: TradeReviewPayload) {
    return `${CACHE_PREFIX}${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function buildJsonSchema() {
    return {
        type: "object",
        additionalProperties: false,
        properties: {
            approve: { type: "boolean" },
            priorityScore: { type: "number" },
            sizeMultiplier: { type: "number" },
            entryAdjustmentPct: { type: "number" },
            takeProfitAdjustmentPct: { type: "number" },
            stopLossAdjustmentPct: { type: "number" },
            holdMinutes: { type: "number" },
            reason: { type: "string" },
            detail: { type: "string" },
            strategy: { type: "string" },
            exitPlan: { type: "string" },
        },
        required: [
            "approve",
            "priorityScore",
            "sizeMultiplier",
            "entryAdjustmentPct",
            "takeProfitAdjustmentPct",
            "stopLossAdjustmentPct",
            "holdMinutes",
            "reason",
            "detail",
            "strategy",
            "exitPlan",
        ],
    } as const;
}

function buildSystemPrompt(kind: TradeReviewKind) {
    if (kind === "exit") {
        return [
            "You are the final Japanese trade-exit reviewer for an automated crypto trader.",
            "Your job is to prevent premature exits and reduce fee-negative churn.",
            "Assume upstream hard blockers already passed.",
            "Approve an exit only if exiting now is better than holding under the current short-term momentum, regime, and profit profile.",
            "Trend positions should usually get more room. Range positions should take quicker partial profits.",
            "If profit is still thin and deterioration is not strong, reject the exit.",
            "Return JSON only.",
        ].join(" ");
    }

    return [
        "You are the final Japanese trade-entry reviewer for an automated crypto trader.",
        "Your job is to maximize realized PnL after fees and avoid weak rotations.",
        "Assume upstream hard blockers already passed.",
        "Do not use volume or liquidity as stand-alone rejection reasons here.",
        "Compare the candidate against peer candidates and prefer the one with the best near-term edge, trigger quality, oscillator alignment, and risk-adjusted payoff.",
        "Prioritize expected value and execution quality over raw score alone.",
        "If multiple candidates are close, prefer the cleaner one and reduce size instead of forcing a full-size entry.",
        "Return JSON only.",
    ].join(" ");
}

function coerceDecision(input: unknown): TradeReviewDecision | null {
    if (!input || typeof input !== "object") return null;
    const value = input as Record<string, unknown>;
    const reason = typeof value.reason === "string" ? value.reason.trim() : "";
    const detail = typeof value.detail === "string" ? value.detail.trim() : "";
    return {
        approve: Boolean(value.approve),
        priorityScore: clamp(Number(value.priorityScore || 0), 0, 100),
        sizeMultiplier: clamp(Number(value.sizeMultiplier || 1), 0.25, 1),
        entryAdjustmentPct: clamp(Number(value.entryAdjustmentPct || 0), -3, 3),
        takeProfitAdjustmentPct: clamp(Number(value.takeProfitAdjustmentPct || 0), -12, 12),
        stopLossAdjustmentPct: clamp(Number(value.stopLossAdjustmentPct || 0), -12, 12),
        holdMinutes: clamp(Number(value.holdMinutes || 0), 0, 360),
        reason: reason || "AI審査",
        detail: detail || "AI 審査の詳細が空だったため、ローカル審査結果を併用しています。",
        strategy: typeof value.strategy === "string" ? value.strategy.trim() || "現状維持" : "現状維持",
        exitPlan: typeof value.exitPlan === "string" ? value.exitPlan.trim() || "現状維持" : "現状維持",
    };
}

function parseChoiceContent(data: any) {
    const message = data?.choices?.[0]?.message;
    if (message?.parsed && typeof message.parsed === "object") {
        return JSON.stringify(message.parsed);
    }

    const content = message?.content;
    if (typeof content === "string") return content;

    if (content && typeof content === "object" && !Array.isArray(content)) {
        if (typeof content.text === "string") return content.text;
        if (content.json && typeof content.json === "object") {
            return JSON.stringify(content.json);
        }
    }

    if (Array.isArray(content)) {
        return content
            .map((entry) => {
                if (typeof entry === "string") return entry;
                if (typeof entry?.text === "string") return entry.text;
                if (entry?.json && typeof entry.json === "object") return JSON.stringify(entry.json);
                if (entry?.type === "output_text" && typeof entry?.text === "string") return entry.text;
                return "";
            })
            .join("")
            .trim();
    }

    if (typeof message?.refusal === "string" && message.refusal.trim()) {
        return JSON.stringify({
            approve: false,
            priorityScore: 0,
            sizeMultiplier: 0.25,
            entryAdjustmentPct: 0,
            takeProfitAdjustmentPct: 0,
            stopLossAdjustmentPct: 0,
            holdMinutes: 0,
            reason: "AI審査保留",
            detail: message.refusal.trim(),
            strategy: "見送り",
            exitPlan: "見送り",
        });
    }

    return "";
}

function extractJson(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced?.[1]) {
            try {
                return JSON.parse(fenced[1].trim());
            } catch {
                // ignore
            }
        }
        const match = trimmed.match(/\{[\s\S]*\}$/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }
}

function estimateCostUsd(model: string, usage: any) {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING["gpt-5.4-nano-2026-03-17"];
    const promptTokens = Number(usage?.prompt_tokens || 0);
    const completionTokens = Number(usage?.completion_tokens || 0);
    return Number(
        (
            (promptTokens * pricing.inputUsdPer1M) / 1_000_000
            + (completionTokens * pricing.outputUsdPer1M) / 1_000_000
        ).toFixed(6),
    );
}

export async function POST(request: NextRequest) {
    try {
        const payload = await request.json() as TradeReviewPayload;
        if (!payload || (payload.kind !== "entry" && payload.kind !== "exit") || !payload.symbol || !payload.candidate) {
            return NextResponse.json({ ok: false, error: "Invalid trade review payload" }, { status: 400 });
        }

        const cacheKey = buildCacheKey(payload);
        const cached = await kvGet<{ review: TradeReviewDecision }>(cacheKey);
        if (cached?.review) {
            return NextResponse.json({ ok: true, source: "cache", review: cached.review });
        }

        const apiKey = process.env.OPENAI_API_KEY;
        const model = process.env.OPENAI_TRADE_REVIEW_MODEL || STRATEGY_CONFIG.OPENAI_TRADE_REVIEW_MODEL;
        if (!apiKey) {
            return NextResponse.json({
                ok: true,
                source: "missing-key",
                review: null,
                message: "OPENAI_API_KEY is not configured on the server runtime.",
            });
        }

        const { day, hour, month } = nowJstParts();
        const dayUsageKey = `${DAY_USAGE_PREFIX}${day}`;
        const monthUsageKey = `${MONTH_USAGE_PREFIX}${month}`;
        const symbolHourKey = `${SYMBOL_HOUR_PREFIX}${day}:${hour}:${payload.kind}:${String(payload.symbol).toUpperCase()}`;

        const [dayUsage, monthUsage, symbolHourUsage] = await Promise.all([
            kvGet<UsageSnapshot>(dayUsageKey),
            kvGet<UsageSnapshot>(monthUsageKey),
            kvGet<number>(symbolHourKey),
        ]);

        if ((dayUsage?.calls || 0) >= STRATEGY_CONFIG.OPENAI_TRADE_REVIEW_MAX_CALLS_PER_DAY) {
            return NextResponse.json({ ok: true, source: "daily-cap", review: null, message: "Daily AI review cap reached." });
        }

        if ((monthUsage?.costUsd || 0) >= STRATEGY_CONFIG.OPENAI_TRADE_REVIEW_MONTHLY_BUDGET_USD) {
            return NextResponse.json({ ok: true, source: "monthly-budget", review: null, message: "Monthly AI review budget reached." });
        }

        if ((symbolHourUsage || 0) >= STRATEGY_CONFIG.OPENAI_TRADE_REVIEW_MAX_CALLS_PER_SYMBOL_PER_HOUR) {
            return NextResponse.json({ ok: true, source: "symbol-hour-cap", review: null, message: "Per-symbol hourly AI review cap reached." });
        }

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                max_completion_tokens: 350,
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "trade_review",
                        schema: buildJsonSchema(),
                        strict: true,
                    },
                },
                messages: [
                    { role: "system", content: buildSystemPrompt(payload.kind) },
                    { role: "user", content: JSON.stringify(payload) },
                ],
            }),
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            console.error("[ai/trade-review] OpenAI error:", data);
            return NextResponse.json({
                ok: true,
                source: response.status === 401 ? "invalid-key" : "upstream-error",
                review: null,
                message: data?.error?.message || "OpenAI request failed",
            });
        }

        const rawContent = parseChoiceContent(data);
        const review = coerceDecision(extractJson(rawContent));
        if (!review) {
            console.error("[ai/trade-review] Invalid review payload:", rawContent);
            return NextResponse.json({
                ok: true,
                source: "upstream-error",
                review: null,
                message: "AI review returned an unparseable response.",
            });
        }

        const estimatedCostUsd = estimateCostUsd(model, data?.usage);
        await Promise.all([
            kvSet(cacheKey, { review, source: "openai" }, DEFAULT_TTL_SECONDS),
            kvSet(dayUsageKey, {
                calls: (dayUsage?.calls || 0) + 1,
                costUsd: Number(((dayUsage?.costUsd || 0) + estimatedCostUsd).toFixed(6)),
            }, 60 * 60 * 24 * 3),
            kvSet(monthUsageKey, {
                calls: (monthUsage?.calls || 0) + 1,
                costUsd: Number(((monthUsage?.costUsd || 0) + estimatedCostUsd).toFixed(6)),
            }, 60 * 60 * 24 * 40),
            kvSet(symbolHourKey, (symbolHourUsage || 0) + 1, 60 * 60 * 2),
        ]);

        return NextResponse.json({
            ok: true,
            source: "openai",
            model,
            estimatedCostUsd,
            review,
        });
    } catch (error) {
        console.error("[ai/trade-review] Unexpected failure:", error);
        return NextResponse.json({ ok: false, error: "Failed to review trade with AI" }, { status: 500 });
    }
}
