import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { AccountLockHandle } from "../lib/disdex-account-order-lock";
import type { HypeH48PolicyEvidence, HypeH48TimeOnlyContract } from "../lib/hype-stable4-time-only-contract";
import { attestH48EntryReadOnly, attestH48ExitReadOnly, type H48AttestationAuthority } from "../lib/hype-h48-native-lifecycle";
import { evaluateH48R4WsigEntry, H48_RESEARCH_HOUR_MS } from "../lib/hype-h48-research-entry";

const H = H48_RESEARCH_HOUR_MS;
const E = Date.UTC(2026, 10, 24, 0);
const SHA = "4786f600ae7bf86ffca948f1412956a9113cb20d";
const fakeLease = {} as AccountLockHandle;

function candidate() {
  const t = E - H;
  const hypeClosed = Array.from({ length: 25 }, (_, i) => ({
    openTs: t - (24 - i) * H,
    close: i <= 12 ? 100 + i * 0.25 : 103,
  }));
  const btcClosed = Array.from({ length: 25 }, (_, i) => ({
    openTs: t - (24 - i) * H,
    close: 100 + i * 2 / 24,
  }));
  return evaluateH48R4WsigEntry({
    runtimeSha: SHA, now: E + 1000,
    entry: { openTs: E, open: 112, observedAt: E + 500 },
    hypeClosed, btcClosed, existingHypePosition: false,
  });
}

function evidence(contract: HypeH48TimeOnlyContract, quantity: number, now: number): HypeH48PolicyEvidence {
  return {
    policy: "H48_TIME_ONLY", runtimeSha: contract.sourceSha, positionId: contract.positionId,
    logicalEntryTs: contract.logicalEntryTs, logicalExitTs: contract.logicalExitTs,
    quantity, certificateSha256: "a".repeat(64), validatedAt: now,
    expiresAt: now + 60000,
  };
}

test("ENTRY attestation binds exact signal, source, quantity and authority phase; sends no order", async () => {
  const signal = candidate();
  assert.equal(signal.status, "CANDIDATE");
  if (signal.status !== "CANDIDATE") return;
  const phases: string[] = [];
  const authority: H48AttestationAuthority = {
    authorize: async input => {
      phases.push(input.phase);
      assert.equal(input.phase, "ENTRY");
      assert.equal(input.runtimeSha, SHA);
      assert.equal(input.quantity, 1.25);
      assert.equal(input.lease, fakeLease);
      return evidence(input.contract, input.quantity, E + 1000);
    },
  };
  const result = await attestH48EntryReadOnly({
    signal, runtimeSha: SHA, quantity: 1.25, now: E + 1000,
    lease: fakeLease, authority,
  });
  assert.equal(result.status, "H48_ENTRY_ATTESTED_READ_ONLY");
  assert.deepEqual(phases, ["ENTRY"]);
  assert.equal(result.ordersSent, 0);
  assert.equal(result.cancelsSent, 0);
  assert.equal(result.positionChangesSent, 0);
});

test("ENTRY rejects wrong policy/source and replayed or forged authority evidence", async () => {
  const signal = candidate();
  assert.equal(signal.status, "CANDIDATE");
  if (signal.status !== "CANDIDATE") return;
  const good: H48AttestationAuthority = {
    authorize: async x => evidence(x.contract, x.quantity, E + 1000),
  };
  for (const params of [
    { signal, runtimeSha: "b".repeat(40), quantity: 1, now: E + 1000 },
    { signal, runtimeSha: SHA, quantity: 0, now: E + 1000 },
    { signal, runtimeSha: SHA, quantity: 1, now: E + 180000 },
  ]) await assert.rejects(attestH48EntryReadOnly({ ...params, lease: fakeLease, authority: good }));
  const notCandidate = { status: "NO_SIGNAL" as const, reason: "RELATIVE_24H" as const };
  await assert.rejects(attestH48EntryReadOnly({
    signal: notCandidate, runtimeSha: SHA, quantity: 1, now: E + 1000, lease: fakeLease, authority: good,
  }));
  const wrongEvidence: H48AttestationAuthority = {
    authorize: async x => ({ ...evidence(x.contract, x.quantity, E + 1000), policy: "TREND" as "H48_TIME_ONLY" }),
  };
  await assert.rejects(attestH48EntryReadOnly({
    signal, runtimeSha: SHA, quantity: 1, now: E + 1000,
    lease: fakeLease, authority: wrongEvidence,
  }));
});

test("POSITION attestation stays no-action until exact 48h boundary; then invokes POSITION authority", async () => {
  const signal = candidate();
  assert.equal(signal.status, "CANDIDATE");
  if (signal.status !== "CANDIDATE") return;
  const phases: string[] = [];
  const authority: H48AttestationAuthority = {
    authorize: async input => {
      phases.push(input.phase);
      return evidence(input.contract, input.quantity, input.contract.logicalExitTs + 10000);
    },
  };
  const early = await attestH48ExitReadOnly({
    contract: signal.contract, runtimeSha: SHA, quantity: 1,
    now: E + 48 * H - 1000, lease: fakeLease, authority,
  });
  assert.equal(early.status, "H48_NOT_DUE_READ_ONLY");
  assert.deepEqual(phases, []);
  await assert.rejects(attestH48ExitReadOnly({
    contract: signal.contract, runtimeSha: SHA, quantity: 1,
    now: E + 48 * H + 10000, lease: fakeLease, authority,
  }), /BOUNDARY_OPEN_UNVERIFIED/);
  const result = await attestH48ExitReadOnly({
    contract: signal.contract, runtimeSha: SHA, quantity: 1,
    now: E + 48 * H + 10000,
    boundary: { openTs: E + 48 * H, open: 123.5, observedAt: E + 48 * H + 5000 },
    lease: fakeLease, authority,
  });
  assert.equal(result.status, "H48_EXIT_ATTESTED_READ_ONLY");
  assert.equal(result.boundary.reason, "HYPE_REDESIGN_TIME48_NEXTOPEN");
  assert.equal(result.ordersSent, 0);
  assert.deepEqual(phases, ["POSITION"]);
});

test("POSITION rejects mismatched source and bad quantity without calling authority", async () => {
  const signal = candidate();
  assert.equal(signal.status, "CANDIDATE");
  if (signal.status !== "CANDIDATE") return;
  let called = 0;
  const authority: H48AttestationAuthority = {
    authorize: async x => { called++; return evidence(x.contract, x.quantity, E + 48 * H + 1000); },
  };
  for (const input of [
    { runtimeSha: "c".repeat(40), quantity: 1 },
    { runtimeSha: SHA, quantity: NaN },
  ]) {
    await assert.rejects(attestH48ExitReadOnly({
      contract: signal.contract, ...input, now: E + 48 * H + 1000,
      boundary: { openTs: E + 48 * H, open: 120, observedAt: E + 48 * H },
      lease: fakeLease, authority,
    }));
  }
  assert.equal(called, 0);
});
