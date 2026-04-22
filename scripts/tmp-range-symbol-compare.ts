import { runHybridBacktest } from "@/lib/backtest/hybrid-engine";

async function main() {
    const baseline = await runHybridBacktest("BASELINE");
    const ethOnly = await runHybridBacktest("RETQ22", { rangeSymbols: ["ETH"] });
    const solOnly = await runHybridBacktest("RETQ22", { rangeSymbols: ["SOL"] });
    const both = await runHybridBacktest("RETQ22", { rangeSymbols: ["ETH", "SOL"] });

    const comparison = {
        baseline: baseline.summary,
        ethOnly: ethOnly.summary,
        solOnly: solOnly.summary,
        both: both.summary,
    };

    console.log(JSON.stringify(comparison, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
