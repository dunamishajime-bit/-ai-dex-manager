import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { AsterDexClient, loadAsterDexClientConfig } from "@/lib/server/asterdex/client";
import { loadAsterTradeHistory } from "@/lib/server/aster-trade-history";

const V12_BASE_SYMBOLS = new Set([
  "BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR",
]);
const MAX_JSON_BYTES = 256 * 1024;

type JsonObject = Record<string, unknown>;
type Direction = "LONG" | "SHORT";
type StepState = "pass" | "blocked" | "pending" | "unknown";

// Keep the read-only UI diagnosis aligned with the frozen V12 production
// contract. The runner snapshot currently stores the ranked metrics, while
// the per-gate booleans are intentionally not persisted there.
const V12_SIGNAL_POLICY = Object.freeze({
  minimumVolumeRatio: 0.9845,
  minimumMomentumPct: 0.0227,
  minimumEdgeToCostRatio: 6.0879,
  normalRoundTripCostBps: 10,
  neutralScoreThreshold: 1.4649,
});

type SanitizedCandidate = {
  symbol?: string;
  side?: string;
  rank?: number;
  score?: number;
  momentum?: number;
  volumeRatio?: number;
  volatility?: number;
  atr?: number;
  signalGate?: {
    status: "pass" | "blocked" | "unknown";
    code?: string;
    detail: string;
  };
};

type PositionRisk = {
  symbol?: string;
  positionAmt?: string | number;
  entryPrice?: string | number;
  markPrice?: string | number;
  unRealizedProfit?: string | number;
  positionSide?: string;
};

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function baseSymbol(symbol: string) {
  const upper = symbol.toUpperCase();
  return upper.endsWith("USDT") ? upper.slice(0, -4) : upper;
}

