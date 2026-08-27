export type UiDecisionState = "FIRE" | "SIGNAL" | "WAITING" | "WATCH" | "BLOCKED" | "OFF" | "ERROR";
export type UiRuntimeStatus = "LIVE" | "STALE" | "UNAVAILABLE" | "UNCONFIRMED";

type RuntimeUnitInput = {
  id: string;
  label: string;
  status: UiRuntimeStatus;
  reason?: string;
  updatedAt?: number;
};

type TraceStepInput = {
  key: string;
  label: string;
  state: "pass" | "blocked" | "pending" | "unknown";
  detail: string;
};

type TraceInput = {
  currentStage: string;
  currentStageLabel: string;
  summary: string;
  nextAction: string;
  steps: TraceStepInput[];
};

type CandidateInput = {
  symbol?: string;
  side?: string;
  rank?: number;
  candidateRank?: number;
  score?: number;
};

type SignalGateInput = {
  status: "pass" | "blocked" | "unknown";
  detail: string;
};

type V12Input = {
  decision?: {
    symbol?: string;
    side?: string;
    rank?: number;
    score?: number;
    selectionConfirmed?: boolean;
    candidates?: CandidateInput[];
    signalGate?: SignalGateInput;
  } | null;
  executionTrace?: TraceInput;
};

type PenguInput = {
  status: UiRuntimeStatus;
  latestSignal?: {
    side?: number;
    reason?: string;
    decision?: {
      longEligible?: boolean;
      shortEligible?: boolean;
      active?: boolean;
    };
  };
  executionTrace?: TraceInput;
};

type V52RowInput = {
  symbol?: string;
  candidateRank?: number;
  orderBlockedReason?: string | null;
  orderResult?: string;
  orderSendAttempted?: boolean;
};

type V52WindowInput = {
  candidates?: CandidateInput[];
  entries?: V52RowInput[];
  rejections?: V52RowInput[];
};

type V52Input = {
  status: UiRuntimeStatus;
  windows?: V52WindowInput[];
};

export type DecisionViewInput = {
  runtime: {
    checkedAt?: string;
    units: RuntimeUnitInput[];
  };
  v12Observability?: V12Input;
  penguRuntime?: PenguInput;
  v52Top2Observability?: V52Input;
  portfolio?: {
    positions?: Array<{ symbol: string; side?: string }>;
  };
};

export type StrategyOverview = {
  id: "V12" | "PENGU" | "V52";
  label: string;
  market: "CRYPTO" | "EQUITY";
  runtimeStatus: UiRuntimeStatus;
  state: UiDecisionState;
  stateLabel: string;
  stageLabel: string;
  detail: string;
  blocker?: string;
  observedCandidates: number | null;
  eligibleDirections: number | null;
  positionCount: number | null;
};

export type AttentionItem = {
  key: string;
  strategyId: "V12" | "PENGU" | "V52";
  label: string;
  market: "CRYPTO" | "EQUITY";
  symbol: string;
  side: "LONG" | "SHORT" | "WAIT";
  state: UiDecisionState;
  stageLabel: string;
  blocker?: string;
  rank?: number;
  detail: string;
};

export type PenguDirectionOverview = {
  direction: "LONG" | "SHORT";
  state: "SIGNAL" | "OFF" | "ERROR";
  stageLabel: string;
  blocker?: string;
  detail: string;
};

export type DecisionViewModel = {
  systemStatus: "LIVE / HEALTHY" | "DEGRADED" | "FAIL CLOSED";
  strategyCards: StrategyOverview[];
  attentionItems: AttentionItem[];
  penguDirections: PenguDirectionOverview[];
  checkedAt?: string;
};

function runtimeUnit(units: RuntimeUnitInput[], id: string): RuntimeUnitInput | undefined {
  return units.find((unit) => unit.id === id);
}

function firstBlocker(trace?: TraceInput) {
  return trace?.steps.find((step) => step.state === "blocked");
}

function traceState(trace?: TraceInput): UiDecisionState {
  if (!trace || trace.currentStage === "unavailable") return "ERROR";
  if (trace.currentStage === "filled" || trace.currentStage === "filled-history") return "FIRE";
  if (trace.currentStage === "pending") return "WAITING";
  if (trace.steps.some((step) => step.state === "blocked")) return "BLOCKED";
  if (trace.currentStage.includes("signal-eligible")) return "SIGNAL";
  return "WATCH";
}

function stateLabel(state: UiDecisionState) {
  return state === "FIRE" ? "FIRE" : state === "SIGNAL" ? "SIGNAL" : state === "WAITING" ? "WAITING" : state === "BLOCKED" ? "BLOCKED" : state === "ERROR" ? "ERROR" : state === "OFF" ? "OFF" : "WATCH";
}

function side(value?: string | number): "LONG" | "SHORT" | "WAIT" {
  if (value === -1 || String(value || "").toUpperCase() === "SHORT") return "SHORT";
  if (value === 1 || String(value || "").toUpperCase() === "LONG") return "LONG";
  return "WAIT";
}

