import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { buildV12V4ShadowSnapshot, type V12V4Features, type V12V4PortfolioContext } from "../lib/v12-multilogic-v4-shadow";

type Input = {
  observations: V12V4Features[];
  context?: V12V4PortfolioContext;
};

function arg(name: string) {
  return process.argv.includes(name);
}

function absoluteOrResolve(value: string) {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

async function loadInput(path: string): Promise<Input> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Partial<Input>;
  if (!Array.isArray(raw.observations)) throw new Error("V12_V4_SHADOW_INPUT_OBSERVATIONS_REQUIRED");
  return { observations: raw.observations, context: raw.context };
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + ".tmp-" + process.pid;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8" });
  await rename(temp, path);
}

export async function runV12V4ShadowOnce(options: {
  inputPath?: string;
  statePath?: string;
  capturedAt?: string;
} = {}) {
  const inputPath = absoluteOrResolve(options.inputPath || process.env.V12_V4_SHADOW_INPUT_PATH || ".runtime-state/v12-v4-shadow-input.json");
  const statePath = absoluteOrResolve(options.statePath || process.env.V12_V4_SHADOW_STATE_PATH || ".runtime-state/v12-v4-shadow-state.json");
  const input = await loadInput(inputPath);
  const snapshot = buildV12V4ShadowSnapshot({
    observations: input.observations,
    context: input.context,
    capturedAt: options.capturedAt,
  });
  if (snapshot.orderEnabled !== false || snapshot.tradingMutation !== 0 || snapshot.counts.realOrderEnabledV4 !== 0) {
    throw new Error("V12_V4_SHADOW_SAFETY_INVARIANT_FAILED");
  }
  await atomicJson(statePath, snapshot);
  return { inputPath, statePath, snapshot };
}

async function selfTest() {
  const snapshot = buildV12V4ShadowSnapshot({
    capturedAt: "2026-10-09T00:00:00.000Z",
    observations: [{
      symbol: "XRPUSDT",
      sourceSide: "SHORT",
      sourceSignalTs: Date.UTC(2026, 9, 9),
      age: 80,
      sret6: 0.002,
      ema12Dist: 0.2,
      btc6: 0.01,
      btc24: 0.01,
      rel12: 0.01,
      rel24: 0.01,
      break24Atr: -0.2,
      volRatio: 0.8,
      er24: 0.2,
      rangeLoc24: 0.5,
      pullback12Atr: 0.8,
      compression: 1,
      bodyAtr: 0.2,
      clv: 0.7,
    }],
  });
  if (snapshot.orderEnabled !== false || snapshot.tradingMutation !== 0 || snapshot.counts.realOrderEnabledV4 !== 0) throw new Error("SELFTEST_SAFETY");
  if (!snapshot.candidates.some((x) => x.route === "REC_G5_SLOW_TREND" && x.plannedExitPolicy === "TIME_48H_FIXED_REFINED")) throw new Error("SELFTEST_G5");
  console.log("V12_MULTILOGIC_V4_SHADOW_SELFTEST_PASS", JSON.stringify(snapshot.counts));
}

async function main() {
  if (arg("--self-test")) {
    await selfTest();
    return;
  }
  if (!arg("--once")) throw new Error("V12_V4_SHADOW_RUNNER_REQUIRES_--once_OR_--self-test");
  const result = await runV12V4ShadowOnce();
  console.log("V12_MULTILOGIC_V4_SHADOW_STATE_WRITTEN", JSON.stringify({
    statePath: result.statePath,
    candidates: result.snapshot.counts.independentlyQualifyingCandidates,
    accepted: result.snapshot.counts.admittedShadowVirtualLegs,
    orderEnabled: result.snapshot.orderEnabled,
  }));
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("v12-multilogic-v4-shadow-runner.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
