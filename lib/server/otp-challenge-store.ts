import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type OtpChallengePurpose = "ADMIN_LOGIN" | "DEPLOY_APPROVAL";

export type OtpChallenge = {
  id: string;
  purpose: OtpChallengePurpose;
  subject: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  maxAttempts: number;
  attemptsRemaining: number;
  consumedAt?: number;
};

function storePath() {
  return process.env.DISDEX_OTP_CHALLENGE_STORE_PATH
    || path.join(process.cwd(), "data", "otp-challenges.json");
}

function load(): OtpChallenge[] {
  const p = storePath();
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("OTP_STORE_INVALID");
    return parsed as OtpChallenge[];
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw new Error("OTP_STORE_INVALID_OR_UNREADABLE", { cause: error });
  }
}

function save(rows: OtpChallenge[]) {
  const p = storePath();
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = p + ".tmp-" + process.pid + "-" + crypto.randomUUID();
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { fs.renameSync(tmp, p); }
  finally {
    try { fs.unlinkSync(tmp); } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }
}

async function withLock<T>(fn: () => T): Promise<T> {
  const p = storePath();
  await fs.promises.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
  const lock = p + ".lock";
  let acquired = false;
  for (let i = 0; i < 200; i += 1) {
    try {
      await fs.promises.mkdir(lock, { mode: 0o700 });
      acquired = true;
      break;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!acquired) throw new Error("OTP_STORE_BUSY_FAIL_CLOSED");
  try { return fn(); }
  finally { await fs.promises.rmdir(lock); }
}

function safeHashEqual(a: string, b: string) {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return crypto.timingSafeEqual(left, right);
}

export async function createOtpChallenge(input: {
  purpose: OtpChallengePurpose;
  subject: string;
  codeHash: string;
  now?: number;
  expiresAt: number;
  maxAttempts: number;
}) {
  const now = input.now ?? Date.now();
  if (!input.subject || !/^[0-9a-f]{64}$/i.test(input.codeHash)
      || !Number.isFinite(input.expiresAt) || input.expiresAt <= now
      || !Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 10) {
    throw new Error("OTP_CHALLENGE_INPUT_INVALID");
  }
  return withLock(() => {
    const rows = load().filter((row) => row.expiresAt >= now - 60 * 60 * 1000);
    const challenge: OtpChallenge = {
      id: crypto.randomUUID(),
      purpose: input.purpose,
      subject: input.subject,
      codeHash: input.codeHash.toLowerCase(),
      createdAt: now,
      expiresAt: input.expiresAt,
      maxAttempts: input.maxAttempts,
      attemptsRemaining: input.maxAttempts,
    };
    rows.push(challenge);
    save(rows.slice(-100));
    return challenge;
  });
}

export async function consumeOtpChallenge(input: {
  id: string;
  codeHash: string;
  now?: number;
  purpose?: OtpChallengePurpose;
  subject?: string;
}): Promise<
  | { ok: true; challenge: Omit<OtpChallenge, "codeHash"> }
  | { ok: false; reason: string; remainingAttempts?: number }
> {
  const now = input.now ?? Date.now();
  return withLock(() => {
    const rows = load();
    const index = rows.findIndex((row) => row.id === input.id);
    if (index < 0) return { ok: false, reason: "NOT_FOUND" };
    const row = rows[index];
    if (input.purpose && row.purpose !== input.purpose) return { ok: false, reason: "PURPOSE_MISMATCH" };
    if (input.subject && row.subject !== input.subject) return { ok: false, reason: "SUBJECT_MISMATCH" };
    if (row.consumedAt) return { ok: false, reason: "CONSUMED_REPLAY" };
    if (now > row.expiresAt) return { ok: false, reason: "EXPIRED" };
    if (row.attemptsRemaining <= 0) return { ok: false, reason: "LOCKED", remainingAttempts: 0 };

    if (!safeHashEqual(input.codeHash, row.codeHash)) {
      row.attemptsRemaining = Math.max(0, row.attemptsRemaining - 1);
      rows[index] = row;
      save(rows);
      return {
        ok: false,
        reason: row.attemptsRemaining === 0 ? "LOCKED" : "INVALID_CODE",
        remainingAttempts: row.attemptsRemaining,
      };
    }

    row.consumedAt = now;
    rows[index] = row;
    save(rows);
    const { codeHash: _codeHash, ...safe } = row;
    void _codeHash;
    return { ok: true, challenge: safe };
  });
}
