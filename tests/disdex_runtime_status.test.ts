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
  return {
    healthRoot,
    now: NOW,
    expectedReleaseSha: SHA,
    serviceActiveByRunner: { V12: true, PENGU_V8: true, V52: true, QUALITY102_CAUSAL_V1: true },
    ...extra,
  };
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

test("never reports LIVE when the observed service is inactive or unknown", async () => {
  const root = await fixture();
  try {
    const inactive = await normalizeRuntimeStatus(options(root, { serviceActiveByRunner: { V12: false } }));
    assert.equal(inactive[0].state, "要確認");
    assert.equal(inactive[0].serviceActive, false);

    const unknown = await normalizeRuntimeStatus(options(root, { serviceActiveByRunner: {} }));
    assert.equal(unknown[0].state, "要確認");
    assert.equal(unknown[0].serviceActive, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects every heartbeat presented under a different allowlisted runner filename", async () => {
  const runnerIds = Object.keys(filenames) as Array<keyof typeof filenames>;
  for (const [index, filenameRunnerId] of runnerIds.entries()) {
    const heartbeatRunnerId = runnerIds[(index + 1) % runnerIds.length];
    const root = await fixture({ [filenameRunnerId]: heartbeat(heartbeatRunnerId) });
    try {
      const records = await normalizeRuntimeStatus(options(root));
      const record = records.find((entry) => entry.strategyId === {
        V12: "V12_X1.00_ALL",
        PENGU_V8: "PENGU_DUAL_LS_V2_FINAL",
        V52: "V52_ASTER_ONLY",
        QUALITY102_CAUSAL_V1: "QUALITY102_CAUSAL_V1",
      }[filenameRunnerId as keyof typeof filenames])!;
      assert.equal(record.state, "要確認", `${filenameRunnerId} accepted ${heartbeatRunnerId}`);
      assert.deepEqual(record.symbols, []);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
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

test("keeps Q102 fail-closed when a fresh active heartbeat claims LIVE", async () => {
  const root = await fixture({
    QUALITY102_CAUSAL_V1: heartbeat("QUALITY102_CAUSAL_V1", {
      safetyState: "LIVE",
      liveEnabled: true,
      lastDecision: "LIVE",
    }),
  });
  try {
    const q102 = (await normalizeRuntimeStatus(options(root))).find((record) => record.strategyId === "QUALITY102_CAUSAL_V1")!;
    assert.equal(q102.state, "FAIL_CLOSED");
    assert.match(q102.safetyReason, /selector parity/i);
    assert.equal(q102.lastDecision, "LIVE_BLOCKED_FAIL_CLOSED");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("uses canonical Q102 caps even when the heartbeat caps drift", async () => {
  const root = await fixture({
    QUALITY102_CAUSAL_V1: heartbeat("QUALITY102_CAUSAL_V1", {
      caps: { strategy: 99, crypto: 99, total: 99 },
    }),
  });
  try {
    const q102 = (await normalizeRuntimeStatus(options(root))).find((record) => record.strategyId === "QUALITY102_CAUSAL_V1")!;
    assert.deepEqual(q102.gross, { strategyCap: 0.5, cryptoCap: 2, totalCap: 2.5 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reports service activity as unavailable when no observation is supplied", async () => {
  const root = await fixture();
  try {
    const records = await normalizeRuntimeStatus({ healthRoot: root, now: NOW, expectedReleaseSha: SHA });
    assert.equal(records[0].serviceActive, false);
    assert.equal(records[0].serviceActivity, "UNAVAILABLE");
    assert.match(records[0].safetyReason, /service activity unavailable/i);
    assert.equal(records[0].state, "要確認");
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

test("does not serialize hostile or non-public symbol values", async () => {
  const root = await fixture({
    V12: heartbeat("V12", {
      symbols: [
        { symbol: "ASTERUSDT", eligible: true, reason: "valid" },
        { symbol: "PRIVATE_KEY=super-secret", eligible: true, reason: "hostile" },
        { symbol: "bc1qsecretwalletaddress", eligible: true, reason: "hostile" },
        { symbol: "0x1234567890abcdef1234567890abcdef12345678", eligible: true, reason: "hostile" },
      ],
    }),
  });
  try {
    const serialized = JSON.stringify(await normalizeRuntimeStatus(options(root)));
    for (const forbidden of ["PRIVATE_KEY", "super-secret", "bc1qsecretwalletaddress", "1234567890abcdef1234567890abcdef12345678"]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden}: ${serialized}`);
    }
    assert.deepEqual((await normalizeRuntimeStatus(options(root)))[0].symbols, [
      { symbol: "ASTERUSDT", eligible: true, reason: "valid" },
      { symbol: "[REDACTED]", eligible: false, reason: "symbol rejected" },
      { symbol: "[REDACTED]", eligible: false, reason: "symbol rejected" },
      { symbol: "[REDACTED]", eligible: false, reason: "symbol rejected" },
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
