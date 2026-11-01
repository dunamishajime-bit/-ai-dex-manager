import crypto from "node:crypto";

export type SessionPurpose = "USER" | "ADMIN" | "OWNER_APPROVAL";
export type SessionRole = "user" | "admin" | "owner";

export type SignedSessionPayload = {
  v: 1;
  sub: string;
  role: SessionRole;
  purpose: SessionPurpose;
  aud: string;
  iat: number;
  exp: number;
  nonce: string;
};

const MAX_TTL_MS = 30 * 60_000;
const CLOCK_SKEW_MS = 30_000;
const NONCE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertSecret(secret: string) {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET_TOO_WEAK");
  }
}

function mac(secret: string, payload: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueSignedSession(input: {
  secret: string;
  subject: string;
  role: SessionRole;
  purpose: SessionPurpose;
  audience: string;
  nowMs?: number;
  ttlMs: number;
  nonce?: string;
}) {
  assertSecret(input.secret);
  const now = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error("SESSION_IAT_INVALID");
  if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0 || input.ttlMs > MAX_TTL_MS) {
    throw new Error("SESSION_TTL_INVALID");
  }
  const nonce = input.nonce ?? crypto.randomUUID();
  if (!NONCE_RE.test(nonce)) throw new Error("SESSION_NONCE_INVALID");
  if (!input.subject || !input.audience) throw new Error("SESSION_IDENTITY_INVALID");
  const payload: SignedSessionPayload = {
    v: 1,
    sub: input.subject,
    role: input.role,
    purpose: input.purpose,
    aud: input.audience,
    iat: now,
    exp: now + input.ttlMs,
    nonce,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return "v1." + encoded + "." + mac(input.secret, encoded);
}

export function verifySignedSession(token: string, options: {
  secret: string;
  purpose: SessionPurpose;
  audience: string;
  nowMs?: number;
}) {
  assertSecret(options.secret);
  if (typeof token !== "string") throw new Error("SESSION_TOKEN_INVALID");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("SESSION_TOKEN_INVALID");
  const [_, encoded, signature] = parts;
  const expected = mac(options.secret, encoded);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new Error("SESSION_SIGNATURE_INVALID");
  }
  let payload: SignedSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("SESSION_PAYLOAD_INVALID");
  }
  const now = options.nowMs ?? Date.now();
  if (payload.v !== 1 || !payload.sub || !NONCE_RE.test(payload.nonce)
      || payload.purpose !== options.purpose || payload.aud !== options.audience
      || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
      || payload.iat > now + CLOCK_SKEW_MS || payload.exp <= now
      || payload.exp <= payload.iat || payload.exp - payload.iat > MAX_TTL_MS) {
    throw new Error("SESSION_CLAIMS_INVALID");
  }
  return payload;
}

export function sessionSecretFromEnv() {
  const secret = process.env.DISDEX_SESSION_HMAC_SECRET?.trim() || "";
  assertSecret(secret);
  return secret;
}
