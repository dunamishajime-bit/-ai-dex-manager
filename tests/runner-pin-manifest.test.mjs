import test from "node:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  RUNNER_PIN_IDS,
  RUNNER_PIN_MANIFEST_SCHEMA,
  getRunnerPin,
  loadRunnerPinManifestFromFile,
  serviceUnitForPin,
  validateRunnerPinManifest,
} from "../scripts/ops/root/disdex-runner-pin-manifest.mjs";

const execFileAsync = promisify(execFile);

const SHAS = {
  V4: "53a0be396719f0284af4e11b35c66a4ac7d58f79",
  Q102: "ef1ab178e26a7bf5bddb6473467765edba242e1d",
  V52: "97830672e2f139b39f7194166d7dc8c36e8c8933",
  LEGACY: "7688ed7c93a1918d8b44837339b7da5584a868f5",
  CANDIDATE: "06555dcaaf8b62fd8f8fcec2b6fa650225012f2c",
};

const SERVICE_NAMES = {
  V12_V4: "disdex-v12-v4",
  PENGU_V8: "disdex-pengu-dual-ls-v2",
  QUALITY102_CAUSAL_V1: "disdex-quality102-causal-v1",
  V52: "disdex-v52-aster-only",
  FET_BRK48_RESIDUAL: "disdex-fet-brk48",
  HYPE_TREND_LONG: "disdex-hype-long",
  IDLE_PRIORITY_SHORT: "disdex-idle-priority-short",
  SHARED_CRYPTO_RISK: "disdex-shared-crypto-risk",
  MARGIN_GUARD: "disdex-v12-v52-margin-guard",
};

function pin(runnerId, sha, evidenceMode, stopOwner) {
  return {
    sha,
    releaseRoot: `/var/lib/disdex/trading/releases/${sha}`,
    serviceUnit: `${SERVICE_NAMES[runnerId]}@${sha}.service`,
    evidenceMode,
    stopOwner,
  };
}

function validManifest() {
  return {
    schema: RUNNER_PIN_MANIFEST_SCHEMA,
    target: "professional-dismanager.net",
    runners: {
      V12_V4: pin("V12_V4", SHAS.V4, "legacy", "V4_PRIMARY"),
      PENGU_V8: pin("PENGU_V8", SHAS.LEGACY, "legacy", "PENGU_V8"),
      QUALITY102_CAUSAL_V1: pin("QUALITY102_CAUSAL_V1", SHAS.Q102, "legacy", "Q102_PRIMARY"),
      V52: pin("V52", SHAS.V52, "legacy", "V52"),
      FET_BRK48_RESIDUAL: pin("FET_BRK48_RESIDUAL", SHAS.LEGACY, "legacy", "FET_BRK48_RESIDUAL"),
      HYPE_TREND_LONG: pin("HYPE_TREND_LONG", SHAS.LEGACY, "legacy", "HYPE_TREND_LONG"),
      IDLE_PRIORITY_SHORT: pin("IDLE_PRIORITY_SHORT", SHAS.LEGACY, "legacy", "IDLE_PRIORITY_SHORT"),
      SHARED_CRYPTO_RISK: pin("SHARED_CRYPTO_RISK", SHAS.LEGACY, "legacy", "SHARED_RISK"),
      MARGIN_GUARD: pin("MARGIN_GUARD", SHAS.LEGACY, "legacy", "MARGIN_GUARD"),
    },
  };
}

test("validates the complete multi-SHA runner manifest and normalizes SHA case", () => {
  const result = validateRunnerPinManifest(validManifest());

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.manifest.runnerIds, RUNNER_PIN_IDS);
  assert.equal(getRunnerPin(result.manifest, "V12_V4").sha, SHAS.V4);
});

test("rejects a service unit whose SHA does not match the runner pin", () => {
  const manifest = validManifest();
  manifest.runners.V52.serviceUnit = `${SERVICE_NAMES.V52}@${SHAS.CANDIDATE}.service`;

  const result = validateRunnerPinManifest(manifest);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("V52_SERVICE_UNIT_SHA_MISMATCH"));
});

test("rejects malformed SHA, missing release root, and unknown STOP owner", () => {
  const manifest = validManifest();
  manifest.runners.QUALITY102_CAUSAL_V1 = {
    ...manifest.runners.QUALITY102_CAUSAL_V1,
    sha: "ef1ab178",
    releaseRoot: "",
    stopOwner: "UNKNOWN_OWNER",
  };

  const result = validateRunnerPinManifest(manifest);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("QUALITY102_CAUSAL_V1_SHA_INVALID"));
  assert.ok(result.errors.includes("QUALITY102_CAUSAL_V1_RELEASE_ROOT_INVALID"));
  assert.ok(result.errors.includes("QUALITY102_CAUSAL_V1_STOP_OWNER_INVALID"));
});

test("requires explicit evidence mode and rejects an unknown runner lookup", () => {
  const manifest = validManifest();
  delete manifest.runners.HYPE_TREND_LONG.evidenceMode;

  const result = validateRunnerPinManifest(manifest);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("HYPE_TREND_LONG_EVIDENCE_MODE_INVALID"));
  const valid = validateRunnerPinManifest(validManifest());
  assert.throws(() => getRunnerPin(valid.manifest, "NOT_A_RUNNER"), /RUNNER_PIN_UNKNOWN/);
});

test("builds the exact service unit from a runner identity and SHA", () => {
  assert.equal(
    serviceUnitForPin("QUALITY102_CAUSAL_V1", SHAS.Q102),
    `disdex-quality102-causal-v1@${SHAS.Q102}.service`,
  );
  assert.throws(() => serviceUnitForPin("NOT_A_RUNNER", SHAS.Q102), /RUNNER_PIN_UNKNOWN/);
});

test("loads and validates a root-owned manifest projection from JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-runner-pin-"));
  const path = join(directory, "runner-pins.json");
  try {
    await writeFile(path, `${JSON.stringify(validManifest())}\n`, "utf8");
    const loaded = await loadRunnerPinManifestFromFile(path);
    assert.equal(loaded.target, "professional-dismanager.net");
    assert.equal(loaded.runners.QUALITY102_CAUSAL_V1.sha, SHAS.Q102);
    const cli = await execFileAsync(process.execPath, [
      fileURLToPath(new URL("../scripts/ops/root/disdex-runner-pin-manifest.mjs", import.meta.url)),
      "--validate",
      path,
    ], { encoding: "utf8" });
    assert.equal(JSON.parse(cli.stdout).runners.V52.sha, SHAS.V52);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
