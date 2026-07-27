import "dotenv/config";

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
    DISDEX_V13D_V11EQ_V96_ALLOCATION,
    DISDEX_V13D_V11EQ_V96_RUNTIME,
} from "../config/disdexStockRouterV13DV11EqRuntime";

const STOCK_RUNNER_PATH = "scripts/disdex_v52_safe_runner.py" as const;

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
    const env = {
        ...process.env,
        DISDEX_V13D_V11EQ_V96_RUNNER_MODE: "live",
        DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT: paths.root,
        DISDEX_V13D_V11EQ_V96_STATE_DIR: paths.stock,
        DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE: paths.kill,
        DISDEX_V52_ASTER_ONLY_RUNNER_MODE: "live",
        DISDEX_V52_ASTER_ONLY_STATE_DIR: paths.stock,
        DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE: paths.kill,
        DISDEX_V52_CRYPTO_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap),
        DISDEX_V52_STOCK_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap),
        DISDEX_V52_PORTFOLIO_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.portfolioGrossCap),
        DISDEX_V52_V11_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.v11MaximumGross),
        DISDEX_V52_V50_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.v50MaximumGross),
        DISDEX_V96_STATE_DIR: paths.crypto,
        DISDEX_V96_KILL_SWITCH_FILE: paths.kill,
        DISDEX_V96_MAX_GROSS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap),
        DISDEX_V96_CONFIG_MIGRATION_MODE: "true",
    } as NodeJS.ProcessEnv;
    const python = process.env.DISDEX_PYTHON_BIN || "python3";
    const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
    await run(python, [STOCK_RUNNER_PATH, "--mode", "live", "--preflight"], env);
    await run(tsx, ["scripts/disdex-v96-live-preflight.ts"], env);
    console.log(JSON.stringify({
        status: "DISDEX_V96_V52_LIVE_PREFLIGHT_PASS_NO_ORDERS_SENT",
        stockPreflight: "PASS_V52_DUAL_SLOT_ASTER_ONLY_PYTH_IEX_VALIDATED",
        stockRunnerPath: STOCK_RUNNER_PATH,
        cryptoV96Preflight: "PASS_VERIFIED_COMBINED_MIGRATION",
        ordersSent: false,
        cryptoGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap,
        stockGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap,
        v11MaximumGross: DISDEX_V13D_V11EQ_V96_ALLOCATION.v11MaximumGross,
        v50MaximumGross: DISDEX_V13D_V11EQ_V96_ALLOCATION.v50MaximumGross,
        totalGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.portfolioGrossCap,
        killSwitchPath: paths.kill,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "DISDEX_V96_V52_LIVE_PREFLIGHT_FAILED", message: error instanceof Error ? error.message : String(error), ordersSent: false }));
    process.exitCode = 1;
});
