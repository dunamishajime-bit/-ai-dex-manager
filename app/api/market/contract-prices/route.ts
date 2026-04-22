import { NextRequest, NextResponse } from "next/server";
import { NATIVE_TOKEN_ADDRESS, TOKEN_REGISTRY } from "@/lib/tokens";
import {
    getContractPricesByAddress,
    normalizeContractPriceAddress,
    normalizeContractPriceSymbol,
} from "@/lib/contract-prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
    "Cache-Control": "public, s-maxage=45, stale-while-revalidate=120",
};

const WRAPPED_NATIVE_ADDRESS_BY_CHAIN: Record<number, string> = {
    56: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    137: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
};

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = req.nextUrl;
        const chainId = Number(searchParams.get("chainId"));
        const symbols = (searchParams.get("symbols") || "")
            .split(",")
            .map((symbol) => normalizeContractPriceSymbol(symbol, chainId))
            .filter(Boolean);
        const keyedAddresses = searchParams.getAll("address")
            .map((address, index) => {
                const normalizedAddress = normalizeContractPriceAddress(chainId, String(address || ""));
                if (!normalizedAddress) return null;
                const key = normalizeContractPriceSymbol(searchParams.getAll("key")[index] || normalizedAddress, chainId);
                return { key, address: normalizedAddress };
            })
            .filter((entry): entry is { key: string; address: string } => Boolean(entry));

        if (!Number.isFinite(chainId) || (symbols.length === 0 && keyedAddresses.length === 0)) {
            return NextResponse.json({}, { headers: RESPONSE_HEADERS });
        }

        const registry = TOKEN_REGISTRY[chainId] || {};

        const symbolByAddress = new Map<string, string>();
        symbols.forEach((symbol) => {
            const tokenInfo = registry[symbol];
            if (!tokenInfo) return;

            const wrappedNative = WRAPPED_NATIVE_ADDRESS_BY_CHAIN[chainId];
            const resolvedAddress =
                normalizeContractPriceAddress(chainId, tokenInfo.address) === NATIVE_TOKEN_ADDRESS.toLowerCase() && wrappedNative
                    ? wrappedNative
                    : tokenInfo.address;
            const normalizedAddress = normalizeContractPriceAddress(chainId, resolvedAddress);
            symbolByAddress.set(normalizedAddress, symbol);
        });
        keyedAddresses.forEach(({ key, address }) => {
            symbolByAddress.set(normalizeContractPriceAddress(chainId, address), key);
        });

        const pricesBySymbol = await getContractPricesByAddress(
            chainId,
            Array.from(symbolByAddress.entries()).map(([address, key]) => ({ address, key })),
        );
        if (Object.keys(pricesBySymbol).length === 0) {
            return NextResponse.json({}, { headers: RESPONSE_HEADERS });
        }
        return NextResponse.json(pricesBySymbol, { headers: RESPONSE_HEADERS });
    } catch (error) {
        console.error("[ContractPrices] Failed:", error);
        return NextResponse.json({ ok: false, error: "Failed to fetch contract prices" }, { status: 500, headers: RESPONSE_HEADERS });
    }
}