async function readJsonFromEnvPath(envName: "V12_X1_ALL_STATE_PATH" | "V12_DECISION_SNAPSHOT_PATH" | "DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH") {
  const configuredPath = String(process.env[envName] || "").trim();
  if (!configuredPath) return { configured: false as const, value: null, error: `${envName} がUIサービスに設定されていません。` };
  if (!isAbsolute(configuredPath)) return { configured: true as const, value: null, error: `${envName} は絶対パスで設定してください。` };
  try {
    const text = await readFile(configuredPath, "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) return { configured: true as const, value: null, error: `${envName} が読み取り上限を超えています。` };
    return { configured: true as const, value: JSON.parse(text) as unknown, error: undefined };
  } catch (error) {
    return { configured: true as const, value: null, error: error instanceof Error ? error.message : `${envName} を読み取れません。` };
  }
}

function diagnoseSignalGate(candidate: SanitizedCandidate, btcRegime?: string) {
  const score = candidate.score;
  const momentum = candidate.momentum;
  const volumeRatio = candidate.volumeRatio;
  const side = candidate.side;
  const missingMetric = score === undefined || momentum === undefined || volumeRatio === undefined || !side;
  if (missingMetric || !btcRegime) {
    return { status: "unknown" as const, code: "SIGNAL_GATE_DATA_INCOMPLETE", detail: "発注SignalのGate判定材料がsnapshotに不足しています。" };
  }

  const failed: string[] = [];
  const edgeThreshold = V12_SIGNAL_POLICY.minimumEdgeToCostRatio * (V12_SIGNAL_POLICY.normalRoundTripCostBps / 10_000);
  if (volumeRatio < V12_SIGNAL_POLICY.minimumVolumeRatio) failed.push(`volumeRatio ${volumeRatio.toFixed(3)} < ${V12_SIGNAL_POLICY.minimumVolumeRatio.toFixed(4)}`);
  if (Math.abs(momentum) < edgeThreshold) failed.push(`edge ${Math.abs(momentum).toFixed(4)} < ${edgeThreshold.toFixed(4)}`);
  if (side === "LONG" && momentum < V12_SIGNAL_POLICY.minimumMomentumPct) failed.push(`momentum ${momentum.toFixed(4)} < ${V12_SIGNAL_POLICY.minimumMomentumPct.toFixed(4)}`);
  if (side === "SHORT" && momentum > -V12_SIGNAL_POLICY.minimumMomentumPct) failed.push(`momentum ${momentum.toFixed(4)} > -${V12_SIGNAL_POLICY.minimumMomentumPct.toFixed(4)}`);

  if (btcRegime === "LONG" && side !== "LONG") failed.push("BTC regime=LONG ですが候補sideがLONGではありません");
  if (btcRegime === "SHORT" && side !== "SHORT") failed.push("BTC regime=SHORT ですが候補sideがSHORTではありません");
  if (btcRegime === "NEUTRAL" && score < V12_SIGNAL_POLICY.neutralScoreThreshold) {
    failed.push(`BTC regime=NEUTRAL、score ${score.toFixed(4)} < 必要値 ${V12_SIGNAL_POLICY.neutralScoreThreshold.toFixed(4)}`);
  }

  if (failed.length) {
    const btcBlock = btcRegime === "NEUTRAL" && score < V12_SIGNAL_POLICY.neutralScoreThreshold;
    return {
      status: "blocked" as const,
      code: btcBlock ? "BTC_REGIME_DIRECTION_BLOCKED" : "V12_SIGNAL_GATE_BLOCKED",
      detail: btcBlock
        ? `BTCの判定基準未達：BTC regime=NEUTRALではscore ${V12_SIGNAL_POLICY.neutralScoreThreshold.toFixed(4)}以上が必要ですが、${candidate.symbol || "候補"}は${score.toFixed(4)}です。`
        : `発注Signal Gate未達：${failed.join(" / ")}`,
    };
  }
  return { status: "pass" as const, detail: "記録された指標上、発注Signalの数値Gateは通過しています。" };
}

function safeCandidate(value: unknown): SanitizedCandidate | null {
  const row = asObject(value);
  if (!row) return null;
  return {
    symbol: typeof row.symbol === "string" ? row.symbol : undefined,
    side: typeof row.side === "string" ? row.side : undefined,
    rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : undefined,
    score: Number.isFinite(Number(row.score)) ? Number(row.score) : undefined,
    momentum: Number.isFinite(Number(row.momentum)) ? Number(row.momentum) : undefined,
    volumeRatio: Number.isFinite(Number(row.volumeRatio)) ? Number(row.volumeRatio) : undefined,
    volatility: Number.isFinite(Number(row.volatility)) ? Number(row.volatility) : undefined,
    atr: Number.isFinite(Number(row.atr)) ? Number(row.atr) : undefined,
  };
}

function safeDecisionSnapshot(value: unknown) {
  const row = asObject(value);
  if (!row) return null;
  const btcRegime = typeof row.btcRegime === "string" ? row.btcRegime : typeof row.regime === "string" ? row.regime : undefined;
  const selectionConfirmed = typeof row.symbol === "string" && typeof row.side === "string";
  const candidates = (Array.isArray(row.candidates)
    ? row.candidates.map(safeCandidate).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)).slice(0, 32)
    : []).map((candidate) => ({ ...candidate, signalGate: diagnoseSignalGate(candidate, btcRegime) }));
  const selectedCandidate = candidates.find((candidate) => candidate.rank === 1) || candidates[0];
  return {
    strategyId: typeof row.strategyId === "string" ? row.strategyId : "V12_X1.00_ALL",
    symbol: typeof row.symbol === "string" ? row.symbol : selectedCandidate?.symbol,
    side: typeof row.side === "string" ? row.side : selectedCandidate?.side,
    regime: typeof row.regime === "string" ? row.regime : undefined,
    btcRegime,
    rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : selectedCandidate?.rank,
    score: Number.isFinite(Number(row.score)) ? Number(row.score) : selectedCandidate?.score,
    momentum: Number.isFinite(Number(row.momentum)) ? Number(row.momentum) : selectedCandidate?.momentum,
    volumeRatio: Number.isFinite(Number(row.volumeRatio)) ? Number(row.volumeRatio) : selectedCandidate?.volumeRatio,
    volatility: Number.isFinite(Number(row.volatility)) ? Number(row.volatility) : undefined,
    atr: Number.isFinite(Number(row.atr)) ? Number(row.atr) : undefined,
    requestedGross: Number.isFinite(Number(row.requestedGross)) ? Number(row.requestedGross) : undefined,
    referenceTs: Number.isFinite(Number(row.referenceTs)) ? Number(row.referenceTs) : undefined,
    entryTs: Number.isFinite(Number(row.entryTs)) ? Number(row.entryTs) : undefined,
    selectedAt: typeof row.selectedAt === "string" || Number.isFinite(Number(row.selectedAt)) ? row.selectedAt : undefined,
    rationale: typeof row.rationale === "string" ? row.rationale : typeof row.reason === "string" ? row.reason : undefined,
    selectionConfirmed,
    signalGate: selectedCandidate?.signalGate,
    candidates,
  };
}