function positionCount(positions: NonNullable<DecisionViewInput["portfolio"]>["positions"], symbols: string[]) {
  if (!positions) return null;
  const symbolSet = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  return positions.filter((position) => symbolSet.has(position.symbol.toUpperCase())).length;
}

function runtimeStatus(unit: RuntimeUnitInput | undefined): UiRuntimeStatus {
  return unit?.status || "UNAVAILABLE";
}

function overviewState(runtime: UiRuntimeStatus, trace?: TraceInput): UiDecisionState {
  if (runtime === "UNAVAILABLE" || runtime === "UNCONFIRMED") return "ERROR";
  if (runtime === "STALE") return "ERROR";
  return traceState(trace);
}

function makeAttentionItem(input: Omit<AttentionItem, "stateLabel">): AttentionItem {
  return input;
}

function v52AttentionItems(details: V52Input | undefined) {
  if (!details?.windows) return [] as AttentionItem[];
  const items: AttentionItem[] = [];
  for (const window of details.windows) {
    for (const candidate of window.candidates || []) {
      const symbol = candidate.symbol || "未取得";
      const rejection = (window.rejections || []).find((row) => row.symbol === symbol);
      const entry = (window.entries || []).find((row) => row.symbol === symbol);
      const blocked = rejection?.orderBlockedReason || undefined;
      items.push(makeAttentionItem({
        key: `V52:${symbol}:${candidate.candidateRank ?? "?"}`,
        strategyId: "V52",
        label: "V52",
        market: "EQUITY",
        symbol,
        side: "WAIT",
        state: blocked ? "BLOCKED" : entry ? "SIGNAL" : "WATCH",
        stageLabel: blocked ? "発注Gateで停止" : entry ? "発注判断記録あり" : "候補選定",
        blocker: blocked,
        rank: candidate.candidateRank,
        detail: blocked ? `V52候補Rank${candidate.candidateRank ?? "—"}。${blocked}` : `V52株式候補Rank${candidate.candidateRank ?? "—"}。`,
      }));
    }
  }
  return items;
}

function priority(state: UiDecisionState) {
  return state === "FIRE" ? 0 : state === "SIGNAL" ? 1 : state === "WAITING" ? 2 : state === "BLOCKED" ? 3 : state === "WATCH" ? 4 : 5;
}

