import dotenv from "dotenv";

import { loadOperationalWallets, saveOperationalWallets } from "@/lib/server/operational-wallet-db";
import { refreshWalletBalance } from "@/lib/server/live-hybrid-autotrade";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
    const wallets = await loadOperationalWallets();
    const refreshed = [];

    for (const wallet of wallets) {
        if (wallet.deletedAt) {
            refreshed.push(wallet);
            continue;
        }
        refreshed.push(await refreshWalletBalance(wallet));
    }

    await saveOperationalWallets(refreshed);
    console.log(JSON.stringify({
        ok: true,
        wallets: refreshed.map((wallet) => ({
            id: wallet.id,
            address: wallet.address,
            status: wallet.status,
            holdings: (wallet.trackedHoldings || [])
                .filter((holding) => Number(holding.usdValue || 0) >= 1)
                .map((holding) => ({
                    symbol: holding.symbol,
                    amount: holding.amount,
                    usdValue: holding.usdValue,
                })),
        })),
    }, null, 2));
}

main().catch((error) => {
    console.error("[refresh-operational-wallet-balances] failed:", error);
    process.exitCode = 1;
});
