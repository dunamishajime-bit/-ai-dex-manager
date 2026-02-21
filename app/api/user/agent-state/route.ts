import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = !!(KV_URL && KV_TOKEN);

function getRedis() {
    if (!USE_REDIS) return null;
    return new Redis({
        url: KV_URL!,
        token: KV_TOKEN!,
    });
}

function getRedisKey(userId: string) {
    return `disdex:agent_state:${userId}`;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const redis = getRedis();
    if (!redis) {
        // Redisが設定されていない場合はnullを返す（ローカル環境フォールバック用）
        return NextResponse.json({ state: null });
    }

    try {
        const state = await redis.get(getRedisKey(userId));
        return NextResponse.json({ state });
    } catch (error) {
        console.error("Failed to GET agent state from Redis:", error);
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { userId, state } = body;

        if (!userId || !state) {
            return NextResponse.json({ error: 'userId and state are required' }, { status: 400 });
        }

        const redis = getRedis();
        if (!redis) {
            return NextResponse.json({ success: true, message: 'Redis not configured, ignored' });
        }

        await redis.set(getRedisKey(userId), state);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Failed to POST agent state to Redis:", error);
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
}
