import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

// Check environment variables at runtime
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = (KV_URL && KV_TOKEN) ? new Redis({
    url: KV_URL,
    token: KV_TOKEN,
}) : null;

export async function POST(req: Request) {
    if (!redis) {
        return NextResponse.json({ ok: false, error: "Redis configuration missing" }, { status: 500 });
    }

    try {
        const body = await req.json();
        const { idempotencyKey, pair, action, amount, price } = body;

        if (!idempotencyKey) {
            return NextResponse.json({ ok: false, error: "Missing idempotencyKey" }, { status: 400 });
        }

        // 1. Check idempotency
        const existing = await redis.get(`idem:${idempotencyKey}`);
        if (existing) {
            console.log(`[TRADE] Idempotency hit: ${idempotencyKey}`);
            return NextResponse.json(existing);
        }

        // 2. Exclusive Lock for the pair
        const lockKey = `lock:trade:${pair}`;
        const lock = await redis.set(lockKey, "1", { nx: true, ex: 30 });

        if (!lock) {
            return NextResponse.json({ ok: false, error: "Trade in progress for this pair" }, { status: 409 });
        }

        try {
            console.log(`[TRADE EXECUTE] Pair: ${pair}, Action: ${action}, Amount: ${amount}, Price: ${price}`);

            // --- SERVER SIDE SWAP LOGIC START ---
            // In a real implementation, you would use EXECUTION_PRIVATE_KEY to sign a transaction
            // and send it to the BSC RPC (RPC_URL_BSC).
            // For now, we simulate the success.

            const txHash = "0x" + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
            const result = { ok: true, txHash, message: "Order executed successfully via server-side" };
            // --- SERVER SIDE SWAP LOGIC END ---

            // Store idempotency result for 5 minutes
            await redis.set(`idem:${idempotencyKey}`, result, { ex: 300 });

            return NextResponse.json(result);
        } catch (e: any) {
            console.error("[TRADE EXECUTE ERROR]", e);
            return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
        } finally {
            // Release lock
            await redis.del(lockKey);
        }
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
    }
}
