import { assertSourceManifest, loadCanonicalSource } from "../../lib/backtest/dd-reduction/source";
import type { CanonicalSourceInput } from "../../lib/backtest/dd-reduction/types";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function requiredFlag(args: readonly string[], name: string): string {
    const index = args.indexOf(name);
    const value = index >= 0 ? args[index + 1] : undefined;
    if (value === undefined || value.startsWith("--")) {
        throw new Error(`missing required flag ${name}`);
    }
    return value;
}

function numberFlag(args: readonly string[], name: string): number {
    const value = Number(requiredFlag(args, name));
    if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
    return value;
}

function deposits(args: readonly string[]): readonly { ts: number; amount: number }[] {
    const result: { ts: number; amount: number }[] = [];
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] !== "--deposit") continue;
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--")) throw new Error("--deposit requires <ts>:<amount>");
        const [tsText, amountText] = value.split(":");
        const ts = Number(tsText);
        const amount = Number(amountText);
        if (!Number.isFinite(ts) || !Number.isFinite(amount)) throw new Error("--deposit requires numeric <ts>:<amount>");
        result.push({ ts, amount });
        index += 1;
    }
    return result;
}

export async function verifySource(args: readonly string[] = process.argv.slice(2)): Promise<void> {
    const input: CanonicalSourceInput = {
        sourceRoot: requiredFlag(args, "--source-root"),
        dataRoot: requiredFlag(args, "--data-root"),
        productionSha: requiredFlag(args, "--production-sha"),
        startTs: numberFlag(args, "--start-ts"),
        endTs: numberFlag(args, "--end-ts"),
        initialEquity: numberFlag(args, "--initial-equity"),
        deposits: deposits(args),
        feeBps: numberFlag(args, "--fee-bps"),
        slippageBps: numberFlag(args, "--slippage-bps"),
        fundingSource: requiredFlag(args, "--funding-source"),
    };
    const source = await loadCanonicalSource(input);
    if (source.manifest === undefined) throw new Error("loader returned no source manifest");
    assertSourceManifest(source.manifest, { productionSha: input.productionSha });
    process.stdout.write(`${JSON.stringify(source.manifest, null, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    verifySource().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "source verification failed";
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
    });
}
