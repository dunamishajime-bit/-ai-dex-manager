import { formatUnits, parseUnits } from "viem";
import { TokenInfo } from "@/lib/tokens";

export type QuoteProvider = "paraswap" | "openocean";

export interface NormalizedQuote {
    provider: QuoteProvider;
    expectedOutWei: string;
    gasUnits: string | null;
    gasPriceWei: string | null;
    notionalUsd: number | null;
    srcUsd: number | null;
    destUsd: number | null;
    priceImpactPct: number | null;
    raw: any;
}

export interface ComparedQuotes {
    quotes: NormalizedQuote[];
    bestQuote: NormalizedQuote | null;
    bestProvider: QuoteProvider | null;
    providerEdgeBps: number;
    providerEdgeUsd: number | null;
}

const PARASWAP_API_URL = "https://api.paraswap.io";
const OPENOCEAN_API_URL = "https://open-api.openocean.finance/v4";

const OPENOCEAN_CHAIN_BY_ID: Record<number, string> = {
    56: "bsc",
    42161: "arbitrum",
    8453: "base",
};

function parseNumber(input: unknown): number | null {
    const value = Number(input);
    return Number.isFinite(value) ? value : null;
}

function toUnitAmount(amountWei: string, decimals: number): number {
    try {
        return Number(formatUnits(BigInt(amountWei), decimals));
    } catch {
        return 0;
    }
}

function toUsdPerToken(totalUsd: number | null, amountWei: string, decimals: number): number | null {
    if (!totalUsd || totalUsd <= 0) return null;
    const units = toUnitAmount(amountWei, decimals);
    if (!Number.isFinite(units) || units <= 0) return null;
    return totalUsd / units;
}

export function amountUsdToWei(sizeUsd: number, token: TokenInfo, referenceUsd: number): string | null {
    if (!Number.isFinite(sizeUsd) || sizeUsd <= 0 || !Number.isFinite(referenceUsd) || referenceUsd <= 0) {
        return null;
    }

    const amount = sizeUsd / referenceUsd;
    const precision = Math.min(token.decimals, 8);
    const rounded = amount.toFixed(precision);

    try {
        return parseUnits(rounded, token.decimals).toString();
    } catch {
        return null;
    }
}

export async function fetchParaSwapQuote(params: {
    chainId: number;
    srcToken: TokenInfo;
    destToken: TokenInfo;
    amountWei: string;
}): Promise<NormalizedQuote | null> {
    const { chainId, srcToken, destToken, amountWei } = params;
    const url =
        `${PARASWAP_API_URL}/prices?srcToken=${srcToken.address}`
        + `&destToken=${destToken.address}`
        + `&amount=${amountWei}`
        + `&network=${chainId}`
        + `&side=SELL`
        + `&srcDecimals=${srcToken.decimals}`
        + `&destDecimals=${destToken.decimals}`;

    const response = await fetch(url, { cache: "no-store" });
    const raw = await response.json().catch(() => null);
    const route = raw?.priceRoute;

    if (!response.ok || !route?.destAmount) {
        return null;
    }

    const srcUsdTotal = parseNumber(route.srcUSD ?? route.srcAmountUSD);
    const destUsdTotal = parseNumber(route.destUSD ?? route.destAmountUSD);

    return {
        provider: "paraswap",
        expectedOutWei: String(route.destAmount),
        gasUnits: route.gasCost != null ? String(route.gasCost) : null,
        gasPriceWei: route.gasPrice != null ? String(route.gasPrice) : null,
        notionalUsd: srcUsdTotal,
        srcUsd: toUsdPerToken(srcUsdTotal, amountWei, srcToken.decimals),
        destUsd: toUsdPerToken(destUsdTotal, String(route.destAmount), destToken.decimals),
        priceImpactPct: parseNumber(route.priceImpact),
        raw,
    };
}