function safeRunnerState(value: unknown) {
  const row = asObject(value);
  if (!row) return null;
  const active = asObject(row.active);
  const pending = asObject(row.pending);
  const killSwitch = asObject(row.killSwitch);
  return {
    strategyId: typeof row.strategyId === "string" ? row.strategyId : undefined,
    mode: typeof row.mode === "string" ? row.mode : undefined,
    updatedAt: Number.isFinite(Number(row.updatedAt)) ? Number(row.updatedAt) : undefined,
    lastReferenceTs: Number.isFinite(Number(row.lastReferenceTs)) ? Number(row.lastReferenceTs) : undefined,
    manualReview: typeof row.manualReview === "string" ? row.manualReview : undefined,
    lastCompletedIdempotencyKey: typeof row.lastCompletedIdempotencyKey === "string" ? row.lastCompletedIdempotencyKey : undefined,
    cooldownUntilTs: Number.isFinite(Number(row.cooldownUntilTs)) ? Number(row.cooldownUntilTs) : undefined,
    killSwitch: killSwitch ? {
      active: killSwitch.active === true,
      reason: typeof killSwitch.reason === "string" ? killSwitch.reason : undefined,
      trippedAt: Number.isFinite(Number(killSwitch.trippedAt)) ? Number(killSwitch.trippedAt) : undefined,
    } : undefined,
    active: active ? {
      symbol: typeof active.symbol === "string" ? active.symbol : undefined,
      side: typeof active.side === "string" ? active.side : undefined,
      quantity: Number.isFinite(Number(active.quantity)) ? Number(active.quantity) : undefined,
      gross: Number.isFinite(Number(active.gross)) ? Number(active.gross) : undefined,
      entryPrice: Number.isFinite(Number(active.entryPrice)) ? Number(active.entryPrice) : undefined,
      entrySignalTs: Number.isFinite(Number(active.entrySignalTs)) ? Number(active.entrySignalTs) : undefined,
      holdingBars: Number.isFinite(Number(active.holdingBars)) ? Number(active.holdingBars) : undefined,
    } : undefined,
    pending: pending ? {
      action: typeof pending.action === "string" ? pending.action : undefined,
      symbol: typeof pending.symbol === "string" ? pending.symbol : undefined,
      side: typeof pending.side === "string" ? pending.side : undefined,
      signalTs: Number.isFinite(Number(pending.signalTs)) ? Number(pending.signalTs) : undefined,
      expectedPrice: Number.isFinite(Number(pending.expectedPrice)) ? Number(pending.expectedPrice) : undefined,
      requestedGross: Number.isFinite(Number(pending.requestedGross)) ? Number(pending.requestedGross) : undefined,
      reason: typeof pending.reason === "string" ? pending.reason : undefined,
    } : undefined,
  };
}

function safeSharedRisk(value: unknown) {
  const row = asObject(value);
  if (!row) return null;
  return {
    lossPct: Number.isFinite(Number(row.lossPct)) ? Number(row.lossPct) : undefined,
    maximumLossPct: Number.isFinite(Number(row.maximumLossPct)) ? Number(row.maximumLossPct) : undefined,
    tripped: row.tripped === true,
    updatedAt: Number.isFinite(Number(row.updatedAt)) ? Number(row.updatedAt) : undefined,
  };
}

