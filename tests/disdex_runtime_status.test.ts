import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeRuntimeStatus, type RuntimeStatusOptions } from "../lib/disdex-runtime-status";

const NOW = Date.now();
const SHA = "a".repeat(40);

function heartbeat(runnerId: "V12" | "PENGU_V8" | "V52" | "QUALITY102_CAUSAL_V1", overrides: Record<string, unknown> = {}) {
  return {
    schema: "disdex-runner-heartbeat/v1",
    runnerId,
    serviceUnit: `disdex-${runnerId.toLowerCase()}.service`,
    runtimeSha: SHA,
    expectedSha: SHA,
    workingDirectory: "/srv/disdex/release",
    mode: "LIVE",
    liveEnabled: true,
    safetyState: "LIVE",
    heartbeatAt: NOW - 1_000,
    lastTickAt: NOW - 1_000,
    lastReconciliationAt: NOW - 2_000,
    lastDecision: "ready",
    reason: "safe heartbeat",
    symbols: [{ symbol: "ASTERUSDT", eligible: true, reason: "effective symbol" }],
    caps: { strategy: null, crypto: 2, total: 2.5 },
    restartAttempts: 0,
    updatedAt: NOW - 1_000,
    ...(runnerId === "QUALITY102_CAUSAL_V1" ? {
      quality102: { selectorMode: "DERIVED_HIGH_VOL_ONLY", historicalSelectorParity: false, brkLiveEnabled: false },
    } : {}),
    ...overrides,
  };
}

const filenames = {
  V12: "v12.json",
  PENGU_V8: "pengu-v8.json",
  V52: "v52.json",
  QUALITY102_CAUSAL_V1: "quality102-causal-v1.json",
};

async function fixture(overrides: Partial<Record<keyof typeof filenames, unknown>> = {}) {
  const root = await mkdtemp(join(tmpdir(), "disdex-runtime-status-"));
  for (const runnerId of Object.keys(filenames) as Array<keyof typeof filenames>) {
    const value = Object.prototype.hasOwnProperty.call(overrides, runnerId) ? overrides[runnerId] : heartbeat(runnerId);
    if (value !== undefined) await writeFile(join(root, filenames[runnerId]), JSON.stringify(value));
  }
  return root;
}

function options(healthRoot: string, extra: Partial<RuntimeStatusOptions> = {}): RuntimeStatusOptions {
  return { healthRoot, now: NOW, expectedReleaseSha: SHA, ...extra };
}

test("normalizes exactly the four production strategy records", async () => {
  const root = await fixture();
  try {
    const records = await normalizeRuntimeStatus(options(root));
    assert.deepEqual(records.map((record) => record.strategyId), [
      "V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "V52_ASTER_ONLY", "QUALITY102_CAUSAL_V1",
    ]);
    assert.equal(records.every((record) => record.releaseShaMatch), true);
    assert.equal(records[0].state, "LIVE");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("projects Q102 effective symbols, caps, and fail-closed selector metadata", async () => {
  const root = await fixture({
    QUALITY102_CAUSAL_V1: heartbeat("QUALITY102_CAUSAL_V1", {
      symbols: [
        { symbol: "ASTERUSDT", eligible: true, reason: "high-vol eligible" },
        { symbol: "PENGUUSDT", eligible: false, reason: "causal gate" },
      ],
      caps: { strategy: 0.5, crypto: 2, total: 2.5 },
      safetyState: "FAIL_CLOSED",
      lastDecision: "LIVE_BLOCKED_FAIL_CLOSED",
    }),
  });
  try {
    const q102 = (await normalizeRuntimeStatus(options(root))).find((record) => record.strategyId === "QUALITY102_CAUSAL_V1")!;
    assert.deepEqual(q102.symbols, [
      { symbol: "ASTERUSDT", eligible: true, reason: "high-vol eligible" },
      { symbol: "PENGUUSDT", eligible: false, reason: "causal gate" },
    ]);
    assert.deepEqual(q102.gross, { strategyCap: 0.5, cryptoCap: 2, totalCap: 2.5 });
    assert.deepEqual(q102.quality102, { selectorMode: "DERIVED_HIGH_VOL_ONLY", historicalSelectorParity: false, brkLiveEnabled: false });
    assert.equal(q102.state, "FAIL_CLOSED");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("maps absent, malformed, stale, and SHA-mismatched heartbeats to 要確認", async () => {
  const root = await fixture({
    V12: undefined,
    PENGU_V8: "not-json",
    V52: heartbeat("V52", { heartbeatAt: NOW - 10 * 60_000 }),
    QUALITY102_CAUSAL_V1: heartbeat("QUALITY102_CAUSAL_V1", { runtimeSha: "b".repeat(40) }),
  });
  try {
    const records = await normalizeRuntimeStatus(options(root));
    assert.equal(records.every((record) => record.state === "要確認" && record.releaseShaMatch === false), true, JSON.stringify(records));
    assert.match(records[0].safetyReason, /heartbeat/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("serializes only redacted public status and performs no writes", async () => {
  const root = await fixture({
    V12: heartbeat("V12", {
      reason: "PRIVATE_KEY=wallet-secret TOKEN=token-secret orderId=ord-123 /private/path",
      lastDecision: "SECRET=password-secret",
    }),
  });
  try {
    const before = await readdir(root);
    const serialized = JSON.stringify(await normalizeRuntimeStatus(options(root)));
    const after = await readdir(root);
    assert.deepEqual(after, before);
    for (const forbidden of ["PRIVATE", "SECRET", "TOKEN", "KEY", "PASSWORD", "wallet-secret", "token-secret", "ord-123", "/private/path"]) {
      assert.equal(serialized.toUpperCase().includes(forbidden.toUpperCase()), false, `${forbidden}: ${serialized}`);
    }
    assert.equal(serialized.includes("workingDirectory"), false);
    assert.equal(serialized.includes("serviceUnit"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
