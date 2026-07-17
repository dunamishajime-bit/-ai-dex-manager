import { STRATEGY_CONFIG } from "@/config/strategyConfig";
import { WIN80_ULTRA90_MAIN_STRATEGY } from "@/lib/win80-ultra90-main-strategy";

import type {
  ResearchDiscussionEvidence,
  ResearchDiscussionLog,
  ResearchDiscussionMessage,
  ResearchDiscussionSpeakerRole,
  ResearchDiscussionStance,
} from "../discussion-types";
import { MAIN_STRATEGY_RESEARCH_POLICY } from "./main-strategy-research-policy";

export const MAIN_STRATEGY_RESEARCH_PROGRAM_VERSION = 2 as const;
export const MAIN_STRATEGY_RESEARCH_PROGRAM_ID = "win80_ultra90_direct_v2" as const;

export type MainStrategyResearchFocus =
  | "entry_quality"
  | "ultra90_rotation"
  | "top1_ranking"
  | "position_concentration"
  | "related_logic";

export type MainStrategyExperimentStatus = "PROPOSED" | "REPLAY_REQUIRED" | "FORWARD_PAPER_REQUIRED";

export interface MainStrategyResearchExperiment {
  id: string;
  parentStrategyId: string;
  focus: MainStrategyResearchFocus;
  parameterGroup: string;
  currentValue: string;
  proposedValue: string;
  rationale: string;
  expectedEffect: string;
  status: MainStrategyExperimentStatus;
}

export interface MainStrategyResearchProgramState {
  version: typeof MAIN_STRATEGY_RESEARCH_PROGRAM_VERSION;
  programId: typeof MAIN_STRATEGY_RESEARCH_PROGRAM_ID;
  mainStrategyId: string;
  iteration: number;
  updatedAt: string;
  completedFocuses: MainStrategyResearchFocus[];
  lastDiscussionId: string | null;
  experimentQueue: MainStrategyResearchExperiment[];
  oldChampionStateInherited: false;
}

const FOCUS_ORDER: MainStrategyResearchFocus[] = [
  "entry_quality",
  "ultra90_rotation",
  "top1_ranking",
  "position_concentration",
  "related_logic",
];

function finiteInteger(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function createMainStrategyResearchProgramState(now = new Date().toISOString()): MainStrategyResearchProgramState {
  return {
    version: MAIN_STRATEGY_RESEARCH_PROGRAM_VERSION,
    programId: MAIN_STRATEGY_RESEARCH_PROGRAM_ID,
    mainStrategyId: WIN80_ULTRA90_MAIN_STRATEGY.id,
    iteration: 0,
    updatedAt: now,
    completedFocuses: [],
    lastDiscussionId: null,
    experimentQueue: [],
    oldChampionStateInherited: false,
  };
}

export function normalizeMainStrategyResearchProgramState(
  value: unknown,
  now = new Date().toISOString(),
): MainStrategyResearchProgramState {
  if (!value || typeof value !== "object") return createMainStrategyResearchProgramState(now);
  const source = value as Partial<MainStrategyResearchProgramState>;
  if (
    source.version !== MAIN_STRATEGY_RESEARCH_PROGRAM_VERSION
    || source.programId !== MAIN_STRATEGY_RESEARCH_PROGRAM_ID
    || source.mainStrategyId !== WIN80_ULTRA90_MAIN_STRATEGY.id
  ) {
    return createMainStrategyResearchProgramState(now);
  }
  const completedFocuses = Array.isArray(source.completedFocuses)
    ? source.completedFocuses.filter((item): item is MainStrategyResearchFocus => FOCUS_ORDER.includes(item as MainStrategyResearchFocus))
    : [];
  const experimentQueue = Array.isArray(source.experimentQueue)
    ? source.experimentQueue.filter((item): item is MainStrategyResearchExperiment => Boolean(
      item
      && typeof item === "object"
      && typeof (item as MainStrategyResearchExperiment).id === "string"
      && (item as MainStrategyResearchExperiment).parentStrategyId === WIN80_ULTRA90_MAIN_STRATEGY.id,
    ))
    : [];
  return {
    version: MAIN_STRATEGY_RESEARCH_PROGRAM_VERSION,
    programId: MAIN_STRATEGY_RESEARCH_PROGRAM_ID,
    mainStrategyId: WIN80_ULTRA90_MAIN_STRATEGY.id,
    iteration: finiteInteger(source.iteration),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : now,
    completedFocuses,
    lastDiscussionId: typeof source.lastDiscussionId === "string" ? source.lastDiscussionId : null,
    experimentQueue,
    oldChampionStateInherited: false,
  };
}

function pct(value: number) {
  return `${value.toFixed(2)}%`;
}

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
  strategyId?: string | null;
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
    strategyId: input.strategyId ?? WIN80_ULTRA90_MAIN_STRATEGY.id,
    content: input.content,
    evidence: input.evidence ?? [],
  };
}

