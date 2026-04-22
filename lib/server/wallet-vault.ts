import crypto from "crypto";
import fs from "fs";
import path from "path";

const MASTER_KEY_ENV = process.env.OPERATIONAL_WALLET_MASTER_KEY || process.env.WALLET_VAULT_KEY;
const VAULT_KEY_PATH = path.join(process.cwd(), "data", "operational-wallet-vault.key");

function ensureVaultKey(): Buffer {
  if (MASTER_KEY_ENV && MASTER_KEY_ENV.trim()) {
    return crypto.createHash("sha256").update(MASTER_KEY_ENV.trim()).digest();
  }

  try {
    if (fs.existsSync(VAULT_KEY_PATH)) {
      const raw = fs.readFileSync(VAULT_KEY_PATH, "utf8").trim();
      if (raw) {
        return Buffer.from(raw, "base64");
      }
    }

    const key = crypto.randomBytes(32);
    const dataDir = path.dirname(VAULT_KEY_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(VAULT_KEY_PATH, key.toString("base64"), "utf8");
    return key;
  } catch (error) {
    console.warn("Failed to read or create wallet vault key, falling back to ephemeral key:", error);
    return crypto.randomBytes(32);
  }
}

export function encryptVaultSecret(plainText: string): string {
  const key = ensureVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptVaultSecret(payload: string): string {
  const [version, ivText, tagText, dataText] = payload.split(".");
  if (version !== "v1" || !ivText || !tagText || !dataText) {
    throw new Error("Unsupported encrypted wallet payload.");
  }

  const key = ensureVaultKey();
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  const encrypted = Buffer.from(dataText, "base64url");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

