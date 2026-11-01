import crypto from "node:crypto";
import type { NextRequest } from "next/server";

export const OWNER_SESSION_COOKIE = "disdex_owner_session";
export type OwnerSessionPurpose = "USER" | "ADMIN";

export type OwnerSessionPayload = {
  schema: "disdex-owner-session/v1";
  subject: string;
  purpose: OwnerSessionPurpose;
  audience: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

function decodeKey(value: string) {
  if (!value) throw new Error("OWNER_SESSION_HMAC_KEY_MISSING");
  let key: Buffer;
  try { key = Buffer.from(value, "base64url"); } catch { throw new Error("OWNER_SESSION_HMAC_KEY_INVALID"); }
  if (key.length < 32) throw new Error("OWNER_SESSION_HMAC_KEY_TOO_SHORT");
  return key;
}

export function loadOwnerSessionKey() {
  return process.env.DISDEX_OWNER_SESSION_HMAC_KEY?.trim() || "";
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(input: string, key: string) {
  return crypto.createHmac("sha256", decodeKey(key)).update(input).digest("base64url");
}

function safeTextEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function issueOwnerSession(input: {
  key: string;
  subject: string;
  purpose: OwnerSessionPurpose;
  audience: string;
  now?: number;
  ttlMs: number;
}) {
  const now = input.now ?? Date.now();
  if (!input.subject || !input.audience || !Number.isFinite(input.ttlMs) || input.ttlMs <= 0 || input.ttlMs > 12 * 60 * 60 * 1000) {
    throw new Error("OWNER_SESSION_INPUT_INVALID");
  }
  const payload: OwnerSessionPayload = {
    schema: "disdex-owner-session/v1",
    subject: input.subject,
    purpose: input.purpose,
    audience: input.audience,
    nonce: crypto.randomBytes(18).toString("base64url"),
    issuedAt: now,
    expiresAt: now + input.ttlMs,
  };
  const body = encode(payload);
  const signed = "v1." + body;
  return signed + "." + sign(signed, input.key);
}

export function verifyOwnerSession(token: string, input: {
  key: string;
  purpose: OwnerSessionPurpose;
  audience: string;
  now?: number;
}) {
  if (!token || typeof token !== "string") throw new Error("OWNER_SESSION_MISSING");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("OWNER_SESSION_FORMAT_INVALID");
  const signed = parts[0] + "." + parts[1];
  const expected = sign(signed, input.key);
  if (!safeTextEqual(expected, parts[2])) throw new Error("OWNER_SESSION_SIGNATURE_INVALID");
  let payload: OwnerSessionPayload;
  try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch { throw new Error("OWNER_SESSION_PAYLOAD_INVALID"); }
  const now = input.now ?? Date.now();
  if (payload.schema !== "disdex-owner-session/v1"
      || !payload.subject || payload.purpose !== input.purpose || payload.audience !== input.audience
      || !/^[A-Za-z0-9_-]{20,}$/.test(payload.nonce)
      || !Number.isFinite(payload.issuedAt) || !Number.isFinite(payload.expiresAt)
      || payload.issuedAt > now + 10_000 || payload.expiresAt <= now || payload.expiresAt <= payload.issuedAt
      || payload.expiresAt - payload.issuedAt > 12 * 60 * 60 * 1000) {
    throw new Error("OWNER_SESSION_CLAIMS_INVALID");
  }
  return payload;
}

export function verifyRequestSession(request: NextRequest, purposes: OwnerSessionPurpose[]) {
  const token = request.cookies.get(OWNER_SESSION_COOKIE)?.value || "";
  const audience = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
  const key = loadOwnerSessionKey();
  let last: unknown;
  for (const purpose of purposes) {
    try { return verifyOwnerSession(token, { key, purpose, audience }); }
    catch (error) { last = error; }
  }
  throw last instanceof Error ? last : new Error("OWNER_SESSION_INVALID");
}

export function ownerSessionCookieOptions(maxAgeSeconds: number) {
  return { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/", maxAge: maxAgeSeconds };
}
