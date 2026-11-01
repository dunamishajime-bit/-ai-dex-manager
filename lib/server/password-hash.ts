import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);
const PREFIX = "scrypt";
const N = 1 << 14;
const R = 8;
const P = 1;
const KEY_LEN = 32;

export function isLegacyBase64PasswordHash(value: string) {
  if (!value || value.startsWith(PREFIX + "$")) return false;
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length > 0 && decoded.toString("base64").replace(/=+$/,"") === value.replace(/=+$/,"");
  } catch {
    return false;
  }
}

export async function hashPassword(password: string) {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("PASSWORD_TOO_SHORT");
  }
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }) as Buffer;
  return [PREFIX, String(N), String(R), String(P), salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, encoded: string) {
  if (typeof password !== "string" || typeof encoded !== "string") return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;
  const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  if (n !== N || r !== R || p !== P) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== KEY_LEN) return false;
  const actual = await scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }) as Buffer;
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