function focusLabel(focus: MainStrategyResearchFocus) {
  if (focus === "entry_quality") return "Win80 / Ultra90 Entry品質";
  if (focus === "ultra90_rotation") return "50%分割 / 70%Rotation";
  if (focus === "top1_ranking") return "Top-1順位付け";
  if (focus === "position_concentration") return "初回100%・最大2通貨";
  return "方向性が近い新ロジック";
}

function experimentsForFocus(focus: MainStrategyResearchFocus): MainStrategyResearchExperiment[] {
  const strategy = WIN80_ULTRA90_MAIN_STRATEGY;
  const parentStrategyId = strategy.id;
  if (focus === "entry_quality") {
    return [
      {
        id: "WIN80_SCORE_82_CHILD_V1",
        parentStrategyId,
        focus,
        parameterGroup: "Win80 minimum score",
        currentValue: String(strategy.win80.minScore),
        proposedValue: "82",
        rationale: "Score 80直上の弱いEntryを削り、勝率とコスト耐性が改善するかを切り分ける。",
        expectedEffect: "取引数は減るが平均利益とStress耐性が改善する可能性。",
        status: "REPLAY_REQUIRED",
      },
      {
        id: "WIN80_TRIGGER_80_CHILD_V1",
        parentStrategyId,
        focus,
        parameterGroup: "Win80 trigger progress",
        currentValue: pct(strategy.win80.minTriggerProgress * 100),
        proposedValue: "80.00%",
        rationale: "発火途中のEntryを減らし、騙しBreakoutを抑制できるかを確認する。",
        expectedEffect: "損失回数低下とEntry遅延のトレードオフ。",
        status: "REPLAY_REQUIRED",
      },
    ];
  }
  if (focus === "ultra90_rotation") {
    return [
      {
        id: "ULTRA90_ROTATION_60_CHILD_V1",
        parentStrategyId,
        focus,
        parameterGroup: "Ultra90 switch fraction",
        currentValue: pct(strategy.ultra90SwitchFraction * 100),
        proposedValue: "60.00%",
        rationale: "含み損中の70%移動による損失確定と高値掴みを緩和できるかを検証する。",
        expectedEffect: "Gap耐性改善と強シグナル追随力低下の比較。",
        status: "REPLAY_REQUIRED",
      },
      {
        id: "WIN80_SPLIT_40_CHILD_V1",
        parentStrategyId,
        focus,
        parameterGroup: "Profitable Win80 split fraction",
        currentValue: pct(strategy.profitableOverlapSplitFraction * 100),
        proposedValue: "40.00%",
        rationale: "勝ちポジションを多く残しながら新候補へ分散する方が複利効率を保てるかを検証する。",
        expectedEffect: "既存Trend継続利益の維持と新候補取り逃しの比較。",
        status: "REPLAY_REQUIRED",
      },
    ];
  }
  if (focus === "top1_ranking") {
    return [
      {
        id: "TOP1_COST_ADJUSTED_RANK_CHILD_V1",
        parentStrategyId,
        focus,
        parameterGroup: "Top-1 ranking score",
        currentValue: "Tier + Score + Confidence + Trigger + RR + Volume + EventPriority",
        proposedValue: "Current ranking - estimated round-trip cost penalty",
        rationale: "高ScoreでもSpread・Slippage負けする銘柄をTop-1から外せるかを検証する。",
        expectedEffect: "約定後期待値とStress耐性の改善。",
        status: "REPLAY_REQUIRED",
      },
      {
        id: "TOP1_REGIME_CONFIRM_CHILD_V1",
        parentStrategyId,
        focus,
        parameterGroup: "Top-1 tie breaker",
        currentValue: "Trend agreement bonus",
        proposedValue: "BTC regime agreement as final tie breaker",
        rationale: "僅差候補ではBTC地合い一致を優先し、逆行Entryを減らす。",
        expectedEffect: "勝率改善と候補減少。",
        status: "REPLAY_REQUIRED",
      },
    ];
  }
  if (focus === "position_concentration") {
    return [
      {
        id: "INITIAL_NOTIONAL_80_CHILD_V1",
        parentStrategyId,
        focus,
        parameterGroup: "Initial notional fraction",
        currentValue: pct(strategy.initialNotionalFraction * 100),
        proposedValue: "80.00%",
        rationale: "初回100%集中を抑え、次のUltra90または急変時の余力を残す。",
        expectedEffect: "DD低下と月利低下の比較。",
        status: "REPLAY_REQUIRED",
      },
      {
        id: "MAX_POSITION_1_CHILD_V1",
        parentStrategyId,
        focus,
        parameterGroup: "Maximum concurrent positions",
        currentValue: String(strategy.maxConcurrentPositions),
        proposedValue: "1",
        rationale: "Top-1思想を完全単一保有にした場合の集中収益と相関リスクを比較する。",
        expectedEffect: "管理単純化と分散効果消失の比較。",
        status: "REPLAY_REQUIRED",
      },
    ];
  }
  return [
    {
      id: "WIN85_DUAL_CONFIRM_SIBLING_V1",
      parentStrategyId,
      focus,
      parameterGroup: "New sibling logic",
      currentValue: "WIN80 Top-1",
      proposedValue: "Score85 + 1H/6H trend agreement + next-bar confirmation",
      rationale: "Win80の高選別思想を維持しながら、Entryを1段階確認して騙しを減らす近縁ロジック。",
      expectedEffect: "取引数を抑えた高勝率型。メインを変更せず別系統で検証する。",
      status: "REPLAY_REQUIRED",
    },
    {
      id: "ULTRA90_PULLBACK_SIBLING_V1",
      parentStrategyId,
      focus,
      parameterGroup: "New sibling logic",
      currentValue: "Immediate Ultra90 rotation",
      proposedValue: "Ultra90 detected -> pullback/retest confirmation -> rotation",
      rationale: "Ultra90の強さを使いつつ、直後の高値掴みを減らす近縁ロジック。",
      expectedEffect: "Slippage・Gap耐性改善とEntry遅延の比較。",
      status: "REPLAY_REQUIRED",
    },
  ];
}

