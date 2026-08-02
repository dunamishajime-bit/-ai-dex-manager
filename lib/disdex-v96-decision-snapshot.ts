import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { DisDexV96CombinedSignal } from "./disdex-v96-combined-signal";
import type { DisDexV96TickResult } from "./disdex-v96-portfolio-runner";
import type { DisDexV96RunnerMode } from "./disdex-v96-runner-state";

export type DisDexV96DecisionSnapshot = {
  version: 1;
  checkedAt: string;
  source: "disdex-v96-live-runner";
  strategyId: string;
  runnerMode: DisDexV96RunnerMode;
  status: DisDexV96TickResult["status"];
  message: string;
  referenceTs: number | null;
  targetWeights: Record<string, number>;
  core: { regime: string; reasons: string[] };
  pengu: { side: number; targetGross: number; reason: string };
  execution: { finalGross: number; coreScale: number; penguClip: number; orderEligible: boolean };
};

function snapshotPath() {
  const explicit = process.env.DISDEX_V96_DECISION_SNAPSHOT_FILE?.trim();
  if (explicit) return resolve(explicit);
  const stateRoot = resolve(process.env.DISDEX_V96_STATE_DIR || ".runtime-state/disdex-v13d-v11eq-v96/crypto-v96");
  return resolve(stateRoot, "decision-status.json");
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringReasons(signal: DisDexV96CombinedSignal | undefined, message: string) {
  const allocation = (signal?.core as any)?.rawCore?.allocation;
  const reasons = Array.isArray(allocation?.reasons)
    ? allocation.reasons.filter((value: unknown): value is string => typeof value === "string")
    : [];
  return reasons.length ? reasons : [message];
}

export async function writeDisDexV96DecisionSnapshot(
  runnerMode: DisDexV96RunnerMode,
  result: DisDexV96TickResult,
) {
  const signal = result.signal;
  const rawCore = (signal?.core as any)?.rawCore || {};
  const pengu = signal?.pengu as any;
  const snapshot: DisDexV96DecisionSnapshot = {
    version: 1,
    checkedAt: new Date().toISOString(),
    source: "disdex-v96-live-runner",
    strategyId: signal?.strategyId || "DISDEX_V35_STRONG_RESERVED_PENGU_V96",
    runnerMode,
    status: result.status,
    message: result.message,
    referenceTs: signal?.referenceTs ?? null,
    targetWeights: Object.fromEntries(Object.entries(signal?.targetWeights || {}).map(([symbol, weight]) => [symbol, numberValue(weight)])),
    core: {
      regime: String(rawCore.regime || "UNKNOWN"),
      reasons: stringReasons(signal, result.message),
    },
    pengu: {
      side: numberValue(pengu?.side),
      targetGross: numberValue(signal?.allocation?.penguFinalGross ?? pengu?.targetGross),
      reason: String(pengu?.reason || "PENGU\u306e\u5b9fLIVE\u5224\u5b9a\u7d50\u679c\u304c\u3042\u308a\u307e\u305b\u3093\u3002"),
    },
    execution: {
      finalGross: numberValue(signal?.allocation?.finalGross),
      coreScale: numberValue(signal?.allocation?.coreScale, 1),
      penguClip: numberValue(signal?.allocation?.penguClip),
      orderEligible: ["planned", "completed"].includes(result.status) && numberValue(signal?.allocation?.finalGross) > 0,
    },
  };
  const output = snapshotPath();
  const temporary = `${output}.${process.pid}.tmp`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporary, output);
  return snapshot;
}
