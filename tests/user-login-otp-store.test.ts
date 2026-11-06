import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOtpChallenge, consumeOtpChallenge, getActiveOtpChallenge } from "../lib/server/otp-challenge-store";

test("USER_LOGIN challenge enforces expiry, bounded attempts, invalidation and single use", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "disdex-user-otp-store-"));
  const previous = process.env.DISDEX_OTP_CHALLENGE_STORE_PATH;
  process.env.DISDEX_OTP_CHALLENGE_STORE_PATH = path.join(directory, "otp.json");
  try {
    const t = Date.now();
    const goodHash = crypto.createHash("sha256").update("synthetic-test-code").digest("hex");
    const wrongHash = crypto.createHash("sha256").update("synthetic-wrong-code").digest("hex");
    const a = await createOtpChallenge({
      purpose: "USER_LOGIN",
      subject: "synthetic-user",
      codeHash: goodHash,
      now: t,
      expiresAt: t + 120_000,
      maxAttempts: 2,
    });
    assert.ok(getActiveOtpChallenge(a.id, "USER_LOGIN", t));
    assert.equal(getActiveOtpChallenge(a.id, "ADMIN_LOGIN", t), null);
    const wrong = await consumeOtpChallenge({
      id: a.id,
      purpose: "USER_LOGIN",
      subject: "synthetic-user",
      codeHash: wrongHash,
      now: t + 1,
    });
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.remainingAttempts, 1);
    const accepted = await consumeOtpChallenge({
      id: a.id,
      purpose: "USER_LOGIN",
      subject: "synthetic-user",
      codeHash: goodHash,
      now: t + 2,
    });
    assert.equal(accepted.ok, true);
    assert.equal(getActiveOtpChallenge(a.id, "USER_LOGIN", t + 3), null);
    const replay = await consumeOtpChallenge({
      id: a.id, purpose: "USER_LOGIN", subject: "synthetic-user", codeHash: goodHash, now: t + 3,
    });
    assert.equal(replay.ok, false);
    const b = await createOtpChallenge({
      purpose: "USER_LOGIN", subject: "synthetic-user", codeHash: goodHash, now: t,
      expiresAt: t + 1_000, maxAttempts: 5,
    });
    assert.equal(getActiveOtpChallenge(b.id, "USER_LOGIN", t + 2_000), null);
    const c = await createOtpChallenge({
      purpose: "USER_LOGIN", subject: "synthetic-user", codeHash: goodHash, now: t,
      expiresAt: t + 60_000, maxAttempts: 5,
    });
    const d = await createOtpChallenge({
      purpose: "USER_LOGIN", subject: "synthetic-user", codeHash: wrongHash, now: t + 1,
      expiresAt: t + 60_001, maxAttempts: 5,
    });
    assert.equal(getActiveOtpChallenge(c.id, "USER_LOGIN", t + 2), null);
    assert.ok(getActiveOtpChallenge(d.id, "USER_LOGIN", t + 2));
  } finally {
    if (previous === undefined) delete process.env.DISDEX_OTP_CHALLENGE_STORE_PATH;
    else process.env.DISDEX_OTP_CHALLENGE_STORE_PATH = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});