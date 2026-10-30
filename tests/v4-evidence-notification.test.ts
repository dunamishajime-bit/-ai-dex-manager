import assert from "node:assert/strict";
import test from "node:test";
import {
  formatV4EvidenceExpiryEmail,
  observeV4EvidenceExpiry,
  markV4EvidenceExpiryAttempt,
  markV4EvidenceExpiryDelivered,
} from "../lib/server/runner-health-notification";

test("expiry alert requires two observations and suppresses duplicate delivery", () => {
  const first = observeV4EvidenceExpiry(undefined, {
    status: "EXPIRING_SOON",
    earliestExpiryAt: "2026-10-30T06:00:00.000Z",
    remainingMs: 6 * 60 * 60 * 1000,
    expiringKeys: ["signedAsterAccount"],
    sha: "a".repeat(40),
  }, new Date("2026-10-30T00:00:00.000Z"));
  assert.equal(first.shouldSend, false);
  const second = observeV4EvidenceExpiry(first.record, {
    status: "EXPIRING_SOON",
    earliestExpiryAt: "2026-10-30T06:00:00.000Z",
    remainingMs: 6 * 60 * 60 * 1000,
    expiringKeys: ["signedAsterAccount"],
    sha: "a".repeat(40),
  }, new Date("2026-10-30T00:01:00.000Z"));
  assert.equal(second.shouldSend, true);
  const attempted = markV4EvidenceExpiryAttempt(second.record, new Date("2026-10-30T00:01:00.000Z"));
  const delivered = markV4EvidenceExpiryDelivered(attempted, new Date("2026-10-30T00:01:01.000Z"));
  const duplicate = observeV4EvidenceExpiry(delivered, {
    status: "EXPIRING_SOON",
    earliestExpiryAt: "2026-10-30T06:00:00.000Z",
    remainingMs: 6 * 60 * 60 * 1000,
    expiringKeys: ["signedAsterAccount"],
    sha: "a".repeat(40),
  }, new Date("2026-10-30T00:02:00.000Z"));
  assert.equal(duplicate.shouldSend, false);
});

test("expiry email is explicitly read-only and never claims renewal", () => {
  const mail = formatV4EvidenceExpiryEmail({
    sha: "a".repeat(40),
    status: "EXPIRED",
    earliestExpiryAt: "2026-10-29T23:59:00.000Z",
    remainingMs: -60_000,
    expiringKeys: ["signedAsterAccount", "sharedRiskAndPeers"],
  });
  assert.match(mail.subject, /V4証跡/);
  assert.match(mail.text, /新規注文はBLOCKED/);
  assert.match(mail.text, /正規の署名付き取得元/);
  assert.doesNotMatch(mail.text, /更新済み|承認済みLIVE/);
});
