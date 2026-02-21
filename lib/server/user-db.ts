import fs from 'fs';
import path from 'path';

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
}

// ========== Storage Backend ==========

// Vercel KV (Upstash Redis) if environment variables are present
// Vercel injects: KV_REST_API_URL, KV_REST_API_TOKEN (and aliases)
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = !!(KV_URL && KV_TOKEN);
const REDIS_KEY = "disdex:users";
const DB_PATH = path.join(process.cwd(), 'data', 'users.json');

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
        if (!fs.existsSync(DB_PATH)) return [];
        const data = fs.readFileSync(DB_PATH, 'utf8');
        memoryUsers = JSON.parse(data);
        return memoryUsers || [];
    } catch (e) {
        console.error("Failed to load users from server DB:", e);
        return memoryUsers || [];
    }
}

function saveUsersToFs(users: ServerUser[]): void {
    memoryUsers = users;
    try {
        const dataDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2), 'utf8');
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
