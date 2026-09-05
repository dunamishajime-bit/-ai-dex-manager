import { readRunnerHeartbeat, type RunnerHeartbeat, type RunnerId, type RunnerSafetyState } from "./disdex-runner-health";

export type RuntimeDisplayState = "LIVE" | "WAITING" | "FAIL_CLOSED" | "MANUAL_REVIEW" | "RECOVERING" | "要確認";
export type RuntimeStrategyId = "V12_X1.00_ALL" | "PENGU_DUAL_LS_V2_FINAL" | "V52_ASTER_ONLY" | "QUALITY102_CAUSAL_V1";

export interface StrategyRuntimeStatus {
  strategyId: RuntimeStrategyId;
  displayName: string;
  state: RuntimeDisplayState;
  serviceActive: boolean;
  heartbeatAt: number | null;
  runtimeSha: string | null;
  releaseShaMatch: boolean;
  safetyReason: string;
  lastDecision: string | null;
  recovery: { action: "NONE" | "RESTARTED" | "HELD_FAIL_CLOSED" | "EXHAUSTED"; attempts: number };
  gross: { strategyCap: number | null; cryptoCap: number | null; totalCap: number | null };
  symbols: Array<{ symbol: string; eligible: boolean; reason: string }>;
  quality102?: { selectorMode: "DERIVED_HIGH_VOL_ONLY"; historicalSelectorParity: false; brkLiveEnabled: false };
}

export interface RuntimeStatusOptions {
  healthRoot?: string;
  now?: number;
  expectedReleaseSha?: string;
  serviceActiveByRunner?: Partial<Record<RunnerId, boolean>>;
}

const RUNNERS: ReadonlyArray<{
  runnerId: RunnerId;
  strategyId: RuntimeStrategyId;
  displayName: string;
  filename: string;
}> = [
  { runnerId: "V12", strategyId: "V12_X1.00_ALL", displayName: "V12 X1.00 ALL", filename: "v12.json" },
  { runnerId: "PENGU_V8", strategyId: "PENGU_DUAL_LS_V2_FINAL", displayName: "PENGU Dual LS V2 Final", filename: "pengu-v8.json" },
  { runnerId: "V52", strategyId: "V52_ASTER_ONLY", displayName: "V52 ASTER Only", filename: "v52.json" },
  { runnerId: "QUALITY102_CAUSAL_V1", strategyId: "QUALITY102_CAUSAL_V1", displayName: "Quality102 Causal V1", filename: "quality102-causal-v1.json" },
];
const STALE_AFTER_MS = 5 * 60_000;
const Q102_META = { selectorMode: "DERIVED_HIGH_VOL_ONLY" as const, historicalSelectorParity: false as const, brkLiveEnabled: false as const };
const PUBLIC_MARKET_SYMBOL_RE = /^[A-Z0-9]{1,20}(?:USDT|USDC)$/;
function redactPublicText(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  return value
    .replace(/\b(?:private[_ -]?key|secret|token|api[_ -]?key|password|authorization|mnemonic|seed(?: phrase)?|wallet|credential|order[_ -]?id)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]")
    .replace(/\b(?:private|secret|token|key|password|order[_ -]?id)\b/gi, "[REDACTED]")
    .replace(/\b0x[a-f0-9]{40,}\b/gi, "[REDACTED]")
    .replace(/(?:[A-Za-z]:[\\/]|\/)[^\s,;]+/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512);
}

const safetyReason = (heartbeat: RunnerHeartbeat): string => redactPublicText(heartbeat.reason || `reported ${heartbeat.safetyState.toLowerCase()}`) || "status unavailable";

function isFresh(heartbeat: RunnerHeartbeat, now: number): boolean {
  return heartbeat.heartbeatAt <= now && now - heartbeat.heartbeatAt <= STALE_AFTER_MS;
}

function releaseMatches(heartbeat: RunnerHeartbeat, expectedReleaseSha?: string): boolean {
  return heartbeat.runtimeSha === heartbeat.expectedSha
    && (expectedReleaseSha === undefined || heartbeat.runtimeSha === expectedReleaseSha);
}

