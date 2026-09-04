import { mkdir, open, readFile, rename, rm, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";

export type RunnerId = "V12" | "PENGU_V8" | "V52" | "QUALITY102_CAUSAL_V1";
export type RunnerSafetyState = "LIVE" | "WAITING" | "FAIL_CLOSED" | "KILL_SWITCH" | "DAILY_LOSS_LATCH" | "STALE_DATA" | "RECONCILIATION_FAILED" | "MANUAL_REVIEW" | "UNKNOWN";
export interface RunnerSymbolStatus { symbol: string; eligible: boolean; reason: string; }
export interface RunnerHeartbeat {
  schema: "disdex-runner-heartbeat/v1";
  runnerId: RunnerId;
  serviceUnit: string;
  runtimeSha: string;
  expectedSha: string;
  workingDirectory: string;
  mode: string;
  liveEnabled: boolean;
  safetyState: RunnerSafetyState;
  heartbeatAt: number;
  lastTickAt: number | null;
  lastReconciliationAt: number | null;
  lastDecision: string | null;
  reason: string;
  symbols: RunnerSymbolStatus[];
  caps: { strategy: number | null; crypto: number | null; total: number | null };
  restartAttempts: number;
  updatedAt: number;
  quality102?: { selectorMode: "DERIVED_HIGH_VOL_ONLY"; historicalSelectorParity: false; brkLiveEnabled: false };
}
export interface RecoveryObservation {
  now: number;
  heartbeat?: RunnerHeartbeat;
  serviceActive: boolean;
  mainPid: number;
  processCwd?: string;
  processCommand?: string;
  expectedCwd: string;
  expectedSha?: string;
  restartAttempts: number;
  intentionalStop?: boolean;
  sharedUncertainty?: boolean;
}
export type RecoveryAction = "NOOP" | "RESTART" | "HOLD_FAIL_CLOSED" | "RECOVERY_EXHAUSTED";
export interface RecoveryDecision {
  action: RecoveryAction;
  reason: string;
  affectsOtherRunners: boolean;
  restartAuthorized: boolean;
  tradingEffects: { ordersSent: number; cancelSent: number; positionChangesSent: number };
  nextAttempt?: number;
}

const STALE_AFTER_MS = 5 * 60_000;
const SAFE_STATES = new Set<RunnerSafetyState>(["LIVE", "WAITING", "FAIL_CLOSED"]);
const LATCHED_STATES = new Set<RunnerSafetyState>(["KILL_SWITCH", "DAILY_LOSS_LATCH", "STALE_DATA", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "UNKNOWN"]);
const SHA_RE = /^[0-9a-f]{40}$/;
const ZERO_EFFECTS = { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 };

/** Convert runner result/status text into a conservative operational state. */
export function classifyRunnerSafetyState(status: string, reason: string, liveEnabled: boolean): RunnerSafetyState {
  const statusText = String(status || "").trim().toLowerCase();
  const normalized = `${statusText} ${String(reason || "").trim().toLowerCase()}`.replace(/[_-]+/g, " ");
  if (/kill\s+switch/.test(normalized)) return "KILL_SWITCH";
  if (/daily\s+loss|daily\s+latch/.test(normalized)) return "DAILY_LOSS_LATCH";
  if (/stale|invalid|freshness|\bdata\b/.test(normalized)) return "STALE_DATA";
  if (/reconciliation|unmanaged|position\s+(?:mismatch|disagreement)|state\s+(?:mismatch|invalid)/.test(normalized)) return "RECONCILIATION_FAILED";
  if (statusText === "manual review" || /manual\s+review|unresolved|ambiguous/.test(normalized)) return "MANUAL_REVIEW";
  if (/shared\s+(?:crypto\s+)?daily\s+risk|shared\s+risk|margin|gross|capacity|unavailable|missing|safety\s+hold/.test(normalized)) return "FAIL_CLOSED";
  if (statusText === "fatal" || statusText === "unknown" || /uncaught|startup\s+(?:error|failed)/.test(normalized)) return "UNKNOWN";
  if (/(?:failed|failure|error|exception|crash|blocked)/.test(statusText) || /\b(?:failed|failure|error|exception|crash)\b/.test(normalized)) return "FAIL_CLOSED";
  return liveEnabled ? "LIVE" : "WAITING";
}

export class RunnerHeartbeatError extends Error {
  readonly code = "INVALID_RUNNER_HEARTBEAT";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RunnerHeartbeatError";
  }
}

function decision(action: RecoveryAction, reason: string, affectsOtherRunners: boolean, nextAttempt?: number): RecoveryDecision {
  return { action, reason, affectsOtherRunners, restartAuthorized: action === "RESTART", tradingEffects: { ...ZERO_EFFECTS }, ...(nextAttempt === undefined ? {} : { nextAttempt }) };
}

