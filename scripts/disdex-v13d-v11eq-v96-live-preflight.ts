import "dotenv/config";

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
    DISDEX_V13D_V11EQ_V96_ALLOCATION,
    DISDEX_V13D_V11EQ_V96_RUNTIME,
} from "../config/disdexStockRouterV13DV11EqRuntime";

function statePaths() {
    const root = resolve(process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR || DISDEX_V13D_V11EQ_V96_RUNTIME.stateDirectory);
    const kill = resolve(process.env.DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE || resolve(root, "kill-switch.json"));
    return { root, crypto: resolve(root, "crypto-v96"), stock: resolve(root, "stock"), kill };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
    return new Promise<void>((resolveRun, reject) => {
        const child = spawn(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code, signal) => {
            if (code === 0) resolveRun();
            else reject(new Error(`${command} ${args.join(" ")} failed: code=${code}, signal=${signal || "none"}`));
        });
    });
}

async function main() {
    const paths = statePaths();
    await Promise.all([mkdir(paths.crypto, { recursive: true }), mkdir(paths.stock, { recursive: true })]);
    const allocation = DISDEX_V13D_V11EQ_V96_ALLOCATION;
    const env = {
        ...process.env,
        DISDEX_V13D_V11EQ_V96_RUNNER_MODE: "live",
        DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT: paths.root,
        DISDEX_V13D_V11EQ_V96_STATE_DIR: paths.root,
        DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE: paths.kill,
        DISDEX_V52_ASTER_ONLY_RUNNER_MODE: "live",
        DISDEX_V52_ASTER_ONLY_STATE_DIR: paths.stock,
        DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE: paths.kill,
        DISDEX_V52_CRYPTO_GROSS_CAP: String(allocation.cryptoSleeveGrossCap),
        DISDEX_V52_STOCK_GROSS_CAP: String(allocation.stockSleeveGrossCap),
        DISDEX_V52_PORTFOLIO_GROSS_CAP: String(allocation.portfolioGrossCap),
        DISDEX_V52_V11_GROSS_CAP: String(allocation.v11MaximumGross),
        DISDEX_V52_V50_GROSS_CAP: String(allocation.v50MaximumGross),
        DISDEX_V52_RESERVED_FIRST_STOCK_GROSS: String(allocation.reservedFirstStockGross),
        DISDEX_V52_MINIMUM_FIRST_STOCK_GROSS: String(allocation.minimumFirstStockGross),
        DISDEX_V52_MINIMUM_SECOND_STOCK_GROSS: String(allocation.minimumSecondStockGross),
        DISDEX_V52_MAX_CONCURRENT_STOCK_POSITIONS: String(allocation.maximumConcurrentStockPositions),
        DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE: String(allocation.cryptoInitialLeverage),
        DISDEX_V96_V52_MAX_INITIAL_MARGIN_FRACTION: String(allocation.maximumInitialMarginFraction),
        DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION: String(allocation.minimumAvailableBalanceFractionAfterOrder),
        DISDEX_V96_STATE_DIR: paths.crypto,
        DISDEX_V96_KILL_SWITCH_FILE: paths.kill,
        DISDEX_V96_MAX_GROSS: String(allocation.cryptoSleeveGrossCap),
        DISDEX_V96_CONFIG_MIGRATION_MODE: "true",
        PENGU_DUAL_LS_V1_PORTFOLIO_GROSS_CAP: String(allocation.cryptoSleeveGrossCap),
    } as NodeJS.ProcessEnv;
    const python = process.env.DISDEX_PYTHON_BIN || "python3";
    const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
    await run(python, ["scripts/disdex_v52_margin_aware_live_engine.py", "--mode", "live", "--preflight"], env);
    await run(tsx, ["scripts/disdex-v96-live-preflight.ts"], env);
    console.log(JSON.stringify({
        status: "DISDEX_V96_V52_LIVE_PREFLIGHT_PASS_NO_ORDERS_SENT",
        stockPreflight: "PASS_V52_MARGIN_AWARE_DUAL_SLOT_ASTER_ONLY_PYTH_IEX_VALIDATED",
        cryptoV96Preflight: "PASS_VERIFIED_COMBINED_MIGRATION_FIXED_5X_CROSS",
        ordersSent: false,
        cryptoGrossCap: allocation.cryptoSleeveGrossCap,
        stockGrossCap: allocation.stockSleeveGrossCap,
        v11MaximumGross: allocation.v11MaximumGross,
        v50MaximumGross: allocation.v50MaximumGross,
        totalGrossCap: allocation.portfolioGrossCap,
        reservedFirstStockGross: allocation.reservedFirstStockGross,
        minimumSecondStockGross: allocation.minimumSecondStockGross,
        maximumConcurrentStockPositions: allocation.maximumConcurrentStockPositions,
        requiredInitialLeverage: allocation.cryptoInitialLeverage,
        requiredMarginType: allocation.requiredMarginType,
        maximumInitialMarginFraction: allocation.maximumInitialMarginFraction,
        minimumAvailableBalanceFractionAfterOrder: allocation.minimumAvailableBalanceFractionAfterOrder,
        killSwitchPath: paths.kill,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "DISDEX_V96_V52_LIVE_PREFLIGHT_FAILED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: false,
    }));
    process.exitCode = 1;
});
