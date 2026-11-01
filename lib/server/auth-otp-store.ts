import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type OtpPurpose = "ADMIN_LOGIN" | "OWNER_APPROVAL" | "USER_LOGIN";

type OtpRecord = {
  id: string;
  subject: string;
  purpose: OtpPurpose;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attemptsRemaining: number;
  consumedAt?: number;
};

type PublicOtpChallenge = Omit<OtpRecord, "codeHash" | "attemptsRemaining" | "consumedAt"> & {
  attemptsRemaining?: never;
  consumedAt?: never;
};

function config() {
  const filePath = process.env.DISDEX_AUTH_OTP_STORE_PATH || path.join(process.cwd(), "data", "auth-otp-challenges.json");
  const pepper = process.env.DISDEX_AUTH_OTP_PEPPER?.trim() || "";
  const useRedis = Boolean(
    (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)
    && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN),
  );
  if (Buffer.byteLength(pepper, "utf8") < 32) throw new Error("AUTH_OTP_PEPPER_TOO_WEAK");
  if (useRedis) throw new Error("AUTH_OTP_ATOMIC_REDIS_UNCERTIFIED");
  return { filePath, pepper };
}

function hashCode(pepper: string, id: string, subject: string, purpose: OtpPurpose, code: string) {
  return crypto.createHmac("sha256", pepper)
    .update([id, subject, purpose, code].join(":"))
    .digest("hex");
}

function safeEqualHex(leftHex: string, rightHex: string) {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function loadRecords(filePath: string): OtpRecord[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(raw)) throw new Error("AUTH_OTP_STORE_INVALID");
    return raw as OtpRecord[];
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw new Error("AUTH_OTP_STORE_CORRUPT_OR_UNREADABLE", { cause: error });
  }
}

function saveRecords(filePath: string, records: OtpRecord[]) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = filePath + ".tmp-" + process.pid + "-" + crypto.randomUUID();
  fs.writeFileSync(temp, JSON.stringify(records, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    fs.renameSync(temp, filePath);
  } finally {
    try { fs.unlinkSync(temp); } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }
}

async function withLock<T>(filePath: string, fn: () => T): Promise<T> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const lockPath = filePath + ".lock";
  let acquired = false;
  for (let i = 0; i < 200; i += 1) {
    try {
      await fs.promises.mkdir(lockPath, { mode: 0o700 });
      acquired = true;
      break;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!acquired) throw new Error("AUTH_OTP_STORE_BUSY_FAIL_CLOSED");
  try {
    return fn();
  } finally {
    await fs.promises.rmdir(lockPath);
  }
}

export async function createOtpChallenge(input: {
  subject: string;
  purpose: OtpPurpose;
  code: string;
  nowMs?: number;
  ttlMs: number;
  maxAttempts: number;
}): Promise<PublicOtpChallenge> {
  const { filePath, pepper } = config();
  const now = input.nowMs ?? Date.now();
  if (!input.subject || !/^\d{6}$/.test(input.code)) throw new Error("AUTH_OTP_INPUT_INVALID");
  if (!Number.isSafeInteger(now) || now <= 0 || !Number.isSafeInteger(input.ttlMs)
      || input.ttlMs <= 0 || input.ttlMs > 10 * 60_000
      || !Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 10) {
    throw new Error("AUTH_OTP_POLICY_INVALID");
  }
  return withLock(filePath, () => {
    const records = loadRecords(filePath);
    const id = crypto.randomUUID();
    const record: OtpRecord = {
      id,
      subject: input.subject,
      purpose: input.purpose,
      codeHash: hashCode(pepper, id, input.subject, input.purpose, input.code),
      createdAt: now,
      expiresAt: now + input.ttlMs,
      attemptsRemaining: input.maxAttempts,
    };
    const retained = records
      .filter((item) => item.expiresAt >= now - 60_000 && !item.consumedAt)
      .slice(-199);
    retained.push(record);
    saveRecords(filePath, retained);
    const { codeHash: _hash, attemptsRemaining: _attempts, consumedAt: _consumed, ...publicRecord } = record;
    void _hash; void _attempts; void _consumed;
    return publicRecord;
  });
}

export async function consumeOtpChallenge(input: {
  id: string;
  subject: string;
  purpose: OtpPurpose;
  code: string;
  nowMs?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { filePath, pepper } = config();
  const now = input.nowMs ?? Date.now();
  if (!input.id || !input.subject || !/^\d{6}$/.test(input.code)) return { ok: false, reason: "OTP_INVALID" };
  return withLock(filePath, () => {
    const records = loadRecords(filePath);
    const index = records.findIndex((item) => item.id === input.id);
    if (index < 0) return { ok: false, reason: "OTP_NOT_FOUND" } as const;
    const record = records[index];
    if (record.subject !== input.subject || record.purpose !== input.purpose) {
      return { ok: false, reason: "OTP_IDENTITY_MISMATCH" } as const;
    }
    if (record.consumedAt) return { ok: false, reason: "OTP_ALREADY_CONSUMED" } as const;
    if (now > record.expiresAt) return { ok: false, reason: "OTP_EXPIRED" } as const;
    if (record.attemptsRemaining <= 0) return { ok: false, reason: "OTP_ATTEMPTS_EXHAUSTED" } as const;

    const candidate = hashCode(pepper, record.id, record.subject, record.purpose, input.code);
    if (!safeEqualHex(candidate, record.codeHash)) {
      records[index] = { ...record, attemptsRemaining: Math.max(0, record.attemptsRemaining - 1) };
      saveRecords(filePath, records);
      return { ok: false, reason: "OTP_INVALID" } as const;
    }

    records[index] = { ...record, consumedAt: now, attemptsRemaining: 0 };
    saveRecords(filePath, records);
    return { ok: true } as const;
  });
}