export function decideRecovery(observation: RecoveryObservation): RecoveryDecision {
  const heartbeat = observation.heartbeat;
  const shared = observation.sharedUncertainty === true;
  if (shared) return decision("HOLD_FAIL_CLOSED", "shared uncertainty", true);
  if (heartbeat && LATCHED_STATES.has(heartbeat.safetyState)) {
    return decision("HOLD_FAIL_CLOSED", `safety state ${heartbeat.safetyState}`, false);
  }
  if (observation.intentionalStop) return decision("HOLD_FAIL_CLOSED", "intentional stop", false);
  if (heartbeat && !SAFE_STATES.has(heartbeat.safetyState)) {
    return decision("HOLD_FAIL_CLOSED", `safety state ${heartbeat.safetyState}`, false);
  }
  if (observation.restartAttempts >= 3) {
    return decision("RECOVERY_EXHAUSTED", "restart budget exhausted", false);
  }

  const heartbeatFresh = heartbeat !== undefined
    && Number.isFinite(heartbeat.heartbeatAt)
    && heartbeat.heartbeatAt <= observation.now
    && observation.now - heartbeat.heartbeatAt <= STALE_AFTER_MS;
  const cwdMatches = heartbeatFresh
    && heartbeat!.workingDirectory === observation.expectedCwd
    && (observation.processCwd === undefined || observation.processCwd === observation.expectedCwd);
  const shaMatches = heartbeatFresh
    && (observation.expectedSha === undefined || (heartbeat!.runtimeSha === observation.expectedSha && heartbeat!.expectedSha === observation.expectedSha));
  const healthy = observation.serviceActive && observation.mainPid > 0 && cwdMatches && shaMatches;
  if (healthy) return decision("NOOP", "heartbeat and service healthy", false);
  return decision("RESTART", "heartbeat or service unhealthy", false, observation.restartAttempts + 1);
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new RunnerHeartbeatError("heartbeat must be an object");
}
function requiredString(record: Record<string, unknown>, key: string): string {
  if (typeof record[key] !== "string" || record[key].length === 0) throw new RunnerHeartbeatError(`heartbeat.${key} must be a non-empty string`);
  return record[key] as string;
}
function timestamp(record: Record<string, unknown>, key: string, nullable = false): number | null {
  const value = record[key];
  if (nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Date.now()) throw new RunnerHeartbeatError(`heartbeat.${key} is invalid or in the future`);
  return value;
}

function validateHeartbeat(value: unknown): RunnerHeartbeat {
  assertRecord(value);
  if (value.schema !== "disdex-runner-heartbeat/v1") throw new RunnerHeartbeatError("unsupported heartbeat schema");
  const runnerIds: RunnerId[] = ["V12", "PENGU_V8", "V52", "QUALITY102_CAUSAL_V1"];
  const safetyStates: RunnerSafetyState[] = ["LIVE", "WAITING", "FAIL_CLOSED", "KILL_SWITCH", "DAILY_LOSS_LATCH", "STALE_DATA", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "UNKNOWN"];
  if (!runnerIds.includes(value.runnerId as RunnerId)) throw new RunnerHeartbeatError("invalid runnerId");
  if (!safetyStates.includes(value.safetyState as RunnerSafetyState)) throw new RunnerHeartbeatError("invalid safetyState");
  const runtimeSha = requiredString(value, "runtimeSha");
  const expectedSha = requiredString(value, "expectedSha");
  if (!SHA_RE.test(runtimeSha) || !SHA_RE.test(expectedSha)) throw new RunnerHeartbeatError("invalid SHA");
  for (const key of ["serviceUnit", "workingDirectory", "mode", "reason"] as const) requiredString(value, key);
  if (typeof value.liveEnabled !== "boolean" || typeof value.restartAttempts !== "number" || !Number.isInteger(value.restartAttempts) || value.restartAttempts < 0) throw new RunnerHeartbeatError("invalid heartbeat flags or restartAttempts");
  const heartbeatAt = timestamp(value, "heartbeatAt") as number;
  const updatedAt = timestamp(value, "updatedAt") as number;
  const lastTickAt = timestamp(value, "lastTickAt", true);
  const lastReconciliationAt = timestamp(value, "lastReconciliationAt", true);
  if (value.lastDecision !== null && typeof value.lastDecision !== "string") throw new RunnerHeartbeatError("heartbeat.lastDecision must be string or null");
  if (!Array.isArray(value.symbols) || !value.symbols.every((s) => {
    if (s === null || typeof s !== "object") return false;
    const symbol = s as Record<string, unknown>;
    return typeof symbol.symbol === "string" && typeof symbol.eligible === "boolean" && typeof symbol.reason === "string";
  })) throw new RunnerHeartbeatError("invalid symbols");
  assertRecord(value.caps);
  for (const key of ["strategy", "crypto", "total"] as const) {
    const cap = value.caps[key];
    if (cap !== null && (typeof cap !== "number" || !Number.isFinite(cap) || cap < 0)) throw new RunnerHeartbeatError("invalid cap");
  }
  if (value.quality102 !== undefined) {
    assertRecord(value.quality102);
    if (value.quality102.selectorMode !== "DERIVED_HIGH_VOL_ONLY" || value.quality102.historicalSelectorParity !== false || value.quality102.brkLiveEnabled !== false) throw new RunnerHeartbeatError("invalid quality102 contract");
  }
  return value as unknown as RunnerHeartbeat;
}

export async function writeRunnerHeartbeat(path: string, heartbeat: RunnerHeartbeat): Promise<void> {
  validateHeartbeat(heartbeat);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = join(directory, `.${path.split(/[\\/]/).pop() ?? "heartbeat"}.${process.pid}.${Date.now()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(heartbeat)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function readRunnerHeartbeat(path: string): Promise<RunnerHeartbeat | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return validateHeartbeat(JSON.parse(raw));
  } catch (error) {
    if (error instanceof RunnerHeartbeatError) throw error;
    throw new RunnerHeartbeatError("malformed heartbeat", { cause: error });
  }
}
