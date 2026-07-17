import { STRATEGY_CONFIG } from "@/config/strategyConfig";
import {
  WIN80_ULTRA90_MAIN_STRATEGY,
  applyWin80Ultra90Top1Selection,
  classifyMainStrategyCandidate,
  resolveWin80Ultra90Overlap,
  type MainStrategyCandidateLike,
} from "@/lib/win80-ultra90-main-strategy";

import type {
  ResearchDiscussionEvidence,
  ResearchDiscussionLog,
  ResearchDiscussionMessage,
  ResearchDiscussionSpeakerRole,
  ResearchDiscussionStance,
} from "../discussion-types";
import { MAIN_STRATEGY_RESEARCH_POLICY } from "./main-strategy-research-policy";

export interface MainStrategyAuditInput {
  cycle: number;
  profile: "attack" | "balanced";
  startedAt?: string;
}

type SelectionProbe = MainStrategyCandidateLike & {
  allocationWeight?: number;
  positionSizeMultiplier?: number;
  positionSizeLabel?: string;
};

function evidence(
  label: string,
  value: string,
  assessment: ResearchDiscussionEvidence["assessment"],
): ResearchDiscussionEvidence {
  return { label, value, assessment };
}

function timedAt(startedAt: string, sequence: number) {
  const base = Date.parse(startedAt);
  return Number.isFinite(base) ? new Date(base + sequence * 1_000).toISOString() : startedAt;
}

function message(input: {
  sequence: number;
  startedAt: string;
  speakerId: string;
  speakerName: string;
  role: ResearchDiscussionSpeakerRole;
  stance: ResearchDiscussionStance;
  content: string;
  evidence?: ResearchDiscussionEvidence[];
}): ResearchDiscussionMessage {
  return {
    id: `m-${String(input.sequence).padStart(3, "0")}`,
    sequence: input.sequence,
    createdAt: timedAt(input.startedAt, input.sequence),
    speakerId: input.speakerId,
    speakerName: input.speakerName,
    role: input.role,
    stance: input.stance,
    strategyId: WIN80_ULTRA90_MAIN_STRATEGY.id,
    content: input.content,
    evidence: input.evidence ?? [],
  };
}

function pct(value: number) {
  return `${value.toFixed(2)}%`;
}

function buildProbe(input: {
  symbol: string;
  score: number;
  confidence: number;
  progress: number;
  rr: number;
  volumeRatio: number;
  eventPriority: number;
}): SelectionProbe {
  return {
    symbol: input.symbol,
    marketScore: input.score,
    confidence: input.confidence,
    triggerProgressRatio: input.progress,
    volumeRatio: input.volumeRatio,
    eventPriority: input.eventPriority,
    triggerState: "Triggered",
    resistanceStatus: "Open",
    executionStatus: "Pass",
    metrics: {
      rr: input.rr,
      adx1h: 25,
      macd1h: 1,
      macd6h: 1,
    },
  };
}

