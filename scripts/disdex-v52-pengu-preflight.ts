import "dotenv/config";

import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { PENGU_DUAL_LS_V1, resolvePenguDualLsV1Runtime } from "../config/penguDualLsV1Runtime";

export type V52PenguPreflightStatus = "ACTIVE" | "WAITING_MARKET_CLOSED" | "BLOCKED_DATA_UNAVAILABLE";

type ChildResult = { code: number | null; stdout: string; stderr: string };

const DATA_FAILURE_PATTERNS = [
    /iex_quote_unavailable/i,
    /cross_source_divergence/i,
    /reference quote (?:stale|unavailable|failed)/i,
    /reference (?:health|source).*?(?:failed|unavailable|not connected|did not become ready)/i,
    /free reference/i,
    /pyth.*iex/i,
];

export function isUsRegularEquitySession(now = new Date()): boolean {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
    if (["Sat", "Sun"].includes(parts.weekday)) return false;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return minutes >= 570 && minutes <= 960;
}

function containsDataFailure(output: string): boolean {
    return DATA_FAILURE_PATTERNS.some((pattern) => pattern.test(output));
}

function classifyV52Failure(output: string): V52PenguPreflightStatus | undefined {
    if (!containsDataFailure(output)) return undefined;
    return isUsRegularEquitySession() ? "BLOCKED_DATA_UNAVAILABLE" : "WAITING_MARKET_CLOSED";
}

function spawnCaptured(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<ChildResult> {
    return new Promise((resolveResult, reject) => {
        const child = spawn(command, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.once("error", reject);
        child.once("exit", (code) => resolveResult({ code, stdout, stderr }));
    });
}

function parseLastJson(output: string): Record<string, unknown> | undefined {
    for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).reverse()) {
        try {
            const parsed = JSON.parse(line) as unknown;
            if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
        } catch {
            // Ignore diagnostics before the final structured line.
        }
    }
    return undefined;
}

function assertPenguLiveGate() {
    const runtime = resolvePenguDualLsV1Runtime();
    if (runtime.mode !== "LIVE") throw new Error(`PENGU preflight requires LIVE mode, got ${runtime.mode}.`);
    if (!runtime.enabled || !runtime.liveTradingEnabled || !runtime.liveExecutionEnabled) {
        throw new Error("PENGU preflight LIVE gates are not all enabled.");
    }
    if (runtime.maximumGross !== PENGU_DUAL_LS_V1.maximumGross || runtime.longGross !== 0.75 || runtime.shortGross !== 0.75) {
        throw new Error("PENGU_DUAL_LS_V1 Gross must remain fixed at 0.75.");
    }
    if (runtime.portfolioGrossCap < runtime.maximumGross) {
        throw new Error("PENGU portfolio Gross cap is below strategy Gross.");
    }
    return {
        status: "PASS",
        strategyId: runtime.strategyId,
        maximumGross: runtime.maximumGross,
        longGross: runtime.longGross,
        shortGross: runtime.shortGross,
        portfolioGrossCap: runtime.portfolioGrossCap,
    } as const;
}

async function main() {
    const env = { ...process.env };
    const python = process.env.DISDEX_PYTHON_BIN || "python3";
    const v52 = await spawnCaptured(
        python,
        ["scripts/disdex_v52_margin_aware_live_engine.py", "--mode", "live", "--preflight-readonly"],
        env,
    );
    const combined = `${v52.stdout}\n${v52.stderr}`;
    let v52Status: V52PenguPreflightStatus;
    let detail = parseLastJson(v52.stdout);
    if (v52.code === 0) {
        v52Status = isUsRegularEquitySession() ? "ACTIVE" : "WAITING_MARKET_CLOSED";
        if (v52Status === "WAITING_MARKET_CLOSED") {
            detail = { ...(detail || {}), marketSession: "CLOSED", reason: "US_EQUITY_MARKET_CLOSED", ordersAllowed: false };
        }
    } else {
        const classified = classifyV52Failure(combined);
        if (!classified) throw new Error(`V52 preflight failed for a non-data safety reason; fail-closed. ${combined.trim()}`);
        v52Status = classified;
    }

    const pengu = assertPenguLiveGate();
    console.log(JSON.stringify({
        status: "DISDEX_V52_PENGU_PREFLIGHT_PASS",
        v96Enabled: false,
        v97Enabled: false,
        penguDualPreflight: pengu,
        v52Preflight: { status: v52Status, mode: "READ_ONLY", ordersAllowed: v52Status === "ACTIVE", detail },
        ordersSent: false,
        cancelSent: false,
        positionChangesSent: false,
    }));
}

if (import.meta.url === `file://${resolve(process.argv[1] || "")}`) {
    main().catch((error) => {
        console.error(JSON.stringify({
            status: "DISDEX_V52_PENGU_PREFLIGHT_FAIL_CLOSED",
            message: error instanceof Error ? error.message : String(error),
            ordersSent: false,
            cancelSent: false,
            positionChangesSent: false,
        }));
        process.exitCode = 1;
    });
}