function buildExecutionTrace(
  decision: ReturnType<typeof safeDecisionSnapshot>,
  runnerState: ReturnType<typeof safeRunnerState>,
  sharedRisk: ReturnType<typeof safeSharedRisk>,
  positions: Array<{ symbol: string; side: Direction; quantity: number }>,
  recentFills: Array<{ symbol: string; action: string; executedAt?: string; positionSide?: string }>,
) {
  const steps: Array<{ key: string; label: string; state: StepState; detail: string }> = [];
  if (!decision?.symbol) {
    return {
      currentStage: "unavailable",
      currentStageLabel: "候補データ未取得",
      summary: "V12の実Runner候補スナップショットがないため、発火判定を確定できません。",
      nextAction: "次回のV12確定足評価を待ちます。",
      steps: [{ key: "candidate", label: "1. 候補選定", state: "unknown" as const, detail: "候補スナップショット未取得" }],
    };
  }

  const candidateSymbol = `${decision.symbol.toUpperCase()}USDT`;
  const active = runnerState?.active;
  const sameReference = decision.referenceTs != null && runnerState?.lastReferenceTs != null && runnerState.lastReferenceTs >= decision.referenceTs;
  const matchingPosition = positions.find((position) => position.symbol.toUpperCase() === candidateSymbol && position.side === (decision.side === "SHORT" ? "SHORT" : "LONG"));
  const selectedAtTs = decision.selectedAt == null ? undefined : Number.isFinite(Number(decision.selectedAt)) ? Number(decision.selectedAt) : Date.parse(String(decision.selectedAt));
  const matchingFill = recentFills.find((fill) => fill.symbol.toUpperCase() === decision.symbol?.toUpperCase() && fill.action === "BUY" && (!Number.isFinite(selectedAtTs) || !fill.executedAt || Date.parse(fill.executedAt) >= Number(selectedAtTs)));

  steps.push({ key: "candidate", label: "1. 候補選定", state: "pass", detail: `${decision.symbol} ${decision.side || "WAIT"} / Rank ${decision.rank ?? "-"} / score ${decision.score?.toFixed(4) ?? "-"}` });
  steps.push({ key: "confirmed-bar", label: "2. 確定2時間足", state: decision.referenceTs != null || decision.entryTs != null ? "pass" : "unknown", detail: decision.referenceTs != null ? `referenceTs ${new Date(decision.referenceTs).toLocaleString("ja-JP")}` : "確定足時刻未取得" });
  steps.push({
    key: "regime",
    label: "3. Regime / BTC判定",
    state: decision.signalGate?.status === "blocked" ? "blocked" : decision.regime && decision.btcRegime ? "pass" : "unknown",
    detail: `${decision.regime || "未取得"} / BTC ${decision.btcRegime || "未取得"}${decision.signalGate?.status === "blocked" ? ` / ${decision.signalGate.detail}` : ""}`,
  });
  const top2 = decision.candidates.filter((candidate) => (candidate.rank || 99) <= 2);
  steps.push({
    key: "signal-selection",
    label: "4. V12 Top2 Signal選定",
    state: decision.selectionConfirmed ? "pass" : "blocked",
    detail: decision.selectionConfirmed
      ? `Top2候補から${decision.symbol} ${decision.side || "WAIT"}をSignal確定。1建玉最大1.00x / 合計最大1.50x。`
      : `候補${decision.candidates.length}件、Top2 ${top2.map((candidate) => candidate.symbol || "—").join(" / ") || "未取得"}。候補順位だけでは発注せず、全Signal Gate成立が必要です。`,
  });
  steps.push({
    key: "risk",
    label: "5. 共有リスクGate",
    state: sharedRisk?.tripped ? "blocked" : sharedRisk ? "pass" : "unknown",
    detail: sharedRisk ? sharedRisk.tripped ? `Kill Switch / daily loss ${sharedRisk.lossPct?.toFixed(2) ?? "-"}%` : `通過 / daily loss ${sharedRisk.lossPct?.toFixed(2) ?? "-"}% / 上限 ${sharedRisk.maximumLossPct?.toFixed(2) ?? "-"}%` : "共有リスク状態未取得",
  });

  if (runnerState?.pending) {
    steps.push({ key: "position", label: "6. 建玉・容量Gate", state: "pending", detail: `${runnerState.pending.action || "ORDER"} ${runnerState.pending.symbol || candidateSymbol} の処理中` });
  } else if (active && sameReference) {
    steps.push({ key: "position", label: "6. 建玉・容量Gate", state: "blocked", detail: `${active.symbol || "既存建玉"} ${active.side || ""} 保有中。同じ確定足は再処理しません（NO_NEW_CONFIRMED_2H_BAR）。V12は最大2建玉・合計1.50xです。` });
  } else if (active) {
    steps.push({ key: "position", label: "6. 建玉・容量Gate", state: "pass", detail: `${active.symbol || "既存建玉"} ${active.side || ""} 保有中。V12最大2建玉・合計1.50xの追加容量Gateへ進みます。` });
  } else {
    steps.push({ key: "position", label: "6. 建玉・容量Gate", state: "pass", detail: "既存のV12建玉なし。1建玉最大1.00x / 合計最大1.50xを確認します。" });
  }

  let currentStage = "candidate";
  let currentStageLabel = "発火候補（未発火）";
  let summary = `${decision.symbol} は実Runnerで候補選定されていますが、実発火・約定は未確認です。`;
  let nextAction = "次回の確定2時間足で、建玉・容量・注文Gateを再判定します。";
  if (!decision.selectionConfirmed) {
    currentStage = "signal-gate-blocked";
    currentStageLabel = "候補順位のみ・発注Signal未成立";
    summary = `${decision.symbol} はRank ${decision.rank ?? "-"}の候補ですが、${decision.signalGate?.status === "blocked" ? decision.signalGate.detail : "発注Signalの全Gate合格が確認できないため"}発注されていません（NO_COMPLETED_BAR_SIGNAL）。`;
    nextAction = "次の完成済み2時間足で、volume・edge・momentum・BTC regimeを再評価します。";
  }
  if (matchingPosition) {
    currentStage = "filled";
    currentStageLabel = "約定確認済み・保有中";
    summary = `${decision.symbol} はAster実建玉として確認済みです。`;
    nextAction = "決済条件または保護注文の更新を待ちます。";
  } else if (matchingFill) {
    currentStage = "filled-history";
    currentStageLabel = "約定履歴あり（建玉照合待ち）";
    summary = `${decision.symbol} の約定履歴はありますが、現在建玉との一致は未確認です。`;
    nextAction = "次回のAster建玉照合で状態を確定します。";
  } else if (runnerState?.pending) {
    currentStage = "pending";
    currentStageLabel = "注文処理中";
    summary = `${runnerState.pending.symbol || decision.symbol} は候補後の注文処理段階です。`;
    nextAction = "約定・拒否・取消の照合結果を待ちます。";
  } else if (active && sameReference) {
    currentStage = "awaiting-confirmed-bar";
    currentStageLabel = "既存建玉保持・次の確定足待ち";
    summary = `${decision.symbol} は候補評価まで進みましたが、同じ確定足を再処理しないGateで停止中です。`;
    nextAction = "次の確定2時間足で再評価されるまで発火しません。";
  } else if (sharedRisk?.tripped) {
    currentStage = "risk-blocked";
    currentStageLabel = "共有リスクGate停止";
    summary = `${decision.symbol} は候補ですが、共有リスクGateが停止中です。`;
    nextAction = "daily loss / Kill Switchの解除条件を満たすまで注文Gateへ進みません。";
  }

  steps.push({ key: "execution", label: "7. 発注・約定", state: currentStage === "filled" || currentStage === "filled-history" ? "pass" : currentStage === "pending" ? "pending" : "blocked", detail: currentStage === "filled" ? "Aster実建玉で約定確認済み" : currentStage === "filled-history" ? "履歴上の約定を確認" : currentStage === "pending" ? "注文処理中" : !decision.selectionConfirmed ? `NO_COMPLETED_BAR_SIGNAL：${decision.signalGate?.status === "blocked" ? decision.signalGate.detail : "Rank/score上位でも発注Signal全Gate合格前は注文しません"}` : "候補選定だけでは発注・約定になりません" });
  return { currentStage, currentStageLabel, summary, nextAction, steps };
}