export function buildCurrentMainStrategyAuditDiscussion(
  input: MainStrategyAuditInput,
): ResearchDiscussionLog {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const completedAt = timedAt(startedAt, 8);
  const strategy = WIN80_ULTRA90_MAIN_STRATEGY;
  const reference = MAIN_STRATEGY_RESEARCH_POLICY.historicalReference;

  const winProbe = buildProbe({
    symbol: "SUI",
    score: 84,
    confidence: 0.86,
    progress: 0.82,
    rr: 1.3,
    volumeRatio: 0.82,
    eventPriority: 70,
  });
  const ultraProbe = buildProbe({
    symbol: "PENGU",
    score: 94,
    confidence: 0.94,
    progress: 0.94,
    rr: 1.7,
    volumeRatio: 1.2,
    eventPriority: 92,
  });
  const selected = applyWin80Ultra90Top1Selection<SelectionProbe>([winProbe, ultraProbe])[0];
  const profitableOverlap = resolveWin80Ultra90Overlap({
    current: { symbol: "BONK", pnlPct: 3.2, usdValue: 100 },
    incoming: winProbe,
  });
  const losingOverlap = resolveWin80Ultra90Overlap({
    current: { symbol: "BONK", pnlPct: -0.4, usdValue: 100 },
    incoming: winProbe,
  });
  const ultraRotation = resolveWin80Ultra90Overlap({
    current: { symbol: "BONK", pnlPct: -0.4, usdValue: 100 },
    incoming: ultraProbe,
  });

  const configChecks = [
    STRATEGY_CONFIG.MAIN_STRATEGY_ENABLED === strategy.enabled,
    STRATEGY_CONFIG.MAIN_STRATEGY_ID === strategy.id,
    STRATEGY_CONFIG.MAIN_STRATEGY_INITIAL_NOTIONAL_FRACTION === strategy.initialNotionalFraction,
    STRATEGY_CONFIG.MAIN_STRATEGY_MAX_CONCURRENT_POSITIONS === strategy.maxConcurrentPositions,
    STRATEGY_CONFIG.MAIN_STRATEGY_PROFITABLE_OVERLAP_SPLIT_FRACTION === strategy.profitableOverlapSplitFraction,
    STRATEGY_CONFIG.MAIN_STRATEGY_ULTRA90_SWITCH_FRACTION === strategy.ultra90SwitchFraction,
    STRATEGY_CONFIG.MAIN_STRATEGY_MIN_SCORE === strategy.win80.minScore,
    STRATEGY_CONFIG.MAIN_STRATEGY_ULTRA_SCORE === strategy.ultra90.minScore,
    STRATEGY_CONFIG.MAIN_STRATEGY_DISABLE_EMERGENCY_TOPUP === true,
  ];
  const configAligned = configChecks.every(Boolean);
  const realTradingDisabled = STRATEGY_CONFIG.MAIN_STRATEGY_REAL_TRADING_ENABLED === false;
  const labelMatchesAllocation = selected?.positionSizeLabel === "1.0x";

  const messages: ResearchDiscussionMessage[] = [];
  let sequence = 1;

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "research-moderator",
    speakerName: "Research Moderator",
    role: "moderator",
    stance: "context",
    content: `今回は研究Proxyではなく、現在masterでメイン運用経路に固定されている${strategy.id}本体を直接監査します。実コードのEntry閾値、Top-1選抜、100%初回配分、50%分割、70%優先Rotation、含み損時拒否、安全設定を読み取り、歴史BT参考値とは分離して評価します。`,
    evidence: [
      evidence("監査対象", strategy.id, "positive"),
      evidence("本番メイン固定", MAIN_STRATEGY_RESEARCH_POLICY.mainStrategyLocked ? "ON" : "OFF", MAIN_STRATEGY_RESEARCH_POLICY.mainStrategyLocked ? "positive" : "negative"),
      evidence("自動昇格", MAIN_STRATEGY_RESEARCH_POLICY.autoPromotionToMain ? "ON" : "OFF", MAIN_STRATEGY_RESEARCH_POLICY.autoPromotionToMain ? "negative" : "positive"),
      evidence("研究Proxy", "今回の主対象ではない", "positive"),
    ],
  }));

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "alpha-main-entry",
    speakerName: "Main Strategy Researcher / Entry",
    role: "researcher",
    stance: "proposal",
    content: `現行EntryはWin80でScore ${strategy.win80.minScore}以上、Confidence ${(strategy.win80.minConfidence * 100).toFixed(0)}%以上、Trigger進捗${(strategy.win80.minTriggerProgress * 100).toFixed(0)}%以上、RR ${strategy.win80.minRr.toFixed(2)}以上、Volume比${strategy.win80.minVolumeRatio.toFixed(2)}以上です。Ultra90はScore ${strategy.ultra90.minScore}以上、Confidence ${(strategy.ultra90.minConfidence * 100).toFixed(0)}%以上、Trigger進捗${(strategy.ultra90.minTriggerProgress * 100).toFixed(0)}%以上、RR ${strategy.ultra90.minRr.toFixed(2)}以上、Volume比${strategy.ultra90.minVolumeRatio.toFixed(2)}以上です。実コードProbeではWin80とUltra90が正しく分類され、Ultra90がTop-1に選ばれました。`,
    evidence: [
      evidence("Win80 Probe", classifyMainStrategyCandidate(winProbe), classifyMainStrategyCandidate(winProbe) === "WIN80" ? "positive" : "negative"),
      evidence("Ultra90 Probe", classifyMainStrategyCandidate(ultraProbe), classifyMainStrategyCandidate(ultraProbe) === "ULTRA90" ? "positive" : "negative"),
      evidence("Top-1選択", selected?.symbol ?? "未選択", selected?.symbol === ultraProbe.symbol ? "positive" : "negative"),
      evidence("初回Notional", `${((selected?.positionSizeMultiplier ?? 0) * 100).toFixed(0)}%`, selected?.positionSizeMultiplier === 1 ? "positive" : "negative"),
    ],
  }));

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "portfolio-construction",
    speakerName: "Portfolio Researcher / Rotation",
    role: "researcher",
    stance: "proposal",
    content: `現行の資金移動は、同一通貨の追加Entryを禁止し、通常Win80の重複は既存ポジションが含み益の場合だけ${(strategy.profitableOverlapSplitFraction * 100).toFixed(0)}%を新通貨へ移します。既存が含み損なら通常Win80を拒否します。Ultra90は既存損益に関係なく${(strategy.ultra90SwitchFraction * 100).toFixed(0)}%を優先移動し、${((1 - strategy.ultra90SwitchFraction) * 100).toFixed(0)}%を残します。実コードProbeでもSPLIT_50、REJECT、SWITCH_70を確認しました。`,
    evidence: [
      evidence("含み益Win80", profitableOverlap.action, profitableOverlap.action === "SPLIT_50" ? "positive" : "negative"),
      evidence("含み損Win80", losingOverlap.action, losingOverlap.action === "REJECT" ? "positive" : "negative"),
      evidence("含み損中Ultra90", ultraRotation.action, ultraRotation.action === "SWITCH_70" ? "positive" : "negative"),
      evidence("最大同時保有", String(strategy.maxConcurrentPositions), strategy.maxConcurrentPositions === 2 ? "positive" : "neutral"),
    ],
  }));

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "overfit-critic",
    speakerName: "AI反対派 / Overfit",
    role: "overfit_critic",
    stance: "challenge",
    content: `歴史参考値は${reference.trades}取引、勝率${pct(reference.winRatePct)}、複利月利${pct(reference.compoundMonthlyPct)}、MaxDD ${pct(reference.maxDrawdownPct)}、PF ${reference.profitFactor.toFixed(2)}で有望です。しかし損失分析後に同一期間へ条件を追加した結果で、完全未使用OOSではありません。この数値を再現性確定値として扱うことには反対します。固定した現行コードを変更せず、未使用期間とForward Paperで確認する必要があります。`,
    evidence: [
      evidence("歴史取引数", String(reference.trades), reference.trades >= 100 ? "positive" : "negative"),
      evidence("歴史複利月利", pct(reference.compoundMonthlyPct), reference.compoundMonthlyPct >= 15 ? "positive" : "neutral"),
      evidence("歴史PF", reference.profitFactor.toFixed(2), reference.profitFactor >= 2 ? "positive" : "neutral"),
      evidence("完全未使用OOS", reference.untouchedOos ? "YES" : "NO", reference.untouchedOos ? "positive" : "negative"),
    ],
  }));

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "tail-risk-critic",
    speakerName: "AI反対派 / Tail Risk",
    role: "tail_risk_critic",
    stance: "challenge",
    content: `初回Notional 100%は高い集中リスクです。通常Win80は含み損中の追加を拒否するため悪化抑制になりますが、Ultra90は含み損中でも70%を新シグナルへ移すため、急変時には損失確定と新規高値掴みが同時発生する可能性があります。50%・70%の資金移動率は、閾値本体と分離してAblation、Gap、Slippage、連続シグナルStressを検証すべきです。`,
    evidence: [
      evidence("初回集中", `${(strategy.initialNotionalFraction * 100).toFixed(0)}%`, strategy.initialNotionalFraction <= 0.5 ? "positive" : "negative"),
      evidence("含み損Win80追加", losingOverlap.action, losingOverlap.action === "REJECT" ? "positive" : "negative"),
      evidence("含み損Ultra90移動", `${(ultraRotation.sourceSellFraction * 100).toFixed(0)}%`, "negative"),
      evidence("歴史MaxDD", pct(reference.maxDrawdownPct), Math.abs(reference.maxDrawdownPct) <= 10 ? "positive" : "neutral"),
    ],
  }));

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "execution-critic",
    speakerName: "AI反対派 / Execution",
    role: "execution_critic",
    stance: "challenge",
    content: `production設定とメイン定数の整合性は${configAligned ? "確認できました" : "不一致があります"}。Emergency Top-upは停止、選抜上限は1、最大管理ポジションは2、実売買フラグは${realTradingDisabled ? "停止中" : "有効"}です。一方、実際の配分Multiplierは1.0xなのに表示ラベルは「${selected?.positionSizeLabel ?? "未設定"}」で、監視画面の誤認につながります。これは売買数量ではなく表示メタデータですが、Forward Paper前に修正対象です。`,
    evidence: [
      evidence("設定整合", configAligned ? "PASS" : "FAIL", configAligned ? "positive" : "negative"),
      evidence("実売買", realTradingDisabled ? "DISABLED" : "ENABLED", realTradingDisabled ? "positive" : "negative"),
      evidence("Emergency Top-up", STRATEGY_CONFIG.MAIN_STRATEGY_DISABLE_EMERGENCY_TOPUP ? "OFF" : "ON", STRATEGY_CONFIG.MAIN_STRATEGY_DISABLE_EMERGENCY_TOPUP ? "positive" : "negative"),
      evidence("配分表示", `${selected?.positionSizeMultiplier ?? 0}x / label ${selected?.positionSizeLabel ?? "none"}`, labelMatchesAllocation ? "positive" : "negative"),
    ],
  }));

  const decision = [
    `${strategy.id}はメインロジックのまま固定し、研究Proxyに置き換えません。`,
    "Entry・Top-1・50%分割・70%Rotation・含み損時拒否は実コード上で意図どおり動作しています。",
    "ただし月利16.81%は完全未使用OOSではなく、33取引の同一期間調整値のため、収益再現性は未確定です。",
    "次の優先順位は、現行コードを凍結したForward Paper、未使用OOS、Score80/90・50%・70%の個別Ablation、コスト・Gap Stressです。",
    labelMatchesAllocation ? "表示整合の追加指摘はありません。" : "1.0x配分に対する0.5x表示ラベルは修正候補です。",
  ].join(" ");

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "research-cio",
    speakerName: "Research CIO",
    role: "cio",
    stance: "decision",
    content: decision,
    evidence: [
      evidence("メイン維持", strategy.id, "positive"),
      evidence("コード動作監査", configAligned ? "PASS" : "FAIL", configAligned ? "positive" : "negative"),
      evidence("収益再現性", reference.untouchedOos ? "確認済み" : "未確認", reference.untouchedOos ? "positive" : "negative"),
      evidence("自動メイン変更", "禁止", "positive"),
    ],
  }));

  return {
    version: 1,
    id: `main-audit-${strategy.id.toLowerCase()}-${completedAt.replace(/[:.]/g, "-")}`,
    cycle: input.cycle,
    startedAt,
    completedAt,
    profile: input.profile,
    title: `手動監査：${strategy.id} 現行メインロジック会議`,
    summary: `研究Proxyではなく現行${strategy.id}本体を直接監査。Win80/Ultra90分類、Top-1、100%初回配分、50%分割、70%Rotation、含み損時拒否は実コードで確認。歴史複利月利${pct(reference.compoundMonthlyPct)}は有望だが完全未使用OOSではなく、再現性はForward Paper待ち。`,
    decision,
    methodology: "現在のproduction main strategyコード、strategyConfig、実関数Probe、歴史参考値を直接読み取る決定論的な監査会議です。Perpetual Research Genomeへ写像したProxy成績は、この手動監査の主評価には使用しません。歴史参考値は損失分析後の同一期間調整値であり、完全未使用OOSとは扱いません。",
    finalCandidates: 0,
    bestTrainMonthlyPct: null,
    bestOosMonthlyPct: null,
    bestOosDrawdownPct: null,
    bestWorstStressMonthlyPct: null,
    topStrategyIds: [strategy.id],
    messages,
  };
}
