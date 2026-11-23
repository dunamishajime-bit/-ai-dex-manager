import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IdlePrioritySymbol } from "../config/idlePriorityShortPolicy";
import type { IdleResidualLongSymbol } from "../config/idleResidualLongPolicy";
import type { IdleFeatures, IdleGenericCandidate, IdleSignal } from "./idle-priority-short-signal";
import type { IdleResidualLongSignal } from "./idle-residual-long-signal";

export const IDLE_DECISION_DETAILS_SCHEMA = "disdex-idle-priority-decision-details/v1" as const;

export type IdleDecisionDetails = {
  schema: typeof IDLE_DECISION_DETAILS_SCHEMA;
  runtimeSha: string;
  decisionTs: number;
  updatedAt: number;
  symbols: Array<{
    symbol: IdlePrioritySymbol;
    route: string;
    features: IdleFeatures;
    generic: Pick<IdleGenericCandidate, "accepted" | "archetype" | "side" | "reason">;
    routeDecision: Pick<IdleSignal, "accepted" | "side" | "reason" | "holdHours">;
    cooldownAllowed: boolean;
    lastLifecycleTs: number | null;
  }>;
  residual: Array<{
    symbol: IdleResidualLongSymbol;
    route: string;
    features: IdleFeatures;
    decision: Pick<IdleResidualLongSignal, "accepted" | "side" | "reason" | "holdHours" | "priority">;
  }>;
  baseline?: {
    sourceComplete: boolean;
    openPositions: number;
    pendingExposure: number;
    acceptedThisTimestamp: number;
    reason: string;
  };
  finalReason?: string;
};

export async function writeIdleDecisionDetails(path: string, details: IdleDecisionDetails) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(details, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}
