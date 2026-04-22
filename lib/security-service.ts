import crypto from "crypto";
import { UserProfile, saveUser } from "./user-store";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const TOTP_WINDOW_STEPS = 1;

function encodeBase32(buffer: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeBase32(secret: string) {
  const normalized = secret.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("Invalid base32 secret");
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function generateHotp(secret: string, counter: number) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const key = decodeBase32(secret);
  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 1_000_000).padStart(6, "0");
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

export async function generateTOTPSecret(email: string) {
  const secret = encodeBase32(crypto.randomBytes(20));
  const issuer = "DisTERMINAL";
  const otpauthUrl =
    `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}` +
    `?secret=${encodeURIComponent(secret)}` +
    `&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;

  return { secret, otpauthUrl };
}

export async function verifyTOTPToken(token: string, secret: string): Promise<boolean> {
  const normalizedToken = token.trim();
  if (!/^\d{6}$/.test(normalizedToken) || !secret) {
    return false;
  }

  const currentCounter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);

  for (let step = -TOTP_WINDOW_STEPS; step <= TOTP_WINDOW_STEPS; step += 1) {
    const candidate = generateHotp(secret, currentCounter + step);
    if (timingSafeEqual(candidate, normalizedToken)) {
      return true;
    }
  }

  return false;
}

export function enableTOTP(user: UserProfile, secret: string): void {
  const updatedUser: UserProfile = {
    ...user,
    totpSecret: secret,
    isTotpEnabled: true,
  };
  saveUser(updatedUser);
}

export function disableTOTP(user: UserProfile): void {
  const updatedUser: UserProfile = {
    ...user,
    totpSecret: undefined,
    isTotpEnabled: false,
  };
  saveUser(updatedUser);
}

export function registerPasskey(user: UserProfile, credential: any): void {
  const credentials = user.webAuthnCredentials || [];
  credentials.push(credential);

  const updatedUser: UserProfile = {
    ...user,
    webAuthnCredentials: credentials,
  };
  saveUser(updatedUser);
}
