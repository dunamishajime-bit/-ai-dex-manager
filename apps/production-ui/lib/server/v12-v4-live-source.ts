import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

type Json = Record<string, unknown>;

const DEFAULT_HEARTBEAT_PATHS = [
  "/var/lib/disdex/runner-health/heartbeats/v12-v4.json",
  "/var/lib/disdex/v12-v4/heartbeat.json",
];
const DEFAULT_DECISION_PATHS = [
  "/var/lib/disdex/v12-v4/realtime-decision.json",
];
const MAX_BYTES = 512 * 1024;
const MAX_HEARTBEAT_AGE_MS = 3 * 60 * 1000;
const MAX_DECISION_AGE_MS = 3 * 60 * 60 * 1000;

export type V12V4LiveSource = {
  available: boolean;
  fresh: boolean;
  heartbeatPath?: string;
  decisionPath?: string;
  heartbeat: Json | null;
  decision: Json | null;
  runtimeSha?: string;
  expectedSha?: string;
  policyId?: string;
  operationMode?: string;
  status?: string;
  mode?: string;
  liveEnabled?: boolean;
  orderPermission?: string;
  newOrdersAllowed?: boolean;
  safetyState?: string;
  mainPid?: number;
  nRestarts?: number;
  heartbeatAt?: number;
  decisionTs?: number;
  updatedAt?: number;
  capturedAtMs?: number;
  candidateCount?: number;
  filteredCount?: number;
  sourceCount?: number;
  errors: string[];
};

function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

function number(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function uniquePaths(paths: Array<string | undefined>) {
  return [...new Set(paths.map(value => String(value || "").trim()).filter(path => isAbsolute(path)))];
}

async function readJsonFromCandidates(paths: string[]) {
  const errors: string[] = [];
  for (const path of paths) {
    try {
      const text = await readFile(path, "utf8");
      if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
        errors.push(`${path}:JSON_TOO_LARGE`);
        continue;
      }
      const value = object(JSON.parse(text));
      if (!value) {
        errors.push(`${path}:JSON_OBJECT_REQUIRED`);
        continue;
      }
      // A fallback path is intentionally supported during release transitions;
      // a failed earlier candidate is not an error once a valid source has
      // been read.
      return { value, path, errors: [] };
    } catch (error) {
      errors.push(`${path}:${error instanceof Error ? error.message : "READ_FAILED"}`);
    }
  }
  return { value: null, path: undefined, errors };
}

export function isV12V4Heartbeat(value: unknown): value is Json {
  const row = object(value);
  return row?.schema === "disdex-v12-v4-runner-heartbeat/v1" && row.runnerId === "V12_V4";
}

export function adaptV12V4DecisionToState(source: V12V4LiveSource): Json | null {
  const decision = source.decision;
  if (!decision) return null;
  const observed = Array.isArray(decision.observedCandidates) ? decision.observedCandidates : [];
  const candidates = observed
    .filter(value => object(value))
    .map(value => {
      const row = object(value)!;
      return {
        symbol: typeof row.symbol === "string" ? row.symbol : undefined,
        side: typeof row.side === "string" ? row.side : undefined,
        rank: number(row.rank),
        score: number(row.score),
        momentum: number(row.momentum),
        volumeRatio: number(row.volumeRatio),
        volatility: number(row.volatility),
        atr: number(row.atr),
        signalEligible: typeof row.signalEligible === "boolean" ? row.signalEligible : undefined,
        signalReason: typeof row.signalReason === "string" ? row.signalReason : undefined,
        entryGateReason: typeof row.entryGateReason === "string" ? row.entryGateReason : undefined,
      };
    });
  const selected = candidates.find(candidate => candidate.signalEligible === true);
  const updatedAt = source.updatedAt ?? source.capturedAtMs ?? source.heartbeatAt;
  return {
    schema: "v12-v4-live-decision/v1",
    strategyId: "V12_V4",
    architecture: "MULTILOGIC_V4",
    mode: source.mode || "LIVE",
    runtimeCommitSha: source.runtimeSha,
    updatedAt,
    lastReferenceTs: source.decisionTs,
    referenceTs: source.decisionTs,
    btcRegime: typeof decision.btcRegime === "string" ? decision.btcRegime : "UNKNOWN",
    regime: typeof decision.btcRegime === "string" ? decision.btcRegime : "UNKNOWN",
    symbol: selected?.symbol,
    side: selected?.side,
    rank: selected?.rank,
    score: selected?.score,
    momentum: selected?.momentum,
    volumeRatio: selected?.volumeRatio,
    reason: typeof decision.reason === "string" ? decision.reason : undefined,
    candidates,
    observedCandidates: candidates,
    nativeSources: Array.isArray(decision.nativeSources) ? decision.nativeSources : [],
    candidateCount: number(decision.candidateCount) ?? candidates.length,
    filteredCount: number(decision.filteredCount) ?? 0,
    sourceCount: number(decision.sourceCount) ?? 0,
    orderEnabled: decision.orderEnabled === true,
    realOrderEnabledV4: number(decision.realOrderEnabledV4) ?? 0,
    tradingMutation: number(decision.tradingMutation) ?? 0,
    operationMode: source.operationMode,
    status: source.status,
    stale: false,
  };
}

