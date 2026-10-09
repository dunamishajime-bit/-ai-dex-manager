import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadV12V4ShadowObservability } from "../apps/production-ui/lib/server/v12-v4-shadow-observability";

const now = Date.UTC(2026, 9, 9, 8);
const leg = { route: "REC_X01_TIME_24H", family: "RECOVERY", symbol: "XRPUSDT", rank: 4, requestedGross: 0.6, decision: "ACCEPTED", reason: "SIMULATED", shadow: true, orderEnabled: false };
const safe = () => ({ architecture: "MULTILOGIC_V4", shadow: true, orderEnabled: false, tradingMutation: 0, capturedAt: new Date(now).toISOString(), policyId: "V2_M150_D05_CORE_NATIVE", candidates: [leg], accepted: [leg], rejected: [], counts: { independentlyQualifyingCandidates: 1, admittedShadowVirtualLegs: 1, realOrderEnabledV4: 0 }, caps: { v12Gross: 3 } });
async function inspect(state: unknown, callback: (view: Awaited<ReturnType<typeof loadV12V4ShadowObservability>>) => void, releaseRoot = process.cwd()) {
  const root = await mkdtemp(join(tmpdir(), "v4-hp-safe-"));
  try {
    const statePath = join(root, "state.json");
    if (state !== undefined) await writeFile(statePath, JSON.stringify(state), "utf8");
    const view = await loadV12V4ShadowObservability({ statePath, releaseRoot, now, killSwitchPath: join(root, "missing-kill.json") });
    callback(view);
  } finally { await rm(root, { recursive: true, force: true }); }
}
function blocked(view: Awaited<ReturnType<typeof loadV12V4ShadowObservability>>) {
  assert.equal(view.orderEnabled, false);
  assert.equal(view.tradingMutation, 0);
  assert.equal(view.counts.realOrderEnabledV4, 0);
  assert.equal(view.certification.status, "BLOCKED_PRODUCTION_PARITY");
  assert.equal(view.certification.orderAuthority, false);
  assert.equal(view.certification.certificateVerified, false);
  assert.equal(view.runtimeObservation.orderAuthority, false);
  assert.equal(view.certification.eightSystemParity, "NOT_PROVEN");
}
function unavailable(view: Awaited<ReturnType<typeof loadV12V4ShadowObservability>>) {
  blocked(view);
  assert.equal(view.stateAvailable, false);
  assert.equal(view.shadowFresh, false);
  assert.deepEqual(view.accepted, []);
  assert.deepEqual(view.candidates, []);
  assert.equal(view.counts.admittedShadowVirtualLegs, 0);
  assert.equal(view.observedPolicyId, undefined);
}
test("fresh non-ordering snapshot displays research decisions without certifying LIVE", async () => {
  await inspect(safe(), view => {
    blocked(view);
    assert.equal(view.stateAvailable, true);
    assert.equal(view.accepted.length, 1);
    assert.equal(view.midpointPriorityAvailable, true);
    assert.equal(view.routeCatalog.length, 41);
    assert.ok(view.routeCatalog.some(row => row.midpointScore !== undefined));
  });
});
test("missing state and missing certificate fail closed", async () => {
  await inspect(undefined, unavailable);
});
test("claimed certificate or legacy enable flag never gives V4 authority", async () => {
  await inspect({ ...safe(), liveEnabled: true, realOrderEnabledV4: 1, productionCertificate: { certified: true, expiresAt: now + 86400000, orderAuthority: true } }, view => { blocked(view); });
});
for (const [name, patch] of [
  ["order-enabled", { orderEnabled: true }],
  ["nonzero mutation", { tradingMutation: 1 }],
  ["coerced mutation", { tradingMutation: "0" }],
  ["wrong architecture", { architecture: "V12_X1_ALL" }],
  ["missing shadow proof", { shadow: undefined }],
  ["stale timestamp", { capturedAt: new Date(now - 3 * 3600000 - 1).toISOString() }],
  ["future timestamp", { capturedAt: new Date(now + 60001).toISOString() }],
  ["missing timestamp", { capturedAt: undefined }],
] as const) {
  test(name + " rejects all state-derived decisions and caps", async () => {
    await inspect({ ...safe(), ...patch, caps: { v12Gross: 999 } }, view => {
      unavailable(view);
      assert.notEqual(view.caps.v12Gross, 999);
    });
  });
}
test("unsafe nested leg cannot appear as a safe Shadow admission", async () => {
  await inspect({ ...safe(), accepted: [{ ...leg, orderEnabled: true }], candidates: [{ ...leg, shadow: false }] }, view => {
    blocked(view);
    assert.deepEqual(view.accepted, []);
    assert.deepEqual(view.candidates, []);
  });
});
test("tampered frozen rank table cannot supply rank, score or planned gross", async () => {
  const root = await mkdtemp(join(tmpdir(), "v4-hp-priority-"));
  try {
    await mkdir(join(root, "docs/implementation"), { recursive: true });
    await mkdir(join(root, "docs/research"), { recursive: true });
    await copyFile(join(process.cwd(), "docs/research/V12_MULTILOGIC_V4_ROUTE_CATALOG_20261009.json"), join(root, "docs/research/V12_MULTILOGIC_V4_ROUTE_CATALOG_20261009.json"));
    await writeFile(join(root, "docs/implementation/v12-v4-v2-full-year-priority.json"), JSON.stringify(Array.from({ length: 41 }, (_, i) => ({ route: "FORGED_" + i, score: 999, gross: 99 }))));
    await inspect(safe(), view => {
      blocked(view);
      assert.equal(view.midpointPriorityAvailable, false);
      assert.equal(view.routeCatalog.length, 41);
      assert.ok(view.routeCatalog.every(row => row.midpointRank === undefined && row.midpointScore === undefined && row.midpointGross === undefined));
      assert.ok(view.errors.some(error => error.includes("SHA256_MISMATCH")));
    }, root);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Linux LF frozen priority verifies identically to the audited CRLF source", async () => {
  const root = await mkdtemp(join(tmpdir(), "v4-hp-lf-"));
  try {
    await mkdir(join(root, "docs/implementation"), { recursive: true });
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(join(process.cwd(), "docs/implementation/v12-v4-v2-full-year-priority.json"), "utf8");
    await writeFile(join(root, "docs/implementation/v12-v4-v2-full-year-priority.json"), text.replace(/\r\n/g, "\n"));
    await inspect(safe(), view => { blocked(view); assert.equal(view.midpointPriorityAvailable, true); }, root);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("shared protected hold remains explicit even without current runtime files", async () => {
  const root = await mkdtemp(join(tmpdir(), "v4-hp-hold-"));
  try {
    const statePath = join(root, "state.json"), killSwitchPath = join(root, "kill.json");
    await writeFile(statePath, JSON.stringify(safe()));
    await writeFile(killSwitchPath, JSON.stringify({ active: true, action: "HOLD_PROTECTED", reason: "V52_TSLA_STALE_QUOTE" }));
    const view = await loadV12V4ShadowObservability({ statePath, killSwitchPath, releaseRoot: process.cwd(), now });
    blocked(view);
    assert.equal(view.runtimeObservation.killSwitchActive, true);
    assert.equal(view.runtimeObservation.killSwitchAction, "HOLD_PROTECTED");
    assert.equal(view.runtimeObservation.killSwitchReason, "V52_TSLA_STALE_QUOTE");
  } finally { await rm(root, { recursive: true, force: true }); }
});