export async function fetchOpenOceanQuote(params: {
    chainId: number;
    srcToken: TokenInfo;
    destToken: TokenInfo;
    amountWei: string;
    gasPriceWei?: string;
    slippagePct?: string;
    account?: string;
}): Promise<NormalizedQuote | null> {
    const { chainId, srcToken, destToken, amountWei, gasPriceWei, slippagePct, account } = params;
    const chain = OPENOCEAN_CHAIN_BY_ID[chainId];
    if (!chain) return null;

    const search = new URLSearchParams({
        inTokenAddress: srcToken.address,
        outTokenAddress: destToken.address,
        amountDecimals: amountWei,
        gasPriceDecimals: gasPriceWei || "1000000000",
        slippage: slippagePct || "1",
    });

    if (account) {
        search.set("account", account);
    }

    const url = `${OPENOCEAN_API_URL}/${chain}/swap?${search.toString()}`;
    const response = await fetch(url, { cache: "no-store" });
    const raw = await response.json().catch(() => null);
    const data = raw?.data;

    if (!response.ok || Number(raw?.code) !== 200 || !data?.outAmount) {
        return null;
    }

    const srcUsd = parseNumber(data?.inToken?.usd);
    const destUsd = parseNumber(data?.outToken?.usd);

    return {
        provider: "openocean",
        expectedOutWei: String(data.outAmount),
        gasUnits: data.estimatedGas != null ? String(Math.ceil(Number(data.estimatedGas))) : null,
        gasPriceWei: gasPriceWei || null,
        notionalUsd: srcUsd ? srcUsd * toUnitAmount(amountWei, srcToken.decimals) : null,
        srcUsd,
        destUsd,
        priceImpactPct: parseNumber(data.price_impact),
        raw,
    };
}

export async function getComparedQuotes(params: {
    chainId: number;
    srcToken: TokenInfo;
    destToken: TokenInfo;
    amountWei: string;
    gasPriceWei?: string;
    slippageBps?: number;
    account?: string;
}): Promise<ComparedQuotes> {
    const { chainId, srcToken, destToken, amountWei, gasPriceWei, slippageBps, account } = params;
    const slippagePct = Math.max(0.05, Number((slippageBps ?? 100) / 100)).toString();

    const [paraswapQuote, openOceanQuote] = await Promise.all([
        fetchParaSwapQuote({ chainId, srcToken, destToken, amountWei }).catch(() => null),
        fetchOpenOceanQuote({
            chainId,
            srcToken,
            destToken,
            amountWei,
            gasPriceWei,
            slippagePct,
            account,
        }).catch(() => null),
    ]);

    const quotes = [paraswapQuote, openOceanQuote]
        .filter((quote): quote is NormalizedQuote => Boolean(quote))
        .sort((left, right) => {
            const leftOut = BigInt(left.expectedOutWei);
            const rightOut = BigInt(right.expectedOutWei);
            if (leftOut === rightOut) return 0;
            return leftOut > rightOut ? -1 : 1;
        });

    const bestQuote = quotes[0] ?? null;
    const secondQuote = quotes[1] ?? null;
    const bestProvider = bestQuote?.provider ?? null;

    let providerEdgeBps = 0;
    let providerEdgeUsd: number | null = null;

    if (bestQuote && secondQuote) {
        const bestOut = BigInt(bestQuote.expectedOutWei);
        const altOut = BigInt(secondQuote.expectedOutWei);
        if (altOut > 0n && bestOut > altOut) {
            providerEdgeBps = Number(((bestOut - altOut) * 10_000n) / altOut);

            const bestOutUnits = toUnitAmount(bestQuote.expectedOutWei, destToken.decimals);
            const altOutUnits = toUnitAmount(secondQuote.expectedOutWei, destToken.decimals);
            const destUsd = bestQuote.destUsd ?? secondQuote.destUsd ?? null;
            if (destUsd) {
                providerEdgeUsd = (bestOutUnits - altOutUnits) * destUsd;
            }
        }
    }

    return {
        quotes,
        bestQuote,
        bestProvider,
        providerEdgeBps,
        providerEdgeUsd,
    };
}
