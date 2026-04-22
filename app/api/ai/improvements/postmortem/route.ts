import { NextRequest, NextResponse } from "next/server";
import {
  AI_IMPROVEMENTS_PENDING_KEY,
  fingerprintImprovement,
  trimPendingEntries,
  type PendingImprovementEntry,
} from "@/lib/ai-improvements";
import { kvGet, kvSet } from "@/lib/kv";
import { buildTelegramMessage, sendTelegramMessage } from "@/lib/telegram-service";

export const dynamic = "force-dynamic";

type LossPostmortemPayload = {
  notifyEmail?: string;
  transaction?: Record<string, unknown>;
  portfolioSummary?: Record<string, unknown>;
};

type OpenAiProposal = {
  title: string;
  reason: string;
  expectedImpact: string;
  risk: "low" | "medium" | "high";
  filesLikelyAffected: string[];
};

type OpenAiPostmortem = {
  summary: string;
  rootCause: string;
  actionItems: OpenAiProposal[];
};

function parseContent(data: any) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((entry) => (typeof entry?.text === "string" ? entry.text : "")).join("").trim();
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
        return null;
      }
    }
    return null;
  }
}

function coercePostmortem(value: unknown): OpenAiPostmortem | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const actionItems = Array.isArray(input.actionItems)
    ? input.actionItems
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => {
          const item = entry as Record<string, unknown>;
          return {
            title: String(item.title || "").trim(),
            reason: String(item.reason || "").trim(),
            expectedImpact: String(item.expectedImpact || "").trim(),
            risk: (["low", "medium", "high"].includes(String(item.risk)) ? String(item.risk) : "medium") as "low" | "medium" | "high",
            filesLikelyAffected: Array.isArray(item.filesLikelyAffected)
              ? item.filesLikelyAffected.map((part) => String(part)).filter(Boolean)
              : [],
          };
        })
        .filter((entry) => entry.title && entry.reason)
    : [];

  return {
    summary: String(input.summary || "").trim(),
    rootCause: String(input.rootCause || "").trim(),
    actionItems,
  };
}

function buildFallbackPostmortem(payload: LossPostmortemPayload): OpenAiPostmortem {
  const tx = payload.transaction || {};
  const symbol = String(tx.symbol || "UNKNOWN");
  const routeType = String(tx.routeType || "unknown");
  const reviewReason = String(tx.reviewReason || tx.reason || "trade_review_needed");

  return {
    summary: `${symbol} の取引を確認し、損失要因を簡潔に整理しました。`,
    rootCause: `${symbol} は ${routeType} ルートで実行されました。レビュー理由: ${reviewReason}`,
    actionItems: [
      {
        title: `${symbol} の見直し候補を整理する`,
        reason: "エントリー条件と退出条件の整合性をもう一度確認する。",
        expectedImpact: "不要な負け筋を減らし、再発防止に役立つ。",
        risk: "medium",
        filesLikelyAffected: ["context/SimulationContext.tsx", "lib/cycle-strategy.ts"],
      },
    ],
  };
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as LossPostmortemPayload;
    if (!payload?.transaction || typeof payload.transaction !== "object") {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const tx = payload.transaction;
    const symbol = String(tx.symbol || "UNKNOWN");
    const apiKey = process.env.OPENAI_API_KEY;
    let review: OpenAiPostmortem | null = null;
    let source: "openai" | "heuristic" = "heuristic";

    if (apiKey) {
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: process.env.OPENAI_TRADE_REVIEW_MODEL || "gpt-5.4-nano-2026-03-17",
            max_completion_tokens: 500,
            messages: [
              {
                role: "system",
                content: [
                  "You review losing automated crypto trades for a Japanese trading dashboard.",
                  "Summarize why the trade likely lost and propose concrete logic improvements.",
                  "Return JSON only with fields: summary, rootCause, actionItems.",
                  "actionItems must be an array of objects with title, reason, expectedImpact, risk, filesLikelyAffected.",
                ].join(" "),
              },
              {
                role: "user",
                content: JSON.stringify(payload),
              },
            ],
          }),
        });
        const data = await response.json().catch(() => null);
        if (response.ok) {
          review = coercePostmortem(extractJson(parseContent(data)));
          source = "openai";
        }
      } catch {
        review = null;
      }
    }

    if (!review) {
      review = buildFallbackPostmortem(payload);
      source = "heuristic";
    }

    const pendingEntries = (await kvGet<PendingImprovementEntry[]>(AI_IMPROVEMENTS_PENDING_KEY)) || [];
    const auditId = `loss-${Date.now()}`;
    const newEntries: PendingImprovementEntry[] = [];
    const existingFingerprints = new Set(
      pendingEntries.map((entry) =>
        fingerprintImprovement({
          title: entry.title,
          reason: entry.reason,
          expectedImpact: entry.expectedImpact,
          risk: entry.risk,
          filesLikelyAffected: entry.filesLikelyAffected || [],
        }),
      ),
    );

    review.actionItems.forEach((proposal) => {
      const fingerprint = fingerprintImprovement(proposal);
      if (existingFingerprints.has(fingerprint)) return;
      existingFingerprints.add(fingerprint);
      newEntries.push({
        ...proposal,
        id: fingerprint,
        auditId,
        createdAt: Date.now(),
        source,
      });
    });

    if (newEntries.length > 0) {
      await kvSet(AI_IMPROVEMENTS_PENDING_KEY, trimPendingEntries([...newEntries, ...pendingEntries]));
      await sendTelegramMessage(
        buildTelegramMessage(`DisTERMINAL 損失レビュー ${symbol}`, [
          review.summary,
          `原因: ${review.rootCause}`,
          ...newEntries.map((entry, index) => `${index + 1}. ${entry.title}`),
          payload.notifyEmail ? `登録メール: ${payload.notifyEmail}` : "",
        ]),
      );
    }

    return NextResponse.json({
      ok: true,
      source,
      stored: newEntries.length,
      review,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "postmortem_failed" },
      { status: 500 },
    );
  }
}
