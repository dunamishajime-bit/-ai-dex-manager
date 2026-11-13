import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadRunnerPinManifest,
  validateRunnerPinManifest,
} from "../lib/server/runner-pin-manifest";

const sourcePath = "config/disdex-runner-pins-DD1296_FINAL_ALLIN_10BPS.json";

test("candidate manifest pins every runner independently", async () => {
  const raw = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  const manifest = validateRunnerPinManifest(raw);
  assert.equal(manifest.runners.V52.sha, "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81");
  assert.equal(manifest.runners.QUALITY102_CAUSAL_V1.sha, "ef1ab178e26a7bf5bddb6473467765edba242e1d");
  assert.equal(manifest.runners.V12_V4.sha, "53a0be396719f0284af4e11b35c66a4ac7d58f79");
  assert.notEqual(manifest.runners.V52.sha, manifest.runners.FET_BRK48_RESIDUAL.sha);
  // The currently pinned Production V52 release predates the supervisor-compatible
  // runner-owned tick schema. Keep it on legacy evidence until SHA + mode cut over together.
  assert.equal(manifest.runners.V52.evidenceMode, "legacy");
});

test("wrong sha, release root, service and paths fail closed", async () => {
  const original = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  for (const mutate of [
    (x: any) => { x.runners.V52.sha = "bad"; },
    (x: any) => { x.runners.V52.releaseRoot = "/home/deploy/disdex-trading/releases/97830672e2f139b39f7194166d7dc8c36e8c8933"; },
    (x: any) => { x.runners.V52.serviceUnit = "disdex-v52-aster-only@97830672e2f139b39f7194166d7dc8c36e8c8933.service"; },
    (x: any) => { x.runners.V52.healthPath = "../unsafe"; },
    (x: any) => { delete x.runners.V52; },
  ]) {
    const candidate = structuredClone(original);
    mutate(candidate);
    assert.throws(() => validateRunnerPinManifest(candidate));
  }
});

test("loader rejects symlink and accepts a regular test file when root ownership is not required", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runner-pins-"));
  try {
    const file = path.join(dir, "pins.json");
    const link = path.join(dir, "pins-link.json");
    await fs.copyFile(sourcePath, file);
    await fs.symlink(file, link);
    await assert.rejects(loadRunnerPinManifest(link, { requireRootOwned: false }), /UNSAFE_FILE/);
    const loaded = await loadRunnerPinManifest(file, { requireRootOwned: false });
    assert.equal(loaded.target, "professional-dismanager.net");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
