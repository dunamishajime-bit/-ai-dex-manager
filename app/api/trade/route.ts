import { NextRequest, NextResponse } from "next/server";
import { resolveToken, NATIVE_TOKEN_ADDRESS } from "@/lib/tokens";
import { isSupportedChain } from "@/lib/chains";
import { createWalletClient, http, publicActions, parseUnits, formatUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, arbitrum, base } from "viem/chains";
import { BOT_CONFIG } from "@/config/botConfig";
import {
    getHybridSlippageBps,
    RECLAIM_HYBRID_EXECUTION_PROFILE,
} from "@/config/reclaimHybridStrategy";
import { fetchOpenOceanQuote, getComparedQuotes, QuoteProvider } from "@/lib/quote-providers";

export const runtime = "nodejs";

const PARASWAP_API_URL = "https://api.paraswap.io";
const TRADE_COOLDOWN_SEC = 12;
const DEFAULT_GAS_LIMIT = 350000n;
const BNB_GAS_RESERVE_USD = RECLAIM_HYBRID_EXECUTION_PROFILE.gasReserveUsd;
const STABLE_ROUTE_SYMBOLS = ["USDT", "USDC", "USD1", "BUSD", "FDUSD", "DAI"] as const;

function isStableRouteSymbol(symbol: string): boolean {
    return STABLE_ROUTE_SYMBOLS.includes(symbol.toUpperCase() as (typeof STABLE_ROUTE_SYMBOLS)[number]);
}

function getStableRouteFallback(chainId: number): string | null {
    const preferred = [RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol, "USD1", "USDC"];
    for (const symbol of preferred) {
        try {
            resolveToken(symbol, chainId);
            return symbol;
        } catch {
            continue;
        }
    }
    return null;
}

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

function summarizeTradeError(error: unknown) {
    const candidate = error as {
        shortMessage?: string;
        message?: string;
        details?: string;
        cause?: { shortMessage?: string; message?: string };
    };

    const message =
        candidate?.shortMessage
        || candidate?.details
        || candidate?.cause?.shortMessage
        || candidate?.cause?.message
        || candidate?.message
        || "Unknown error during trade execution";

    return String(message).slice(0, 240);
}

interface TokenOverrideInfo {
    address: string;
    decimals?: number;
}

function normalizeTokenOverride(input: any): TokenOverrideInfo | undefined {
    if (!input || typeof input.address !== "string" || input.address.length === 0) {
        return undefined;
    }

    const decimals = Number(input.decimals);
    return {
        address: input.address,
        decimals: Number.isFinite(decimals) ? decimals : undefined,
    };
}