function publicState(heartbeat: RunnerHeartbeat, now: number, releaseShaMatch: boolean, serviceActive: boolean): RuntimeDisplayState {
  if (!isFresh(heartbeat, now) || !releaseShaMatch || !serviceActive) return "要確認";
  if (heartbeat.safetyState === "MANUAL_REVIEW") return "MANUAL_REVIEW";
  if (heartbeat.safetyState === "FAIL_CLOSED" || heartbeat.safetyState !== "LIVE" && heartbeat.safetyState !== "WAITING") return "FAIL_CLOSED";
  if (heartbeat.safetyState === "LIVE" && heartbeat.liveEnabled) return "LIVE";
  return "WAITING";
}

function recovery(heartbeat: RunnerHeartbeat, state: RuntimeDisplayState): StrategyRuntimeStatus["recovery"] {
  if (heartbeat.restartAttempts >= 3) return { action: "EXHAUSTED", attempts: heartbeat.restartAttempts };
  if (state === "MANUAL_REVIEW" || state === "FAIL_CLOSED") return { action: "HELD_FAIL_CLOSED", attempts: heartbeat.restartAttempts };
  if (heartbeat.restartAttempts > 0) return { action: "RESTARTED", attempts: heartbeat.restartAttempts };
  return { action: "NONE", attempts: 0 };
}

function unknownRecord(item: typeof RUNNERS[number], serviceActive: boolean, reason: string): StrategyRuntimeStatus {
  return {
    strategyId: item.strategyId,
    displayName: item.displayName,
    state: "要確認",
    serviceActive,
    heartbeatAt: null,
    runtimeSha: null,
    releaseShaMatch: false,
    safetyReason: reason,
    lastDecision: null,
    recovery: { action: "NONE", attempts: 0 },
    gross: { strategyCap: null, cryptoCap: null, totalCap: null },
    symbols: [],
    ...(item.runnerId === "QUALITY102_CAUSAL_V1" ? { quality102: Q102_META } : {}),
  };
}

export async function normalizeRuntimeStatus(options: RuntimeStatusOptions = {}): Promise<StrategyRuntimeStatus[]> {
  const healthRoot = options.healthRoot ?? process.env.DISDEX_RUNNER_HEALTH_ROOT ?? "/var/lib/disdex/runner-health/heartbeats";
  const now = options.now ?? Date.now();
  const expectedReleaseSha = options.expectedReleaseSha
    ?? process.env.DISDEX_EXPECTED_RUNTIME_SHA
    ?? process.env.DISDEX_RUNTIME_COMMIT_SHA;
  return Promise.all(RUNNERS.map(async (item) => {
    const observedServiceActive = options.serviceActiveByRunner?.[item.runnerId];
    try {
      const heartbeat = await readRunnerHeartbeat(`${healthRoot}/${item.filename}`);
      const serviceActive = observedServiceActive === true;
      if (heartbeat === undefined) return unknownRecord(item, serviceActive, "heartbeat unavailable");
      if (heartbeat.runnerId !== item.runnerId) throw new Error("heartbeat runnerId does not match allowlisted filename");
      const releaseShaMatch = isFresh(heartbeat, now) && releaseMatches(heartbeat, expectedReleaseSha);
      const state = publicState(heartbeat, now, releaseShaMatch, serviceActive);
      const symbolStatuses = heartbeat.symbols.map(({ symbol, eligible, reason }) => PUBLIC_MARKET_SYMBOL_RE.test(symbol)
        ? { symbol, eligible, reason: redactPublicText(reason) || "" }
        : { symbol: "[REDACTED]", eligible: false, reason: "symbol rejected" });
      return {
        strategyId: item.strategyId,
        displayName: item.displayName,
        state,
        serviceActive,
        heartbeatAt: heartbeat.heartbeatAt,
        runtimeSha: heartbeat.runtimeSha,
        releaseShaMatch,
        safetyReason: state === "要確認" && !isFresh(heartbeat, now) ? "heartbeat stale or future-dated" : state === "要確認" && !serviceActive ? "service inactive or unobserved" : state === "要確認" ? "release identity mismatch" : safetyReason(heartbeat),
        lastDecision: redactPublicText(heartbeat.lastDecision),
        recovery: recovery(heartbeat, state),
        gross: { strategyCap: heartbeat.caps.strategy, cryptoCap: heartbeat.caps.crypto, totalCap: heartbeat.caps.total },
        symbols: symbolStatuses,
        ...(item.runnerId === "QUALITY102_CAUSAL_V1" ? { quality102: Q102_META } : {}),
      };
    } catch {
      return unknownRecord(item, observedServiceActive ?? false, "heartbeat malformed or unreadable");
    }
  }));
}