export async function loadV12DecisionObservability() {
  const errors: string[] = [];
  const [runnerFile, decisionFile, riskFile, history] = await Promise.all([
    readJsonFromEnvPath("V12_X1_ALL_STATE_PATH"),
    readJsonFromEnvPath("V12_DECISION_SNAPSHOT_PATH"),
    readJsonFromEnvPath("DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH"),
    loadAsterTradeHistory(),
  ]);
  if (runnerFile.error) errors.push(`runner-state: ${runnerFile.error}`);
  if (decisionFile.error) errors.push(`decision-snapshot: ${decisionFile.error}`);
  if (riskFile.error) errors.push(`shared-risk: ${riskFile.error}`);
  if (history.error) errors.push(`trade-history: ${history.error}`);

  const recentFills = history.entries
    .filter((entry) => V12_BASE_SYMBOLS.has(entry.action === "BUY" ? entry.destSymbol : entry.sourceSymbol))
    .slice(0, 30)
    .map((entry) => ({
      id: entry.id,
      executedAt: entry.executedAt,
      symbol: entry.action === "BUY" ? entry.destSymbol : entry.sourceSymbol,
      action: entry.action,
      side: entry.positionSide,
      tradeStatus: entry.tradeStatus,
      positionVerified: entry.positionVerified,
      entryPriceUsd: entry.entryPriceUsd,
      exitPriceUsd: entry.exitPriceUsd,
      realizedPnlUsd: entry.realizedPnlUsd,
      netPnlUsd: entry.netPnlUsd,
      orderId: entry.orderId,
      tradeId: entry.tradeId,
    }));

  let positions: Array<{ symbol: string; side: Direction; quantity: number; entryPrice: number; markPrice: number; unrealizedPnlUsd: number }> = [];
  const config = loadAsterDexClientConfig();
  if (!config) {
    errors.push("position-risk: Aster read-only configuration is unavailable.");
  } else {
    try {
      const client = new AsterDexClient(config);
      const positionRisk = await client.getPositionRisk() as PositionRisk[];
      positions = (Array.isArray(positionRisk) ? positionRisk : [])
        .map((position) => {
          const symbol = String(position.symbol || "").toUpperCase();
          const amount = finite(position.positionAmt);
          if (!V12_BASE_SYMBOLS.has(baseSymbol(symbol)) || Math.abs(amount) <= 0.0000001) return null;
          return {
            symbol,
            side: (String(position.positionSide || "").toUpperCase() === "SHORT" || amount < 0 ? "SHORT" : "LONG") as Direction,
            quantity: Math.abs(amount),
            entryPrice: finite(position.entryPrice),
            markPrice: finite(position.markPrice),
            unrealizedPnlUsd: finite(position.unRealizedProfit),
          };
        })
        .filter((position): position is NonNullable<typeof position> => Boolean(position));
    } catch (error) {
      errors.push(`position-risk: ${error instanceof Error ? error.message : "Aster position snapshot failed."}`);
    }
  }

  const decision = safeDecisionSnapshot(decisionFile.value);
  const runnerState = safeRunnerState(runnerFile.value);
  const sharedRisk = safeSharedRisk(riskFile.value);
  const executionTrace = buildExecutionTrace(decision, runnerState, sharedRisk, positions, recentFills);
  return {
    ok: true as const,
    readOnly: true as const,
    tradingMutation: 0 as const,
    capturedAt: new Date().toISOString(),
    decisionDetailsAvailable: Boolean(decision),
    decision,
    runnerState,
    sharedRisk,
    executionTrace,
    v12Positions: positions,
    recentFills,
    wiring: { runnerStateConfigured: runnerFile.configured, decisionSnapshotConfigured: decisionFile.configured },
    errors,
  };
}
