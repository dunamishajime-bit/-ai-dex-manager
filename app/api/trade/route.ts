import { NextRequest, NextResponse } from "next/server";
import { resolveToken, NATIVE_TOKEN_ADDRESS } from "@/lib/tokens";
import { isSupportedChain } from "@/lib/chains";
import { createWalletClient, http, publicActions, parseUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, polygon, arbitrum, base } from "viem/chains";

export const runtime = "nodejs";

const PARASWAP_API_URL = "https://api.paraswap.io";

// --- Module Scope Cooldown (Memory-based for minimal config reliance) ---
const localCooldown = new Map<string, number>();
function checkLocalCooldown(key: string, sec = 30): boolean {
    const now = Date.now();
    const last = localCooldown.get(key) ?? 0;
    if (now - last < sec * 1000) return true;
    localCooldown.set(key, now);
    return false;
}

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    let requestPayload: any = {};

    try {
        requestPayload = await req.json();
        const { chainId, srcSymbol, destSymbol, amountWei, fromAddress } = requestPayload;

        // --- 1. Payload Logging (Safety first, no secrets) ---
        console.log(`[TRADE-REQ] Received. Chain:${chainId}, Pair:${srcSymbol}->${destSymbol}, AmountWei:${amountWei}, From:${fromAddress}`);

        // --- 2. Cooldown Guard (30s per fromAddress+pair) ---
        const cooldownKey = `cooldown:trade:${fromAddress}:${chainId}:${srcSymbol}:${destSymbol}`;
        let isDuringCooldown = false;
        const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
        const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

        if (KV_URL && KV_TOKEN) {
            try {
                const { Redis } = await import('@upstash/redis');
                const redis = new Redis({ url: KV_URL, token: KV_TOKEN });
                const existing = await redis.get(cooldownKey);
                if (existing) {
                    isDuringCooldown = true;
                } else {
                    await redis.set(cooldownKey, "active", { ex: 30 }); // 30s expiration
                }
            } catch (redisErr) {
                console.warn("[TRADE] Redis cooldown check failed, bypassing...", redisErr);
            }
        }

        if (isDuringCooldown) {
            console.warn(`[TRADE-STEP] Blocked: Redis Cooldown active for ${fromAddress}`);
            return NextResponse.json({ ok: false, error: "Trade execution restricted. 30s cooldown in progress." }, { status: 200 });
        }

        // --- 2b. Local Memory Cooldown (Fallback & Forced UI rate limit) ---
        const localKey = `${chainId}-${fromAddress}-${srcSymbol}-${destSymbol}`;
        if (checkLocalCooldown(localKey, 30)) {
            console.warn(`[TRADE-STEP] Blocked: Local Cooldown hit for ${fromAddress}`);
            return NextResponse.json({ ok: false, error: "cooldown(30s)" }, { status: 200 });
        }
        console.log(`[TRADE-STEP] Cooldown check passed.`);

        // --- 3. Validation & Registry Resolution ---
        if (!isSupportedChain(chainId)) {
            console.warn(`[TRADE-STEP] Error: Unsupported Chain ${chainId}`);
            return NextResponse.json({ ok: false, error: `Chain ${chainId} not supported` }, { status: 200 });
        }

        const srcTokenInfo = resolveToken(srcSymbol, chainId);
        const destTokenInfo = resolveToken(destSymbol, chainId);
        console.log(`[TRADE-STEP] Registry resolved: ${srcSymbol}(${srcTokenInfo.address}) -> ${destSymbol}(${destTokenInfo.address})`);

        // --- 4. Private Key & Address Verification ---
        const rawVar = process.env.TRADER_PRIVATE_KEY || process.env.EXECUTION_PRIVATE_KEY || "";
        const rawPKString = String(rawVar).trim();
        const hexPK = rawPKString.startsWith("0x") ? rawPKString.slice(2) : rawPKString;
        const privateKey = `0x${hexPK}` as `0x${string}`;

        if (!hexPK || hexPK.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hexPK)) {
            console.error(`[TRADE-STEP] Error: Invalid PK configuration`);
            return NextResponse.json({ ok: false, error: "Server-side private key is missing or invalid format" }, { status: 200 });
        }

        const rpcUrl = chainId === 56 ? process.env.RPC_URL_BSC : process.env.RPC_URL_POLYGON;
        if (!rpcUrl) {
            console.error(`[TRADE-STEP] Error: RPC URL missing for chain ${chainId}`);
            return NextResponse.json({ ok: false, error: "RPC URL not configured for this chain" }, { status: 200 });
        }

        const account = privateKeyToAccount(privateKey);
        const derivedAddress = account.address.toLowerCase();
        const expectedAddress = (process.env.TRADER_ADDRESS || fromAddress || "").toLowerCase();

        if (expectedAddress && derivedAddress !== expectedAddress) {
            console.error(`[TRADE-STEP] Error: Address mismatch. Derived: ${derivedAddress}, Expected: ${expectedAddress}`);
            return NextResponse.json({ ok: false, error: "Security Check Failed: Wallet address mismatch" }, { status: 200 });
        }
        console.log(`[TRADE-STEP] Client setup start (derivedAddress: ${derivedAddress})`);

        // --- 5. Client Setup ---
        const chainMapping: Record<number, any> = { 56: bsc, 137: polygon, 42161: arbitrum, 8453: base };
        const chain = chainMapping[chainId];

        const client = createWalletClient({
            account,
            chain,
            transport: http(rpcUrl, { timeout: 30000 })
        }).extend(publicActions);

        // --- 6. ParaSwap Price Fetch ---
        const priceUrl = `${PARASWAP_API_URL}/prices?srcToken=${srcTokenInfo.address}&destToken=${destTokenInfo.address}&amount=${amountWei}&network=${chainId}&side=SELL&srcDecimals=${srcTokenInfo.decimals}&destDecimals=${destTokenInfo.decimals}`;

        console.log(`[TRADE-STEP] ParaSwap Quote Req URL: ${priceUrl}`);
        const priceRes = await fetch(priceUrl);
        const priceJsonText = await priceRes.text();

        if (!priceRes.ok) {
            console.warn(`[TRADE-STEP] Error: Extra ParaSwap Quote Failed (${priceRes.status})`);
            return NextResponse.json({ ok: false, error: `ParaSwap Quote Failed (${priceRes.status})`, details: priceJsonText.slice(0, 200) }, { status: 200 });
        }
        const priceData = JSON.parse(priceJsonText);
        const priceRoute = priceData.priceRoute;
        console.log(`[TRADE-STEP] ParaSwap Quote OK. PriceRoute identified.`);

        // --- 7. Allowance Check & Approve ---
        const isNative = srcTokenInfo.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
        if (!isNative) {
            const tokenTransferProxy = priceRoute.tokenTransferProxy;
            if (tokenTransferProxy) {
                const allowance = await client.readContract({
                    address: srcTokenInfo.address as `0x${string}`,
                    abi: erc20Abi,
                    functionName: 'allowance',
                    args: [account.address, tokenTransferProxy as `0x${string}`],
                });

                if (allowance < BigInt(amountWei)) {
                    console.log(`[TRADE-STEP] Allowance insufficient. Approving ParaSwap Proxy...`);
                    const approveHash = await client.writeContract({
                        address: srcTokenInfo.address as `0x${string}`,
                        abi: erc20Abi,
                        functionName: 'approve',
                        args: [tokenTransferProxy as `0x${string}`, BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")],
                        account,
                        chain
                    });
                    console.log(`[TRADE-STEP] Approve Tx Sent: ${approveHash}. Waiting receipt...`);
                    await client.waitForTransactionReceipt({ hash: approveHash });
                    console.log(`[TRADE-STEP] Approve Tx Confirmed.`);
                } else {
                    console.log(`[TRADE-STEP] Allowance OK.`);
                }
            }
        } else {
            console.log(`[TRADE-STEP] Native token - skipping allowance check.`);
        }

        // --- 8. ParaSwap Transaction Build ---
        const txUrl = `${PARASWAP_API_URL}/transactions/${chainId}`;
        const txBody: any = {
            srcToken: srcTokenInfo.address,
            destToken: destTokenInfo.address,
            srcAmount: amountWei,
            userAddress: account.address,
            priceRoute: priceRoute,
            slippage: 100, // 1% is standard. Increased only if specifically needed.
        };

        // --- 8b. Re-entrancy / Conflict Guard (As requested: ensure slippage/destAmount don't coexist) ---
        if (txBody.slippage != null && txBody.destAmount != null) {
            console.error(`[TRADE-STEP] Error: Slippage and DestAmount specified simultaneously.`);
            return NextResponse.json({
                ok: false,
                error: "Invalid ParaSwap payload: cannot specify both slippage and destAmount"
            }, { status: 200 });
        }

        console.log(`[TRADE-STEP] ParaSwap Build Req: ${txUrl}`);
        const txRes = await fetch(txUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(txBody),
        });
        const txJsonText = await txRes.text();

        if (!txRes.ok) {
            console.error(`[TRADE-STEP] Error: ParaSwap Build Failed (${txRes.status})`);
            return NextResponse.json({ ok: false, error: `ParaSwap Build Failed (${txRes.status})`, details: txJsonText.slice(0, 200) }, { status: 200 });
        }
        const txData = JSON.parse(txJsonText);
        console.log(`[TRADE-STEP] ParaSwap Build OK. Tx Data ready.`);

        // --- 9. Send Final Swap Transaction ---
        console.log(`[TRADE-STEP] Final Swap Tx sending to ${txData.to}...`);
        const hash = await client.sendTransaction({
            account,
            chain,
            to: txData.to as `0x${string}`,
            data: txData.data as `0x${string}`,
            value: BigInt(txData.value),
            gas: txData.gas ? BigInt(Math.floor(Number(txData.gas) * 1.5)) : undefined,
        });

        console.log(`[TRADE-STEP] SUCCESS. TxHash: ${hash}. Duration: ${Date.now() - startTime}ms`);
        return NextResponse.json({ ok: true, txHash: hash });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        console.error(`[TRADE-API-FATAL] Duration: ${duration}ms. Error:`, error);

        let safeMessage = error.message || "Unknown error during trade execution";
        if (safeMessage.length > 200) safeMessage = safeMessage.substring(0, 200);

        return NextResponse.json({
            ok: false,
            error: safeMessage,
            details: "Check server logs for full trace."
        }, { status: 200 });
    }
}
