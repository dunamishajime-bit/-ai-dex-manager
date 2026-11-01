import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("OTP challenge is server-side, single-use and race safe", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "disdex-auth-otp-"));
  process.env.DISDEX_AUTH_OTP_STORE_PATH = path.join(dir, "otp.json");
  process.env.DISDEX_AUTH_OTP_PEPPER = "otp-test-secret-".padEnd(64, "z");
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const store = await import("../lib/server/auth-otp-store");

  try {
    const issued = await store.createOtpChallenge({
      subject: "owner",
      purpose: "ADMIN_LOGIN",
      code: "123456",
      nowMs: 1_800_000_000_000,
      ttlMs: 300_000,
      maxAttempts: 5,
    });
    assert.match(issued.id, /^[0-9a-f-]{36}$/i);
    assert.equal("codeHash" in issued, false);

    const wrong = await store.consumeOtpChallenge({
      id: issued.id,
      subject: "owner",
      purpose: "ADMIN_LOGIN",
      code: "999999",
      nowMs: 1_800_000_001_000,
    });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.reason, "OTP_INVALID");

    const attempts = await Promise.all(Array.from({ length: 20 }, () =>
      store.consumeOtpChallenge({
        id: issued.id,
        subject: "owner",
        purpose: "ADMIN_LOGIN",
        code: "123456",
        nowMs: 1_800_000_002_000,
      }),
    ));
    assert.equal(attempts.filter((x) => x.ok).length, 1);
    assert.equal(attempts.filter((x) => !x.ok).length, 19);

    const replay = await store.consumeOtpChallenge({
      id: issued.id,
      subject: "owner",
      purpose: "ADMIN_LOGIN",
      code: "123456",
      nowMs: 1_800_000_003_000,
    });
    assert.deepEqual(replay, { ok: false, reason: "OTP_ALREADY_CONSUMED" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("expired, wrong-purpose and corrupt OTP stores fail closed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "disdex-auth-otp-bad-"));
  const file = path.join(dir, "otp.json");
  process.env.DISDEX_AUTH_OTP_STORE_PATH = file;
  process.env.DISDEX_AUTH_OTP_PEPPER = "otp-test-secret-".padEnd(64, "q");
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const store = await import("../lib/server/auth-otp-store?bad=" + Date.now());

  try {
    const issued = await store.createOtpChallenge({
      subject: "owner", purpose: "OWNER_APPROVAL", code: "654321",
      nowMs: 1000, ttlMs: 1000, maxAttempts: 3,
    });
    assert.deepEqual(await store.consumeOtpChallenge({
      id: issued.id, subject: "owner", purpose: "ADMIN_LOGIN",
      code: "654321", nowMs: 1500,
    }), { ok: false, reason: "OTP_IDENTITY_MISMATCH" });
    assert.deepEqual(await store.consumeOtpChallenge({
      id: issued.id, subject: "owner", purpose: "OWNER_APPROVAL",
      code: "654321", nowMs: 2001,
    }), { ok: false, reason: "OTP_EXPIRED" });

    await fs.writeFile(file, "{corrupt");
    await assert.rejects(store.createOtpChallenge({
      subject: "x", purpose: "ADMIN_LOGIN", code: "123456",
      nowMs: 3000, ttlMs: 1000, maxAttempts: 3,
    }), /CORRUPT|INVALID/);
    assert.equal(await fs.readFile(file, "utf8"), "{corrupt");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
