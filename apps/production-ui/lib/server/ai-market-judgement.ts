import type { HybridLiveDecisionDetails, HybridTrendSymbolDecision } from "@/lib/backtest/hybrid-engine";

export type AiMarketJudgementTrigger = "multiple_candidates" | "rotation_check" | "profit_exit";
export type AiMarketJudgementDecision =
  | "keep_v7"
  | "prefer_candidate"
  | "allow_rotation"
  | "delay_rotation"
  | "block_rotation"
  | "normal_trail"
  | "wide_trail"
  | "tight_trail"
  | "reject_entry";
export type AiMarketJudgementSource = "openai" | "heuristic" | "disabled" | "error";

export type AiMarketJudgement = {
  enabled: boolean;
  source: AiMarketJudgementSource;
  trigger: AiMarketJudgementTrigger;
  decision: AiMarketJudgementDecision;
  preferredSymbol: string;
  confidence: number;
  validForBars: number;
  exitPolicy: "normal_trail" | "wide_trail" | "tight_trail" | "none";
  reasonJa: string;
  applied: boolean;
  model?: string;
  error?: string;
};

export type AiMarketJudgementInput = {
  trigger: AiMarketJudgementTrigger;
  currentSymbol: string;
  desiredSymbol: string;
  desiredSide: "trend" | "range" | "cash";
  currentEval: HybridTrendSymbolDecision | null;
  desiredEval: HybridTrendSymbolDecision | null;
  candidateEvaluations: HybridTrendSymbolDecision[];
  decision: HybridLiveDecisionDetails["decision"];
  rotation?: {
    fromSymbol: string;
    toSymbol: string;
    scoreGap: number;
  } | null;
  unrealizedPnlPct?: number | null;
  openPositionAgeHours?: number | null;
};

type OpenAiJudgement = {
  decision: AiMarketJudgementDecision;
  preferredSymbol: string;
  confidence: number;
  validForBars: number;
  exitPolicy: "normal_trail" | "wide_trail" | "tight_trail" | "none";
  reasonJa: string;
};

const MODEL = process.env.OPENAI_MARKET_JUDGEMENT_MODEL
  || process.env.OPENAI_TRADE_REVIEW_MODEL
  || "gpt-5.4-nano-2026-03-17";

const memoryCache = new Map<string, { expiresAt: number; judgement: AiMarketJudgement }>();

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function cacheKey(input: AiMarketJudgementInput) {
  const top = input.candidateEvaluations
    .slice(0, 4)
    .map((item) => `${item.symbol}:${round(item.score, 2)}:${round(item.mom20, 4)}:${round(item.momAccel, 4)}`)
    .join(",");
  return [
    input.trigger,
    input.currentSymbol,
    input.desiredSymbol,
    input.desiredSide,
    input.decision.isoTime,
    round(input.unrealizedPnlPct ?? 0, 2),
    top,
  ].join("|");
}

function candidateSnapshot(item: HybridTrendSymbolDecision | null) {
  if (!item) return null;
  return {
    symbol: item.symbol,
    eligible: item.eligible,
    score: round(item.score),
    close: round(item.close, 6),
    sma40: round(item.sma40, 6),
    mom20Pct: round(item.mom20 * 100),
    momAccelPct: round(item.momAccel * 100),
    adx14: round(item.adx14),
    overheatPct: round(item.overheatPct * 100),
    volumeRatio: round(item.volumeRatio),
    efficiencyRatio: round(item.efficiencyRatio),
    structureBreak: item.structureBreak,
    dowHigherHighLow: item.dowHigherHighLow,
    reasons: item.reasons,
  };
}

function buildFallbackReason(input: AiMarketJudgementInput, decision: AiMarketJudgementDecision, preferredSymbol: string) {
  const current = input.currentEval;
  const desired = input.desiredEval;
  const currentText = current
    ? `${current.symbol}はScore ${round(current.score)}、mom20 ${round(current.mom20 * 100)}%、加速度 ${round(current.momAccel * 100)}%です。`
    : `${input.currentSymbol}の詳細評価は取得できていません。`;
  const desiredText = desired
    ? `${desired.symbol}はScore ${round(desired.score)}、mom20 ${round(desired.mom20 * 100)}%、加速度 ${round(desired.momAccel * 100)}%です。`
    : `${input.desiredSymbol}の詳細評価は取得できていません。`;

  if (decision === "delay_rotation" || decision === "block_rotation" || decision === "wide_trail") {
    return `${currentText} ${desiredText} 現在保有中の通貨にまだ短期の勢いが残っているため、V7の判断を完全には否定せず、今回は急いで乗り換えず保有継続を優先します。`;
  }
  if (decision === "prefer_candidate") {
    return `${desiredText} 複数候補のScore差が小さいため、現在の相場形状では${preferredSymbol}を優先候補として扱います。`;
  }
  return `${currentText} ${desiredText} 相場形状にV7判断を上書きするほどの差はないため、V7の判断を維持します。`;
}

