import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);
const PREFIX = "scrypt$v1$";
const KEY_BYTES = 32;

function safeEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function hashPassword(password: string) {
  if (typeof password !== "string" || !password.length) throw new Error("PASSWORD_REQUIRED");
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_BYTES) as Buffer;
  return PREFIX + salt.toString("base64url") + "$" + derived.toString("base64url");
}

export async function verifyPassword(password: string, stored: string): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (typeof password !== "string" || typeof stored !== "string" || !stored) {
    return { ok: false, needsRehash: false };
  }
  if (stored.startsWith(PREFIX)) {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "scrypt" || parts[1] !== "v1") return { ok: false, needsRehash: false };
    try {
      const salt = Buffer.from(parts[2], "base64url");
      const expected = Buffer.from(parts[3], "base64url");
      if (salt.length < 16 || expected.length !== KEY_BYTES) return { ok: false, needsRehash: false };
      const actual = await scryptAsync(password, salt, expected.length) as Buffer;
      return { ok: safeEqual(actual, expected), needsRehash: false };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }

  // Legacy reversible base64 is accepted only to migrate an existing account
  // after a successful credential check. It is never emitted by new writes.
  const legacy = Buffer.from(password).toString("base64");
  const ok = safeEqual(Buffer.from(legacy), Buffer.from(stored));
  return { ok, needsRehash: ok };
}
