import fs from 'fs';
import path from 'path';
import { getDisterminalDataDir } from './disterminal-data-path';

// ========== Types ==========

export interface ServerUser {
    id: string;
    email: string;
    displayName: string;
    passwordHash: string;
    role: "user" | "admin";
    createdAt: number;
    lastLogin: number;
    isApproved: boolean;
    isTotpEnabled: boolean;
    totpSecret?: string;
    webAuthnCredentials?: any[];
    resetToken?: string;
    resetTokenExpires?: number;
    emailVerificationCode?: string;
    emailVerificationExpires?: number;
    securitySettings?: {
        enabled?: boolean;
        minMethods?: number;
        methods?: {
            email?: boolean;
            totp?: boolean;
            passkey?: boolean;
        };
        updatedAt?: number;
    };
    ownerWalletAddress?: string;
    ownerWalletConnectedAt?: number;
    vaultAccountId?: string;
    vaultStatus?: "draft" | "pending_deployment" | "active" | "paused" | "migration_ready";
}

// ========== Storage Backend ==========

// Redis / KV backend if environment variables are present
// Common env keys: KV_REST_API_URL, KV_REST_API_TOKEN (or Upstash aliases)
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = !!(KV_URL && KV_TOKEN);
const REDIS_KEY = "disdex:users";
const DATA_DIR = getDisterminalDataDir();
const DB_PATH = path.join(DATA_DIR, 'users.json');

// In-memory fallback for environments without fs access
let memoryUsers: ServerUser[] | null = null;

// ========== Redis Backend ==========

async function loadUsersFromRedis(): Promise<ServerUser[]> {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
        url: KV_URL!,
        token: KV_TOKEN!,
    });
    const data = await redis.get<ServerUser[]>(REDIS_KEY);
    return data || [];
}

async function saveUsersToRedis(users: ServerUser[]): Promise<void> {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
        url: KV_URL!,
        token: KV_TOKEN!,
    });
    await redis.set(REDIS_KEY, users);
}

// ========== File System Backend ==========

function loadUsersFromFs(): ServerUser[] {
    try {
        if (memoryUsers) return memoryUsers;
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            memoryUsers = JSON.parse(data);
            return memoryUsers || [];
        }

        // A release switch can leave the previous user DB in the old release.
        // Migrate it once into the shared path instead of treating all users
        // as deleted. The migration only considers sibling release data files.
        const legacyPath = findLegacyReleaseUserDb();
        if (!legacyPath) return [];

        const legacyData = fs.readFileSync(legacyPath, 'utf8');
        const legacyUsers = JSON.parse(legacyData);
        if (!Array.isArray(legacyUsers)) return [];

        memoryUsers = legacyUsers;
        saveUsersToFs(legacyUsers);
        return memoryUsers || [];
    } catch (e) {
        console.error("Failed to load users from server DB:", e);
        return memoryUsers || [];
    }
}

function findLegacyReleaseUserDb(): string | null {
    const cwd = path.resolve(process.cwd());
    const releasesDir = path.dirname(cwd);
    if (path.basename(releasesDir) !== 'releases' || !fs.existsSync(releasesDir)) {
        return null;
    }

    const candidates = fs.readdirSync(releasesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && path.resolve(releasesDir, entry.name) !== cwd)
        .map((entry) => {
            const candidate = path.join(releasesDir, entry.name, 'data', 'users.json');
            if (!fs.existsSync(candidate)) return null;
            return { candidate, mtimeMs: fs.statSync(candidate).mtimeMs };
        })
        .filter((entry): entry is { candidate: string; mtimeMs: number } => Boolean(entry))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return candidates[0]?.candidate || null;
}

function saveUsersToFs(users: ServerUser[]): void {
    memoryUsers = users;
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
        }

        const tempPath = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(users, null, 2), {
            encoding: 'utf8',
            mode: 0o640,
        });
        fs.renameSync(tempPath, DB_PATH);
    } catch (e) {
        console.warn("Failed to save users to server DB (filesystem is likely read-only):", e);
    }
}

// ========== Public API (Async) ==========

export async function loadUsers(): Promise<ServerUser[]> {
    if (USE_REDIS) {
        return loadUsersFromRedis();
    }
    return loadUsersFromFs();
}

export async function saveUsers(users: ServerUser[]): Promise<void> {
    if (USE_REDIS) {
        return saveUsersToRedis(users);
    }
    saveUsersToFs(users);
}

export async function findUserByEmail(email: string): Promise<ServerUser | undefined> {
    const users = await loadUsers();
    const cleanEmail = email.trim().toLowerCase();
    return users.find(u => u.email.toLowerCase() === cleanEmail);
}

export async function findUserById(id: string): Promise<ServerUser | undefined> {
    const users = await loadUsers();
    return users.find(u => u.id === id);
}

export async function upsertUser(user: ServerUser): Promise<void> {
    const users = await loadUsers();
    const cleanEmail = user.email.trim().toLowerCase();
    const idx = users.findIndex(u => u.id === user.id || u.email.toLowerCase() === cleanEmail);
    if (idx >= 0) {
        // Protect existing passwordHash if the incoming data doesn't have it (sync scenario)
        const existingHash = users[idx].passwordHash;
        users[idx] = { ...users[idx], ...user };
        if (!user.passwordHash && existingHash) {
            users[idx].passwordHash = existingHash;
        }
    } else {
        users.push(user);
    }
    await saveUsers(users);
}

export async function deleteUser(id: string): Promise<void> {
    const users = (await loadUsers()).filter(u => u.id !== id);
    await saveUsers(users);
}
