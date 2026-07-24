import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DISDEX_V13D_V11EQ_V96_RUNTIME, DISDEX_V13D_V11EQ_V96_STRATEGY_ID } from "../config/disdexStockRouterV13DV11EqRuntime";

const V96_KILL_SWITCH_STRATEGY_ID = "DISDEX_V35_STRONG_RESERVED_PENGU_V96";

function value(flag: string) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
    if (!process.argv.includes("--activate")) {
        throw new Error("Use --activate --reason <text>. Clearing requires manual position and order reconciliation.");
    }
    const reason = String(value("--reason") || "").trim();
    if (!reason) throw new Error("--reason is required.");
    const root = resolve(process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR || DISDEX_V13D_V11EQ_V96_RUNTIME.stateDirectory);
    const path = resolve(process.env.DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE || resolve(root, "kill-switch.json"));
    const payload = {
        active: true,
        strategyId: V96_KILL_SWITCH_STRATEGY_ID,
        action: "FLATTEN_MANAGED",
        reason,
        operator: process.env.USER || "operator",
        activatedAt: new Date().toISOString(),
        combinedStrategyId: DISDEX_V13D_V11EQ_V96_STRATEGY_ID,
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({ status: "ACTIVE", path, reason }));
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
