import { createWalletClient, erc20Abi, formatUnits, http, parseUnits, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, base, bsc } from "viem/chains";

import { BOT_CONFIG } from "@/config/botConfig";
import { getHybridSlippageBps, RECLAIM_HYBRID_EXECUTION_PROFILE } from "@/config/reclaimHybridStrategy";
import { isSupportedChain } from "@/lib/chains";
import { fetchOpenOceanQuote, getComparedQuotes, type QuoteProvider } from "@/lib/quote-providers";
import { NATIVE_TOKEN_ADDRESS, resolveToken } from "@/lib/tokens";

const PARASWAP_API_URL = "https://api.paraswap.io";
const DEFAULT_BSC_RPC = "https://bsc-dataseed.binance.org";
const DEFAULT_GAS_LIMIT = 350000n;
const BNB_GAS_RESERVE_USD = RECLAIM_HYBRID_EXECUTION_PROFILE.gasReserveUsd;

export interface DirectWalletTradeInput {
    chainId: number;
    privateKey: `0x${string}`;
    fromAddress: `0x${string}`;
    srcSymbol: string;
    destSymbol: string;
    amountWei: string;
    action?: "BUY" | "SELL";
}

export interface DirectWalletTradeResult {
    ok: boolean;
    txHash?: string;
    provider?: QuoteProvider;
    executedDestSymbol?: string;
    reroutedSellToStable?: boolean;
    quotedSourceAmount?: number;
    quotedDestAmount?: number;
    quotedSourceUsdValue?: number;
    quotedDestUsdValue?: number;
    details?: string;
    error?: string;
}

