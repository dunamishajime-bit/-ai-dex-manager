import { NextRequest, NextResponse } from "next/server";
import { resolveToken, NATIVE_TOKEN_ADDRESS } from "@/lib/tokens";
import { isSupportedChain } from "@/lib/chains";
import { createWalletClient, http, publicActions, parseUnits, formatUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, polygon, arbitrum, base } from "viem/chains";
import { BOT_CONFIG } from "@/config/botConfig";

export const runtime = "nodejs";

const PARASWAP_API_URL = "https://api.paraswap.io";
const TRADE_COOLDOWN_SEC = 12;
const DEFAULT_GAS_LIMIT = 350000n;
const BNB_GAS_RESERVE_USD = 1.0;

async function getBnbGasReserveWei(): Promise<bigint> {
    try {
        const priceRes = await fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd",
            { cache: "no-store" },
        );
        const priceJson = await priceRes.json();
        const bnbUsd = Number(priceJson?.binancecoin?.usd);
        if (!Number.isFinite(bnbUsd) || bnbUsd <= 0) throw new Error("invalid bnb usd");

        const reserveBnb = Math.max(0.0005, (BNB_GAS_RESERVE_USD / bnbUsd) * 1.02);
        return parseUnits(reserveBnb.toFixed(8), 18);
    } catch {
        return parseUnits("0.00200000", 18);
    }
}

