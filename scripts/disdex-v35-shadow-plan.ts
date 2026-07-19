import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    ACTIVE_MAIN_STRATEGY,
    ACTIVE_MAIN_STRATEGY_MODE,
    ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED,
} from "../config/mainStrategy";
import {
    resolveDisDexV35Allocation,
    type DisDexV35AllocationInput,
} from "../lib/disdex-resilient-profit-main-v35";

function inputPath() {
    const direct = process.argv.find((value) => value.startsWith("--input="));
    if (direct) return direct.slice("--input=".length);
    const index = process.argv.indexOf("--input");
    if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
    return process.env.DISDEX_V35_SNAPSHOT_PATH;
}

async function readStdin() {
    if (process.stdin.isTTY) return "";
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
}

function validate(value: unknown): DisDexV35AllocationInput {
    if (!value || typeof value !== "object") throw new Error("V35 snapshot must be a JSON object.");
    const source = value as Partial<DisDexV35AllocationInput>;
    if (!(["BULL", "BEAR", "FLAT"] as const).includes(source.regime as "BULL" | "BEAR" | "FLAT")) {
        throw new Error("regime must be BULL, BEAR, or FLAT.");
    }
    if (!Number.isFinite(Number(source.coreGross))) throw new Error("coreGross must be numeric.");
    if (typeof source.penguSignalActive !== "boolean") throw new Error("penguSignalActive must be boolean.");
    const features = source.features;
    if (!features || typeof features !== "object") throw new Error("features are required.");
    const numericKeys = [
        "btcMomentum20dPct",
        "btcMomentum3dPct",
        "btcShock1dPct",
        "coreDownsideVolatilitySkew",
    ] as const;
    for (const key of numericKeys) {
        if (!Number.isFinite(Number(features[key]))) throw new Error(`features.${key} must be numeric.`);
    }
    if (typeof features.btcCloseAboveSma20d !== "boolean") {
        throw new Error("features.btcCloseAboveSma20d must be boolean.");
    }
    return {
        regime: source.regime as DisDexV35AllocationInput["regime"],
        coreGross: Number(source.coreGross),
        penguSignalActive: source.penguSignalActive,
        features: {
            btcCloseAboveSma20d: features.btcCloseAboveSma20d,
            btcMomentum20dPct: Number(features.btcMomentum20dPct),
            btcMomentum3dPct: Number(features.btcMomentum3dPct),
            btcShock1dPct: Number(features.btcShock1dPct),
            coreDownsideVolatilitySkew: Number(features.coreDownsideVolatilitySkew),
        },
    };
}

async function main() {
    const path = inputPath();
    const raw = path
        ? await readFile(resolve(path), "utf8")
        : await readStdin();
    if (!raw.trim()) {
        throw new Error("Provide --input <snapshot.json>, DISDEX_V35_SNAPSHOT_PATH, or JSON through stdin.");
    }
    const input = validate(JSON.parse(raw));
    const plan = resolveDisDexV35Allocation(input);
    process.stdout.write(`${JSON.stringify({
        generatedAt: new Date().toISOString(),
        activeMainStrategyId: ACTIVE_MAIN_STRATEGY.id,
        activeMode: ACTIVE_MAIN_STRATEGY_MODE,
        realTradingEnabled: ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED,
        input,
        plan,
        orderExecutionAttempted: false,
    }, null, 2)}\n`);
}

main().catch((error) => {
    console.error(JSON.stringify({
        level: "fatal",
        message: error instanceof Error ? error.message : String(error),
        orderExecutionAttempted: false,
    }));
    process.exitCode = 1;
});
