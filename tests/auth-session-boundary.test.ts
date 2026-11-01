import assert from "node:assert/strict";
import test from "node:test";

import {
  hashPassword,
  verifyPassword,
  isLegacyBase64PasswordHash,
} from "../lib/server/password-hash";
import {
  issueSignedSession,
  verifySignedSession,
  type SessionPurpose,
} from "../lib/server/auth-session";
import {
  validateMutationRequestHeaders,
} from "../lib/server/request-security";

const SECRET = "session-test-secret-".padEnd(64, "x");

test("passwords use scrypt and legacy base64 is only detected for migration", async () => {
  const encoded = await hashPassword("correct horse battery staple");
  assert.match(encoded, /^scrypt\$/);
  assert.equal(await verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(await verifyPassword("wrong", encoded), false);
  const legacy = Buffer.from("old-password").toString("base64");
  assert.equal(isLegacyBase64PasswordHash(legacy), true);
  assert.equal(isLegacyBase64PasswordHash(encoded), false);
  assert.equal(await verifyPassword("old-password", legacy), false);
});

test("signed session rejects fixed legacy cookies, tampering, wrong purpose and expiry", () => {
  for (const legacy of ["1", "active", "true", ""]) {
    assert.throws(() => verifySignedSession(legacy, {
      secret: SECRET,
      purpose: "USER",
      audience: "professional-dismanager.net",
      nowMs: 1_800_000_000_000,
    }));
  }
  const token = issueSignedSession({
    secret: SECRET,
    subject: "user-123",
    role: "user",
    purpose: "USER",
    audience: "professional-dismanager.net",
    nowMs: 1_800_000_000_000,
    ttlMs: 10 * 60_000,
    nonce: "11111111-1111-4111-8111-111111111111",
  });
  const session = verifySignedSession(token, {
    secret: SECRET,
    purpose: "USER",
    audience: "professional-dismanager.net",
    nowMs: 1_800_000_100_000,
  });
  assert.equal(session.sub, "user-123");
  assert.equal(session.purpose, "USER");
  assert.throws(() => verifySignedSession(token + "x", {
    secret: SECRET, purpose: "USER", audience: "professional-dismanager.net",
    nowMs: 1_800_000_100_000,
  }));
  assert.throws(() => verifySignedSession(token, {
    secret: SECRET, purpose: "ADMIN", audience: "professional-dismanager.net",
    nowMs: 1_800_000_100_000,
  }));
  assert.throws(() => verifySignedSession(token, {
    secret: SECRET, purpose: "USER", audience: "professional-dismanager.net",
    nowMs: 1_800_000_700_001,
  }));
});

test("session secrets must be dedicated and high entropy", () => {
  for (const secret of ["", "password", "short-secret", "a".repeat(31)]) {
    assert.throws(() => issueSignedSession({
      secret,
      subject: "u",
      role: "user",
      purpose: "USER",
      audience: "professional-dismanager.net",
      nowMs: 1,
      ttlMs: 60_000,
      nonce: "11111111-1111-4111-8111-111111111111",
    }));
  }
});

test("mutation requests require HTTPS same-origin semantics", () => {
  const ok = new Headers({
    origin: "https://professional-dismanager.net",
    host: "professional-dismanager.net",
    "sec-fetch-site": "same-origin",
    "x-forwarded-proto": "https",
  });
  assert.equal(validateMutationRequestHeaders(ok, "professional-dismanager.net"), true);

  for (const headers of [
    new Headers({ origin: "https://evil.example", host: "professional-dismanager.net", "sec-fetch-site": "cross-site" }),
    new Headers({ host: "professional-dismanager.net" }),
    new Headers({ origin: "http://professional-dismanager.net", host: "professional-dismanager.net", "sec-fetch-site": "same-origin" }),
  ]) {
    assert.equal(validateMutationRequestHeaders(headers, "professional-dismanager.net"), false);
  }
});
