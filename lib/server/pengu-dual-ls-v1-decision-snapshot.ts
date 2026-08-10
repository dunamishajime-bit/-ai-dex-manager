import { readFile } from "node:fs/promises";

const STRATEGY_ID = "PENGU_DUAL_LS_V1" as const;
const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_STATE_PATH = ".runtime-state/pengu-dual-ls-v1/runner-live.json";

export type PenguSnapshotSide = -1 | 0 | 1;

export type PenguDecisionSnapshot = {
  strategyId: typeof STRATEGY_ID;
  mode: "SHADOW" | "PAPER" | "LIVE";
  updatedAt: number;
  referenceTs: number;
  side: PenguSnapshotSide;
  targetGross: number;
  reason: string;
  edgeTriggered: boolean;
  longEligible: boolean;
  shortEligible: boolean;
  shortRecentlyActive: boolean;
  latestCompletedPenguTs?: number;
  latestCompletedBtcTs?: number;
  fundingCoverage: boolean;
  positionSide?: -1 | 1;
};

export type PenguDecisionSnapshotResult =
  | { ok: true; snapshot: PenguDecisionSnapshot; source: string }
  | { ok: false; reason: string; source: string };

function finite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function asSide(value: unknown): PenguSnapshotSide | undefined {
  const parsed = finite(value);
  return parsed === -1 || parsed === 0 || parsed === 1 ? parsed : undefined;
}

function parseSnapshot(value: unknown, source: string): PenguDecisionSnapshotResult {
  const root = asObject(value);
  if (!root || root.strategyId !== STRATEGY_ID) {
    return { ok: false, reason: "PENGU_DUAL_LS_V1のスナップショットではありません。", source };
  }
  const rawSignal = asObject(root.latestSignal) || asObject(root.signal);
  const diagnostics = asObject(rawSignal?.diagnostics);
  const mode = root.mode === "LIVE" || root.mode === "PAPER" || root.mode === "SHADOW" ? root.mode : undefined;
  const updatedAt = finite(root.updatedAt);
  const referenceTs = finite(rawSignal?.referenceTs ?? root.lastSignalReferenceTs);
  const side = asSide(rawSignal?.side);
  const targetGross = finite(rawSignal?.targetGross);
  const reason = typeof rawSignal?.reason === "string" ? rawSignal.reason.trim() : "";
  if (!mode || updatedAt === undefined || referenceTs === undefined || side === undefined || targetGross === undefined || !reason) {
    return { ok: false, reason: "PENGU判定スナップショットの必須項目が不足しています。", source };
  }
  const snapshot: PenguDecisionSnapshot = {
    strategyId: STRATEGY_ID,
    mode,
    updatedAt,
    referenceTs,
    side,
    targetGross,
    reason,
    edgeTriggered: diagnostics?.edgeTriggered === true,
    longEligible: diagnostics?.longEligible === true,
    shortEligible: diagnostics?.shortEligible === true,
    shortRecentlyActive: diagnostics?.shortRecentlyActive === true,
    latestCompletedPenguTs: finite(diagnostics?.latestCompletedPenguTs),
    latestCompletedBtcTs: finite(diagnostics?.latestCompletedBtcTs),
    fundingCoverage: diagnostics?.fundingCoverage === true,
    positionSide: asSide(asObject(root.position)?.side) as -1 | 1 | undefined,
  };
  const maxAge = finite(process.env.PENGU_DUAL_LS_V1_DECISION_SNAPSHOT_MAX_AGE_MS) || DEFAULT_MAX_AGE_MS;
  if (Date.now() - snapshot.updatedAt > Math.max(60_000, maxAge)) {
    return { ok: false, reason: "PENGU判定スナップショットが古いため、表示を停止しています。", source };
  }
  if (snapshot.updatedAt > Date.now() + 60_000) {
    return { ok: false, reason: "PENGU判定スナップショットの時刻が不正です。", source };
  }
  return { ok: true, snapshot, source };
}

async function readLocalSnapshot(pathValue: string): Promise<PenguDecisionSnapshotResult> {
  try {
    return parseSnapshot(JSON.parse(await readFile(pathValue, "utf8")) as unknown, `PENGU Runner state: ${pathValue}`);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "ENOENT") return { ok: false, reason: "PENGU Runnerの判定スナップショットが未生成です。", source: `PENGU Runner state: ${pathValue}` };
    return { ok: false, reason: "PENGU Runnerの判定スナップショットを読み取れません。", source: `PENGU Runner state: ${pathValue}` };
  }
}

async function readRemoteSnapshot(urlValue: string): Promise<PenguDecisionSnapshotResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const token = process.env.PENGU_DUAL_LS_V1_DECISION_SNAPSHOT_TOKEN?.trim();
    const response = await fetch(urlValue, {
      cache: "no-store",
      signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) return { ok: false, reason: "PENGU Runnerの読み取り専用スナップショットAPIが応答しません。", source: `PENGU Runner snapshot API: ${urlValue}` };
    return parseSnapshot(await response.json() as unknown, `PENGU Runner snapshot API: ${urlValue}`);
  } catch {
    return { ok: false, reason: "PENGU Runnerの読み取り専用スナップショットAPIへ接続できません。", source: `PENGU Runner snapshot API: ${urlValue}` };
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadPenguDualLsV1DecisionSnapshot(): Promise<PenguDecisionSnapshotResult> {
  const remoteUrl = process.env.PENGU_DUAL_LS_V1_DECISION_SNAPSHOT_URL?.trim();
  if (remoteUrl) return readRemoteSnapshot(remoteUrl);
  return readLocalSnapshot(process.env.PENGU_DUAL_LS_V1_DECISION_SNAPSHOT_PATH?.trim() || DEFAULT_STATE_PATH);
}
