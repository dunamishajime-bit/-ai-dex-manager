import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, formatUnits, http } from "viem";
import { bsc, polygon } from "viem/chains";
import { ERC20_ABI } from "@/lib/erc20-abi";
import { NATIVE_TOKEN_ADDRESS, TOKEN_REGISTRY } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAIN_CONFIG: Record<number, { rpcUrl?: string; chain: typeof bsc | typeof polygon }> = {
    56: { rpcUrl: process.env.RPC_URL_BSC, chain: bsc },
    137: { rpcUrl: process.env.RPC_URL_POLYGON, chain: polygon },
};

export async function GET(req: NextRequest) {
    try {
        const address = String(req.nextUrl.searchParams.get("address") || "").trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            return NextResponse.json({ ok: false, error: "Invalid address" }, { status: 400 });
        }

        const balances: Array<{ chainId: number; symbol: string; amount: number }> = [];

        for (const [chainIdText, tokenMap] of Object.entries(TOKEN_REGISTRY)) {
            const chainId = Number(chainIdText);
            const chainConfig = CHAIN_CONFIG[chainId];
            if (!chainConfig?.rpcUrl) continue;

            const client = createPublicClient({
                chain: chainConfig.chain,
                transport: http(chainConfig.rpcUrl, { timeout: 30000 }),
            });

            const entries = Object.entries(tokenMap);
            const results = await Promise.allSettled(
                entries.map(async ([symbol, tokenInfo]) => {
                    let amount = 0;
                    if (tokenInfo.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
                        const nativeBalance = await client.getBalance({ address: address as `0x${string}` });
                        amount = Number(formatUnits(nativeBalance, tokenInfo.decimals));
                    } else {
                        const rawBalance = await client.readContract({
                            address: tokenInfo.address as `0x${string}`,
                            abi: ERC20_ABI,
                            functionName: "balanceOf",
                            args: [address as `0x${string}`],
                        });
                        amount = Number(formatUnits(rawBalance as bigint, tokenInfo.decimals));
                    }

                    return { chainId, symbol, amount };
                }),
            );

            results.forEach((result) => {
                if (result.status !== "fulfilled") return;
                if (!Number.isFinite(result.value.amount) || result.value.amount <= 0) return;
                balances.push(result.value);
            });
        }

        return NextResponse.json({ ok: true, balances });
    } catch (error: any) {
        console.error("[WalletSummaryAPI] Failed:", error);
        return NextResponse.json({ ok: false, error: error?.message || "Unknown error" }, { status: 500 });
    }
}
