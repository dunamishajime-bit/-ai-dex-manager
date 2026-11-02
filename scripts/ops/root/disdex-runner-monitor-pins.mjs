import {
  RUNNER_PIN_IDS,
  getRunnerPin,
  loadRunnerPinManifestSyncFromFile,
} from "./disdex-runner-pin-manifest.mjs";

export const MONITOR_RUNNER_PIN_TARGET = "professional-dismanager.net";

function configuredManifestPath(env) {
  return String(
    env.DISDEX_RUNNER_PIN_MANIFEST_PATH
    || env.DISDEX_WATCHDOG_RUNNER_PIN_MANIFEST_PATH
    || env.DISDEX_HEALTH_SNAPSHOT_RUNNER_PIN_MANIFEST_PATH
    || "",
  ).trim();
}

export function resolveMonitorRunnerPins(env = process.env) {
  const path = configuredManifestPath(env);
  if (!path) return { source: "legacy-env", runners: null, path: null };

  const manifest = loadRunnerPinManifestSyncFromFile(path);
  if (manifest.target !== MONITOR_RUNNER_PIN_TARGET) {
    throw new Error("RUNNER_MONITOR_TARGET_MISMATCH");
  }

  const runners = Object.fromEntries(RUNNER_PIN_IDS.map((runnerId) => {
    const pin = getRunnerPin(manifest, runnerId);
    return [runnerId, {
      runnerId,
      expectedSha: pin.sha,
      releaseRoot: pin.releaseRoot,
      serviceUnit: pin.serviceUnit,
      evidenceMode: pin.evidenceMode,
      healthPath: pin.healthPath,
      tickPath: pin.tickPath,
      stopOwner: pin.stopOwner,
    }];
  }));

  return { source: "manifest-v2", runners, path };
}