async function resolveTradeTokenInfo(
    symbol: string,
    chainId: number,
    client: any,
    override?: TokenOverrideInfo,
) {
    if (!override?.address) {
        return resolveToken(symbol, chainId);
    }

    let decimals: number | undefined = override.decimals;
    if (!Number.isFinite(decimals) && override.address.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()) {
        try {
            const rawDecimals = await client.readContract({
                address: override.address as `0x${string}`,
                abi: erc20Abi,
                functionName: "decimals",
            });
            decimals = Number(rawDecimals);
        } catch {
            decimals = undefined;
        }
    }

    return {
        address: override.address,
        decimals: Number.isFinite(decimals) ? Number(decimals) : 18,
    };
}

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    let requestPayload: any = {};
    let acquiredExecutionSlot = false;
    let localExecutionKey = "";

    try {
        requestPayload = await req.json();
        const { chainId, srcSymbol, destSymbol, amountWei, fromAddress } = requestPayload;
        const action = String(requestPayload.action || "").toUpperCase();
        const requestedProvider = String(requestPayload.provider || "best").toLowerCase();
        const normalizedSrcSymbol = String(srcSymbol || "").toUpperCase();
        const normalizedDestSymbol = String(destSymbol || "").toUpperCase();
        const srcTokenOverride = normalizeTokenOverride(requestPayload.srcTokenOverride);
        const destTokenOverride = normalizeTokenOverride(requestPayload.destTokenOverride);
        const shouldRouteSellViaStable =
            action === "SELL"
            && !isStableRouteSymbol(normalizedSrcSymbol)
            && !isStableRouteSymbol(normalizedDestSymbol);
        const reroutedDestSymbol = shouldRouteSellViaStable
            ? getStableRouteFallback(chainId)
            : null;
        const effectiveDestSymbol = reroutedDestSymbol || normalizedDestSymbol;

        // --- 1. Payload Logging (Safety first, no secrets) ---
        console.log(`[TRADE-REQ] Received. Chain:${chainId}, Pair:${normalizedSrcSymbol}->${normalizedDestSymbol}, EffectiveDest:${effectiveDestSymbol}, AmountWei:${amountWei}, From:${fromAddress}, Action:${action || "N/A"}`);

        // --- 2. Cooldown Guard (per fromAddress+pair) ---
        const cooldownKey = `cooldown:trade:${fromAddress}:${chainId}:${normalizedSrcSymbol}:${effectiveDestSymbol}`;
        localExecutionKey = `${chainId}-${fromAddress}-${normalizedSrcSymbol}-${effectiveDestSymbol}`;

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

        // --- 3. Validation ---
        if (!isSupportedChain(chainId)) {
            console.warn(`[TRADE-STEP] Error: Unsupported Chain ${chainId}`);
            return NextResponse.json({ ok: false, error: `Chain ${chainId} not supported` }, { status: 200 });
        }

        // --- 4. Private Key & Address Verification ---
        const rawVar = process.env.TRADER_PRIVATE_KEY || process.env.EXECUTION_PRIVATE_KEY || "";
        const rawPKString = String(rawVar).trim();
        const hexPK = rawPKString.startsWith("0x") ? rawPKString.slice(2) : rawPKString;
        const privateKey = `0x${hexPK}` as `0x${string}`;

        if (!hexPK || hexPK.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hexPK)) {
            console.error(`[TRADE-STEP] Error: Invalid PK configuration`);
            return NextResponse.json({ ok: false, error: "Server-side private key is missing or invalid format" }, { status: 200 });
        }

        const defaultBscRpc = "https://bsc-dataseed.binance.org";
        const rpcUrl =
            chainId === 56
                ? process.env.RPC_URL_BSC?.trim() || defaultBscRpc
                : chainId === 42161
                    ? process.env.RPC_URL_ARBITRUM
                    : chainId === 8453
                        ? process.env.RPC_URL_BASE
                        : "";
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
        const chainMapping: Record<number, any> = { 56: bsc, 42161: arbitrum, 8453: base };
        const chain = chainMapping[chainId];
        const nativeSymbolByChain: Record<number, string> = {
            56: "BNB",
            42161: "ETH",
            8453: "ETH",
        };
        const nativeSymbol = nativeSymbolByChain[chainId] || "ETH";

        const client = createWalletClient({
            account,
            chain,
            transport: http(rpcUrl, { timeout: 30000 })
        }).extend(publicActions);

        const srcTokenInfo = await resolveTradeTokenInfo(normalizedSrcSymbol, chainId, client, srcTokenOverride);
        const destTokenInfo = await resolveTradeTokenInfo(effectiveDestSymbol, chainId, client, destTokenOverride);
        console.log(`[TRADE-STEP] Registry resolved: ${normalizedSrcSymbol}(${srcTokenInfo.address}) -> ${effectiveDestSymbol}(${destTokenInfo.address})`);

        // --- 5b. Source Token Balance Precheck ---
        const requiredAmount = BigInt(amountWei);
        const isSourceNative = srcTokenInfo.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
        if (isSourceNative) {
            const nativeBalance = await client.getBalance({ address: account.address });
            let tradableNativeBalance = nativeBalance;
            if (chainId === 56 && normalizedSrcSymbol === "BNB") {
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
                        error: chainId === 56 && normalizedSrcSymbol === "BNB"
                            ? "Insufficient BNB balance after gas reserve"
                            : `Insufficient ${normalizedSrcSymbol} balance`,
                        details: chainId === 56 && normalizedSrcSymbol === "BNB"
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
                    { ok: false, error: `Insufficient ${normalizedSrcSymbol} balance`, details: `need=${required}, have=${available}` },
                    { status: 200 },
                );
            }
        }

        const pairKey = [normalizedSrcSymbol, effectiveDestSymbol].sort().join("_") as keyof typeof BOT_CONFIG.SLIPPAGE;
        const slippageBps = BOT_CONFIG.SLIPPAGE[pairKey] ?? getHybridSlippageBps(normalizedSrcSymbol, effectiveDestSymbol);
        const currentGasPrice = await client.getGasPrice();
        const comparedQuotes = await getComparedQuotes({
            chainId,
            srcToken: srcTokenInfo,
            destToken: destTokenInfo,
            amountWei,
            gasPriceWei: currentGasPrice.toString(),
            slippageBps,
        });

        if (!comparedQuotes.bestQuote || !comparedQuotes.bestProvider) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "No executable quote available",
                    details: "ParaSwap / OpenOcean の両方で実行可能な見積りを取得できませんでした。",
                    executedDestSymbol: effectiveDestSymbol,
                    reroutedSellToStable: Boolean(reroutedDestSymbol),
                },
                { status: 200 },
            );
        }

        let selectedProvider: QuoteProvider;
        if (requestedProvider === "paraswap" || requestedProvider === "openocean") {
            selectedProvider = requestedProvider;
        } else {
            selectedProvider = comparedQuotes.bestProvider;
            const notionalUsd = comparedQuotes.bestQuote.notionalUsd ?? null;
            const isSmallWalletTrade =
                Number.isFinite(notionalUsd) && Number(notionalUsd) > 0
                    ? Number(notionalUsd) <= BOT_CONFIG.ARBITRAGE.SMALL_WALLET_MAX_USD
                    : false;

            if (
                selectedProvider === "openocean"
                && comparedQuotes.providerEdgeBps < BOT_CONFIG.ROUTE_COMPARE.MIN_SWITCH_EDGE_BPS
            ) {
                selectedProvider = "paraswap";
            }

            if (
                selectedProvider === "openocean"
                && isSmallWalletTrade
                && comparedQuotes.providerEdgeUsd != null
                && comparedQuotes.providerEdgeUsd < BOT_CONFIG.ROUTE_COMPARE.MIN_SWITCH_EDGE_USD_SMALL
            ) {
                selectedProvider = "paraswap";
            }
        }

        const routeCompareSummary = {
            requestedProvider,
            selectedProvider,
            bestProvider: comparedQuotes.bestProvider,
            providerEdgeBps: comparedQuotes.providerEdgeBps,
            providerEdgeUsd: comparedQuotes.providerEdgeUsd,
            effectiveDestSymbol,
            reroutedSellToStable: Boolean(reroutedDestSymbol),
        };
        console.log(`[TRADE-STEP] Route comparison: ${JSON.stringify(routeCompareSummary)}`);

        let txData: any = null;
        let approvalTarget: string | null = null;
        let selectedPriceRoute: any = null;

        if (selectedProvider === "openocean") {
            const ooQuote = await fetchOpenOceanQuote({
                chainId,
                srcToken: srcTokenInfo,
                destToken: destTokenInfo,
                amountWei,
                gasPriceWei: currentGasPrice.toString(),
                slippagePct: Math.max(0.05, slippageBps / 100).toString(),
                account: account.address,
            });

            const ooData = ooQuote?.raw?.data;
            if (!ooQuote || !ooData?.to || !ooData?.data) {
                if (requestedProvider === "best") {
                    console.warn("[TRADE-STEP] OpenOcean build failed. Falling back to ParaSwap.");
                    selectedProvider = "paraswap";
                } else {
                    return NextResponse.json({ ok: false, error: "OpenOcean build failed" }, { status: 200 });
                }
            } else {
                txData = ooData;
                approvalTarget = String(ooData.to);
            }
        }

        if (selectedProvider === "paraswap") {
            const priceUrl = `${PARASWAP_API_URL}/prices?srcToken=${srcTokenInfo.address}&destToken=${destTokenInfo.address}&amount=${amountWei}&network=${chainId}&side=SELL&srcDecimals=${srcTokenInfo.decimals}&destDecimals=${destTokenInfo.decimals}`;

            console.log(`[TRADE-STEP] ParaSwap Quote Req URL: ${priceUrl}`);
            const priceRes = await fetch(priceUrl);
            const priceJsonText = await priceRes.text();

            if (!priceRes.ok) {
                console.warn(`[TRADE-STEP] Error: Extra ParaSwap Quote Failed (${priceRes.status})`);
                const maxImpact = /ESTIMATED_LOSS_GREATER_THAN_MAX_IMPACT|MAX_IMPACT|price impact/i.test(priceJsonText);
                return NextResponse.json(
                    {
                        ok: false,
                        error: maxImpact
                            ? `ParaSwap Quote Failed (${priceRes.status}) [MAX_IMPACT]`
                            : `ParaSwap Quote Failed (${priceRes.status})`,
                        code: maxImpact ? "MAX_IMPACT" : undefined,
                        details: priceJsonText.slice(0, 200),
                    },
                    { status: 200 },
                );
            }
            const priceData = JSON.parse(priceJsonText);
            selectedPriceRoute = priceData.priceRoute;
            console.log(`[TRADE-STEP] ParaSwap Quote OK. PriceRoute identified.`);
            approvalTarget = selectedPriceRoute?.tokenTransferProxy || null;
        }

        // --- 7. Allowance Check & Approve ---
        const isNative = srcTokenInfo.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
        if (!isNative) {
            const tokenTransferProxy = approvalTarget;
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

        // --- 8. Transaction Build ---
        if (selectedProvider === "paraswap") {
            const txUrl = `${PARASWAP_API_URL}/transactions/${chainId}`;
            const txBody: any = {
                srcToken: srcTokenInfo.address,
                destToken: destTokenInfo.address,
                srcAmount: amountWei,
                userAddress: account.address,
                priceRoute: selectedPriceRoute,
                srcDecimals: srcTokenInfo.decimals,
                destDecimals: destTokenInfo.decimals,
                slippage: slippageBps,
                partner: "dis-terminal",
            };

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

            txData = JSON.parse(txJsonText);
            console.log(`[TRADE-STEP] ParaSwap Build OK. Tx Data ready.`);
        }

        // --- 9. Send Final Swap Transaction ---
        const nativeBalanceBeforeSend = await client.getBalance({ address: account.address });
        const txValue = BigInt(txData.value || "0");
        const gasField = txData.gas ?? txData.estimatedGas;
        let gasLimit = gasField ? BigInt(Math.floor(Number(gasField) * 1.35)) : DEFAULT_GAS_LIMIT;
        let gasPrice: bigint;
        try {
            gasPrice = txData.gasPrice ? BigInt(txData.gasPrice) : currentGasPrice;
        } catch {
            gasPrice = currentGasPrice;
        }

        try {
            const estimatedGas = await client.estimateGas({
                account,
                to: txData.to as `0x${string}`,
                data: txData.data as `0x${string}`,
                value: txValue,
            });
            const paddedEstimate = (estimatedGas * 125n) / 100n;
            if (paddedEstimate > gasLimit) {
                gasLimit = paddedEstimate;
            }
        } catch (estimateError) {
            const safeMessage = summarizeTradeError(estimateError);
            console.warn(`[TRADE-STEP] Preflight simulation failed: ${safeMessage}`);
            return NextResponse.json(
                {
                    ok: false,
                    error: `Trade simulation failed: ${safeMessage}`,
                    code: "SIMULATION_FAILED",
                    provider: selectedProvider,
                    routeCompare: routeCompareSummary,
                },
                { status: 200 },
            );
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

        try {
            const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
            if (receipt.status !== "success") {
                return NextResponse.json({
                    ok: false,
                    error: "Transaction reverted on-chain",
                    code: "TX_REVERTED",
                    txHash: hash,
                    provider: selectedProvider,
                    routeCompare: routeCompareSummary,
                    executedDestSymbol: effectiveDestSymbol,
                    reroutedSellToStable: Boolean(reroutedDestSymbol),
                    receiptStatus: "reverted",
                }, { status: 200 });
            }
        } catch (receiptError) {
            const safeMessage = summarizeTradeError(receiptError);
            return NextResponse.json({
                ok: false,
                error: `Transaction confirmation failed: ${safeMessage}`,
                code: "TX_CONFIRM_FAILED",
                txHash: hash,
                provider: selectedProvider,
                routeCompare: routeCompareSummary,
                executedDestSymbol: effectiveDestSymbol,
                reroutedSellToStable: Boolean(reroutedDestSymbol),
            }, { status: 200 });
        }

        console.log(`[TRADE-STEP] SUCCESS. TxHash: ${hash}. Duration: ${Date.now() - startTime}ms`);
        return NextResponse.json({
            ok: true,
            txHash: hash,
            provider: selectedProvider,
            routeCompare: routeCompareSummary,
            executedDestSymbol: effectiveDestSymbol,
            reroutedSellToStable: Boolean(reroutedDestSymbol),
            receiptStatus: "success",
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        console.error(`[TRADE-API-FATAL] Duration: ${duration}ms. Error:`, error);

        const safeMessage = summarizeTradeError(error);

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
