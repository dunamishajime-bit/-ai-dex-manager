import { resolve } from "node:path";

import { DISDEX_V13D_V11EQ_V96_RUNTIME } from "@/config/disdexStockRouterV13DV11EqRuntime";

export type DisDexV96V52SharedRuntimePaths = {
    combinedRoot: string;
    cryptoStateRoot: string;
    penguStateRoot: string;
    stockStateRoot: string;
    killSwitchPath: string;
};

const KILL_SWITCH_ENV_NAMES = [
    "DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE",
    "DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE",
    "DISDEX_V96_KILL_SWITCH_FILE",
    "PENGU_DUAL_LS_V2_KILL_SWITCH_FILE",
] as const;

/** Resolve one shared V96/V52 Kill Switch and reject split-brain aliases. */
export function resolveDisDexV96V52SharedRuntimePaths(
    env: NodeJS.ProcessEnv = process.env,
): DisDexV96V52SharedRuntimePaths {
    const combinedRoot = resolve(
        env.DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT
        || env.DISDEX_V13D_V11EQ_V96_STATE_DIR
        || DISDEX_V13D_V11EQ_V96_RUNTIME.stateDirectory,
    );
    const killSwitchPath = resolve(combinedRoot, "kill-switch.json");
    for (const name of KILL_SWITCH_ENV_NAMES) {
        const configured = String(env[name] || "").trim();
        if (configured && resolve(configured) !== killSwitchPath) {
            throw new Error(`DISDEX_V96_V52_KILL_SWITCH_PATH_MISMATCH:${name}=${resolve(configured)}:expected=${killSwitchPath}`);
        }
    }
    const cryptoStateRoot = resolve(env.DISDEX_V96_STATE_DIR || resolve(combinedRoot, "crypto-v96"));
    return {
        combinedRoot,
        cryptoStateRoot,
        penguStateRoot: resolve(env.PENGU_DUAL_LS_V2_STATE_DIR || resolve(cryptoStateRoot, "pengu-dual-ls-v2-final")),
        stockStateRoot: resolve(env.DISDEX_V52_ASTER_ONLY_STATE_DIR || resolve(combinedRoot, "stock")),
        killSwitchPath,
    };
}
