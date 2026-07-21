import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";
import type { DisDexV96KillSwitchCommand } from "../lib/disdex-v96-live-risk-controls";

function required(name: string) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

async function main() {
    const action = String(process.argv[2] || "").toLowerCase();
    const output = resolve(process.argv[3] || ".runtime-approval/disdex-v96-kill-switch.json");
    if (action !== "activate" && action !== "deactivate") {
        throw new Error("Usage: tsx scripts/disdex-v96-kill-switch.ts activate|deactivate [path]");
    }
    const command: DisDexV96KillSwitchCommand = {
        active: action === "activate",
        strategyId: DISDEX_V96_STRATEGY_ID,
        action: "FLATTEN_MANAGED",
        reason: action === "activate" ? required("DISDEX_V96_KILL_SWITCH_REASON") : "Operator cleared the V96 Kill Switch.",
        operator: required("DISDEX_V96_OPERATOR"),
        activatedAt: new Date().toISOString(),
    };
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(command, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({
        status: command.active ? "DISDEX_V96_KILL_SWITCH_ACTIVE" : "DISDEX_V96_KILL_SWITCH_INACTIVE",
        output,
        command,
    }));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
