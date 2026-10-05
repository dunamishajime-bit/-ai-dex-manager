import fs from "fs";
import path from "path";
import type { OperationalWalletRecord, OperationalWalletStatus, OperationalWhitelistEntry } from "@/lib/operational-wallet-types";

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = !!(KV_URL && KV_TOKEN);
const REDIS_KEY = "disdex:operational-wallets";
const DB_PATH = path.join(process.cwd(), "data", "operational-wallets.json");

let memoryWallets: OperationalWalletRecord[] | null = null;

async function loadFromRedis(): Promise<OperationalWalletRecord[]> {
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({ url: KV_URL!, token: KV_TOKEN! });
  const data = await redis.get<OperationalWalletRecord[]>(REDIS_KEY);
  return Array.isArray(data) ? data : [];
}

async function saveToRedis(wallets: OperationalWalletRecord[]): Promise<void> {
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({ url: KV_URL!, token: KV_TOKEN! });
  await redis.set(REDIS_KEY, wallets);
}

function loadFromFs(): OperationalWalletRecord[] {
  try {
    if (memoryWallets) return memoryWallets;
    if (!fs.existsSync(DB_PATH)) return [];
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    memoryWallets = Array.isArray(parsed) ? parsed : [];
    return memoryWallets;
  } catch (error) {
    console.warn("Failed to load operational wallets from filesystem:", error);
    return memoryWallets || [];
  }
}

function saveToFs(wallets: OperationalWalletRecord[]): void {
  memoryWallets = wallets;
  try {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(wallets, null, 2), "utf8");
  } catch (error) {
    console.warn("Failed to save operational wallets to filesystem:", error);
  }
}

export async function loadOperationalWallets(): Promise<OperationalWalletRecord[]> {
  if (USE_REDIS) return loadFromRedis();
  return loadFromFs();
}

export async function saveOperationalWallets(wallets: OperationalWalletRecord[]): Promise<void> {
  const next = wallets.map((wallet) => ({ ...wallet, updatedAt: new Date().toISOString() }));
  if (USE_REDIS) return saveToRedis(next);
  saveToFs(next);
}

export async function findOperationalWalletByUser(userId: string): Promise<OperationalWalletRecord | undefined> {
  const wallets = await loadOperationalWallets();
  return wallets.find((wallet) => wallet.userId === userId && !wallet.deletedAt);
}

export async function findOperationalWalletByEmail(email: string): Promise<OperationalWalletRecord | undefined> {
  const wallets = await loadOperationalWallets();
  const cleanEmail = email.trim().toLowerCase();
  return wallets.find((wallet) => wallet.email.toLowerCase() === cleanEmail && !wallet.deletedAt);
}

export async function upsertOperationalWallet(wallet: OperationalWalletRecord): Promise<void> {
  const wallets = await loadOperationalWallets();
  const index = wallets.findIndex((item) => item.id === wallet.id || item.userId === wallet.userId);
  if (index >= 0) {
    wallets[index] = { ...wallet, updatedAt: new Date().toISOString() };
  } else {
    wallets.unshift(wallet);
  }
  await saveOperationalWallets(wallets);
}

export async function updateOperationalWalletByUser(
  userId: string,
  updater: (current: OperationalWalletRecord) => OperationalWalletRecord,
): Promise<OperationalWalletRecord | null> {
  const wallets = await loadOperationalWallets();
  const index = wallets.findIndex((wallet) => wallet.userId === userId);
  if (index < 0) return null;
  const next = updater(wallets[index]);
  wallets[index] = { ...next, updatedAt: new Date().toISOString() };
  await saveOperationalWallets(wallets);
  return wallets[index];
}

export function createEmptyWhitelist(): OperationalWhitelistEntry[] {
  return [];
}

export function normalizeOperationalWalletStatus(value?: string): OperationalWalletStatus {
  if (value === "created" || value === "awaiting_deposit" || value === "running" || value === "paused") {
    return value;
  }
  return "created";
}