// --- Module Scope Execution Guards ---
const localSuccessCooldown = new Map<string, number>();
const localInFlightTrades = new Set<string>();
function isLocalSuccessCooldownActive(key: string, sec = TRADE_COOLDOWN_SEC): boolean {
    const now = Date.now();
    const last = localSuccessCooldown.get(key) ?? 0;
    if (now - last < sec * 1000) return true;
    return false;
}
function markLocalSuccessCooldown(key: string) {
    localSuccessCooldown.set(key, Date.now());
}

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    let requestPayload: any = {};
    let acquiredExecutionSlot = false;
    let localExecutionKey = "";

    try {
        requestPayload = await req.json();
        const { chainId, srcSymbol, destSymbol, amountWei, fromAddress } = requestPayload;

        // --- 1. Payload Logging (Safety first, no secrets) ---
        console.log(`[TRADE-REQ] Received. Chain:${chainId}, Pair:${srcSymbol}->${destSymbol}, AmountWei:${amountWei}, From:${fromAddress}`);

        // --- 2. Cooldown Guard (per fromAddress+pair) ---
        const cooldownKey = `cooldown:trade:${fromAddress}:${chainId}:${srcSymbol}:${destSymbol}`;
        localExecutionKey = `${chainId}-${fromAddress}-${srcSymbol}-${destSymbol}`;

        if (localInFlightTrades.has(localExecutionKey)) {
            console.warn(`[TRADE-STEP] Blocked: Local in-flight guard for ${fromAddress}`);
            return NextResponse.json(
                { ok: false, error: "Trade execution already in progress. Please wait a few seconds." },
                { status: 200 },
            );
        }

        if (isLocalSuccessCooldownActive(localExecutionKey, TRADE_COOLDOWN_SEC)) {
            console.warn(`[TRADE-STEP] Blocked: Local success cooldown hit for ${fromAddress}`);
            return NextResponse.json(
                { ok: false, error: `Trade execution restricted. ${TRADE_COOLDOWN_SEC}s cooldown in progress.` },
                { status: 200 },
            );
        }

        localInFlightTrades.add(localExecutionKey);
        acquiredExecutionSlot = true;

        let isDuringCooldown = false;
        let redis: any = null;
        const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
        const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

        if (KV_URL && KV_TOKEN) {
            try {
                const { Redis } = await import('@upstash/redis');
                redis = new Redis({ url: KV_URL, token: KV_TOKEN });
                const existing = await redis.get(cooldownKey);
                if (existing) {
                    isDuringCooldown = true;
                }
            } catch (redisErr) {
                console.warn("[TRADE] Redis cooldown check failed, bypassing...", redisErr);
            }
        }

        if (isDuringCooldown) {
            console.warn(`[TRADE-STEP] Blocked: Redis Cooldown active for ${fromAddress}`);
            return NextResponse.json(
                { ok: false, error: `Trade execution restricted. ${TRADE_COOLDOWN_SEC}s cooldown in progress.` },
                { status: 200 },
            );
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
        const nativeSymbolByChain: Record<number, string> = {
            56: "BNB",
            137: "POL",
            42161: "ETH",
            8453: "ETH",
        };
        const nativeSymbol = nativeSymbolByChain[chainId] || "ETH";

        const client = createWalletClient({
            account,
            chain,
            transport: http(rpcUrl, { timeout: 30000 })
        }).extend(publicActions);

        // --- 5b. Source Token Balance Precheck ---
        const requiredAmount = BigInt(amountWei);
        const isSourceNative = srcTokenInfo.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
        if (isSourceNative) {
            const nativeBalance = await client.getBalance({ address: account.address });
            let tradableNativeBalance = nativeBalance;
            if (chainId === 56 && srcSymbol?.toUpperCase() === "BNB") {
                const reserveWei = await getBnbGasReserveWei();
                tradableNativeBalance = nativeBalance > reserveWei ? nativeBalance - reserveWei : 0n;
            }

            if (tradableNativeBalance < requiredAmount) {
                const required = Number(formatUnits(requiredAmount, srcTokenInfo.decimals)).toFixed(6);
                const available = Number(formatUnits(tradableNativeBalance, srcTokenInfo.decimals)).toFixed(6);
                console.warn(`[TRADE-STEP] Blocked: native balance insufficient. need=${required}, have=${available}`);
                return NextResponse.json(
                    {
                        ok: false,
                        error: chainId === 56 && srcSymbol?.toUpperCase() === "BNB"
                            ? "Insufficient BNB balance after gas reserve"
                            : `Insufficient ${srcSymbol} balance`,
                        details: chainId === 56 && srcSymbol?.toUpperCase() === "BNB"
                            ? `need=${required}, tradeable=${available}, reserve≈$${BNB_GAS_RESERVE_USD.toFixed(1)}`
                            : `need=${required}, have=${available}`,
                    },
                    { status: 200 },
                );
            }
        } else {
            const tokenBalance = await client.readContract({
                address: srcTokenInfo.address as `0x${string}`,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [account.address],
            });
            if (tokenBalance < requiredAmount) {
                const required = Number(formatUnits(requiredAmount, srcTokenInfo.decimals)).toFixed(6);
                const available = Number(formatUnits(tokenBalance, srcTokenInfo.decimals)).toFixed(6);
                console.warn(`[TRADE-STEP] Blocked: token balance insufficient. need=${required}, have=${available}`);
                return NextResponse.json(
                    { ok: false, error: `Insufficient ${srcSymbol} balance`, details: `need=${required}, have=${available}` },
                    { status: 200 },
                );
            }
        }

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
        const pairKey = [srcSymbol, destSymbol].sort().join("_") as keyof typeof BOT_CONFIG.SLIPPAGE;
        const slippageBps = BOT_CONFIG.SLIPPAGE[pairKey] ?? 100;
        const txBody: any = {
            srcToken: srcTokenInfo.address,
            destToken: destTokenInfo.address,
            srcAmount: amountWei,
            userAddress: account.address,
            priceRoute: priceRoute,
            srcDecimals: srcTokenInfo.decimals,
            destDecimals: destTokenInfo.decimals,
            slippage: slippageBps,
            partner: "dis-terminal",
        };

        // --- 8b. Re-entrancy / Conflict Guard (As requested: ensure slippage/destAmount don't coexist) ---
        if (txBody.slippage != null && txBody.destAmount != null) {
            console.error(`[TRADE-STEP] Error: Slippage and DestAmount specified simultaneously.`);
            return NextResponse.json({
                ok: false,
                error: "Invalid ParaSwap payload: cannot specify both slippage and destAmount"
            }, { status: 200 });
        }

        const buildTransaction = async (url: string, body: Record<string, unknown>) => {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const rawText = await response.text();
            return { response, rawText };
        };

        console.log(`[TRADE-STEP] ParaSwap Build Req: ${txUrl}`);
        let { response: txRes, rawText: txJsonText } = await buildTransaction(txUrl, txBody);

        if (!txRes.ok) {
            const retryUrl = `${txUrl}?ignoreChecks=true&ignoreGasEstimate=true`;
            console.warn(`[TRADE-STEP] ParaSwap Build retry with relaxed checks: ${retryUrl}`);
            const retryResult = await buildTransaction(retryUrl, txBody);
            txRes = retryResult.response;
            txJsonText = retryResult.rawText;
        }

        if (!txRes.ok) {
            console.error(`[TRADE-STEP] Error: ParaSwap Build Failed (${txRes.status})`);
            return NextResponse.json(
                {
                    ok: false,
                    error: `ParaSwap Build Failed (${txRes.status})`,
                    details: txJsonText.slice(0, 600),
                },
                { status: 200 },
            );
        }

        const txData = JSON.parse(txJsonText);
        console.log(`[TRADE-STEP] ParaSwap Build OK. Tx Data ready.`);

        // --- 9. Send Final Swap Transaction ---
        const nativeBalanceBeforeSend = await client.getBalance({ address: account.address });
        const txValue = BigInt(txData.value || "0");
        const gasLimit = txData.gas ? BigInt(Math.floor(Number(txData.gas) * 1.5)) : DEFAULT_GAS_LIMIT;
        let gasPrice: bigint;
        try {
            gasPrice = txData.gasPrice ? BigInt(txData.gasPrice) : await client.getGasPrice();
        } catch {
            gasPrice = await client.getGasPrice();
        }
        const estimatedNativeRequired = txValue + (gasLimit * gasPrice);

        if (nativeBalanceBeforeSend < estimatedNativeRequired) {
            const required = Number(formatUnits(estimatedNativeRequired, 18));
            const available = Number(formatUnits(nativeBalanceBeforeSend, 18));
            console.warn(
                `[TRADE-STEP] Blocked: native gas balance insufficient. need=${required.toFixed(6)} ${nativeSymbol}, have=${available.toFixed(6)} ${nativeSymbol}`,
            );
            return NextResponse.json(
                {
                    ok: false,
                    error: `Insufficient ${nativeSymbol} for gas`,
                    details: `need=${required.toFixed(6)} ${nativeSymbol}, have=${available.toFixed(6)} ${nativeSymbol}`,
                },
                { status: 200 },
            );
        }

        console.log(`[TRADE-STEP] Final Swap Tx sending to ${txData.to}...`);
        const hash = await client.sendTransaction({
            account,
            chain,
            to: txData.to as `0x${string}`,
            data: txData.data as `0x${string}`,
            value: txValue,
            gas: gasLimit,
        });

        markLocalSuccessCooldown(localExecutionKey);
        if (redis) {
            try {
                await redis.set(cooldownKey, "active", { ex: TRADE_COOLDOWN_SEC });
            } catch (redisErr) {
                console.warn("[TRADE] Failed to persist Redis cooldown after successful trade:", redisErr);
            }
        }

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
    } finally {
        if (acquiredExecutionSlot && localExecutionKey) {
            localInFlightTrades.delete(localExecutionKey);
        }
    }
}