export function buildMainStrategyResearchProgramCycle(input: {
  state: MainStrategyResearchProgramState;
  contextCycle: number;
  profile: "attack" | "balanced";
  startedAt?: string;
}): { discussion: ResearchDiscussionLog; nextState: MainStrategyResearchProgramState } {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const strategy = WIN80_ULTRA90_MAIN_STRATEGY;
  const reference = MAIN_STRATEGY_RESEARCH_POLICY.historicalReference;
  const focus = FOCUS_ORDER[input.state.iteration % FOCUS_ORDER.length];
  const experiments = experimentsForFocus(focus);
  const iteration = input.state.iteration + 1;
  const completedAt = timedAt(startedAt, 10);
  const id = `main-research-${String(iteration).padStart(4, "0")}-${completedAt.replace(/[:.]/g, "-")}`;
  const messages: ResearchDiscussionMessage[] = [];
  let sequence = 1;

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "research-moderator",
    speakerName: "Research Moderator",
    role: "moderator",
    stance: "context",
    content: `Main Strategy Research #${iteration}を開始します。親は実運用コードの${strategy.id}だけです。旧Champion Deepのdeep-c*、Momentum、ATR、汎用Perpetual Genomeは継承せず、今回の焦点は「${focusLabel(focus)}」です。メインは固定し、改善案と近縁ロジックは別IDで検証します。`,
    evidence: [
      evidence("固定親", strategy.id, "positive"),
      evidence("旧Champion継承", "NO", "positive"),
      evidence("研究Program", MAIN_STRATEGY_RESEARCH_PROGRAM_ID, "positive"),
      evidence("今回の焦点", focusLabel(focus), "neutral"),
    ],
  }));

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "main-strategy-researcher",
    speakerName: "Main Strategy Researcher",
    role: "researcher",
    stance: "support",
    content: `現行メインはWin80: Score${strategy.win80.minScore} / Confidence${pct(strategy.win80.minConfidence * 100)} / Trigger${pct(strategy.win80.minTriggerProgress * 100)} / RR${strategy.win80.minRr.toFixed(2)} / Volume${strategy.win80.minVolumeRatio.toFixed(2)}、Ultra90: Score${strategy.ultra90.minScore} / Confidence${pct(strategy.ultra90.minConfidence * 100)} / Trigger${pct(strategy.ultra90.minTriggerProgress * 100)} / RR${strategy.ultra90.minRr.toFixed(2)} / Volume${strategy.ultra90.minVolumeRatio.toFixed(2)}です。Top-1へ初回${pct(strategy.initialNotionalFraction * 100)}、含み益Win80は${pct(strategy.profitableOverlapSplitFraction * 100)}分割、Ultra90は${pct(strategy.ultra90SwitchFraction * 100)}移動です。`,
    evidence: [
      evidence("歴史複利月利", pct(reference.compoundMonthlyPct), "positive"),
      evidence("歴史取引数", String(reference.trades), reference.trades >= 100 ? "positive" : "negative"),
      evidence("歴史MaxDD", pct(reference.maxDrawdownPct), "positive"),
      evidence("完全未使用OOS", reference.untouchedOos ? "YES" : "NO", reference.untouchedOos ? "positive" : "negative"),
    ],
  }));

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "hypothesis-researcher",
    speakerName: "Hypothesis Researcher",
    role: "researcher",
    stance: "proposal",
    content: experiments.map((item, index) => `${index + 1}. ${item.id}: ${item.parameterGroup}を「${item.currentValue}」から「${item.proposedValue}」へ変更。${item.rationale} 期待効果: ${item.expectedEffect}`).join("\n"),
    evidence: experiments.map((item) => evidence(item.id, item.status, "neutral")),
  }));

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "overfit-critic",
    speakerName: "AI反対派 / Overfit",
    role: "overfit_critic",
    stance: "challenge",
    content: `歴史月利${pct(reference.compoundMonthlyPct)}は有望ですが、損失分析後の同一期間調整値であり、完全未使用OOSではありません。改善案を同じ期間の利益だけで選ぶと再び過学習します。各案は固定したDevelopment、Validation、凍結Holdout、Forward Paperの順で評価し、結果がない段階では「改善済み」と表現しません。`,
    evidence: [
      evidence("同一期間調整", "YES", "negative"),
      evidence("完全未使用OOS", "NO", "negative"),
      evidence("現在の改善案", "REPLAY_REQUIRED", "neutral"),
    ],
  }));

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "tail-risk-critic",
    speakerName: "AI反対派 / Tail Risk",
    role: "tail_risk_critic",
    stance: "challenge",
    content: `初回100%とUltra90の70%移動は収益力の源泉になり得ますが、Gap、Slippage、連続シグナル、損失確定直後の再Entryを悪化させる可能性があります。子案は月利だけでなくMaxDD、最大連敗、1日損失、急変Stressで親と比較し、親の安全性を悪化させる案は却下します。`,
    evidence: [
      evidence("初回Notional", pct(strategy.initialNotionalFraction * 100), "negative"),
      evidence("Ultra90移動", pct(strategy.ultra90SwitchFraction * 100), "negative"),
      evidence("実売買", STRATEGY_CONFIG.MAIN_STRATEGY_REAL_TRADING_ENABLED ? "ENABLED" : "DISABLED", STRATEGY_CONFIG.MAIN_STRATEGY_REAL_TRADING_ENABLED ? "negative" : "positive"),
    ],
  }));

  messages.push(message({
    sequence: sequence++,
    startedAt,
    speakerId: "execution-critic",
    speakerName: "AI反対派 / Execution",
    role: "execution_critic",
    stance: "challenge",
    content: `今回の案は現行メインの実パラメータに直接紐づいています。ただし現時点のRepositoryには月利16.81%を再計算する完全な取引ログと固定リプレイ入力が保存されていません。よって汎用Perpetual GenomeのOOS数値を代用せず、StrategyEngineInputの時系列Snapshotまたは再現可能なBT Artifactを作ることが先です。`,
    evidence: [
      evidence("汎用Genome代用", "禁止", "positive"),
      evidence("再現BT Artifact", "未確認", "negative"),
      evidence("実コード親", strategy.id, "positive"),
    ],
  }));

  if (focus === "related_logic") {
    messages.push(message({
      sequence: sequence++,
      startedAt,
      speakerId: "sibling-logic-researcher",
      speakerName: "Sibling Logic Researcher",
      role: "researcher",
      stance: "proposal",
      content: `方向性が近い新ロジックは、メインを改造せず独立IDで開発します。${experiments.map((item) => `${item.id}: ${item.proposedValue}`).join(" / ")}。親の高選別Top-1思想だけを継承し、成績が悪くても${strategy.id}へ影響させません。`,
      evidence: experiments.map((item) => evidence(item.id, "独立研究", "neutral")),
    }));
  }

  const selectedExperiment = experiments[0];
  const decision = `${strategy.id}はメインのまま固定します。旧deep-c* Championは主研究へ継承しません。今回の最優先実験は${selectedExperiment.id}で、${selectedExperiment.parameterGroup}だけを変更した親子リプレイを作成します。${experiments.slice(1).map((item) => item.id).join("、") || "追加案なし"}は第2候補です。再現BTまたはForward Paper結果が出るまで採用・改善成功とは判定しません。`;
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
      evidence("最優先実験", selectedExperiment.id, "neutral"),
      evidence("旧Champion継承", "NO", "positive"),
      evidence("自動メイン変更", "禁止", "positive"),
    ],
  }));

  const discussion: ResearchDiscussionLog = {
    version: 1,
    id,
    cycle: Math.max(0, input.contextCycle),
    startedAt,
    completedAt,
    profile: input.profile,
    title: `Main Strategy Research #${iteration}：${strategy.id} / ${focusLabel(focus)}`,
    summary: `旧Championを継承せず、現行${strategy.id}本体を親として「${focusLabel(focus)}」を議論。${experiments.length}件を提案し、最優先は${selectedExperiment.id}。汎用Perpetual GenomeのOOS数値は使用していません。`,
    decision,
    methodology: `研究Program ${MAIN_STRATEGY_RESEARCH_PROGRAM_ID}。親はproduction main ${strategy.id}だけです。旧Champion Deep Stateは読み込まず、実コード定数、歴史参考値、Critic反論、実パラメータ変更案から議論を生成します。再現可能なリプレイ結果がない案はREPLAY_REQUIREDとし、OOSや月利を捏造しません。`,
    finalCandidates: 0,
    bestTrainMonthlyPct: null,
    bestOosMonthlyPct: null,
    bestOosDrawdownPct: null,
    bestWorstStressMonthlyPct: null,
    topStrategyIds: [strategy.id, ...experiments.map((item) => item.id)],
    messages,
  };

  const dedupedQueue = [...experiments, ...input.state.experimentQueue]
    .filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 30);
  const nextState: MainStrategyResearchProgramState = {
    version: MAIN_STRATEGY_RESEARCH_PROGRAM_VERSION,
    programId: MAIN_STRATEGY_RESEARCH_PROGRAM_ID,
    mainStrategyId: strategy.id,
    iteration,
    updatedAt: completedAt,
    completedFocuses: [...input.state.completedFocuses, focus].slice(-20),
    lastDiscussionId: id,
    experimentQueue: dedupedQueue,
    oldChampionStateInherited: false,
  };
  return { discussion, nextState };
}