export function buildDecisionViewModel(input: DecisionViewInput): DecisionViewModel {
  const v12Unit = runtimeUnit(input.runtime.units, "V12_X1.00_ALL");
  const penguUnit = runtimeUnit(input.runtime.units, "PENGU_DUAL_LS_V2_FINAL");
  const v52Unit = runtimeUnit(input.runtime.units, "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96");
  const v12 = input.v12Observability;
  const pengu = input.penguRuntime;
  const v52 = input.v52Top2Observability;
  const v12Trace = v12?.executionTrace;
  const penguTrace = pengu?.executionTrace;
  const v52Items = v52AttentionItems(v52);
  const v12Symbol = v12?.decision?.symbol || "未取得";
  const v12Side = side(v12?.decision?.side);
  const v12Candidates = v12?.decision?.candidates;
  const v12Blocker = firstBlocker(v12Trace);
  const v12Item = v12?.decision ? makeAttentionItem({
    key: `V12:${v12Symbol}:${v12Side}`,
    strategyId: "V12",
    label: "V12",
    market: "CRYPTO",
    symbol: v12Symbol,
    side: v12Side,
    state: overviewState(runtimeStatus(v12Unit), v12Trace),
    stageLabel: v12Trace?.currentStageLabel || "候補データ未取得",
    blocker: v12Blocker ? `${v12Blocker.label}: ${v12Blocker.detail}` : undefined,
    rank: v12?.decision?.rank,
    detail: v12Trace?.summary || "V12の実Runner判定データを取得できません。",
  }) : null;
  const penguSignal = pengu?.latestSignal;
  const penguSide = side(penguSignal?.side);
  const penguBlocker = firstBlocker(penguTrace);
  const penguItem = penguSignal ? makeAttentionItem({
    key: `PENGU:${penguSide}`,
    strategyId: "PENGU",
    label: "PENGU V2",
    market: "CRYPTO",
    symbol: "PENGUUSDT",
    side: penguSide,
    state: overviewState(runtimeStatus(penguUnit), penguTrace),
    stageLabel: penguTrace?.currentStageLabel || "判定データ未取得",
    blocker: penguBlocker ? `${penguBlocker.label}: ${penguBlocker.detail}` : undefined,
    detail: penguTrace?.summary || penguSignal.reason || "PENGUの実Runner判定データを取得できません。",
  }) : null;

  const cryptoSymbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT", "INJUSDT", "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT", "AAVEUSDT", "NEARUSDT", "PENGUUSDT"];
  const equitySymbols = ["AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT"];
  const v12State = overviewState(runtimeStatus(v12Unit), v12Trace);
  const penguState = overviewState(runtimeStatus(penguUnit), penguTrace);
  const v52State = v52Items.some((item) => item.state === "BLOCKED") ? "BLOCKED" : v52Items.some((item) => item.state === "SIGNAL") ? "SIGNAL" : v52Items.length ? "WATCH" : runtimeStatus(v52Unit) === "LIVE" ? "WATCH" : "ERROR";
  const strategyCards: StrategyOverview[] = [
    {
      id: "V12",
      label: "V12 X1.00 ALL",
      market: "CRYPTO",
      runtimeStatus: runtimeStatus(v12Unit),
      state: v12State,
      stateLabel: stateLabel(v12State),
      stageLabel: v12Trace?.currentStageLabel || "候補データ未取得",
      detail: v12Trace?.summary || v12Unit?.reason || "V12の実Runner判定データを取得できません。",
      blocker: v12Blocker ? `${v12Blocker.label}: ${v12Blocker.detail}` : undefined,
      observedCandidates: v12Candidates?.length ?? null,
      eligibleDirections: v12?.decision?.selectionConfirmed === true ? 1 : v12?.decision ? 0 : null,
      positionCount: positionCount(input.portfolio?.positions, cryptoSymbols.filter((symbol) => symbol !== "PENGUUSDT")),
    },
    {
      id: "PENGU",
      label: "PENGU Dual LS V2 / Short V20",
      market: "CRYPTO",
      runtimeStatus: runtimeStatus(penguUnit),
      state: penguState,
      stateLabel: stateLabel(penguState),
      stageLabel: penguTrace?.currentStageLabel || "判定データ未取得",
      detail: penguTrace?.summary || penguUnit?.reason || "PENGUの実Runner判定データを取得できません。",
      blocker: penguBlocker ? `${penguBlocker.label}: ${penguBlocker.detail}` : undefined,
      observedCandidates: penguSignal ? 1 : null,
      eligibleDirections: penguSignal?.decision ? Number(penguSignal.decision.longEligible === true) + Number(penguSignal.decision.shortEligible === true) : null,
      positionCount: positionCount(input.portfolio?.positions, ["PENGUUSDT"]),
    },
    {
      id: "V52",
      label: "V52 Top2",
      market: "EQUITY",
      runtimeStatus: runtimeStatus(v52Unit),
      state: v52State,
      stateLabel: stateLabel(v52State),
      stageLabel: v52Items[0]?.stageLabel || "候補データ未取得",
      detail: v52Items[0]?.detail || v52Unit?.reason || "V52の実Runner判定データを取得できません。",
      blocker: v52Items[0]?.blocker,
      observedCandidates: v52Items.length || (v52 ? 0 : null),
      eligibleDirections: null,
      positionCount: positionCount(input.portfolio?.positions, equitySymbols),
    },
  ];

  const attentionItems = [v12Item, penguItem, ...v52Items]
    .filter((item): item is AttentionItem => Boolean(item))
    .sort((left, right) => priority(left.state) - priority(right.state) || (left.rank ?? 99) - (right.rank ?? 99))
    .slice(0, 3);

  const liveStatuses = input.runtime.units.map((unit) => unit.status);
  const failClosed = liveStatuses.includes("UNAVAILABLE") || liveStatuses.includes("UNCONFIRMED") || pengu?.latestSignal === undefined && pengu?.status === "UNAVAILABLE";
  const degraded = liveStatuses.includes("STALE") || liveStatuses.some((status) => status !== "LIVE");
  const systemStatus = failClosed ? "FAIL CLOSED" : degraded ? "DEGRADED" : "LIVE / HEALTHY";

  const longEligible = penguSignal?.decision?.longEligible;
  const shortEligible = penguSignal?.decision?.shortEligible;
  const directionBlocker = penguBlocker ? `${penguBlocker.label}: ${penguBlocker.detail}` : penguSignal?.reason;
  const penguDirections: PenguDirectionOverview[] = [
    { direction: "LONG", state: longEligible === true ? "SIGNAL" : longEligible === false ? "OFF" : "ERROR", stageLabel: longEligible === true ? penguTrace?.currentStageLabel || "Signal成立" : "条件未成立", blocker: longEligible === false ? directionBlocker : undefined, detail: longEligible === true ? "PENGU runnerのLong条件が成立しています。" : "PENGU runnerからLong成立を確認できません。" },
    { direction: "SHORT", state: shortEligible === true ? "SIGNAL" : shortEligible === false ? "OFF" : "ERROR", stageLabel: shortEligible === true ? penguTrace?.currentStageLabel || "Signal成立" : "条件未成立", blocker: shortEligible === false ? directionBlocker : undefined, detail: shortEligible === true ? "PENGU runnerのShort条件が成立しています。" : "PENGU runnerからShort成立を確認できません。" },
  ];

  return { systemStatus, strategyCards, attentionItems, penguDirections, checkedAt: input.runtime.checkedAt };
}
