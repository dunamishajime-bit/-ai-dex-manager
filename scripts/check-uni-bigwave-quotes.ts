import { formatUnits } from "viem";

import { getHybridSlippageBps, RECLAIM_HYBRID_EXECUTION_PROFILE } from "../config/reclaimHybridStrategy";
import { getComparedQuotes } from "../lib/quote-providers";
import { resolveToken } from "../lib/tokens";

const chainId = 56;
const sizesUsd = [100, 300, 500, 1000];
const srcSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
const destSymbol = "UNI";

function toWeiString(amount: number, decimals: number) {
  return BigInt(Math.round(amount * 10 ** Math.min(decimals, 6))).toString() + "0".repeat(Math.max(0, decimals - 6));
}

function valueLossPct(srcUsd: number, destUsd: number) {
  if (!Number.isFinite(srcUsd) || !Number.isFinite(destUsd) || srcUsd <= 0 || destUsd <= 0) return Number.POSITIVE_INFINITY;
  return ((srcUsd - destUsd) / srcUsd) * 100;
}

async function main() {
  const srcToken = resolveToken(srcSymbol, chainId);
  const destToken = resolveToken(destSymbol, chainId);
  const slippageBps = getHybridSlippageBps(srcSymbol, destSymbol);

  const rows = [];
  for (const sizeUsd of sizesUsd) {
    const amountWei = toWeiString(sizeUsd, srcToken.decimals);
    const compared = await getComparedQuotes({
      chainId,
      srcToken,
      destToken,
      amountWei,
      slippageBps,
      account: "0x0000000000000000000000000000000000000001",
    });
    const quotes = compared.quotes.map((quote) => {
      const outUnits = Number(formatUnits(BigInt(quote.expectedOutWei), destToken.decimals));
      const srcUsd = Number(quote.notionalUsd || sizeUsd);
      const destUsd = quote.destUsd ? outUnits * quote.destUsd : 0;
      return {
        provider: quote.provider,
        outUnits,
        srcUsd,
        destUsd,
        valueLossPct: valueLossPct(srcUsd, destUsd),
        priceImpactPct: quote.priceImpactPct,
      };
    });
    rows.push({
      sizeUsd,
      bestProvider: compared.bestProvider,
      providerEdgeBps: compared.providerEdgeBps,
      providerEdgeUsd: compared.providerEdgeUsd,
      quotes,
    });
  }

  console.log(JSON.stringify({ pair: `${srcSymbol}->${destSymbol}`, slippageBps, rows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
