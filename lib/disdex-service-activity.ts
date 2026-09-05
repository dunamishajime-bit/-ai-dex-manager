import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { RunnerId } from "./disdex-runner-health";

export type ServiceActivityByRunner = Partial<Record<RunnerId, boolean | undefined>>;

const execFile = promisify(execFileCallback);
const SYSTEMCTL = "/usr/bin/systemctl";
const SERVICE_ENV_KEYS: Record<RunnerId, string> = {
  V12: "DISDEX_RUNNER_V12_SERVICE_UNIT",
  PENGU_V8: "DISDEX_RUNNER_PENGU_V8_SERVICE_UNIT",
  V52: "DISDEX_RUNNER_V52_SERVICE_UNIT",
  QUALITY102_CAUSAL_V1: "DISDEX_RUNNER_QUALITY102_CAUSAL_V1_SERVICE_UNIT",
};
const SERVICE_ALLOWLIST: Record<RunnerId, RegExp> = {
  V12: /^disdex-v12-x1-all@[0-9a-f]{40}\.service$/,
  PENGU_V8: /^(disdex-pengu-dual-ls-v2-v20|disdex-v96-v52-live)\.service$/,
  V52: /^(disdex-v52-aster-only@[0-9a-f]{40}|disdex-v96-v52-live)\.service$/,
  QUALITY102_CAUSAL_V1: /^disdex-quality102-causal-v1@[0-9a-f]{40}\.service$/,
};

function exitCode(error: unknown): number | undefined {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "number" ? code : undefined;
}

/** Read only the allowlisted systemd active state; failures are explicit unavailable values. */
export async function observeRunnerServiceActivity(env: NodeJS.ProcessEnv = process.env): Promise<ServiceActivityByRunner> {
  const result: ServiceActivityByRunner = {};
  const observedUnits = new Map<string, boolean | undefined>();
  for (const runnerId of Object.keys(SERVICE_ENV_KEYS) as RunnerId[]) {
    const unit = String(env[SERVICE_ENV_KEYS[runnerId]] || "").trim();
    if (!unit || !SERVICE_ALLOWLIST[runnerId].test(unit)) {
      result[runnerId] = undefined;
      continue;
    }
    if (observedUnits.has(unit)) {
      result[runnerId] = observedUnits.get(unit);
      continue;
    }
    try {
      await execFile(SYSTEMCTL, ["is-active", "--quiet", unit], { windowsHide: true });
      observedUnits.set(unit, true);
      result[runnerId] = true;
    } catch (error) {
      const active = exitCode(error) === 3 ? false : undefined;
      observedUnits.set(unit, active);
      result[runnerId] = active;
    }
  }
  return result;
}
