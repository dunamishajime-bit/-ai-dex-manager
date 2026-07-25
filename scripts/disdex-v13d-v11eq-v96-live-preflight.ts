import "dotenv/config";

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { DISDEX_V13D_V11EQ_V96_RUNTIME } from "../config/disdexStockRouterV13DV11EqRuntime";

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
        DISDEX_V96_STATE_DIR: paths.crypto,
        DISDEX_V96_KILL_SWITCH_FILE: paths.kill,
        DISDEX_V96_MAX_GROSS: "1",
        DISDEX_V96_CONFIG_MIGRATION_MODE: "true",
    } as NodeJS.ProcessEnv;
    const python = process.env.DISDEX_PYTHON_BIN || "python3";
    const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
    await run(python, ["-c", "import hyperliquid, eth_account, websocket; print('Python Stock dependencies: PASS')"], env);
    await run(python, ["scripts/disdex_v13d_v11eq_stock_free_live_engine.py", "--mode", "live", "--preflight"], env);
    await run(tsx, ["scripts/disdex-v96-live-preflight.ts"], env);
    console.log(JSON.stringify({
        status: "DISDEX_V13D_V11EQ_V96_LIVE_PREFLIGHT_PASS_NO_ORDERS_SENT",
        stockPreflight: "PASS_FREE_PYTH_PRIMARY_ALPACA_IEX_VALIDATED",
        cryptoV96Preflight: "PASS_VERIFIED_COMBINED_MIGRATION",
        ordersSent: false,
        cryptoGrossCap: 1,
        stockGrossCap: 1,
        totalGrossCap: 2,
        killSwitchPath: paths.kill,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "DISDEX_V13D_V11EQ_V96_LIVE_PREFLIGHT_FAILED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: false,
    }));
    process.exitCode = 1;
});
