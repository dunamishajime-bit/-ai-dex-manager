import { Redis } from "@upstash/redis";

// Local in-memory cache for development/fallback if Redis is not configured
const memoryCache: Record<string, any> = {};

const redisVisible = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

let redis: Redis | null = null;
if (redisVisible) {
    redis = new Redis({
        url: process.env.KV_REST_API_URL!,
        token: process.env.KV_REST_API_TOKEN!,
    });
}

export async function kvGet<T>(key: string): Promise<T | null> {
    try {
        if (redis) {
            return await redis.get<T>(key);
        }
    } catch (e) {
        console.warn("[KV] Redis get failed, using memory:", e);
    }
    return (memoryCache[key] as T) || null;
}

export async function kvSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
        if (redis) {
            if (ttlSeconds) {
                await redis.set(key, value, { ex: ttlSeconds });
            } else {
                await redis.set(key, value);
            }
            console.log("[KV] Redis write success: " + key);
            return;
        }
    } catch (e) {
        console.error("[KV] Redis write error: " + key, e);
        console.warn("[KV] Redis set failed, using memory:", e);
    }
    memoryCache[key] = value;
}