function heuristicJudgement(input: AiMarketJudgementInput): AiMarketJudgement {
  const current = input.currentEval;
  const desired = input.desiredEval;
  let decision: AiMarketJudgementDecision = "keep_v7";
  let preferredSymbol = input.desiredSymbol;
  let confidence = 0.55;
  let exitPolicy: AiMarketJudgement["exitPolicy"] = "none";

  if (input.trigger === "rotation_check" || input.trigger === "profit_exit") {
    const currentStillStrong = Boolean(
      current
      && current.close > current.sma40
      && current.mom20 >= 0.10
      && current.momAccel >= 0
      && current.efficiencyRatio >= 0.35
      && current.overheatPct <= 0.35,
    );
    const desiredClearlyBetter = Boolean(
      current
      && desired
      && desired.score - current.score >= 14
      && desired.mom20 > current.mom20
      && desired.momAccel > current.momAccel,
    );
    const profitStrong = Number(input.unrealizedPnlPct ?? 0) >= 8;

    if (currentStillStrong && !desiredClearlyBetter) {
      decision = input.trigger === "profit_exit" || profitStrong ? "wide_trail" : "delay_rotation";
      preferredSymbol = input.currentSymbol;
      confidence = profitStrong ? 0.72 : 0.68;
      exitPolicy = "wide_trail";
    } else if (input.rotation) {
      decision = "allow_rotation";
      confidence = 0.64;
    }
  }

  if (input.trigger === "multiple_candidates") {
    const eligible = input.candidateEvaluations.filter((item) => item.eligible).slice(0, 3);
    const [first, second] = eligible;
    if (first && second && first.score - second.score <= 8) {
      const sortedByQuality = [...eligible].sort((left, right) => {
        const leftQuality = left.mom20 * 100 + left.momAccel * 150 + left.efficiencyRatio * 12 - Math.max(0, left.overheatPct - 0.25) * 40;
        const rightQuality = right.mom20 * 100 + right.momAccel * 150 + right.efficiencyRatio * 12 - Math.max(0, right.overheatPct - 0.25) * 40;
        return rightQuality - leftQuality;
      });
      const preferred = sortedByQuality[0];
      if (preferred && preferred.symbol !== input.desiredSymbol && first.score - preferred.score <= 8) {
        decision = "prefer_candidate";
        preferredSymbol = preferred.symbol;
        confidence = 0.7;
      }
    }
  }

  return {
    enabled: true,
    source: "heuristic",
    trigger: input.trigger,
    decision,
    preferredSymbol,
    confidence,
    validForBars: 1,
    exitPolicy,
    reasonJa: buildFallbackReason(input, decision, preferredSymbol),
    applied: false,
  };
}

function buildSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: {
        type: "string",
        enum: ["keep_v7", "prefer_candidate", "allow_rotation", "delay_rotation", "block_rotation", "normal_trail", "wide_trail", "tight_trail", "reject_entry"],
      },
      preferredSymbol: { type: "string" },
      confidence: { type: "number" },
      validForBars: { type: "number" },
      exitPolicy: {
        type: "string",
        enum: ["normal_trail", "wide_trail", "tight_trail", "none"],
      },
      reasonJa: { type: "string" },
    },
    required: ["decision", "preferredSymbol", "confidence", "validForBars", "exitPolicy", "reasonJa"],
  } as const;
}

function parseContent(data: any) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((entry) => entry?.text || "").join("").trim();
  }
  return "";
}

function extractJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function coerceOpenAiJudgement(value: unknown, input: AiMarketJudgementInput): OpenAiJudgement | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const rawDecision = String(data.decision || "keep_v7") as AiMarketJudgementDecision;
  const allowed: AiMarketJudgementDecision[] = [
    "keep_v7",
    "prefer_candidate",
    "allow_rotation",
    "delay_rotation",
    "block_rotation",
    "normal_trail",
    "wide_trail",
    "tight_trail",
    "reject_entry",
  ];
  const decision = allowed.includes(rawDecision) ? rawDecision : "keep_v7";
  const reasonJa = typeof data.reasonJa === "string" ? data.reasonJa.trim() : "";
  if (!reasonJa) return null;
  return {
    decision,
    preferredSymbol: String(data.preferredSymbol || input.desiredSymbol).toUpperCase(),
    confidence: clamp(Number(data.confidence || 0), 0, 1),
    validForBars: Math.max(1, Math.min(2, Math.round(Number(data.validForBars || 1)))),
    exitPolicy: ["normal_trail", "wide_trail", "tight_trail", "none"].includes(String(data.exitPolicy))
      ? data.exitPolicy as OpenAiJudgement["exitPolicy"]
      : "none",
    reasonJa,
  };
}

async function openAiJudgement(input: AiMarketJudgementInput): Promise<AiMarketJudgement | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const payload = {
    trigger: input.trigger,
    currentSymbol: input.currentSymbol,
    desiredSymbol: input.desiredSymbol,
    desiredSide: input.desiredSide,
    rotation: input.rotation,
    unrealizedPnlPct: input.unrealizedPnlPct == null ? null : round(input.unrealizedPnlPct),
    openPositionAgeHours: input.openPositionAgeHours == null ? null : round(input.openPositionAgeHours),
    v7Decision: {
      isoTime: input.decision.isoTime,
      desiredSymbol: input.decision.desiredSymbol,
      desiredSide: input.decision.desiredSide,
      reason: input.decision.reason,
      regime: input.decision.regime,
    },
    currentEval: candidateSnapshot(input.currentEval),
    desiredEval: candidateSnapshot(input.desiredEval),
    candidates: input.candidateEvaluations.slice(0, 6).map(candidateSnapshot),
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: 450,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "market_judgement",
          schema: buildSchema(),
          strict: true,
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "あなたはDisDEXの相場判定モードです。",
            "V7ロジックの売買判断を置き換えるのではなく、複数候補・ローテーション直前・利益中の出口判断だけを相場文脈で補助します。",
            "発注は固定ロジック側が行います。損切り無効化、無制限保有、候補外通貨の推奨は禁止です。",
            "理由は必ず日本語で、どの通貨・どの指標・どの相場形状を見たかを明確に書いてください。",
            "英語の理由は禁止です。JSONのみ返してください。",
          ].join("\n"),
        },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI market judgement failed: ${response.status}`);
  }

  const parsed = coerceOpenAiJudgement(extractJson(parseContent(data)), input);
  if (!parsed) return null;
  return {
    enabled: true,
    source: "openai",
    trigger: input.trigger,
    decision: parsed.decision,
    preferredSymbol: parsed.preferredSymbol,
    confidence: parsed.confidence,
    validForBars: parsed.validForBars,
    exitPolicy: parsed.exitPolicy,
    reasonJa: parsed.reasonJa,
    applied: false,
    model: MODEL,
  };
}

export async function evaluateAiMarketJudgement(input: AiMarketJudgementInput): Promise<AiMarketJudgement> {
  if (process.env.AI_MARKET_JUDGEMENT_ENABLED === "0") {
    return {
      enabled: false,
      source: "disabled",
      trigger: input.trigger,
      decision: "keep_v7",
      preferredSymbol: input.desiredSymbol,
      confidence: 0,
      validForBars: 1,
      exitPolicy: "none",
      reasonJa: "AI相場判定は環境設定で無効化されています。",
      applied: false,
    };
  }

  const key = cacheKey(input);
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.judgement };

  let judgement: AiMarketJudgement;
  try {
    judgement = await openAiJudgement(input) || heuristicJudgement(input);
  } catch (error) {
    const fallback = heuristicJudgement(input);
    judgement = {
      ...fallback,
      source: "error",
      error: error instanceof Error ? error.message : String(error),
      reasonJa: `${fallback.reasonJa} なお、OpenAI APIの相場判定は一時的に失敗したため、ローカル判定で補完しています。`,
    };
  }

  memoryCache.set(key, { expiresAt: Date.now() + 55 * 60 * 1000, judgement });
  return { ...judgement };
}
