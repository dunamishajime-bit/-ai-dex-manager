import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

const V12_STRATEGY_ID = "V12_X1.00_ALL" as const;
const MAX_CANDIDATES = 14;
const MAX_TEXT_LENGTH = 512;

type JsonObject = Record<string, unknown>;
type V12Side = "LONG" | "SHORT" | "WAIT";
type V12Regime = "LONG" | "SHORT" | "NEUTRAL";

export type V12DecisionCandidateSnapshot = {
  symbol: string;
  side?: V12Side;
  rank?: number;
  score?: number;
  momentum?: number;
  volumeRatio?: number;
};

export type V12DecisionSnapshot = {
  schema: "v12-decision-snapshot/v1";
  strategyId: typeof V12_STRATEGY_ID;
  selectedAt: string;
  referenceTs?: number;
  entryTs?: number;
  symbol?: string;
  side?: V12Side;
  rank?: number;
  score?: number;
  momentum?: number;
  volumeRatio?: number;
  regime?: V12Regime;
  btcRegime?: V12Regime;
  requestedGross?: number;
  rationale?: string;
  candidates: V12DecisionCandidateSnapshot[];
};

export type V12DecisionSnapshotInput = {
  strategyId?: unknown;
  selectedAt?: unknown;
  referenceTs?: unknown;
  entryTs?: unknown;
  symbol?: unknown;
  side?: unknown;
  rank?: unknown;
  score?: unknown;
  momentum?: unknown;
  volumeRatio?: unknown;
  regime?: unknown;
  btcRegime?: unknown;
  requestedGross?: unknown;
  rationale?: unknown;
  reason?: unknown;
  candidates: readonly unknown[];
};

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, MAX_TEXT_LENGTH) : undefined;
}

function side(value: unknown): V12Side | undefined {
  const normalized = text(value)?.toUpperCase();
  return normalized === "LONG" || normalized === "SHORT" || normalized === "WAIT" ? normalized : undefined;
}

function regime(value: unknown): V12Regime | undefined {
  const normalized = text(value)?.toUpperCase();
  return normalized === "LONG" || normalized === "SHORT" || normalized === "NEUTRAL" ? normalized : undefined;
}

function candidate(value: unknown): V12DecisionCandidateSnapshot | null {
  const row = asObject(value);
  const symbol = text(row?.symbol)?.toUpperCase();
  if (!symbol) return null;

  return {
    symbol,
    side: side(row?.side),
    // Rank is copied only when the runner supplied it. The writer never
    // derives a historical rank from array position or a later observation.
    rank: finite(row?.rank),
    score: finite(row?.score),
    momentum: finite(row?.momentum),
    volumeRatio: finite(row?.volumeRatio),
  };
}

function selectedValue(input: V12DecisionSnapshotInput, key: string) {
  const selected = asObject((input as JsonObject).selected);
  return selected?.[key] ?? (input as JsonObject)[key];
}

export function sanitizeV12DecisionSnapshot(
  input: V12DecisionSnapshotInput,
  now: () => number = Date.now,
): V12DecisionSnapshot {
  if (!Array.isArray(input.candidates)) throw new Error("V12_DECISION_SNAPSHOT_CANDIDATES_REQUIRED");

  const candidates = input.candidates
    .map(candidate)
    .filter((row): row is V12DecisionCandidateSnapshot => Boolean(row))
    .slice(0, MAX_CANDIDATES);
  const selectedAtValue = selectedValue(input, "selectedAt");
  const selectedAt = typeof selectedAtValue === "string"
    ? selectedAtValue.slice(0, MAX_TEXT_LENGTH)
    : new Date(finite(selectedAtValue) ?? now()).toISOString();

  return {
    schema: "v12-decision-snapshot/v1",
    strategyId: V12_STRATEGY_ID,
    selectedAt,
    referenceTs: finite(selectedValue(input, "referenceTs")),
    entryTs: finite(selectedValue(input, "entryTs")),
    symbol: text(selectedValue(input, "symbol"))?.toUpperCase(),
    side: side(selectedValue(input, "side")),
    rank: finite(selectedValue(input, "rank")),
    score: finite(selectedValue(input, "score")),
    momentum: finite(selectedValue(input, "momentum")),
    volumeRatio: finite(selectedValue(input, "volumeRatio")),
    regime: regime(selectedValue(input, "regime")),
    btcRegime: regime(selectedValue(input, "btcRegime")),
    requestedGross: finite(selectedValue(input, "requestedGross")),
    rationale: text(selectedValue(input, "rationale") ?? selectedValue(input, "reason")),
    candidates,
  };
}

export function resolveV12DecisionSnapshotPath(env: NodeJS.ProcessEnv = process.env) {
  const configuredPath = String(env.V12_DECISION_SNAPSHOT_PATH || "").trim();
  if (!configuredPath || !isAbsolute(configuredPath)) {
    throw new Error("V12_DECISION_SNAPSHOT_PATH_MUST_BE_ABSOLUTE");
  }
  return configuredPath;
}

/**
 * Runner-side observability only. This writes one sanitized, atomically
 * replaced JSON file and never calls an exchange or mutates trading state.
 */
export async function writeV12DecisionSnapshot(
  input: V12DecisionSnapshotInput,
  options: { env?: NodeJS.ProcessEnv; now?: () => number } = {},
) {
  const snapshot = sanitizeV12DecisionSnapshot(input, options.now || Date.now);
  const targetPath = resolveV12DecisionSnapshotPath(options.env || process.env);
  await mkdir(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, targetPath);
  return { path: targetPath, snapshot };
}
