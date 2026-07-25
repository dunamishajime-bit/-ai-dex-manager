import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { DISDEX_V96_RUNTIME } from "../config/disdexV96Runtime";
import {
    assertDisDexV96LiveGates,
    type DisDexV96ExecutionParityApproval,
    type DisDexV96ForwardEvidenceApproval,
} from "../lib/disdex-v96-live-gates";
import {
    readDisDexV96KillSwitch,
    type DisDexV96OperatorOverrideApproval,
} from "../lib/disdex-v96-live-risk-controls";
import { FileDisDexV96RunnerStateStore } from "../lib/disdex-v96-runner-state";
import {
    assertCombinedV96MigrationReady,
    canonicalManagedPositions,
} from "../lib/disdex-v96-combined-state-migration";

const MANAGED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"] as const;

function boolEnv(name: string, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(raw.trim());
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

async function optionalJson<T>(pathValue?: string): Promise<T | undefined> {
    if (!pathValue) return undefined;
    try {
        return JSON.parse(await readFile(resolve(pathValue), "utf8")) as T;
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "ENOENT") return undefined;
        throw error;
    }
}

async function main() {
    const runtimeCommitSha = String(process.env.DISDEX_V96_RUNTIME_COMMIT_SHA || "").trim();
    const configMigrationMode = boolEnv("DISDEX_V96_CONFIG_MIGRATION_MODE", false);
    const [forwardEvidence, executionParity, operatorOverride] = await Promise.all([
        optionalJson<DisDexV96ForwardEvidenceApproval>(process.env.DISDEX_V96_FORWARD_EVIDENCE_FILE),
        optionalJson<DisDexV96ExecutionParityApproval>(process.env.DISDEX_V96_EXECUTION_PARITY_FILE),
        optionalJson<DisDexV96OperatorOverrideApproval>(process.env.DISDEX_V96_OPERATOR_OVERRIDE_FILE),
    ]);
    const gate = assertDisDexV96LiveGates({
        runnerMode: "live",
        environmentLiveExecutionEnabled: boolEnv("DISDEX_V96_LIVE_EXECUTION_ENABLED", false),
        activationAcknowledgement: process.env.DISDEX_V96_LIVE_ACKNOWLEDGEMENT,
        forwardEvidence,
        executionParity,
        operatorOverride,
        runtimeCommitSha,
    });
    if (gate.operatorOverrideApproved && gate.operatorOverride) {
        const remainingMs = Date.parse(gate.operatorOverride.expiresAt) - Date.now();
        if (remainingMs < 15 * 60_000) throw new Error("V96 Operator Override expires in less than 15 minutes.");
    }
    const killSwitch = await readDisDexV96KillSwitch(process.env.DISDEX_V96_KILL_SWITCH_FILE);
    if (killSwitch?.active) throw new Error(`V96 Kill Switch is active: ${killSwitch.reason}`);

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V96-LIVE-Preflight/1.2",
    });
    if (!client.hasTradingCredentials()) {
        throw new Error("V96 preflight requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    }
    const [ping, balances, positionRows, openOrders, exchangeInfo] = await Promise.all([
        client.ping(),
        client.getBalances(),
        client.getPositions(),
        client.getOpenOrders(),
        client.getExchangeInfo(),
    ]);
    void ping;
    if (!Array.isArray(positionRows) || positionRows.length === 0) {
        throw new Error("Aster positionRisk returned no rows; One-way Mode could not be verified.");
    }
    const nonBothRows = positionRows.filter((row) => String(row.positionSide || "").toUpperCase() !== "BOTH");
    if (nonBothRows.length) {
        throw new Error(`Aster account is not in One-way Mode; ${nonBothRows.length} position row(s) are not BOTH.`);
    }
    const managedPositions = positionRows.filter((row) =>
        MANAGED_SYMBOLS.includes(String(row.symbol).toUpperCase() as typeof MANAGED_SYMBOLS[number])
        && Math.abs(Number(row.positionAmt) || 0) > 1e-12,
    );
    if (!Array.isArray(openOrders) || openOrders.length !== 0) {
        throw new Error(`V96 preflight requires zero open orders; found ${Array.isArray(openOrders) ? openOrders.length : "unknown"}.`);
    }

    let migratedStateVerified = false;
    let migrationId: string | undefined;
    if (configMigrationMode) {
        const stateRoot = resolve(process.env.DISDEX_V96_STATE_DIR || DISDEX_V96_RUNTIME.stateDirectory);
        const state = await new FileDisDexV96RunnerStateStore(resolve(stateRoot, "runner-live.json"), "live").load();
        if (state.bootstrapRequired) throw new Error("V96 config-migration preflight requires a migrated established state with bootstrapRequired=false.");
        if (state.pending) throw new Error("V96 config-migration preflight found a pending state order.");
        if (state.manualReviewReason) throw new Error(`V96 config-migration preflight found manual review: ${state.manualReviewReason}`);
        if (state.operatorOverride) throw new Error("Migrated V96 state still contains the old Operator Override audit.");
        const combinedRoot = String(process.env.DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT || "").trim();
        if (!combinedRoot) throw new Error("Combined migration preflight requires DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT.");
        const migration = await assertCombinedV96MigrationReady({
            combinedRoot,
            managedPositions: canonicalManagedPositions(managedPositions),
        });
        if (migration.manifest.asterAccountAddress !== String(process.env.ASTER_USER_ADDRESS || "").toLowerCase()) {
            throw new Error("Combined V96 migration account does not match ASTER_USER_ADDRESS.");
        }
        migrationId = migration.manifest.migrationId;
        migratedStateVerified = true;
    } else if (managedPositions.length) {
        throw new Error(`V96 initial LIVE bootstrap requires managed positions to be flat; found ${managedPositions.length}.`);
    }

    const usdt = balances.find((row) => String(row.asset).toUpperCase() === "USDT");
    if (!usdt) throw new Error("Aster USDT balance row was not returned.");
    const symbols = new Map(exchangeInfo.symbols.map((row) => [String(row.symbol).toUpperCase(), row]));
    for (const symbol of MANAGED_SYMBOLS) {
        const row = symbols.get(symbol);
        if (!row || row.status !== "TRADING") throw new Error(`Aster managed symbol is not TRADING: ${symbol}`);
        const filters = row.filters || [];
        if (!filters.some((filter) => filter.filterType === "MARKET_LOT_SIZE" || filter.filterType === "LOT_SIZE")) {
            throw new Error(`Aster quantity filter is missing for ${symbol}.`);
        }
        if (!filters.some((filter) => filter.filterType === "MIN_NOTIONAL")) {
            throw new Error(`Aster MIN_NOTIONAL filter is missing for ${symbol}.`);
        }
    }
    console.log(JSON.stringify({
        status: "DISDEX_V96_LIVE_PREFLIGHT_PASS_NO_ORDERS_SENT",
        preflightMode: configMigrationMode ? "VERIFIED_COMBINED_STATE_MIGRATION_WITH_EXISTING_MANAGED_POSITIONS" : "INITIAL_FLAT_BOOTSTRAP",
        runtimeCommitSha,
        configFingerprint: gate.configFingerprint,
        forwardEvidenceApproved: gate.forwardEvidenceApproved,
        operatorOverrideApproved: gate.operatorOverrideApproved,
        operatorOverrideExpiresAt: gate.operatorOverride?.expiresAt,
        initialPenguGrossCap: gate.operatorOverride?.initialPenguGrossCap,
        maximumDailyLossPct: gate.operatorOverride?.maximumDailyLossPct,
        maximumDailyLossUsd: gate.operatorOverride?.maximumDailyLossUsd,
        oneWayMode: true,
        managedPositionCount: managedPositions.length,
        migratedStateVerified,
        migrationId,
        openOrderCount: openOrders.length,
        usdtBalance: Number(usdt.balance ?? usdt.crossWalletBalance ?? 0),
        usdtAvailableBalance: Number(usdt.availableBalance ?? 0),
        managedSymbolsTrading: MANAGED_SYMBOLS,
        ordersSent: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "DISDEX_V96_LIVE_PREFLIGHT_FAILED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: false,
    }));
    process.exitCode = 1;
});