interface TokenOverrideInfo {
    address: string;
    decimals?: number;
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

function isStableRouteSymbol(symbol: string): boolean {
    return ["USDT", "USDC", "USD1", "BUSD", "FDUSD", "DAI"].includes(symbol.toUpperCase());
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

export async function executeDirectWalletTrade(input: DirectWalletTradeInput): Promise<DirectWalletTradeResult> {
    const { chainId, privateKey, fromAddress } = input;
    const action = String(input.action || "").toUpperCase();
    const normalizedSrcSymbol = String(input.srcSymbol || "").toUpperCase();
    const normalizedDestSymbol = String(input.destSymbol || "").toUpperCase();
    const shouldRouteSellViaStable =
        action === "SELL"
        && !isStableRouteSymbol(normalizedSrcSymbol)
        && !isStableRouteSymbol(normalizedDestSymbol);
    const reroutedDestSymbol = shouldRouteSellViaStable ? getStableRouteFallback(chainId) : null;
    const effectiveDestSymbol = reroutedDestSymbol || normalizedDestSymbol;

    if (!isSupportedChain(chainId)) {
        return { ok: false, error: `Chain ${chainId} not supported` };
    }

    const rpcUrl =
        chainId === 56
            ? process.env.RPC_URL_BSC?.trim() || DEFAULT_BSC_RPC
            : chainId === 42161
                ? process.env.RPC_URL_ARBITRUM
                : chainId === 8453
                    ? process.env.RPC_URL_BASE
                    : "";
    if (!rpcUrl) {
        return { ok: false, error: "RPC URL not configured for this chain" };
    }

    const account = privateKeyToAccount(privateKey);
    if (account.address.toLowerCase() !== fromAddress.toLowerCase()) {
        return { ok: false, error: "Security Check Failed: Wallet address mismatch" };
    }

    const chainMapping: Record<number, any> = { 56: bsc, 42161: arbitrum, 8453: base };
    const chain = chainMapping[chainId];
    const nativeSymbolByChain: Record<number, string> = { 56: "BNB", 42161: "ETH", 8453: "ETH" };
    const nativeSymbol = nativeSymbolByChain[chainId] || "ETH";

    try {
        const client = createWalletClient({
            account,
            chain,
            transport: http(rpcUrl, { timeout: 30000 }),
        }).extend(publicActions);

        const srcTokenInfo = await resolveTradeTokenInfo(normalizedSrcSymbol, chainId, client);
        const destTokenInfo = await resolveTradeTokenInfo(effectiveDestSymbol, chainId, client);
        const requiredAmount = BigInt(input.amountWei);
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
                return {
                    ok: false,
                    error: chainId === 56 && normalizedSrcSymbol === "BNB"
                        ? "Insufficient BNB balance after gas reserve"
                        : `Insufficient ${normalizedSrcSymbol} balance`,
                    details: `need=${required}, have=${available}`,
                };
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
                return { ok: false, error: `Insufficient ${normalizedSrcSymbol} balance`, details: `need=${required}, have=${available}` };
            }
        }

        const pairKey = [normalizedSrcSymbol, effectiveDestSymbol].sort().join("_") as keyof typeof BOT_CONFIG.SLIPPAGE;
        const slippageBps = BOT_CONFIG.SLIPPAGE[pairKey] ?? getHybridSlippageBps(normalizedSrcSymbol, effectiveDestSymbol);
        const currentGasPrice = await client.getGasPrice();
        const comparedQuotes = await getComparedQuotes({
            chainId,
            srcToken: srcTokenInfo,
            destToken: destTokenInfo,
            amountWei: input.amountWei,
            gasPriceWei: currentGasPrice.toString(),
            slippageBps,
            account: account.address,
        });

        if (!comparedQuotes.bestQuote || !comparedQuotes.bestProvider) {
            return { ok: false, error: "No executable quote available" };
        }

        let selectedProvider: QuoteProvider = comparedQuotes.bestProvider;
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

        let txData: any = null;
        let approvalTarget: string | null = null;
        let selectedPriceRoute: any = null;

        if (selectedProvider === "openocean") {
            const ooQuote = await fetchOpenOceanQuote({
                chainId,
                srcToken: srcTokenInfo,
                destToken: destTokenInfo,
                amountWei: input.amountWei,
                gasPriceWei: currentGasPrice.toString(),
                slippagePct: Math.max(0.05, slippageBps / 100).toString(),
                account: account.address,
            });

            const ooData = ooQuote?.raw?.data;
            if (!ooQuote || !ooData?.to || !ooData?.data) {
                selectedProvider = "paraswap";
            } else {
                txData = ooData;
                approvalTarget = String(ooData.to);
            }
        }

        if (selectedProvider === "paraswap") {
            const priceUrl = `${PARASWAP_API_URL}/prices?srcToken=${srcTokenInfo.address}&destToken=${destTokenInfo.address}&amount=${input.amountWei}&network=${chainId}&side=SELL&srcDecimals=${srcTokenInfo.decimals}&destDecimals=${destTokenInfo.decimals}`;
            const priceRes = await fetch(priceUrl);
            const priceJsonText = await priceRes.text();
            if (!priceRes.ok) {
                return { ok: false, error: `ParaSwap Quote Failed (${priceRes.status})`, details: priceJsonText.slice(0, 200) };
            }
            const priceData = JSON.parse(priceJsonText);
            selectedPriceRoute = priceData.priceRoute;
            approvalTarget = selectedPriceRoute?.tokenTransferProxy || null;
        }

        if (!isSourceNative && approvalTarget) {
            const allowance = await client.readContract({
                address: srcTokenInfo.address as `0x${string}`,
                abi: erc20Abi,
                functionName: "allowance",
                args: [account.address, approvalTarget as `0x${string}`],
            });

            if (allowance < BigInt(input.amountWei)) {
                const approveHash = await client.writeContract({
                    address: srcTokenInfo.address as `0x${string}`,
                    abi: erc20Abi,
                    functionName: "approve",
                    args: [approvalTarget as `0x${string}`, BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")],
                    account,
                    chain,
                });
                await client.waitForTransactionReceipt({ hash: approveHash });
            }
        }

        if (selectedProvider === "paraswap") {
            const txUrl = `${PARASWAP_API_URL}/transactions/${chainId}`;
            const txBody: any = {
                srcToken: srcTokenInfo.address,
                destToken: destTokenInfo.address,
                srcAmount: input.amountWei,
                userAddress: account.address,
                priceRoute: selectedPriceRoute,
                srcDecimals: srcTokenInfo.decimals,
                destDecimals: destTokenInfo.decimals,
                slippage: slippageBps,
                partner: "dis-terminal",
            };

            const buildTransaction = async (url: string, body: Record<string, unknown>) => {
                const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                const rawText = await response.text();
                return { response, rawText };
            };

            let { response: txRes, rawText: txJsonText } = await buildTransaction(txUrl, txBody);
            if (!txRes.ok) {
                const retryUrl = `${txUrl}?ignoreChecks=true&ignoreGasEstimate=true`;
                const retryResult = await buildTransaction(retryUrl, txBody);
                txRes = retryResult.response;
                txJsonText = retryResult.rawText;
            }
            if (!txRes.ok) {
                return { ok: false, error: `ParaSwap Build Failed (${txRes.status})`, details: txJsonText.slice(0, 600) };
            }
            txData = JSON.parse(txJsonText);
        }

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
            return { ok: false, error: `Trade simulation failed: ${summarizeTradeError(estimateError)}` };
        }

        const estimatedNativeRequired = txValue + (gasLimit * gasPrice);
        if (nativeBalanceBeforeSend < estimatedNativeRequired) {
            const required = Number(formatUnits(estimatedNativeRequired, 18));
            const available = Number(formatUnits(nativeBalanceBeforeSend, 18));
            return {
                ok: false,
                error: `Insufficient ${nativeSymbol} for gas`,
                details: `need=${required.toFixed(6)} ${nativeSymbol}, have=${available.toFixed(6)} ${nativeSymbol}`,
            };
        }

        const hash = await client.sendTransaction({
            account,
            chain,
            to: txData.to as `0x${string}`,
            data: txData.data as `0x${string}`,
            value: txValue,
            gas: gasLimit,
        });

        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
        if (receipt.status !== "success") {
            return { ok: false, error: "Transaction reverted on-chain", txHash: hash };
        }

        return {
            ok: true,
            txHash: hash,
            provider: selectedProvider,
            executedDestSymbol: effectiveDestSymbol,
            reroutedSellToStable: Boolean(reroutedDestSymbol),
            quotedSourceAmount: Number(formatUnits(BigInt(input.amountWei), srcTokenInfo.decimals)),
            quotedDestAmount: Number(formatUnits(BigInt(comparedQuotes.bestQuote.expectedOutWei), destTokenInfo.decimals)),
            quotedSourceUsdValue: comparedQuotes.bestQuote.notionalUsd ?? undefined,
            quotedDestUsdValue:
                comparedQuotes.bestQuote.destUsd != null
                    ? Number(formatUnits(BigInt(comparedQuotes.bestQuote.expectedOutWei), destTokenInfo.decimals)) * comparedQuotes.bestQuote.destUsd
                    : undefined,
        };
    } catch (error) {
        return { ok: false, error: summarizeTradeError(error) };
    }
}