export function adaptV12V4HeartbeatToState(source: V12V4LiveSource): Json | null {
  const heartbeat = source.heartbeat;
  if (!heartbeat) return null;
  return {
    schema: heartbeat.schema,
    strategyId: "V12_V4",
    mode: source.mode || "LIVE",
    runtimeCommitSha: source.runtimeSha,
    updatedAt: source.heartbeatAt,
    lastReferenceTs: source.decisionTs,
    manualReview: heartbeat.manualReview,
    pending: heartbeat.pending,
    active: heartbeat.active,
    killSwitch: heartbeat.killSwitch,
    orderPermission: source.orderPermission,
    newOrdersAllowed: source.newOrdersAllowed,
    safetyState: source.safetyState,
  };
}

export async function loadV12V4LiveSource(options: {
  heartbeatPath?: string;
  decisionPath?: string;
  now?: number;
} = {}): Promise<V12V4LiveSource> {
  const heartbeatPaths = uniquePaths([
    options.heartbeatPath,
    process.env.V12_V4_HEARTBEAT_PATH,
    ...DEFAULT_HEARTBEAT_PATHS,
  ]);
  const decisionPaths = uniquePaths([
    options.decisionPath,
    process.env.V12_V4_REALTIME_DECISION_PATH,
    process.env.DISDEX_V12_V4_REALTIME_DECISION_PATH,
    ...DEFAULT_DECISION_PATHS,
  ]);
  const [heartbeatResult, decisionResult] = await Promise.all([
    readJsonFromCandidates(heartbeatPaths),
    readJsonFromCandidates(decisionPaths),
  ]);
  const heartbeat = isV12V4Heartbeat(heartbeatResult.value) ? heartbeatResult.value : null;
  const decision = decisionResult.value;
  const runtimeSha = typeof heartbeat?.runtimeSha === "string"
    ? heartbeat.runtimeSha.trim()
    : typeof decision?.runtimeSha === "string"
      ? decision.runtimeSha.trim()
      : undefined;
  const expectedSha = typeof heartbeat?.expectedSha === "string" ? heartbeat.expectedSha.trim() : runtimeSha;
  const heartbeatAt = number(heartbeat?.heartbeatAt);
  const decisionTs = number(decision?.decisionTs);
  const updatedAt = number(decision?.updatedAt);
  const capturedAtMs = number(decision?.capturedAtMs);
  const now = options.now ?? Date.now();
  const heartbeatFresh = heartbeatAt !== undefined && now - heartbeatAt >= 0 && now - heartbeatAt <= MAX_HEARTBEAT_AGE_MS;
  const decisionTimestamp = updatedAt ?? capturedAtMs;
  const decisionFresh = decisionTimestamp === undefined || (now - decisionTimestamp >= 0 && now - decisionTimestamp <= MAX_DECISION_AGE_MS);
  const fresh = Boolean(heartbeat && heartbeatFresh && decisionFresh);
  const errors = [...heartbeatResult.errors, ...decisionResult.errors];
  if (heartbeatResult.value && !heartbeat) errors.push(`${heartbeatResult.path || "V4_HEARTBEAT"}:V4_HEARTBEAT_SCHEMA_MISMATCH`);
  return {
    available: Boolean(heartbeat),
    fresh,
    heartbeatPath: heartbeatResult.path,
    decisionPath: decisionResult.path,
    heartbeat,
    decision,
    runtimeSha,
    expectedSha,
    policyId: typeof decision?.policyId === "string" ? decision.policyId : undefined,
    operationMode: typeof decision?.operationMode === "string" ? decision.operationMode : typeof heartbeat?.v12v4 === "object" && heartbeat.v12v4 ? String(object(heartbeat.v12v4)?.operationMode || "") : undefined,
    status: typeof decision?.status === "string" ? decision.status : undefined,
    mode: typeof heartbeat?.mode === "string" ? heartbeat.mode : undefined,
    liveEnabled: typeof heartbeat?.liveEnabled === "boolean" ? heartbeat.liveEnabled : undefined,
    orderPermission: typeof heartbeat?.orderPermission === "string" ? heartbeat.orderPermission : undefined,
    newOrdersAllowed: typeof heartbeat?.newOrdersAllowed === "boolean" ? heartbeat.newOrdersAllowed : undefined,
    safetyState: typeof heartbeat?.safetyState === "string" ? heartbeat.safetyState : undefined,
    mainPid: number(heartbeat?.mainPid),
    nRestarts: number(heartbeat?.nRestarts),
    heartbeatAt,
    decisionTs,
    updatedAt,
    capturedAtMs,
    candidateCount: number(decision?.candidateCount),
    filteredCount: number(decision?.filteredCount),
    sourceCount: number(decision?.sourceCount),
    errors,
  };
}
